/*
 * chem-equation-paper · 无头 Electron 主进程（阶段 4）
 * ============================================================================
 * 入口：electron.exe "<SKILL_ROOT>"（由 tools/run-paper.js 启动，env: SKILLJOB=<job.json 绝对路径>）
 *
 * 流程（规格 §2.7）：
 *   ① 读 job.json
 *   ② require('../engine/generator.js') → 纯 Node 组卷（无需窗口）
 *   ③ require('../engine/docx.js')      → 纯 Node 出 Word（无需窗口）
 *   ④ 需要 DOM 的部分（分页/HTML/图片）→ 离屏窗口加载 app/harness.html
 *      用 executeJavaScript 调 window.__harness.buildDocument(...) 拿 {html,widthMm,heightMm}
 *   ⑤ 用 html 走 PDF / 图片通道（§2.4）
 *   ⑥ 写 result.json → app.exit(0)；失败 → 打印 JSON 错误 → app.exit(非0)
 *
 * 硬性约束：
 *   - **绝不写入主项目**（E:\DSH work\方程式）：本进程只写 SKILL_ROOT 下的 out/ 与 .dsh/skill-state/。
 *   - PDF 的 pageSize 按**英寸**解释 → 必须 mm/25.4 换算（§7 坑 1）。
 *   - 图片量尺寸用 document.body.getBoundingClientRect()（§7 坑 2），且必须**内联**测量脚本。
 *   - 离屏窗口必须 offscreen:true（§7 坑 3）；sandbox:false 才能让 executeJavaScript 走主世界。
 *   - 写文件用 .tmp + rename（§7 坑 11）。
 *   - 各通道独立隔离；≥1 通道成功即算成功（AC-10 / B9）。
 *   - 预检拦截（B1/B3/B6/B7/B11）→ **不进导出**，直接报诊断（AC-04/05/07）。
 */
'use strict';

const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const SKILL_ROOT = path.resolve(__dirname, '..');
const JOB_PATH = process.env.SKILLJOB;
const KEEP_TMP = !!process.env.CHEMEQ_KEEP;

const K = require(path.join(SKILL_ROOT, 'engine', 'constants.js'));
const Paper = require(path.join(SKILL_ROOT, 'engine', 'paper.js'));
const Docx = require(path.join(SKILL_ROOT, 'engine', 'docx.js'));
const Yml = require(path.join(SKILL_ROOT, 'tools', 'yml.js'));
const Preflight = require(path.join(SKILL_ROOT, 'tools', 'preflight.js'));

const MODE = process.env.CHEMEQ_MODE || 'paper';
const RENDER_OUT = process.env.CHEMEQ_RENDER_OUT || path.join(SKILL_ROOT, 'out', '_render-check');

const SOURCE_ROOT = 'E:\\DSH work\\方程式';

// ============================================================
// 工具
// ============================================================
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function sha256File(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

function dateStamp(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function sanitizeName(s) {
  return String(s == null ? '' : s).replace(/[\\/:*?"<>|]/g, '_');
}

/** 原子写：.tmp + rename（§7 坑 11） */
async function writeAtomic(target, data) {
  await fsp.mkdir(path.dirname(target), { recursive: true });
  const tmp = target + '.tmp';
  await fsp.writeFile(tmp, data);
  await fsp.rename(tmp, target);
  return target;
}

/** 断言目标路径在本项目内（防手滑写到主项目） */
function assertInsideSkill(p) {
  const rel = path.relative(SKILL_ROOT, path.resolve(p));
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('拒绝写入 skill 项目之外的路径：' + p);
  }
}

/** 后缀避让 -2 … -99（B14） */
async function resolveOutputPath(dir, base, ext, taken) {
  let name = sanitizeName(base + ext);
  let n = 1;
  while ((taken.has(name) || fs.existsSync(path.join(dir, name))) && n < 100) {
    n += 1;
    name = sanitizeName(base + '-' + n + ext);
  }
  if (n >= 100) throw new Error('文件名避让超过 -99 仍未找到可用名：' + base);
  taken.add(name);
  return path.join(dir, name);
}

// ============================================================
// 快照读取与漂移检测（B12 / AC-09）
// ============================================================
function readSourceMeta() {
  try { return JSON.parse(fs.readFileSync(path.join(SKILL_ROOT, 'data', 'SOURCE.json'), 'utf8')); }
  catch (_) { return null; }
}

function loadLibrary() {
  const libPath = path.join(SKILL_ROOT, 'data', 'library.json');
  if (!fs.existsSync(libPath)) {
    const e = new Error('题库快照缺失：' + libPath + '\n→ 运行 node tools/sync-from-source.js 从主项目同步');
    e.code = 'SNAPSHOT_MISSING';
    throw e;
  }
  let raw;
  try { raw = fs.readFileSync(libPath); }
  catch (err) {
    const e = new Error('题库快照不可读：' + libPath + '（' + err.message + '）');
    e.code = 'SNAPSHOT_UNREADABLE';
    throw e;
  }
  let lib;
  try { lib = JSON.parse(raw.toString('utf8')); }
  catch (err) {
    const e = new Error('题库快照解析失败（文件可能损坏）：' + libPath + '（' + err.message + '）');
    e.code = 'SNAPSHOT_CORRUPT';
    throw e;
  }
  if (!lib || !Array.isArray(lib.entries)) {
    const e = new Error('题库快照结构不合法（缺少 entries 数组）：' + libPath);
    e.code = 'SNAPSHOT_INVALID';
    throw e;
  }
  return { lib, sha256: crypto.createHash('sha256').update(raw).digest('hex'), bytes: raw.length, path: libPath };
}

/** 漂移检测：本地快照 sha256 vs SOURCE.json 记录的 sha256 */
function driftInfo(localSha, jobSnapshot) {
  const meta = readSourceMeta();
  const recorded = meta && meta.library && meta.library.sha256;
  const drift = !!(recorded && localSha && recorded !== localSha);
  const jobDrift = jobSnapshot && typeof jobSnapshot.drift === 'boolean' ? jobSnapshot.drift : null;
  return {
    drift: jobDrift != null ? (jobDrift || drift) : drift,
    localSha256: localSha,
    recordedSha256: recorded || null,
    jobReportedDrift: jobDrift,
    checkedAt: (jobSnapshot && jobSnapshot.checkedAt) || new Date().toISOString(),
    note: drift
      ? '本地题库快照与 data/SOURCE.json 记录的哈希不一致（可能被外部修改）'
      : (jobDrift ? '出卷前 tools/skill-state.js drift 报告主项目题库已更新' : '快照与主项目一致')
  };
}

// ============================================================
// 组卷 + 布局
// ============================================================
/** 预检阻断码：出现这些就不能进导出（B1/B3/B6/B7/B11） */
const BLOCKING_CODES = [
  'B6_AMBIGUOUS', 'B6_UNMATCHED', 'B11_INVALID_MANUAL_ID', 'B3_MANUAL_EXCEED',
  'B7_H_UNAVAILABLE', 'B1_TYPE_UNAVAILABLE', 'B1_SHORTAGE', 'B1_ZERO_CANDIDATE'
];

function runGeneration(library, job) {
  // 预检：归一 + 记忆补全 + 可出题数（条目数权威口径）+ 拦截诊断（B1/B3/B6/B7/B11）
  const pf = Preflight.preflight(job, { library });
  const mergedJob = pf.job;                 // 含记忆补全与归一后的 scopes
  const scenario = pf.scenario || mergedJob.scenario || 'homework';
  const layout = Yml.loadLayout(scenario, mergedJob.layoutOverrides || {});

  const blockers = (pf.diagnostics.blockers || []).filter((b) => BLOCKING_CODES.includes(b.code));
  if (blockers.length) {
    return { blocked: true, pf, blockers, scenario, layout, total: pf.preflight.requestedCount, job: mergedJob };
  }

  const settings = Preflight.buildSettings(mergedJob);
  const total = settings.totalCount;
  const gen = Paper.generatePaper(library, settings, {
    totalCount: total,
    authoritativeCount: pf.preflight.authoritativeCount,
    perItemRules: mergedJob.perItemRules && mergedJob.perItemRules.length ? mergedJob.perItemRules : Paper.defaultPerItemRules(),
    extraAcceptance: mergedJob.extraAcceptance || [],
    maxRedraws: typeof mergedJob.maxRedraws === 'number' ? mergedJob.maxRedraws : 1
  });
  return { blocked: false, settings, layout, pf, gen, total, scenario, job: mergedJob };
}

// ============================================================
// 渲染阶段（离屏窗口 + harness.html）
// ============================================================
async function withRenderWindow(fn) {
  const win = new BrowserWindow({
    show: false,
    // sandbox:false —— executeJavaScript 默认在**隔离世界**执行，那里看不到页面主世界的
    // window.__harness（harness.html 用普通 <script> 定义在主世界）。关掉 sandbox 后
    // executeJavaScript 走主世界，才能调到引擎函数。contextIsolation 仍为 true（无 IPC、无 node 集成）。
    webPreferences: { offscreen: true, contextIsolation: true, sandbox: false }
  });
  try {
    await ensureHarness(win);
    return await fn(win);
  } finally {
    try { win.destroy(); } catch (_) {}
  }
}

/**
 * 加载渲染壳并等它就绪。
 * ⚠ 每次渲染完一卷（loadFile 卷面 html）页面就被替换，window.__harness 随之消失，
 *    所以**每轮渲染前都要重新调用本函数**。
 */
async function ensureHarness(win) {
  await win.loadFile(path.join(__dirname, 'harness.html'));
  let ping = null;
  for (let i = 0; i < 60; i++) {
    try {
      ping = await win.webContents.executeJavaScript('(window.__harness && window.__harness.ping()) || null');
    } catch (_) { ping = null; }
    if (ping && ping.ok) return ping;
    await sleep(50);
  }
  throw new Error('渲染壳未就绪（engine 脚本加载失败）：' + JSON.stringify(ping));
}

/** 在渲染窗口里构建卷面 HTML（question / answer）——每个 mode 各自重载渲染壳 */
async function buildDocuments(win, items, layout) {
  const out = {};
  for (const mode of ['question', 'answer']) {
    await ensureHarness(win);
    const script = `window.__harness.buildDocument(${JSON.stringify(items)}, ${JSON.stringify(layout)}, ${JSON.stringify(mode)})`;
    const r = await win.webContents.executeJavaScript(script);
    if (!r || !r.ok) throw new Error(`构建 ${mode} 卷面失败：` + ((r && r.error) || '未知错误'));
    out[mode] = r;
  }
  return out;
}

// ============================================================
// 导出通道
// ============================================================

/** PDF：离屏窗口 + 临时 html + printToPDF（§2.4 / §7 坑 1） */
async function exportPdf(win, html, widthMm, heightMm, targetPath) {
  // 故障注入（AC-10 验收用）：CHEMEQ_FORCE_PDF_FAIL=1 时让 PDF 通道必失败，
  // 用于验证「通道隔离 + Word 仍正常 + 报告注明 PDF 失败」。
  if (process.env.CHEMEQ_FORCE_PDF_FAIL === '1') {
    throw new Error('故障注入：CHEMEQ_FORCE_PDF_FAIL=1（AC-10 模拟 printToPDF 抛错）');
  }
  const tmpHtml = path.join(os.tmpdir(), 'chemeq_pdf_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.html');
  await fsp.writeFile(tmpHtml, html, 'utf-8');
  try {
    await win.loadFile(tmpHtml);
    await new Promise((resolve) => {
      if (win.webContents.isLoadingMainFrame()) {
        win.webContents.once('did-finish-load', resolve);
        setTimeout(resolve, 5000); // 5s 超时兜底
      } else resolve();
    });
    await sleep(200);
    // ⚠ 此版本 Electron 的 printToPDF pageSize 数值按**英寸**解释（MediaBox = 传入值 × 72pt）。
    //    按 mm 传会产生 5 公里级巨型页面，PDF 查看器渲染失败显示空白。必须 mm → inch。
    const inchW = widthMm / 25.4;
    const inchH = heightMm / 25.4;
    const buf = await win.webContents.printToPDF({
      pageSize: { width: inchW, height: inchH },
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      printBackground: false,
      preferCSSPageSize: false
    });
    if (!buf || !buf.length) throw new Error('printToPDF 返回空 buffer');
    await writeAtomic(targetPath, buf);
    return { bytes: buf.length, pageSizeInch: { width: inchW, height: inchH } };
  } finally {
    await fsp.unlink(tmpHtml).catch(() => {});
  }
}

/** 图片：离屏窗口 + 临时 html + 量 body + setContentSize + capturePage（§2.4 / §7 坑 2/3） */
async function exportImage(win, html, format, targetPath) {
  const tmpHtml = path.join(os.tmpdir(), 'chemeq_img_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.html');
  await fsp.writeFile(tmpHtml, html, 'utf-8');
  try {
    await win.loadFile(tmpHtml);
    await sleep(250);
    // ⚠ 量尺寸脚本必须**内联**：loadFile 已把页面换成图片文档，window.__harness 随之消失。
    //    并且必须用 body 外框尺寸，不用 documentElement.scrollWidth
    //    （后者下限为窗口宽度，会带入右侧空白）——§7 坑 2。
    const size = await win.webContents.executeJavaScript(
      '(() => { const r = document.body.getBoundingClientRect();' +
      ' return { w: Math.max(1, Math.ceil(r.width)), h: Math.max(1, Math.ceil(r.bottom)) }; })()');
    const w = Math.max(1, Math.ceil(size.w));
    const h = Math.max(1, Math.ceil(size.h));
    win.setContentSize(w, h);
    await sleep(150);
    const img = await win.webContents.capturePage();
    if (!img || img.isEmpty()) throw new Error('页面捕获失败（空白图像）');
    const buf = format === 'jpeg' ? img.toJPEG(92) : img.toPNG();
    await writeAtomic(targetPath, buf);
    return { bytes: buf.length, widthPx: w, heightPx: h };
  } finally {
    await fsp.unlink(tmpHtml).catch(() => {});
  }
}

/** Word：纯 Node，不经窗口（§2.4） */
async function exportDocx(items, layout, mode, targetPath) {
  const bytes = Docx.buildDocx(items, layout, mode);       // Uint8Array
  const b64 = Docx.toBase64(bytes);
  const buf = Buffer.from(b64, 'base64');
  await writeAtomic(targetPath, buf);
  return { bytes: buf.length };
}

// ============================================================
// 记忆（阶段 6：last-run.json）
// ============================================================
function updateMemory(job, scenario, settings) {
  // 状态目录可用 CHEMEQ_STATE_DIR 覆盖（验收测试用独立目录，避免污染真实偏好记忆）
  const stateDir = process.env.CHEMEQ_STATE_DIR
    ? path.resolve(process.env.CHEMEQ_STATE_DIR)
    : path.join(SKILL_ROOT, '.dsh', 'skill-state');
  const file = path.join(stateDir, 'last-run.json');
  const payload = {
    version: 1,
    updatedAt: K.nowIso(),
    last: {
      scenario,
      scopes: settings.scopes || {},
      versionStrategy: settings.versionStrategy,
      totalCount: settings.totalCount,
      questionTypeCounts: settings.questionTypeCounts,
      difficulty: {
        mode: settings.difficultyMode,
        counts: settings.difficultyCounts,
        ratios: settings.difficultyRatios
      },
      extraTemplate: (job.extraAcceptance && job.extraAcceptance.length) ? job.extraAcceptance : null,
      export: job.export || null
    }
  };
  try {
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(payload, null, 2), 'utf8');
    return file;
  } catch (e) {
    return null;
  }
}

// ============================================================
// 主流程
// ============================================================
async function main() {
  const startedAt = K.nowIso();

  // ---- ① 读 job.json ----
  if (!JOB_PATH) {
    return finish({
      ok: false, exitCode: 2,
      error: { code: 'NO_JOB', message: '未提供 job.json（env SKILLJOB 为空）。用法：node tools/run-paper.js <job.json>' }
    }, safeOutDir(null));
  }
  if (!fs.existsSync(JOB_PATH)) {
    return finish({
      ok: false, exitCode: 2,
      error: { code: 'JOB_MISSING', message: 'job.json 不存在：' + JOB_PATH }
    }, safeOutDir(null));
  }
  let job;
  try { job = JSON.parse(fs.readFileSync(JOB_PATH, 'utf8')); }
  catch (e) {
    return finish({
      ok: false, exitCode: 2,
      error: { code: 'JOB_INVALID', message: 'job.json 解析失败：' + e.message }
    }, safeOutDir(null));
  }

  // ---- 快照（AC-09：缺失/不可读 → 明确报错、退出码非 0、不产出半成品）----
  let snapInfo;
  try {
    snapInfo = loadLibrary();
  } catch (e) {
    return finish({
      ok: false, exitCode: 3,
      error: { code: e.code || 'SNAPSHOT_ERROR', message: e.message },
      snapshot: null
    }, safeOutDir(job));
  }
  const lib = snapInfo.lib;
  const drift = driftInfo(snapInfo.sha256, job.snapshot);
  const snapshot = {
    updatedAt: lib.updatedAt || null,
    entries: lib.entries.length,
    versions: lib.entries.reduce((a, e) => a + ((e.versions || []).length), 0),
    sha256: snapInfo.sha256,
    bytes: snapInfo.bytes,
    syncedAt: (readSourceMeta() || {}).syncedAt || null,
    drift: drift.drift,
    driftNote: drift.note,
    checkedAt: drift.checkedAt
  };

  // ---- ②③ 组卷（纯 Node）----
  let ctx;
  try {
    ctx = runGeneration(lib, job);
  } catch (e) {
    return finish({
      ok: false, exitCode: 4,
      error: { code: 'GENERATE_FAILED', message: e.message, stack: e.stack },
      snapshot
    }, safeOutDir(job));
  }

  // 预检拦截 → 不进导出，直接报诊断（B1/B3/B6/B7/B11）
  if (ctx.blocked) {
    const primary = ctx.blockers[0];
    return finish({
      ok: false, exitCode: 2,
      error: {
        code: primary.code,
        message: primary.detail || primary.title,
        blockers: ctx.blockers
      },
      scenario: ctx.scenario, snapshot,
      generation: {
        requested: ctx.total, produced: 0,
        authoritativeCount: ctx.pf.preflight.authoritativeCount,
        notices: []
      },
      params: buildParams(ctx.job, ctx.scenario, Preflight.buildSettings(ctx.job), ctx.layout)
    }, resolveOutDir(ctx.job));
  }

  const { settings, layout, pf, gen, total, scenario } = ctx;
  job = ctx.job;   // 用归一 + 记忆补全后的 job（后续 outputDir / export 都按它来）

  if (!gen.ok) {
    // B1：题量不足 / 候选 0 —— 不进导出，报明确原因 + 四选项
    return finish({
      ok: false, exitCode: 5,
      error: {
        code: 'B1_' + String(gen.failure && gen.failure.reason || 'GENERATION_FAILED').toUpperCase(),
        message: (gen.failure && gen.failure.message) || '组卷失败',
        failure: gen.failure
      },
      scenario, snapshot,
      generation: {
        requested: total, produced: gen.items ? gen.items.length : 0,
        authoritativeCount: pf.preflight.authoritativeCount,
        notices: gen.notices || []
      },
      params: buildParams(job, scenario, settings, layout)
    }, resolveOutDir(job));
  }

  // ---- 输出目录 ----
  const outDir = resolveOutDir(job);
  fs.mkdirSync(outDir, { recursive: true });

  const channelsCfg = {
    pdf: job.export ? job.export.pdf !== false : true,
    docx: job.export ? job.export.docx !== false : true,
    images: !!(job.export && job.export.images)
  };
  const baseName = `${dateStamp(new Date())}_${scenario}_${total}题`;
  const suffixes = { question: '_题目', answer: '_答案' };

  const channels = { pdf: [], docx: [], images: [] };
  const failures = [];
  const taken = new Set();

  // ---- dryRun：只组卷不导出 ----
  if (job.dryRun) {
    return finish({
      ok: true, exitCode: 0,
      scenario, snapshot,
      generation: buildGeneration(gen, pf, total),
      channels, failures: [], pendingPath: null,
      params: buildParams(job, scenario, settings, layout),
      itemsPreview: Paper.toItemsJson(gen.items),
      dryRun: true,
      outputDir: outDir
    });
  }

  // ---- ④⑤ 渲染 + 导出 ----
  const needRender = channelsCfg.pdf || channelsCfg.images;
  let docs = null;
  let renderError = null;
  if (needRender) {
    try {
      docs = await withRenderWindow(async (win) => {
        const d = await buildDocuments(win, gen.items, layout);
        // PDF 双卷
        if (channelsCfg.pdf) {
          for (const role of ['question', 'answer']) {
            try {
              const target = await resolveOutputPath(outDir, baseName + suffixes[role], '.pdf', taken);
              const r = await exportPdf(win, d[role].html, d[role].widthMm, d[role].heightMm, target);
              channels.pdf.push({
                role, path: target, bytes: r.bytes, pages: d[role].pages,
                pageSizeMm: { width: d[role].widthMm, height: d[role].heightMm },
                pageSizeInch: r.pageSizeInch,
                overflowCount: d[role].overflowCount
              });
            } catch (e) {
              failures.push({ channel: 'pdf', role, error: e.message, at: K.nowIso() });
            }
          }
        }
        // 图片（点名才产）
        if (channelsCfg.images) {
          try {
            const imgOpts = job.export.imagesOnDemand || {};
            await ensureHarness(win);   // 上一轮 loadFile 已替换页面 → 重新加载渲染壳
            const script = `window.__harness.buildImage(${JSON.stringify(gen.items)}, ${JSON.stringify(imgOpts)})`;
            const r = await win.webContents.executeJavaScript(script);
            if (!r || !r.ok) throw new Error('图片文档构建失败：' + ((r && r.error) || '未知'));
            for (let i = 0; i < r.htmls.length; i++) {
              const role = r.htmls.length === 1 ? 'main' : ('p' + (i + 1));
              try {
                const target = await resolveOutputPath(outDir, baseName + (r.htmls.length === 1 ? '' : '_' + role), '.' + r.ext, taken);
                const ir = await exportImage(win, r.htmls[i], r.format, target);
                channels.images.push({ role, path: target, bytes: ir.bytes, widthPx: ir.widthPx, heightPx: ir.heightPx });
              } catch (e) {
                failures.push({ channel: 'images', role, error: e.message, at: K.nowIso() });
              }
            }
          } catch (e) {
            failures.push({ channel: 'images', role: 'main', error: e.message, at: K.nowIso() });
          }
        }
        return d;
      });
    } catch (e) {
      renderError = e.message;
      // 渲染整体失败 → PDF / 图片两通道都记失败（Word 通道仍继续）
      if (channelsCfg.pdf) {
        failures.push({ channel: 'pdf', role: 'question', error: '渲染阶段失败：' + e.message, at: K.nowIso() });
        failures.push({ channel: 'pdf', role: 'answer', error: '渲染阶段失败：' + e.message, at: K.nowIso() });
      }
      if (channelsCfg.images) failures.push({ channel: 'images', role: 'main', error: '渲染阶段失败：' + e.message, at: K.nowIso() });
    }
  }

  // Word 双卷（纯 Node，不依赖渲染；渲染挂了也能出）
  if (channelsCfg.docx) {
    for (const role of ['question', 'answer']) {
      try {
        const target = await resolveOutputPath(outDir, baseName + suffixes[role], '.docx', taken);
        const r = await exportDocx(gen.items, layout, role === 'answer' ? 'answer' : 'question', target);
        channels.docx.push({ role, path: target, bytes: r.bytes });
      } catch (e) {
        failures.push({ channel: 'docx', role, error: e.message, at: K.nowIso() });
      }
    }
  }

  // ---- 成功判定：≥1 通道成功即成功（AC-10）----
  const successCount = channels.pdf.length + channels.docx.length + channels.images.length;
  const ok = successCount > 0;

  // ---- _pending（B9：只在失败时出现）----
  let pendingPath = null;
  if (failures.length) {
    pendingPath = path.join(outDir, '_pending.json');
    const pending = {
      createdAt: K.nowIso(),
      jobPath: JOB_PATH,
      params: buildParams(job, scenario, settings, layout),
      failed: failures,
      succeeded: [
        ...channels.pdf.map((c) => ({ channel: 'pdf', role: c.role, path: c.path })),
        ...channels.docx.map((c) => ({ channel: 'docx', role: c.role, path: c.path })),
        ...channels.images.map((c) => ({ channel: 'images', role: c.role, path: c.path }))
      ],
      retryHint: '修好环境后重新执行：node tools/run-paper.js ' + JOB_PATH
    };
    try { await writeAtomic(pendingPath, JSON.stringify(pending, null, 2)); }
    catch (e) { failures.push({ channel: 'pending', role: 'meta', error: '写 _pending.json 失败：' + e.message, at: K.nowIso() }); }
  } else {
    // 本次全成功 → 清掉同目录里上一轮的 _pending（若存在）
    const stale = path.join(outDir, '_pending.json');
    if (fs.existsSync(stale)) await fsp.unlink(stale).catch(() => {});
  }

  // ---- 记忆 ----
  const memoryFile = updateMemory(job, scenario, settings);

  return finish({
    ok, exitCode: ok ? 0 : 6,
    scenario, snapshot,
    generation: buildGeneration(gen, pf, total),
    channels, failures, pendingPath,
    params: buildParams(job, scenario, settings, layout),
    outputDir: outDir,
    memoryFile,
    renderError,
    itemsPreview: Paper.toItemsJson(gen.items),
    startedAt, finishedAt: K.nowIso()
  }, outDir);
}

function buildGeneration(gen, pf, total) {
  return {
    requested: total,
    produced: gen.items.length,
    typeActual: gen.stats.typeActual,
    difficultyActual: gen.stats.difficultyActual,
    versionTypeActual: gen.stats.versionTypeActual,
    scopesHit: {
      books: gen.stats.scopesHit.books,
      entries: gen.stats.scopesHit.entries,
      versions: gen.stats.scopesHit.versions,
      authoritativeCount: pf.preflight.authoritativeCount
    },
    notices: gen.notices,
    redraws: gen.redraws,
    perItemRulesApplied: gen.perItemRulesApplied || [],
    acceptance: gen.acceptance || [],
    acceptanceUnmet: gen.acceptanceUnmet || [],
    entryIds: gen.stats.entryIds
  };
}

function buildParams(job, scenario, settings, layout) {
  return {
    skill: 'chem-equation-paper',
    specVersion: '1.1',
    scenario,
    generation: {
      scopes: settings.scopes, exclude: settings.exclude, totalCount: settings.totalCount,
      questionTypeCounts: settings.questionTypeCounts,
      difficultyMode: settings.difficultyMode,
      difficultyCounts: settings.difficultyCounts,
      difficultyRatios: settings.difficultyRatios,
      versionStrategy: settings.versionStrategy,
      allowedVersionTypes: settings.allowedVersionTypes,
      includeMustInclude: false,
      allowDuplicateEntry: false,
      allowSameEntryDifferentVersion: settings.allowSameEntryDifferentVersion,
      manualEntryIds: settings.manualEntryIds
    },
    layout,
    export: job.export || null,
    extraAcceptance: job.extraAcceptance || []
  };
}

/** 解析输出目录：job.outputDir 优先，否则 out/{yyyy-mm-dd}/（恒在本项目内） */
function resolveOutDir(job) {
  const today = dateStamp(new Date());
  const dir = (job && job.outputDir) ? path.resolve(job.outputDir) : path.join(SKILL_ROOT, 'out', today);
  assertInsideSkill(dir);
  return dir;
}

/** 容错版：job 不可信时退回默认目录（错误报告仍要能落盘） */
function safeOutDir(job) {
  try { return resolveOutDir(job); } catch (_) { return path.join(SKILL_ROOT, 'out', dateStamp(new Date())); }
}

/** 输出 JSON → 写 result.json → app.exit(code) */
async function finish(result, outDir) {
  const payload = Object.assign({ ok: false, exitCode: 0 }, result);
  const text = JSON.stringify(payload, null, 2);
  try {
    const dir = outDir || path.join(SKILL_ROOT, 'out', dateStamp(new Date()));
    assertInsideSkill(dir);
    fs.mkdirSync(dir, { recursive: true });
    await writeAtomic(path.join(dir, 'result.json'), text);
    payload.resultPath = path.join(dir, 'result.json');
  } catch (e) {
    payload.resultWriteError = e.message;
  }
  await new Promise((resolve) => {
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n', () => resolve());
  });
  app.exit(payload.exitCode || 0);
}

// ---- 启动 ----
app.disableHardwareAcceleration();
app.on('window-all-closed', () => { /* 无头：窗口销毁不退出，由 finish 决定 */ });
app.whenReady().then(() => {
  const runner = MODE === 'render-check'
    ? require(path.join(__dirname, 'lib', 'render-check.js')).run({
        BrowserWindow, jobPath: JOB_PATH, outDir: RENDER_OUT
      }).then((r) => {
        process.stdout.write(JSON.stringify(r, null, 2) + '\n', () => app.exit(r.ok ? 0 : 1));
      })
    : main();
  runner.catch((e) => {
    const payload = {
      ok: false, exitCode: 9,
      error: { code: 'UNCAUGHT', message: e.message, stack: e.stack }
    };
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n', () => app.exit(9));
  });
});
