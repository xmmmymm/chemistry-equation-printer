/*
 * 导入合并后的教材题库到应用：
 * 1. 读 extraction/merged-entries.json
 * 2. 走 Importer.validateImportData 全量校验（化学式/守恒/重复）
 * 3. 生成最终 library.json，写入便携包与项目 data 目录
 * 4. 同步更新分类体系（加「有机物」「有机化学」标签）
 * 用法：node scripts/import-extraction.js [--dry]
 */
const fs = require('fs');
const path = require('path');
const Importer = require('../src/libs/importer.js');

const EXT = path.join(__dirname, '..', 'extraction');
const PORTABLE_DATA = path.join(__dirname, '..', 'build', 'win-unpacked', 'data');
const DEV_DATA = path.join(__dirname, '..', 'data');

function main() {
  const dry = process.argv.includes('--dry');
  const merged = JSON.parse(fs.readFileSync(path.join(EXT, 'merged-entries.json'), 'utf8'));

  // 组装 import raw 数据
  const rawEntries = merged.map((m, i) => ({
    id: 'R' + String(i + 1).padStart(4, '0'),
    name: m.name,
    description: m.description || '',
    openPrompt: '',
    difficulty: m.difficulty,
    difficultyReason: m.difficultyReason || '',
    starred: false,
    mustInclude: false,
    enabled: true,
    textbooks: (m.textbooks || []).map(t => ({ version: t.version, book: t.book, chapter: t.chapter, section: t.section })),
    substanceCategories: m.substanceCategories || [],
    reactionTypes: m.reactionTypes || [],
    knowledgeModules: m.knowledgeModules || [],
    tags: m.tags || [],
    remark: m.remark || '',
    source: m.source || '',
    versions: (m.versions || []).map((v, vi) => {
      const rv = v.raw || v;
      const built = v.built || v;
      return {
        id: 'R' + String(i + 1).padStart(4, '0') + '-' + (built.type || 'chemical') + (vi > 0 ? String(vi + 1) : ''),
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
  }));

  console.log('组装待导入条目: ' + rawEntries.length + ' 条，versions ' + rawEntries.reduce((a, e) => a + e.versions.length, 0) + ' 个');

  // 全量校验（空题库）
  const validation = Importer.validateImportData(
    { version: 1, entries: rawEntries },
    { version: 1, entries: [] },
    'extraction-merged.json'
  );
  console.log('校验: 错误 ' + validation.errorCount + ' 条 / 警告 ' + validation.warningCount + ' 条 / 重复 ' + validation.dupCount + ' 条');

  // 明细报告
  const lines = [];
  if (validation.errorCount) {
    lines.push('## 校验错误明细');
    for (const r of validation.results) {
      if (r.errors.length) {
        lines.push('### ' + r.entry.name);
        r.errors.forEach(e => lines.push('- ' + e.message));
      }
    }
  }
  const warnLines = [];
  for (const r of validation.results) {
    if (r.warnings && r.warnings.length) warnLines.push('- ' + r.entry.name + ': ' + r.warnings.slice(0, 2).join('; '));
  }
  if (warnLines.length) {
    lines.push('## 警告汇总（前 40）');
    lines.push(...warnLines.slice(0, 40));
  }
  fs.writeFileSync(path.join(EXT, 'import-report.md'), lines.join('\n') || '校验全部通过，无错误无警告。', 'utf8');
  console.log('报告: extraction/import-report.md');

  if (dry) { console.log('--dry：不写入。'); return; }
  if (validation.errorCount) { console.error('存在校验错误，先修复（extraction/fix-list.json）再导入。中止。'); process.exit(1); }

  // 生成最终 library
  const lib = {
    version: 1,
    updatedAt: new Date().toISOString(),
    entries: validation.results.map(r => r.entry)
  };
  const json = JSON.stringify(lib, null, 2);

  // 写入便携包 + 项目目录
  for (const dir of [PORTABLE_DATA, DEV_DATA]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'library.json'), json, 'utf8');
    // 分类体系更新：物质类别加有机物、知识模块加有机化学
    const clsPath = path.join(dir, 'classifications.json');
    if (fs.existsSync(clsPath)) {
      const cls = JSON.parse(fs.readFileSync(clsPath, 'utf8'));
      if (!(cls.substanceCategories || []).includes('有机物')) {
        const i = (cls.substanceCategories || []).indexOf('过氧化物');
        cls.substanceCategories.splice(i >= 0 ? i + 1 : cls.substanceCategories.length - 1, 0, '有机物');
      }
      if (!(cls.knowledgeModules || []).includes('有机化学')) {
        const j = (cls.knowledgeModules || []).indexOf('水溶液中的离子平衡');
        cls.knowledgeModules.splice(j >= 0 ? j + 1 : cls.knowledgeModules.length - 1, 0, '有机化学');
      }
      fs.writeFileSync(clsPath, JSON.stringify(cls, null, 2), 'utf8');
    }
    console.log('已写入: ' + path.join(dir, 'library.json') + '（' + lib.entries.length + ' 条）');
  }
}

main();
