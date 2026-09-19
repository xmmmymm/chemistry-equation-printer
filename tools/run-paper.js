#!/usr/bin/env node
/*
 * 出卷启动器：用「借用的」Electron 运行时启动本项目的无头 app。
 *
 * 用法：
 *   node tools/run-paper.js <job.json>            # 出卷（job.json 见 PROMPT §4.2）
 *   node tools/run-paper.js <job.json> --keep     # 出错时保留中间产物（不清理临时目录）
 *
 * 设计要点：
 *   - electron.exe 是**通用运行时**：`electron.exe <app目录>` 可运行任意 Electron 应用。
 *     因此本项目不复制 180MB 运行时，只借用主项目那份（路径见 data/SOURCE.json）。
 *   - stdio 用 'inherit'（不是 'pipe'）：本机沙箱下 pipe 捕获会 EPERM，inherit 才能正常回显。
 *   - 本脚本只负责"启动 + 转发退出码"，不做任何业务逻辑。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const SKILL_ROOT = path.resolve(__dirname, '..');

function resolveElectron() {
  if (process.env.CHEMEQ_ELECTRON && fs.existsSync(process.env.CHEMEQ_ELECTRON)) {
    return process.env.CHEMEQ_ELECTRON;
  }
  const meta = (() => {
    try { return JSON.parse(fs.readFileSync(path.join(SKILL_ROOT, 'data', 'SOURCE.json'), 'utf8')); }
    catch (_) { return null; }
  })();
  const fromMeta = meta && meta.electronRuntime && meta.electronRuntime.path;
  if (fromMeta && fs.existsSync(fromMeta)) return fromMeta;
  // 最后兜底：主项目默认位置
  const fallback = 'E:/DSH work/方程式/node_modules/electron/dist/electron.exe';
  if (fs.existsSync(fallback)) return fallback;
  return null;
}

const jobPath = process.argv[2];
if (!jobPath) {
  console.error('用法：node tools/run-paper.js <job.json>');
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
  console.error('找不到 Electron 运行时。请设置 CHEMEQ_ELECTRON=<electron.exe 绝对路径>，');
  console.error('或先运行 node tools/sync-from-source.js 记录运行时位置。');
  process.exit(4);
}

const child = spawn(electron, [SKILL_ROOT], {
  stdio: 'inherit',
  env: Object.assign({}, process.env, {
    SKILLJOB: absJob,
    SKILL_ROOT,
    CHEMEQ_KEEP: process.argv.includes('--keep') ? '1' : ''
  })
});

child.on('exit', (code) => process.exit(code === null ? 1 : code));
child.on('error', (e) => {
  console.error('启动 Electron 失败：' + e.message);
  process.exit(5);
});
