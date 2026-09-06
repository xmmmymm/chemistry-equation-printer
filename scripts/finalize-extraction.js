/*
 * 最终整合收尾：
 * 1. 化学式写法归一（CH3CH2OH→C2H5OH、CuCO3·Cu(OH)2→Cu2(OH)2CO3、CH3CH3→C2H6）
 * 2. 归一后按「代表版本反应集合」重合并 entry（textbooks/分类/tags 取并集）
 * 3. 重新校验全部条目
 */
const fs = require('fs');
const path = require('path');
const C = require('../src/libs/chem.js');

const ALIAS = {
  'CH3CH2OH': 'C2H5OH',
  'CuCO3·Cu(OH)2': 'Cu2(OH)2CO3',
  'CH3CH3': 'C2H6'
};

const FILES = [
  path.join(__dirname, '..', 'build', 'win-unpacked', 'data', 'library.json'),
  path.join(__dirname, '..', 'data', 'library.json')
];

function normFormula(f) { return ALIAS[f] || f; }

function main() {
  const lib = JSON.parse(fs.readFileSync(FILES[0], 'utf8'));

  // 1. 归一
  let nNorm = 0;
  for (const e of lib.entries) {
    for (const v of e.versions) {
      for (const side of ['reactants', 'products']) {
        for (const sp of v[side]) {
          const nf = normFormula(sp.formula);
          if (nf !== sp.formula) { sp.formula = nf; nNorm++; }
        }
      }
    }
  }
  console.log('写法归一: ' + nNorm + ' 处');

  // 2. 代表键重合并
  const speciesSet = (list) => list.map(sp => sp.formula).sort().join('|');
  const repKey = (e) => {
    const rep = e.versions.find(v => v.type === 'chemical') || e.versions[0];
    return speciesSet(rep.reactants) + '#' + speciesSet(rep.products);
  };
  const groups = new Map();
  for (const e of lib.entries) {
    const k = repKey(e);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e);
  }

  const merged = [];
  for (const group of groups.values()) {
    if (group.length === 1) { merged.push(group[0]); continue; }
    // 多条合并
    const names = group.map(g => g.name).filter(Boolean);
    const name = names.sort((a, b) => a.length - b.length)[0];
    const union = (f) => [...new Set(group.flatMap(g => g[f] || []))];
    // textbooks 按 book+chapter+section 去重
    const textbooks = [];
    for (const g of group) for (const t of (g.textbooks || [])) {
      if (!textbooks.find(x => x.book === t.book && x.chapter === t.chapter && x.section === t.section && x.context === t.context)) textbooks.push(t);
    }
    // versions 按 type+集合 去重（保留第一个）
    const vMap = new Map();
    for (const g of group) for (const v of g.versions) {
      const k = v.type + '#' + speciesSet(v.reactants) + '#' + speciesSet(v.products);
      if (!vMap.has(k)) vMap.set(k, v);
    }
    const versions = [...vMap.values()];
    const descs = group.map(g => g.description).filter(d => d && d.trim());
    const dOrder = { '简单': 0, '中等': 1, '较难': 2 };
    const difficulty = group.map(g => g.difficulty).filter(Boolean).sort((a, b) => (dOrder[b] || 0) - (dOrder[a] || 0))[0] || '中等';
    const books = [...new Set(group.map(g => (g.textbooks || [])[0] && g.textbooks[0].book).filter(Boolean))];
    const tags = union('tags');
    if (new Set(group.flatMap(g => (g.textbooks || []).map(t => t.book))).size >= 2 && !tags.includes('高频')) tags.push('高频');
    merged.push({
      id: group[0].id,
      name, 
      description: descs.sort((a, b) => b.length - a.length)[0] || group[0].description,
      openPrompt: '',
      difficulty, 
      difficultyReason: group.map(g => g.difficultyReason).filter(Boolean)[0] || '',
      starred: group.some(g => g.starred),
      mustInclude: group.some(g => g.mustInclude),
      enabled: true,
      textbooks,
      substanceCategories: union('substanceCategories'),
      reactionTypes: union('reactionTypes'),
      knowledgeModules: union('knowledgeModules'),
      tags,
      remark: '教材提取：' + [...new Set(group.flatMap(g => (g.textbooks || []).map(t => t.book)))].join('、'),
      source: [...new Set(group.map(g => g.source).filter(Boolean))].join(';'),
      versions,
      questionCount: group.reduce((a, g) => a + (g.questionCount || 0), 0),
      lastUsedAt: '',
      createdAt: group[0].createdAt,
      updatedAt: group[0].updatedAt
    });
    console.log('合并: 「' + group.map(g => g.name).join('」+「') + '」 → 「' + name + '」（' + group.flatMap(g => (g.textbooks || []).map(t => t.book)).join(',') + '）');
  }

  console.log('重合并: ' + lib.entries.length + ' → ' + merged.length + ' 条');

  // 3. 全量校验
  let fail = 0;
  for (const e of merged) {
    for (const v of e.versions) {
      const st = C.validateVersion(v);
      if (!st.ok) { fail++; console.log('✗ [' + e.name + '] ' + v.reactants.map(s => s.formula).join('+') + '=' + v.products.map(s => s.formula).join('+') + ' → ' + st.errors.join(';')); }
    }
  }
  console.log('校验: ' + (fail === 0 ? '全部通过' : fail + ' 条失败'));

  const out = JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), entries: merged }, null, 2);
  for (const f of FILES) fs.writeFileSync(f, out, 'utf8');
  console.log('已写入两处 library.json（' + merged.length + ' 条）');
}

main();
