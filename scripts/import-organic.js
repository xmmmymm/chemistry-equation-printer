/*
 * 选择性必修3（有机）增量导入（阶段2）：
 *   1. 读 extraction/merged-entries.json（merge-extraction.js 七册合并产物）
 *   2. 只取 textbooks 含「选择性必修3」的反应组
 *   3. 与现有题库做版本级判重（type + 反应物/生成物化学式集合）：
 *      - 版本已存在 → 剔除该版本（跨册复现，旧条目保持零变化，不重复导入）
 *      - 整个 entry 的版本全部已存在 → 跳过该条目并记录
 *   4. 走 Importer.validateImportData 全量校验（化学式/守恒/系数 n 形式）
 *   5. 以续号 id 追加进两处 library.json —— 既有条目逐字节不动（不做 ALIAS 归一）
 * 用法：node scripts/import-organic.js [--dry]
 */
const fs = require('fs');
const path = require('path');
const Importer = require('../src/libs/importer.js');
const C = require('../src/libs/chem.js');

const ROOT = path.join(__dirname, '..');
const EXT = path.join(ROOT, 'extraction');
const BOOK = '选择性必修3';
const DATA_DIRS = [
  path.join(ROOT, 'data'),
  path.join(ROOT, 'build', 'win-unpacked', 'data')
];

function main() {
  const dry = process.argv.includes('--dry');
  const merged = JSON.parse(fs.readFileSync(path.join(EXT, 'merged-entries.json'), 'utf8'));

  // 现有题库：版本判重索引（与 importer 相同的键规则）
  const lib = JSON.parse(fs.readFileSync(path.join(DATA_DIRS[0], 'library.json'), 'utf8'));
  const existingKeys = new Set();
  for (const e of lib.entries) {
    for (const v of (e.versions || [])) {
      existingKeys.add(v.type + '|' + C.versionDupKey(v));
    }
  }
  const maxNum = lib.entries.reduce((a, e) => {
    const m = /^R(\d+)$/.exec(e.id || '');
    return m ? Math.max(a, parseInt(m[1], 10)) : a;
  }, 0);

  // 1. 选三反应组
  const cand = merged.filter(m => (m.textbooks || []).some(t => t.book === BOOK));
  console.log('合并产物中含选三教材位置的反应组: ' + cand.length + ' / ' + merged.length);

  // 2. 版本级判重
  const skippedEntries = []; // 跨册复现（整条跳过）
  const droppedVersions = []; // 条目保留但个别版本剔除
  const newGroups = [];
  for (const m of cand) {
    const kept = [];
    for (const v of (m.versions || [])) {
      const built = v.built || v;
      const key = built.type + '|' + C.versionDupKey(built);
      if (existingKeys.has(key)) droppedVersions.push({ name: m.name, type: built.type, reason: '版本已存在于题库（跨册复现）' });
      else kept.push(v);
    }
    if (!kept.length) { skippedEntries.push(m); continue; }
    if (kept.length < (m.versions || []).length) newGroups.push({ ...m, versions: kept, _dropped: (m.versions || []).length - kept.length });
    else newGroups.push(m);
  }
  console.log('剔除版本 ' + droppedVersions.length + ' 个；整条跳过（跨册复现）' + skippedEntries.length + ' 条；待导入 ' + newGroups.length + ' 条');

  // 3. 组装 raw import 数据（与 import-extraction.js 同构）
  //    - 保留 textbooks.context（栏目溯源，机器校验/复核需要）
  //    - 剥离非选三的 textbook 记录：跨册合并组里旧册的 RAW 记录未经 clean-sections
  //      清洗（含栏目型 section / 缺 context），且旧册位置已由题库既有条目（含
  //      ALIAS 归一后的变体）覆盖；新条目只承载选三教材位置
  //    - 剥离后若仅剩 1 册则去掉合并阶段误加的「高频」标签
  let droppedTb = 0;
  const rawEntries = newGroups.map((m, i) => {
    let textbooks = (m.textbooks || [])
      .filter(t => {
        if (t.book === BOOK) return true;
        droppedTb++;
        return false;
      })
      .map(t => ({ version: t.version, book: t.book, chapter: t.chapter, section: t.section, context: t.context }));
    const books = new Set(textbooks.map(t => t.book));
    const tags = (m.tags || []).filter(x => !(books.size < 2 && x === '高频'));
    return {
    id: 'R' + String(maxNum + i + 1).padStart(4, '0'),
    name: m.name,
    description: m.description || '',
    openPrompt: '',
    difficulty: m.difficulty,
    difficultyReason: m.difficultyReason || '',
    starred: false,
    mustInclude: false,
    enabled: true,
    textbooks,
    substanceCategories: m.substanceCategories || [],
    reactionTypes: m.reactionTypes || [],
    knowledgeModules: m.knowledgeModules || [],
    tags,
    remark: m.remark || '',
    source: m.source || '',
    versions: (m.versions || []).map((v, vi) => {
      const built = v.built || v;
      return {
        id: 'R' + String(maxNum + i + 1).padStart(4, '0') + '-' + (built.type || 'chemical') + (vi > 0 ? String(vi + 1) : ''),
        type: built.type,
        label: built.label,
        reversible: !!built.reversible,
        reactants: built.reactants,
        products: built.products,
        conditions: built.conditions || [],
        extras: built.extras || {},
        questionCount: 0
      };
    }),
    questionCount: 0,
    lastUsedAt: ''
    };
  });
  if (droppedTb) console.log('剥离非选三 textbook 记录: ' + droppedTb + ' 条');

  // 4. 全量校验（对照现有题库，判重应命中 0）
  const validation = Importer.validateImportData(
    { version: 1, entries: rawEntries },
    { version: 1, entries: lib.entries },
    'organic-xb3.json'
  );
  console.log('校验: 错误 ' + validation.errorCount + ' 条 / 警告 ' + validation.warningCount + ' 条 / 重复 ' + validation.dupCount + ' 条');

  // 报告
  const report = [];
  report.push('# 选择性必修3 增量导入报告');
  report.push('');
  report.push('- 合并产物反应组（含选三）: ' + cand.length);
  report.push('- 待导入条目: ' + rawEntries.length + '（versions ' + rawEntries.reduce((a, e) => a + e.versions.length, 0) + ' 个）');
  report.push('- 剔除已存在版本: ' + droppedVersions.length + ' 个');
  report.push('- 整条跳过（跨册复现，题库已有该反应）: ' + skippedEntries.length + ' 条');
  report.push('- 校验: 错误 ' + validation.errorCount + ' / 警告 ' + validation.warningCount + ' / 重复 ' + validation.dupCount);
  report.push('');
  if (skippedEntries.length) {
    report.push('## 跨册复现跳过清单');
    for (const m of skippedEntries) {
      report.push('- ' + m.name + '（' + (m.textbooks || []).map(t => t.book + '·' + t.chapter).join('、') + '）');
    }
    report.push('');
  }
  if (droppedVersions.length) {
    report.push('## 剔除的重复版本');
    for (const d of droppedVersions) report.push('- ' + d.name + ' [' + d.type + '] ' + d.reason);
    report.push('');
  }
  if (validation.errorCount) {
    report.push('## 校验错误明细');
    for (const r of validation.results) {
      if (r.errors.length) {
        report.push('### ' + r.entry.name);
        r.errors.forEach(e => report.push('- ' + e.message));
      }
    }
  }
  // 六类反应分布
  const rt = {};
  for (const e of rawEntries) for (const t of (e.reactionTypes || [])) rt[t] = (rt[t] || 0) + 1;
  report.push('');
  report.push('## 新增条目反应类型分布');
  for (const [k, v] of Object.entries(rt).sort((a, b) => b[1] - a[1])) report.push('- ' + k + ': ' + v);
  fs.writeFileSync(path.join(EXT, 'organic-import-report.md'), report.join('\n'), 'utf8');
  console.log('报告: extraction/organic-import-report.md');

  if (dry) { console.log('--dry：不写入。'); return; }
  if (validation.errorCount) { console.error('存在校验错误，中止导入。'); process.exit(1); }
  if (validation.dupCount) { console.error('存在与现有题库的重复（不应发生，判重逻辑需检查），中止。'); process.exit(1); }

  // 5. 追加写入两处（既有 entries 数组原样引用，不重排不改写）
  const newEntries = validation.results.map(r => r.entry);
  for (const dir of DATA_DIRS) {
    const p = path.join(dir, 'library.json');
    const cur = JSON.parse(fs.readFileSync(p, 'utf8'));
    // 一致性护栏：两处数据必须同构才追加
    if (cur.entries.length !== lib.entries.length) {
      console.error('数据目录不一致: ' + p + '（' + cur.entries.length + ' ≠ ' + lib.entries.length + '），中止。');
      process.exit(1);
    }
    cur.entries.push(...JSON.parse(JSON.stringify(newEntries)));
    cur.updatedAt = new Date().toISOString();
    fs.writeFileSync(p, JSON.stringify(cur, null, 2), 'utf8');
    console.log('已追加写入: ' + p + '（总计 ' + cur.entries.length + ' 条）');
  }
  console.log('新增 ' + newEntries.length + ' 条 / ' + newEntries.reduce((a, e) => a + e.versions.length, 0) + ' 个版本（id ' + rawEntries[0].id + ' 起）');
}
main();
