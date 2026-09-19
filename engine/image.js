/*
 * 图片通道文档构建（移植主项目 src/js/library.js:630-705 的已验证实现）。
 * 依赖：chem.js、constants.js；**需在浏览器/渲染进程中运行**（要 DOM 测量尺寸）。
 *
 * 规格：PROMPT-方程式出题skill.md §3.3 export.imageOptions（默认规格）
 * 通道：app/main.js 开离屏窗口 → 用本模块出 HTML → loadFile → 量 body → capturePage
 *
 * ⚠ 测量必须用 document.body.getBoundingClientRect()（不要用 documentElement.scrollWidth，
 *   后者下限是窗口宽，会带右侧空白）——§7 坑 2。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./chem.js'), require('./constants.js'));
  } else {
    root.ImageDoc = factory(root.Chem, root.Const);
  }
})(typeof self !== 'undefined' ? self : this, function (C, K) {
  'use strict';

  const escHtml = C.escapeHtml;

  /** 默认图片规格（§3.3 imageOptions） */
  function defaultImageOptions() {
    return {
      mode: 'single', versionScope: 'main', allowedTypes: ['chemical'], number: false,
      showName: false, showType: false, showDifficulty: false, showTextbook: false,
      fontPt: 16, metaFontPt: 10, scale: 2, cols: 1, format: 'png', textAlign: 'left', eqAlign: 'left',
      gapPt: 4, padPt: 27, zhFont: 'Microsoft YaHei', enFont: 'Times New Roman',
      heightMode: 'auto', canvasHeightPt: 120, vAlign: 'middle', baseName: '化学方程式', saveMode: 'auto'
    };
  }

  /** 版本挑选：main 主版本 | all 全部 | custom 指定类型 */
  function pickImageVersions(entry, scope, allowedTypes) {
    const vs = entry.versions || [];
    if (!vs.length) return [];
    if (scope === 'all') return vs.slice();
    if (scope === 'custom') return vs.filter(v => (allowedTypes || []).includes(v.type));
    return [vs[0]];
  }

  /** 单块 HTML：编号 / 名称 / 类型标签 / 难度 / 教材 元信息行（可选）+ 方程式（恒有） */
  function imageBlockHtml(e, v, no, opt) {
    const S = opt.scale;
    const meta = [];
    if (opt.number) meta.push(no + '.');
    if (opt.showName) meta.push(e.name || '（未命名）');
    if (opt.showType) meta.push('[' + (K.EQ_TYPE_MAP[v.type] ? K.EQ_TYPE_MAP[v.type].short : v.type) + ']');
    if (opt.showDifficulty && e.difficulty) meta.push(e.difficulty);
    const tb = (e.textbooks || [])[0];
    if (opt.showTextbook && tb) meta.push(tb.version + (tb.book ? ' ' + tb.book : ''));
    const metaLine = meta.filter(Boolean).map(s => `<span class="m">${escHtml(s)}</span>`).join('');
    return `<div class="blk">${metaLine ? `<div class="meta">${metaLine}</div>` : ''}<div class="eqw">${C.equationHTML(v)}</div></div>`;
  }

  /**
   * 完整文档：白底、内容自适应宽度、西文+中文字体栈、条件上下标、按 scale 放大。
   * blocks: imageBlockHtml 的结果数组
   */
  function buildImageDocHtml(blocks, opt) {
    const S = opt.scale;
    const num = (v, dflt) => (v != null && isFinite(Number(v)) ? Number(v) : dflt);
    const padPx = Math.round(num(opt.padPt, 20) * 96 / 72 * S);
    const fontPx = Math.round(opt.fontPt * 96 / 72 * S);
    const metaFontPx = Math.round(num(opt.metaFontPt, 10) * 96 / 72 * S);
    const gapPx = Math.round(num(opt.gapPt, 4) * 96 / 72 * S);
    const cols = opt.mode === 'single' ? (opt.cols || 1) : 1;
    const metaAlign = ['left', 'center', 'right'].includes(opt.textAlign) ? opt.textAlign : 'left';
    const eqAlign = ['left', 'center', 'right'].includes(opt.eqAlign) ? opt.eqAlign : 'left';
    const zhFont = opt.zhFont || 'Microsoft YaHei';
    const enFont = opt.enFont || 'Times New Roman';
    const family = `'${enFont}', '${zhFont}', serif`;
    const minW = Math.round(180 * S);
    const fixed = opt.heightMode === 'fixed';
    const canvasH = fixed ? Math.round(num(opt.canvasHeightPt, 120) * 96 / 72 * S) : 0;
    const vAlign = ['top', 'middle', 'bottom'].includes(opt.vAlign) ? opt.vAlign : 'top';
    const justify = vAlign === 'middle' ? 'center' : (vAlign === 'bottom' ? 'flex-end' : 'flex-start');
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { background: #fff; }
body { width: max-content; min-width: ${minW}px; ${fixed ? `min-height: ${canvasH}px;` : ''} padding: ${padPx}px; font-family: ${family}; color: #000; display: flex; flex-direction: column; justify-content: ${justify}; }
.grid { display: grid; grid-template-columns: repeat(${cols}, max-content); column-gap: ${28 * S}px; align-items: start; }
.blk { margin-bottom: ${20 * S}px; }
.blk:last-child { margin-bottom: 0; }
.meta { font-size: ${metaFontPx}px; color: #333; margin-bottom: ${gapPx}px; text-align: ${metaAlign}; }
.m { margin-right: ${10 * S}px; }
.eqw { font-size: ${fontPx}px; line-height: 1.6; text-align: ${eqAlign}; }
.eq { font-family: ${family}; white-space: nowrap; }
.eq sub { font-size: .72em; }
.eq sup { font-size: .72em; }
.eq-eq { position: relative; display: inline-block; vertical-align: baseline; margin: 0 3px; line-height: 1.1; }
.eq-anchor { position: relative; display: inline-block; }
.eq-sign { display: inline-block; min-width: 2em; text-align: center; line-height: 1.1; letter-spacing: 1px; }
.eq-cond, .eq-cond-below { position: absolute; left: 50%; transform: translateX(-50%); font-size: .7em; line-height: 1.15; white-space: nowrap; overflow: visible; display: flex; flex-direction: column; align-items: center; }
.eq-cond .cl, .eq-cond-below .cl { display: block; line-height: 1.15; }
.eq-cond { bottom: calc(100% - 0.40em); }
.eq-eq.sign-arrow .eq-cond { bottom: calc(100% + 0.02em); }
.eq-cond-below { top: calc(100% - 0.41em); }
.eq-eq.sign-arrow .eq-cond-below { top: calc(100% - 0.05em); }
.eq-dh { font-size: .95em; }
</style></head><body><div class="grid">${blocks.join('')}</div></body></html>`;
  }

  /**
   * 从 items（组卷结果）构建图片 HTML。
   * 图片内容 = 卷内条目的方程式（按 item.snapshot.version 取，保证与卷面完全一致）。
   * @param {Array} items 组卷 items
   * @param {object} rawOpt export.imageOptions 覆盖
   * @returns {{html, names, format, ext, count}}
   */
  function buildFromItems(items, rawOpt) {
    const opt = Object.assign(defaultImageOptions(), rawOpt || {});
    const fmt = opt.format === 'jpeg' ? 'jpeg' : 'png';
    const ext = fmt === 'jpeg' ? 'jpg' : 'png';
    const base = String(opt.baseName || '化学方程式').trim() || '化学方程式';
    const blocks = [];
    const names = [];
    items.forEach((it, i) => {
      const snap = it.snapshot || {};
      const v = snap.version;
      if (!v) return;
      const e = { name: snap.entryName, difficulty: snap.difficulty, textbooks: snap.textbooks || [] };
      if (opt.mode === 'multi') {
        blocks.push({ single: imageBlockHtml(e, v, i + 1, opt) });
        names.push(`${base}_${String(i + 1).padStart(3, '0')}_${sanitize(it.snapshot.entryName || it.entryId)}.${ext}`);
      } else {
        blocks.push(imageBlockHtml(e, v, i + 1, opt));
      }
    });
    if (opt.mode === 'multi') {
      // multi 模式：每张图一个 HTML（规格 §3.6 明确不做 multi，此分支保留但不会被 skill 调用）
      return {
        htmls: blocks.map((b) => buildImageDocHtml([b.single], opt)),
        names, format: fmt, ext, count: blocks.length
      };
    }
    if (!blocks.length) return { htmls: [], names: [], format: fmt, ext, count: 0 };
    return {
      htmls: [buildImageDocHtml(blocks, opt)],
      names: [`${base}.${ext}`], format: fmt, ext, count: 1
    };
  }

  function sanitize(s) {
    return String(s == null ? '' : s).replace(/[\\/:*?"<>|]/g, '_');
  }

  /**
   * 在页面内测量 body 实际尺寸（**必须在渲染进程调用**）。
   * ⚠ 用 body.getBoundingClientRect()，不要用 documentElement.scrollWidth（§7 坑 2）
   */
  function measure() {
    const r = document.body.getBoundingClientRect();
    return { w: Math.max(1, Math.ceil(r.width)), h: Math.max(1, Math.ceil(r.bottom)) };
  }

  return { defaultImageOptions, pickImageVersions, imageBlockHtml, buildImageDocHtml, buildFromItems, measure };
});
