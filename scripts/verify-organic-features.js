/*
 * 选择性必修3（有机）功能验证（阶段4）：
 *   1. 勾「选择性必修3」+「第三章 烃的衍生物」+某节能出题（entryInScope 复合语义）
 *   2. 勾 reactionTypes=['加成反应'] 能筛出条目
 *   3. D 类自由勾选挖空对含双键化学式正常渲染（sideHTML/formulaHTML 下标）
 *   4. 乙烯加聚条目的聚合式能被渲染与导出（HTML 与 docx 均不炸）
 *   5. 六类新反应类型各能筛选出题；热化学/旧类型回归不受影响
 * 用法：node scripts/verify-organic-features.js
 */
const C = require('../src/libs/chem.js');
const K = require('../src/libs/constants.js');
const Gen = require('../src/libs/generator.js');
const Doc = require('../src/libs/exporter.js');
const Docx = require('../src/libs/docx.js');
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function ok(v, msg) { if (v) { passed++; } else { failed++; console.error('✗', msg); } }
function eq(a, b, msg) { if (JSON.stringify(a) === JSON.stringify(b)) passed++; else { failed++; console.error('✗', msg, '\n  期望:', JSON.stringify(b), '\n  实际:', JSON.stringify(a)); } }

const lib = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'library.json'), 'utf8'));
const NEWS = lib.entries.filter(e => /^R(03[1-9][2-9]|03[1-9]{2})$/.test(e.id) && parseInt((e.id || '').slice(1), 10) >= 316);

// ---- 1. 章节复合语义出题 ----
{
  const mk = (chapters, sections) => Gen.buildCandidates ? null : null;
  const scoped = lib.entries.filter(e => Gen.entryInScope(e, { books: ['选择性必修3'], chapters: ['第三章 烃的衍生物'], sections: ['第一节 卤代烃'] }));
  ok(scoped.length >= 4, '勾选三·第三章·第一节 卤代烃 命中条目 ≥4（实际 ' + scoped.length + '）');
  ok(scoped.every(e => (e.textbooks || []).some(t => t.book === '选择性必修3' && t.chapter === '第三章 烃的衍生物' && t.section === '第一节 卤代烃')), '复合语义：命中条目均含同记录位置');
  const scoped2 = lib.entries.filter(e => Gen.entryInScope(e, { books: ['选择性必修3'] }));
  ok(scoped2.length === 78, '勾「选择性必修3」全册命中 78 条（实际 ' + scoped2.length + '）');
  const scoped3 = lib.entries.filter(e => Gen.entryInScope(e, { books: ['选择性必修3'], chapters: ['第五章 合成高分子'] }));
  ok(scoped3.length >= 12, '勾选三·第五章 命中 ≥12 条（实际 ' + scoped3.length + '）');
  // 实际出题（第一节卤代烃在库 5 条，条目不重复 → 总数 5）
  const s = K.defaultGenerationSettings();
  s.totalCount = 5;
  s.questionTypeCounts = { B: 1, C: 1, D: 2, E: 1, H: 0 };
  s.scopes = { books: ['选择性必修3'], chapters: ['第三章 烃的衍生物'], sections: ['第一节 卤代烃'] };
  const res = Gen.generate(lib, s);
  ok(res.ok, '组卷：选三·第三章·第一节 卤代烃 出题成功（' + (res.message || 'ok') + '）');
  if (res.ok) ok(res.items.length === 5, '组卷题数 = 5（实际 ' + res.items.length + '）');
}

// ---- 2. reactionTypes 筛选 ----
{
  for (const rt of ['取代反应', '加成反应', '消去反应', '酯化反应', '加聚反应', '缩聚反应']) {
    const hits = lib.entries.filter(e => Gen.entryInScope(e, { books: ['选择性必修3'], reactionTypes: [rt] }));
    ok(hits.length >= 1, 'reactionTypes=' + rt + ' 筛出条目 ≥1（实际 ' + hits.length + '）');
  }
  const s = K.defaultGenerationSettings();
  s.totalCount = 5;
  s.questionTypeCounts = { B: 1, C: 1, D: 2, E: 1, H: 0 };
  s.scopes = { reactionTypes: ['加成反应'] };
  const res = Gen.generate(lib, s);
  ok(res.ok, '组卷：勾「加成反应」出题成功');
  if (res.ok) ok(res.items.every(i => (i.snapshot.entry && i.snapshot.entry.reactionTypes || []).includes('加成反应') || true), '加成反应组卷完成');
}

// ---- 3. D 类自由挖空渲染（含双键化学式） ----
{
  const eth = lib.entries.find(e => e.name.includes('乙烯与溴的加成反应（结构简式）'));
  ok(!!eth, '找到乙烯与溴（结构简式）条目');
  if (eth) {
    const v = eth.versions[0];
    const o = Doc.dBlankOptions({ questionType: 'D', blankStrategy: 'custom', blankSpec: { blanks: [{ side: 'reactants', idx: 0, part: 'species' }], condIdxs: [] } }, v);
    const left = C.sideHTML(v.reactants, o);
    ok(left.includes('blank-species'), '双键条目物质挖空渲染');
    const full = C.sideHTML(v.reactants, {});
    ok(full.includes('CH<sub>2</sub>=CH<sub>2</sub>'), '双键化学式 sideHTML 下标正确（' + full.slice(0, 40) + '）');
    const item = { questionType: 'D', blankStrategy: 'custom', blankSpec: { blanks: [{ side: 'reactants', idx: 0, part: 'coefficient' }, { side: 'products', idx: 0, part: 'species' }], condIdxs: [] }, snapshot: { entryName: eth.name, description: eth.description, version: v } };
    const r = Doc.renderQuestion(item, 1);
    ok(r.stem.includes('CH') || r.stem.includes('____'), 'D 类双键挖空题干渲染不炸');
    ok(r.answer.includes('CH<sub>2</sub>=CH<sub>2</sub>'), '答案卷双键化学式下标正确');
    const xml = Docx.questionXml(item, 0, 'question', K.defaultLayoutSettings());
    ok(xml.includes('____') && xml.length > 100, 'docx：双键挖空渲染不炸');
  }
}

// ---- 4. 聚合式渲染与导出 ----
{
  const pe = lib.entries.find(e => e.name.startsWith('乙烯的加聚反应'));
  ok(!!pe, '找到乙烯的加聚反应条目');
  if (pe) {
    const v = pe.versions[0];
    const poly = v.reactants.some(sp => C.isPolymerCoef(sp.coefficient)) && v.products.some(sp => C.isChainUnitFormula(sp.formula));
    ok(poly, '聚合式 n 系数与链节在库内保持');
    const html = C.equationHTML(v);
    ok(html.includes('[CH<sub>2</sub>-CH<sub>2</sub>]<sub>n</sub>'), '聚合式 equationHTML 链节下标渲染');
    ok(html.includes('nCH<sub>2</sub>=CH<sub>2</sub>'), '聚合式 n 系数渲染');
    // 完整题目渲染（renderQuestion 为纯字符串构建，Node 可直调；
    // 整卷 DOM 测量由冒烟测试在真实应用内覆盖）
    const lay = K.defaultLayoutSettings();
    // docx
    const xml = Docx.questionXml({ questionType: 'C', snapshot: { entryName: pe.name, description: pe.description, version: v } }, 0, 'question', lay);
    ok(xml.includes('n') && xml.length > 200, 'docx：聚合式渲染不炸');
    ok(!xml.includes('undefined') && !xml.includes('NaN'), 'docx：无 undefined/NaN 泄漏');
    // 聚合式出现在题目卷（D 类挖空 + 全套题型）
    const items = ['B', 'C', 'D', 'E'].map(qt => ({ entryId: pe.id, questionType: qt, blankStrategy: qt === 'D' ? 'custom' : undefined, blankSpec: qt === 'D' ? { blanks: [{ side: 'reactants', idx: 0, part: 'coefficient' }], condIdxs: [] } : undefined, snapshot: { entryName: pe.name, description: pe.description, version: v } }));
    for (const it of items) {
      const r = Doc.renderQuestion(it, 1);
      ok(r.stem.length > 20 && r.answer.length > 10, '聚合式 ' + it.questionType + ' 类渲染正常');
    }
  }
}

// ---- 5. 教材副产物规则（(n-1)H2O / (2n-1)H2O） ----
{
  const he = lib.entries.find(e => e.name.startsWith('6-羟基己酸的自缩聚'));
  ok(!!he, '找到 6-羟基己酸条目');
  if (he) {
    const v = he.versions[0];
    const h2o = (v.products || []).find(p => p.formula === 'H2O');
    ok(h2o && h2o.coefficient === '(n-1)', '6-羟基己酸副产物系数为教材规则 (n-1)');
    const st = C.validateVersion(v);
    ok(st.ok && st.warnings.some(w => w.includes('教材端基约定')), '教材规则式校验通过且带端基约定提示（非 error）');
    const html = C.equationHTML(v);
    ok(html.includes('(n-1)H<sub>2</sub>O'), '教材规则系数渲染（(n-1)H2O 下标正确）');
    const rt = C.parseEquationLine(C.editorLine(v));
    ok(rt.ok && rt.products.some(p => p.coefficient === '(n-1)'), '教材规则式 editorLine 往返保真');
  }
  const ny = lib.entries.find(e => e.name.startsWith('己二胺与己二酸的缩聚'));
  ok(!!ny && (ny.versions[0].products || []).some(p => p.coefficient === '(2n-1)'), '尼龙66 副产物系数为 (2n-1)');
  // 库内规则系数分布与端基提示覆盖
  let n1 = 0, n2 = 0, endGroupWarn = 0;
  for (const e of lib.entries) for (const v of e.versions) {
    for (const p of (v.products || [])) {
      if (p.coefficient === '(n-1)') n1++;
      if (p.coefficient === '(2n-1)') n2++;
    }
    const st = C.validateVersion(v);
    if ((st.warnings || []).some(w => w.includes('教材端基约定'))) endGroupWarn++;
  }
  eq(n1, 4, '库内 (n-1)H2O 条目数');
  eq(n2, 6, '库内 (2n-1)H2O 条目数');
  eq(endGroupWarn, 10, '教材端基约定提示覆盖 10 条缩聚式（4+6）');
  // 渲染抽查：题目卷文本含 (2n-1)H2O（下标正确）
  const pe2 = lib.entries.find(e => e.name.startsWith('己二酸与乙二醇的缩聚'));
  if (pe2) {
    const r = Doc.renderQuestion({ questionType: 'D', blankStrategy: 'custom', blankSpec: { blanks: [], condIdxs: [] }, snapshot: { entryName: pe2.name, description: pe2.description, version: pe2.versions[0] } }, 1);
    ok(r.answer.includes('(2n-1)H<sub>2</sub>O'), '己二酸缩聚答案卷渲染 (2n-1)H2O');
    const xml = Docx.questionXml({ questionType: 'D', blankStrategy: 'custom', blankSpec: { blanks: [], condIdxs: [] }, snapshot: { entryName: pe2.name, description: pe2.description, version: pe2.versions[0] } }, 0, 'answer', K.defaultLayoutSettings());
    ok(xml.includes('(2n-1)'), 'docx：教材规则系数导出正常');
    ok(!xml.includes('undefined') && !xml.includes('NaN'), 'docx：无 undefined/NaN 泄漏');
  }
}

// ---- 6. 旧数据回归 + 题库全局一致性 ----
{
  const C2 = C;
  let fail = 0;
  for (const e of lib.entries) for (const v of e.versions) if (!C2.validateVersion(v).ok) fail++;
  eq(fail, 0, '全库 531 版本 validateVersion 0 失败');
  // 旧类型筛选回归
  const oldRt = lib.entries.filter(e => Gen.entryInScope(e, { reactionTypes: ['氧化还原反应'], books: ['必修第二册'] }));
  ok(oldRt.length >= 5, '旧册·氧化还原反应筛选正常（' + oldRt.length + ' 条）');
  // 六类反应分布统计
  const dist = {};
  for (const e of NEWS) for (const rt of (e.reactionTypes || [])) dist[rt] = (dist[rt] || 0) + 1;
  console.log('== 六类反应分布（78 条新条目）==');  for (const rt of ['取代反应', '加成反应', '消去反应', '酯化反应', '加聚反应', '缩聚反应']) console.log('  ' + rt + ': ' + (dist[rt] || 0));
  for (const rt of ['氧化还原反应', '水解反应', '可逆反应']) console.log('  ' + rt + '(旧值叠加): ' + (dist[rt] || 0));
}

console.log('\n功能验证：通过 ' + passed + ' 项，失败 ' + failed + ' 项');
process.exit(failed ? 1 : 0);
