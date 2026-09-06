/*
 * JSON 导入：校验、重复检测、错误报告（JSON + Markdown）。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./chem.js'), require('./constants.js'));
  } else {
    root.Importer = factory(root.Chem, root.Const);
  }
})(typeof self !== 'undefined' ? self : this, function (C, K) {
  'use strict';

  const VALID_TYPES = ['chemical', 'ionic', 'ionization', 'hydrolysis', 'electrode', 'thermochemical'];

  function normalizeEntry(raw, index) {
    const errors = [];
    const warnings = [];
    const entry = {
      id: raw.id || K.uid('R'),
      name: String(raw.name || '').trim(),
      description: String(raw.description || '').trim(),
      openPrompt: String(raw.openPrompt || '').trim(),
      difficulty: raw.difficulty,
      difficultyReason: raw.difficultyReason || '',
      starred: !!raw.starred,
      mustInclude: !!raw.mustInclude,
      enabled: raw.enabled !== false,
      textbooks: (raw.textbooks || []).map(t => ({
        version: String(t.version || '').trim(),
        book: String(t.book || '').trim(),
        chapter: String(t.chapter || '').trim(),
        section: String(t.section || '').trim(),
        // 栏目溯源（如"实验3-1/思考与讨论"）：导入时保留（旧数据无此字段已容错）
        ...(t.context ? { context: String(t.context).trim() } : {})
      })),
      substanceCategories: (raw.substanceCategories || []).map(x => String(x).trim()).filter(Boolean),
      reactionTypes: (raw.reactionTypes || []).map(x => String(x).trim()).filter(Boolean),
      knowledgeModules: (raw.knowledgeModules || []).map(x => String(x).trim()).filter(Boolean),
      tags: (raw.tags || []).map(x => String(x).trim()).filter(Boolean),
      remark: raw.remark || '',
      source: raw.source || '',
      versions: [],
      questionCount: Number(raw.questionCount) || 0,
      lastUsedAt: raw.lastUsedAt || '',
      createdAt: K.nowIso(),
      updatedAt: K.nowIso()
    };

    if (!entry.name) errors.push({ field: 'name', message: '缺少反应名称（name 为必填字段）' });
    if (!K.DIFFICULTIES.includes(entry.difficulty)) {
      errors.push({ field: 'difficulty', message: `难度（difficulty）必须为“简单/中等/较难”之一，当前为：${JSON.stringify(raw.difficulty)}` });
    }
    if (!Array.isArray(raw.versions) || !raw.versions.length) {
      errors.push({ field: 'versions', message: '至少需要一个表达式版本（versions 数组）' });
    }

    const dupInside = new Map();
    (raw.versions || []).forEach((rv, vi) => {
      const vErrors = [];
      if (!VALID_TYPES.includes(rv.type)) {
        vErrors.push(`版本 ${vi + 1}：type 必须为 ${VALID_TYPES.join('/')} 之一`);
      }
      if (!Array.isArray(rv.reactants) || !rv.reactants.length) vErrors.push(`版本 ${vi + 1}：缺少反应物`);
      if (!Array.isArray(rv.products) || !rv.products.length) vErrors.push(`版本 ${vi + 1}：缺少生成物`);
      if (vErrors.length) { vErrors.forEach(m => errors.push({ field: 'versions', message: m })); return; }

      const version = {
        id: rv.id || K.uid('v'),
        type: rv.type,
        label: rv.label || (K.EQ_TYPE_MAP[rv.type] ? K.EQ_TYPE_MAP[rv.type].label : rv.type),
        reversible: !!rv.reversible,
        reactants: [],
        products: [],
        conditions: (rv.conditions || []).map(c => ({ code: c.code || 'custom', text: c.text || '', position: c.position || 'auto' })),
        extras: rv.extras || {},
        questionCount: Number(rv.questionCount) || 0
      };

      for (const side of ['reactants', 'products']) {
        for (const rs of rv[side]) {
          const sp = {
            formula: String(rs.formula || '').trim(),
            coefficient: rs.coefficient === undefined ? 1 : rs.coefficient,
            state: rs.state,
            gas: !!rs.gas,
            precipitate: !!rs.precipitate,
            charge: rs.charge,
            isElectron: !!rs.isElectron
          };
          if (!sp.formula) {
            errors.push({ field: 'versions', message: `版本 ${vi + 1}（${entry.name}）：${side} 中存在空化学式` });
            continue;
          }
          if (!((Number.isInteger(sp.coefficient) && sp.coefficient > 0) || C.isPolymerCoef(sp.coefficient))) {
            errors.push({
              field: 'versions',
              message: `版本 ${vi + 1}（${entry.name}）：化学式“${sp.formula}”的系数必须为正整数（聚合式允许 n / 2n / (n-1) / (2n-1)，禁止分数系数），当前为 ${JSON.stringify(rs.coefficient)}`
            });
          }
          const fp = C.parseFormula(sp.formula);
          if (!fp.ok) {
            errors.push({ field: 'versions', message: `版本 ${vi + 1}（${entry.name}）：化学式“${sp.formula}”无法解析：${fp.error}` });
            continue;
          }
          if (sp.charge === undefined) sp.charge = fp.charge || undefined;
          version[side].push(sp);
        }
      }

      if (version.reactants.length && version.products.length) {
        const st = C.validateVersion(version);
        st.errors.forEach(msg => errors.push({ field: 'versions', message: `版本 ${vi + 1}（${entry.name} / ${version.label}）：${msg}` }));
        st.warnings.forEach(msg => warnings.push(`版本 ${vi + 1}（${entry.name} / ${version.label}）：${msg}`));
        if (st.errors.length) {
          version.checkStatus = st;
        }
      }

      // 条件文本规范化：光照不使用 hr/hv/hν
      version.conditions.forEach(c => {
        if (/^(hr|hv|hν|hυ)$/i.test(c.text || '')) {
          warnings.push(`版本 ${vi + 1}（${entry.name}）：条件“${c.text}”已按规范改为“光照”`);
          c.text = '光照';
          if (c.code === 'custom') c.code = 'light';
        }
      });

      // 文件内部重复（同一类型 + 同一反应集合）
      const key = rv.type + '|' + C.versionDupKey(version);
      if (dupInside.has(key)) {
        warnings.push(`条目内部重复：版本 ${vi + 1} 与版本 ${dupInside.get(key) + 1} 反应物/生成物集合相同（${version.label}）`);
      } else {
        dupInside.set(key, vi);
      }

      entry.versions.push(version);
    });

    return { entry, errors, warnings, raw };
  }

  /**
   * 校验导入数据。
   * data: 解析后的 JSON；library: 当前题库 {entries}
   * 返回 { ok, total, results:[{entry, errors, warnings, dupOf, raw}], dupCount, errorCount, warningCount }
   */
  function validateImportData(data, library, fileName) {
    if (!data || typeof data !== 'object') {
      return { ok: false, fatal: '文件结构错误：不是有效的 JSON 对象' };
    }
    if (!Array.isArray(data.entries)) {
      return { ok: false, fatal: '文件结构错误：缺少 entries 数组（顶层结构应为 { "version": 1, "entries": [...] }）' };
    }

    // 现有题库重复索引：type + dupKey → entry
    const existingIndex = new Map();
    for (const e of (library.entries || [])) {
      for (const v of (e.versions || [])) {
        existingIndex.set(v.type + '|' + C.versionDupKey(v), e);
      }
    }

    const results = [];
    let dupCount = 0, errorCount = 0, warningCount = 0;
    const seenKeys = new Map(); // 文件内：type|dupKey → entry name

    data.entries.forEach((raw, i) => {
      const r = normalizeEntry(raw, i);
      // 与题库重复检测（同类型版本才比较）
      r.dupOf = null;
      for (const v of r.entry.versions) {
        const key = v.type + '|' + C.versionDupKey(v);
        const existing = existingIndex.get(key);
        if (existing) {
          r.dupOf = r.dupOf || { entryId: existing.id, entryName: existing.name, versionType: v.type };
          break;
        }
        const inFile = seenKeys.get(key);
        if (inFile) {
          r.dupOf = r.dupOf || { entryId: null, entryName: inFile + '（本文件内）', versionType: v.type };
          break;
        }
      }
      for (const v of r.entry.versions) {
        seenKeys.set(v.type + '|' + C.versionDupKey(v), r.entry.name || ('条目 ' + (i + 1)));
      }
      if (r.dupOf) dupCount++;
      if (r.errors.length) errorCount++;
      warningCount += r.warnings.length;
      results.push(r);
    });

    return {
      ok: true,
      fileName: fileName || '',
      total: results.length,
      results,
      dupCount, errorCount, warningCount
    };
  }

  function buildReportJson(validation, handled) {
    const details = validation.results.map((r, i) => ({
      index: i + 1,
      name: r.entry && r.entry.name,
      status: r.errors.length ? '失败' : (r.dupOf ? '重复' : '成功'),
      errors: r.errors.map(e => e.message),
      warnings: r.warnings,
      duplicateOf: r.dupOf ? r.dupOf.entryName : null,
      action: handled ? (handled[i] || 'skipped') : null,
      raw: r.raw
    }));
    return {
      fileName: validation.fileName,
      importedAt: K.nowIso(),
      total: validation.total,
      successCount: details.filter(d => d.status === '成功').length,
      failCount: details.filter(d => d.status === '失败').length,
      warningCount: validation.warningCount,
      duplicateCount: validation.dupCount,
      details,
      说明: '本报告由系统自动生成。errors 中的条目未导入；重复条目按教师选择的动作处理。可将本报告发送给 AI 协助修改源文件。'
    };
  }

  function buildReportMarkdown(validation) {
    const lines = [];
    const t = new Date();
    lines.push('# 导入错误报告');
    lines.push('');
    lines.push(`- 源文件：${validation.fileName || '（未知）'}`);
    lines.push(`- 生成时间：${K.fmtDateTime(t.toISOString())}`);
    lines.push(`- 总条数：${validation.total}`);
    lines.push(`- 错误条数：${validation.errorCount}`);
    lines.push(`- 重复条数：${validation.dupCount}`);
    lines.push(`- 警告条数：${validation.warningCount}`);
    lines.push('');
    validation.results.forEach((r, i) => {
      const title = `## ${i + 1}. ${r.entry && r.entry.name ? r.entry.name : '（无名称）'}`;
      lines.push(title);
      if (r.errors.length) {
        lines.push('**错误（未导入）：**');
        r.errors.forEach(e => lines.push(`- ${e.message}`));
      }
      if (r.dupOf) {
        lines.push(`**重复：**与题库/文件中的「${r.dupOf.entryName}」（${K.EQ_TYPE_MAP[r.dupOf.versionType].label}）反应物与生成物集合相同（忽略系数、顺序、条件、气体沉淀符号）。`);
      }
      if (r.warnings.length) {
        lines.push('**警告：**');
        r.warnings.forEach(w => lines.push(`- ${w}`));
      }
      if (!r.errors.length && !r.dupOf && !r.warnings.length) lines.push('校验通过。');
      lines.push('');
    });
    lines.push('---');
    lines.push('### 修改建议');
    lines.push('- 难度字段只能为：简单 / 中等 / 较难');
    lines.push('- 系数必须为正整数，禁止分数系数（热化学方程式请整体扩大为整数并同步调整 ΔH）');
    lines.push('- 离子电荷写法：单价离子如 `Na+`、`OH-`；多价离子请用 `^n` 写法，如 `Ca^2+`、`SO4^2-`');
    lines.push('- 电极反应式必须包含电子 `e-`；热化学方程式必须有 `extras.deltaH`');
    lines.push('- 光照条件 text 请写“光照”，不要使用 hr / hv / hν');
    lines.push('- 有机物化学式（结构简式）已支持：双键/三键写 = 与 ≡（键级不参与元素计数），聚合式系数写 n / 2n、链节写 [链节]n；请按教材写法人工核对');
    return lines.join('\n');
  }

  // 导出用：题库 → 导出 JSON
  function libraryToExportJson(library) {
    return {
      version: 1,
      exportedAt: K.nowIso(),
      entries: (library.entries || []).map(e => JSON.parse(JSON.stringify(e)))
    };
  }

  return { validateImportData, buildReportJson, buildReportMarkdown, libraryToExportJson, normalizeEntry };
});
