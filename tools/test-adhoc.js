#!/usr/bin/env node
/*
 * ad-hoc（题库外临时插入的方程式）集成测试。
 *
 * 覆盖：
 *   ① 默认（enforceScope=false）：临时题被钉进必出 → **确实出现在卷面上**
 *   ② 每题题型生效（B / E / C）
 *   ③ enforceScope=true：临时题与库内条目同等受范围约束，范围外被剔除并如实报告
 *   ④ 非法临时题 → ADHOC_INVALID 硬拦截（不进导出）
 *   ⑤ 零副作用：不写 data/library.json、数据锁 sha256 不变、快照条目数不被虚增
 *   ⑥ 版本策略与临时题版本类型的关系（chemicalOnly + 纯离子临时题 → 明确报错）
 *
 * 用法：node tools/test-adhoc.js      退出码 0 = 全部通过
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SKILL_ROOT = path.resolve(__dirname, '..');
const G = require(path.join(SKILL_ROOT, 'engine', 'generator.js'));
const Preflight = require(path.join(SKILL_ROOT, 'tools', 'preflight.js'));
const AdHoc = require(path.join(SKILL_ROOT, 'tools', 'adhoc.js'));

const LIB_PATH = path.join(SKILL_ROOT, 'data', 'library.json');
const sha256File = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

let pass = 0, fail = 0;
const lines = [];
function check(name, cond, extra) {
  if (cond) { pass++; lines.push(`  ✓ ${name}`); }
  else { fail++; lines.push(`  ✗ ${name}${extra ? '\n      ← ' + extra : ''}`); }
}

// ---------------------------------------------------------------
// 测试用临时题
// ---------------------------------------------------------------

const ADHOC_IONIC = {
  name: '高锰酸钾与过氧化氢（酸性）',
  difficulty: '中等',
  questionType: 'B',
  description: '向酸性高锰酸钾溶液中滴加过氧化氢，紫色褪去并放出能使带火星木条复燃的气体。',
  tags: ['临时补充'],
  versions: [{
    type: 'ionic',
    reactants: [
      { formula: 'MnO4^-', coefficient: 2 },
      { formula: 'H2O2', coefficient: 5 },
      { formula: 'H+', coefficient: 6 }
    ],
    products: [
      { formula: 'Mn^2+', coefficient: 2 },
      { formula: 'O2', coefficient: 5 },
      { formula: 'H2O', coefficient: 8 }
    ]
  }]
};

const ADHOC_CHEM = {
  name: '铝热反应',
  difficulty: '较难',
  questionType: 'E',
  versions: [{
    type: 'chemical',
    reactants: [{ formula: 'Al', coefficient: 2 }, { formula: 'Fe2O3', coefficient: 1 }],
    products: [{ formula: 'Al2O3', coefficient: 1 }, { formula: 'Fe', coefficient: 2 }],
    conditions: [{ code: 'highTemperature', text: '高温' }]
  }]
};

const ADHOC_BAD = {
  name: '配平写错了',
  versions: [{
    type: 'chemical',
    reactants: [{ formula: 'H2', coefficient: 2 }, { formula: 'O2', coefficient: 1 }],
    products: [{ formula: 'H2O', coefficient: 1 }]   // 应为 2H2O
  }]
};

/** 跑一次「预检 + 组卷」，返回 {pf, settings, mergedLib, gen} */
function run(job) {
  const pf = Preflight.preflight(job, {});
  const settings = Preflight.buildSettings(pf.job);
  const mergedLib = pf.__mergedLibrary;
  const gen = G.generate(mergedLib, settings, {});
  return { pf, settings, mergedLib, gen };
}

/** 与 app/main.js 同序：先合并 ad-hoc，再预检 + 组卷 */
function runWithAdHoc(job) {
  const lib = JSON.parse(fs.readFileSync(LIB_PATH, 'utf8'));
  const res = AdHoc.applyAdHoc(lib, job.adHocEntries);
  const pf = Preflight.preflight(job, { library: res.library });
  const settings = Preflight.buildSettings(pf.job);
  const gen = G.generate(res.library, settings, {});
  return { pf, settings, mergedLib: res.library, gen, adhoc: res };
}

const BASE_JOB = (extra) => Object.assign({
  jobVersion: 1,
  scenario: 'homework',
  generation: {
    totalCount: 8,
    versionStrategy: 'preferChemical',
    scopes: {},
    questionTypeCounts: { B: 0, C: 0, D: 0, E: 0, H: 0 },
    difficultyMode: 'counts',
    difficultyCounts: { simple: 0, medium: 0, hard: 0 },
    manualEntryIds: []
  },
  export: { pdf: false, docx: false, images: false },
  useMemory: false
}, extra || {});

// ===============================================================
console.log('ad-hoc 集成测试：');

const libShaBefore = sha256File(LIB_PATH);

// ---- ① 默认：临时题进卷 ----
{
  const job = BASE_JOB({ adHocEntries: [ADHOC_IONIC, ADHOC_CHEM] });
  const r = runWithAdHoc(job);

  check('① 预检无拦截', r.pf.diagnostics.blockers.length === 0,
    JSON.stringify(r.pf.diagnostics.blockers.map((b) => b.code)));
  check('① 临时题全部接受（2/2）', r.adhoc.report.accepted === 2 && r.adhoc.report.rejected === 0);
  check('① 默认钉进必出（pinned=2）', r.pf.preflight.adhoc.pinned === 2,
    JSON.stringify(r.pf.preflight.adhoc));
  check('① 复述框带 adhoc 信息', !!(r.pf.restate.adhoc && r.pf.restate.adhoc.accepted === 2));

  const ids = r.gen.items.map((it) => it.entryId);
  const adhocIds = r.adhoc.entries.map((e) => e.id);
  check('① 临时题**确实出现在卷面上**', adhocIds.every((id) => ids.includes(id)),
    `卷面 ids=${ids.join(',')} 期望含 ${adhocIds.join(',')}`);
  check('① 卷面题量 = totalCount', r.gen.items.length === 8, `实际 ${r.gen.items.length}`);

  // 题型：B 与 E 各一
  const byId = {};
  r.gen.items.forEach((it) => { byId[it.entryId] = it; });
  check('① 临时题题型生效（B）', byId[adhocIds[0]] && byId[adhocIds[0]].questionType === 'B',
    byId[adhocIds[0]] && byId[adhocIds[0]].questionType);
  check('① 临时题题型生效（E）', byId[adhocIds[1]] && byId[adhocIds[1]].questionType === 'E',
    byId[adhocIds[1]] && byId[adhocIds[1]].questionType);
}

// ---- ② 范围外也被钉住（默认语义：点名要出）----
{
  const job = BASE_JOB({
    generation: Object.assign(BASE_JOB().generation, {
      scopes: { books: ['必修第一册'], chapters: ['第一章 物质及其变化'] }
    }),
    adHocEntries: [ADHOC_IONIC]
  });
  const r = runWithAdHoc(job);
  const ids = r.gen.items.map((it) => it.entryId);
  const adhocId = r.adhoc.entries[0].id;
  check('② 默认不受范围约束 → 仍在卷面', ids.includes(adhocId),
    `卷面 ids=${ids.join(',')} 缺 ${adhocId}`);
  check('② 无 B11 误拦截', !r.pf.diagnostics.blockers.some((b) => b.code === 'B11_INVALID_MANUAL_ID'),
    JSON.stringify(r.pf.diagnostics.blockers.map((b) => b.code)));
}

// ---- ③ enforceScope=true：受范围约束、范围外剔除 ----
{
  const job = BASE_JOB({
    generation: Object.assign(BASE_JOB().generation, {
      scopes: { books: ['必修第一册'], chapters: ['第一章 物质及其变化'] }
    }),
    adHocEntries: [ADHOC_IONIC],
    adHocOptions: { enforceScope: true }
  });
  const r = runWithAdHoc(job);
  const adhocId = r.adhoc.entries[0].id;
  const ids = r.gen.items.map((it) => it.entryId);
  check('③ enforceScope → 不钉（pinned=0）', r.pf.preflight.adhoc.pinned === 0,
    JSON.stringify(r.pf.preflight.adhoc.pinned));
  check('③ 范围外临时题被剔除', !ids.includes(adhocId), `卷面不该含 ${adhocId}`);
  check('③ 剔除情况如实报告（scopeDropped）',
    r.pf.preflight.adhoc.scopeDropped.includes(adhocId),
    JSON.stringify(r.pf.preflight.adhoc.scopeDropped));
}

// ---- ④ 非法临时题 → 硬拦截 ----
{
  const job = BASE_JOB({ adHocEntries: [ADHOC_BAD] });
  const r = runWithAdHoc(job);
  const codes = r.pf.diagnostics.blockers.map((b) => b.code);
  check('④ 非法临时题 → ADHOC_INVALID 拦截', codes.includes('ADHOC_INVALID'), JSON.stringify(codes));
  check('④ 拦截退出码为 2（不进导出）', r.pf.exitCode === 2, String(r.pf.exitCode));
  check('④ 错误信息含守恒提示',
    r.pf.diagnostics.blockers.some((b) => b.code === 'ADHOC_INVALID' &&
      JSON.stringify(b.items).includes('化学校验未通过')),
    JSON.stringify(r.pf.diagnostics.blockers));
}

// ---- ⑤ 零副作用 ----
{
  const job = BASE_JOB({ adHocEntries: [ADHOC_IONIC, ADHOC_CHEM] });
  const r = runWithAdHoc(job);
  check('⑤ 数据锁：library.json 字节未变', sha256File(LIB_PATH) === libShaBefore);
  check('⑤ 快照条目数不被临时题虚增', r.pf.snapshot.entries === 392,
    String(r.pf.snapshot.entries));
  check('⑤ 快照 sha256 仍是磁盘题库口径', r.pf.snapshot.sha256 === libShaBefore);
  check('⑤ 合并副本条目数 = 392 + 2', r.mergedLib.entries.length === 394);
  check('⑤ __adhoc 不进 JSON', !JSON.stringify(r.mergedLib).includes('__adhoc'));
}

// ---- ⑥ 版本策略与临时题类型 ----
{
  const job = BASE_JOB({
    generation: Object.assign(BASE_JOB().generation, { versionStrategy: 'chemicalOnly' }),
    adHocEntries: [ADHOC_IONIC]
  });
  const r = runWithAdHoc(job);
  const codes = r.pf.diagnostics.blockers.map((b) => b.code);
  check('⑥ chemicalOnly + 纯离子临时题 → B11 明确报错', codes.includes('B11_INVALID_MANUAL_ID'),
    JSON.stringify(codes));
}

// ---- ⑦ 无 ad-hoc 时行为不变 ----
{
  const job = BASE_JOB({});
  const lib = JSON.parse(fs.readFileSync(LIB_PATH, 'utf8'));
  const pf = Preflight.preflight(job, { library: lib });
  const settings = Preflight.buildSettings(pf.job);
  const gen = G.generate(lib, settings, {});
  check('⑦ 不带 adHocEntries → adhoc 报告为空', pf.preflight.adhoc === null,
    JSON.stringify(pf.preflight.adhoc));
  check('⑦ 不带 adHocEntries → 正常出卷', gen.ok && gen.items.length === 8,
    `ok=${gen.ok} n=${gen.items && gen.items.length}`);
  check('⑦ 不带 adHocEntries → 快照条目数 392', pf.snapshot.entries === 392);
}

// ---- ⑧ 临时题不写进 out / 不落盘任何文件 ----
{
  const job = BASE_JOB({ adHocEntries: [ADHOC_IONIC] });
  runWithAdHoc(job);
  check('⑧ 数据锁文件未被改写', sha256File(path.join(SKILL_ROOT, 'data', 'SOURCE.json')).length === 64);
  check('⑧ 题库仍只有 392 条', JSON.parse(fs.readFileSync(LIB_PATH, 'utf8')).entries.length === 392);
}

console.log(lines.join('\n'));
console.log(`\n结果：通过 ${pass} 项，失败 ${fail} 项${fail === 0 ? ' ✓' : ' ✗'}`);
process.exit(fail === 0 ? 0 : 1);
