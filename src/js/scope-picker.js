/*
 * 范围选择器共享组件（学习项目范围 / 生成页出题范围共用）。
 * 从 generate.js renderScopePanel 抽出：维度渲染（教材版本/册别/章/节级联/物质类别/反应类型/
 * 知识模块/标签/难度/版本类型/星标/必出）。
 * 用法：ScopePicker.render(app, filter, opts) → Node
 *   filter  就地修改的 scopes 对象（空对象 = 全部题库）
 *   opts.onChange 每次勾选后回调（生成页传 () => App.refreshView()；弹窗传局部重渲染回调）
 *   opts.disabled 整体禁用（「使用全部题库」勾选时范围选择器置灰）
 *   opts.facets   可用分类值（App.projectFacets()）：仅展示并保留项目范围内的选项，
 *                 范围外的残留勾选自动清理（生成页用；项目范围编辑弹窗不传 = 全量展示）
 */
(function () {
  'use strict';
  const K = window.Const;
  const { el } = UI;

  function render(app, filter, opts) {
    opts = opts || {};
    const onChange = opts.onChange || function () {};
    const disabled = !!opts.disabled;
    const facets = opts.facets || null; // null = 不做项目范围过滤
    const cls = app.state.classifications;
    const wrap = el('div', { class: 'scope-picker' });
    if (disabled) wrap.style.opacity = '0.5';
    const f = filter;

    // facets 过滤：只保留项目范围内实际存在的选项值
    const inFacets = (key, v) => !facets || facets[key].has(v);
    // 残留勾选清理：已选值不在 facets 内（项目范围外的旧条件）→ 移除，
    // 否则条件隐藏却仍参与“且”过滤，导致“看不到却出不了题”。
    if (facets) {
      ['textbookVersions', 'books', 'chapters', 'sections', 'substanceCategories',
        'reactionTypes', 'knowledgeModules', 'tags', 'difficulties', 'versionTypes'].forEach(key => {
        if (Array.isArray(f[key]) && f[key].length) f[key] = f[key].filter(v => facets[key].has(v));
      });
    }

    // ---- 章节树选项（级联，容错旧数据无 chapters 字段）----
    const chaptersTree = cls.chapters || {};
    const treeBooks = Object.keys(chaptersTree);
    const allChapterOpts = [];
    for (const b of treeBooks) for (const c of chaptersTree[b] || []) {
      if (inFacets('chapters', c.chapter)) allChapterOpts.push({ value: c.chapter, label: b + '·' + c.chapter });
    }
    const allSectionOpts = [];
    for (const b of treeBooks) for (const c of chaptersTree[b] || []) {
      for (const s of c.sections || []) {
        if (inFacets('sections', s)) allSectionOpts.push({ value: s, label: b + '·' + c.chapter + '·' + s });
      }
    }
    const selectedBooks = f.books || [];
    // 章选项：勾了册别 → 所勾册的章（label=章名）；未勾 → 全部章（label=册名·章名）
    let chapterOpts;
    if (selectedBooks.length) {
      chapterOpts = [];
      for (const b of selectedBooks) {
        for (const c of chaptersTree[b] || []) {
          if (inFacets('chapters', c.chapter)) chapterOpts.push({ value: c.chapter, label: c.chapter });
        }
      }
    } else {
      chapterOpts = allChapterOpts;
    }
    // 节选项：勾了章 → 所勾各章的节并集（label=节名）；未勾章但勾册 → 该册全部节（label=章名·节名）；都没勾 → 全部节（label=册名·章名·节名）
    const selectedChapters = f.chapters || [];
    let sectionOpts;
    if (selectedChapters.length) {
      sectionOpts = [];
      for (const b of treeBooks) for (const c of chaptersTree[b] || []) {
        if (selectedChapters.includes(c.chapter)) {
          for (const s of c.sections || []) {
            if (inFacets('sections', s)) sectionOpts.push({ value: s, label: s });
          }
        }
      }
    } else if (selectedBooks.length) {
      sectionOpts = [];
      for (const b of selectedBooks) for (const c of chaptersTree[b] || []) {
        for (const s of c.sections || []) {
          if (inFacets('sections', s)) sectionOpts.push({ value: s, label: c.chapter + '·' + s });
        }
      }
    } else {
      sectionOpts = allSectionOpts;
    }

    const mkMulti = (label, field, options, cascade) => {
      const box = el('div', { style: { marginBottom: '6px' } });
      box.append(el('div', { style: { fontSize: '12px', color: 'var(--text-sub)' } }, label));
      const wrapRow = el('div', { class: 'check-row' });
      if (!f[field]) f[field] = [];
      // 级联维度：剔除不在当前选项中的幽灵勾选值（选项非空时才清，空树/旧数据保留原值容错）
      if ((field === 'chapters' || field === 'sections') && options.length) {
        const vals = new Set(options.map(o => (typeof o === 'object') ? o.value : o));
        f[field] = f[field].filter(x => vals.has(x));
      }
      options.forEach(o => {
        const val = (typeof o === 'object') ? o.value : o;
        const text = (typeof o === 'object') ? (o.label || o.value) : o;
        const cb = el('input', { type: 'checkbox' });
        if (disabled) cb.disabled = 'disabled';
        cb.checked = f[field].includes(val);
        cb.addEventListener('change', () => {
          if (disabled) return;
          if (cb.checked) f[field].push(val); else f[field] = f[field].filter(x => x !== val);
          onChange({ field, cascade: !!cascade });
        });
        wrapRow.append(el('label', { class: 'check-item' }, cb, text));
      });
      box.append(wrapRow);
      return box;
    };

    wrap.append(
      mkMulti('教材版本', 'textbookVersions', cls.textbookVersions.filter(v => inFacets('textbookVersions', v))),
      mkMulti('册别', 'books', cls.books.filter(v => inFacets('books', v)), true),
      mkMulti('章', 'chapters', chapterOpts, true),
      mkMulti('节', 'sections', sectionOpts),
      mkMulti('物质类别', 'substanceCategories', cls.substanceCategories.filter(v => inFacets('substanceCategories', v))),
      mkMulti('反应类型', 'reactionTypes', cls.reactionTypes.filter(v => inFacets('reactionTypes', v))),
      mkMulti('知识模块', 'knowledgeModules', cls.knowledgeModules.filter(v => inFacets('knowledgeModules', v))),
      mkMulti('标签', 'tags', cls.tags.filter(v => inFacets('tags', v))),
      mkMulti('难度', 'difficulties', K.DIFFICULTIES.filter(v => inFacets('difficulties', v))),
      mkMulti('版本类型', 'versionTypes', K.EQ_TYPES.map(t => ({ value: t.code, label: t.short }))
        .filter(o => inFacets('versionTypes', o.value)))
    );
    if (treeBooks.length) {
      wrap.append(el('div', { style: { fontSize: '12px', color: 'var(--text-sub)', marginTop: '4px' } },
        '章/节只细化“含该章/节的册别”，未细化的册整册生效；章+节同时勾选时按同一处教材位置匹配' +
        (facets ? '；仅显示当前项目范围内可用的选项' : '')));
    }
    const mkFlag = (label, field) => {
      const cb = el('input', { type: 'checkbox' });
      if (disabled) cb.disabled = 'disabled';
      cb.checked = !!f[field];
      cb.addEventListener('change', () => {
        if (disabled) return;
        f[field] = cb.checked ? true : undefined;
        onChange({ field });
      });
      return el('label', { class: 'check-item' }, cb, label);
    };
    wrap.append(el('div', { class: 'check-row', style: { marginTop: '6px' } }, mkFlag('仅星标', 'starred'), mkFlag('仅必出', 'mustInclude')));
    return wrap;
  }

  // 范围摘要（生成页顶部提示条/项目列表用）：主要维度拼接，「全部题库」当空
  function scopeSummary(app, scope) {
    const f = scope || {};
    const parts = [];
    if (f.textbookVersions && f.textbookVersions.length) parts.push('教材：' + f.textbookVersions.join('、'));
    if (f.books && f.books.length) parts.push('册别：' + f.books.join('、'));
    if (f.chapters && f.chapters.length) parts.push('章：' + f.chapters.slice(0, 3).join('、') + (f.chapters.length > 3 ? ' 等' : ''));
    if (f.sections && f.sections.length) parts.push('节：' + f.sections.length + ' 节');
    if (f.substanceCategories && f.substanceCategories.length) parts.push('物质类别：' + f.substanceCategories.length + ' 类');
    if (f.reactionTypes && f.reactionTypes.length) parts.push('反应类型：' + f.reactionTypes.slice(0, 3).join('、') + (f.reactionTypes.length > 3 ? ' 等' : ''));
    if (f.knowledgeModules && f.knowledgeModules.length) parts.push('模块：' + f.knowledgeModules.slice(0, 2).join('、') + (f.knowledgeModules.length > 2 ? ' 等' : ''));
    if (f.tags && f.tags.length) parts.push('标签：' + f.tags.join('、'));
    if (f.difficulties && f.difficulties.length) parts.push('难度：' + f.difficulties.join('、'));
    if (f.versionTypes && f.versionTypes.length) parts.push('版本：' + f.versionTypes.join('、'));
    if (f.starred === true) parts.push('仅星标');
    if (f.mustInclude === true) parts.push('仅必出');
    return parts.length ? parts.join(' · ') : '全部题库';
  }

  window.ScopePicker = { render, scopeSummary };
})();
