/* 化学核心模块单元测试（Node） */
const C = require('../src/libs/chem.js');
const K = require('../src/libs/constants.js');
const Imp = require('../src/libs/importer.js');
const Gen = require('../src/libs/generator.js');

let passed = 0, failed = 0;
function eq(actual, expected, msg) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { passed++; }
  else { failed++; console.error('✗', msg, '\n  期望:', JSON.stringify(expected), '\n  实际:', JSON.stringify(actual)); }
}
function ok(v, msg) {
  if (v) passed++; else { failed++; console.error('✗', msg); }
}

// ---- 化学式解析 ----
eq(C.parseFormula('H2O').composition, { H: 2, O: 1 }, 'H2O 组成');
eq(C.parseFormula('Ca(OH)2').composition, { Ca: 1, O: 2, H: 2 }, 'Ca(OH)2 组成');
eq(C.parseFormula('Fe(NO3)3').composition, { Fe: 1, N: 3, O: 9 }, 'Fe(NO3)3 组成');
eq(C.parseFormula('CuSO4·5H2O').composition, { Cu: 1, S: 1, O: 9, H: 10 }, '结晶水组成');
eq(C.parseFormula('SO4^2-').charge, -2, 'SO4^2- 电荷');
eq(C.parseFormula('Na+').charge, 1, 'Na+ 电荷');
eq(C.parseFormula('NO3-').charge, -1, 'NO3- 电荷（尾部数字为下标）');
ok(C.parseFormula('e-').isElectron, '电子识别');
ok(!C.parseFormula('CO2').organic, 'CO2 无机');
ok(!C.parseFormula('Na2CO3').organic, '碳酸钠无机');
ok(!C.parseFormula('HCO3-').organic, '碳酸氢根无机');
ok(C.parseFormula('CH4').organic, 'CH4 有机警告');
ok(C.parseFormula('C2H5OH').organic, '乙醇有机警告');
ok(!C.parseFormula('Cl-').organic, 'Cl- 不误判');
ok(!C.parseFormula('Xx').ok, '未知元素报错');

// ---- 一行式解析 ----
{
  const r = C.parseEquationLine('2Na + 2H2O = 2NaOH + H2↑');
  ok(r.ok, '钠与水解析');
  eq(r.reactants.map(s => s.formula + s.coefficient), ['Na2', 'H2O2'], '反应物');
  ok(r.products[1].gas, '气体符号');
}
{
  const r = C.parseEquationLine('N2 + 3H2 ⇌ 2NH3');
  ok(r.ok && r.reversible, '可逆反应');
}
{
  const r = C.parseEquationLine('Ca(OH)2 + CO2 = CaCO3↓ + H2O');
  ok(r.ok, 'Ca(OH)2 解析');
  ok(r.products[0].precipitate, '沉淀符号');
}
{
  const r = C.parseEquationLine('Na+ + OH- = NaOH');
  ok(r.ok, '离子电荷与分隔符');
  eq(r.reactants.map(s => s.charge), [1, -1], '离子电荷');
}
{
  const r = C.parseEquationLine('CaCO3 + 2H+ = Ca^2+ + H2O + CO2↑');
  ok(r.ok, '多价离子解析');
  eq(r.products[0].charge, 2, 'Ca^2+ 电荷');
}
ok(!C.parseEquationLine('2H2 + O2').ok, '缺少等号报错');

// ---- 校验 ----
function V(type, line, extra) {
  const p = C.parseEquationLine(line);
  return Object.assign({ type, reversible: p.reversible, conditions: [], reactants: p.reactants, products: p.products }, extra || {});
}
ok(C.validateVersion(V('chemical', '2Na + 2H2O = 2NaOH + H2↑')).ok, '化学方程式守恒');
ok(!C.validateVersion(V('chemical', '2Na + 2H2O = NaOH + H2↑')).ok, '未配平报错');
ok(C.validateVersion(V('chemical', '2Na + 2H2O = NaOH + H2↑')).errors[0].includes('未配平'), '未配平提示具体元素');
ok(C.validateVersion(V('ionic', 'H+ + OH- = H2O')).ok, '离子方程式守恒');
ok(!C.validateVersion(V('ionic', 'H+ + OH- = H2O + H+')).ok, '电荷不守恒报错');
ok(C.validateVersion(V('ionic', 'CaCO3 + 2H+ = Ca^2+ + H2O + CO2↑')).ok, '复杂离子方程式');
ok(C.validateVersion(V('ionization', 'CH3COOH ⇌ CH3COO- + H+')).ok, '醋酸电离');
ok(C.validateVersion(V('hydrolysis', 'HCO3- + H2O ⇌ H2CO3 + OH-')).ok, '水解方程式');
ok(C.validateVersion(V('electrode', 'Zn = Zn^2+ + 2 e-')).ok, '电极反应式');
ok(!C.validateVersion(V('electrode', 'Zn = Zn^2+')).ok, '电极缺电子报错');
ok(C.validateVersion(V('electrode', 'O2 + 2H2O + 4e- = 4OH-')).ok, '正极反应式');
ok(!C.validateVersion(V('thermochemical', '2H2 + O2 = 2H2O')).ok, '热化学缺 ΔH');
ok(C.validateVersion(V('thermochemical', '2H2(g) + O2(g) = 2H2O(l)', { extras: { deltaH: '-571.6 kJ/mol' } })).ok, '热化学完整');
{
  const st = C.validateVersion(V('chemical', 'H2↑ + O2 = 2H2O'));
  ok(!st.ok && st.errors.some(e => e.includes('生成物')), '气体符号标在反应物报错');
}
{
  const bad = C.parseEquationLine('2H2 + O2 = 2H2O');
  bad.products[0].gas = true; bad.products[0].precipitate = true;
  const st = C.validateVersion({ type: 'chemical', reversible: false, conditions: [], reactants: bad.reactants, products: bad.products });
  ok(!st.ok && st.errors.some(e => e.includes('↑ 和 ↓')), '同物同时 ↑↓ 报错');
}

// ---- 分数系数 ----
{
  const st = C.validateVersion({ type: 'chemical', reversible: false, conditions: [], 
    reactants: [{ formula: 'H2', coefficient: 0.5 }], products: [{ formula: 'H2', coefficient: 0.5 }] });
  ok(!st.ok && st.errors.some(e => e.includes('正整数')), '分数系数报错');
}

// ---- 重复检测 ----
{
  const a = V('chemical', '2H2 + O2 = 2H2O');
  const b = V('chemical', 'H2 + O2 = H2O');
  const rev = V('chemical', '2H2O = 2H2 + O2');
  ok(C.versionDupKey(a) === C.versionDupKey(b), '忽略系数算重复');
  ok(C.versionDupKey(a) !== C.versionDupKey(rev), '方向相反不算重复');
}

// ---- 导入校验 ----
{
  const lib = require('../examples/sample-library.json');
  const v = Imp.validateImportData(lib, { entries: [] }, 'sample.json');
  eq(v.errorCount, 0, '示例库无错误');
  eq(v.dupCount, 0, '示例库无重复');
  // 重复导入
  const library = { entries: v.results.map(r => r.entry) };
  const v2 = Imp.validateImportData(lib, library, 'again.json');
  eq(v2.dupCount, lib.entries.length, '重复导入全部检出');
  // 坏数据
  const bad = {
    version: 1,
    entries: [
      { name: '', difficulty: '超难', versions: [] },
      {
        name: '坏方程式', difficulty: '简单',
        versions: [{
          type: 'chemical', reversible: false, conditions: [],
          reactants: [{ formula: 'Na', coefficient: 2 }],
          products: [{ formula: 'NaOH', coefficient: 1 }]
        }]
      },
      {
        name: '分数系数', difficulty: '简单',
        versions: [{
          type: 'chemical', reversible: false, conditions: [],
          reactants: [{ formula: 'H2', coefficient: 0.5 }, { formula: 'O2', coefficient: 1 }],
          products: [{ formula: 'H2O', coefficient: 1 }]
        }]
      }
    ]
  };
  const v3 = Imp.validateImportData(bad, { entries: [] }, 'bad.json');
  ok(v3.errorCount >= 3, '坏数据检出错误');
  ok(v3.results[1].errors.some(e => e.message.includes('未配平')), '导入未配平提示');
  ok(v3.results[2].errors.some(e => e.message.includes('正整数')), '导入分数系数提示');
}

// ---- 章+节复合语义（entryInScope） ----
{
  const mk = (textbooks) => ({ id: 'x', name: 'x', difficulty: '中等', enabled: true, versions: [], textbooks });
  // 条目：{第二章,节X} 与 {第三章,节Y} 两条不同记录（跨记录场景）
  const e = mk([
    { version: '人教版', book: '必修第一册', chapter: '第二章 钠和氯', section: '节X' },
    { version: '人教版', book: '必修第一册', chapter: '第三章 铁', section: '节Y' }
  ]);
  // 1) 复合命中：同一条记录 {第二章, 节X}
  ok(Gen.entryInScope(e, { chapters: ['第二章 钠和氯'], sections: ['节X'] }), '复合语义：同记录命中');
  // 2) 跨记录不误命中：勾「第三章」+「节X」（分属两条记录，无任何一条同时满足）
  ok(!Gen.entryInScope(e, { chapters: ['第三章 铁'], sections: ['节X'] }), '复合语义：跨记录不误命中');
  // 3) 只勾章时旧语义不变：有第三章记录即可命中
  ok(Gen.entryInScope(e, { chapters: ['第三章 铁'] }), '只勾章：独立 some 语义');
  ok(!Gen.entryInScope(e, { chapters: ['第四章'] }), '只勾章：未命中');
  // 4) 只勾节时旧语义不变
  ok(Gen.entryInScope(e, { sections: ['节Y'] }), '只勾节：独立 some 语义');
  // 5) 复合命中后其他维度仍参与过滤（且语义）
  const e2 = mk([{ version: '人教版', book: '必修第一册', chapter: '第二章 钠和氯', section: '节X' }]);
  ok(!Gen.entryInScope(e2, { chapters: ['第二章 钠和氯'], sections: ['节X'], tags: ['高频'] }), '复合命中 + tags 不满足 → 排除');
  // 6) 空筛选器不过滤
  ok(Gen.entryInScope(e, {}), '空筛选器通过');
}

// ---- 册别分组细化语义（entryInScope v2 + refineBooksByScope） ----
// 修复：勾「九上+九下」后再加「必修一+第一章+第一节」时，旧的全局“且”会把九年级两册整体
// 排除（范围越选越少）。新语义：章/节只细化含它的册别，未细化的册整册生效。
{
  const mk = (textbooks) => ({ id: 'x', name: 'x', difficulty: '中等', enabled: true, versions: [], textbooks });
  const jn = mk([
    { version: '人教版', book: '九年级上册', chapter: '第二单元 空气和氧气', section: '课题2 氧气' }
  ]);
  const bx = mk([
    { version: '人教版', book: '必修第一册', chapter: '第一章 物质及其变化', section: '第一节 物质的分类及转化' }
  ]);
  const cross = mk([
    { version: '人教版', book: '九年级上册', chapter: '第五单元', section: '课题1' },
    { version: '人教版', book: '必修第一册', chapter: '第一章 物质及其变化', section: '第一节 物质的分类及转化' }
  ]);
  const lib = { entries: [jn, bx, cross] };
  const A = { books: ['九年级上册', '九年级下册'] };
  const rA = Gen.refineBooksByScope(lib.entries, A);
  eq(Gen.refineBooksByScope(lib.entries, A).size, 0, '未勾章/节：无细化册（整册语义）');
  const nA = lib.entries.filter(x => Gen.entryInScope(x, A, rA)).length;
  eq(nA, 2, '册别范围：九上+九下命中 2 条（jn+cross）');

  const B = { books: ['九年级上册', '九年级下册', '必修第一册'], chapters: ['第一章 物质及其变化'], sections: ['第一节 物质的分类及转化'] };
  const rB = Gen.refineBooksByScope(lib.entries, B);
  eq([...rB].join(), '必修第一册', '细化册判定：仅含勾选章/节的册被细化');
  const inB = lib.entries.filter(x => Gen.entryInScope(x, B, rB));
  eq(inB.length, 3, '册别分组细化：九上/九下整册 ∪ 必修一·第一章·第一节 = 3 条');
  ok(inB.length >= nA, '扩大范围后数量不减（3 ≥ 2）');

  const C = { books: ['必修第一册'], chapters: ['第一章 物质及其变化'], sections: ['第一节 物质的分类及转化'] };
  const rC = Gen.refineBooksByScope(lib.entries, C);
  eq(lib.entries.filter(x => Gen.entryInScope(x, C, rC)).length, 2, '纯细化：必修一·第一章·第一节 = 2 条（bx+cross）');

  const D = { books: ['必修第一册'], chapters: ['第一章 物质及其变化'] };
  const rD = Gen.refineBooksByScope(lib.entries, D);
  eq(lib.entries.filter(x => Gen.entryInScope(x, D, rD)).length, 2, '册+章细化（未勾节）= 2 条');

  // 未勾册别：保持旧跨册语义（复合同记录）
  ok(Gen.entryInScope(jn, { chapters: ['第二单元 空气和氧气'], sections: ['课题2 氧气'] }), '未勾册别：复合同记录命中');
  ok(!Gen.entryInScope(bx, { chapters: ['第二单元 空气和氧气'], sections: ['课题2 氧气'] }), '未勾册别：不命中他册记录');

  // scopedEntries 与 entryInScope+refineBooksByScope 等价
  eq(Gen.scopedEntries(lib, B).length, 3, 'scopedEntries 等价（含细化预计算）');

  // 其他维度仍为跨维度“且”
  const t1 = mk([{ version: '人教版', book: '九年级上册', chapter: '第二单元', section: '课题1' }]);
  t1.tags = ['高频'];
  ok(Gen.entryInScope(t1, { books: ['九年级上册'], tags: ['高频'] }, Gen.refineBooksByScope([t1], { books: ['九年级上册'], tags: ['高频'] })), '册别+tags 且语义命中');
  ok(!Gen.entryInScope(t1, { books: ['九年级上册'], tags: ['易错'] }, Gen.refineBooksByScope([t1], { books: ['九年级上册'], tags: ['易错'] })), '册别+tags 且语义排除');

  // 节单独细化某册（未勾章）：册被节细化 → 按记录命中
  const E = { books: ['必修第一册'], sections: ['第一节 物质的分类及转化'] };
  const rE = Gen.refineBooksByScope(lib.entries, E);
  eq([...rE].join(), '必修第一册', '只勾节也可细化册');
  eq(lib.entries.filter(x => Gen.entryInScope(x, E, rE)).length, 2, '册+节细化（未勾章）= 2 条');
}

// ---- 条件布局：催化剂上置（修复：单独条件不再掉到等号下方） ----
{
  const L = C.conditionLayout(['催化剂']);
  eq(L.above, ['催化剂'], '单一「催化剂」放符号上方');
  eq(L.below, [], '单一「催化剂」下方为空');
  const L2 = C.conditionLayout(['催化剂', '△']);
  eq(L2.above, ['催化剂'], '催化剂+△：催化剂上方');
  eq(L2.below, ['△'], '催化剂+△：△ 下方（教材惯例）');
  const L3 = C.conditionLayout(['△']);
  eq(L3.above, ['△'], '单一「△」在上方');
  const L4 = C.conditionLayout(['高温', '高压', '催化剂']);
  ok(L4.above.length === 1 && L4.below.length === 2, '三条件：上方1词下方2词');
  ok(C.signZoneHTML({ reversible: false, conditions: [{ code: 'custom', text: '催化剂' }] }, null, {}).includes('eq-cond'), '催化剂渲染进上方条件区');
}

// ---- C 类题干清洗：截断教材语境/数据溯源子句 ----
const Doc = require('../src/libs/exporter.js');
eq(Doc.stemText('向硫酸铜溶液中滴加氢氧化钠溶液，生成蓝色的氢氧化铜沉淀和硫酸钠；教材用作溶液中生成沉淀的书写规则示例，也是第一单元认识化学变化的实验。', 'X'),
  '向硫酸铜溶液中滴加氢氧化钠溶液，生成蓝色的氢氧化铜沉淀和硫酸钠', '题干截断教材语境子句');
eq(Doc.stemText('乙醇在氧气中完全燃烧生成二氧化碳和液态水；由23 g（0.5 mol）乙醇放出683.4 kJ换算得燃烧热1366.8 kJ/mol，与附录I数据一致', 'X'),
  '乙醇在氧气中完全燃烧生成二氧化碳和液态水', '题干截断数据溯源子句');
eq(Doc.stemText('', '钠与水反应'), '钠与水反应', '空描述回退条目名');
{
  const item = {
    questionType: 'C',
    snapshot: {
      entryName: '某反应', description: 'A与B反应生成C；教材用作示例。',
      version: { type: 'chemical', reversible: false, conditions: [], reactants: [], products: [] }
    }
  };
  const r = Doc.renderQuestion(item, 1);
  ok(r.stem.includes('写出A与B反应生成C的化学方程式。'), 'C 类题干句式完整');
  ok(!r.stem.includes('；') && !r.stem.includes('。的'), 'C 类题干无冗余子句/病句');
}

// ---- D 类自由勾选挖空（blankSpec：逐物质化学式/系数 + 条件逐词 condIdxs） ----
{
  const v = {
    type: 'chemical', reversible: false, conditions: [{ code: 'custom', text: '催化剂' }, { code: 'heat' }],
    reactants: [{ formula: 'H2', coefficient: 2 }, { formula: 'O2' }],
    products: [{ formula: 'H2O', coefficient: 2 }]
  };
  const item = {
    questionType: 'D', blankStrategy: 'custom',
    blankSpec: {
      blanks: [{ side: 'reactants', idx: 0, part: 'coefficient' }, { side: 'products', idx: 0, part: 'species' }],
      condIdxs: [1] // 只挖「△」（词索引 1），保留「催化剂」
    }
  };
  const o = Doc.dBlankOptions(item, v);
  eq(o.blankCoefSp, [v.reactants[0]], '自由挖空：指定物质系数');
  eq(o.blankSpecies, [v.products[0]], '自由挖空：指定物质化学式');
  eq(o.condBlankIdxs, [1], '自由挖空：条件逐词索引');
  // 渲染：催化剂保留、△ 被挖、符号保持（部分挖空时符号不变空）
  const signHTML = C.signZoneHTML(v, null, o);
  ok(signHTML.includes('催化剂'), '逐词挖空：未勾选的条件词保留');
  ok(!signHTML.includes('△') && !signHTML.includes('＿＿'), '逐词挖空：勾选的条件词隐藏、符号保持正常');
  const left = C.sideHTML(v.reactants, o);
  ok(left.includes('blank-coef') && !left.includes('2H'), '指定系数挖空且其余系数保留');
  const right = C.sideHTML(v.products, o);
  ok(right.includes('blank-species'), '指定化学式挖空');
  // 同物质系数+化学式同挖 → 无系数残留
  const o2 = Doc.dBlankOptions({ questionType: 'D', blankStrategy: 'custom', blankSpec: { blanks: [{ side: 'reactants', idx: 0, part: 'coefficient' }, { side: 'reactants', idx: 0, part: 'species' }], condIdxs: [] } }, v);
  ok(!C.sideHTML(v.reactants, o2).includes('2H'), '同物质系数+化学式同挖无系数残留');
}
// 兼容旧格式 blankSpec（condition:true → 全部条件词挖空）
{
  const v = { conditions: [{ code: 'custom', text: '高温' }, { code: 'heat' }], reactants: [{ formula: 'H2', coefficient: 2 }], products: [{ formula: 'H2O' }] };
  const o = Doc.dBlankOptions({ questionType: 'D', blankStrategy: 'custom', blankSpec: { productIdxs: [0], coefficients: true, condition: true } }, v);
  eq(o.blankSpecies, [v.products[0]], '旧格式：物质挖空');
  ok(o.blankCoefSp.length === 2, '旧格式：全部系数挖空');
  eq(o.condBlankIdxs, [0, 1], '旧格式 condition:true → 全部条件词');
}

// ---- 答案卷题号 + ΔH 显示 ----
{
  const v = {
    type: 'thermochemical', reversible: false, conditions: [],
    reactants: [{ formula: 'H2', coefficient: 2 }, { formula: 'O2' }],
    products: [{ formula: 'H2O', coefficient: 2 }],
    extras: { deltaH: '-571.6 kJ/mol' }
  };
  const item = { questionType: 'B', snapshot: { entryName: '氢气的燃烧', version: v } };
  const r = Doc.renderQuestion(item, 1);
  ok(r.answer.startsWith('1. '), '答案卷带题号');
  ok(r.answer.includes('ΔH = -571.6 kJ/mol'), '热化学方程式答案卷显示 ΔH');
  ok(!r.stem.includes('ΔH'), 'B 类题干（求生成物）不显示 ΔH');
  // 挖空题显示 ΔH
  const d = { questionType: 'D', blankStrategy: 'custom', blankSpec: { blanks: [], condIdxs: [] }, snapshot: { entryName: 'x', version: v } };
  const rd = Doc.renderQuestion(d, 2);
  ok(rd.stem.includes('ΔH = -571.6 kJ/mol'), 'D 类题干显示 ΔH');
  // 逐词条件 + 部分挖空的完整渲染
  const vd = {
    type: 'chemical', reversible: false, conditions: [{ code: 'custom', text: '催化剂' }, { code: 'heat' }],
    reactants: [{ formula: 'H2O2', coefficient: 2 }], products: [{ formula: 'H2O', coefficient: 2 }, { formula: 'O2' }]
  };
  const dd = { questionType: 'D', blankStrategy: 'custom', blankSpec: { blanks: [{ side: 'products', idx: 1, part: 'species' }], condIdxs: [0] }, snapshot: { entryName: 'x', version: vd } };
  ok(Doc.renderQuestion(dd, 3).stem.includes('△'), '逐词挖空渲染：保留 △ 挖走 催化剂');
}

// ---- docx 导出：C 题干清洗 + 自由挖空 + ΔH ----
const Docx = require('../src/libs/docx.js');
{
  const layout = K.defaultLayoutSettings();
  const xmlC = Docx.questionXml({
    questionType: 'C',
    snapshot: {
      entryName: '某反应', description: 'A与B反应生成C；教材用作示例。',
      version: { type: 'chemical', reversible: false, conditions: [], reactants: [{ formula: 'H2' }], products: [{ formula: 'H2O' }] }
    }
  }, 0, 'question', layout);
  ok(!xmlC.includes('教材用作示例'), 'docx：C 题干无教材语境子句');
  ok(xmlC.includes('写出A与B反应生成C的化学方程式'), 'docx：C 题干句式完整');
  const v = {
    type: 'chemical', reversible: false, conditions: [{ code: 'custom', text: '催化剂' }],
    reactants: [{ formula: 'H2', coefficient: 2 }, { formula: 'O2' }],
    products: [{ formula: 'H2O', coefficient: 2 }]
  };
  const xmlD = Docx.questionXml({
    questionType: 'D', blankStrategy: 'custom',
    blankSpec: { blanks: [{ side: 'reactants', idx: 0, part: 'coefficient' }, { side: 'products', idx: 0, part: 'species' }] },
    snapshot: { entryName: 'x', version: v }
  }, 0, 'question', layout);
  ok(xmlD.includes('____'), 'docx：自由挖空渲染横线');
  ok(xmlD.includes('催化剂'), 'docx：催化剂条件保留（含于上方布局链）');
  const tbl = Docx.eqTableXml(null, v, { blankCoefSp: [v.reactants[0]] }, null, true);
  ok(tbl.includes('____'), 'docx：指定系数挖空');
  // docx：ΔH（挖空题显示；B 题干不显示）
  const vT = {
    type: 'thermochemical', reversible: false, conditions: [],
    reactants: [{ formula: 'H2', coefficient: 2 }, { formula: 'O2' }],
    products: [{ formula: 'H2O', coefficient: 2 }], extras: { deltaH: '-571.6 kJ/mol' }
  };
  const snapT = { entryName: '氢气的燃烧', version: vT };
  const xmlD_T = Docx.questionXml({ questionType: 'D', blankStrategy: 'custom', blankSpec: { blanks: [], condIdxs: [] }, snapshot: snapT }, 0, 'question', layout);
  ok(xmlD_T.includes('ΔH = -571.6 kJ/mol'), 'docx：D 类题干显示 ΔH');
  const xmlB_T = Docx.questionXml({ questionType: 'B', snapshot: snapT }, 0, 'question', layout);
  ok(!xmlB_T.includes('ΔH'), 'docx：B 类题干不显示 ΔH');
  const xmlA_T = Docx.questionXml({ questionType: 'B', snapshot: snapT }, 0, 'answer', layout);
  ok(xmlA_T.includes('ΔH = -571.6 kJ/mol'), 'docx：答案卷显示 ΔH');
  // docx：条件逐词挖空
  const vC = {
    type: 'chemical', reversible: false, conditions: [{ code: 'custom', text: '催化剂' }, { code: 'heat' }],
    reactants: [{ formula: 'H2O2', coefficient: 2 }], products: [{ formula: 'H2O', coefficient: 2 }, { formula: 'O2' }]
  };
  const xmlD_C = Docx.questionXml({ questionType: 'D', blankStrategy: 'custom', blankSpec: { blanks: [{ side: 'products', idx: 1, part: 'species' }], condIdxs: [0] }, snapshot: { entryName: 'x', version: vC } }, 0, 'question', layout);
  ok(!xmlD_C.includes('催化剂') && xmlD_C.includes('△'), 'docx：条件逐词挖空（催化剂挖走、△保留）');
}

// ---- 组卷 ----
{
  const lib = require('../examples/sample-library.json');
  const v = Imp.validateImportData(lib, { entries: [] }, 's.json');
  const library = { entries: v.results.map(r => r.entry) };
  const s = K.defaultGenerationSettings();
  s.totalCount = 6;
  s.questionTypeCounts = { B: 2, C: 2, D: 2, E: 0, H: 0 };
  const res = Gen.generate(library, s);
  ok(res.ok, '组卷成功: ' + (res.message || ''));
  eq(res.items.length, 6, '总题数');
  const types = {}; res.items.forEach(i => types[i.questionType] = (types[i.questionType] || 0) + 1);
  eq(Object.entries(types).sort().map(([k, v]) => k + v).join(','), 'B2,C2,D2', '题型数量');
  // 同一条目不重复
  const ids = res.items.map(i => i.entryId);
  eq(new Set(ids).size, ids.length, '条目不重复');
  // C 类必有描述
  ok(res.items.filter(i => i.questionType === 'C').every(i => i.snapshot.description), 'C 类有描述');
  // 不足
  const s2 = K.defaultGenerationSettings();
  s2.totalCount = 999;
  const res2 = Gen.generate(library, s2);
  ok(!res2.ok && res2.reason === 'shortage', '题目不足返回 shortage');
  // 题型超总题数
  const s3 = K.defaultGenerationSettings();
  s3.totalCount = 3; s3.questionTypeCounts = { B: 5, C: 0, D: 0, E: 0, H: 0 };
  const res3 = Gen.generate(library, s3);
  ok(!res3.ok && res3.reason === 'typeOverflow', '题型超总题数报错');
}

// ---- 有机表示法：双键/三键/聚合 n（选择性必修3 支持） ----
{
  // 双键/三键/单键短横：仅作词法字符，不进元素组成（守恒只看元素计数）
  eq(C.parseFormula('CH2=CH2').composition, { C: 2, H: 4 }, '乙烯组成');
  eq(C.parseFormula('CH≡CH').composition, { C: 2, H: 2 }, '乙炔组成');
  eq(C.parseFormula('CH3CH=CH2').composition, { C: 3, H: 6 }, '丙烯组成');
  eq(C.parseFormula('CH3-CH2-OH').composition, { C: 2, H: 6, O: 1 }, '含短横结构简式组成');
  eq(C.parseFormula('CH3COO-').charge, -1, '醋酸根尾随-仍按电荷处理');
  ok(C.parseFormula('CH2=CH2').organic, '乙烯判有机');
  ok(!C.parseFormula('CO2').organic, 'CO2 仍无机');
  // ≡ 归一化：保留三键身份用于渲染
  eq(C.normalizeText('CH≡CH'), 'CH≡CH', 'normalizeText 不把 ≡ 归一为 =');
  ok(C.formulaHTML('CH≡CH').includes('≡'), 'formulaHTML 渲染三键视觉');
  ok(C.formulaHTML('CH2=CH2').includes('='), 'formulaHTML 渲染双键');
  ok(C.formulaHTML('CH2=CH2').includes('CH<sub>2</sub>=CH<sub>2</sub>'), '双键化学式下标正确');
}
{
  // 主分隔符：优先「两侧均为空格的独立 = / ⇌」，避免乙烯双键被截断
  const r = C.parseEquationLine('CH2=CH2 + Br2 = CH2BrCH2Br');
  ok(r.ok, '乙烯加溴解析');
  eq(r.reactants.map(s => s.formula), ['CH2=CH2', 'Br2'], '乙烯加溴反应物');
  eq(r.products.map(s => s.formula), ['CH2BrCH2Br'], '乙烯加溴生成物');
  const r2 = C.parseEquationLine('CH3CH2OH = CH2=CH2↑ + H2O');
  ok(r2.ok, '乙醇消去（双键在生成物侧）');
  eq(r2.products[0].formula, 'CH2=CH2', '消去生成乙烯');
  ok(r2.products[0].gas, '消去乙烯气体符号');
  const r3 = C.parseEquationLine('CH≡CH + HCl = CH2=CHCl');
  ok(r3.ok, '乙炔加氯化氢');
  eq(r3.reactants.map(s => s.formula), ['CH≡CH', 'HCl'], '乙炔加氯化氢反应物');
  const r4 = C.parseEquationLine('CH2=CH2 + H2O ⇌ CH3CH2OH');
  ok(r4.ok && r4.reversible, '双键与可逆号共存');
  eq(r4.products.map(s => s.formula), ['CH3CH2OH'], '可逆号优先级正确');
  const r5 = C.parseEquationLine('CH3COOH + C2H5OH ⇌ CH3COOC2H5 + H2O');
  ok(r5.ok && r5.reversible, '酯化可逆反应');
  // 编辑器一行式往返（含双键）
  const line = C.editorLine({ reversible: false, reactants: r.reactants, products: r.products });
  eq(line, 'CH2=CH2 + Br2 = CH2BrCH2Br', 'editorLine 双键回写格式');
  const back = C.parseEquationLine(line);
  ok(back.ok && back.reactants[0].formula === 'CH2=CH2', '双键一行式往返一致');
}
{
  // 聚合 n 约定：系数位 'n'/'2n'；链节式 [链节]n 整体一个物质
  const r = C.parseEquationLine('nCH2=CH2 = [CH2-CH2]n');
  ok(r.ok, '乙烯加聚解析');
  eq(r.reactants.map(s => s.coefficient), ['n'], '聚合度 n 系数');
  eq(r.products.map(s => s.formula), ['[CH2-CH2]n'], '链节式整体存储');
  const p = C.parseFormula('[CH2-CH2]n');
  ok(p.ok && p.chainUnit, '链节式 chainUnit 标记');
  eq(p.composition, { C: 2, H: 4 }, '链节式按 1 个链节计组成');
  const r2 = C.parseEquationLine('nHOOC(CH2)4COOH + nHOCH2CH2OH = [CO(CH2)4COOCH2CH2O]n + 2nH2O');
  ok(r2.ok, '己二酸乙二醇缩聚解析');
  eq(r2.products.map(s => s.coefficient), [1, '2n'], '2n 系数识别');
  eq(r2.products[0].formula, '[CO(CH2)4COOCH2CH2O]n', '缩聚链节式存储');
  // 聚合守恒：按每组（n 约掉）比较
  const st = C.validateVersion({ type: 'chemical', reversible: false, conditions: [], reactants: r.reactants, products: r.products });
  ok(st.ok && st.atomBalance, '乙烯加聚每组守恒');
  const st2 = C.validateVersion({ type: 'chemical', reversible: false, conditions: [], reactants: r2.reactants, products: r2.products });
  ok(st2.ok && st2.atomBalance, '缩聚每组守恒（含 2nH2O）');
  // 不严格配平的聚合式：warning 不 error（教材副产物系数可为 n-1/2n-1）
  const r3 = C.parseEquationLine('nCH2=CH2 = [CH2-CH2]n + H2O');
  const st3 = C.validateVersion({ type: 'chemical', reversible: false, conditions: [], reactants: r3.reactants, products: r3.products });
  ok(st3.ok, '不严格配平聚合式不报 error');
  ok(st3.warnings.some(w => w.includes('人工核对')), '不严格配平聚合式给核对 warning');
  // 聚合式渲染
  ok(C.formulaHTML('[CH2-CH2]n').endsWith('<sub>n</sub>'), '链节尾缀 n 渲染为下标');
  const html = C.equationHTML({ type: 'chemical', reversible: false, conditions: [], reactants: r2.reactants, products: r2.products });
  ok(html.includes('COOCH<sub>2</sub>CH<sub>2</sub>'), '聚合式 equationHTML 不炸');
  ok(html.includes(']<sub>n</sub>'), '聚合式 equationHTML 链节下标');
  const coefHtml = C.speciesHTML({ formula: 'H2O', coefficient: '2n' });
  ok(coefHtml.startsWith('2n'), '2n 系数渲染');
  // 聚合式 editorLine 往返
  const line2 = C.editorLine({ reversible: false, reactants: r2.reactants, products: r2.products });
  const back2 = C.parseEquationLine(line2);
  ok(back2.ok, '聚合式 editorLine 往返解析');
  eq(back2.products.map(s => s.coefficient), [1, '2n'], '聚合式往返系数保真');
  eq(C.equationText({ reversible: false, conditions: [], reactants: r.reactants, products: r.products }), 'nCH2=CH2 = [CH2-CH2]n', '聚合式规范化文本');
  // 聚合判定辅助函数
  ok(C.isChainUnitFormula('[CH2-CH2]n'), 'isChainUnitFormula 识别链节式');
  ok(!C.isChainUnitFormula('CH2=CH2'), 'isChainUnitFormula 不误判双键式');
  ok(C.isPolymerCoef('n') && C.isPolymerCoef('2n') && !C.isPolymerCoef(2) && !C.isPolymerCoef('x'), 'isPolymerCoef 判定');
  // 教材副产物规则系数：n-1 / 2n-1（单一单体缩聚 (n-1)H2O、两种单体缩聚 (2n-1)H2O）
  ok(C.isPolymerCoef('(n-1)') && C.isPolymerCoef('2n-1') && C.isPolymerCoef('n - 1') && !C.isPolymerCoef('n-x'), 'isPolymerCoef 支持教材规则形式');
  {
    const r = C.parseEquationLine('nHO(CH2)5COOH = [O(CH2)5CO]n + (n-1)H2O');
    ok(r.ok, '教材规则式解析（带括号）');
    eq(r.products.map(s => s.coefficient), [1, '(n-1)'], 'n-1 系数识别并规范化为带括号');
    const r2 = C.parseEquationLine('nHOOCC6H4COOH + nHO(CH2)4OH = [O(CH2)4OCOC6H4CO]n + 2n-1H2O');
    ok(r2.ok, '教材规则式解析（不带括号 2n-1）');
    eq(r2.products.map(s => s.coefficient), [1, '(2n-1)'], '2n-1 裸写法规范化为 (2n-1)');
    // 教材规则式：链节省略端基 → 按组恰差一分子 H2O → 专属提示（非 error）
    const st = C.validateVersion({ type: 'chemical', reversible: false, conditions: [], reactants: r.reactants, products: r.products });
    ok(st.ok, '教材规则缩聚式无 error');
    ok(!st.atomBalance, '教材规则式按组比较不严格守恒（端基差）');
    ok(st.warnings.some(w => w.includes('教材端基约定')), '教材规则式给端基约定专属提示');
    const st2 = C.validateVersion({ type: 'chemical', reversible: false, conditions: [], reactants: r2.reactants, products: r2.products });
    ok(st2.ok && st2.warnings.some(w => w.includes('教材端基约定')), '两单体教材规则式同样识别端基约定');
    // 渲染与往返
    ok(C.speciesHTML({ formula: 'H2O', coefficient: '(2n-1)' }).startsWith('(2n-1)'), '教材规则系数渲染');
    const line = C.editorLine({ reversible: false, conditions: [], reactants: r2.reactants, products: r2.products });
    const back = C.parseEquationLine(line);
    ok(back.ok && back.products[1].coefficient === '(2n-1)', '教材规则式 editorLine 往返保真');
    ok(C.equationText({ reversible: false, conditions: [], reactants: r.reactants, products: r.products }).includes('(n-1)H2O'), '规范化文本含 (n-1)H2O');
    // 严格式（nH2O / 2nH2O）与教材式共存：严格式仍严格守恒、无端基提示
    const r3 = C.parseEquationLine('nHOOC(CH2)4COOH + nHOCH2CH2OH = [CO(CH2)4COOCH2CH2O]n + 2nH2O');
    const st3 = C.validateVersion({ type: 'chemical', reversible: false, conditions: [], reactants: r3.reactants, products: r3.products });
    ok(st3.ok && st3.atomBalance && !st3.warnings.some(w => w.includes('端基')), '严格 2n 式仍严格守恒、无端基提示');
  }
  // 圆括号链节式（淀粉/纤维素）与分支式不误判
  ok(C.parseFormula('(C6H10O5)n').chainUnit === true, '圆括号链节式 chainUnit');
  ok(C.parseFormula('(CH3)2CHCH2CH3').chainUnit === undefined, '分支式无尾缀 n 不误判');
  const rs = C.parseEquationLine('(C6H10O5)n + nH2O = nC6H12O6');
  ok(rs.ok, '淀粉水解解析');
  ok(C.validateVersion({ type: 'chemical', reversible: false, conditions: [], reactants: rs.reactants, products: rs.products }).atomBalance, '淀粉水解每组守恒');
}
{
  // Zn/Sn 不被误判为聚合度
  const r = C.parseEquationLine('Zn + 2HCl = ZnCl2 + H2↑');
  ok(r.ok, 'Zn 解析不受 n 规则影响');
  eq(r.reactants[0].formula, 'Zn', 'Zn 整体为化学式');
  eq(r.reactants[0].coefficient, 1, 'Zn 系数为 1');
  const r2 = C.parseEquationLine('Sn + 2HCl = SnCl2 + H2↑');
  ok(r2.ok && r2.reactants[0].formula === 'Sn', 'Sn 整体为化学式');
  const r3 = C.parseEquationLine('2Na + 2H2O = 2NaOH + H2↑');
  eq(r3.reactants.map(s => s.coefficient), [2, 2], '旧数字系数不变');
}
{
  // 有机反应校验：提示性文案，配平仍强制（非聚合式）
  const v = C.parseEquationLine('CH3CH2OH + 3O2 = 2CO2 + 3H2O');
  const st = C.validateVersion({ type: 'chemical', reversible: false, conditions: [{ code: 'custom', text: '点燃' }], reactants: v.reactants, products: v.products });
  ok(st.ok && st.atomBalance, '乙醇燃烧守恒通过');
  ok(st.warnings.some(w => w.includes('有机物化学式')), '有机物给提示性核对文案');
  ok(!st.warnings.some(w => w.includes('暂不支持')), '有机警告不再说「暂不支持」');
  const v2 = C.parseEquationLine('CH3CH2OH + O2 = CO2 + H2O');
  const st2 = C.validateVersion({ type: 'chemical', reversible: false, conditions: [], reactants: v2.reactants, products: v2.products });
  ok(!st2.ok && st2.errors.some(e => e.includes('未配平')), '有机未配平仍报错');
}
{
  // 新条件词拆词（℃数带符号整体作一个词，算法不变）
  eq(C.splitConditionWords('NaOH溶液'), ['NaOH溶液'], 'NaOH溶液整体一词');
  eq(C.splitConditionWords('NaOH醇溶液'), ['NaOH醇溶液'], 'NaOH醇溶液整体一词');
  eq(C.splitConditionWords('50℃'), ['50℃'], '50℃ 带符号整体一词');
  eq(C.splitConditionWords('150℃'), ['150℃'], '150℃ 带符号整体一词');
  eq(C.splitConditionWords('煮沸'), ['煮沸'], '煮沸一词');
  eq(C.splitConditionWords('液溴'), ['液溴'], '液溴一词');
  eq(C.splitConditionWords('浓盐酸'), ['浓盐酸'], '浓盐酸一词');
  eq(C.splitConditionWords('FeBr3'), ['FeBr3'], 'FeBr3 一词');
  eq(C.splitConditionWords('Ni'), ['Ni'], 'Ni 一词');
  eq(C.splitConditionWords('水'), ['水'], '水一词');
  eq(C.splitConditionWords('醇'), ['醇'], '醇一词');
  eq(C.splitConditionWords('水浴加热'), ['水浴加热'], '水浴加热整体一词');
  eq(C.splitConditionWords('高温高压密闭容器'), ['高温', '高压', '密闭容器'], '旧复合词拆词不变');
}
{
  // D 类自由挖空：含双键化学式正常渲染
  const v = { type: 'chemical', reversible: false, conditions: [],
    reactants: [{ formula: 'CH2=CH2', coefficient: 1 }, { formula: 'Br2', coefficient: 1 }],
    products: [{ formula: 'CH2BrCH2Br', coefficient: 1 }] };
  const left = C.sideHTML(v.reactants, {});
  ok(left.includes('CH<sub>2</sub>=CH<sub>2</sub>'), '双键化学式 sideHTML 下标正确');
  const o = { blankSpecies: [v.products[0]] };
  ok(C.sideHTML(v.products, o).includes('blank-species'), '双键条目物质挖空渲染');
}
{
  // 导入通道：聚合式与有机条目放行（n 系数不再被「正整数」规则拒绝）
  const data = {
    version: 1, entries: [{
      name: '乙烯的加聚反应', difficulty: '简单', textbooks: [], versions: [{
        type: 'chemical', reversible: false, conditions: [{ code: 'custom', text: '催化剂' }],
        reactants: [{ formula: 'CH2=CH2', coefficient: 'n' }],
        products: [{ formula: '[CH2-CH2]n', coefficient: 1 }]
      }]
    }, {
      name: '乙烯与溴的加成反应', difficulty: '简单', textbooks: [], versions: [{
        type: 'chemical', reversible: false, conditions: [],
        reactants: [{ formula: 'CH2=CH2', coefficient: 1 }, { formula: 'Br2', coefficient: 1 }],
        products: [{ formula: 'CH2BrCH2Br', coefficient: 1 }]
      }]
    }]
  };
  const v = Imp.validateImportData(data, { entries: [] }, 'organic.json');
  eq(v.errorCount, 0, '导入聚合式/加成条目无错误');
}
{
  // 旧库全量回归：453 版本 validateVersion 断言 0 失败（chem.js 改动护栏）
  const lib = require('../data/library.json');
  let vc = 0, fail = 0; const msgs = [];
  for (const e of lib.entries) {
    for (const vv of (e.versions || [])) {
      vc++;
      const st = C.validateVersion(vv);
      if (!st.ok) { fail++; msgs.push(e.id + ': ' + st.errors.join('；')); }
    }
  }
  eq(fail, 0, '旧库 ' + vc + ' 版本全量 validateVersion 0 失败');
  if (msgs.length) console.error(msgs.slice(0, 5).join('\n'));
}
{
  // Unicode 美化文本（剪贴板复制）：下标/上标/条件/可逆/ΔH/结晶水
  const v1 = { type: 'chemical', reversible: false, conditions: [{ code: 'custom', text: '点燃' }],
    reactants: [{ formula: 'H2', coefficient: 2 }, { formula: 'O2', coefficient: 1 }],
    products: [{ formula: 'H2O', coefficient: 2 }] };
  eq(C.equationUnicodeText(v1), '2H₂ + O₂ =点燃= 2H₂O', 'Unicode 条件反应（等号保留）');
  const v1r = { type: 'chemical', reversible: true, conditions: [{ code: 'custom', text: '高温' }],
    reactants: [{ formula: 'N2', coefficient: 1 }, { formula: 'H2', coefficient: 3 }],
    products: [{ formula: 'NH3', coefficient: 2 }] };
  eq(C.equationUnicodeText(v1r), 'N₂ + 3H₂ ⇌高温⇌ 2NH₃', 'Unicode 可逆条件反应（⇌ 保留）');
  ok(!C.equationUnicodeText(v1).includes('→') && !C.equationUnicodeText(v1r).includes('→'), 'Unicode 复制不用箭头');
  const v2 = { type: 'chemical', reversible: true, conditions: [],
    reactants: [{ formula: 'N2', coefficient: 1 }, { formula: 'H2', coefficient: 3 }],
    products: [{ formula: 'NH3', coefficient: 2 }] };
  eq(C.equationUnicodeText(v2), 'N₂ + 3H₂ ⇌ 2NH₃', 'Unicode 可逆反应');
  const v3 = { type: 'ionic', reversible: false, conditions: [],
    reactants: [{ formula: 'SO4^2-', coefficient: 1 }, { formula: 'Ba^2+', coefficient: 1 }],
    products: [{ formula: 'BaSO4', precipitate: true, coefficient: 1 }] };
  eq(C.equationUnicodeText(v3), 'SO₄²⁻ + Ba²⁺ = BaSO₄↓', 'Unicode 离子电荷上标');
  const v4 = { type: 'thermochemical', reversible: false, conditions: [],
    reactants: [{ formula: 'H2', coefficient: 1 }],
    products: [{ formula: 'H2O', state: 'g', coefficient: 1 }], extras: { deltaH: '-241.8 kJ/mol' } };
  eq(C.equationUnicodeText(v4), 'H₂ = H₂O(g)　ΔH = -241.8 kJ/mol', 'Unicode 状态与 ΔH');
  eq(C.formulaUnicode('CuSO4·5H2O'), 'CuSO₄·5H₂O', '结晶水 ·5 保持正常字号');
}

// ---- 学习项目：轮数过滤/优先级/roundShortage/projectScope/手动选题豁免 ----
{
  // mini library：4 个条目，每条 1 个 chemical 版本（B/D/E 恒可出；C/H 需素材）
  const mkLib = () => {
    const lines = [
      ['A', '2H2 + O2 = 2H2O', '中等'],
      ['B', 'Zn + 2HCl = ZnCl2 + H2↑', '简单'],
      ['C', 'CaCO3 + 2HCl = CaCl2 + H2O + CO2↑', '中等'],
      ['D', '2Na + 2H2O = 2NaOH + H2↑', '简单']
    ];
    const entries = lines.map(([name, line, diff], i) => {
      const p = C.parseEquationLine(line);
      return {
        id: 'R' + (1000 + i), name: '反应' + name, difficulty: diff, enabled: true,
        description: '描述' + name, textbooks: [{ version: '人教版', book: '必修第一册', chapter: '第一章', section: '第一节' }],
        versions: [{ id: 'v' + i, type: 'chemical', reversible: p.reversible, conditions: [], reactants: p.reactants, products: p.products }]
      };
    });
    return { entries };
  };
  const lib = mkLib();
  const s = () => {
    const g = K.defaultGenerationSettings();
    g.totalCount = 4;
    g.questionTypeCounts = { B: 0, C: 0, D: 0, E: 0, H: 0 };
    return g;
  };
  const keyOf = (item) => C.versionDupKey(item.snapshot.version) + '#' + item.questionType;
  const countsOf = (items) => {
    const m = {};
    items.forEach(it => { m[keyOf(it)] = (m[keyOf(it)] || 0) + 1; });
    return m;
  };

  // a) 轮数过滤：全部 B 对计数 1、round=1 → 不再出现计数 ≥ 2 的对（B 类槽全被排除 → roundShortage/不足）
  {
    const gen0 = Gen.generate(lib, s());
    ok(gen0.ok, '基线生成成功');
    const counts = countsOf(gen0.items);
    const g2 = s();
    const r2 = Gen.generate(lib, g2, { projectCounts: counts, round: 1 });
    // totalCount=4 范围内只有 4 个 B 对且全部计数 1 > round=1... round=1 时允许计数 ≤ 1 的对
    // 说明：规则是「只出计数 ≤ 轮数 的对」，即不出现计数 ≥ x+1 的对。
    ok(r2.ok, 'round=1 时计数 1 的对仍可出（≤ 轮数）');
    if (r2.ok) {
      const newCounts = countsOf(r2.items);
      ok(Object.values(newCounts).every(v => v >= 1), 'round=1 生成结果非空');
    }
  }
  // a2) 更严格：round=0 时已计 1 次的对不可再出 → 用 B×4 固定题型，4 个 B 对全部已计 → roundShortage
  {
    const sB = s();
    sB.questionTypeCounts = { B: 4, C: 0, D: 0, E: 0, H: 0 }; // 固定 4 个 B 槽 → 4 个 B 对各计 1
    const gen0 = Gen.generate(lib, sB);
    ok(gen0.ok && gen0.items.every(i => i.questionType === 'B'), 'B×4 基线生成成功');
    const counts = countsOf(gen0.items);
    ok(Object.keys(counts).length === 4, '4 个 B 对各计 1 次');
    const r = Gen.generate(lib, sB, { projectCounts: counts, round: 0 });
    ok(!r.ok, 'round=0 且全部 B 对已计 1 次 → 生成失败');
    ok(r.reason === 'roundShortage', '失败原因 = roundShortage（放开限制可出满），实际: ' + r.reason);
    ok(r.availableUnlimited === true, 'roundShortage 附带 availableUnlimited 标记');
  }
  // b) allowOverRound=true → 正常出（允许补充已达标方程式）
  {
    const gen0 = Gen.generate(lib, s());
    const counts = countsOf(gen0.items);
    const r = Gen.generate(lib, s(), { projectCounts: counts, round: 0, allowOverRound: true });
    ok(r.ok && r.items.length === 4, 'allowOverRound=true 正常出满');
  }
  // c) roundShortage 分流：范围内仅 2 对可用且计数均 1、total=2、round=0 → roundShortage（放开可凑够）
  {
    const lib2 = { entries: mkLib().entries.slice(0, 2) };
    const gen0 = Gen.generate(lib2, s()); // totalCount=4 > 2 候选 → shortage（真不足，无计数）
    ok(!gen0.ok && gen0.reason === 'shortage', '无计数时纯候选不足 → shortage');
    const s2 = s(); s2.totalCount = 2;
    s2.questionTypeCounts = { B: 2, C: 0, D: 0, E: 0, H: 0 }; // 固定 B×2 → 基线两次都是 B 对
    const g0 = Gen.generate(lib2, s2);
    ok(g0.ok && g0.items.length === 2 && g0.items.every(i => i.questionType === 'B'), '2 个 B 对凑 2 题成功');
    const counts = countsOf(g0.items);
    ok(Object.keys(counts).length === 2, '两个 B 对各计 1 次');
    const r = Gen.generate(lib2, s2, { projectCounts: counts, round: 0 });
    ok(!r.ok && r.reason === 'roundShortage', '轮数限制导致不足（放开够）→ roundShortage');
    ok(r.availableUnlimited === true, 'roundShortage 附带 availableUnlimited 标记');
  }
  // d) 优先低计数：total=1，候选含计数 0 与计数 1 的对 → 必出计数 0 的
  {
    const lib3 = mkLib();
    const gen0 = Gen.generate(lib3, Object.assign(s(), { totalCount: 2 }));
    const counts = countsOf(gen0.items); // 2 对已计 1
    const g1 = s(); g1.totalCount = 1;
    const r = Gen.generate(lib3, g1, { projectCounts: counts, round: 1 });
    ok(r.ok && r.items.length === 1, 'round=1 可出 1 题');
    // 已计过的两个对不能出现（若被选中其 key 的 counts=1，会与已有键匹配 → 检查选中项的 key 不在已计键中 或 属于未计键）
    const usedKeys = new Set(Object.keys(counts));
    ok(!usedKeys.has(keyOf(r.items[0])), '低计数优先：选出的是计数 0 的对');
  }  // e) projectScope 前置过滤：范围内条目才进候选
  {
    const scope = { books: ['必修第一册'] };
    const scoped = { entries: mkLib().entries.filter(e => e.textbooks[0].book === '必修第一册') };
    ok(scoped.entries.length === 4, 'mini 库全部在范围内');
    const lib4 = mkLib();
    lib4.entries[0].textbooks[0].book = '选择性必修3'; // 1 条移出范围
    const cands = Gen.buildCandidates(lib4, s(), { projectScope: scope });
    ok(cands.length === 3, 'projectScope 过滤：候选 = 范围内 3 条');
    const r = Gen.generate(lib4, Object.assign(s(), { totalCount: 8 }), { projectScope: scope });
    ok(!r.ok && r.reason === 'shortage', '范围外条目不参与生成');
    const rAll = Gen.generate(lib4, Object.assign(s(), { totalCount: 8 }));
    ok(!rAll.ok && rAll.available === 4, '不传 projectScope 时 4 条都在候选（available=' + rAll.available + '）');
  }
  // f) 手动选题不受轮数限制（manualEntryIds 指定计数超限条目仍加入，notices 有提示）
  {
    const lib5 = mkLib();
    const g0 = Gen.generate(lib5, s());
    const counts = countsOf(g0.items);
    // 确保手动条目的 B 对已被计数（g0 未选中 R1000 的 B 对时补计一次）
    const kA = C.versionDupKey(lib5.entries[0].versions[0]) + '#B';
    if (!counts[kA]) counts[kA] = 1;
    const sm = s();
    sm.totalCount = 1;
    sm.questionTypeCounts = { B: 1, C: 0, D: 0, E: 0, H: 0 }; // 手动槽=1 全给 B，随机槽=0
    sm.manualEntryIds = [lib5.entries[0].id]; // 该条目 B 对计数 1 > round=0 超限
    const r = Gen.generate(lib5, sm, { projectCounts: counts, round: 0 });
    ok(r.ok && r.items.length === 1, '手动选题超轮数仍加入');
    ok(r.items[0].entryId === lib5.entries[0].id, '手动指定的条目被选中');
    ok((r.notices || []).some(n => n.includes('已达本轮出题上限')), 'notices 提示超限仍加入');
  }
  // g) 允许重复出题（修复：旧版 poolArr.splice 把已用候选永久移除，重复开关形同虚设）
  {
    const lib6 = { entries: mkLib().entries.slice(0, 2) }; // 2 条目 × 1 版本 = 2 候选
    const g6 = s();
    g6.totalCount = 4;
    g6.allowDuplicateEntry = true;
    const r6 = Gen.generate(lib6, g6);
    ok(r6.ok && r6.items.length === 4, '允许重复出题：2 候选可出满 4 题（实际 ' +
      (r6.ok ? r6.items.length : r6.reason) + '）');
    // 未用候选优先：4 题来自 2 个条目（两题均出现；题序最终会打乱，不按位断言）
    if (r6.ok) {
      const ids = r6.items.map(it => it.entryId);
      ok(new Set(ids).size === 2, '允许重复：4 题覆盖全部 2 个条目（未用候选优先，均有出现）');
    }
    // 对照：不允许重复时同样设置 → shortage
    const g7 = s();
    g7.totalCount = 4;
    const r7 = Gen.generate(lib6, g7);
    ok(!r7.ok && r7.reason === 'shortage', '对照：不允许重复 → 不足');
  }
  // h) 允许重复 + 难度目标：不崩、出满、尽量命中难度（回退池随机不连选同一题）
  {
    const lib8 = mkLib();
    const g8 = s();
    g8.totalCount = 8;
    g8.allowDuplicateEntry = true;
    g8.difficultyMode = 'counts';
    g8.difficultyCounts = { simple: 4, medium: 4, hard: 0 };
    const r8 = Gen.generate(lib8, g8);
    ok(r8.ok && r8.items.length === 8, '允许重复 + 难度目标：出满 8 题');
  }
}

console.log(`\n通过 ${passed} 项，失败 ${failed} 项`);
process.exit(failed ? 1 : 0);
