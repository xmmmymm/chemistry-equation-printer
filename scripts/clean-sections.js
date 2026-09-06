/*
 * 章节数据清洗（方案B·阶段1）：高中四册栏目型 section 归位到真节。
 * 栏目型 = 复习/练习/实验栏目名（不是真节）。清洗后 section 均为真节，栏目名保留在 context。
 *
 * 用法：
 *   node clean-sections.js plan   Pass A 自动归位（同章已有真节）→ 写回两处数据 → Pass B 生成待判清单
 *   node clean-sections.js apply  Pass C 应用人工判定（extraction/column-only-todo.json 的 assignedSection）
 *   node clean-sections.js check  仅统计校验（残余栏目数等）
 *   node clean-sections.js        默认 = plan
 * 幂等：已归位的记录不再命中栏目正则，重复运行安全；plan 重生成 todo 时保留已填写的判定。
 */
const fs = require('fs');
const path = require('path');
const C = require('../src/libs/chem.js');

const ROOT = path.join(__dirname, '..');
const DATA_DIRS = [
  path.join(ROOT, 'data'),
  path.join(ROOT, 'build', 'win-unpacked', 'data')
];
const HIGH_BOOKS = ['必修第一册', '必修第二册', '选择性必修1', '选择性必修2'];
const COLUMN_RE = /练习与应用|复习与提高|整理与提升|实验活动|探究|思考与讨论/;
const TODO_PATH = path.join(ROOT, 'extraction', 'column-only-todo.json');

const mode = process.argv[2] || 'plan';

// ---------- IO ----------
function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch (e) { return fallback; }
}
function writeJsonVerified(p, obj) {
  const txt = JSON.stringify(obj, null, 2);
  fs.writeFileSync(p, txt, 'utf-8');
  const back = JSON.parse(fs.readFileSync(p, 'utf-8')); // 立即回读验证
  if (JSON.stringify(back) !== JSON.stringify(obj)) throw new Error('写后校验失败: ' + p);
}
function loadLibrary() {
  const lib = readJson(path.join(DATA_DIRS[0], 'library.json'), null);
  if (!lib) throw new Error('data/library.json 不存在或损坏');
  return lib;
}
function saveLibraryAll(lib) {
  for (const d of DATA_DIRS) {
    const p = path.join(d, 'library.json');
    fs.mkdirSync(path.dirname(p), { recursive: true });
    writeJsonVerified(p, lib);
  }
}

// ---------- 工具 ----------
const isHigh = t => HIGH_BOOKS.includes(t.book);
const isColumn = t => COLUMN_RE.test(t.section || '');
const tbKey = t => [t.version || '', t.book || '', t.chapter || '', t.section || '', t.context || ''].join('§');

// 去重：book+chapter+section+context（+version）全同视为完全重复，保留第一条
// 仅对高中四册记录去重（含归位改写后产生的重复与提取时已有的重复）；
// 初中记录一律不动（含其自身的重复，本任务不处理初中）
function dedupeTextbooks(entry) {
  const seen = new Set();
  const before = (entry.textbooks || []).length;
  entry.textbooks = (entry.textbooks || []).filter(t => {
    if (!isHigh(t)) return true; // 初中记录原样保留
    const k = tbKey(t);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return before - entry.textbooks.length;
}

// 全库真节索引：{ "book§chapter": [section...] }（按出现顺序，全局节名唯一）
function buildRealSectionIndex(lib) {
  const idx = {};
  for (const e of lib.entries) {
    for (const t of (e.textbooks || [])) {
      if (!isHigh(t) || isColumn(t) || !t.section) continue;
      const k = (t.book || '') + '§' + (t.chapter || '');
      if (!idx[k]) idx[k] = [];
      if (!idx[k].includes(t.section)) idx[k].push(t.section);
    }
  }
  return idx;
}

// ---------- Pass A：自动归位 ----------
function passA(lib) {
  const stats = { rewritten: 0, dedup: 0, multiChoice: [] };
  for (const e of lib.entries) {
    const high = (e.textbooks || []).filter(isHigh);
    if (!high.length) continue;
    const reals = high.filter(t => !isColumn(t) && t.section);
    for (const t of high) {
      if (!isColumn(t)) continue;
      const same = reals.filter(r => r.book === t.book && r.chapter === t.chapter);
      if (!same.length) continue;
      if (same.length > 1) {
        stats.multiChoice.push(`${e.name} [${t.chapter}] 备选: ${same.map(s => s.section).join(' / ')} → 取 ${same[0].section}`);
      }
      const old = t.section;
      t.section = same[0].section;
      t.context = t.context ? (t.context + '、' + old) : old;
      stats.rewritten++;
    }
    stats.dedup += dedupeTextbooks(e);
  }
  return stats;
}

// ---------- Pass B：人工判定清单 ----------
function passB(lib) {
  const idx = buildRealSectionIndex(lib);
  const old = readJson(TODO_PATH, []);
  const oldMap = {};
  for (const it of (Array.isArray(old) ? old : [])) oldMap[it.id + '§' + it.book + '§' + it.chapter + '§' + it.column] = it;
  const items = [];
  for (const e of lib.entries) {
    const high = (e.textbooks || []).filter(isHigh);
    if (!high.length) continue;
    // 输出 Pass A 后仍有栏目记录的条目：
    // ① 栏目-only 条目（整条目无真节）；② 有真节但该记录所在章无真节（第三类，同样需人工归位以满足“栏目型=0”）
    const col = high.filter(isColumn);
    if (!col.length) continue;
    const mainV = (e.versions || []).find(v => v.type === 'chemical') || (e.versions || [])[0];
    const seen = new Set();
    for (const t of col) {
      const uk = t.book + '§' + t.chapter + '§' + t.section;
      if (seen.has(uk)) continue;
      seen.add(uk);
      const key = e.id + '§' + t.book + '§' + t.chapter + '§' + t.section;
      const prev = oldMap[key];
      const item = {
        id: e.id,
        name: e.name,
        equation: mainV ? C.equationText(mainV) : '',
        book: t.book,
        chapter: t.chapter,
        column: t.section,
        candidates: idx[(t.book + '§' + t.chapter)] || [],
        assignedSection: (prev && prev.assignedSection) || '',
        confidence: (prev && prev.confidence) || '',
        note: (prev && prev.note) || ''
      };
      items.push(item);
    }
  }
  fs.mkdirSync(path.dirname(TODO_PATH), { recursive: true });
  writeJsonVerified(TODO_PATH, items);
  return { count: items.length, entries: new Set(items.map(i => i.id)).size, path: TODO_PATH };
}

// ---------- Pass C：应用人工判定 ----------
function passC(lib) {
  const todo = readJson(TODO_PATH, []);
  if (!Array.isArray(todo) || !todo.length) throw new Error('todo 清单为空，无需 apply');
  const missing = todo.filter(i => !i.assignedSection);
  if (missing.length) {
    console.error('以下 ' + missing.length + ' 条尚未填写 assignedSection：');
    for (const m of missing) console.error('  -', m.name, '|', m.book, m.chapter, '|', m.column);
    process.exit(1);
  }
  const idx = buildRealSectionIndex(lib);
  const stats = { applied: 0, entries: new Set(), lowConfidence: [] };
  const byId = {};
  for (const e of lib.entries) byId[e.id] = e;
  for (const it of todo) {
    const e = byId[it.id];
    if (!e) { console.warn('  ⚠ 条目不存在，跳过: ' + it.name); continue; }
    const valid = (idx[it.book + '§' + it.chapter] || []).includes(it.assignedSection);
    if (!valid) throw new Error(`「${it.name}」判定节「${it.assignedSection}」不在 ${it.book}/${it.chapter} 的真节候选中`);
    let hit = 0;
    for (const t of (e.textbooks || [])) {
      if (!isHigh(t) || !isColumn(t)) continue;
      if (t.book !== it.book || t.chapter !== it.chapter || t.section !== it.column) continue;
      const old = t.section;
      t.section = it.assignedSection;
      t.context = t.context ? (t.context + '、' + old) : old;
      hit++;
    }
    if (!hit) console.warn('  ⚠ 未找到匹配的栏目记录: ' + it.name + ' / ' + it.book + ' / ' + it.column);
    stats.applied += hit;
    stats.entries.add(it.id);
    if (it.confidence === 'low') stats.lowConfidence.push(`${it.name} → ${it.book}·${it.chapter}·${it.assignedSection}（原栏目：${it.column}）${it.note ? ' — ' + it.note : ''}`);
  }
  // 全条目去重
  let dedup = 0;
  for (const e of lib.entries) dedup += dedupeTextbooks(e);
  stats.dedup = dedup;
  return stats;
}

// ---------- 校验与统计 ----------
function validateAll(lib) {
  let failures = 0;
  const errs = [];
  for (const e of lib.entries) {
    for (const v of (e.versions || [])) {
      const st = C.validateVersion(v);
      if (st && st.errors && st.errors.length) {
        failures++;
        if (errs.length < 10) errs.push(`「${e.name}」${v.label}: ${st.errors.join('；')}`);
      }
    }
  }
  return { failures, errs };
}
function stats(lib) {
  const s = {
    entries: lib.entries.length,
    versions: lib.entries.reduce((a, e) => a + (e.versions || []).length, 0),
    highEntries: 0, highRecs: 0, colRecs: 0, colOnlyEntries: 0,
    ctxRecs: 0, residualByBook: {}
  };
  for (const e of lib.entries) {
    let hasHigh = false, hasReal = false, hasCol = false;
    for (const t of (e.textbooks || [])) {
      if (!isHigh(t)) continue;
      hasHigh = true; s.highRecs++;
      if (isColumn(t)) {
        hasCol = true; s.colRecs++;
        const k = t.book + ' ' + t.chapter;
        s.residualByBook[k] = (s.residualByBook[k] || 0) + 1;
      } else hasReal = true;
      if (t.context) s.ctxRecs++;
    }
    if (hasHigh) s.highEntries++;
    if (hasHigh && !hasReal && hasCol) s.colOnlyEntries++;
  }
  return s;
}
function report(lib) {
  const st = stats(lib);
  console.log('--- 统计 ---');
  console.log(`条目 ${st.entries} / 版本 ${st.versions}`);
  console.log(`高中条目 ${st.highEntries} / 高中记录 ${st.highRecs}（栏目型残余 ${st.colRecs}，含 context 记录 ${st.ctxRecs}）`);
  console.log(`栏目-only 条目残余: ${st.colOnlyEntries}`);
  if (st.colRecs) console.log('残余栏目分布:', JSON.stringify(st.residualByBook, null, 2));
  return st;
}

// ---------- 主流程 ----------
function main() {
  const lib = loadLibrary();
  if (mode === 'check') {
    report(lib);
    const v = validateAll(lib);
    console.log('全量 validateVersion 失败数:', v.failures);
    if (v.errs.length) console.log(v.errs.join('\n'));
    process.exit(v.failures || stats(lib).colRecs ? 1 : 0);
  }
  if (mode === 'plan') {
    const a = passA(lib);
    saveLibraryAll(lib);
    console.log(`Pass A: 自动归位 ${a.rewritten} 处栏目记录，去重删除 ${a.dedup} 条重复记录`);
    if (a.multiChoice.length) {
      console.log('多真节备选（取第一个）:');
      a.multiChoice.forEach(m => console.log('  ' + m));
    }
    const b = passB(lib);
    console.log(`Pass B: 待人工判定记录 ${b.count} 条（涉及条目 ${b.entries} 个）→ ${b.path}`);
    report(lib);
    return;
  }
  if (mode === 'apply') {
    const c = passC(lib);
    saveLibraryAll(lib);
    console.log(`Pass C: 应用判定 ${c.applied} 处栏目记录（${c.entries.size} 个条目），去重删除 ${c.dedup} 条重复记录`);
    if (c.lowConfidence.length) {
      console.log('低置信归位清单:');
      c.lowConfidence.forEach(m => console.log('  - ' + m));
    }
    const st = report(lib);
    const v = validateAll(lib);
    console.log('全量 validateVersion 失败数:', v.failures);
    if (v.errs.length) console.log(v.errs.join('\n'));
    if (v.failures) process.exit(1);
    if (st.colRecs) { console.error('✗ 残余栏目型 section 不为 0'); process.exit(1); }
    if (st.colOnlyEntries) { console.error('✗ 仍有栏目-only 条目'); process.exit(1); }
    console.log('✓ 清洗完成：高中栏目型残余 0，全部条目有真节，校验 0 失败');
    return;
  }
  console.error('未知模式: ' + mode);
  process.exit(1);
}
main();
