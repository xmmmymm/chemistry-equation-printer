/*
 * 卷面渲染与导出：题目/答案 HTML 文档构建、实测高度分页分栏、CSV。
 * 依赖：chem.js、constants.js；需在浏览器（渲染进程）中运行（分页需要 DOM 测量）。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./chem.js'), require('./constants.js'));
  } else {
    root.DocBuilder = factory(root.Chem, root.Const);
  }
})(typeof self !== 'undefined' ? self : this, function (C, K) {
  'use strict';

  const PX_PER_PT = 96 / 72;
  const esc = C.escapeHtml;

  // ---------- 题干渲染 ----------
  /**
   * 文字题题干清洗：取 description 首个语义段。
   * 提取管线写入的 description 常含“；教材用作…/；由23 g…换算得…”等教材语境与
   * 数据溯源子句，直接全文拼接会生成“…实验。的化学方程式。”这类冗余病句。
   * 规则：按中英文分号/句号截取第一段，去除首尾逗号顿号空白；空则回退条目名。
   */
  function stemText(desc, fallback) {
    let s = String(desc || '').trim();
    if (!s) return String(fallback || '').trim();
    s = s.split(/[；;。．\n]/)[0].trim();
    s = s.replace(/^[，,、\s]+/, '').replace(/[，,、\s]+$/, '');
    return s || String(fallback || '').trim();
  }

  /**
   * item: WorksheetItem（含 snapshot）；返回 { stemHTML, answerHTML, plain }
   */
  function renderQuestion(item, number) {
    const snap = item.snapshot;
    const v = snap.version;
    const num = number + '. ';
    const typeLabel = K.EQ_TYPE_MAP[v.type] ? K.EQ_TYPE_MAP[v.type].label : '化学方程式';
    let stem = '', answer = '';

    switch (item.questionType) {
      case 'B': {
        // 给反应物写产物并配平：显示反应物与条件，长横线，不显示生成物与气体沉淀符号
        const left = C.sideHTML(v.reactants, {});
        stem = `${num}${left}${C.signZoneHTML(v, '——', {})}`;
        answer = C.equationHTML(v);
        break;
      }
      case 'C': {
        // 文字描述写方程式：题干后跟作答占位线（避免卷面完全空白）
        const prompt = item.customPrompt || `写出${stemText(snap.description, snap.entryName)}的${typeLabel}。`;
        stem = `${num}${esc(prompt)}<span class="blank-species">　________</span>`;
        answer = C.equationHTML(v);
        break;
      }
      case 'D': {
        // 部分空格补全
        const opts = dBlankOptions(item, v);
        stem = `${num}${C.equationHTML(v, opts)}`;
        answer = C.equationHTML(v);
        break;
      }
      case 'E': {
        // 配平题：全部系数留空
        stem = `${num}${C.equationHTML(v, { blankCoefficient: true })}`;
        answer = C.equationHTML(v);
        break;
      }
      case 'H': {
        // 开放题
        const prompt = item.customPrompt || snap.openPrompt || `写出一个${typeLabel}。`;
        stem = `${num}${esc(prompt)}`;
        answer = `${C.equationHTML(v)}<span class="ref-note">（参考答案，合理即可）</span>`;
        break;
      }
      default:
        stem = `${num}${C.equationHTML(v)}`;
        answer = C.equationHTML(v);
    }
    // 答案卷同样带题号（与题目卷题号对齐，便于批改）
    return { stem, answer: num + answer };
  }

  // D 类空格选项（随机策略在首次渲染时确定并持久化到 item）
  function dBlankOptions(item, v) {
    const strategy = item.blankStrategy || 'blankProducts';
    if (!item._dInit) {
      item._dInit = true;
      if (!item.blankIndex && item.blankIndex !== 0) {
        // 随机选择一个对象（对 blankOneXxx 策略）
        if (strategy === 'blankOneProduct' && v.products.length) {
          item.blankIndex = Math.floor(Math.random() * v.products.length);
          item.blankSide = 'product';
        } else if (strategy === 'blankOneReactant' && v.reactants.length) {
          item.blankIndex = Math.floor(Math.random() * v.reactants.length);
          item.blankSide = 'reactant';
        }
      }
    }
    switch (strategy) {
      case 'blankProducts': return { blankSpecies: v.products.slice() };
      case 'blankOneProduct': {
        const i = Math.min(item.blankIndex || 0, v.products.length - 1);
        return { blankSpecies: v.products.filter((_, idx) => idx === i) };
      }
      case 'blankOneReactant': {
        const i = Math.min(item.blankIndex || 0, v.reactants.length - 1);
        return { blankSpecies: v.reactants.filter((_, idx) => idx === i) };
      }
      case 'blankCoefficients': return { blankCoefficient: true };
      case 'blankCondition': return { blankCondition: true };
      case 'custom': return customBlankOptions(item, v);
      default: return { blankSpecies: v.products.slice() };
    }
  }

  // 自由勾选挖空：blankSpec = { blanks: [{ side:'reactants'|'products', idx, part:'species'|'coefficient' }],
  //                              condIdxs: [词索引] }（条件逐词挖空，索引对应 conditionLines 展开序）
  // 兼容旧格式 { reactantIdxs, productIdxs, coefficients, condition:bool }（无 UI 时期的内部格式）
  function customBlankOptions(item, v) {
    const spec = item.blankSpec || {};
    const speciesBlanks = [];
    const coefBlanks = [];
    const addSpecies = (sp, part) => {
      if (!sp) return;
      if (part === 'coefficient') coefBlanks.push(sp);
      else speciesBlanks.push(sp);
    };
    if (Array.isArray(spec.blanks)) {
      for (const b of spec.blanks) {
        if (!b || (b.side !== 'reactants' && b.side !== 'products')) continue;
        const sp = b.side === 'reactants' ? (v.reactants || [])[b.idx] : (v.products || [])[b.idx];
        addSpecies(sp, b.part);
      }
    } else {
      (spec.reactantIdxs || []).forEach(i => addSpecies((v.reactants || [])[i], 'species'));
      (spec.productIdxs || []).forEach(i => addSpecies((v.products || [])[i], 'species'));
      if (spec.coefficients) {
        [...(v.reactants || []), ...(v.products || [])].forEach(sp => addSpecies(sp, 'coefficient'));
      }
    }
    // 条件挖空索引：新格式 condIdxs；旧格式 condition:true → 全部词
    // 边界与渲染侧一致：conditionLines 展开（复合词如「高温高压」会拆成多词）
    let condBlankIdxs = null;
    const totalConds = C.conditionLines(v.conditions).length;
    if (Array.isArray(spec.condIdxs) && spec.condIdxs.length) {
      condBlankIdxs = spec.condIdxs.filter(i => i >= 0 && i < totalConds);
    } else if (spec.condition === true) {
      condBlankIdxs = Array.from({ length: totalConds }, (_, i) => i);
    }
    return {
      blankSpecies: speciesBlanks,
      blankCoefSp: coefBlanks,
      condBlankIdxs: condBlankIdxs && condBlankIdxs.length ? condBlankIdxs : undefined,
      blankCondition: spec.condition === true || (Array.isArray(spec.condIdxs) && spec.condIdxs.length === totalConds && totalConds > 0)
    };
  }

  // D 类策略是否适合该版本
  function strategySuitable(strategy, v) {
    switch (strategy) {
      case 'blankProducts': return v.products.length > 0;
      case 'blankOneProduct': return v.products.length >= 1;
      case 'blankOneReactant': return v.reactants.length >= 2;
      case 'blankCoefficients': {
        const all = [...v.reactants, ...v.products];
        return all.some(sp => sp.coefficient && sp.coefficient !== 1);
      }
      case 'blankCondition': return (v.conditions || []).length > 0;
      case 'custom': return true;
      default: return true;
    }
  }

  // ---------- 文档 CSS ----------
  function docCSS(layout) {
    const f = layout.font;
    const sp = layout.spacing;
    const lineH = sp.lineSpacing === 'single' ? 1.6
      : sp.lineSpacing === '1.5' ? 2.2
      : sp.lineSpacing === 'double' ? 2.9
      : (sp.customLineSpacingPt || 20) * PX_PER_PT;
    const mTop = K.parseCm(layout.margins.top) * 10;
    const mBot = K.parseCm(layout.margins.bottom) * 10;
    const mLeft = K.parseCm(layout.margins.left) * 10;
    const mRight = K.parseCm(layout.margins.right) * 10;
    const ps = K.paperSizeMm(layout.paper);
    const lineThick = layout.answerLine.thickness === 'thick' ? '1.5px' : layout.answerLine.thickness === 'medium' ? '1px' : '0.6px';
    return `
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { background: #fff; }
body { font-family: '${f.latin}', '${f.chinese}', serif; color: #000; }
.doc { background: #fff; }
.page {
  width: ${ps.width}mm; height: ${ps.height}mm;
  padding: ${mTop}mm ${mRight}mm ${mBot}mm ${mLeft}mm;
  position: relative; background: #fff; overflow: hidden;
  break-after: page; page-break-after: always;
}
.page:last-child { break-after: auto; page-break-after: auto; }
.page-head {
  position: absolute; top: ${Math.max(4, mTop / 2)}mm; left: ${mLeft}mm; right: ${mRight}mm;
  text-align: center; font-size: ${f.noteSizePt}pt; color: #000;
  border-bottom: none;
}
.page-foot {
  position: absolute; bottom: ${Math.max(4, mBot / 2)}mm; left: ${mLeft}mm; right: ${mRight}mm;
  text-align: center; font-size: ${f.noteSizePt}pt; color: #000;
}
.page-body { display: flex; gap: ${layout.columnGapMm || 8}mm; height: 100%; }
.col { flex: 1 1 0; min-width: 0; }
.doc-title { text-align: center; font-size: ${f.titleSizePt}pt; font-weight: bold; margin: 0 0 1mm; letter-spacing: 2px; font-family: 'SimHei', 'Microsoft YaHei', sans-serif; }
.doc-subtitle { text-align: center; font-size: ${f.bodySizePt}pt; margin-bottom: 1.5mm; }
.doc-note { text-align: center; font-size: ${f.noteSizePt}pt; margin-bottom: 2mm; }
.student-info { display: flex; justify-content: center; gap: 8mm; font-size: ${f.bodySizePt}pt; margin: 2mm 0 3mm; }
.q { font-size: ${f.bodySizePt}pt; line-height: ${lineH}; margin-bottom: ${sp.questionSpacingPt}pt; }
.q .eq { white-space: nowrap; }
.eq-dh { font-size: 0.95em; }
/* 等号与化学式同基线；条件三级降级链：上方 → 下方 → 加长符号（锚定 .eq-anchor，行盒由 padding 撑开） */
.eq-eq { position: relative; display: inline-block; vertical-align: baseline; margin: 0 3px; line-height: 1.1; }
.eq-anchor { position: relative; display: inline-block; }
.eq-sign { display: inline-block; min-width: 2em; text-align: center; line-height: 1.1; letter-spacing: 1px; font-weight: normal; }
.eq-cond, .eq-cond-below { position: absolute; left: 50%; transform: translateX(-50%); font-size: 0.7em; line-height: 1.15; white-space: nowrap; overflow: visible; display: flex; flex-direction: column; align-items: center; }
.eq-cond .cl, .eq-cond-below .cl { display: block; line-height: 1.15; }
/* —/══ 墨迹约在盒顶下 0.5em，条件嵌入盒内贴墨迹；⇌ 字形高，条件贴盒顶/盒底即可 */
.eq-cond { bottom: calc(100% - 0.40em); }
.eq-eq.sign-arrow .eq-cond { bottom: calc(100% + 0.02em); }
.eq-cond-below { top: calc(100% - 0.41em); }
.eq-eq.sign-arrow .eq-cond-below { top: calc(100% - 0.05em); }
.answer-line { border-bottom: ${lineThick} solid ${layout.answerLine.color || '#000'}; }
.ref-note { color: #000; font-size: 0.9em; margin-left: 1em; }
.ans-item { font-size: ${f.bodySizePt}pt; line-height: ${lineH}; margin-bottom: ${sp.questionSpacingPt}pt; }
`;
  }

  // ---------- 分页 ----------
  /**
   * items: WorksheetItem[]；mode: 'question' | 'answer'
   * measure: { container } 隐藏测量容器（已应用文档 CSS 环境的 q 类）
   * 返回 pages: [{ columns: [blockHTML...] }]
   */
  function paginate(items, layout, mode, measureBox) {
    const ps = K.paperSizeMm(layout.paper);
    const pxPerMm = measureBox.pxPerMm;
    // 页眉页脚实际定位在边距带内（top: mTop/2 / bottom: mBot/2，docCSS），
    // 仅当其文字高度超出边距带时才需要压缩正文区（如边距 0.5cm + 页眉）。
    // 旧版无条件扣 8+8mm 是「标题离顶远、正文与页码距离大」的根因。
    const mTopMm = K.parseCm(layout.margins.top) * 10;
    const mBotMm = K.parseCm(layout.margins.bottom) * 10;
    const FOOT_TEXT_MM = 5; // 页码文字高（10.5pt ≈ 3.7mm）+ 间隙
    const headerMm = layout.header.enabled ? Math.max(0, mTopMm / 2 + FOOT_TEXT_MM - mTopMm) : 0;
    const footMm = layout.footer.enabled ? Math.max(0, mBotMm / 2 + FOOT_TEXT_MM - mBotMm) : 0;
    const contentH = (ps.height - mTopMm - mBotMm - headerMm - footMm) * pxPerMm;
    const cols = layout.columns || 1;
    const gapMm = layout.columnGapMm || 8;
    const contentW = ps.width - K.parseCm(layout.margins.left) * 10 - K.parseCm(layout.margins.right) * 10;
    const colWmm = (contentW - (cols - 1) * gapMm) / cols;
    const colWpx = colWmm * pxPerMm;

    // 首页卷首块
    let headBlock = '';
    if (mode === 'question') {
      const parts = [];
      if (layout.title) parts.push(`<div class="doc-title">${esc(layout.title)}</div>`);
      if (layout.subtitle) parts.push(`<div class="doc-subtitle">${esc(layout.subtitle)}</div>`);
      if (layout.note) parts.push(`<div class="doc-note">${esc(layout.note)}</div>`);
      if (layout.studentInfo && layout.studentInfo.enabled && (layout.studentInfo.fields || []).length) {
        parts.push(`<div class="student-info">${layout.studentInfo.fields.map(fld =>
          `<span>${esc(fld)}：______________</span>`).join('')}</div>`);
      }
      headBlock = parts.join('');
    } else {
      const t = (layout.title || '化学方程式作业') + '　参考答案';
      const parts = [`<div class="doc-title">${esc(t)}</div>`];
      if (layout.note) parts.push(`<div class="doc-note">${esc(layout.note)}</div>`);
      headBlock = parts.join('');
    }

    // 逐题构建块
    const blocks = [];
    let headH = 0;
    if (headBlock) {
      measureBox.set({ html: headBlock, width: contentW * pxPerMm, base: 'q' });
      // 卷首块高度 + .doc-head 的 margin-bottom 2mm + 少量安全余量
      headH = measureBox.height() + 4 * pxPerMm;
    }
    items.forEach((item, idx) => {
      const r = renderQuestion(item, idx + 1);
      const cls = mode === 'question' ? 'q' : 'ans-item';
      let html = `<div class="${cls}" data-item="${idx}">${mode === 'question' ? r.stem : r.answer}</div>`;
      // 横线预留
      if (mode === 'question') {
        const showLine = item.showAnswerLine != null ? item.showAnswerLine : (layout.answerLine.enabled || false);
        if (showLine) {
          const hPt = item.answerLineHeightPt || layout.answerLine.defaultHeightPt || 24;
          html += `<div class="answer-line" style="height:${hPt}pt;"></div>`;
        }
      }
      measureBox.set({ html, width: colWpx, base: cls });
      const h = measureBox.height();
      blocks.push({ html, h, pageBreakAfter: !!item.pageBreakAfter });
    });

    // 打包到页/栏
    const pages = [];
    const fixedPerPage = layout.fixedQuestionsPerPage || 0;
    let page = null;
    let remainingFirst = contentH - headH;
    let usedInPage = 0;

    function newPage() {
      page = { columns: [] };
      for (let i = 0; i < cols; i++) page.columns.push([]);
      page._colH = new Array(cols).fill(0);
      page._first = pages.length === 0;
      page._limit = page._first ? remainingFirst : contentH;
      usedInPage = 0;
      pages.push(page);
    }

    function place(block) {
      if (!page) newPage();
      // 找能放下的栏
      for (let ci = 0; ci < cols; ci++) {
        if (page._colH[ci] + block.h <= page._limit + 0.5) {
          page.columns[ci].push(block.html);
          page._colH[ci] += block.h;
          return true;
        }
      }
      // 当前页放不下 → 新页放置（正常翻页，不算溢出）
      newPage();
      if (block.h <= page._limit + 0.5) {
        page.columns[0].push(block.html);
        page._colH[0] += block.h;
        return true;
      }
      // 单题超过整页：强制放入第一栏（允许溢出，UI 提示）
      page.columns[0].push(block.html);
      page._colH[0] += block.h;
      return 'overflow';
    }

    let overflowCount = 0;
    for (const b of blocks) {
      const r = place(b);
      if (r === 'overflow') overflowCount++;
      usedInPage++;
      if (fixedPerPage > 0 && usedInPage >= fixedPerPage && b !== blocks[blocks.length - 1]) {
        newPage();
      }
      if (b.pageBreakAfter && b !== blocks[blocks.length - 1]) {
        newPage();
      }
    }
    if (!pages.length) { newPage(); }
    // 首页头块
    if (headBlock) pages[0].headBlock = headBlock;
    return { pages, overflowCount, colWmm, ps };
  }

  // ---------- 完整文档 ----------
  function buildDocument(items, layout, mode, measureBox) {
    const paginated = paginate(items, layout, mode, measureBox);
    const ps = paginated.ps;
    const f = layout.font;
    const totalPages = paginated.pages.length;
    const headerText = layout.header.enabled
      ? (layout.header.useTitle ? (layout.title || '') : (layout.header.text || ''))
      : '';

    const bodyPages = paginated.pages.map((pg, pi) => {
      const cols = pg.columns.map(colHtml => `<div class="col">${colHtml.join('')}</div>`).join('');
      const head = headerText ? `<div class="page-head">${esc(headerText)}</div>` : '';
      let foot = '';
      if (layout.footer.enabled) {
        let t = '';
        if (layout.footer.format === 'number') t = `${pi + 1}`;
        else if (layout.footer.format === 'pageNumber') t = `第 ${pi + 1} 页`;
        else if (layout.footer.format === 'pageNumberOfTotal') t = `第 ${pi + 1} 页　共 ${totalPages} 页`;
        foot = t ? `<div class="page-foot">${esc(t)}</div>` : '';
      }
      const headBlock = pg.headBlock ? `<div class="doc-head">${pg.headBlock}</div>` : '';
      return `<div class="page">${head}${foot}${headBlock}<div class="page-body">${cols}</div></div>`;
    }).join('\n');

    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${esc(layout.title || '化学方程式作业')}${mode === 'answer' ? '（答案）' : ''}</title>
<style>${docCSS(layout)}
.doc-head { margin-bottom: 2mm; }
.page { display: flex; flex-direction: column; }
.page-body { flex: 1 1 auto; min-height: 0; }
</style>
</head>
<body><div class="doc">
${bodyPages}
</div></body>
</html>`;
    return { html, paginated, widthMm: ps.width, heightMm: ps.height };
  }

  // ---------- 测量工具（在应用窗口内挂隐藏容器，需注入文档 CSS 保证测量与实际一致） ----------
  function createMeasureBox() {
    const holder = document.createElement('div');
    holder.style.cssText = 'position:absolute;left:-9999px;top:0;visibility:hidden;pointer-events:none;';
    document.body.appendChild(holder);
    const styleTag = document.createElement('style');
    holder.appendChild(styleTag);
    const ruler = document.createElement('div');
    ruler.style.cssText = 'width:100mm;height:0;';
    holder.appendChild(ruler);
    const pxPerMm = ruler.getBoundingClientRect().width / 100;
    const box = document.createElement('div');
    holder.appendChild(box);

    return {
      pxPerMm,
      setCss(css) { styleTag.textContent = css; },
      set({ html, width, base }) {
        box.className = base || '';
        box.style.width = width + 'px';
        // overflow:hidden 建立 BFC：子块（.q/.ans-item）的 margin-bottom（题间距）
        // 不再逃逸出测量盒，测量高度与真实卷面堆叠高度一致——否则每题低估一个
        // 题间距，一页 15 题累计约 30mm，导致内容溢出页脚/页底（换页溢出 bug 的根因）
        box.style.overflow = 'hidden';
        box.innerHTML = html;
      },
      height() {
        return box.getBoundingClientRect().height;
      },
      destroy() { holder.remove(); }
    };
  }

  // ---------- CSV ----------
  function csvEscape(s) {
    s = String(s == null ? '' : s);
    if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function libraryToCsv(entries) {
    const header = ['编号', '反应名称', '文字描述', '难度', '星标', '必出', '启用', '教材版本', '册别', '章', '节',
      '物质类别', '反应类型', '知识模块', '标签', '出题次数', '最近出题时间', '主方程式'];
    const rows = [header.map(csvEscape).join(',')];
    for (const e of entries) {
      const main = (e.versions || [])[0];
      rows.push([
        e.id, e.name, e.description || '', e.difficulty || '',
        e.starred ? '是' : '否', e.mustInclude ? '是' : '否', e.enabled ? '是' : '否',
        (e.textbooks || []).map(t => t.version).join(';'),
        (e.textbooks || []).map(t => t.book).join(';'),
        (e.textbooks || []).map(t => t.chapter).join(';'),
        (e.textbooks || []).map(t => t.section).join(';'),
        (e.substanceCategories || []).join(';'),
        (e.reactionTypes || []).join(';'),
        (e.knowledgeModules || []).join(';'),
        (e.tags || []).join(';'),
        e.questionCount || 0,
        e.lastUsedAt || ''
      ].map(csvEscape).join(','));
    }
    return '\uFEFF' + rows.join('\r\n'); // BOM 便于 Excel 打开中文
  }

  return {
    renderQuestion, docCSS, paginate, buildDocument,
    createMeasureBox, libraryToCsv, strategySuitable, dBlankOptions, stemText
  };
});
