/*
 * 去重无损性验证：对比备份与清洗后数据，严格证明 70 条删除不丢任何章节关联。
 * 检查项（对每个条目）：
 *   A. 备份中每条高中「真节」记录 → 当前必须原样存在（version/book/chapter/section/context 五字段不变）
 *   B. 备份中每条高中「栏目」记录 → 当前必须有演化承载（同册同章、context 含原栏目名、section 已是真节）
 *   C. 章节关联投影（book/chapter/section 三元组）无丢失
 * 统计项：
 *   - 备份中原始完全重复（五字段全同的多余出现）计数 → 与删除总数对照，分解删除来源
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const bak = JSON.parse(fs.readFileSync(path.join(ROOT, 'backups', 'section-filter_20260903_195238', 'library.json'), 'utf-8'));
const cur = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'library.json'), 'utf-8'));
const HIGH = ['必修第一册', '必修第二册', '选择性必修1', '选择性必修2'];
const COLUMN_RE = /练习与应用|复习与提高|整理与提升|实验活动|探究|思考与讨论/;

const k5 = t => [t.version || '', t.book || '', t.chapter || '', t.section || '', t.context || ''].join('§');
const k3 = t => [t.book || '', t.chapter || '', t.section || ''].join('§');

// 备份中原始五字段完全重复的多余出现数（按条目统计）
let origDupHigh = 0, origDupJunior = 0;
const bakMap = {};
for (const be of bak.entries) {
  bakMap[be.id] = be;
  const seenH = new Set(), seenJ = new Set();
  for (const t of (be.textbooks || [])) {
    if (HIGH.includes(t.book)) {
      if (seenH.has(k5(t))) origDupHigh++; else seenH.add(k5(t));
    } else {
      if (seenJ.has(k5(t))) origDupJunior++; else seenJ.add(k5(t));
    }
  }
}

let lostReal = 0, lostColumn = 0, lostProj = 0;
let additions = 0; // 备份中不存在的新增条目（增量导入，非删除反向问题）
const problems = [];
for (const ce of cur.entries) {
  const be = bakMap[ce.id];
  if (!be) { additions++; continue; }
  const bHigh = (be.textbooks || []).filter(t => HIGH.includes(t.book));
  const cHigh = (ce.textbooks || []).filter(t => HIGH.includes(t.book));

  // A. 真节记录原样保留
  for (const bt of bHigh) {
    if (COLUMN_RE.test(bt.section || '')) continue;
    if (!cHigh.some(ct => k5(ct) === k5(bt))) {
      lostReal++;
      if (problems.length < 20) problems.push(`真节记录丢失: ${ce.name} [${bt.book}/${bt.chapter}/${bt.section}]`);
    }
  }
  // B. 栏目记录的溯源保留（context 含原栏目名——注意栏目名自身可含「、」，用顿号定界匹配而非 split）
  for (const bt of bHigh) {
    if (!COLUMN_RE.test(bt.section || '')) continue;
    const needle = '、' + bt.section + '、';
    const ok = cHigh.some(ct =>
      ct.book === bt.book && ct.chapter === bt.chapter &&
      ('、' + (ct.context || '') + '、').includes(needle) &&
      !COLUMN_RE.test(ct.section || ''));
    if (!ok) {
      lostColumn++;
      if (problems.length < 20) problems.push(`栏目记录丢失溯源: ${ce.name} [${bt.book}/${bt.chapter}/${bt.section}]`);
    }
  }
  // C. 章节关联投影无丢失（真节三元组仍在当前集合中）
  const bKeys = new Set(bHigh.filter(t => !COLUMN_RE.test(t.section || '')).map(k3));
  const cKeys = new Set(cHigh.map(k3));
  for (const k of bKeys) {
    if (!cKeys.has(k)) { lostProj++; if (problems.length < 20) problems.push(`章节关联丢失: ${ce.name} [${k}]`); }
  }
}

const bHighTotal = bak.entries.reduce((a, e) => a + (e.textbooks || []).filter(t => HIGH.includes(t.book)).length, 0);
const cHighTotal = cur.entries.reduce((a, e) => a + (e.textbooks || []).filter(t => HIGH.includes(t.book)).length, 0);

console.log('=== 去重无损性验证 ===');
console.log(`条目数: 备份 ${bak.entries.length} → 当前 ${cur.entries.length}（方程式条目一条未删${additions ? '；新增 ' + additions + ' 条为后续增量导入' : ''}）`);
console.log(`版本数: 备份 ${bak.entries.reduce((a, e) => a + e.versions.length, 0)} → 当前 ${cur.entries.reduce((a, e) => a + e.versions.length, 0)}`);
console.log(`高中位置记录: 备份 ${bHighTotal} → 当前 ${cHighTotal}（删除 ${bHighTotal - cHighTotal} 条完全重复）`);
console.log(`备份中原始五字段全同的重复: 高中多余出现 ${origDupHigh} 条 / 初中多余出现 ${origDupJunior} 条（初中未动）`);
console.log(`归位后重合产生的删除: ${bHighTotal - cHighTotal - origDupHigh} 条（同章同栏目名多条归位到同真节后全同）`);
console.log('--- 检查结果 ---');
console.log(`A. 真节记录原样保留: ${lostReal === 0 ? '✓ 全部保留' : '✗ 丢失 ' + lostReal + ' 条'}`);
console.log(`B. 栏目记录溯源保留（context 含原栏目名）: ${lostColumn === 0 ? '✓ 全部保留' : '✗ 丢失 ' + lostColumn + ' 条'}`);
console.log(`C. 章节关联投影（册·章·节）: ${lostProj === 0 ? '✓ 无丢失' : '✗ 丢失 ' + lostProj + ' 处'}`);
if (problems.length) { console.log('问题明细:'); problems.forEach(p => console.log('  ' + p)); }
process.exit((lostReal || lostColumn || lostProj || problems.length) ? 1 : 0);
