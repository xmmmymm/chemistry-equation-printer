#!/usr/bin/env node
/*
 * 边界与异常回归（第二轮实跑测试沉淀）。
 *
 * 为什么单开一套：§3.4 的 17 条验收用例覆盖的是**主流程**，不覆盖
 *   · CLI 参数解析（`--out` 的值不能被当成 job 路径）
 *   · `outputDir` 越界、`dryRun` 的 result.json 落位
 *   · 版本策略未指定（ASK）必须拦截
 *   · intake 覆盖度（explicit / memory / default）与确认闸门的前置判定（AC-18）
 *   · 自定义 outputDir 下 `_pending` 的可见性
 *   · 归一/拦截/缩放的细粒度行为（B6/B7/B8/B11/B3/B4）
 * 这些正是第二轮实跑里出过问题的地方，沉淀下来防止回归。
 *
 * 用法：node tools/test-edge.js
 * 退出码：0 = 全过；1 = 有失败
 *
 * 全部断言为**纯 Node**（不启 Electron，秒级）；Electron 侧由 tools/acceptance.js 覆盖。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const SKILL_ROOT = path.resolve(__dirname, '..');
const OUT = path.join(SKILL_ROOT, 'out');
const TMP = path.join(OUT, 'edge-tmp-' + process.pid);

const PF = require(path.join(SKILL_ROOT, 'tools', 'preflight.js'));
const G = require(path.join(SKILL_ROOT, 'engine', 'generator.js'));
const Paper = require(path.join(SKILL_ROOT, 'engine', 'paper.js'));
const Yml = require(path.join(SKILL_ROOT, 'tools', 'yml.js'));
const SkillState = require(path.join(SKILL_ROOT, 'tools', 'skill-state.js'));

const lib = JSON.parse(fs.readFileSync(path.join(SKILL_ROOT, 'data', 'library.json'), 'utf8'));
const cls = JSON.parse(fs.readFileSync(path.join(SKILL_ROOT, 'data', 'classifications.json'), 'utf8'));

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { pass++; console.log('✓ ' + name + (extra ? '  ' + extra : '')); }
  else { fail++; failures.push(name + (extra ? '  ' + extra : '')); console.log('✗ ' + name + (extra ? '  ' + extra : '')); }
}
function section(t) { console.log('\n=== ' + t + ' ==='); }

/** 预检（关记忆，保证与真实偏好无关） */
const P = (job) => PF.preflight(job, { library: lib, classifications: cls, memory: false });
const blockersOf = (r) => r.diagnostics.blockers.map((b) => b.code);

// ============================================================
section('A. 口语归一（B8）');
// ============================================================
{
  const r = P({ generation: { scopeInput: { books: ['必修一'] }, totalCount: 5, versionStrategy: 'chemicalOnly' } });
  check('册别「必修一」→ 必修第一册', (r.job.generation.scopes.books || [])[0] === '必修第一册', JSON.stringify(r.job.generation.scopes.books));
}
{
  const r = P({ generation: { scopeInput: { books: ['必修１'] }, totalCount: 5, versionStrategy: 'chemicalOnly' } });
  check('全角「必修１」归一', (r.job.generation.scopes.books || [])[0] === '必修第一册', JSON.stringify(r.job.generation.scopes.books));
}
{
  const r = P({ generation: { scopeInput: { books: ['必修一'], chapters: ['第一章'] }, totalCount: 5, versionStrategy: 'chemicalOnly' } });
  check('章「第一章」简称归一 + 册别细化 → 45 条', r.preflight.authoritativeCount === 45, '实际 ' + r.preflight.authoritativeCount);
}
{
  const r = P({ generation: { scopeInput: { difficulties: ['easy', 'hard'] }, totalCount: 5, versionStrategy: 'allAvailable' } });
  const d = r.job.generation.scopes.difficulties || [];
  check('难度英文 → 中文（easy/hard）', d.includes('简单') && d.includes('较难') && d.length === 2, JSON.stringify(d));
}
{
  const r = P({ generation: { scopeInput: { versionTypes: ['离子'] }, totalCount: 5, versionStrategy: 'allAvailable' } });
  check('版本类型「离子」→ ionic', (r.job.generation.scopes.versionTypes || [])[0] === 'ionic', JSON.stringify(r.job.generation.scopes.versionTypes));
}
{
  const r = P({ generation: { versionStrategy: '优先化学', totalCount: 5 } });
  check('版本策略「优先化学」→ preferChemical', r.versionStrategy === 'preferChemical', r.versionStrategy);
}
{
  const r = P({ scenario: '限时练', generation: { totalCount: 5, versionStrategy: 'chemicalOnly' } });
  check('场景「限时练」→ timedDrill', r.scenario === 'timedDrill', r.scenario);
}
{
  const r = P({ generation: { scopeInput: { sections: ['离子反应'] }, totalCount: 5, versionStrategy: 'allAvailable' } });
  check('节简称「离子反应」唯一命中', (r.job.generation.scopes.sections || []).length === 1 && blockersOf(r).length === 0, JSON.stringify(r.job.generation.scopes.sections));
}
{
  const r = P({ scenario: 'bogus', generation: { totalCount: 5, versionStrategy: 'allAvailable' } });
  check('未知场景回退 homework', r.scenario === 'homework', r.scenario);
}

// ============================================================
section('B. 拦截（ASK / B6 / B7 / B11 / B1 / B3 / B4）');
// ============================================================
{
  const r = P({ jobVersion: 1, useMemory: false, generation: { totalCount: 5 } });
  check('ASK：版本策略未指定 → 拦截 exit 2',
    r.ok === false && r.exitCode === 2 && blockersOf(r).includes('ASK_VERSION_STRATEGY'), JSON.stringify(blockersOf(r)));
  check('ASK：restate 如实回显 "ASK"（不伪装成 chemicalOnly）', r.restate.versionStrategy === 'ASK', JSON.stringify(r.restate.versionStrategy));
  check('ASK：versionStrategyEffective 给出「不问会落到」的兜底值', r.restate.versionStrategyEffective === 'chemicalOnly', r.restate.versionStrategyEffective);
  check('ASK：blockers[0] 附六选一选项', (r.diagnostics.blockers[0].options || []).length === 6);
}
{
  const r = P({ jobVersion: 1, useMemory: false, generation: { totalCount: 5, versionStrategy: 'ASK' } });
  check('ASK：显式写 "ASK" 同样拦截', blockersOf(r).includes('ASK_VERSION_STRATEGY'), JSON.stringify(blockersOf(r)));
}
{
  const r = P({ generation: { scopeInput: { sections: ['复习与提高'] }, totalCount: 5, versionStrategy: 'allAvailable' } });
  const b = r.diagnostics.blockers.find((x) => x.code === 'B6_AMBIGUOUS');
  check('B6 多候选「复习与提高」→ 列候选（>1）', !!b && b.items[0].candidates.length > 1, b ? b.items[0].candidates.length + ' 个候选' : '无 blocker');
}
{
  const r = P({ generation: { scopeInput: { chapters: ['第九章'] }, totalCount: 5, versionStrategy: 'allAvailable' } });
  const b = r.diagnostics.blockers.find((x) => x.code === 'B6_UNMATCHED');
  check('B6 零命中「第九章」→ 附册/章/节候选清单', !!b && Array.isArray(b.hints.章) && b.hints.章.length > 0);
}
{
  const r = P({ generation: { totalCount: 10, versionStrategy: 'allAvailable', questionTypeCounts: { B: 0, C: 0, D: 0, E: 0, H: 2 } } });
  check('B7 H 题型被拒且强制归零',
    !!r.diagnostics.blockers.find((x) => x.code === 'B7_H_UNAVAILABLE') && r.job.generation.questionTypeCounts.H === 0);
}
{
  const r = P({ generation: { totalCount: 10, versionStrategy: 'allAvailable', manualEntryIds: ['NOPE_1', 'R0014'] } });
  const b = r.diagnostics.blockers.find((x) => x.code === 'B11_INVALID_MANUAL_ID');
  check('B11 无效手选 ID 被列出', !!b && b.items.some((i) => i.id === 'NOPE_1'));
}
{
  const ids = lib.entries.slice(0, 12).map((e) => e.id);
  const r = P({ generation: { totalCount: 10, versionStrategy: 'allAvailable', manualEntryIds: ids } });
  check('B3 手选 12 > 总题数 10 → 拦截', !!r.diagnostics.blockers.find((x) => x.code === 'B3_MANUAL_EXCEED'));
}
{
  const r = P({ generation: { totalCount: 10, versionStrategy: 'allAvailable', questionTypeCounts: { B: 8, C: 8, D: 8, E: 0, H: 0 } } });
  const w = r.diagnostics.warnings.find((x) => x.code === 'B4_TYPE_OVERFLOW');
  const sum = Object.values(r.job.generation.questionTypeCounts).reduce((a, b) => a + b, 0);
  check('B4 题型溢出 → 等比缩 + Σ == total', !!w && sum === 10, JSON.stringify(r.job.generation.questionTypeCounts));
}
{
  const r = P({ generation: { scopeInput: { books: ['选择性必修2'] }, totalCount: 10, versionStrategy: 'chemicalOnly' } });
  const b = r.diagnostics.blockers.find((x) => x.code === 'B1_SHORTAGE');
  check('B1 选必2 仅化学 → 权威条目数 3（不是版本数）', !!b && b.authoritativeCount === 3, b ? 'auth=' + b.authoritativeCount : '无 blocker');
  check('B1 给四选项流', !!b && b.options.length === 4);
}
{
  // 零候选场景：选择性必修3 的「第二章 烃」全部是纯有机反应，没有任何离子方程式版本
  const r = P({ generation: { scopeInput: { books: ['选择性必修3'], chapters: ['第二章 烃'] }, totalCount: 10, versionStrategy: 'ionicOnly' } });
  const b = r.diagnostics.blockers.find((x) => x.code === 'B1_ZERO_CANDIDATE');
  check('B1 零候选文案「命中 0 条条目（非版本策略损失）」', !!b && b.title.includes('命中 0 条条目'));
}
{
  const r = P({ generation: { scopeInput: { starred: true }, totalCount: 5, versionStrategy: 'allAvailable' } });
  check('B7 starred 被拒（不支持的维度也走 blocker）', blockersOf(r).length > 0, JSON.stringify(blockersOf(r)));
}

// ============================================================
section('C. 候选口径与策略对照');
// ============================================================
{
  const r = P({ generation: { totalCount: 1, versionStrategy: 'allAvailable' } });
  check('全库：条目 392 / 版本 553（报数一律用条目数）',
    r.preflight.authoritativeCount === 392 && r.preflight.versionCount === 553,
    r.preflight.authoritativeCount + ' / ' + r.preflight.versionCount);
}
{
  const r = P({ generation: { totalCount: 1, versionStrategy: 'chemicalOnly' } });
  check('全库 chemicalOnly：条目 301 / 版本 304', r.preflight.authoritativeCount === 301 && r.preflight.versionCount === 304,
    r.preflight.authoritativeCount + ' / ' + r.preflight.versionCount);
}
{
  const r = P({ generation: { totalCount: 1, versionStrategy: 'chemicalOnly' } });
  const m = {};
  r.preflight.strategies.forEach((s) => { m[s.strategy] = s.entries; });
  check('五策略对照表覆盖 chemicalOnly/ionicOnly/preferChemical/preferIonic/allAvailable',
    Object.keys(m).length === 5 && m.chemicalOnly === 301 && m.allAvailable === 392, JSON.stringify(m));
}

// ============================================================
section('D. 场景预设与卷面模板');
// ============================================================
{
  const a = Yml.loadLayout('homework', {});
  const b = Yml.loadLayout('timedDrill', {});
  const c = Yml.loadLayout('examPrep', {});
  check('三场景标题正确', a.title === '化学方程式作业' && b.title === '化学方程式课堂限时练' && c.title === '化学方程式备考练习',
    [a.title, b.title, c.title].join(' / '));
  check('学生栏：homework 关 / timedDrill·examPrep 开（姓名·班级·日期）',
    a.studentInfo.enabled === false && b.studentInfo.enabled === true && c.studentInfo.enabled === true
    && JSON.stringify(b.studentInfo.fields) === JSON.stringify(['姓名', '班级', '日期']));
  check('页脚页码恒开', a.footer.enabled === true && b.footer.enabled === true && c.footer.enabled === true);
  check('卷面模板固定：A4 纵 / 2cm / 1 栏 / 宋体+TNR 16-12-10.5',
    a.paper.size === 'A4' && a.paper.orientation === 'portrait' && a.columns === 1 &&
    a.margins.top === '2cm' && a.font.chinese === 'SimSun' && a.font.latin === 'Times New Roman' &&
    a.font.titleSizePt === 16 && a.font.bodySizePt === 12 && a.font.noteSizePt === 10.5);
  check('卷级 answerLine.enabled 恒为 false（C 题靠 item 级覆盖）', a.answerLine.enabled === false);
  const o = Yml.loadLayout('homework', { title: '自定义标题', studentInfo: { enabled: true } });
  check('layoutOverrides 允许 title / studentInfo', o.title === '自定义标题' && o.studentInfo.enabled === true);
  const o2 = Yml.loadLayout('homework', { font: { bodySizePt: 14 } });
  check('layoutOverrides 拒绝卷面参数（font 按设计不生效）', o2.font.bodySizePt === 12);
}

// ============================================================
section('E. 组卷（engine/paper.js）');
// ============================================================
{
  const s = PF.buildSettings({ generation: { totalCount: 10, versionStrategy: 'allAvailable', difficultyMode: 'ratios', difficultyRatios: { simple: 5, medium: 3, hard: 2 } } });
  const g = Paper.generatePaper(lib, s, { totalCount: 10, authoritativeCount: 392 });
  check('difficultyRatios 模式组卷成功且题量正确', g.ok && g.items.length === 10, g.ok ? JSON.stringify(g.stats.difficultyActual) : '失败');
}
{
  const s = PF.buildSettings({ generation: { totalCount: 12, versionStrategy: 'allAvailable', questionTypeCounts: { B: 0, C: 12, D: 0, E: 0, H: 0 } } });
  const g = Paper.generatePaper(lib, s, { totalCount: 12, authoritativeCount: 392 });
  const allC = g.items.every((i) => i.questionType === 'C');
  const allLine = g.items.every((i) => i.showAnswerLine === true && i.answerLineHeightPt === 24);
  check('C 题全开：perItemRules 注入 showAnswerLine/24pt', g.ok && allC && allLine, 'C 题数 ' + g.items.filter((i) => i.questionType === 'C').length);
}
{
  // AC-14 重抽后 perItemRulesApplied 必须重算（曾报陈旧计数）
  const s = PF.buildSettings({ generation: { totalCount: 20, versionStrategy: 'allAvailable' } });
  let mismatch = 0, redraws = 0;
  for (let i = 0; i < 15; i++) {
    const g = Paper.generatePaper(lib, s, {
      totalCount: 20, authoritativeCount: 392,
      extraAcceptance: [{ kind: 'containsName', value: '不存在的条目名XYZ', minCount: 20, label: '不可能满足' }], maxRedraws: 1
    });
    if (!g.ok) continue;
    if (g.redraws > 0) redraws++;
    const cCount = g.items.filter((x) => x.questionType === 'C').length;
    if (((g.perItemRulesApplied[0] || {}).count) !== cCount) mismatch++;
  }
  check('重抽后 perItemRulesApplied 与实际 C 题数一致', mismatch === 0, `重抽 ${redraws} 次，不一致 ${mismatch} 次`);
}
{
  const a = PF.candidateStats(lib, PF.buildSettings({ generation: { totalCount: 1, versionStrategy: 'allAvailable' } }));
  const b = PF.candidateStats(lib, PF.buildSettings({ generation: { totalCount: 1, versionStrategy: 'allAvailable', exclude: { books: ['必修第一册'] } } }));
  check('exclude 生效（条目数下降且 >0）', b.entryCount < a.entryCount && b.entryCount > 0, a.entryCount + ' → ' + b.entryCount);
}

// ============================================================
section('F. 文件名预览与输出目录');
// ============================================================
{
  const r = P({ generation: { totalCount: 7, versionStrategy: 'allAvailable' }, scenario: 'timedDrill' });
  const names = r.restate.files.map((f) => f.name);
  check('文件名预览：{日期}_{场景}_{题量}题_{题目|答案}.{pdf|docx}',
    names.length === 4 && names.every((n) => /^\d{4}-\d{2}-\d{2}_timedDrill_7题(_题目|_答案)\.(pdf|docx)$/.test(n)), names.join(', '));
  check('outputDir 默认落 out/{yyyy-mm-dd}/', /[\\/]out[\\/]\d{4}-\d{2}-\d{2}$/.test(r.restate.outputDir), r.restate.outputDir);
}

// ============================================================
section('G. CLI 参数解析（曾把 --out 的值当 job 路径）');
// ============================================================
{
  const run = (argv) => spawnSync(process.execPath, argv, { cwd: SKILL_ROOT, encoding: 'utf8', shell: false });
  const jobRel = path.join('examples', 'job-homework-basic.json');
  const outRel = path.join('out', 'edge-tmp-' + process.pid + '-pf.json');
  const outAbs = path.join(SKILL_ROOT, outRel);

  let r = run([path.join('tools', 'preflight.js'), '--job', jobRel, '--no-memory']);
  check('CLI：--job <path> 正常（exit 0）', r.status === 0, 'exit ' + r.status);

  r = run([path.join('tools', 'preflight.js'), '--out', outRel, '--job', jobRel, '--no-memory']);
  check('CLI：--out 在 --job 之前也能取到正确 job（exit 0）', r.status === 0 && fs.existsSync(outAbs), 'exit ' + r.status + ' written=' + fs.existsSync(outAbs));
  try { fs.unlinkSync(outAbs); } catch (_) {}

  r = run([path.join('tools', 'preflight.js'), '--job=' + jobRel, '--no-memory']);
  check('CLI：--job=<path> 等号写法（exit 0）', r.status === 0, 'exit ' + r.status);

  r = run([path.join('tools', 'preflight.js'), jobRel, '--no-memory']);
  check('CLI：裸位置参数也当 job（exit 0）', r.status === 0, 'exit ' + r.status);

  r = run([path.join('tools', 'preflight.js')]);
  check('CLI：无参数 → 用法提示 exit 3', r.status === 3, 'exit ' + r.status);

  r = run([path.join('tools', 'preflight.js'), '--job', path.join('out', 'nope.json')]);
  check('CLI：job 不存在 → exit 3', r.status === 3, 'exit ' + r.status);

  r = run([path.join('tools', 'preflight.js'), '--job', jobRel, '--out', path.join('..', 'evil.json')]);
  check('CLI：--out 指向项目外 → 拒绝 exit 3', r.status === 3 && !fs.existsSync(path.join(SKILL_ROOT, '..', 'evil.json')), 'exit ' + r.status);

  r = run([path.join('tools', 'skill-state.js'), 'bogus']);
  check('CLI：skill-state 未知子命令 → exit 2', r.status === 2, 'exit ' + r.status);

  r = run([path.join('tools', 'run-paper.js')]);
  check('CLI：run-paper 无参 → exit 2', r.status === 2, 'exit ' + r.status);
}

// ============================================================
section('H. 状态管理：_pending 可见性（自定义 outputDir 曾漏掉）');
// ============================================================
{
  const nested = path.join(TMP, 'custom-papers', '2026-01-01');
  fs.mkdirSync(nested, { recursive: true });
  const pendingPath = path.join(nested, '_pending.json');
  fs.writeFileSync(pendingPath, JSON.stringify({
    createdAt: '2026-01-01T00:00:00.000Z',
    jobPath: 'x', params: {},
    failed: [{ channel: 'pdf', role: 'question', error: '注入的测试失败', at: '2026-01-01T00:00:00.000Z' }],
    succeeded: [], retryHint: 'h'
  }), 'utf8');
  const listed = SkillState.listPending();
  const found = listed.items.find((it) => path.resolve(it.path) === path.resolve(pendingPath));
  check('listPending 能找到自定义 outputDir（嵌套）下的 _pending.json', !!found, '共 ' + listed.count + ' 项');
  check('listPending 解析出 failed 明细', !!found && found.failed[0].includes('注入的测试失败'));

  // 下划线开头的测试/开发目录必须被跳过（否则验收台的产物会被当成老师的未完成项）
  const us = path.join(TMP, '_acceptance-like', 'AC-10', 'out');
  fs.mkdirSync(us, { recursive: true });
  fs.writeFileSync(path.join(us, '_pending.json'), '{"failed":[],"succeeded":[]}', 'utf8');
  const listed2 = SkillState.listPending();
  check('listPending 跳过 _ 开头的测试/开发目录',
    !listed2.items.some((it) => it.path.includes('_acceptance-like')), '共 ' + listed2.count + ' 项');
}
{
  const d = SkillState.drift();
  check('drift 可调用且报告题库条目数 392', d.snapshot && d.snapshot.entries === 392, 'drift=' + d.drift);
  const m = SkillState.memory();
  check('memory 可调用（缺失/损坏都给默认）', !!m.defaults && typeof m.corrupted === 'boolean');
}
{
  // 数据本地化：data/ 是本项目自有数据，由 data/SOURCE.json 的数据锁兜底
  const DataLock = require(path.join(SKILL_ROOT, 'tools', 'data-lock.js'));
  const meta = DataLock.readMeta();
  const r = DataLock.verifyLock();
  check('数据锁：data/ 与 SOURCE.json 的 library 记录一致', r.ok, r.reason + ' ' + JSON.stringify(r.actual));
  check('数据本地化：dataOwnership=local 且留有 origin 溯源', meta.dataOwnership === 'local' && !!meta.origin && !!meta.origin.library);
  check('数据锁覆盖分类表', !!(meta.classifications && meta.classifications.sha256));
}
{
  // 零项目外依赖：Electron 运行时必须落在本项目内，且 run-paper 解析到的就是它
  const Runtime = require(path.join(SKILL_ROOT, 'tools', 'install-runtime.js'));
  const rt = Runtime.checkRuntime();
  check('Electron 运行时在本项目内（runtime/electron/）', rt.ok, rt.ok ? rt.exe + ' v' + rt.version : rt.reason);
  const rel = path.relative(SKILL_ROOT, Runtime.EXE);
  check('运行时路径未越出项目根', !!rel && !rel.startsWith('..') && !path.isAbsolute(rel), rel);
  const meta2 = JSON.parse(fs.readFileSync(path.join(SKILL_ROOT, 'data', 'SOURCE.json'), 'utf8'));
  check('SOURCE.json 的 electronRuntime 指向项目内且 mode=local',
    meta2.electronRuntime && meta2.electronRuntime.mode.startsWith('local')
    && !path.relative(SKILL_ROOT, meta2.electronRuntime.path).startsWith('..'),
    meta2.electronRuntime && meta2.electronRuntime.path);
}

// ============================================================
section('I. 引擎副本本地补丁登记表');
// ============================================================
{
  const reg = JSON.parse(fs.readFileSync(path.join(SKILL_ROOT, 'data', 'ENGINE-PATCHES.json'), 'utf8'));
  const labels = Object.keys(reg.patches || {});
  check('ENGINE-PATCHES.json 结构合法（含 patches 对象）', !!reg.patches && typeof reg.patches === 'object');
  let allOk = true;
  for (const label of labels) {
    const rec = reg.patches[label];
    const local = path.join(SKILL_ROOT, ...label.split('/'));
    const crypto = require('crypto');
    const h = crypto.createHash('sha256').update(fs.readFileSync(local)).digest('hex');
    if (h !== rec.patchedSha256 || !rec.upstreamSha256 || !rec.title) allOk = false;
  }
  check('登记的每个补丁都有 upstreamSha256 / patchedSha256 / title 且本地哈希吻合', allOk, labels.join('、') || '（空表）');
}

// ============================================================
section('J. 纯文本通道公式渲染（本地补丁：多位数下标 + 尾随电荷）');
// ============================================================
{
  // 现象：result.json 的 itemsPreview（equationUnicode）与 PDF/docx 渲染不一致 ——
  //   ① `C17H35` → `C₁7H₃5`（多位数下标只吃第一位）
  //   ② `H+` → `H+`（尾随 +/- 电荷不转上标；PDF/docx 走 formulaHTML() 是 H⁺）
  // 根因/修法见 data/ENGINE-PATCHES.json 的 engine/chem.js 项。
  const C = require(path.join(SKILL_ROOT, 'engine', 'chem.js'));
  check('多位数下标全吃：C17H35 → C₁₇H₃₅', C.formulaUnicode('C17H35') === 'C₁₇H₃₅', C.formulaUnicode('C17H35'));
  check('多位数下标全吃：C6H12O6 → C₆H₁₂O₆', C.formulaUnicode('C6H12O6') === 'C₆H₁₂O₆', C.formulaUnicode('C6H12O6'));
  check('结晶水 ·5 不受影响：CuSO4·5H2O → CuSO₄·5H₂O', C.formulaUnicode('CuSO4·5H2O') === 'CuSO₄·5H₂O', C.formulaUnicode('CuSO4·5H2O'));
  check('尾随电荷转上标：H+ → H⁺', C.formulaUnicode('H+') === 'H⁺', C.formulaUnicode('H+'));
  check('尾随电荷转上标：OH- → OH⁻', C.formulaUnicode('OH-') === 'OH⁻', C.formulaUnicode('OH-'));
  check('尾随电荷转上标：e- → e⁻', C.formulaUnicode('e-') === 'e⁻', C.formulaUnicode('e-'));
  check('^ 记法仍正确：SO4^2- → SO₄²⁻', C.formulaUnicode('SO4^2-') === 'SO₄²⁻', C.formulaUnicode('SO4^2-'));
  // 全库扫描：纯文本通道不得再出现 ^ 泄漏，也不得漏转多位数下标
  const uniBad = [];
  for (const e of lib.entries) {
    for (const v of (e.versions || [])) {
      for (const sp of [...(v.reactants || []), ...(v.products || [])]) {
        const u = C.formulaUnicode(sp.formula);
        if (/\^/.test(u)) uniBad.push(e.id + ' ' + sp.formula + ' → ' + u);
        if (/[A-Za-z)\]]\d\d/.test(sp.formula) && /[A-Za-z)\]]\d(?![₀-₉])/.test(u)) uniBad.push(e.id + ' 下标漏转 ' + sp.formula + ' → ' + u);
      }
    }
  }
  check('全库 553 版本：纯文本通道无 ^ 泄漏、无多位数下标漏转', uniBad.length === 0, uniBad.slice(0, 5).join('；') || '0 处');
}

// ============================================================
section('K. 版本类型归一（custom 策略的 allowedVersionTypes）');
// ============================================================
{
  // 现象：{"versionStrategy":"custom","allowedVersionTypes":["离子"]} 归一前原样传给引擎
  //   → allowedTypes.includes('ionic') 恒 false → 候选 0 → 误报 B1_ZERO_CANDIDATE 拦截。
  //   归一映射表 §六 明写「离子 / 离子方程式 / ionic → ionic」——文档承诺的能力实际不可用。
  const cases = [
    [['离子'], ['ionic']], [['离子方程式'], ['ionic']], [['ionic'], ['ionic']], [['IONIC'], ['ionic']],
    [['化学', '水解'], ['chemical', 'hydrolysis']], [['热化学'], ['thermochemical']], [['电极反应式'], ['electrode']]
  ];
  const bad = [];
  for (const [inp, expect] of cases) {
    const r = P({ useMemory: false, generation: { versionStrategy: 'custom', allowedVersionTypes: inp, totalCount: 5 } });
    const got = r.job.generation.allowedVersionTypes || [];
    if (JSON.stringify(got) !== JSON.stringify(expect)) bad.push(`${JSON.stringify(inp)} → ${JSON.stringify(got)}（期望 ${JSON.stringify(expect)}）`);
  }
  check('custom + 中文/大小写版本类型都能归一（7 组）', bad.length === 0, bad.join('；') || '7/7');
  const rIonic = P({ useMemory: false, generation: { versionStrategy: 'custom', allowedVersionTypes: ['离子'], totalCount: 5 } });
  check('custom + 「离子」不再误报零候选', !blockersOf(rIonic).includes('B1_ZERO_CANDIDATE') && rIonic.preflight.authoritativeCount > 0,
    `auth=${rIonic.preflight.authoritativeCount} blockers=${JSON.stringify(blockersOf(rIonic))}`);
  const rBad = P({ useMemory: false, generation: { versionStrategy: 'custom', allowedVersionTypes: ['乱写的值'], totalCount: 5 } });
  check('认不出的版本类型原样保留（不静默丢弃）', (rBad.job.generation.allowedVersionTypes || [])[0] === '乱写的值',
    JSON.stringify(rBad.job.generation.allowedVersionTypes));
}

// ============================================================
section('L. 题库文本字段不得泄漏 ^ 记法（会直接印到卷面）');
// ============================================================
{
  // 现象：description 是纯文本（C 题题干原样渲染），用 `^` 写电荷/指数会原样印出来
  //   （实测：60 题卷第 23 题题干印出 `CO3^2-`，PDF 文本层与 docx XML 都能搜到 `^`）。
  //   修法：把 12 条 description + 1 条 difficultyReason 的 `^` 记法转成 Unicode 上标。
  //   `version.formula` 里的 `^` 是**引擎认的记法**（formulaHTML/formulaUnicode 会解析），不在此列。
  const bad = [];
  for (const e of lib.entries) {
    for (const f of ['name', 'description', 'openPrompt', 'difficultyReason', 'remark']) {
      if (String(e[f] || '').includes('^')) bad.push(e.id + '.' + f);
    }
  }
  check('题库文本字段（name/description/openPrompt/difficultyReason/remark）无 ^ 记法泄漏', bad.length === 0, bad.slice(0, 6).join('、') || '0 处');
  const caretFormulas = lib.entries.reduce((a, e) => a + (e.versions || []).reduce((b, v) =>
    b + [...(v.reactants || []), ...(v.products || [])].filter((sp) => String(sp.formula || '').includes('^')).length, 0), 0);
  check('version.formula 里的 ^ 记法保留（引擎会解析，不算泄漏）', caretFormulas > 0, caretFormulas + ' 处');
}

// ============================================================
section('M. 离子式拍板结论（第二轮：补 5 条 / 明确不补 12 条 / 统一碱性体系写法）');
// ============================================================
{
  // 依据：docs/reference/05-离子方程式补全记录.md §四 与「第二轮拍板的统一规则」。
  // 断言口径：每条结论都要有可判定的数据形态（有/无 ionic 版本、产物写哪个物种）。
  const Chem = require(path.join(SKILL_ROOT, 'engine', 'chem.js'));
  const ent = (id) => lib.entries.find((e) => e.id === id);
  const hasIonic = (id) => { const e = ent(id); return !!e && (e.versions || []).some((v) => v.type === 'ionic'); };
  const ionicText = (id) => {
    const e = ent(id); if (!e) return '';
    return (e.versions || []).filter((v) => v.type === 'ionic').map((v) => Chem.equationUnicodeText(v)).join(' | ');
  };
  const allText = (id) => {
    const e = ent(id); if (!e) return '';
    return (e.versions || []).map((v) => Chem.equationUnicodeText(v)).join(' | ');
  };

  // ---- 补的 5 条 ----
  for (const [id, why] of [['R0119', '实验室制氯气（浓盐酸，教辅高频）'], ['R0118', '漂白粉变质（Ca(ClO)₂ 可溶盐）'],
    ['R0291', '碱性锌锰电池（碱性体系，锌写配离子）'], ['R0306', '锌银纽扣电池（同上）'], ['R0372', '葡萄糖与新制氢氧化铜（统一含 NaOH 口径）']]) {
    check(`拍板「补」：${id} ${why} 有 ionic 版本`, hasIonic(id), ionicText(id));
  }

  // ---- 明确不补的 12 条 ----
  const NOT = ['R0193', 'R0316', 'R0321', 'R0028', 'R0107', 'R0108', 'R0305', 'R0352', 'R0318', 'R0097', 'R0295', 'R0307'];
  const wronglyAdded = NOT.filter(hasIonic);
  check(`拍板「不补」的 12 条确实没有 ionic 版本`, wronglyAdded.length === 0, wronglyAdded.join('、') || `${NOT.length} 条均无`);

  // ---- 碱性体系锌产物统一写配离子 Zn(OH)₄²⁻ ----
  for (const id of ['R0291', 'R0306', 'R0308']) {
    const t = allText(id);
    check(`${id} 碱性体系锌产物写 Zn(OH)₄²⁻（不写 Zn(OH)₂ / ZnO）`,
      t.includes('Zn(OH)₄²⁻') && !/Zn\(OH\)₂|ZnO/.test(t), t);
  }
  // 库内不应再出现 Zn(OH)₂ 作为**产物**（碱性体系锌产物统一写配离子 Zn(OH)₄²⁻）。
  // ⚠ 只查 Zn(OH)₂，不查 ZnO：`R0051 碳酸锌受热分解 → ZnO + CO₂` 是干法冶金，与碱性体系无关。
  const znBad = [];
  for (const e of lib.entries) {
    for (const v of (e.versions || [])) {
      for (const sp of (v.products || [])) {
        if (sp.formula === 'Zn(OH)2') znBad.push(`${e.id}/${v.id} ${sp.formula}`);
      }
    }
  }
  check('全库不再有以 Zn(OH)₂ 为产物的版本（碱性体系统一口径；ZnO 不在此列）', znBad.length === 0, znBad.slice(0, 5).join('、') || '0 处');

  // ---- R0372 与 R0355 口径一致（都含 NaOH / 都写 OH⁻） ----
  check('R0372 化学式版含 NaOH、产物为葡萄糖酸钠',
    allText('R0372').includes('NaOH') && allText('R0372').includes('CH₂OH(CHOH)₄COONa'), allText('R0372'));
  check('R0372 离子式与 R0355 同款（+ OH⁻ =△= …COO⁻ + Cu₂O↓ + 3H₂O）',
    ionicText('R0372').includes('OH⁻') && ionicText('R0372').includes('CH₂OH(CHOH)₄COO⁻')
    && ionicText('R0355').includes('OH⁻') && ionicText('R0355').includes('CH₃COO⁻'),
    `R0372: ${ionicText('R0372')}\n      R0355: ${ionicText('R0355')}`);

  // ---- R0193 乙醇写法统一 ----
  check('R0193 乙醇写法统一为 CH₃CH₂OH（不再用 C₂H₅OH）',
    allText('R0193').includes('CH₃CH₂OH') && !allText('R0193').includes('C₂H₅OH'), allText('R0193'));

  // ---- 3 组疑似重复：都保留两条 ----
  for (const [a, b] of [['R0193', 'R0316'], ['R0195', 'R0317'], ['R0188', 'R0319']]) {
    check(`疑似重复组 ${a}/${b} 两条都保留（未合并）`, !!ent(a) && !!ent(b), `${ent(a) && ent(a).name} / ${ent(b) && ent(b).name}`);
  }

  // ---- 全库 ionic 守恒（拍板后复验） ----
  let ionTotal = 0; const ionFail = [];
  for (const e of lib.entries) for (const v of (e.versions || [])) {
    if (v.type !== 'ionic') continue;
    ionTotal++;
    const st = Chem.validateVersion(v);
    if (!st.ok || st.atomBalance !== true || st.chargeBalance !== true) ionFail.push(`${e.id}/${v.id}`);
  }
  check(`全库 ${ionTotal} 个 ionic 版本原子 + 电荷守恒 0 失败`, ionFail.length === 0, ionFail.slice(0, 5).join('、') || `${ionTotal} 个全部通过`);

  // ---- 版本/类型计数（拍板后） ----
  let versions = 0; const bt = {};
  for (const e of lib.entries) for (const v of (e.versions || [])) { versions++; bt[v.type] = (bt[v.type] || 0) + 1; }
  check('拍板后全库版本数 = 553、ionic = 147', versions === 553 && bt.ionic === 147, `${versions} 版本 / ionic ${bt.ionic}`);
}

// ============================================================
section('N. intake 覆盖度报告（AC-18）');
// ============================================================
{
  const r = P({ scenario: 'timedDrill', generation: { scopeInput: { books: ['必修一'], chapters: ['第一章'] }, totalCount: 10, versionStrategy: 'preferChemical' } });
  const ic = r.intakeCoverage;
  check('intakeCoverage 随预检结果返回', !!ic, ic && ic.verdict);
  check('必问 3 项标 explicit → verdict=intake-complete',
    ic.verdict === 'intake-complete' && ['scenario', 'scope', 'versionStrategy'].every((k) => ic.explicitKeys.includes(k)),
    JSON.stringify(ic.explicitKeys));
  check('未给的项标 default',
    ['questionTypeCounts', 'difficulty', 'extraAcceptance', 'outputDir'].every((k) => ic.defaultKeys.includes(k)),
    JSON.stringify(ic.defaultKeys));
  check('unasked 为空（intake 问全）', ic.unasked.length === 0, JSON.stringify(ic.unasked));
  check('needsConfirm 不含 explicit 项',
    !ic.needsConfirm.includes('scenario') && !ic.needsConfirm.includes('scope') && ic.needsConfirm.includes('outputDir'),
    JSON.stringify(ic.needsConfirm));
}
{
  // 这就是「漏问」的现场：当次什么都没说，无记忆可补 → 必问项全部落 default，verdict 显式报 blocked
  const r = P({ generation: { totalCount: 10 } });
  const ic = r.intakeCoverage;
  check('漏问版本策略 → verdict=blocked', ic.verdict === 'blocked', ic.verdict);
  check('unasked 列出必问 3 项', ['scenario', 'scope', 'versionStrategy'].every((k) => ic.unasked.includes(k)), JSON.stringify(ic.unasked));
  check('版本策略值如实回显 ASK', /ASK/.test(ic.items.find((i) => i.key === 'versionStrategy').value));
}
{
  const r = P({
    scenario: 'homework',
    generation: {
      scopeInput: { books: ['九上'] }, totalCount: 6, versionStrategy: 'chemicalOnly',
      questionTypeCounts: { B: 2, C: 0, D: 0, E: 0, H: 0 },
      difficultyCounts: { simple: 3, medium: 3, hard: 0 }
    },
    extraAcceptance: [{ kind: 'containsFormula', value: 'O', minCount: 1, label: '氧≥1' }],
    export: { pdf: true, docx: false, images: false }
  });
  const ic = r.intakeCoverage;
  check('显式给的题型/难度/附加/导出都标 explicit',
    ['questionTypeCounts', 'difficulty', 'extraAcceptance', 'export'].every((k) => ic.explicitKeys.includes(k)),
    JSON.stringify(ic.explicitKeys));
  check('附加要求标签进入覆盖度值', /氧≥1/.test(ic.items.find((i) => i.key === 'extraAcceptance').value));
  check('导出通道值反映「只要 PDF」', /PDF/.test(ic.items.find((i) => i.key === 'export').value) && !/Word/.test(ic.items.find((i) => i.key === 'export').value));
}
{
  const r = P({ generation: { totalCount: 5, versionStrategy: 'preferChemical' } });
  check('--no-memory 时 memoryReport.disabled=true', r.memoryReport.disabled === true, JSON.stringify(r.memoryReport));
  check('--no-memory 时不存在 memory 来源', r.intakeCoverage.memoryKeys.length === 0, JSON.stringify(r.intakeCoverage.memoryKeys));
}

// ============================================================
/**
 * 清空目录（保留目录本身）。
 * ⚠ 本机环境里 Node 的目录删除（fs.rmSync / rmdirSync）会被**静默拦截**（调用后目录仍在），
 *    但文件删除 fs.unlinkSync 正常（README 坑 7）。所以逐层删文件、最后尝试删空子目录。
 */
function rmrf(p) {
  if (!fs.existsSync(p)) return;
  let st;
  try { st = fs.statSync(p); } catch (_) { return; }
  if (st.isFile()) { try { fs.unlinkSync(p); } catch (_) {} return; }
  for (const f of fs.readdirSync(p)) {
    const c = path.join(p, f);
    let cst;
    try { cst = fs.statSync(c); } catch (_) { continue; }
    if (cst.isDirectory()) rmrf(c);
    else { try { fs.unlinkSync(c); } catch (_) {} }
  }
  try { fs.rmdirSync(p); } catch (_) { /* 环境拦截：留着空目录 */ }
}

rmrf(TMP);

console.log('\n' + '='.repeat(60));
console.log(`边界回归：通过 ${pass} / 失败 ${fail}`);
if (failures.length) { console.log('失败明细：'); failures.forEach((f) => console.log('  - ' + f)); }
process.exit(fail ? 1 : 0);
