/*
 * 视觉验证模块（开发期自检用，不进 skill 流程）
 * ============================================================================
 * 用离屏 Electron 窗口渲染卷面 HTML，把「题目卷 / 答案卷」截成 PNG，
 * 便于人工/模型核对排版（标题、学生栏、题号、答案线、页脚页码、分页）。
 *
 * 由 app/main.js 在 CHEMEQ_MODE=render-check 时调用：
 *   node tools/run-paper.js <job.json> --render-check
 * 或直接：
 *   electron.exe <SKILL_ROOT>   （env: CHEMEQ_MODE=render-check, SKILLJOB=<job.json>）
 *
 * 说明：本模块只跑「渲染 + 截图」，不写 out/ 的卷子产物，不写 _pending，不写记忆。
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const SKILL_ROOT = path.resolve(__dirname, '..', '..');
const K = require(path.join(SKILL_ROOT, 'engine', 'constants.js'));
const Paper = require(path.join(SKILL_ROOT, 'engine', 'paper.js'));
const Yml = require(path.join(SKILL_ROOT, 'tools', 'yml.js'));
const Preflight = require(path.join(SKILL_ROOT, 'tools', 'preflight.js'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 等渲染壳就绪（每轮渲染前重载后都要等一次） */
async function waitHarness(win) {
  for (let i = 0; i < 60; i++) {
    let ping = null;
    try {
      ping = await win.webContents.executeJavaScript('(window.__harness && window.__harness.ping()) || null');
    } catch (_) { ping = null; }
    if (ping && ping.ok) return ping;
    await sleep(50);
  }
  return null;
}

async function run({ BrowserWindow, jobPath, outDir }) {
  const job = JSON.parse(fs.readFileSync(jobPath, 'utf8'));
  const lib = JSON.parse(fs.readFileSync(path.join(SKILL_ROOT, 'data', 'library.json'), 'utf8'));
  const settings = Preflight.buildSettings(job);
  const scenario = job.scenario || 'homework';
  const layout = Yml.loadLayout(scenario, job.layoutOverrides || {});
  const pf = Preflight.preflight(job, { library: lib });
  const gen = Paper.generatePaper(lib, settings, {
    totalCount: settings.totalCount,
    authoritativeCount: pf.preflight.authoritativeCount,
    perItemRules: Paper.defaultPerItemRules(),
    extraAcceptance: job.extraAcceptance || []
  });
  if (!gen.ok) return { ok: false, error: gen.failure };

  fs.mkdirSync(outDir, { recursive: true });
  const win = new BrowserWindow({
    show: false,
    // sandbox:false —— 让 executeJavaScript 走主世界，才能访问页面里的 window.__harness
    webPreferences: { offscreen: true, contextIsolation: true, sandbox: false }
  });
  const saved = [];
  try {
    await win.loadFile(path.join(SKILL_ROOT, 'app', 'harness.html'));
    if (!await waitHarness(win)) return { ok: false, error: '渲染壳未就绪（engine 脚本加载失败）' };

    const info = { scenario, layout: { title: layout.title, studentInfo: layout.studentInfo, footer: layout.footer }, modes: {} };
    for (const mode of ['question', 'answer']) {
      // ⚠ 每轮都要重新加载 harness.html：上一轮 loadFile(卷面 html) 已经把页面替换掉，
      //    页面里的 window.__harness 随之消失（引擎对象只在 harness 页面存在）。
      await win.loadFile(path.join(SKILL_ROOT, 'app', 'harness.html'));
      if (!await waitHarness(win)) { info.modes[mode] = { ok: false, error: '渲染壳未就绪' }; continue; }
      const script = `window.__harness.buildDocument(${JSON.stringify(gen.items)}, ${JSON.stringify(layout)}, ${JSON.stringify(mode)})`;
      info.modes[mode] = { scriptBytes: script.length };
      let r;
      try {
        r = await win.webContents.executeJavaScript(script);
      } catch (e) {
        info.modes[mode].ok = false;
        info.modes[mode].error = 'executeJavaScript 抛错：' + e.message;
        continue;
      }
      if (!r || !r.ok) { info.modes[mode].ok = false; info.modes[mode].error = (r && r.error) || '未知'; continue; }
      const tmp = path.join(os.tmpdir(), 'rc_' + mode + '_' + Date.now() + '.html');
      fs.writeFileSync(tmp, r.html, 'utf8');
      await win.loadFile(tmp);
      await sleep(300);
      const size = await win.webContents.executeJavaScript(
        '(() => { const d = document.documentElement; return { w: d.scrollWidth, h: d.scrollHeight }; })()');
      win.setContentSize(Math.max(1, size.w), Math.max(1, size.h));
      await sleep(200);
      const shot = await win.webContents.capturePage();
      if (!shot || shot.isEmpty()) { info.modes[mode] = { ok: false, error: '截图为空' }; continue; }
      const p = path.join(outDir, 'render-' + mode + '.png');
      fs.writeFileSync(p, shot.toPNG());
      saved.push(p);
      info.modes[mode] = {
        ok: true, pages: r.pages, overflowCount: r.overflowCount,
        htmlBytes: r.html.length, widthMm: r.widthMm, heightMm: r.heightMm,
        pngPath: p, pngBytes: fs.statSync(p).size, canvasPx: { w: size.w, h: size.h }
      };
      fs.unlinkSync(tmp);
    }
    return { ok: true, info, saved, itemsCount: gen.items.length, typeActual: gen.stats.typeActual };
  } finally {
    try { win.destroy(); } catch (_) {}
  }
}

module.exports = { run };
