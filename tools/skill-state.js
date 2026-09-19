#!/usr/bin/env node
/*
 * skill 运行时状态管理（阶段 5/6）——纯 Node，不依赖 Electron。
 *
 * 子命令：
 *   drift                      快照漂移检测（B12：比对主项目 sha256，不阻塞出卷）
 *   memory                     读偏好记忆（last-run.json），损坏时给系统默认 + 一行说明
 *   memory:save <json|->       写偏好记忆（供人工/agent 调用；app/main.js 出卷后也会自动写）
 *   pending                    列 _pending 未完成项（intake 轮提示用）
 *   archive                    把 >30 天的 _pending 归档到 .dsh/skill-state/archive/（B10）
 *   state                      一次输出 drift + memory + pending（intake 轮一次拿全）
 *   self-test                  自检
 *
 * 落盘位置（全部在**本项目内**，绝不碰主项目）：
 *   .dsh/skill-state/last-run.json       偏好记忆
 *   .dsh/skill-state/archive/            _pending 归档（>30 天）
 *   out/{yyyy-mm-dd}/_pending.json       导出失败留痕（app/main.js 写）
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SKILL_ROOT = path.resolve(__dirname, '..');
const K = require(path.join(SKILL_ROOT, 'engine', 'constants.js'));

// 运行时状态目录。默认 .dsh/skill-state/；可用 CHEMEQ_STATE_DIR 覆盖
// （验收测试用独立目录，避免测试之间互相污染偏好记忆）
const STATE_DIR = process.env.CHEMEQ_STATE_DIR
  ? path.resolve(process.env.CHEMEQ_STATE_DIR)
  : path.join(SKILL_ROOT, '.dsh', 'skill-state');
const MEMORY_FILE = path.join(STATE_DIR, 'last-run.json');
const ARCHIVE_DIR = path.join(STATE_DIR, 'archive');
const OUT_DIR = process.env.CHEMEQ_OUT_DIR ? path.resolve(process.env.CHEMEQ_OUT_DIR) : path.join(SKILL_ROOT, 'out');
const PENDING_MAX_AGE_DAYS = 30;

const SOURCE_ROOT = process.env.CHEMEQ_SOURCE || 'E:\\DSH work\\方程式';

function readJsonSafe(p) {
  try { return { ok: true, value: JSON.parse(fs.readFileSync(p, 'utf8')) }; }
  catch (e) { return { ok: false, error: e.message }; }
}

function assertInsideSkill(p) {
  const rel = path.relative(SKILL_ROOT, path.resolve(p));
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('拒绝写入 skill 项目之外的路径：' + p);
}

/** 状态目录可能被 CHEMEQ_STATE_DIR 覆盖（验收测试用），此时按该目录校验 */
function assertInsideState(p) {
  const base = STATE_DIR;
  const rel = path.relative(base, path.resolve(p));
  if (rel.startsWith('..') || path.isAbsolute(rel)) assertInsideSkill(p);
}

function sha256File(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

// ============================================================
// drift：快照漂移检测（B12）
// ============================================================
function drift() {
  const metaRes = readJsonSafe(path.join(SKILL_ROOT, 'data', 'SOURCE.json'));
  const meta = metaRes.ok ? metaRes.value : null;
  const localLib = path.join(SKILL_ROOT, 'data', 'library.json');
  const out = {
    snapshot: {
      updatedAt: meta && meta.library ? meta.library.updatedAt : null,
      entries: meta && meta.library ? meta.library.entries : null,
      versions: meta && meta.library ? meta.library.versions : null,
      syncedAt: meta ? meta.syncedAt : null,
      sha256: meta && meta.library ? meta.library.sha256 : null,
      sourceProject: meta ? meta.sourceProject : SOURCE_ROOT
    },
    sourceProject: SOURCE_ROOT,
    sourceExists: fs.existsSync(SOURCE_ROOT),
    drift: false,
    files: [],
    note: ''
  };

  // ① 本地快照是否被外部改过（与 SOURCE.json 记录比对）
  if (!fs.existsSync(localLib)) {
    out.drift = true;
    out.note = '本地题库快照缺失 → 运行 node tools/sync-from-source.js';
    out.files.push({ label: 'data/library.json', status: 'missing' });
  } else {
    const localSha = sha256File(localLib);
    out.localSha256 = localSha;
    if (out.snapshot.sha256 && localSha !== out.snapshot.sha256) {
      out.drift = true;
      out.note = '本地快照与 data/SOURCE.json 记录的哈希不一致（快照可能被外部修改）';
      out.files.push({ label: 'data/library.json', status: 'local-drift', expected: out.snapshot.sha256, actual: localSha });
    }
  }

  // ② 主项目题库是否已更新（与快照哈希比对）——需要主项目可读
  const srcLib = path.join(SOURCE_ROOT, 'data', 'library.json');
  if (fs.existsSync(srcLib)) {
    try {
      const srcSha = sha256File(srcLib);
      out.sourceSha256 = srcSha;
      const srcMeta = readJsonSafe(srcLib);
      out.source = {
        updatedAt: srcMeta.ok ? srcMeta.value.updatedAt : null,
        entries: srcMeta.ok && srcMeta.value.entries ? srcMeta.value.entries.length : null,
        versions: srcMeta.ok && srcMeta.value.entries
          ? srcMeta.value.entries.reduce((a, e) => a + ((e.versions || []).length), 0) : null
      };
      if (out.snapshot.sha256 && srcSha !== out.snapshot.sha256) {
        out.drift = true;
        out.note = `快照时间 ${K.fmtDateTime(out.snapshot.updatedAt)} / 主项目已更新 ${K.fmtDateTime(out.source.updatedAt)}`
          + ' → 漂移**不阻塞出卷**，报告里标注即可；要同步请跑 node tools/sync-from-source.js';
        out.files.push({ label: '主项目 data/library.json', status: 'source-newer', expected: out.snapshot.sha256, actual: srcSha });
      } else {
        out.files.push({ label: '主项目 data/library.json', status: 'same' });
      }
    } catch (e) {
      out.files.push({ label: '主项目 data/library.json', status: 'unreadable', error: e.message });
    }
  } else {
    out.files.push({ label: '主项目 data/library.json', status: 'source-missing' });
  }

  if (!out.note) out.note = out.sourceExists ? '快照与主项目一致 ✓' : '主项目路径不可达（只影响漂移检测，不影响出卷）';
  return out;
}

// ============================================================
// memory：偏好记忆（阶段 6）
// ============================================================
const DEFAULT_MEMORY = {
  scenario: 'homework',
  scopes: {},
  versionStrategy: 'preferChemical',
  totalCount: 10,
  questionTypeCounts: { B: 0, C: 0, D: 0, E: 0, H: 0 },
  difficulty: { mode: 'counts', counts: { simple: 0, medium: 0, hard: 0 } },
  extraTemplate: null,
  export: { pdf: true, docx: true, images: false }
};

function memory() {
  if (!fs.existsSync(MEMORY_FILE)) {
    return {
      ok: true, exists: false, corrupted: false, last: null,
      defaults: DEFAULT_MEMORY,
      note: '还没有上次记录（首次使用）→ 按系统默认来'
    };
  }
  const res = readJsonSafe(MEMORY_FILE);
  if (!res.ok) {
    return {
      ok: true, exists: true, corrupted: true, last: null,
      defaults: DEFAULT_MEMORY,
      note: '上次的偏好记录读不出来（文件损坏）→ 这次按系统默认来（不阻塞）',
      error: res.error
    };
  }
  const v = res.value || {};
  return {
    ok: true, exists: true, corrupted: false,
    updatedAt: v.updatedAt || null,
    last: v.last || null,
    defaults: DEFAULT_MEMORY,
    note: v.last ? '已读取上次偏好' : '记忆文件存在但没有 last 段 → 按系统默认来'
  };
}

function saveMemory(payload) {
  assertInsideState(MEMORY_FILE);
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const obj = {
    version: 1,
    updatedAt: K.nowIso(),
    last: payload && payload.last ? payload.last : payload
  };
  const tmp = MEMORY_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8');
  fs.renameSync(tmp, MEMORY_FILE);
  return { ok: true, path: MEMORY_FILE, updatedAt: obj.updatedAt };
}

/**
 * 冲突链：当次 > 记忆 > 默认（§3.1 决策块 11）
 * @param {object} current 当次显式给出的值（只有显式给出的键才算）
 * @returns {{merged, sources}} sources[k] = 'current' | 'memory' | 'default'
 */
function mergeWithMemory(current, mem) {
  mem = mem || memory();
  const m = (mem.last || {});
  const merged = {};
  const sources = {};
  const keys = ['scenario', 'scopes', 'versionStrategy', 'totalCount', 'questionTypeCounts', 'difficulty', 'extraTemplate', 'export'];
  for (const k of keys) {
    const cur = current ? current[k] : undefined;
    const hasCur = cur !== undefined && cur !== null && !(Array.isArray(cur) && !cur.length)
      && !(typeof cur === 'object' && !Array.isArray(cur) && !Object.keys(cur).length);
    if (hasCur) { merged[k] = cur; sources[k] = 'current'; continue; }
    const mv = m[k];
    const hasMem = mv !== undefined && mv !== null;
    if (hasMem) { merged[k] = mv; sources[k] = 'memory'; continue; }
    merged[k] = DEFAULT_MEMORY[k];
    sources[k] = 'default';
  }
  return { merged, sources, memoryExists: !!mem.exists, memoryCorrupted: !!mem.corrupted, note: mem.note };
}

// ============================================================
// pending：失败留痕生命周期（B10）
// ============================================================
function listPending() {
  if (!fs.existsSync(OUT_DIR)) return { ok: true, count: 0, items: [] };
  const items = [];
  for (const d of fs.readdirSync(OUT_DIR)) {
    const dir = path.join(OUT_DIR, d);
    if (!fs.statSync(dir).isDirectory()) continue;
    const p = path.join(dir, '_pending.json');
    if (!fs.existsSync(p)) continue;
    const res = readJsonSafe(p);
    const ageDays = (Date.now() - fs.statSync(p).mtimeMs) / 86400000;
    items.push({
      path: p,
      date: d,
      ageDays: Math.round(ageDays * 10) / 10,
      stale: ageDays > PENDING_MAX_AGE_DAYS,
      createdAt: res.ok ? res.value.createdAt : null,
      failed: res.ok ? (res.value.failed || []).map((f) => `${f.channel}/${f.role}: ${f.error}`) : ['（文件损坏，无法解析）'],
      succeeded: res.ok ? (res.value.succeeded || []).map((s) => `${s.channel}/${s.role}`) : [],
      retryHint: res.ok ? res.value.retryHint : null,
      parseError: res.ok ? null : res.error
    });
  }
  items.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  return {
    ok: true, count: items.length, items,
    hint: items.length
      ? `有 ${items.length} 项未完成导出（最近：${items[0].date}）。intake 轮应提示老师「要现在重试吗？」`
      : '没有未完成的导出 ✓'
  };
}

/** >30 天归档到 .dsh/skill-state/archive/（B10，不是主项目 trash.json） */
function archivePending(force) {
  const listed = listPending();
  const moved = [];
  const skipped = [];
  for (const it of listed.items) {
    if (!it.stale && !force) { skipped.push({ path: it.path, ageDays: it.ageDays, reason: `未满 ${PENDING_MAX_AGE_DAYS} 天` }); continue; }
    assertInsideSkill(it.path);
    const dest = path.join(ARCHIVE_DIR, it.date, '_pending.json');
    assertInsideState(dest);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    // 同名已存在 → 加时间戳后缀
    let target = dest;
    if (fs.existsSync(target)) target = path.join(path.dirname(dest), '_pending-' + Date.now() + '.json');
    fs.renameSync(it.path, target);
    moved.push({ from: it.path, to: target, ageDays: it.ageDays });
  }
  return { ok: true, moved, skipped, archiveDir: ARCHIVE_DIR, maxAgeDays: PENDING_MAX_AGE_DAYS };
}

// ============================================================
// state：一次拿全
// ============================================================
function fullState() {
  return { ok: true, at: K.nowIso(), drift: drift(), memory: memory(), pending: listPending() };
}

// ============================================================
// self-test
// ============================================================
function selfTest() {
  const lines = [];
  let pass = 0, total = 0;
  const check = (name, cond, extra) => {
    total++;
    if (cond) pass++;
    lines.push(`${cond ? '✓' : '✗'} ${name}${extra ? '  ' + extra : ''}`);
  };

  const d = drift();
  check('drift 可调用且带 snapshot', !!d.snapshot && typeof d.drift === 'boolean', `drift=${d.drift} note=${d.note}`);
  check('快照条目数 392', d.snapshot.entries === 392, `entries=${d.snapshot.entries}`);

  const m = memory();
  check('memory 可调用（缺失/损坏都返回默认）', !!m.defaults && typeof m.corrupted === 'boolean', `exists=${m.exists} corrupted=${m.corrupted}`);

  const merged = mergeWithMemory({ totalCount: 15 }, { exists: true, corrupted: false, last: { scenario: 'timedDrill', totalCount: 10, versionStrategy: 'ionicOnly' }, note: '' });
  check('冲突链：当次 > 记忆', merged.merged.totalCount === 15 && merged.sources.totalCount === 'current');
  check('冲突链：记忆 > 默认', merged.merged.scenario === 'timedDrill' && merged.sources.scenario === 'memory');
  check('冲突链：缺项取默认', merged.merged.export && merged.sources.export === 'default');

  const p = listPending();
  check('pending 可调用', typeof p.count === 'number', `count=${p.count}`);

  const a = archivePending(false);
  check('archive 只动 >30 天项', Array.isArray(a.moved) && Array.isArray(a.skipped), `moved=${a.moved.length} skipped=${a.skipped.length}`);

  const fs2 = fullState();
  check('state 汇总三块', !!(fs2.drift && fs2.memory && fs2.pending));

  console.log('skill-state 自检：');
  console.log(lines.join('\n'));
  console.log(`\n结果：${pass}/${total} 通过${pass === total ? ' ✓' : ' ✗'}`);
  return pass === total ? 0 : 1;
}

// ============================================================
// CLI
// ============================================================
function main() {
  const cmd = (process.argv[2] || 'state').replace(/^--/, '');
  switch (cmd) {
    case 'drift': console.log(JSON.stringify(drift(), null, 2)); break;
    case 'memory': console.log(JSON.stringify(memory(), null, 2)); break;
    case 'memory:save': {
      const arg = process.argv[3];
      let payload;
      if (!arg || arg === '-') {
        payload = JSON.parse(fs.readFileSync(0, 'utf8'));
      } else {
        payload = JSON.parse(fs.readFileSync(path.resolve(arg), 'utf8'));
      }
      console.log(JSON.stringify(saveMemory(payload), null, 2));
      break;
    }
    case 'pending': console.log(JSON.stringify(listPending(), null, 2)); break;
    case 'archive': console.log(JSON.stringify(archivePending(process.argv.includes('--force')), null, 2)); break;
    case 'merge': {
      const arg = process.argv[3];
      const current = arg ? JSON.parse(fs.readFileSync(path.resolve(arg), 'utf8')) : {};
      console.log(JSON.stringify(mergeWithMemory(current), null, 2));
      break;
    }
    case 'state': console.log(JSON.stringify(fullState(), null, 2)); break;
    case 'self-test': process.exit(selfTest());
    default:
      console.error('未知子命令：' + cmd);
      console.error('可用：drift | memory | memory:save <json|-> | merge <json> | pending | archive [--force] | state | self-test');
      process.exit(2);
  }
}

module.exports = {
  drift, memory, saveMemory, mergeWithMemory, listPending, archivePending, fullState,
  DEFAULT_MEMORY, MEMORY_FILE, STATE_DIR, ARCHIVE_DIR, OUT_DIR, PENDING_MAX_AGE_DAYS
};

if (require.main === module) main();
