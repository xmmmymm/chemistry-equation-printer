/*
 * 生成方程式排版验证 HTML：复用应用的真实渲染函数（signZoneHTML / equationHTML / docCSS），
 * 覆盖条件布局三级降级链：上方堆叠 / 下方放置 / 加长符号。
 * 输出 build/eq-check.html 供截图与像素测量。
 */
const path = require('path');
const fs = require('fs');
const C = require('../src/libs/chem.js');
const K = require('../src/libs/constants.js');
const Doc = require('../src/libs/exporter.js');

const lib = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'examples', 'sample-library.json'), 'utf8'));
const byId = {};
lib.entries.forEach(e => { byId[e.id] = e; });

function mkItem(id, versionOverride, questionType, blankStrategy) {
  const e = byId[id];
  const v = versionOverride || e.versions[0];
  return {
    itemId: id + '_' + Math.random().toString(36).slice(2, 6), entryId: e.id,
    versionId: v.id, versionType: v.type, questionType: questionType || 'B',
    blankStrategy,
    snapshot: { entryName: e.name, description: e.description, openPrompt: '', difficulty: e.difficulty, version: v, entryId: e.id }
  };
}
function withConds(id, conds, reversible) {
  const e = byId[id];
  const v = JSON.parse(JSON.stringify(e.versions[0]));
  v.conditions = conds.map(c => ({ code: 'custom', text: c }));
  if (reversible !== undefined) v.reversible = reversible;
  return v;
}

// 合成用例：覆盖用户点名的问题场景
// 1) 催化剂+高温（氨催化氧化）：高温上方、催化剂下方（不堆上方）
// 2) MnO2+△（氯酸钾分解）：△上方、MnO2下方
// 3) 单条复合词"高温高压密闭容器"：拆3词 → 高温上方、下方高压+密闭容器
// 4) 可逆号+催化剂+高温
// 5) 常规单条件（点燃）
const cases = [
  mkItem('R0005', withConds('R0005', ['催化剂', '高温'])),
  mkItem('R0007', withConds('R0007', ['MnO2', '△'])),
  mkItem('R0006', withConds('R0006', ['高温高压密闭容器'], true)),
  mkItem('R0006', withConds('R0006', ['催化剂', '高温'], true)),
  mkItem('R0002', withConds('R0002', ['点燃'])),
  mkItem('R0003', null, 'D', 'blankProducts')
];

const L = K.defaultLayoutSettings();
const docCss = Doc.docCSS(L);
const appCss = `
/* 应用界面（main.css）中的方程式规则副本 */
.eq { font-family: "Times New Roman", "SimSun", serif; white-space: nowrap; }
.eq sub { font-size: .72em; } .eq sup { font-size: .72em; }
.eq-eq { position: relative; display: inline-block; vertical-align: baseline; margin: 0 3px; line-height: 1.1; }
.eq-anchor { position: relative; display: inline-block; }
.eq-sign { display: inline-block; min-width: 2em; text-align: center; line-height: 1.1; letter-spacing: 1px; }
.eq-cond, .eq-cond-below { position: absolute; left: 50%; transform: translateX(-50%); font-size: .7em; line-height: 1.15; white-space: nowrap; overflow: visible; display: flex; flex-direction: column; align-items: center; }
.eq-cond .cl, .eq-cond-below .cl { display: block; line-height: 1.15; }
.eq-cond { bottom: calc(100% - 0.40em); }
.eq-eq.sign-arrow .eq-cond { bottom: calc(100% + 0.02em); }
.eq-cond-below { top: calc(100% - 0.41em); }
.eq-eq.sign-arrow .eq-cond-below { top: calc(100% - 0.05em); }
.approw { font-size: 15px; padding: 12px 6px; border-bottom: 1px dashed #ccc; }
`;

const rows = [];
cases.forEach((item, i) => {
  const r = Doc.renderQuestion(item, i + 1);
  rows.push(`<div class="q">${r.stem}</div>`);
  rows.push(`<div class="q">${r.answer}</div>`);
});

const appRows = cases.slice(0, 5).map((item, i) => {
  const r = Doc.renderQuestion(item, i + 1);
  return `<div class="approw">${r.stem}</div><div class="approw">${r.answer}</div>`;
}).join('\n');

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8">
<style>
${docCss}
body { background: #fff; padding: 28px 24px; }
.page { width: auto; height: auto; padding: 0; position: static; overflow: visible; }
.q { font-size: ${L.font.bodySizePt}pt; line-height: 1.6; margin-bottom: 16pt; }
h3 { border-bottom: 2px solid #333; }
${appCss}
</style></head>
<body>
<h3>卷面（docCSS）—— 题干（—— + 条件）与答案（══/⇌ + 条件）</h3>
<div class="page">
${rows.join('\n')}
</div>
<h3>应用界面（main.css 规则）</h3>
${appRows}
</body></html>`;

const out = path.join(__dirname, '..', 'build', 'eq-check.html');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html, 'utf8');
console.log('written: ' + out);
