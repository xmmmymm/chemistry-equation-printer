#!/usr/bin/env node
/*
 * Electron 运行时安装 / 校验 —— 把一份 Electron dist 复制进本项目 `runtime/electron/`。
 *
 * 为什么自带：本项目要做到**零项目外依赖**。出卷（PDF / Word / 图片）需要 Electron，
 * 所以运行时实体放在 `runtime/electron/`（v33.4.11，268MB / 73 文件），不再借用主项目那份。
 * `runtime/` 已 gitignore（268MB 二进制不入版本库）——新克隆/换机时用本工具重新填充。
 *
 * 用法：
 *   node tools/install-runtime.js                     # 从本项目 node_modules/electron/dist（或 SOURCE.json 记录的来源）复制
 *   node tools/install-runtime.js --from=<dist目录>    # 从指定 Electron dist 目录复制
 *   node tools/install-runtime.js --check             # 只校验 runtime/electron/ 是否可用（缺失/损坏 → exit 1）
 *   node tools/install-runtime.js --print             # 只打印解析到的运行时路径（供 tools/run-paper.js 使用）
 *
 * 复制完成后自动更新 data/SOURCE.json 的 electronRuntime 块（path / exists / version / mode / origin）。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const SKILL_ROOT = path.resolve(__dirname, '..');
const RUNTIME_DIR = path.join(SKILL_ROOT, 'runtime', 'electron');
const EXE = path.join(RUNTIME_DIR, 'electron.exe');
const META_PATH = path.join(SKILL_ROOT, 'data', 'SOURCE.json');
/** 来源 dist 目录候选：--from > data/SOURCE.json 记录的 origin > 本地 node_modules/electron/dist */
const CANDIDATE_SOURCE_DISTS = [
  path.join(SKILL_ROOT, 'node_modules', 'electron', 'dist')
];

function readJsonSafe(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return null; }
}

function readVersion(dir) {
  try { return fs.readFileSync(path.join(dir, 'version'), 'utf8').trim(); } catch (_) { return null; }
}

/** 本项目自带的运行时是否可用 */
function checkRuntime() {
  if (!fs.existsSync(EXE)) return { ok: false, reason: 'missing', exe: EXE };
  return { ok: true, reason: 'ok', exe: EXE, dir: RUNTIME_DIR, version: readVersion(RUNTIME_DIR) };
}

/** 解析来源 dist 目录：--from > SOURCE.json 记录的 origin > 本项目 node_modules/electron/dist */
function resolveSourceDist(argFrom) {
  if (argFrom) return path.resolve(argFrom);
  const meta = readJsonSafe(META_PATH);
  const origin = meta && meta.electronRuntime && meta.electronRuntime.origin;
  if (origin && origin.path) {
    const dir = path.dirname(origin.path);
    if (fs.existsSync(path.join(dir, 'electron.exe'))) return dir;
  }
  for (const c of CANDIDATE_SOURCE_DISTS) {
    if (fs.existsSync(path.join(c, 'electron.exe'))) return c;
  }
  return null;
}

function updateMeta() {
  const meta = readJsonSafe(META_PATH) || {};
  const prev = meta.electronRuntime || {};
  const r = checkRuntime();
  meta.electronRuntime = {
    path: EXE,
    exists: r.ok,
    version: r.ok ? r.version : (prev.version || null),
    mode: 'local（本项目自带，runtime/electron/；不依赖项目外）',
    origin: prev.origin || null,
    sizeMB: r.ok ? Math.round(fs.readdirSync(RUNTIME_DIR).reduce((a, f) => {
      const p = path.join(RUNTIME_DIR, f);
      const st = fs.statSync(p);
      return a + (st.isFile() ? st.size : 0);
    }, 0) / 1048576) : null
  };
  fs.writeFileSync(META_PATH, JSON.stringify(meta, null, 2) + '\n', 'utf8');
  return meta.electronRuntime;
}

function main() {
  const args = process.argv.slice(2);
  const argFrom = (args.find((a) => a.startsWith('--from=')) || '').slice('--from='.length);

  if (args.includes('--print')) {
    const r = checkRuntime();
    console.log(r.ok ? r.exe : '');
    process.exit(r.ok ? 0 : 1);
  }

  if (args.includes('--check')) {
    const r = checkRuntime();
    if (r.ok) {
      console.log(`✓ Electron 运行时就绪（本项目自带）：${r.exe}`);
      console.log(`  版本 ${r.version}　目录 ${r.dir}`);
      process.exit(0);
    }
    console.log('✗ 本项目缺少 Electron 运行时：' + r.exe);
    console.log('  → 跑 node tools/install-runtime.js 装入（自动找本项目 node_modules/electron/dist，或用 --from=<dist 目录>）；');
    console.log('    还没有 Electron 就先跑：npm i --no-save electron@33.4.11');
    console.log('    或设置 CHEMEQ_ELECTRON=<electron.exe 绝对路径> 临时指定（仅诊断用）。');
    process.exit(1);
  }

  // ---- 安装 ----
  const src = resolveSourceDist(argFrom);
  if (!src || !fs.existsSync(path.join(src, 'electron.exe'))) {
    console.error('✗ 找不到可用的 Electron dist 目录' + (src ? '：' + src : ''));
    console.error('  → 装一个 Electron 再复制进来，两选一：');
    console.error('    1) npm i --no-save electron@33.4.11   （装进本项目 node_modules/electron/dist，随后重跑本命令）');
    console.error('    2) node tools/install-runtime.js --from=<已装 Electron 的 dist 目录>');
    process.exit(2);
  }
  const srcVersion = readVersion(src);
  console.log('来源：' + src + (srcVersion ? `（v${srcVersion}）` : ''));

  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  const t0 = Date.now();
  fs.cpSync(src, RUNTIME_DIR, { recursive: true, force: true });
  const r = checkRuntime();
  if (!r.ok) { console.error('✗ 复制后仍找不到 electron.exe：' + EXE); process.exit(3); }

  const meta = readJsonSafe(META_PATH) || {};
  meta.electronRuntime = Object.assign({}, meta.electronRuntime, {
    origin: {
      note: '本项目运行时的来源（仅溯源；运行时实体已复制进 runtime/electron/，不再依赖该路径）',
      path: path.join(src, 'electron.exe'),
      version: srcVersion,
      copiedAt: new Date().toISOString()
    }
  });
  fs.writeFileSync(META_PATH, JSON.stringify(meta, null, 2) + '\n', 'utf8');
  const finalMeta = updateMeta();

  const bytes = (function walk(d) {
    let n = 0;
    for (const f of fs.readdirSync(d)) {
      const p = path.join(d, f);
      const st = fs.statSync(p);
      n += st.isDirectory() ? walk(p) : st.size;
    }
    return n;
  })(RUNTIME_DIR);

  console.log(`→ 已复制到 ${RUNTIME_DIR}`);
  console.log(`  文件 ${(function count(d) { let n = 0; for (const f of fs.readdirSync(d)) { const p = path.join(d, f); n += fs.statSync(p).isDirectory() ? count(p) : 1; } return n; })(RUNTIME_DIR)} 个　${(bytes / 1048576).toFixed(1)} MB　用时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`  版本 ${finalMeta.version}　校验：node tools/install-runtime.js --check`);
  console.log('  下一步：node tools/run-paper.js --print-runtime 应指向本项目 runtime/electron/electron.exe');
}

module.exports = { checkRuntime, resolveSourceDist, RUNTIME_DIR, EXE, META_PATH, SKILL_ROOT };

if (require.main === module) main();
