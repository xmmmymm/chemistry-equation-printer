#!/usr/bin/env node
/*
 * 从「方程式主项目」同步数据快照与引擎副本。
 *
 * 用法：
 *   node tools/sync-from-source.js              # 同步 data + engine + fixtures，并重写 data/SOURCE.json
 *   node tools/sync-from-source.js --check      # 只比对，不写入；发现漂移则 exit 1
 *   node tools/sync-from-source.js --data-only  # 只同步/检查数据快照（不动引擎）
 *
 * 安全保证：
 *   - 本脚本只从主项目 **读取**，只往本 skill 项目内 **写入**；写前断言目标路径在本项目内。
 *   - 主项目的任何文件都不会被修改（含题库、设置、历史、导出目录）。
 *
 * 主项目路径解析顺序：--source=<path> → 环境变量 CHEMEQ_SOURCE → 默认 'E:/DSH work/方程式'
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SKILL_ROOT = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
const CHECK = args.includes('--check');
const DATA_ONLY = args.includes('--data-only');
const argSource = (args.find(a => a.startsWith('--source=')) || '').slice('--source='.length);
const SOURCE_ROOT = path.resolve(
  argSource || process.env.CHEMEQ_SOURCE || 'E:/DSH work/方程式'
);

// ---------- 同步清单（唯一真相源：改这里即可扩展） ----------
const ENGINE_FILES = ['chem.js', 'constants.js', 'generator.js', 'exporter.js', 'docx.js', 'importer.js'];
const DATA_FILES = ['library.json', 'classifications.json'];

const JOBS = [
  ...DATA_FILES.map(f => ({
    kind: 'data', label: 'data/' + f,
    from: path.join(SOURCE_ROOT, 'data', f),
    to: path.join(SKILL_ROOT, 'data', f),
    transform: null
  })),
  ...(DATA_ONLY ? [] : ENGINE_FILES.map(f => ({
    kind: 'engine', label: 'engine/' + f,
    from: path.join(SOURCE_ROOT, 'src', 'libs', f),
    to: path.join(SKILL_ROOT, 'engine', f),
    transform: null
  }))),
  ...(DATA_ONLY ? [] : [{
    kind: 'engine', label: 'engine/test-chem.js',
    from: path.join(SOURCE_ROOT, 'scripts', 'test-chem.js'),
    to: path.join(SKILL_ROOT, 'engine', 'test-chem.js'),
    // 主项目的测试用相对路径引用 src/libs 与 examples；复制后改写为本地路径
    transform: (txt) => txt
      .replace(/\.\.\/src\/libs\//g, './')
      .replace(/\.\.\/examples\/sample-library\.json/g, './fixtures/sample-library.json')
  }, {
    kind: 'engine', label: 'engine/fixtures/sample-library.json',
    from: path.join(SOURCE_ROOT, 'examples', 'sample-library.json'),
    to: path.join(SKILL_ROOT, 'engine', 'fixtures', 'sample-library.json'),
    transform: null
  }])
];

// ---------- 工具 ----------
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function assertInsideSkill(p) {
  const rel = path.relative(SKILL_ROOT, p);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('拒绝写入 skill 项目之外的路径：' + p);
  }
}

function readSource(job) {
  if (!fs.existsSync(job.from)) throw new Error('主项目缺少文件：' + job.from);
  const raw = fs.readFileSync(job.from);
  const out = job.transform ? Buffer.from(job.transform(raw.toString('utf8')), 'utf8') : raw;
  return out;
}

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return fallback; }
}

// ---------- 主流程 ----------
function main() {
  if (!fs.existsSync(SOURCE_ROOT)) {
    console.error('主项目路径不存在：' + SOURCE_ROOT);
    process.exit(2);
  }

  const sourceLibraryPath = path.join(SOURCE_ROOT, 'data', 'library.json');
  const sourceLibrary = readJson(sourceLibraryPath, null);
  const meta = {
    sourceProject: SOURCE_ROOT,
    syncedAt: new Date().toISOString(),
    library: {
      sha256: fs.existsSync(sourceLibraryPath) ? sha256(fs.readFileSync(sourceLibraryPath)) : null,
      updatedAt: sourceLibrary ? sourceLibrary.updatedAt : null,
      entries: sourceLibrary && sourceLibrary.entries ? sourceLibrary.entries.length : null,
      versions: sourceLibrary && sourceLibrary.entries
        ? sourceLibrary.entries.reduce((a, e) => a + ((e.versions || []).length), 0) : null
    },
    files: {}
  };

  let drift = 0;
  const lines = [];

  for (const job of JOBS) {
    let src;
    try { src = readSource(job); } catch (e) { console.error('✗ ' + e.message); drift++; continue; }
    const srcHash = sha256(src);
    const exists = fs.existsSync(job.to);
    const dstHash = exists ? sha256(fs.readFileSync(job.to)) : null;
    const same = srcHash === dstHash;
    meta.files[job.label] = { sha256: srcHash, bytes: src.length };

    if (CHECK) {
      if (same) lines.push(`  ✓ ${job.label}`);
      else { lines.push(`  ✗ ${job.label}  ${exists ? '内容漂移' : '本地缺失'}`); drift++; }
      continue;
    }
    if (same) { lines.push(`  = ${job.label}（已是最新）`); continue; }
    assertInsideSkill(job.to);
    fs.mkdirSync(path.dirname(job.to), { recursive: true });
    fs.writeFileSync(job.to, src);
    lines.push(`  → ${job.label}${exists ? '（已更新）' : '（新复制）'}`);
  }

  console.log(`主项目：${SOURCE_ROOT}`);
  console.log(lines.join('\n'));

  if (CHECK) {
    const prev = readJson(path.join(SKILL_ROOT, 'data', 'SOURCE.json'), null);
    if (prev && prev.library && prev.library.sha256 !== meta.library.sha256) {
      console.log(`\n⚠ 主项目题库已变化：`);
      console.log(`   快照 updatedAt : ${prev.library.updatedAt}  (${prev.library.entries} 条 / ${prev.library.versions} 版本)`);
      console.log(`   主项目 updatedAt: ${meta.library.updatedAt}  (${meta.library.entries} 条 / ${meta.library.versions} 版本)`);
      console.log('   → 运行 node tools/sync-from-source.js 同步，并重跑预检统计。');
    }
    console.log(drift ? `\n检查结果：${drift} 个文件需要同步（exit 1）` : '\n检查结果：全部一致 ✓');
    process.exit(drift ? 1 : 0);
  }

  // 记录 Electron 运行时（借用，不复制）
  const electronExe = path.join(SOURCE_ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
  let electronVersion = null;
  try {
    electronVersion = JSON.parse(
      fs.readFileSync(path.join(SOURCE_ROOT, 'node_modules', 'electron', 'package.json'), 'utf8')
    ).version;
  } catch (_) {}
  meta.electronRuntime = {
    path: electronExe,
    exists: fs.existsSync(electronExe),
    version: electronVersion,
    mode: 'borrowed（借用主项目运行时，不复制、不修改）'
  };

  assertInsideSkill(path.join(SKILL_ROOT, 'data', 'SOURCE.json'));
  fs.writeFileSync(path.join(SKILL_ROOT, 'data', 'SOURCE.json'), JSON.stringify(meta, null, 2));
  console.log('\n已写入 data/SOURCE.json');
  console.log(`题库快照：${meta.library.entries} 条 / ${meta.library.versions} 版本（updatedAt ${meta.library.updatedAt}）`);
  console.log(`Electron 运行时：${meta.electronRuntime.exists ? electronVersion + ' @ ' + electronExe : '未找到（PDF/图片通道将不可用）'}`);
  console.log('\n下一步：node engine/test-chem.js 验证引擎副本（应为 238 项全过）');
}

main();
