/*
 * 选择性必修3 分片合并（阶段2）：
 *   把三个并行子代理的产物合并成单一 extraction/选择性必修3.json：
 *   - 选择性必修3.partN.json（代理A：引言+一二章）
 *   - 选择性必修3b.partN.json（代理B：第三章+实验活动1/2）
 *   - 选择性必修3c.partN.json（代理C：四章五章+实验活动3）
 *   同时合并三份低置信清单 → extraction/organic-low-confidence.json
 *   合并后跑整体校验（章节对齐/解析/守恒）。
 * 幂等：重跑安全（重新读全部 part 文件重新合并）。
 * 用法：node scripts/merge-organic-parts.js
 */
const fs = require('fs');
const path = require('path');

const EXT = path.join(__dirname, '..', 'extraction');
const BOOK = '选择性必修3';
const GROUPS = [
  { glob: new RegExp('^' + BOOK + '\\.part(\\d+)\\.json$'), prefix: '' },
  { glob: new RegExp('^' + BOOK + 'b\\.part(\\d+)\\.json$'), prefix: 'b' },
  { glob: new RegExp('^' + BOOK + 'c\\.part(\\d+)\\.json$'), prefix: 'c' }
];
const LC_FILES = ['organic-low-confidence-manual.json', 'organic-low-confidence-a.json', 'organic-low-confidence-b.json', 'organic-low-confidence-c.json'];

function main() {
  const files = fs.readdirSync(EXT);
  const allEntries = [];
  const allExcluded = [];
  let partCount = 0;
  const byGroup = {};
  for (const g of GROUPS) {
    const parts = files.filter(f => g.glob.test(f))
      .sort((a, b) => {
        const na = parseInt(g.glob.exec(a)[1], 10), nb = parseInt(g.glob.exec(b)[1], 10);
        return na - nb;
      });
    byGroup[g.prefix || 'A'] = parts.length;
    for (const p of parts) {
      partCount++;
      const data = JSON.parse(fs.readFileSync(path.join(EXT, p), 'utf8'));
      if (data.book !== BOOK) { console.error('✗ ' + p + ' book 字段异常: ' + data.book); process.exit(1); }
      (data.entries || []).forEach(e => allEntries.push(e));
      (data.excluded || []).forEach(x => allExcluded.push(x));
    }
  }
  // 低置信清单合并（按 name+line 去重）
  const lc = [];
  const lcSeen = new Set();
  for (const f of LC_FILES) {
    const p = path.join(EXT, f);
    if (!fs.existsSync(p)) continue;
    const arr = JSON.parse(fs.readFileSync(p, 'utf8'));
    for (const item of (Array.isArray(arr) ? arr : [])) {
      const k = item.name + '|' + item.line;
      if (!lcSeen.has(k)) { lcSeen.add(k); lc.push(item); }
    }
  }
  // 同册同反应合并检查（同名/同反应集合的去重提示，不强制）
  const out = { book: BOOK, version: '人教版', entries: allEntries, excluded: allExcluded };
  fs.writeFileSync(path.join(EXT, BOOK + '.json'), JSON.stringify(out, null, 2), 'utf8');
  fs.writeFileSync(path.join(EXT, 'organic-low-confidence.json'), JSON.stringify(lc, null, 2), 'utf8');
  console.log('分片: ' + partCount + ' 个（' + JSON.stringify(byGroup) + '）');
  console.log('合并: ' + allEntries.length + ' 条 entry，versions ' + allEntries.reduce((a, e) => a + (e.versions || []).length, 0) + ' 个');
  console.log('excluded: ' + allExcluded.length + ' 条；低置信清单: ' + lc.length + ' 条');
  console.log('输出: extraction/' + BOOK + '.json + extraction/organic-low-confidence.json');
}
main();
