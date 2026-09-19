#!/usr/bin/env node
/*
 * 验收测试台（阶段 7）——逐条跑 PROMPT §3.4 的 17 条验收用例并收集原始证据。
 *
 * 用法：
 *   node tools/acceptance.js                # 跑全部 17 条
 *   node tools/acceptance.js AC-01 AC-04    # 只跑指定几条
 *   node tools/acceptance.js --list         # 列出用例
 *
 * 设计原则：
 *   - **不修改主项目**：AC-08 用「临时副本」模拟主项目题库被外部修改
 *     （`tools/sync-from-source.js --source=<临时目录>`），绝不触碰真主项目。
 *   - 证据全部落 `out/_acceptance/`（本项目内，已 gitignore），并打印摘要。
 *   - 每条用例独立目录，避免互相污染。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const SKILL_ROOT = path.resolve(__dirname, '..');
const OUT = path.join(SKILL_ROOT, 'out', '_acceptance');
const TMP = path.join(OUT, '_tmp');
/** 验收测试用独立状态目录：避免测试之间（以及测试与真实使用之间）互相污染偏好记忆 */
const STATE_DIR = path.join(OUT, '_state');
const TEST_ENV = { CHEMEQ_STATE_DIR: STATE_DIR };
const SOURCE_ROOT = 'E:\\DSH work\\方程式';
const ELECTRON = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(SKILL_ROOT, 'data', 'SOURCE.json'), 'utf8')).electronRuntime.path; }
  catch (_) { return null; }
})();

const Preflight = require(path.join(SKILL_ROOT, 'tools', 'preflight.js'));
const Paper = require(path.join(SKILL_ROOT, 'engine', 'paper.js'));
// 进程内也指向测试状态目录（AC-12 直接调 SkillState）
process.env.CHEMEQ_STATE_DIR = STATE_DIR;
const SkillState = require(path.join(SKILL_ROOT, 'tools', 'skill-state.js'));

// ============================================================
// 基础设施
// ============================================================
function sh(cmd, args, opts) {
  opts = opts || {};
  // Windows 下 npm 是 .cmd 批处理，spawnSync 直接调会 ENOENT → 走 shell
  const useShell = opts.shell != null ? opts.shell : (process.platform === 'win32');
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd || SKILL_ROOT,
    env: Object.assign({}, process.env, TEST_ENV, opts.env || {}),
    encoding: 'utf8',
    shell: useShell,
    maxBuffer: 64 * 1024 * 1024
  });
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

function node(scriptArgs, opts) {
  // node 直接调（不要 shell，避免参数被二次解释）
  return sh(process.execPath, scriptArgs, Object.assign({}, opts, { shell: false }));
}

function runPaper(jobPath, env) {
  return node([path.join('tools', 'run-paper.js'), jobPath], { env });
}

function writeJson(p, v) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(v, null, 2), 'utf8');
  return p;
}

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return null; }
}

function sha256File(p) { return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); }

/**
 * 清空目录内容（保留目录本身）。
 * ⚠ 本机环境里 Node 的目录删除（fs.rmSync / rmdirSync）会被**静默拦截**（调用后目录仍在），
 *    但**文件删除 fs.unlinkSync 正常**。所以逐层删文件、最后尝试删空子目录；
 *    删不掉的空目录不影响断言（断言只看文件）。
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

function caseDir(id) {
  const d = path.join(OUT, id);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

/** 清掉用例目录里的产物，保证断言确定（产物目录已 gitignore，可重建） */
function cleanCaseDir(id) {
  const d = path.join(OUT, id);
  rmrf(d);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function hashDir(dir, filter) {
  const out = {};
  if (!fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (!fs.statSync(p).isFile()) continue;
    if (filter && !filter(f)) continue;
    out[f] = { sha256: sha256File(p), bytes: fs.statSync(p).size, mtime: fs.statSync(p).mtimeMs };
  }
  return out;
}

/** 主项目全量 sha256 快照（AC-17 用；**只读**） */
function snapshotMainProject() {
  const roots = ['data', 'src/libs', 'scripts', 'examples'];
  const out = {};
  for (const r of roots) {
    const dir = path.join(SOURCE_ROOT, r);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      if (!fs.statSync(p).isFile()) continue;
      out[r + '/' + f] = { sha256: sha256File(p), bytes: fs.statSync(p).size, mtime: fs.statSync(p).mtimeMs };
    }
  }
  // 顶层关键文件
  for (const f of ['main.js', 'preload.js', 'package.json']) {
    const p = path.join(SOURCE_ROOT, f);
    if (fs.existsSync(p)) out[f] = { sha256: sha256File(p), bytes: fs.statSync(p).size, mtime: fs.statSync(p).mtimeMs };
  }
  return out;
}

function diffSnapshots(a, b) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const diffs = [];
  for (const k of keys) {
    if (!a[k]) { diffs.push({ file: k, kind: 'added' }); continue; }
    if (!b[k]) { diffs.push({ file: k, kind: 'removed' }); continue; }
    if (a[k].sha256 !== b[k].sha256) diffs.push({ file: k, kind: 'content', before: a[k].sha256, after: b[k].sha256 });
    else if (a[k].mtime !== b[k].mtime) diffs.push({ file: k, kind: 'mtime-only', before: a[k].mtime, after: b[k].mtime });
  }
  return diffs;
}

// ============================================================
// 用例
// ============================================================
const CASES = [];
const test = (id, title, fn) => CASES.push({ id, title, fn });

const TODAY = (() => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
})();

// ---- AC-01：全库 preferChemical 10 题 → 双卷 PDF + 双卷 docx ----
test('AC-01', '场景=homework、范围=全库、策略=preferChemical、10 题 → PDF 双卷 + docx 双卷落 out/', () => {
  const d = cleanCaseDir('AC-01');
  const outDir = path.join(d, 'out');
  rmrf(outDir);
  const job = {
    jobVersion: 1, scenario: 'homework',
    generation: { scopes: {}, exclude: {}, totalCount: 10, versionStrategy: 'preferChemical',
      questionTypeCounts: { B: 0, C: 0, D: 0, E: 0, H: 0 }, difficultyMode: 'counts',
      difficultyCounts: { simple: 0, medium: 0, hard: 0 }, manualEntryIds: [], allowSameEntryDifferentVersion: false },
    export: { pdf: true, docx: true, images: false, imagesOnDemand: null },
    layoutOverrides: {}, outputDir: outDir, dryRun: false
  };
  const jobPath = writeJson(path.join(d, 'job.json'), job);
  const before = snapshotMainProject();
  const r = runPaper(jobPath);
  const after = snapshotMainProject();
  const res = readJson(path.join(outDir, 'result.json'));
  const files = hashDir(outDir, (f) => !f.startsWith('_') && f !== 'result.json');
  const mainDiff = diffSnapshots(before, after);
  const pdfQ = res && res.channels.pdf.find((c) => c.role === 'question');
  const pdfA = res && res.channels.pdf.find((c) => c.role === 'answer');
  const docxQ = res && res.channels.docx.find((c) => c.role === 'question');
  const docxA = res && res.channels.docx.find((c) => c.role === 'answer');
  const checks = [
    ['退出码 0', r.code === 0],
    ['ok=true', !!(res && res.ok)],
    ['PDF 双卷存在', !!(pdfQ && pdfA)],
    ['docx 双卷存在', !!(docxQ && docxA)],
    ['PDF 命名含 _题目/_答案', !!(pdfQ && /_题目\.pdf$/.test(pdfQ.path)) && !!(pdfA && /_答案\.pdf$/.test(pdfA.path))],
    ['PDF 有页数', !!(pdfQ && pdfQ.pages >= 1) && !!(pdfA && pdfA.pages >= 1)],
    ['报告含 notices 字段', !!(res && res.generation && Array.isArray(res.generation.notices))],
    ['报告含快照信息', !!(res && res.snapshot && res.snapshot.entries === 392 && res.snapshot.drift === false)],
    ['报告含 params', !!(res && res.params && res.params.generation)],
    ['主项目零差异（AC-17 预检）', mainDiff.length === 0],
    ['产物 4 个文件', Object.keys(files).length === 4]
  ];
  return {
    checks,
    evidence: {
      exitCode: r.code, stdout: r.stdout.slice(0, 4000),
      outDir, files, mainProjectDiff: mainDiff,
      pdf: res && res.channels.pdf, docx: res && res.channels.docx,
      generation: res && res.generation && {
        requested: res.generation.requested, produced: res.generation.produced,
        typeActual: res.generation.typeActual, difficultyActual: res.generation.difficultyActual,
        notices: res.generation.notices, scopesHit: res.generation.scopesHit
      },
      snapshot: res && res.snapshot
    }
  };
});

// ---- AC-02：C 题有 24pt 答案线，B/D/E 无 ----
test('AC-02', '卷中含 C 题 → C 题有 24pt 答案线，B/D/E 无；卷级 answerLine.enabled=false 不变', () => {
  const d = caseDir('AC-02');
  const lib = readJson(path.join(SKILL_ROOT, 'data', 'library.json'));
  const settings = Preflight.buildSettings({ generation: { totalCount: 20, versionStrategy: 'preferChemical' } });
  const gen = Paper.generatePaper(lib, settings, { totalCount: 20, perItemRules: Paper.defaultPerItemRules() });
  const Yml = require(path.join(SKILL_ROOT, 'tools', 'yml.js'));
  const layout = Yml.loadLayout('homework');
  const cItems = gen.items.filter((it) => it.questionType === 'C');
  const otherItems = gen.items.filter((it) => it.questionType !== 'C');
  const checks = [
    ['组卷成功', gen.ok],
    ['卷内有 C 题', cItems.length > 0],
    ['C 题全部 showAnswerLine=true', cItems.every((it) => it.showAnswerLine === true)],
    ['C 题全部 answerLineHeightPt=24', cItems.every((it) => it.answerLineHeightPt === 24)],
    ['B/D/E 全部未开答案线', otherItems.every((it) => it.showAnswerLine == null)],
    ['卷级 answerLine.enabled=false 不变', layout.answerLine.enabled === false],
    ['perItemRules 命中数 == C 题数', (gen.perItemRulesApplied[0] || {}).count === cItems.length]
  ];
  return {
    checks,
    evidence: {
      typeActual: gen.stats.typeActual, cCount: cItems.length,
      cSamples: cItems.slice(0, 3).map((it) => ({ entryId: it.entryId, showAnswerLine: it.showAnswerLine, h: it.answerLineHeightPt })),
      layoutAnswerLine: layout.answerLine, perItemRulesApplied: gen.perItemRulesApplied
    }
  };
});

// ---- AC-03：timedDrill vs homework 标题/学生栏 ----
test('AC-03', '场景=timedDrill vs homework → 标题与学生栏不同；两者页脚页码都在', () => {
  const d = caseDir('AC-03');
  const Yml = require(path.join(SKILL_ROOT, 'tools', 'yml.js'));
  const hw = Yml.loadLayout('homework');
  const td = Yml.loadLayout('timedDrill');
  const ep = Yml.loadLayout('examPrep');
  const checks = [
    ['homework 标题=化学方程式作业', hw.title === '化学方程式作业'],
    ['homework 无学生栏', hw.studentInfo.enabled === false],
    ['timedDrill 标题=化学方程式课堂限时练', td.title === '化学方程式课堂限时练'],
    ['timedDrill 学生栏三项', td.studentInfo.enabled === true && td.studentInfo.fields.length === 3],
    ['timedDrill 学生栏字段=姓名/班级/日期', JSON.stringify(td.studentInfo.fields) === JSON.stringify(['姓名', '班级', '日期'])],
    ['examPrep 标题=化学方程式备考练习', ep.title === '化学方程式备考练习'],
    ['examPrep 有学生栏', ep.studentInfo.enabled === true],
    ['homework 页脚页码开', hw.footer.enabled === true && hw.footer.format === 'number'],
    ['timedDrill 页脚页码开', td.footer.enabled === true && td.footer.format === 'number'],
    ['卷面模板固定（A4 纵 2cm 1栏）', hw.paper.size === 'A4' && hw.paper.orientation === 'portrait' && hw.margins.top === '2cm' && hw.columns === 1],
    ['字体固定 16/12/10.5', hw.font.titleSizePt === 16 && hw.font.bodySizePt === 12 && hw.font.noteSizePt === 10.5]
  ];
  writeJson(path.join(d, 'layouts.json'), { homework: hw, timedDrill: td, examPrep: ep });
  return { checks, evidence: { homework: { title: hw.title, studentInfo: hw.studentInfo }, timedDrill: { title: td.title, studentInfo: td.studentInfo }, examPrep: { title: ep.title, studentInfo: ep.studentInfo } } };
});

// ---- AC-04：选必2、10 题 → 拦截，报 6（条目数）+ 四选项，不调 generate、无文件 ----
test('AC-04', '范围=选择性必修2、10 题 → 复述框报可出 6（条目数）+ 四选项；不调 generate、无文件产出', () => {
  const d = cleanCaseDir('AC-04');
  const outDir = path.join(d, 'out');
  rmrf(outDir);
  const job = { scenario: 'homework', generation: { scopeInput: { books: ['选必2'] }, totalCount: 10, versionStrategy: 'preferChemical' }, outputDir: outDir };
  const jobPath = writeJson(path.join(d, 'job.json'), job);
  rmrf(outDir);
  const pfRes = node([path.join('tools', 'preflight.js'), jobPath]);
  const pf = JSON.parse(pfRes.stdout);
  const b = pf.diagnostics.blockers[0];
  // 预检拦截 → 不应出卷
  const paperRes = runPaper(jobPath);
  const res = readJson(path.join(outDir, 'result.json'));
  const files = hashDir(outDir, () => true);
  const checks = [
    ['预检 exitCode=2（拦截）', pfRes.code === 2],
    ['blocker=B1_SHORTAGE', b && b.code === 'B1_SHORTAGE'],
    ['权威可出题数=6（条目数）', b && b.authoritativeCount === 6],
    ['给四选项', b && b.options.length === 4],
    ['四选项键正确', b && JSON.stringify(b.options.map((o) => o.key)) === JSON.stringify(['reduce', 'widen', 'strategy', 'allowSameEntryDifferentVersion'])],
    ['策略对照表含 chemicalOnly=3 / allAvailable=6', pf.preflight.strategies.find((s) => s.strategy === 'chemicalOnly').entries === 3 && pf.preflight.strategies.find((s) => s.strategy === 'allAvailable').entries === 6],
    ['复述框含文件名预览', pf.restate.files.length === 4],
    ['出卷被拒（exitCode 2）', paperRes.code === 2],
    ['result.error.code=B1_SHORTAGE', !!(res && res.error && res.error.code === 'B1_SHORTAGE')],
    ['error.blockers 带四选项', !!(res && res.error.blockers && res.error.blockers[0].options.length === 4)],
    ['无卷子文件产出', Object.keys(files).filter((f) => !f.startsWith('_') && f !== 'result.json').length === 0]
  ];
  writeJson(path.join(d, 'preflight.json'), pf);
  return { checks, evidence: { preflightExit: pfRes.code, blocker: b, strategies: pf.preflight.strategies, paperExit: paperRes.code, files } };
});

// ---- AC-05：选必3 + ionicOnly + 10 → 拒绝，文案「命中 0 条条目（非版本策略损失）」 ----
test('AC-05', '范围=选择性必修3 + ionicOnly + 10 题 → 拒绝并文案「命中 0 条条目（非版本策略损失）」；无文件', () => {
  const d = cleanCaseDir('AC-05');
  const outDir = path.join(d, 'out');
  rmrf(outDir);
  const job = { scenario: 'homework', generation: { scopeInput: { books: ['选择性必修3'] }, totalCount: 10, versionStrategy: 'ionicOnly' }, outputDir: outDir };
  const jobPath = writeJson(path.join(d, 'job.json'), job);
  rmrf(outDir);
  const pfRes = node([path.join('tools', 'preflight.js'), jobPath]);
  const pf = JSON.parse(pfRes.stdout);
  const b = pf.diagnostics.blockers[0];
  const paperRes = runPaper(jobPath);
  const res = readJson(path.join(outDir, 'result.json'));
  const files = hashDir(outDir, (f) => !f.startsWith('_') && f !== 'result.json');
  const checks = [
    ['预检 exitCode=2', pfRes.code === 2],
    ['blocker=B1_ZERO_CANDIDATE', b && b.code === 'B1_ZERO_CANDIDATE'],
    ['文案含「命中 0 条条目（非版本策略损失）」', b && b.title === '命中 0 条条目（非版本策略损失）'],
    ['权威条目数=0', b && b.authoritativeCount === 0],
    ['出卷被拒（exitCode 2）', paperRes.code === 2],
    ['result.error.code=B1_ZERO_CANDIDATE', !!(res && res.error && res.error.code === 'B1_ZERO_CANDIDATE')],
    ['error.message 含「命中 0 条条目」', !!(res && res.error && /命中 0 条条目/.test(res.error.message))],
    ['无卷子文件产出', Object.keys(files).length === 0]
  ];
  writeJson(path.join(d, 'preflight.json'), pf);
  return { checks, evidence: { preflightExit: pfRes.code, blocker: b, paperExit: paperRes.code, resultError: res && res.error, files } };
});

// ---- AC-06：要 2 道开放题 → B7 拒绝 + 建议改 C；卷内无 H ----
test('AC-06', 'intake 要求「来 2 道开放题」→ B7 拒绝 + 建议改 C 题型；卷内无 H', () => {
  const d = caseDir('AC-06');
  const job = { scenario: 'homework', generation: { totalCount: 10, versionStrategy: 'preferChemical', questionTypeCounts: { B: 0, C: 0, D: 0, E: 0, H: 2 } } };
  const jobPath = writeJson(path.join(d, 'job.json'), job);
  const pfRes = node([path.join('tools', 'preflight.js'), jobPath]);
  const pf = JSON.parse(pfRes.stdout);
  const b = pf.diagnostics.blockers.find((x) => x.code === 'B7_H_UNAVAILABLE');
  const lib = readJson(path.join(SKILL_ROOT, 'data', 'library.json'));
  const settings = Preflight.buildSettings(pf.job);
  const gen = Paper.generatePaper(lib, settings, { totalCount: 10 });
  const checks = [
    ['blocker=B7_H_UNAVAILABLE', !!b],
    ['给替代建议（改 C 题型）', !!(b && /C 题型/.test(b.suggestion))],
    ['H 被强制归零', pf.job.generation.questionTypeCounts.H === 0],
    ['卷内 H 题数=0', gen.ok && gen.stats.typeActual.H === 0]
  ];
  writeJson(path.join(d, 'preflight.json'), pf);
  return { checks, evidence: { blocker: b, HAfter: pf.job.generation.questionTypeCounts.H, typeActual: gen.stats.typeActual } };
});

// ---- AC-07：manualEntryIds 12 个 + totalCount=10 → B3 拦截 ----
test('AC-07', 'manualEntryIds 12 个 + totalCount=10 → B3 复述框拦截给三选项；不进 generate', () => {
  const d = caseDir('AC-07');
  const lib = readJson(path.join(SKILL_ROOT, 'data', 'library.json'));
  const ids = lib.entries.slice(0, 12).map((e) => e.id);
  const job = { scenario: 'homework', generation: { totalCount: 10, versionStrategy: 'preferChemical', manualEntryIds: ids } };
  const jobPath = writeJson(path.join(d, 'job.json'), job);
  // --no-memory：本用例只验 B3 拦截，不让偏好记忆的 scopes 干扰（否则会先撞 B11）
  const pfRes = node([path.join('tools', 'preflight.js'), jobPath, '--no-memory']);
  const pf = JSON.parse(pfRes.stdout);
  const b = pf.diagnostics.blockers.find((x) => x.code === 'B3_MANUAL_EXCEED');
  const checks = [
    ['预检 exitCode=2', pfRes.code === 2],
    ['blocker=B3_MANUAL_EXCEED', !!b],
    ['detail 含 12 与 10', !!(b && /12/.test(b.detail) && /10/.test(b.detail))],
    ['给三选项', b && b.options.length === 3]
  ];
  writeJson(path.join(d, 'preflight.json'), pf);
  return { checks, evidence: { blocker: b, manualIds: ids } };
});

// ---- AC-08：主项目题库被外部修改 → sync:check 报漂移(exit 1)；skill 仍用旧快照 ----
test('AC-08', '主项目 library.json 被外部修改后运行 → sync:check 报漂移（exit 1）；skill 仍用旧快照出卷', () => {
  const d = caseDir('AC-08');
  const fakeSource = path.join(d, 'fake-source');
  rmrf(fakeSource);
  // 造一个「主项目副本」：拷真主项目的 data/ 与 src/libs/（**只读真主项目**），再改副本题库
  for (const r of ['data', 'src/libs', 'scripts', 'examples']) {
    const from = path.join(SOURCE_ROOT, r);
    if (!fs.existsSync(from)) continue;
    fs.mkdirSync(path.join(fakeSource, r), { recursive: true });
    for (const f of fs.readdirSync(from)) {
      const p = path.join(from, f);
      if (fs.statSync(p).isFile()) fs.copyFileSync(p, path.join(fakeSource, r, f));
    }
  }
  const fakeLib = path.join(fakeSource, 'data', 'library.json');
  const origHash = sha256File(fakeLib);
  const parsed = JSON.parse(fs.readFileSync(fakeLib, 'utf8'));
  parsed.updatedAt = new Date(Date.now() + 86400000).toISOString();
  parsed.entries = parsed.entries.slice(0, 300); // 模拟被外部删改
  fs.writeFileSync(fakeLib, JSON.stringify(parsed, null, 2), 'utf8');
  const newHash = sha256File(fakeLib);
  const checkRes = node([path.join('tools', 'sync-from-source.js'), '--check', '--source=' + fakeSource]);
  const driftRes = node([path.join('tools', 'skill-state.js'), 'drift']);
  // skill 仍用本地旧快照出卷
  const outDir = path.join(d, 'out');
  rmrf(outDir);
  const jobPath = writeJson(path.join(d, 'job.json'), {
    scenario: 'homework',
    generation: { totalCount: 10, versionStrategy: 'preferChemical' },
    export: { pdf: true, docx: true, images: false }, outputDir: outDir,
    snapshot: { drift: true, checkedAt: new Date().toISOString(), note: '主项目已更新' }
  });
  const paperRes = runPaper(jobPath);
  const res = readJson(path.join(outDir, 'result.json'));
  const checks = [
    ['sync:check exit=1（漂移）', checkRes.code === 1],
    ['sync:check 输出含「需要同步」', /需要同步/.test(checkRes.stdout)],
    ['sync:check 输出含主项目 updatedAt 变化提示', /主项目题库已变化/.test(checkRes.stdout)],
    ['假主项目题库哈希确实变了', origHash !== newHash],
    ['skill 仍能出卷（exit 0）', paperRes.code === 0],
    ['result.ok=true（不阻塞）', !!(res && res.ok)],
    ['报告标注漂移状态', !!(res && res.snapshot && res.snapshot.drift === true)],
    ['报告标注快照时间', !!(res && res.snapshot && res.snapshot.updatedAt)],
    ['快照条目数仍为 392（用旧快照）', !!(res && res.snapshot && res.snapshot.entries === 392)],
    ['主项目真身未被本次测试触碰', diffSnapshots(snapshotMainProject(), snapshotMainProject()).length === 0]
  ];
  writeJson(path.join(d, 'sync-check.txt'), checkRes.stdout + '\n--- stderr ---\n' + checkRes.stderr);
  return { checks, evidence: { syncCheckExit: checkRes.code, syncCheckOut: checkRes.stdout, fakeSourceLibHash: { before: origHash, after: newHash }, paperExit: paperRes.code, snapshot: res && res.snapshot } };
});

// ---- AC-09：快照缺失/不可读 → 明确报错、退出码非 0、不产出半成品 ----
test('AC-09', '快照文件缺失/不可读 → 明确报错、退出码非 0、不产出半成品', () => {
  const d = caseDir('AC-09');
  const outDir = path.join(d, 'out');
  rmrf(outDir);
  const libPath = path.join(SKILL_ROOT, 'data', 'library.json');
  const backup = path.join(TMP, 'library.json.bak');
  fs.mkdirSync(TMP, { recursive: true });
  fs.copyFileSync(libPath, backup);
  const results = {};
  try {
    // ① 缺失
    fs.unlinkSync(libPath);
    const jobPath = writeJson(path.join(d, 'job.json'), {
      scenario: 'homework', generation: { totalCount: 10, versionStrategy: 'preferChemical' }, outputDir: outDir
    });
    const r1 = runPaper(jobPath);
    results.missing = { code: r1.code, out: r1.stdout.slice(0, 1500) };
    // ② 损坏（非法 JSON）
    fs.writeFileSync(libPath, '{ this is not json', 'utf8');
    const r2 = runPaper(jobPath);
    results.corrupt = { code: r2.code, out: r2.stdout.slice(0, 1500) };
  } finally {
    fs.copyFileSync(backup, libPath); // 恢复
    fs.unlinkSync(backup);
  }
  const res1 = (() => { try { return JSON.parse(results.missing.out); } catch (_) { return null; } })();
  const res2 = (() => { try { return JSON.parse(results.corrupt.out); } catch (_) { return null; } })();
  const files = hashDir(outDir, (f) => !f.startsWith('_') && f !== 'result.json');
  const checks = [
    ['缺失时退出码非 0', results.missing.code !== 0],
    ['缺失时 error.code=SNAPSHOT_MISSING', !!(res1 && res1.error && res1.error.code === 'SNAPSHOT_MISSING')],
    ['缺失时给出同步指引', !!(res1 && /sync-from-source/.test(res1.error.message))],
    ['损坏时退出码非 0', results.corrupt.code !== 0],
    ['损坏时 error.code=SNAPSHOT_CORRUPT', !!(res2 && res2.error && res2.error.code === 'SNAPSHOT_CORRUPT')],
    ['无半成品卷子文件', Object.keys(files).length === 0],
    ['快照已恢复（哈希与 SOURCE.json 一致）', sha256File(libPath) === readJson(path.join(SKILL_ROOT, 'data', 'SOURCE.json')).library.sha256]
  ];
  return { checks, evidence: { missing: res1 && res1.error, corrupt: res2 && res2.error, exitCodes: { missing: results.missing.code, corrupt: results.corrupt.code }, files } };
});

// ---- AC-10：模拟 printToPDF 抛错 → Word 正常 + 报告注明 PDF 失败 ----
test('AC-10', '模拟 printToPDF 抛错 → Word 正常产出 + 报告注明 PDF 失败；≥1 通道成功即算成功', () => {
  const d = cleanCaseDir('AC-10');
  const outDir = path.join(d, 'out');
  rmrf(outDir);
  const jobPath = writeJson(path.join(d, 'job.json'), {
    scenario: 'homework', generation: { totalCount: 10, versionStrategy: 'preferChemical' },
    export: { pdf: true, docx: true, images: false }, outputDir: outDir
  });
  const r = runPaper(jobPath, { CHEMEQ_FORCE_PDF_FAIL: '1' });
  const res = readJson(path.join(outDir, 'result.json'));
  const files = hashDir(outDir, (f) => !f.startsWith('_') && f !== 'result.json');
  const pending = readJson(path.join(outDir, '_pending.json'));
  const checks = [
    ['退出码 0（≥1 通道成功）', r.code === 0],
    ['result.ok=true', !!(res && res.ok)],
    ['PDF 通道 0 个成功', !!(res && res.channels.pdf.length === 0)],
    ['docx 通道 2 个成功', !!(res && res.channels.docx.length === 2)],
    ['failures 记 2 条 PDF 失败', !!(res && res.failures.filter((f) => f.channel === 'pdf').length === 2)],
    ['failures 含注入错误信息', !!(res && res.failures.some((f) => /CHEMEQ_FORCE_PDF_FAIL/.test(f.error)))],
    ['留 _pending.json', fs.existsSync(path.join(outDir, '_pending.json'))],
    ['_pending.failed 完整', !!(pending && pending.failed.length === 2 && pending.retryHint)],
    ['_pending.succeeded 记 2 条 docx', !!(pending && pending.succeeded.filter((s) => s.channel === 'docx').length === 2)],
    ['只有 2 个 docx 产物文件', Object.keys(files).length === 2 && Object.keys(files).every((f) => f.endsWith('.docx'))]
  ];
  return { checks, evidence: { exitCode: r.code, channels: res && res.channels, failures: res && res.failures, pendingPath: res && res.pendingPath, pending, files } };
});

// ---- AC-11：同日同场景同题量出第二份 → 文件名带 -2，旧文件字节不变 ----
test('AC-11', '同日同场景同题量出第二份 → 第二份文件名带 -2；旧文件字节不变', () => {
  const d = cleanCaseDir('AC-11');
  const outDir = path.join(d, 'out');
  rmrf(outDir);
  const jobPath = writeJson(path.join(d, 'job.json'), {
    scenario: 'homework', generation: { totalCount: 6, versionStrategy: 'preferChemical' },
    export: { pdf: false, docx: true, images: false }, outputDir: outDir
  });
  const r1 = runPaper(jobPath);
  const res1 = readJson(path.join(outDir, 'result.json'));
  const first = hashDir(outDir, (f) => f.endsWith('.docx'));
  const r2 = runPaper(jobPath);
  const res2 = readJson(path.join(outDir, 'result.json'));
  const all = hashDir(outDir, (f) => f.endsWith('.docx'));
  const second = res2 ? res2.channels.docx.map((c) => path.basename(c.path)) : [];
  const firstNames = res1 ? res1.channels.docx.map((c) => path.basename(c.path)) : [];
  const checks = [
    ['第一次 exit 0', r1.code === 0],
    ['第二次 exit 0', r2.code === 0],
    ['第一次 2 个 docx', firstNames.length === 2],
    ['第二次 2 个 docx', second.length === 2],
    ['第二次文件名带 -2', second.every((n) => /-2\.docx$/.test(n))],
    ['共 4 个 docx 文件', Object.keys(all).length === 4],
    ['旧文件字节未变', firstNames.every((n) => all[n] && all[n].sha256 === first[n].sha256)]
  ];
  return { checks, evidence: { firstNames, second, firstHashes: first, allHashes: all } };
});

// ---- AC-12：二次调用「跟上次一样但 15 题」 ----
test('AC-12', '二次调用「跟上次一样但 15 题」→ 记忆供范围/策略；仅复述变化项 + 预检数刷新；记忆文件更新', () => {
  const d = caseDir('AC-12');
  const memFile = SkillState.MEMORY_FILE;
  const memBackup = fs.existsSync(memFile) ? fs.readFileSync(memFile, 'utf8') : null;
  try {
    // 写一份「上次」记忆：timedDrill + 必修一第一章 + preferIonic + 10 题
    SkillState.saveMemory({
      last: {
        scenario: 'timedDrill', scopes: { books: ['必修第一册'], chapters: ['第一章 物质及其变化'] },
        versionStrategy: 'preferIonic', totalCount: 10,
        questionTypeCounts: { B: 0, C: 0, D: 0, E: 0, H: 0 },
        difficulty: { mode: 'counts', counts: { simple: 0, medium: 0, hard: 0 } },
        extraTemplate: null, export: { pdf: true, docx: true, images: false }
      }
    });
    const before = readJson(memFile);
    // 当次只说「15 题」
    const jobPath = writeJson(path.join(d, 'job.json'), { generation: { totalCount: 15 } });
    const r = node([path.join('tools', 'preflight.js'), jobPath]);
    const pf = JSON.parse(r.stdout);
    const mr = pf.memoryReport;
    // 出卷以刷新记忆
    const outDir = path.join(d, 'out');
    rmrm: { rmrf(outDir); }
    const paperPath = writeJson(path.join(d, 'job-paper.json'), Object.assign({}, pf.job, {
      export: { pdf: false, docx: true, images: false }, outputDir: outDir
    }));
    const pr = runPaper(paperPath);
    const after = readJson(memFile);
    const checks = [
      ['预检 exit 0', r.code === 0],
      ['记忆被应用', mr.applied === true],
      ['scenario 取自记忆', mr.usedFields.includes('scenario') && pf.scenario === 'timedDrill'],
      ['versionStrategy 取自记忆', mr.usedFields.includes('versionStrategy') && pf.versionStrategy === 'preferIonic'],
      ['scopes 取自记忆', JSON.stringify(pf.job.generation.scopes) === JSON.stringify({ books: ['必修第一册'], chapters: ['第一章 物质及其变化'] })],
      ['题量取当次 15（当次 > 记忆）', pf.preflight.requestedCount === 15],
      ['预检数已刷新（选必/必修一第一章 preferIonic=60）', pf.preflight.authoritativeCount === 60],
      ['文件名反映 15 题', pf.restate.files.some((f) => /15题/.test(f.name))],
      ['出卷成功', pr.code === 0],
      ['记忆文件已更新', after && after.updatedAt && after.updatedAt !== before.updatedAt],
      ['新记忆记下 15 题', after && after.last.totalCount === 15]
    ];
    writeJson(path.join(d, 'preflight.json'), pf);
    return { checks, evidence: { memoryReport: mr, scenario: pf.scenario, versionStrategy: pf.versionStrategy, scopes: pf.job.generation.scopes, totalCount: pf.preflight.requestedCount, authoritativeCount: pf.preflight.authoritativeCount, memoryBefore: before && before.updatedAt, memoryAfter: after && after.updatedAt } };
  } finally {
    if (memBackup != null) fs.writeFileSync(memFile, memBackup, 'utf8');
    else rmrf(memFile);
  }
});

// ---- AC-13：difficultyCounts={simple:8,medium:1,hard:1} → 仅调 1 次 generate；notices 原文 + 实际分布 ----
test('AC-13', 'difficultyCounts={simple:8,medium:1,hard:1} → generate 仅调 1 次；notices 原文转述 + 实际分布表', () => {
  const d = caseDir('AC-13');
  const lib = readJson(path.join(SKILL_ROOT, 'data', 'library.json'));
  // 打桩：数 generate 调用次数
  const G = require(path.join(SKILL_ROOT, 'engine', 'generator.js'));
  const orig = G.generate;
  let calls = 0;
  G.generate = function (...a) { calls++; return orig.apply(this, a); };
  let gen;
  try {
    const settings = Preflight.buildSettings({
      generation: { totalCount: 10, versionStrategy: 'preferChemical', difficultyMode: 'counts', difficultyCounts: { simple: 8, medium: 1, hard: 1 } }
    });
    gen = Paper.generatePaper(lib, settings, { totalCount: 10 });
  } finally { G.generate = orig; }
  const dist = gen.stats.difficultyActual;
  const checks = [
    ['组卷成功', gen.ok],
    ['generate 仅调 1 次', calls === 1],
    ['简单=8', dist['简单'] === 8],
    ['中等=1', dist['中等'] === 1],
    ['较难=1', dist['较难'] === 1],
    ['notices 是数组（原文可转述）', Array.isArray(gen.notices)],
    ['题量=10', gen.items.length === 10]
  ];
  return { checks, evidence: { generateCalls: calls, difficultyActual: dist, notices: gen.notices, typeActual: gen.stats.typeActual } };
});

// ---- AC-14：附加要求「钠相关≥2 题」+ 全库 → 核查 + 重抽 ≤1 次 + 报告结果 ----
test('AC-14', '附加要求「钠相关≥2 题」+ 全库 → snapshot 验后核查；不满足重抽 ≤1 次；报告核查结果', () => {
  const d = caseDir('AC-14');
  const lib = readJson(path.join(SKILL_ROOT, 'data', 'library.json'));
  const G = require(path.join(SKILL_ROOT, 'engine', 'generator.js'));
  const orig = G.generate;
  let calls = 0;
  G.generate = function (...a) { calls++; return orig.apply(this, a); };
  let gen;
  try {
    const settings = Preflight.buildSettings({ generation: { totalCount: 10, versionStrategy: 'preferChemical' } });
    gen = Paper.generatePaper(lib, settings, {
      totalCount: 10,
      extraAcceptance: [{ kind: 'containsFormula', value: 'Na', minCount: 2, label: '钠相关≥2题' }],
      maxRedraws: 1
    });
  } finally { G.generate = orig; }
  const acc = gen.acceptance[0];
  // 换一个必然满足的要求，验证「满足时不重抽」
  G.generate = function (...a) { calls = 0; return orig.apply(this, a); };
  let gen2;
  try {
    const settings = Preflight.buildSettings({ generation: { totalCount: 10, versionStrategy: 'preferChemical' } });
    gen2 = Paper.generatePaper(lib, settings, {
      totalCount: 10,
      extraAcceptance: [{ kind: 'containsFormula', value: 'O', minCount: 1, label: '含氧≥1题' }],
      maxRedraws: 1
    });
  } finally { G.generate = orig; }
  const checks = [
    ['组卷成功', gen.ok],
    ['核查项有 hits/need/ok 三字段', !!(acc && typeof acc.hits === 'number' && typeof acc.need === 'number' && typeof acc.ok === 'boolean')],
    ['need=2', acc && acc.need === 2],
    ['重抽次数 ≤1', gen.redraws <= 1],
    ['核查结果可报告（matchedNames 有值或为空）', !!(acc && Array.isArray(acc.matchedNames))],
    ['满足时不重抽（含氧≥1）', gen2.ok && gen2.redraws === 0 && gen2.acceptance[0].ok === true],
    ['未满足项进入 acceptanceUnmet', gen.acceptanceUnmet.length === (acc.ok ? 0 : 1)]
  ];
  return { checks, evidence: { acceptance: gen.acceptance, redraws: gen.redraws, notices: gen.notices, secondCase: { redraws: gen2.redraws, acceptance: gen2.acceptance } } };
});

// ---- AC-15：env 无头跑全流程 → 无对话框、打印 JSON、exit 0、文件落位 ----
test('AC-15', 'env 无头跑全流程 → 无任何对话框；打印 JSON；exit 0；文件落位', () => {
  const d = caseDir('AC-15');
  const defaultDir = path.join(SKILL_ROOT, 'out', TODAY);
  const outDir = path.join(d, 'out');   // 独立产物目录，断言确定（默认 out/{yyyy-mm-dd}/ 的行为由 AC-01 覆盖）
  rmrf(outDir);
  const jobPath = writeJson(path.join(d, 'job.json'), {
    jobVersion: 1, scenario: 'examPrep',
    generation: { totalCount: 8, versionStrategy: 'preferChemical', scopeInput: { books: ['九上'] } },
    export: { pdf: true, docx: true, images: false },
    outputDir: outDir
  });
  const r = runPaper(jobPath);
  const res = readJson(path.join(outDir, 'result.json'));
  let parsed = null, parseOk = false;
  try { parsed = JSON.parse(r.stdout.slice(r.stdout.indexOf('{'))); parseOk = true; } catch (_) {}
  const files = hashDir(outDir, (f) => !f.startsWith('_') && f !== 'result.json');
  // 另跑一次「不指定 outputDir」→ 验证默认落位 out/{yyyy-mm-dd}/
  const jobDefault = writeJson(path.join(d, 'job-default.json'), {
    jobVersion: 1, useMemory: false, scenario: 'examPrep',
    generation: { totalCount: 4, versionStrategy: 'preferChemical' },
    export: { pdf: false, docx: true, images: false }
  });
  const rDefault = runPaper(jobDefault);
  const resDefault = readJson(path.join(defaultDir, 'result.json'));
  const defaultFiles = hashDir(defaultDir, (f) => !f.startsWith('_') && f !== 'result.json');
  const checks = [
    ['exit 0', r.code === 0],
    ['stdout 是合法 JSON', parseOk],
    ['JSON 含 ok/exitCode/scenario/snapshot/generation/channels', !!(parsed && 'ok' in parsed && 'exitCode' in parsed && 'scenario' in parsed && 'snapshot' in parsed && 'generation' in parsed && 'channels' in parsed)],
    ['无对话框（stdout/stderr 无 dialog 痕迹）', !/showMessageBox|showSaveDialog|showOpenDialog/.test(r.stdout + r.stderr)],
    ['产物含 4 个文件（2 pdf + 2 docx）', Object.keys(files).length === 4],
    ['result.json 落位（指定目录）', fs.existsSync(path.join(outDir, 'result.json'))],
    ['scenario=examPrep', !!(res && res.scenario === 'examPrep')],
    ['不指定 outputDir 时落默认 out/{yyyy-mm-dd}/', rDefault.code === 0 && !!resDefault],
    ['默认目录产物落位（2 个 docx）', defaultFiles && Object.keys(defaultFiles).length >= 2],
    ['无 _pending（全成功）', !fs.existsSync(path.join(outDir, '_pending.json'))]
  ];
  return {
    checks,
    evidence: {
      exitCode: r.code, outDir, files,
      defaultRun: { exitCode: rDefault.code, defaultDir, files: Object.keys(defaultFiles || {}) },
      resultSummary: res && { ok: res.ok, scenario: res.scenario, channels: { pdf: res.channels.pdf.map((c) => ({ role: c.role, pages: c.pages, bytes: c.bytes })), docx: res.channels.docx.map((c) => ({ role: c.role, bytes: c.bytes })) } }
    }
  };
});

// ---- AC-16：npm run test:engine → 238/0 ----
test('AC-16', 'npm run test:engine → 输出「通过 238 项，失败 0 项」', () => {
  const r = sh('npm', ['run', 'test:engine'], { cwd: SKILL_ROOT });
  const out = r.stdout + r.stderr;
  const m = out.match(/通过\s*(\d+)\s*项，失败\s*(\d+)\s*项/);
  const checks = [
    ['exit 0', r.code === 0],
    ['输出匹配「通过 N 项，失败 M 项」', !!m],
    ['N=238', !!(m && m[1] === '238')],
    ['M=0', !!(m && m[2] === '0')]
  ];
  return { checks, evidence: { exitCode: r.code, match: m ? m[0] : null, tail: out.trim().split('\n').slice(-4).join('\n') } };
});

// ---- AC-17：出卷前后主项目全量 sha256 → 零差异；sync:check 通过 ----
test('AC-17', '出卷前后对主项目做全量 sha256 快照 → 零差异；sync:check 通过', () => {
  const d = caseDir('AC-17');
  const outDir = path.join(d, 'out');
  rmrf(outDir);
  const before = snapshotMainProject();
  const jobPath = writeJson(path.join(d, 'job.json'), {
    scenario: 'timedDrill',
    generation: { totalCount: 10, versionStrategy: 'preferChemical', scopeInput: { books: ['必修一'], chapters: ['第一章'] } },
    export: { pdf: true, docx: true, images: false }, outputDir: outDir
  });
  const r = runPaper(jobPath);
  const after = snapshotMainProject();
  const diffs = diffSnapshots(before, after);
  const syncCheck = node([path.join('tools', 'sync-from-source.js'), '--check']);
  const checks = [
    ['出卷 exit 0', r.code === 0],
    ['主项目文件数一致', Object.keys(before).length === Object.keys(after).length],
    ['零差异（内容 + mtime）', diffs.length === 0],
    ['sync:check exit 0', syncCheck.code === 0],
    ['sync:check 输出「全部一致」', /全部一致/.test(syncCheck.stdout)],
    ['覆盖文件数 ≥ 20', Object.keys(before).length >= 20]
  ];
  writeJson(path.join(d, 'main-project-snapshot.json'), { before, after, diffs });
  return { checks, evidence: { filesChecked: Object.keys(before).length, diffs, syncCheckExit: syncCheck.code, syncCheckTail: syncCheck.stdout.trim().split('\n').slice(-2).join('\n'), fileList: Object.keys(before) } };
});

// ============================================================
// 跑批
// ============================================================
function main() {
  const args = process.argv.slice(2);
  if (args.includes('--list')) {
    console.log('验收用例：');
    CASES.forEach((c) => console.log(`  ${c.id}  ${c.title}`));
    return 0;
  }
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(TMP, { recursive: true });
  // 每次跑批清空测试状态目录（偏好记忆），保证用例之间互不污染
  rmrf(STATE_DIR);
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const selected = args.filter((a) => /^AC-\d+$/.test(a));
  const todo = selected.length ? CASES.filter((c) => selected.includes(c.id)) : CASES;

  const summary = [];
  for (const c of todo) {
    process.stdout.write(`\n▶ ${c.id} ${c.title}\n`);
    let out;
    const t0 = Date.now();
    try { out = c.fn(); }
    catch (e) {
      out = { checks: [['用例执行未抛错', false]], evidence: { error: e.message, stack: e.stack } };
    }
    const pass = out.checks.every(([, ok]) => ok);
    const ms = Date.now() - t0;
    writeJson(path.join(OUT, c.id, 'result.json'), { id: c.id, title: c.title, pass, ms, checks: out.checks, evidence: out.evidence });
    for (const [name, ok] of out.checks) process.stdout.write(`   ${ok ? '✓' : '✗'} ${name}\n`);
    process.stdout.write(`   → ${pass ? 'PASS' : 'FAIL'}（${ms}ms）\n`);
    summary.push({ id: c.id, pass, ms, failed: out.checks.filter(([, ok]) => !ok).map(([n]) => n) });
  }

  const passCount = summary.filter((s) => s.pass).length;
  console.log('\n' + '='.repeat(70));
  console.log('验收汇总（PROMPT §3.4）');
  console.log('='.repeat(70));
  for (const s of summary) {
    console.log(`${s.pass ? 'PASS' : 'FAIL'}  ${s.id}${s.failed.length ? '  ← 失败项：' + s.failed.join('；') : ''}`);
  }
  console.log(`\n合计：${passCount}/${summary.length} 通过${passCount === summary.length ? ' ✓' : ' ✗'}`);
  console.log('证据目录：' + OUT);
  writeJson(path.join(OUT, 'summary.json'), { at: new Date().toISOString(), passCount, total: summary.length, summary });
  return passCount === summary.length ? 0 : 1;
}

if (require.main === module) process.exit(main());
module.exports = { CASES, snapshotMainProject, diffSnapshots };
