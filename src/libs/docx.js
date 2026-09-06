/*
 * DOCX 导出：纯前端生成标准 OOXML .docx（STORED ZIP，无外部依赖）。
 * 方程式用无边框表格布局：左（题号+反应物）| 中（条件堆叠+符号）| 右（生成物），
 * 条件复用 chem.js 的三级降级链（上方 → 下方 → 加长符号）。
 * 页码通过页脚 PAGE 域实现（不再出现在正文首行）。
 * 依赖：chem.js、constants.js、exporter.js（dBlankOptions）。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./chem.js'), require('./constants.js'), require('./exporter.js'));
  } else {
    root.DocxBuilder = factory(root.Chem, root.Const, root.DocBuilder);
  }
})(typeof self !== 'undefined' ? self : this, function (C, K, Doc) {
  'use strict';

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

  // ---------- 极简 ZIP（STORED，不压缩） ----------
  function crc32(buf) {
    let table = crc32.table;
    if (!table) {
      table = crc32.table = new Int32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        table[n] = c;
      }
    }
    let c = 0 ^ (-1);
    for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ table[(c ^ buf[i]) & 0xFF];
    return (c ^ (-1)) >>> 0;
  }

  function zipSync(files) {
    const chunks = [];
    const central = [];
    let offset = 0;
    const enc = new TextEncoder();
    for (const f of files) {
      const nameB = enc.encode(f.name);
      const data = f.data;
      const crc = crc32(data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true);
      lh.setUint16(4, 20, true);
      lh.setUint16(8, 0, true);   // method: STORED
      lh.setUint16(12, 0x5821, true); // date
      lh.setUint32(14, crc, true);
      lh.setUint32(18, data.length, true);
      lh.setUint32(22, data.length, true);
      lh.setUint16(26, nameB.length, true);
      chunks.push(new Uint8Array(lh.buffer), nameB, data);
      central.push({ nameB, crc, size: data.length, offset });
      offset += 30 + nameB.length + data.length;
    }
    const cdStart = offset;
    for (const c of central) {
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true);
      ch.setUint16(4, 20, true);
      ch.setUint16(6, 20, true);
      ch.setUint16(12, 0x5821, true);
      ch.setUint32(16, c.crc, true);
      ch.setUint32(20, c.size, true);
      ch.setUint32(24, c.size, true);
      ch.setUint16(28, c.nameB.length, true);
      ch.setUint32(42, c.offset, true);
      chunks.push(new Uint8Array(ch.buffer), c.nameB);
      offset += 46 + c.nameB.length;
    }
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, central.length, true);
    end.setUint16(10, central.length, true);
    end.setUint32(12, offset - cdStart, true); // 中央目录大小
    end.setUint32(16, cdStart, true);          // 中央目录起始偏移
    chunks.push(new Uint8Array(end.buffer));
    let total = 0;
    chunks.forEach(c => { total += c.length; });
    const out = new Uint8Array(total);
    let p = 0;
    for (const c of chunks) { out.set(c, p); p += c.length; }
    return out;
  }

  // ---------- XML 基础 ----------
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

  function runXml(spec) {
    if (!spec.t) return '';
    const vert = spec.sub ? '<w:vertAlign w:val="subscript"/>' : (spec.sup ? '<w:vertAlign w:val="superscript"/>' : '');
    const sz = spec.small ? '<w:sz w:val="17"/><w:szCs w:val="17"/>'
      : (spec.szPt ? `<w:sz w:val="${Math.round(spec.szPt * 2)}"/><w:szCs w:val="${Math.round(spec.szPt * 2)}"/>` : '');
    const bold = spec.bold ? '<w:b/>' : '';
    const fonts = spec.font ? `<w:rFonts w:ascii="${esc(spec.font)}" w:hAnsi="${esc(spec.font)}" w:eastAsia="${esc(spec.font)}"/>` : '';
    const rPr = [vert, bold, fonts, sz].filter(Boolean).join('');
    return `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}<w:t xml:space="preserve">${esc(spec.t)}</w:t></w:r>`;
  }

  function pXml(runs, o) {
    o = o || {};
    const pPr = [];
    if (o.align) pPr.push(`<w:jc w:val="${o.align}"/>`);
    if (o.border) pPr.push('<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="auto"/></w:pBdr>');
    const spacing = [];
    if (o.after != null) spacing.push(`w:after="${Math.round(o.after * 20)}"`); // pt→twips
    if (o.lineHeightPt) spacing.push(`w:line="${Math.round(o.lineHeightPt * 20)}" w:lineRule="exact"`);
    if (spacing.length) pPr.push(`<w:spacing ${spacing.join(' ')}/>`);
    const pPrXml = pPr.length ? `<w:pPr>${pPr.join('')}</w:pPr>` : '';
    const runsXml = (runs || []).map(runXml).join('');
    return `<w:p>${pPrXml}${runsXml}</w:p>`;
  }

  // ---------- 物质 → run 序列（下标/电荷上标） ----------
  function speciesRunSpecs(sp, opts) {
    opts = opts || {};
    const specs = [];
    // 系数挖空：blankCoefficient=全部；blankCoefSp=指定物质（自由点选挖空）
    const coefBlank = opts.blankCoefficient === true ||
      (opts.blankCoefSp && opts.blankCoefSp.includes(sp));
    if (opts.blankSpecies && opts.blankSpecies.includes(sp)) {
      if (!coefBlank && sp.coefficient && sp.coefficient !== 1) specs.push({ t: String(sp.coefficient) + ' ' });
      specs.push({ t: '________' });
      return specs;
    }
    if (coefBlank) specs.push({ t: '____' });
    else if (sp.coefficient && sp.coefficient !== 1) specs.push({ t: String(sp.coefficient) });
    for (const ch of String(sp.formula || '')) {
      specs.push(/[0-9]/.test(ch) ? { t: ch, sub: true } : { t: ch });
    }
    if (sp.charge) specs.push({ t: sp.charge, sup: true });
    if (sp.state) specs.push({ t: '(' + sp.state + ')' });
    if (sp.gas) specs.push({ t: '↑' });
    if (sp.precipitate) specs.push({ t: '↓' });
    return specs;
  }

  function sideRunSpecs(list, opts) {
    const specs = [];
    (list || []).forEach((sp, i) => {
      if (i) specs.push({ t: ' + ' });
      specs.push(...speciesRunSpecs(sp, opts));
    });
    return specs;
  }

  // ---------- 方程式表格（条件上下布局复用三级降级链） ----------
  function eqSignZone(v, signText, opts) {
    // 条件词过滤：整组挖空（blankCondition）或逐词挖空（condBlankIdxs，与渲染侧 conditionLines 序一致）
    const rawConds = C.conditionLines(v.conditions);
    let conds = rawConds;
    if (opts && opts.blankCondition) conds = [];
    else if (opts && opts.condBlankIdxs && opts.condBlankIdxs.length) {
      conds = rawConds.filter((_, i) => !opts.condBlankIdxs.includes(i));
    }
    const condBlanked = rawConds.length > 0 && conds.length === 0;
    const L = C.conditionLayout(conds);
    let signChar = signText || (v.reversible ? '⇌' : '══');
    if ((opts && opts.blankCondition) || condBlanked) signChar = '＿＿';
    if (L.signMinEm && signChar !== '⇌' && signChar !== '＿＿') {
      signChar = signChar.charAt(0).repeat(Math.ceil(L.signMinEm));
    }
    return { above: L.above.slice().reverse(), below: L.below, signChar, signMinEm: L.signMinEm };
  }

  function cellXml(paras, opts) {
    opts = opts || {};
    const vAlign = `<w:vAlign w:val="${opts.vAlign || 'top'}"/>`;
    const tcW = opts.widthDxa ? `<w:tcW w:w="${opts.widthDxa}" w:type="dxa"/>` : '<w:tcW w:w="0" w:type="auto"/>';
    return `<w:tc><w:tcPr>${tcW}${vAlign}</w:tcPr>${paras.join('')}</w:tc>`;
  }

  function eqTableXml(num, v, sideOpts, signText, showRight) {
    sideOpts = sideOpts || {};
    const zone = eqSignZone(v, signText, sideOpts);
    const numPrefix = num != null ? [{ t: num + '. ' }] : [];
    const leftRuns = numPrefix.concat(sideRunSpecs(v.reactants, sideOpts));
    // 中间单元格：条件（小字号居中）+ 符号
    const midParas = [];
    zone.above.forEach(t => midParas.push(pXml([{ t, small: true }], { align: 'center', after: 0 })));
    midParas.push(pXml([{ t: zone.signChar }], { align: 'center', after: 0 }));
    zone.below.forEach(t => midParas.push(pXml([{ t, small: true }], { align: 'center', after: 0 })));
    const midWidth = zone.signMinEm ? Math.round(240 * (zone.signMinEm + 0.3)) : 620;
    const rightRuns = showRight ? sideRunSpecs(v.products, sideOpts) : [];
    return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/>
<w:tblBorders><w:top w:val="none" w:sz="0"/><w:left w:val="none" w:sz="0"/><w:bottom w:val="none" w:sz="0"/><w:right w:val="none" w:sz="0"/><w:insideH w:val="none" w:sz="0"/><w:insideV w:val="none" w:sz="0"/></w:tblBorders>
<w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="60" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="60" w:type="dxa"/></w:tblCellMar></w:tblPr>
<w:tblGrid><w:gridCol w:w="4400"/><w:gridCol w:w="${midWidth}"/><w:gridCol w:w="4400"/></w:tblGrid>
<w:tr>${cellXml([pXml(leftRuns, { after: 2 })], { vAlign: 'bottom' })}${cellXml(midParas, { vAlign: 'bottom', widthDxa: midWidth })}${cellXml([pXml(rightRuns, { after: 2 })], { vAlign: 'bottom' })}</w:tr></w:tbl>`;
  }

  // ---------- 题目 → XML ----------
  function questionXml(item, idx, mode, layout) {
    const snap = item.snapshot;
    const v = snap.version;
    const typeLabel = K.EQ_TYPE_MAP[v.type] ? K.EQ_TYPE_MAP[v.type].label : '化学方程式';
    const num = idx + 1;
    const blocks = [];
    const qSpacing = (layout.spacing && layout.spacing.questionSpacingPt) || 6;

    if (mode === 'question') {
      switch (item.questionType) {
        case 'B':
          blocks.push(eqTableXml(num, v, {}, '——', false));
          break;
        case 'C': {
          const prompt = item.customPrompt || `写出${Doc.stemText(snap.description, snap.entryName)}的${typeLabel}。`;
          blocks.push(pXml([{ t: num + '. ' }, { t: prompt }, { t: '　________' }], { after: qSpacing }));
          break;
        }
        case 'D': {
          const opts = Doc.dBlankOptions(item, v);
          blocks.push(eqTableXml(num, v, opts, null, true));
          break;
        }
        case 'E':
          blocks.push(eqTableXml(num, v, { blankCoefficient: true }, null, true));
          break;
        case 'H': {
          const prompt = item.customPrompt || snap.openPrompt || `写出一个${typeLabel}。`;
          blocks.push(pXml([{ t: num + '. ' }, { t: prompt }], { after: qSpacing }));
          break;
        }
        default:
          blocks.push(eqTableXml(num, v, {}, null, true));
      }
      // 作答横线
      const showLine = item.showAnswerLine != null ? item.showAnswerLine : (layout.answerLine.enabled || false);
      if (showLine) {
        const hPt = item.answerLineHeightPt || layout.answerLine.defaultHeightPt || 24;
        blocks.push(pXml([], { border: true, after: hPt }));
      }
    } else {
      // 答案卷
      blocks.push(eqTableXml(num, v, {}, null, true));
      if (item.questionType === 'H') {
        blocks.push(pXml([{ t: '（参考答案，合理即可）', small: true }], { after: qSpacing }));
      }
    }

    // ΔH（热化学）：题目卷 B/C/H 不显示（B 求生成物、C 文字题干、H 开放题），
    // 挖空/配平/默认题型与答案卷显示完整热化学式
    const dh = v.extras && v.extras.deltaH;
    if (dh && (mode === 'answer' || (mode === 'question' && !['B', 'C', 'H'].includes(item.questionType)))) {
      blocks.push(pXml([{ t: '　ΔH = ' + dh }], { after: qSpacing }));
    }

    // 表格后必须跟段落（相邻表格会被 Word 合并）
    const out = [];
    blocks.forEach((b, i) => {
      out.push(b);
      if (b.startsWith('<w:tbl')) out.push(pXml([], { after: qSpacing }));
    });
    return out.join('');
  }

  // ---------- 页脚（PAGE 域，不再出现在正文） ----------
  function footerXml(layout) {
    const fmt = layout.footer && layout.footer.format;
    let runs = [];
    if (fmt === 'pageNumber') {
      runs = [{ t: '第 ' }, { fld: 'PAGE' }, { t: ' 页' }];
    } else if (fmt === 'pageNumberOfTotal') {
      runs = [{ t: '第 ' }, { fld: 'PAGE' }, { t: ' 页　共 ' }, { fld: 'NUMPAGES' }, { t: ' 页' }];
    } else {
      runs = [{ fld: 'PAGE' }];
    }
    const inner = runs.map(r => r.fld
      ? `<w:fldSimple w:instr=" ${r.fld} "><w:r><w:rPr><w:sz w:val="21"/></w:rPr><w:t>1</w:t></w:r></w:fldSimple>`
      : `<w:r><w:rPr><w:sz w:val="21"/></w:rPr><w:t xml:space="preserve">${esc(r.t)}</w:t></w:r>`).join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:ftr ${W}><w:p><w:pPr><w:jc w:val="center"/></w:pPr>${inner}</w:p></w:ftr>`;
  }

  // ---------- 文档组装 ----------
  function mmToTwips(mm) { return Math.round(mm / 25.4 * 1440); }
  function cmToTwips(cmStr) { return Math.round(K.parseCm(cmStr || '2') * 566.93); }

  function buildDocx(items, layout, mode) {
    layout = layout || K.defaultLayoutSettings();
    const f = layout.font || {};
    const bodyPt = f.bodySizePt || 12;
    const titlePt = f.titleSizePt || 16;
    const qSpacingPt = (layout.spacing && layout.spacing.questionSpacingPt) || 6;

    const bodyChildren = [];
    // 卷首。标题统一加粗黑体（与 PDF/HTML 导出的 .doc-title 样式一致）
    const titleRun = (t) => ({ t, bold: true, font: 'SimHei', szPt: titlePt });
    if (mode === 'question') {
      bodyChildren.push(pXml([titleRun(layout.title || '化学方程式作业')], { align: 'center', after: 6 }));
      if (layout.subtitle) bodyChildren.push(pXml([{ t: layout.subtitle }], { align: 'center', after: 3 }));
      if (layout.note) bodyChildren.push(pXml([{ t: layout.note }], { align: 'center', after: 4 }));
      if (layout.studentInfo && layout.studentInfo.enabled && (layout.studentInfo.fields || []).length) {
        bodyChildren.push(pXml(
          (layout.studentInfo.fields || []).flatMap(fld => [{ t: fld + '：______　' }]),
          { align: 'center', after: 8 }));
      }
    } else {
      bodyChildren.push(pXml([titleRun((layout.title || '化学方程式作业') + '　参考答案')], { align: 'center', after: 8 }));
    }

    items.forEach((item, idx) => {
      bodyChildren.push(questionXml(item, idx, mode, layout));
    });

    const ps = K.paperSizeMm(layout.paper);
    const sect = `<w:sectPr><w:footerReference w:type="default" r:id="rId2"/>
<w:pgSz w:w="${mmToTwips(ps.width)}" w:h="${mmToTwips(ps.height)}"/>
<w:pgMar w:top="${cmToTwips(layout.margins.top)}" w:right="${cmToTwips(layout.margins.right)}" w:bottom="${cmToTwips(layout.margins.bottom)}" w:left="${cmToTwips(layout.margins.left)}" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>`;

    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document ${W} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${bodyChildren.join('')}${sect}</w:body></w:document>`;

    const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:styles ${W}><w:docDefaults><w:rPrDefault><w:rPr>
<w:rFonts w:ascii="${esc(f.latin || 'Times New Roman')}" w:hAnsi="${esc(f.latin || 'Times New Roman')}" w:eastAsia="${esc(f.chinese || 'SimSun')}"/>
<w:sz w:val="${Math.round(bodyPt * 2)}"/><w:szCs w:val="${Math.round(bodyPt * 2)}"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="${Math.round(qSpacingPt * 20)}" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>`;

    const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>`;

    const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;

    const docRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>`;

    const enc = new TextEncoder();
    const zip = zipSync([
      { name: '[Content_Types].xml', data: enc.encode(contentTypesXml) },
      { name: '_rels/.rels', data: enc.encode(relsXml) },
      { name: 'word/document.xml', data: enc.encode(documentXml) },
      { name: 'word/styles.xml', data: enc.encode(stylesXml) },
      { name: 'word/_rels/document.xml.rels', data: enc.encode(docRelsXml) },
      { name: 'word/footer1.xml', data: enc.encode(footerXml(layout)) }
    ]);
    return zip;
  }

  // Uint8Array → base64（渲染进程传给 IPC）
  function toBase64(bytes) {
    let bin = '';
    const CH = 0x8000;
    for (let i = 0; i < bytes.length; i += CH) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    }
    return (typeof btoa !== 'undefined' ? btoa(bin) : Buffer.from(bin, 'binary').toString('base64'));
  }

  return { buildDocx, toBase64, questionXml, eqTableXml, zipSync };
});
