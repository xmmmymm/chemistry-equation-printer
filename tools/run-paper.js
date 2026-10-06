#!/usr/bin/env node
/*
 * 出卷启动器：用**本项目自带的** Electron 运行时启动本项目的无头 app。
 *
 * 用法：
 *   node tools/run-paper.js <job.json>            # 预检 + 复述框 + 覆盖度报告（**不生成卷子**）
 *   node tools/run-paper.js <job.json> --confirmed   # 老师已确认 intake 覆盖度 → 出卷
 *   node tools/run-paper.js <job.json> --keep     # 出错时保留中间产物（不清理临时目录）
 *   node tools/run-paper.js <job.json> --render-check   # 开发期：只渲染卷面并截图（不产出卷子）
 *   node tools/run-paper.js --print-runtime       # 只打印解析到的 electron.exe 路径（诊断）
 *
 * 确认闸门（AC-18）：不带 `--confirmed` 时，app 侧只回 `CONFIRM_REQUIRED` + restate +
 *   intakeCoverage，**一个字节都不写盘**；确认后带 `--confirmed` 才进导出。
 *   豁免：`--render-check`（只截图）与 job 里的 `dryRun:true`（只组卷）不产交付物。
 *
 * 设计要点：
 *   - electron.exe 是**通用运行时**：`electron.exe <app目录>` 可运行任意 Electron 应用。
 *   - 运行时实体在本项目 `runtime/electron/`（v33.4.11，268MB，由 tools/install-runtime.js 装入），
 *     **不再借用主项目那份**——本项目零项目外依赖。
 *   - 解析顺序：`CHEMEQ_ELECTRON` 环境变量（显式覆盖，允许项目外但会告警）
 *     → data/SOURCE.json 的 electronRuntime.path（**必须是本项目内的路径**）
 *     → `runtime/electron/electron.exe`。除显式覆盖外，**任何项目外路径一律拒绝**，
 *     防止悄悄退回外部依赖。
 *   - stdio 用 'inherit'（不是 'pipe'）：本机沙箱下 pipe 捕获会 EPERM，inherit 才能正常回显。
 *   - 本脚本只负责"启动 + 转发退出码"，不做任何业务逻辑。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const SKILL_ROOT = path.resolve(__dirname, '..');

/** 路径必须落在本项目内（零项目外依赖的硬约束） */
function insideSkill(p) {
  const rel = path.relative(SKILL_ROOT, path.resolve(p));
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function resolveElectron() {
  const meta = (() => {
    try { return JSON.parse(fs.readFileSync(path.join(SKILL_ROOT, 'data', 'SOURCE.json'), 'utf8')); }
    catch (_) { return null; }
  })();
  const fromMeta = meta && meta.electronRuntime && meta.electronRuntime.path;
  const envOverride = process.env.CHEMEQ_ELECTRON || null;
  if (envOverride && fs.existsSync(envOverride) && !insideSkill(envOverride)) {
    console.error('⚠ CHEMEQ_ELECTRON 指向项目外路径（' + envOverride + '）——本项目设计为自带运行时，请尽快改用 runtime/electron/。');
  }
  const candidates = [
    envOverride,
    fromMeta && insideSkill(fromMeta) ? fromMeta : null,
    path.join(SKILL_ROOT, 'runtime', 'electron', 'electron.exe')
  ];
  for (const c of candidates) if (c && fs.existsSync(c)) return c;
  return null;
}

const jobPath = process.argv[2];
if (!jobPath || jobPath === '--print-runtime') {
  if (jobPath === '--print-runtime') {
    const e = resolveElectron();
    if (e) { console.log(e); process.exit(0); }
    console.error('✗ 本项目缺少 Electron 运行时（runtime/electron/electron.exe）');
    console.error('  → node tools/install-runtime.js [--from=<Electron dist 目录>]');
    process.exit(4);
  }
  console.error('用法：node tools/run-paper.js <job.json>　｜　node tools/run-paper.js --print-runtime');
  process.exit(2);
}
const absJob = path.resolve(jobPath);
if (!fs.existsSync(absJob)) {
  console.error('job.json 不存在：' + absJob);
  process.exit(2);
}

const appEntry = path.join(SKILL_ROOT, 'app', 'main.js');
if (!fs.existsSync(appEntry)) {
  console.error('无头入口尚未实现：' + appEntry);
  console.error('→ 见 PROMPT-方程式出题skill.md 阶段 4');
  process.exit(3);
}

const electron = resolveElectron();
if (!electron) {
  console.error('找不到 Electron 运行时。本项目自带那份应位于：');
  console.error('  ' + path.join(SKILL_ROOT, 'runtime', 'electron', 'electron.exe'));
  console.error('→ 跑 node tools/install-runtime.js [--from=<Electron dist 目录>] 装入；');
  console.error('  或设 CHEMEQ_ELECTRON=<本项目内的 electron.exe 路径>（仅诊断用，不接受项目外路径）。');
  process.exit(4);
}

const childEnv = Object.assign({}, process.env, {
  SKILLJOB: absJob,
  SKILL_ROOT,
  CHEMEQ_KEEP: process.argv.includes('--keep') ? '1' : '',
  CHEMEQ_MODE: process.argv.includes('--render-check') ? 'render-check' : 'paper',
  // AC-18：intake 覆盖度确认闸门。child 读不到 argv，用 env 传。
  CHEMEQ_CONFIRMED: process.argv.includes('--confirmed') ? '1' : ''
});
// ELECTRON_RUN_AS_NODE=1 会让 electron.exe 退化成**纯 Node**：app/main.js 里
// require('electron') 直接 MODULE_NOT_FOUND，报错完全看不出根因（本机实测踩到 ——
// 一些 Node 工具链 / agent 运行时会全局设这个变量）。本项目要的是真 Electron 主进程
// （PDF 通道靠离屏窗口 printToPDF），所以在这里显式剥掉它，不让宿主环境污染出卷。
delete childEnv.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, [SKILL_ROOT], {
  stdio: 'inherit',
  env: childEnv
});

child.on('exit', (code) => process.exit(code === null ? 1 : code));
child.on('error', (e) => {
  console.error('启动 Electron 失败：' + e.message);
  process.exit(5);
});
