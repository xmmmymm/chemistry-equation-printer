/*
 * 章节树派生（方案B·阶段2）：从清洗后题库派生高中四册「章→节」树，
 * 写入两处 classifications.json 的 chapters 字段（幂等，重跑安全）。
 * 结构：chapters = { "<册名>": [ { "chapter": "...", "sections": ["..."] }, ... ] }
 * 排序：章按「第X章/第X单元」中文数字序（一~十二），节按「第X节」中文数字序。
 * 自检：节名全局唯一（重复则报错停下）。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA_DIRS = [
  path.join(ROOT, 'data'),
  path.join(ROOT, 'build', 'win-unpacked', 'data')
];
const HIGH_BOOKS = ['必修第一册', '必修第二册', '选择性必修1', '选择性必修2', '选择性必修3'];
const COLUMN_RE = /练习与应用|复习与提高|整理与提升|实验活动|探究|思考与讨论/;

const CN = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };
function cnOrder(prefix) {
  // 「一」~「十二」中文数字 → 数值（十=10，十一=11，十二=12）
  const m = /^第([一二三四五六七八九十]+)[章单元节]/.exec(prefix || '');
  if (!m) return 99;
  const s = m[1];
  if (s === '十') return 10;
  if (s.startsWith('十')) return 10 + (CN[s.slice(1)] || 0);
  if (s.endsWith('十')) return (CN[s.slice(0, -1)] || 1) * 10;
  return CN[s] || 99;
}

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch (e) { return fallback; }
}
function writeJsonVerified(p, obj) {
  const txt = JSON.stringify(obj, null, 2);
  fs.writeFileSync(p, txt, 'utf-8');
  const back = JSON.parse(fs.readFileSync(p, 'utf-8'));
  if (JSON.stringify(back) !== JSON.stringify(obj)) throw new Error('写后校验失败: ' + p);
}

function main() {
  const lib = readJson(path.join(DATA_DIRS[0], 'library.json'), null);
  if (!lib) throw new Error('data/library.json 不存在');
  // 残余栏目检查（树必须基于清洗后数据）
  let residual = 0;
  for (const e of lib.entries) for (const t of (e.textbooks || [])) {
    if (HIGH_BOOKS.includes(t.book) && COLUMN_RE.test(t.section || '')) residual++;
  }
  if (residual) { console.error(`✗ 高中栏目型 section 残余 ${residual} 处，请先运行 clean-sections.js`); process.exit(1); }

  // 派生
  const tree = {};
  for (const book of HIGH_BOOKS) tree[book] = [];
  const chapterIdx = {}; // book -> Map(chapter -> Set(sections))
  for (const e of lib.entries) {
    for (const t of (e.textbooks || [])) {
      if (!HIGH_BOOKS.includes(t.book) || !t.chapter || !t.section) continue;
      if (!chapterIdx[t.book]) chapterIdx[t.book] = new Map();
      if (!chapterIdx[t.book].has(t.chapter)) chapterIdx[t.book].set(t.chapter, new Set());
      chapterIdx[t.book].get(t.chapter).add(t.section);
    }
  }
  // 节名全局唯一自检
  const seen = new Map();
  for (const book of HIGH_BOOKS) {
    for (const [ch, secs] of (chapterIdx[book] || new Map())) {
      for (const s of secs) {
        if (seen.has(s)) {
          console.error(`✗ 节名全局不唯一：「${s}」同时出现在 ${seen.get(s)} 与 ${book}·${ch}`);
          process.exit(1);
        }
        seen.set(s, book + '·' + ch);
      }
    }
  }
  // 排序组装
  for (const book of HIGH_BOOKS) {
    const chapters = Array.from((chapterIdx[book] || new Map()).keys());
    chapters.sort((a, b) => cnOrder(a) - cnOrder(b));
    for (const ch of chapters) {
      const secs = Array.from(chapterIdx[book].get(ch));
      secs.sort((a, b) => cnOrder(a) - cnOrder(b));
      tree[book].push({ chapter: ch, sections: secs });
    }
  }

  // 写入两处 classifications.json（保留其他字段，chapters 整体替换）
  let chapterCount = 0, sectionCount = 0;
  for (const book of HIGH_BOOKS) {
    chapterCount += tree[book].length;
    sectionCount += tree[book].reduce((a, c) => a + c.sections.length, 0);
  }
  for (const d of DATA_DIRS) {
    const p = path.join(d, 'classifications.json');
    const cls = readJson(p, {});
    if (!cls.textbookVersions) { // 文件缺失时给最小骨架
      Object.assign(cls, {
        version: 1,
        textbookVersions: ['人教版'],
        books: HIGH_BOOKS.slice(),
        substanceCategories: [], reactionTypes: [], knowledgeModules: [],
        tags: [], conditionPresets: []
      });
    }
    cls.chapters = tree;
    writeJsonVerified(p, cls);
  }
  console.log(`✓ 章节树已写入两处 classifications.json：${HIGH_BOOKS.length} 册 ${chapterCount} 章 ${sectionCount} 节`);
  for (const book of HIGH_BOOKS) {
    console.log(`  ${book}（${tree[book].length} 章）:`);
    for (const c of tree[book]) console.log(`    ${c.chapter}: ${c.sections.join(' | ')}`);
  }
}
main();
