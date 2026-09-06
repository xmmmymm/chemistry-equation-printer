/*
 * 教材提取结果整合管线（父代理用）：
 * 1. 读取 extraction/<六册>.json
 * 2. 逐 version 用 chem.js 机器校验（解析/配平/守恒）——失败输出修正清单
 * 3. 跨册合并：同一反应（代表键=反应物/生成物集合，忽略系数顺序）合并标签（textbooks/分类/tags 取并集）
 * 4. 出现≥2册自动打「高频」
 * 5. 输出：merged-entries.json（原始形态，供人工复核）+ report.md
 * 用法：node scripts/merge-extraction.js
 */
const fs = require('fs');
const path = require('path');
const C = require('../src/libs/chem.js');

const EXT_DIR = path.join(__dirname, '..', 'extraction');
const BOOKS = ['九年级上册', '九年级下册', '必修第一册', '必修第二册', '选择性必修1', '选择性必修2', '选择性必修3'];

// 条件词 → 项目 code 映射（text 用教材语义词或项目约定）
const COND_CODE = {
  '点燃': { code: 'ignite', text: '点燃' },
  '加热': { code: 'heat', text: '△' },
  '高温': { code: 'highTemperature', text: '高温' },
  '催化剂': { code: 'catalyst', text: '催化剂' },
  '通电': { code: 'electric', text: '通电' },
  '光照': { code: 'light', text: '光照' },
  '浓硫酸': { code: 'concH2SO4', text: '浓硫酸' },
  '常温': { code: 'roomTemperature', text: '常温' },
  '高压': { code: 'custom', text: '高压' }
};

// ---------- 代表键：反应物/生成物集合（忽略系数与顺序，仅取元素组成+个数总量的近似） ----------
function speciesSet(list) {
  return (list || []).map(sp => sp.formula).sort().join('|');
}
function versionKey(v) {
  return v.type + '#' + speciesSet(v.reactants) + '#' + speciesSet(v.products);
}
function reactionKey(item) {
  // 代表键基于「构建后的版本」（raw entry 的 versions 只有 line 字段，无 reactants/products）
  const built = (item.versions || []).map(v => v.built);
  const rep = built.find(v => v.type === 'chemical') || built[0];
  if (!rep) return null;
  return speciesSet(rep.reactants) + '#' + speciesSet(rep.products);
}

// ---------- version 组装与校验 ----------
function buildVersion(book, vi, rv) {
  const problems = [];
  const r = C.parseEquationLine(rv.line);
  if (!r.ok) {
    return { ok: false, problems: ['解析失败: ' + r.errors.join('; ')] };
  }
  const v = {
    id: 'V_' + book + '_' + vi,
    type: rv.type,
    label: null,
    reversible: rv.reversible != null ? rv.reversible : r.reversible,
    reactants: r.reactants,
    products: r.products,
    conditions: (rv.conditions || []).map(w => {
      const m = COND_CODE[w];
      if (m) return { code: m.code, text: m.text, position: 'auto' };
      return { code: 'custom', text: w, position: 'auto' };
    }),
    extras: {}
  };
  if (rv.type === 'thermochemical') {
    if (!rv.deltaH) problems.push('热化学方程式缺 deltaH');
    else v.extras.deltaH = String(rv.deltaH);
    // 状态标注检查
    const noState = [...r.reactants, ...r.products].some(sp => !sp.state);
    if (noState) problems.push('热化学方程式物质缺状态标注 (g)/(l)');
  }
  if (rv.type === 'electrode') {
    // e- 检测：解析产物中有电子即合法（\b 对尾随 e- 无效，勿用）
    const hasElectron = [...r.reactants, ...r.products].some(sp => sp.isElectron || /^e-?$/i.test(sp.formula));
    if (!hasElectron) problems.push('电极反应式缺电子 e-');
    if (rv.electrode) v.extras.electrode = rv.electrode;
    if (rv.medium) v.extras.medium = rv.medium;
  }
  const st = C.validateVersion(v);
  if (!st.ok) problems.push(...st.errors.map(e => '守恒: ' + e));
  return { ok: problems.length === 0, problems, version: v, warnings: st.warnings };
}

// version extras 兜底（热化学 ΔH 已在构建时放入 v.extras；电极 extras 同）

// ---------- 主流程 ----------
function main() {
  const booksData = {};
  for (const b of BOOKS) {
    const p = path.join(EXT_DIR, b + '.json');
    if (!fs.existsSync(p)) { console.error('缺失: ' + p); continue; }
    booksData[b] = JSON.parse(fs.readFileSync(p, 'utf8'));
  }

  // 1. 逐条校验
  const allErrors = [];
  const built = []; // { book, entry(raw), versions: [builtV] }
  for (const [book, data] of Object.entries(booksData)) {
    let vi = 0;
    for (const e of (data.entries || [])) {
      const vs = [];
      for (const rv of (e.versions || [])) {
        vi++;
        const b = buildVersion(book, vi, rv);
        if (!b.ok) {
          allErrors.push({ book, name: e.name, line: rv.line, problems: b.problems.join(' | ') });
        } else {
          b.version.label = labelFor(b.version.type);
          vs.push({ built: b.version, raw: rv, warnings: b.warnings });
        }
      }
      if (vs.length) built.push({ book, entry: e, versions: vs });
    }
  }
  console.log('== 校验: 构建条目 ' + built.length + '，失败 version ' + allErrors.length + ' 个');
  if (allErrors.length) {
    fs.writeFileSync(path.join(EXT_DIR, 'fix-list.json'), JSON.stringify(allErrors, null, 2), 'utf8');
    console.log('  → 修正清单: extraction/fix-list.json');
  }

  // 2. 跨册合并（按反应代表键）
  const groups = new Map();
  for (const it of built) {
    const key = reactionKey(it) || ('_id_' + it.entry.name + '_' + it.book);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(it);
  }

  const merged = [];
  const stats = [];
  for (const group of groups.values()) {
    // name 取最通用（最短的非空名称）
    const names = group.map(g => g.entry.name).filter(Boolean);
    const name = names.sort((a, b) => a.length - b.length)[0] || names[0] || '（未命名反应）';
    const books = [...new Set(group.map(g => g.book))];
    // 仅同册内的同名/同反应合并去重需谨慎：跨册合并才合并标签；同册不同 entry 的同反应（如化学式与离子式分开收录）也合并
    // textbooks 并集
    const textbooks = [];
    for (const g of group) {
      for (const t of (g.entry.textbooks || [])) {
        const ex = textbooks.find(x => x.book === g.book && x.chapter === t.chapter && x.section === t.section && x.context === t.context);
        if (!ex) textbooks.push({ version: '人教版', book: g.book, chapter: t.chapter, section: t.section, context: t.context });
      }
    }
    // 分类并集
    const union = (field) => [...new Set(group.flatMap(g => g.entry[field] || []))];
    // description 取非空最长
    const descs = group.map(g => g.entry.description).filter(d => d && d.trim());
    const description = descs.sort((a, b) => b.length - a.length)[0] || '';
    // difficulty 取更高
    const dOrder = { '简单': 0, '中等': 1, '较难': 2 };
    const difficulty = group.map(g => g.entry.difficulty).filter(Boolean).sort((a, b) => (dOrder[b] || 0) - (dOrder[a] || 0))[0] || '中等';
    const difficultyReason = group.map(g => g.entry.difficultyReason).filter(Boolean)[0] || '';
    // versions 按 type+集合判重合并（保留信息最全的）
    const vMap = new Map();
    for (const g of group) {
      for (const v of g.versions) {
        const k = versionKey(v.built);
        if (!vMap.has(k)) vMap.set(k, v);
      }
    }
    const versions = [...vMap.values()];
    // tags 并集 + 跨册高频
    const tags = union('tags');
    if (books.length >= 2 && !tags.includes('高频')) tags.push('高频');
    merged.push({
      name, description, difficulty, difficultyReason,
      textbooks, versions,
      substanceCategories: union('substanceCategories'),
      reactionTypes: union('reactionTypes'),
      knowledgeModules: union('knowledgeModules'),
      tags,
      source: [...new Set(group.map(g => g.entry.source || ''))].join(';'),
      remark: '教材提取：' + books.join('、') + (textbooks.length > 1 ? '（共' + textbooks.length + '处）' : '')
    });
    stats.push({ name, books, versions: versions.map(v => v.built.type) });
  }

  console.log('== 合并: ' + built.length + ' 条 → ' + merged.length + ' 个反应（跨册组 ' + [...groups.values()].filter(g => new Set(g.map(x => x.book)).size >= 2).length + ' 组）');

  fs.writeFileSync(path.join(EXT_DIR, 'merged-entries.json'), JSON.stringify(merged, null, 2), 'utf8');
  // 统计
  const byBook = {};
  for (const s of stats) for (const b of s.books) byBook[b] = (byBook[b] || 0) + 1;
  const byType = {};
  for (const m of merged) for (const v of m.versions) byType[v.built.type] = (byType[v.built.type] || 0) + 1;
  console.log('== 各册反应数: ' + JSON.stringify(byBook));
  console.log('== 版本类型分布: ' + JSON.stringify(byType));
  const multi = merged.filter(m => m.tags.includes('高频')).length;
  console.log('== 跨册高频: ' + multi + ' 个');
  console.log('输出: extraction/merged-entries.json');
}

function labelFor(type) {
  const map = {
    chemical: '化学方程式', ionic: '离子方程式', ionization: '电离方程式',
    hydrolysis: '水解方程式', electrode: '电极反应式', thermochemical: '热化学方程式'
  };
  return map[type] || type;
}

main();
