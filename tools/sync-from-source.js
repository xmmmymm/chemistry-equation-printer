#!/usr/bin/env node
/*
 * 同步「引擎副本」（engine/*.js）——**数据不再同步**。
 *
 * 本项目的数据（data/library.json、data/classifications.json）是**自有数据**（source of truth），
 * 由本项目自持，见 data/SOURCE.json 的 dataOwnership / origin 说明；变更后用 tools/data-lock.js 重新锁定。
 * 本脚本只负责把主项目的 src/libs/*.js 引擎副本拉过来（引擎是代码副本，不是数据）。
 *
 * 用法：
 *   node tools/sync-from-source.js              # 同步 engine 副本，并重写 data/SOURCE.json 的 files / electronRuntime
 *   node tools/sync-from-source.js --check      # 只比对不写入：引擎漂移 + 数据锁一致性；有问题 exit 1
 *
 * 安全保证：
 *   - 本脚本只从主项目 **读取**，只往本 skill 项目内 **写入**；写前断言目标路径在本项目内。
 *   - 主项目的任何文件都不会被修改（含题库、设置、历史、导出目录）。
 *
 * 引擎上游路径解析顺序：--source=<path> → 环境变量 CHEMEQ_SOURCE → data/SOURCE.json 的 sourceProject。
 *   没有配置且上游不在场时，**跳过引擎副本比对**（只报「未配置引擎上游」），数据锁检查照常进行——
 *   本项目可脱离上游独立运行。上游仓库见 README「与上游的关系」。
 *   典型用法：node tools/sync-from-source.js --source=<chemistry-equation-printer 的本地克隆>
 *
 * ── 本地补丁（data/ENGINE-PATCHES.json）────────────────────────────────────────
 * 本项目允许对**个别**引擎副本打本地补丁（见 data/ENGINE-PATCHES.json 的说明）。
 * 登记过的文件不再按「上游哈希 == 本地哈希」判定，而是：
 *     上游哈希 == 登记的 upstreamSha256  且  本地哈希 == 登记的 patchedSha256
 * → 视为一致（**不算漂移**，sync:check 仍 exit 0）。
 * 上游一变，check 立刻报「上游已更新 → 本地补丁需重新评估」并 exit 1；
 * 写模式下则写入上游版本并大声提示补丁失效（不静默保留过期补丁）。
 * 校验命令：node tools/test-engine-patches.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const DataLock = require('./data-lock.js');

const SKILL_ROOT = path.resolve(__dirname, '..');
const META_PATH = path.join(SKILL_ROOT, 'data', 'SOURCE.json');

const args = process.argv.slice(2);
const CHECK = args.includes('--check');
const argSource = (args.find(a => a.startsWith('--source=')) || '').slice('--source='.length);

function readJsonSafe(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return null; }
}

const prevMeta = readJsonSafe(META_PATH) || {};
/** 引擎上游根目录。未配置时为 null → 跳过引擎比对（不影响数据锁与出卷）。 */
const SOURCE_ROOT = (() => {
  const raw = argSource || process.env.CHEMEQ_SOURCE || prevMeta.sourceProject || '';
  return raw ? path.resolve(raw) : null;
})();

// ---------- 同步清单（只含引擎副本；唯一真相源：改这里即可扩展） ----------
// 注：`from` 是函数（而非字符串）——引擎上游未配置时 SOURCE_ROOT 为 null，
// 此时不去拼路径，避免 path.join(null, …) 抛 ERR_INVALID_ARG_TYPE。
const ENGINE_FILES = ['chem.js', 'constants.js', 'generator.js', 'exporter.js', 'docx.js', 'importer.js'];

const JOBS = [
  ...ENGINE_FILES.map(f => ({
    kind: 'engine', label: 'engine/' + f,
    from: () => path.join(SOURCE_ROOT, 'src', 'libs', f),
    to: path.join(SKILL_ROOT, 'engine', f),
    transform: null
  })),
  {
    kind: 'engine', label: 'engine/test-chem.js',
    from: () => path.join(SOURCE_ROOT, 'scripts', 'test-chem.js'),
    to: path.join(SKILL_ROOT, 'engine', 'test-chem.js'),
    // 上游的测试用相对路径引用 src/libs 与 examples；复制后改写为本地路径
    transform: (txt) => txt
      .replace(/\.\.\/src\/libs\//g, './')
      .replace(/\.\.\/examples\/sample-library\.json/g, './fixtures/sample-library.json')
  }, {
    kind: 'engine', label: 'engine/fixtures/sample-library.json',
    from: () => path.join(SOURCE_ROOT, 'examples', 'sample-library.json'),
    to: path.join(SKILL_ROOT, 'engine', 'fixtures', 'sample-library.json'),
    transform: null
  }
];

// ---------- 本地补丁登记表（data/ENGINE-PATCHES.json） ----------
const PATCH_FILE = path.join(SKILL_ROOT, 'data', 'ENGINE-PATCHES.json');
function loadPatches() {
  try {
    const j = JSON.parse(fs.readFileSync(PATCH_FILE, 'utf8'));
    return (j && j.patches) || {};
  } catch (_) { return {}; }
}

// ---------- 工具 ----------
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function assertInsideSkill(p) {
  const rel = path.relative(SKILL_ROOT, p);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('拒绝写入 skill 项目之外的路径：' + p);
  }
}

function readSource(job) {
  const from = job.from();
  if (!fs.existsSync(from)) throw new Error('引擎上游缺少文件：' + from);
  const raw = fs.readFileSync(from);
  const out = job.transform ? Buffer.from(job.transform(raw.toString('utf8')), 'utf8') : raw;
  return out;
}

// ---------- 数据锁（本项目自有数据） ----------
function dataLockLines() {
  const r = DataLock.verifyLock();
  if (r.ok) {
    return { drift: 0, lines: [`  ✓ data/（自有数据，已锁定）：${r.actual.entries} 条 / ${r.actual.versions} 版本`] };
  }
  const text = {
    changed: '题库与数据锁不一致（data/library.json 被改动过）',
    'classifications-changed': '分类表与数据锁不一致',
    unlocked: '数据尚未锁定',
    unreadable: '题库不可读'
  }[r.reason] || r.reason;
  return { drift: 1, lines: [`  ✗ data/  ${text} → 合法改动请跑 npm run data:lock 重新锁定`] };
}

// ---------- 主流程 ----------
function main() {
  const sourceReachable = !!SOURCE_ROOT && fs.existsSync(SOURCE_ROOT);
  const driftLines = [];
  let drift = 0;

  // ① 数据锁：与主项目无关，永远检查
  const dl = dataLockLines();
  drift += dl.drift;
  driftLines.push(...dl.lines);

  // ② 引擎副本：引擎上游不在场时跳过（不报错，本项目可独立运行）
  const lines = [];
  const meta = {
    dataOwnership: prevMeta.dataOwnership || 'local',
    dataNote: prevMeta.dataNote,
    sourceProject: SOURCE_ROOT || prevMeta.sourceProject || null,
    lockedAt: prevMeta.lockedAt || null,
    origin: prevMeta.origin || null,
    library: prevMeta.library || null,
    classifications: prevMeta.classifications || null,
    files: prevMeta.files || {}
  };
  const patches = loadPatches();
  const patchedLabels = [];

  if (!sourceReachable) {
    lines.push(`  · 引擎上游未配置或不可达${SOURCE_ROOT ? `（${SOURCE_ROOT}）` : ''} → 跳过引擎副本上游比对（不影响数据与出卷）` +
      `；需要时用 --source=<克隆路径> 或设 CHEMEQ_SOURCE`);
  } else {
    const filesMeta = {};
    for (const job of JOBS) {
      let src;
      try { src = readSource(job); } catch (e) { lines.push('  ✗ ' + e.message); drift++; continue; }
      const srcHash = sha256(src);
      const exists = fs.existsSync(job.to);
      const dstHash = exists ? sha256(fs.readFileSync(job.to)) : null;
      const same = srcHash === dstHash;
      const patch = patches[job.label] || null;
      filesMeta[job.label] = { sha256: srcHash, bytes: src.length, localPatched: !!patch };

      if (CHECK) {
        if (patch) {
          // 登记过的补丁文件：比「上游有没有变」+「本地补丁有没有被动过」，不比裸哈希
          const upstreamSame = srcHash === patch.upstreamSha256;
          const localSame = exists && dstHash === patch.patchedSha256;
          if (upstreamSame && localSame) { lines.push(`  ✓ ${job.label}（本地补丁，上游未变）`); patchedLabels.push(job.label); }
          else if (!upstreamSame) { lines.push(`  ✗ ${job.label}  上游已更新 → 本地补丁需重新评估（data/ENGINE-PATCHES.json）`); drift++; }
          else if (!exists) { lines.push(`  ✗ ${job.label}  本地缺失`); drift++; }
          else { lines.push(`  ✗ ${job.label}  本地补丁已被改动（与登记哈希不符）`); drift++; }
          continue;
        }
        if (same) lines.push(`  ✓ ${job.label}`);
        else { lines.push(`  ✗ ${job.label}  ${exists ? '内容漂移' : '本地缺失'}`); drift++; }
        continue;
      }

      // ---- 写模式 ----
      if (patch) {
        if (srcHash === patch.upstreamSha256 && dstHash === patch.patchedSha256) {
          lines.push(`  = ${job.label}（本地补丁保留；上游未变）`); patchedLabels.push(job.label); continue;
        }
        if (srcHash !== patch.upstreamSha256) {
          // 上游变了：写入上游版本（不静默保留过期补丁），并大声提示
          assertInsideSkill(job.to);
          fs.mkdirSync(path.dirname(job.to), { recursive: true });
          fs.writeFileSync(job.to, src);
          lines.push(`  ⚠ ${job.label}（上游已更新 → 已写入上游版本，**本地补丁失效**，请重新评估 data/ENGINE-PATCHES.json）`);
          continue;
        }
        // 上游未变但本地被动过：不覆盖（避免丢掉人工修改）
        lines.push(`  ⚠ ${job.label}（本地与登记哈希不符 → 未覆盖；跑 node tools/test-engine-patches.js --update 或人工处理）`);
        continue;
      }
      if (same) { lines.push(`  = ${job.label}（已是最新）`); continue; }
      assertInsideSkill(job.to);
      fs.mkdirSync(path.dirname(job.to), { recursive: true });
      fs.writeFileSync(job.to, src);
      lines.push(`  → ${job.label}${exists ? '（已更新）' : '（新复制）'}`);
    }
    meta.files = { ...meta.files, ...filesMeta };
  }

  console.log(`引擎上游（可选）：${SOURCE_ROOT || '未配置'}${SOURCE_ROOT ? (sourceReachable ? '' : '  【不可达】') : ''}`);
  console.log('数据（本项目自有）：');
  console.log(driftLines.join('\n'));
  console.log('引擎副本：');
  console.log(lines.join('\n'));

  if (CHECK) {
    if (patchedLabels.length) {
      console.log(`\n本地补丁（${patchedLabels.length} 个，上游未变，不计漂移）：${patchedLabels.join('、')}`);
      console.log('  校验：node tools/test-engine-patches.js');
    }
    console.log(drift ? `\n检查结果：${drift} 项需要处理（exit 1）` : '\n检查结果：全部一致 ✓');
    process.exit(drift ? 1 : 0);
  }

  // 记录 Electron 运行时：**本项目自带**（runtime/electron/，由 tools/install-runtime.js 装入）。
  // 主项目那份只作为 install-runtime 的来源候选，记录在 electronRuntime.origin（仅溯源）。
  const localExe = path.join(SKILL_ROOT, 'runtime', 'electron', 'electron.exe');
  let electronVersion = null;
  try { electronVersion = fs.readFileSync(path.join(SKILL_ROOT, 'runtime', 'electron', 'version'), 'utf8').trim(); } catch (_) {}
  meta.electronRuntime = Object.assign({}, prevMeta.electronRuntime, {
    path: localExe,
    exists: fs.existsSync(localExe),
    version: electronVersion || (prevMeta.electronRuntime && prevMeta.electronRuntime.version) || null,
    mode: 'local（本项目自带，runtime/electron/；不依赖项目外）'
  });

  assertInsideSkill(META_PATH);
  fs.writeFileSync(META_PATH, JSON.stringify(meta, null, 2) + '\n', 'utf8');
  console.log('\n已更新 data/SOURCE.json（files / electronRuntime；library 数据锁与 origin 原样保留）');
  if (meta.library) console.log(`数据锁：${meta.library.entries} 条 / ${meta.library.versions} 版本（updatedAt ${meta.library.updatedAt}）`);
  console.log(`Electron 运行时（本项目自带）：${meta.electronRuntime.exists ? meta.electronRuntime.version + ' @ ' + localExe : '未找到（PDF/图片通道将不可用 → 跑 node tools/install-runtime.js）'}`);
  console.log('\n下一步：node engine/test-chem.js 验证引擎副本（应为 238 项全过）');
  if (patchedLabels.length) {
    console.log(`本地补丁保留：${patchedLabels.join('、')}（登记在 data/ENGINE-PATCHES.json）`);
    console.log('校验补丁：node tools/test-engine-patches.js');
  }
}

main();
