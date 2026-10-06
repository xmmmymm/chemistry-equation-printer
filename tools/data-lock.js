#!/usr/bin/env node
/*
 * 数据锁 —— data/ 是**本项目自有数据**（source of truth），不再从主项目同步。
 *
 * data/library.json 与 data/classifications.json 由本项目自持；data/SOURCE.json 里的
 * library / classifications 块记录它们的 sha256 与计数，用于：
 *   ① 检测数据被项目之外的东西改动（app / skill-state 据此提示，**不阻塞出卷**）；
 *   ② 给 `npm run sync:check` 一个可判定的本地基准。
 *
 * 数据合法变更后（手工改题库、跑迁移脚本）必须跑一次本工具重新锁定，
 * 否则 `npm run sync:check` 会报「数据未锁定」并 exit 1。
 *
 * 用法：
 *   node tools/data-lock.js           # 重新锁定（写 data/SOURCE.json 的 library/classifications/lockedAt）
 *   node tools/data-lock.js --check   # 只校验不写；不一致 exit 1
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SKILL_ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(SKILL_ROOT, 'data');
const LIB_PATH = path.join(DATA_DIR, 'library.json');
const CLS_PATH = path.join(DATA_DIR, 'classifications.json');
const META_PATH = path.join(DATA_DIR, 'SOURCE.json');

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function readJsonSafe(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return null; }
}

/** 本项目当前数据指纹（题库 + 分类表） */
function computeDataMeta() {
  const libRaw = fs.readFileSync(LIB_PATH);
  const lib = JSON.parse(libRaw.toString('utf8'));
  if (!lib || !Array.isArray(lib.entries)) throw new Error('data/library.json 结构不合法（缺少 entries 数组）');
  const versions = lib.entries.reduce((a, e) => a + ((e.versions || []).length), 0);
  const clsRaw = fs.existsSync(CLS_PATH) ? fs.readFileSync(CLS_PATH) : null;
  return {
    library: {
      sha256: sha256(libRaw),
      bytes: libRaw.length,
      updatedAt: lib.updatedAt || null,
      entries: lib.entries.length,
      versions
    },
    classifications: clsRaw ? { sha256: sha256(clsRaw), bytes: clsRaw.length } : null
  };
}

function readMeta() { return readJsonSafe(META_PATH) || {}; }

/**
 * 校验数据锁。
 * 返回 { ok, reason, locked, actual }
 *   reason: locked | changed | unlocked | classifications-changed | unreadable
 */
function verifyLock() {
  const meta = readMeta();
  let actual;
  try { actual = computeDataMeta(); }
  catch (e) { return { ok: false, reason: 'unreadable', error: e.message, locked: meta.library || null, actual: null }; }

  const locked = meta.library || null;
  if (!locked || !locked.sha256) return { ok: false, reason: 'unlocked', locked: null, actual: actual.library };
  if (locked.sha256 !== actual.library.sha256) return { ok: false, reason: 'changed', locked, actual: actual.library };

  const lc = meta.classifications || null;
  if (actual.classifications && (!lc || lc.sha256 !== actual.classifications.sha256)) {
    return { ok: false, reason: 'classifications-changed', locked: lc, actual: actual.classifications };
  }
  return { ok: true, reason: 'locked', locked, actual: actual.library };
}

/** 重新锁定：只更新 library / classifications / lockedAt，保留 origin、files、electronRuntime */
function lock() {
  const meta = readMeta();
  const actual = computeDataMeta();
  if (!meta.dataOwnership) meta.dataOwnership = 'local';
  meta.library = { ...actual.library };
  if (actual.classifications) meta.classifications = { ...actual.classifications };
  meta.lockedAt = new Date().toISOString();
  fs.writeFileSync(META_PATH, JSON.stringify(meta, null, 2) + '\n', 'utf8');
  return { meta, actual };
}

const REASON_TEXT = {
  changed: '题库与数据锁不一致（data/library.json 被改动过）',
  'classifications-changed': '分类表与数据锁不一致（data/classifications.json 被改动过）',
  unlocked: '数据尚未锁定（data/SOURCE.json 里没有 library 记录）',
  unreadable: '题库不可读'
};

function main() {
  const check = process.argv.includes('--check');
  if (check) {
    const r = verifyLock();
    if (r.ok) {
      console.log(`✓ 数据已锁定：${r.actual.entries} 条 / ${r.actual.versions} 版本（sha256 ${r.actual.sha256.slice(0, 12)}…）`);
      process.exit(0);
    }
    console.log(`✗ ${REASON_TEXT[r.reason] || r.reason}`);
    if (r.reason === 'changed') {
      console.log(`   锁定：${r.locked.entries} 条 / ${r.locked.versions} 版本  sha256 ${String(r.locked.sha256).slice(0, 12)}…`);
      console.log(`   实际：${r.actual.entries} 条 / ${r.actual.versions} 版本  sha256 ${String(r.actual.sha256).slice(0, 12)}…`);
    }
    if (r.error) console.log('   ' + r.error);
    console.log('   → 数据是合法改动就运行 npm run data:lock 重新锁定；否则检查是谁动了 data/。');
    process.exit(1);
  }

  const { actual } = lock();
  console.log('已重新锁定 data/SOURCE.json');
  console.log(`  data/library.json        ${actual.library.entries} 条 / ${actual.library.versions} 版本  sha256 ${actual.library.sha256.slice(0, 12)}…`);
  if (actual.classifications) console.log(`  data/classifications.json sha256 ${actual.classifications.sha256.slice(0, 12)}…`);
  console.log('  下一步：npm run sync:check 应报「全部一致 ✓」');
}

module.exports = { computeDataMeta, verifyLock, lock, readMeta, LIB_PATH, META_PATH, CLS_PATH, SKILL_ROOT };

if (require.main === module) main();
