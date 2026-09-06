/* 题库管理视图 */
(function () {
  'use strict';
  const { el, toast, toastOk, toastErr, confirmDialog } = UI;
  const C = window.Chem, K = window.Const;

  const PAGE_SIZE = 50;
  let filterState = {
    search: '',
    textbookVersion: '', book: '', chapter: '', section: '',
    substanceCategories: [], reactionTypes: [], knowledgeModules: [],
    tags: [], difficulties: [], versionTypes: [],
    starred: false, mustInclude: false,
    enabled: 'all', // all | enabled | disabled
    minCount: '', maxCount: ''
  };

  function matches(app, e) {
    const f = filterState;
    if (f.search) {
      const q = f.search.toLowerCase();
      const hay = [
        e.name, e.description, e.remark, e.source,
        (e.tags || []).join(' '),
        (e.substanceCategories || []).join(' '),
        (e.reactionTypes || []).join(' '),
        (e.knowledgeModules || []).join(' '),
        ...(e.textbooks || []).map(t => `${t.version}${t.book}${t.chapter}${t.section}`),
        ...(e.versions || []).flatMap(v => [
          v.label, ...(v.reactants || []).map(s => s.formula), ...(v.products || []).map(s => s.formula),
          ...(v.conditions || []).map(c => c.text)
        ])
      ].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (f.textbookVersion && !(e.textbooks || []).some(t => t.version === f.textbookVersion)) return false;
    if (f.book && !(e.textbooks || []).some(t => t.book === f.book)) return false;
    if (f.chapter && !(e.textbooks || []).some(t => t.chapter === f.chapter)) return false;
    if (f.section && !(e.textbooks || []).some(t => t.section === f.section)) return false;
    for (const [key, field] of [['substanceCategories', 'substanceCategories'], ['reactionTypes', 'reactionTypes'], ['knowledgeModules', 'knowledgeModules'], ['tags', 'tags']]) {
      if (f[key].length && !f[key].some(v => (e[field] || []).includes(v))) return false;
    }
    if (f.difficulties.length && !f.difficulties.includes(e.difficulty)) return false;
    if (f.versionTypes.length && !(e.versions || []).some(v => f.versionTypes.includes(v.type))) return false;
    if (f.starred && !e.starred) return false;
    if (f.mustInclude && !e.mustInclude) return false;
    if (f.enabled === 'enabled' && e.enabled === false) return false;
    if (f.enabled === 'disabled' && e.enabled !== false) return false;
    if (f.minCount !== '' && (e.questionCount || 0) < Number(f.minCount)) return false;
    if (f.maxCount !== '' && (e.questionCount || 0) > Number(f.maxCount)) return false;
    return true;
  }

  App.views.library = {
    selected: new Set(),
    page: 1,
    expandedIds: new Set(), // 行展开（条目出题标记编辑器）

    render(container, app) {
      const view = el('div', { class: 'view view-library' });
      view.append(renderSidebar(app), renderMain(app));
      container.appendChild(view);
    }
  };
  const view = App.views.library;

  // 模块级刷新：侧边栏筛选与主列表共用（原先定义在 renderMain 内部，侧边栏引用会 ReferenceError 导致筛选不实时刷新）
  function refresh() { App.refreshView(); }

  function renderSidebar(app) {
    const cls = app.state.classifications;
    const side = el('div', { class: 'sidebar' });

    const p = el('div', { class: 'panel' });
    p.append(el('div', { class: 'panel-title' }, '筛选'));

    // 项目范围 facets：侧栏只展示当前项目内实际存在的分类标签（项目外的标签选不出也无作用）
    const facets = app.projectFacets();
    const inFacets = (key, v) => facets[key].has(v);

    const mkSelect = (label, options, key, allText) => {
      const sel = el('select', { style: { width: '100%' } });
      sel.append(el('option', { value: '' }, allText || '全部'));
      options.forEach(o => {
        const val = (typeof o === 'object') ? o.value : o;
        const text = (typeof o === 'object') ? (o.label || o.value) : o;
        sel.append(el('option', { value: val }, text));
      });
      // 残留值收敛：当前值不在选项中（项目范围外/级联失效）时回退「全部」
      if (filterState[key] && !options.some(o => (typeof o === 'object' ? o.value : o) === filterState[key])) {
        filterState[key] = '';
      }
      sel.value = filterState[key];
      sel.addEventListener('change', () => { filterState[key] = sel.value; view.page = 1; refresh(); });
      return el('label', { class: 'field' }, el('span', {}, label), sel);
    };

    // ---- 章/节级联下拉（容错旧数据无 chapters 字段）----
    const chaptersTree = (cls.chapters || {});
    const treeBooks = Object.keys(chaptersTree);
    // 章选项：选了册 → 该册的章；未选 → 全部章（带册名前缀）
    let chapterSelOpts = [];
    if (filterState.book && chaptersTree[filterState.book]) {
      chapterSelOpts = (chaptersTree[filterState.book] || []).filter(c => inFacets('chapters', c.chapter))
        .map(c => c.chapter);
    } else {
      for (const b of treeBooks) for (const c of chaptersTree[b] || []) {
        if (inFacets('chapters', c.chapter)) chapterSelOpts.push({ value: c.chapter, label: b + '·' + c.chapter });
      }
    }
    // 级联失效清理：当前章值不在选项中时回退「全部」（含空树容错）
    if (filterState.chapter && !chapterSelOpts.some(o => (typeof o === 'object' ? o.value : o) === filterState.chapter)) {
      filterState.chapter = '';
    }
    // 节选项：选了章 → 该章的节；选了册 → 该册全部节（章名前缀）；都没选 → 全部节（册·章前缀）
    let sectionSelOpts = [];
    if (filterState.chapter) {
      for (const b of treeBooks) for (const c of chaptersTree[b] || []) {
        if (c.chapter === filterState.chapter) {
          sectionSelOpts = (c.sections || []).filter(s => inFacets('sections', s));
        }
      }
    } else if (filterState.book && chaptersTree[filterState.book]) {
      for (const c of chaptersTree[filterState.book] || []) {
        for (const s of c.sections || []) {
          if (inFacets('sections', s)) sectionSelOpts.push({ value: s, label: c.chapter + '·' + s });
        }
      }
    } else {
      for (const b of treeBooks) for (const c of chaptersTree[b] || []) {
        for (const s of c.sections || []) {
          if (inFacets('sections', s)) sectionSelOpts.push({ value: s, label: b + '·' + c.chapter + '·' + s });
        }
      }
    }
    if (filterState.section && !sectionSelOpts.some(o => (typeof o === 'object' ? o.value : o) === filterState.section)) {
      filterState.section = '';
    }

    const mkMulti = (label, options, key) => {
      const box = el('div', { style: { marginBottom: '6px' } });
      box.append(el('div', { style: { fontSize: '12px', color: 'var(--text-sub)' } }, label));
      const wrap = el('div', { class: 'check-row' });
      // 残留勾选收敛：项目范围外的旧勾选自动移除（隐藏但仍参与过滤会“看不到却筛空列表”）
      if (filterState[key].length) filterState[key] = filterState[key].filter(v => inFacets(key, v));
      options.forEach(o => {
        const val = (typeof o === 'object') ? o.value : o;
        const text = (typeof o === 'object') ? (o.label || o.value) : o;
        const cb = el('input', { type: 'checkbox' });
        cb.checked = filterState[key].includes(val);
        cb.addEventListener('change', () => {
          if (cb.checked) filterState[key].push(val); else filterState[key] = filterState[key].filter(x => x !== val);
          view.page = 1; refresh();
        });
        wrap.append(el('label', { class: 'check-item' }, cb, text));
      });
      box.append(wrap);
      return box;
    };

    p.append(
      mkSelect('教材版本', cls.textbookVersions.filter(v => inFacets('textbookVersions', v)), 'textbookVersion'),
      mkSelect('册别', cls.books.filter(v => inFacets('books', v)), 'book'),
      mkSelect('章', chapterSelOpts, 'chapter'),
      mkSelect('节', sectionSelOpts, 'section'),
      mkMulti('物质类别', cls.substanceCategories.filter(v => inFacets('substanceCategories', v)), 'substanceCategories'),
      mkMulti('反应类型', cls.reactionTypes.filter(v => inFacets('reactionTypes', v)), 'reactionTypes'),
      mkMulti('知识模块', cls.knowledgeModules.filter(v => inFacets('knowledgeModules', v)), 'knowledgeModules'),
      mkMulti('自定义标签', cls.tags.filter(v => inFacets('tags', v)), 'tags'),
      mkMulti('难度', K.DIFFICULTIES.filter(v => inFacets('difficulties', v)), 'difficulties'),
      mkMulti('版本类型', K.EQ_TYPES.map(t => ({ value: t.code, label: t.short }))
        .filter(o => inFacets('versionTypes', o.value)), 'versionTypes')
    );
    p.append(el('div', { style: { fontSize: '11.5px', color: 'var(--text-sub)', margin: '4px 0 6px' } },
      '选项已按当前学习项目范围收敛（项目外的分类不展示）。'));

    const flagBox = el('div', { style: { marginBottom: '6px' } });
    const mkFlag = (label, key) => {
      const cb = el('input', { type: 'checkbox' });
      cb.checked = filterState[key];
      cb.addEventListener('change', () => { filterState[key] = cb.checked; view.page = 1; refresh(); });
      return el('label', { class: 'check-item' }, cb, label);
    };
    flagBox.append(mkFlag('仅星标', 'starred'), mkFlag('仅必出', 'mustInclude'));
    p.append(flagBox);

    const enableSel = el('select', { style: { width: '100%' } });
    [['all', '全部状态'], ['enabled', '仅启用'], ['disabled', '仅禁用']].forEach(([v, t]) =>
      enableSel.append(el('option', { value: v }, t)));
    enableSel.value = filterState.enabled;
    enableSel.addEventListener('change', () => { filterState.enabled = enableSel.value; view.page = 1; refresh(); });
    p.append(el('label', { class: 'field' }, el('span', {}, '启用状态'), enableSel));

    const rangeBox = el('div', { class: 'check-row', style: { marginTop: '6px' } });
    const minC = el('input', { type: 'number', placeholder: '最少', style: { width: '70px' }, value: filterState.minCount });
    const maxC = el('input', { type: 'number', placeholder: '最多', style: { width: '70px' }, value: filterState.maxCount });
    minC.addEventListener('input', () => { filterState.minCount = minC.value; view.page = 1; refresh(); });
    maxC.addEventListener('input', () => { filterState.maxCount = maxC.value; view.page = 1; refresh(); });
    rangeBox.append(el('span', { style: { fontSize: '12px', color: 'var(--text-sub)' } }, '出题次数'), minC, el('span', {}, '–'), maxC);
    p.append(rangeBox);

    const resetBtn = el('button', {
      class: 'btn secondary small', style: { marginTop: '10px' }, onclick: () => {
        filterState = {
          search: filterState.search, textbookVersion: '', book: '', chapter: '', section: '',
          substanceCategories: [], reactionTypes: [], knowledgeModules: [],
          tags: [], difficulties: [], versionTypes: [],
          starred: false, mustInclude: false, enabled: 'all', minCount: '', maxCount: ''
        };
        view.page = 1;
        refresh();
      }
    }, '重置筛选');

    side.append(p, resetBtn);
    return side;
  }

  function renderMain(app) {
    const main = el('div', { class: 'main-area' });
    // 项目范围硬过滤：列表只显示当前学习项目范围内的条目（侧栏筛选在范围内继续细化）
    const project = app.currentProject();
    const inScope = Generator.scopedEntries(app.state.library, project.scope);
    const entries = inScope.filter(e => matches(app, e));
    view.selected = new Set(Array.from(view.selected).filter(id => entries.some(e => e.id === id)));
    // 展开状态也按当前过滤集合收敛（切项目后残留展开条目无害，但收敛更干净）
    view.expandedIds = new Set(Array.from(view.expandedIds).filter(id => entries.some(e => e.id === id)));

    const toolbar = el('div', { class: 'list-toolbar' });
    const search = el('input', { type: 'text', placeholder: '搜索：名称 / 描述 / 化学式 / 条件 / 标签 / 备注…', value: filterState.search });
    search.addEventListener('input', () => { filterState.search = search.value; view.page = 1; refreshList(); });

    const stats = app.projectPairStats(project);
    toolbar.append(
      el('button', {
        class: 'btn', onclick: () => {
          const entry = app.newEntry();
          EntryEditor.openEntryEditor(app, entry, {
            onSave: async (saved) => {
              app.state.library.entries.push(saved);
              await app.saveLibrary();
              toastOk('已新增条目');
              refresh();
            }
          });
        }
      }, '＋ 新增条目'),
      search,
      el('span', { style: { color: 'var(--text-sub)', fontSize: '13px' } }, `共 ${entries.length} 条`),
      el('span', {
        class: 'tag', style: { cursor: 'pointer' },
        title: '当前学习项目的出题范围（点击前往「设置 → 学习项目」切换或管理项目）',
        onclick: () => app.showView('settings')
      }, '项目：' + project.name)
    );

    // 批量操作条
    const batchBar = el('div', { class: 'list-toolbar', style: { background: 'var(--bg-card)', padding: '8px 10px', borderRadius: '8px' } });
    const selInfo = el('span', { style: { color: 'var(--text-sub)', fontSize: '13px' } }, '未选择');
    batchBar.append(selInfo,
      el('button', {
        class: 'btn small', onclick: () => batchSetEnabled(app, entries, true)
      }, '批量启用（当前筛选）'),
      el('button', {
        class: 'btn small', onclick: () => batchSetEnabled(app, entries, false)
      }, '批量禁用（当前筛选）'),
      el('button', {
        class: 'btn small secondary', onclick: () => batchAddToWorksheet(app, entries)
      }, '勾选加入当前作业'),
      el('button', {
        class: 'btn small danger', onclick: async () => {
          if (!view.selected.size) { toast('请先勾选条目', 'warning'); return; }
          const ok = await confirmDialog('删除条目',
            `确定将勾选的 ${view.selected.size} 个条目移入回收站吗？（可从回收站恢复）`, true);
          if (!ok) return;
          for (const id of Array.from(view.selected)) await app.deleteEntry(id);
          view.selected.clear();
          refresh();
        }
      }, '删除勾选'),
      el('button', {
        class: 'btn small secondary', onclick: () => {
          if (!view.selected.size) { toast('请先勾选条目', 'warning'); return; }
          const sel = entries.filter(e => view.selected.has(e.id));
          openImageExportDialog(app, sel);
        }
      }, '导出图片'),
      el('span', { style: { flex: '1' } }),
      el('span', {
        style: { color: 'var(--text-sub)', fontSize: '12.5px' },
        title: '落后 = 计数恰为当前轮数的「方程式+题型」对数（再出一次即进入下一轮）'
      }, `当前项目：${project.name} · 学习进度：${stats.round} 轮（落后 ${stats.laggards} 对）`));

    const tableWrap = el('div', { class: 'lib-table-wrap', style: { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '10px', overflow: 'auto', maxHeight: 'calc(100% - 110px)' } });
    const table = renderTable(app, entries);
    tableWrap.append(table);

    const pager = renderPager(app, entries);

    main.append(toolbar, batchBar, tableWrap, pager);
    return main;

    function refreshList() {
      // 搜索过滤后保持列表滚动位置（整表重建会丢 scrollTop）
      const st = tableWrap.scrollTop, sl = tableWrap.scrollLeft;
      const project = app.currentProject();
      const inScope = Generator.scopedEntries(app.state.library, project.scope);
      const list = inScope.filter(e => matches(app, e));
      const newTable = renderTable(app, list);
      tableWrap.innerHTML = '';
      tableWrap.append(newTable);
      tableWrap.scrollTop = st;
      tableWrap.scrollLeft = sl;
      selInfo.textContent = view.selected.size ? `已选 ${view.selected.size} 条` : '未选择';
      const cnt = main.querySelector('.list-toolbar span');
      if (cnt) cnt.textContent = `共 ${list.length} 条`;
    }
  }

  function batchSetEnabled(app, entries, enabled) {
    let n = 0;
    for (const e of entries) {
      if (e.enabled !== enabled) { e.enabled = enabled; n++; }
    }
    app.saveLibrary().then(() => { toastOk(`已${enabled ? '启用' : '禁用'} ${n} 条`); });
  }

  function batchAddToWorksheet(app, entries) {
    if (!view.selected.size) { toast('请先勾选条目', 'warning'); return; }
    if (!app.state.worksheet) app.newWorksheet([], null);
    const ws = app.state.worksheet;
    let added = 0;
    for (const id of view.selected) {
      const e = app.getEntry(id);
      if (!e || e.enabled === false) continue;
      if (ws.items.some(it => it.entryId === id)) continue;
      const v = (e.versions || [])[0];
      if (!v) continue;
      ws.items.push(Generator.makeItem(e, v, 'B'));
      added++;
    }
    app.updateBadge();
    toastOk(`已加入 ${added} 题，请到“当前作业”调整题型`);
  }

  function renderTable(app, entries) {
    const table = el('table', { class: 'list' });
    const thead = el('tr', {},
      el('th', { style: { width: '30px' } }, ''),
      el('th', { style: { width: '26px' } }, ''),
      el('th', {}, '反应名称 / 主方程式'),
      el('th', { style: { width: '112px' } }, '版本'),
      el('th', { style: { width: '150px' } }, '教材 / 模块'),
      el('th', { style: { width: '110px' } }, '反应类型'),
      el('th', { style: { width: '50px' } }, '难度'),
      el('th', { style: { width: '56px' } }, '标记'),
      el('th', { style: { width: '40px' }, title: '该条目在当前学习项目内各「可出对」计数的 min（都出过 1 次 = 1，以此类推）' }, '出题(本轮)'),
      el('th', { style: { width: '104px' } }, '最近出题'),
      el('th', { style: { width: '212px' } }, '操作'));
    table.append(el('thead', {}, thead));

    const totalPages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
    if (view.page > totalPages) view.page = totalPages;
    const start = (view.page - 1) * PAGE_SIZE;
    const pageEntries = entries.slice(start, start + PAGE_SIZE);

    const tbody = el('tbody');
    if (!pageEntries.length) {
      tbody.append(el('tr', {}, el('td', { colspan: '11' },
        el('div', { class: 'empty-state' }, '当前筛选条件下没有条目。可先到“数据管理”导入示例题库。'))));
    }
    pageEntries.forEach(e => {
      const mainV = (e.versions || [])[0];
      const cb = el('input', { type: 'checkbox' });
      cb.checked = view.selected.has(e.id);
      cb.addEventListener('change', () => {
        if (cb.checked) view.selected.add(e.id); else view.selected.delete(e.id);
        App.refreshView();
      });
      // 行展开按钮：▶/▼（出题标记编辑器）
      const expanded = view.expandedIds.has(e.id);
      const expBtn = el('button', {
        class: 'btn small secondary', style: { padding: '2px 7px', fontSize: '12px' },
        title: expanded ? '收起出题标记' : '展开出题标记（各题型计数与手动 ±1）',
        onclick: () => {
          if (expanded) view.expandedIds.delete(e.id); else view.expandedIds.add(e.id);
          App.refreshView();
        }
      }, expanded ? '▼' : '▶');
      // 行布局统一：名称/主方程式固定两行、版本标签上限 3 个 + 溢出计数、模块两行、
      // 操作按钮固定 4 列网格（7 个按钮恒两行）——所有行高一致
      const nameCell = el('td', {},
        el('div', { class: 'cell-line cell-name' }, e.name || '（未命名）'),
        mainV
          ? el('div', { class: 'cell-line cell-eq eq' })
          : el('div', { class: 'cell-line cell-eq' }, '—'));
      if (mainV) nameCell.lastChild.innerHTML = C.equationText(mainV);

      const versionsCell = el('td', {}, el('div', { class: 'cell-tags' }));
      const vs = e.versions || [];
      vs.slice(0, 3).forEach(v => {
        versionsCell.firstChild.append(el('span', { class: 'tag type-' + v.type },
          K.EQ_TYPE_MAP[v.type] ? K.EQ_TYPE_MAP[v.type].short : v.type));
      });
      if (vs.length > 3) versionsCell.firstChild.append(el('span', { class: 'tag' }, '+' + (vs.length - 3)));

      const tb = (e.textbooks || [])[0];
      const tbText = tb ? `${tb.version}${tb.book ? ' ' + tb.book : ''}` : '—';
      const moduleCell = el('td', {},
        el('div', { class: 'cell-line' }, tbText),
        el('div', { class: 'cell-line cell-sub' }, (e.knowledgeModules || []).join('、') || '—'));

      const flags = [];
      if (e.starred) flags.push('★');
      if (e.mustInclude) flags.push('必出');
      if (e.enabled === false) flags.push('已禁用');

      const row = el('tr', { class: view.flashId === e.id ? 'row-flash' : '' },
        el('td', {}, cb),
        el('td', {}, expBtn),
        nameCell,
        versionsCell,
        moduleCell,
        el('td', {}, el('div', { class: 'cell-line' }, (e.reactionTypes || []).join('、') || '—')),
        el('td', {}, el('div', { class: 'cell-line' }, el('span', { class: 'difficulty-' + (e.difficulty || '') }, e.difficulty || '—'))),
        el('td', {}, el('div', { class: 'cell-line cell-sub' }, flags.join(' ') || '—')),
        el('td', { title: '全局出题 ' + (e.questionCount || 0) + ' 次（详情弹窗可见）' }, String(app.entryProjectCount(e))),
        el('td', {}, el('div', { class: 'cell-line' }, e.lastUsedAt ? K.fmtDateTime(e.lastUsedAt) : '—')),
        el('td', {}, renderRowActions(app, e)));
      if (e.enabled === false) row.style.opacity = '0.55';
      tbody.append(row);
      // 展开行：该条目各版本的 B/C/D/E/H 计数 + 手动 ±1（不计入 countedItems）
      if (expanded) tbody.append(renderExpandRow(app, e));
    });
    // flash 标记只在本次渲染生效（动画留在 DOM 上，后续刷新不再重复闪）
    view.flashId = null;
    table.append(tbody);
    return table;
  }

  // 展开行：按版本分块展示各题型计数与手动标记按钮
  function renderExpandRow(app, e) {
    const tr = el('tr', { class: 'expand-row' });
    const td = el('td', { colspan: '11', style: { background: 'var(--bg)', padding: '8px 12px' } });
    const box = el('div', {});
    box.append(el('div', { style: { fontSize: '12px', color: 'var(--text-sub)', marginBottom: '6px' } },
      '同一反应的多个条目/版本共享标记（按反应计；化学式版与离子式版分开计）。手动「已出 +1 / −1」直接调整当前项目计数（下限 0）。'));
    (e.versions || []).forEach(v => {
      const vBox = el('div', { style: { marginBottom: '8px' }, class: 'panel', _version: v });
      const eqLine = el('div', { class: 'eq', style: { fontSize: '14px', marginBottom: '4px' } });
      eqLine.innerHTML = C.equationHTML(v);
      vBox.append(
        el('div', { style: { fontSize: '12px', color: 'var(--text-sub)' } },
          `${v.label || v.type}（${K.EQ_TYPE_MAP[v.type] ? K.EQ_TYPE_MAP[v.type].label : v.type}）`),
        eqLine);
      const rows = el('div', {});
      for (const t of ['B', 'C', 'D', 'E', 'H']) {
        const suitable = Generator.typeSuitable(e, v, t);
        const cnt = app.pairCount(v, t);
        const rowLine = el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '2px 0' } });
        if (suitable) {
          rowLine.append(
            el('span', { class: 'tag' }, t),
            el('span', {}, '计数 ' + cnt),
            el('button', {
              class: 'btn small secondary', style: { padding: '1px 8px' },
              onclick: async () => { await app.markPair(v, t, 1); App.refreshView(); }
            }, '已出 +1'),
            el('button', {
              class: 'btn small secondary', style: { padding: '1px 8px' },
              onclick: async () => { await app.markPair(v, t, -1); App.refreshView(); }
            }, '−1'));
        } else {
          rowLine.append(
            el('span', { class: 'tag', style: { opacity: '0.5' } }, t),
            el('span', { style: { color: 'var(--text-sub)', fontSize: '12px' } },
              t === 'C' ? '不可出（C 类需条目有文字描述）' : t === 'H' ? '不可出（H 类需条目有开放题干）' : '不可出'));
        }
        rows.append(rowLine);
      }
      vBox.append(rows);
      box.append(vBox);
    });
    if (!(e.versions || []).length) {
      box.append(el('div', { class: 'empty-state' }, '该条目没有方程式版本。'));
    }
    td.append(box);
    tr.append(td);
    return tr;
  }

  function renderRowActions(app, e) {
    // 4 列网格：7 个按钮恒两行，行高统一（题库列表行排版一致性）
    const box = el('div', { class: 'row-actions' });
    const mk = (text, fn, cls, title) => el('button', { class: 'btn small ' + (cls || 'secondary'), onclick: fn, title: title || '' }, text);
    box.append(
      mk('编辑', () => {
        EntryEditor.openEntryEditor(app, e, {
          onSave: async (saved) => {
            const idx = app.state.library.entries.findIndex(x => x.id === e.id);
            if (idx >= 0) app.state.library.entries[idx] = saved;
            await app.saveLibrary();
            toastOk('已保存修改');
            App.refreshView();
          }
        });
      }),
      mk('详情', () => showDetail(app, e)),
      mk(e.enabled === false ? '启用' : '禁用', async () => {
        e.enabled = e.enabled === false;
        await app.saveLibrary();
        App.refreshView();
      }),
      mk('创建副本', async () => {
        // 在题库内复制该条目（副本追加在题库末尾），非剪贴板操作
        const copy = JSON.parse(JSON.stringify(e));
        copy.id = K.uid('R');
        copy.name = e.name + '（副本）';
        copy.questionCount = 0;
        copy.lastUsedAt = '';
        copy.createdAt = copy.updatedAt = K.nowIso();
        copy.versions.forEach(v => { v.id = K.uid('v'); v.questionCount = 0; });
        app.state.library.entries.push(copy);
        await app.saveLibrary();
        // 跳到副本所在页并高亮定位，让复制结果立刻可见
        view.page = Math.max(1, Math.ceil(app.state.library.entries.length / PAGE_SIZE));
        view.flashId = copy.id;
        App.refreshView();
        const tr = document.querySelector('tr.row-flash');
        if (tr) tr.scrollIntoView({ block: 'center' });
        toastOk(`已在题库末尾创建「${copy.name}」（第 ${view.page} 页）`);
      }),
      mk('复制', async () => {
        // 复制主版本方程式文本到系统剪贴板（Unicode 下标美化）
        const mainV = (e.versions || [])[0];
        if (!mainV) { toast('该条目没有可复制的方程式', 'warning'); return; }
        try {
          await window.bridge.clipboard.writeText(C.equationUnicodeText(mainV));
          toastOk('方程式文本已复制到剪贴板');
        } catch (err) { toastErr('复制失败：' + err.message); }
      }),
      mk('加入作业', () => {
        if (!app.state.worksheet) app.newWorksheet([], null);
        const ws = app.state.worksheet;
        if (ws.items.some(it => it.entryId === e.id)) { toast('该条目已在当前作业中', 'warning'); return; }
        const v = (e.versions || [])[0];
        if (!v) { toastErr('该条目没有可用版本'); return; }
        ws.items.push(Generator.makeItem(e, v, 'B'));
        app.updateBadge();
        toastOk(`已加入「${e.name}」`);
      }, ''),
      mk('删除', async () => {
        const ok = await confirmDialog('删除条目', `确定将「${e.name}」移入回收站吗？`, true);
        if (!ok) return;
        await app.deleteEntry(e.id);
        App.refreshView();
      }, 'danger')
    );
    return box;
  }

  function renderPager(app, entries) {
    const totalPages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
    const pager = el('div', { class: 'list-toolbar', style: { justifyContent: 'center' } });
    pager.append(
      el('button', { class: 'btn small secondary', onclick: () => { if (view.page > 1) { view.page--; App.refreshView(); } } }, '上一页'),
      el('span', { style: { margin: '0 10px' } }, `${view.page} / ${totalPages}`),
      el('button', { class: 'btn small secondary', onclick: () => { if (view.page < totalPages) { view.page++; App.refreshView(); } } }, '下一页'));
    return pager;
  }

  function showDetail(app, e) {
    const box = el('div', {});
    const head = el('div', { style: { marginBottom: '10px' } },
      el('div', { style: { fontWeight: 'bold', fontSize: '16px' } }, e.name || '（未命名）'),
      el('div', { style: { color: 'var(--text-sub)', marginTop: '4px' } },
        `${e.difficulty || '—'} · 全局出题 ${e.questionCount || 0} 次 · 项目内计数 ${app.entryProjectCount(e)} · 最近出题 ${e.lastUsedAt ? K.fmtDateTime(e.lastUsedAt) : '—'}`));
    box.append(head);

    if (e.description) box.append(el('div', { style: { marginBottom: '8px' } }, '文字描述：' + e.description));
    if (e.openPrompt) box.append(el('div', { style: { marginBottom: '8px' } }, '开放题干：' + e.openPrompt));

    (e.versions || []).forEach(v => {
      const vbox = el('div', { class: 'panel', style: { marginBottom: '8px' } });
      const eqBox = el('div', { class: 'eq', style: { fontSize: '15px' } });
      eqBox.innerHTML = C.equationHTML(v);
      const stats = [];
      if (v.extras && v.extras.deltaH) stats.push('ΔH = ' + v.extras.deltaH);
      if (v.extras && v.extras.electrode) stats.push(v.extras.electrode);
      stats.push(`出题 ${v.questionCount || 0} 次`);
      vbox.append(
        el('div', { class: 'panel-title' }, `${v.label}（${v.reversible ? '可逆 ⇌' : '不可逆 ='}）`),
        eqBox,
        el('div', { style: { fontSize: '12px', color: 'var(--text-sub)', marginTop: '6px' } }, stats.join(' · ')),
        (v.checkStatus && v.checkStatus.warnings || []).length ? el('div', { style: { fontSize: '12px', color: 'var(--warning)', marginTop: '4px' } },
          '⚠ ' + v.checkStatus.warnings.join('；')) : null
      );
      box.append(vbox);
    });

    const clsInfo = el('div', { class: 'panel' });
    const mkLine = (label, arr) => el('div', { style: { fontSize: '12.5px', marginBottom: '4px' } },
      label + '：' + ((arr && arr.length) ? arr.join('、') : '—'));
    clsInfo.append(
      el('div', { class: 'panel-title' }, '分类信息'),
      ...(e.textbooks || []).map(t => mkLine('教材', [`${t.version}/${t.book}/${t.chapter}/${t.section}${t.context ? '（原栏目：' + t.context + '）' : ''}`])),
      mkLine('物质类别', e.substanceCategories),
      mkLine('反应类型', e.reactionTypes),
      mkLine('知识模块', e.knowledgeModules),
      mkLine('标签', e.tags),
      mkLine('备注', [e.remark]),
      mkLine('来源', [e.source]),
      mkLine('创建时间', [K.fmtDateTime(e.createdAt)])
    );
    box.append(clsInfo);

    UI.modal({ title: '条目详情', width: 620, body: box, buttons: [{ text: '关闭', value: null }] });
  }

  // ---------- 导出图片 ----------
  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function sanitizeFileName(s) {
    return String(s || '未命名').replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 40) || '未命名';
  }

  // 版本挑选：main 主版本 | all 全部 | custom 指定类型
  function pickImageVersions(entry, scope, allowedTypes) {
    const vs = entry.versions || [];
    if (!vs.length) return [];
    if (scope === 'all') return vs.slice();
    if (scope === 'custom') return vs.filter(v => (allowedTypes || []).includes(v.type));
    return [vs[0]];
  }

  // 单块 HTML：编号 / 名称 / 类型标签 / 难度 / 教材 元信息行（可选）+ 方程式（恒有）
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

  // 完整文档：白底、内容自适应宽度（内容占满图片主体，不再用固定 860px 画布留白）、
  // 西文字体+中文字体栈（英文/数字/符号走西文字体，中文回退中文字体）、
  // 条件上下标（复用 .eq 定位规则）、按 scale 放大。
  // 排版选项：textAlign/eqAlign（文字与方程式水平位置）、vAlign（内容垂直对齐，
  // 仅在 heightMode='fixed' 时有额外空间可供对齐）、metaFontPt（文字字号）、
  // gapPt（文字与方程式间距）、padPt（图片内边距）、zhFont/enFont（中文/西文字体）。
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
    // 字体栈：西文在前 → 英文/数字/符号用西文字体；中文回退中文字体
    const family = `'${enFont}', '${zhFont}', serif`;
    const minW = Math.round(180 * S);
    // 高度模式：auto 贴合内容；fixed 统一画布高（内容超出时自动增高，不裁切），
    // vAlign 在画布内上/中/下摆放内容（body 为纵向 flex，justify-content 即对齐方式；
    // auto 时 body 高度=内容高度，对齐自然无效果）
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

  // 核心导出：面板与自动化测试共用（挂到 App 供 VERIFYSETTINGS 调用）
  async function doExportImages(app, entries, opt) {
    const items = [];
    entries.forEach(e => {
      pickImageVersions(e, opt.versionScope, opt.allowedTypes).forEach(v => {
        items.push({ e, v, no: items.length + 1 });
      });
    });
    if (!items.length) return { ok: false, message: '所选条目没有可导出的方程式版本' };
    const fmt = opt.format === 'jpeg' ? 'jpeg' : 'png';
    const ext = fmt === 'jpeg' ? 'jpg' : 'png';
    const base = String(opt.baseName || '化学方程式').trim() || '化学方程式';
    const s = app.state.settings;
    const defaultDir = (s.export && s.export.imagesFolder) || '';
    let payload;
    if (opt.mode === 'single') {
      const html = buildImageDocHtml(items.map(it => imageBlockHtml(it.e, it.v, it.no, opt)), opt);
      payload = {
        mode: 'single', format: fmt, htmls: [html],
        names: [`${base}_${K.timestampForFile()}.${ext}`],
        defaultDir, saveMode: opt.saveMode
      };
    } else {
      const htmls = items.map(it => buildImageDocHtml([imageBlockHtml(it.e, it.v, it.no, opt)], opt));
      const names = items.map((it, i) =>
        `${base}_${String(i + 1).padStart(3, '0')}_${sanitizeFileName(it.e.name)}.${ext}`);
      payload = { mode: 'multi', format: fmt, htmls, names, defaultDir, saveMode: opt.saveMode };
    }
    return await window.bridge.exportImages(payload);
  }
  App._exportImagesCore = doExportImages;
  App._openImageExportDialog = openImageExportDialog;

  // 导出图片设置面板（选项持久化到 settings.export.imageOptions）
  // 布局：左（选项，可滚动）+ 右（大幅实时预览：适宽/整页/100%/±/Ctrl+滚轮 缩放；
  // 「每条一张图」时可逐张切换预览图片并实时联动排版参数）
  function openImageExportDialog(app, entries) {
    const s = app.state.settings;
    if (!s.export.imageOptions) s.export.imageOptions = {};
    const o = Object.assign({
      mode: 'single', versionScope: 'main', allowedTypes: ['chemical'],
      number: false, showName: false, showType: false, showDifficulty: false, showTextbook: false,
      fontPt: 16, scale: 2, cols: 1, format: 'png', baseName: '化学方程式', saveMode: 'ask',
      // 排版选项（文字字号/文字位置/方程式位置/间距/边距/字体）
      metaFontPt: 10, textAlign: 'left', eqAlign: 'left', gapPt: 4, padPt: 27,
      zhFont: 'Microsoft YaHei', enFont: 'Times New Roman',
      // 高度与垂直对齐（heightMode=fixed 时 vAlign 生效）
      heightMode: 'auto', canvasHeightPt: 120, vAlign: 'middle'
    }, s.export.imageOptions);
    if (!o.zhFont) o.zhFont = 'Microsoft YaHei';
    if (!o.enFont) o.enFont = 'Times New Roman';

    const mkRadio = (name, val, label, checked) => {
      const r = el('input', { type: 'radio', name });
      r.value = val;
      r.checked = checked;
      return el('label', { class: 'check-item' }, r, label);
    };
    const mkCheck = (key, label, checked) => {
      const cb = el('input', { type: 'checkbox' });
      cb.checked = checked;
      cb.addEventListener('change', () => { o[key] = cb.checked; refreshUI(); });
      return el('label', { class: 'check-item' }, cb, label);
    };

    const modeSingle = mkRadio('imgmode', 'single', '合成一张图', o.mode === 'single');
    const modeMulti = mkRadio('imgmode', 'multi', '每条一张图', o.mode !== 'single');
    [modeSingle, modeMulti].forEach(r => r.querySelector('input').addEventListener('change', () => {
      o.mode = r.querySelector('input').value; colsRow.style.display = o.mode === 'single' ? '' : 'none'; refreshUI();
    }));

    const scopeMain = mkRadio('imgscope', 'main', '仅主版本', o.versionScope === 'main');
    const scopeAll = mkRadio('imgscope', 'all', '全部版本', o.versionScope === 'all');
    const scopeCustom = mkRadio('imgscope', 'custom', '指定类型：', o.versionScope === 'custom');
    const typeChecks = el('span', { class: 'check-row', style: { display: o.versionScope === 'custom' ? 'inline-flex' : 'none' } });
    K.EQ_TYPES.forEach(t => {
      const cb = el('input', { type: 'checkbox' });
      cb.checked = (o.allowedTypes || []).includes(t.code);
      cb.addEventListener('change', () => {
        o.allowedTypes = o.allowedTypes || [];
        if (cb.checked) { if (!o.allowedTypes.includes(t.code)) o.allowedTypes.push(t.code); }
        else o.allowedTypes = o.allowedTypes.filter(x => x !== t.code);
        refreshUI();
      });
      typeChecks.append(el('label', { class: 'check-item' }, cb, t.short));
    });
    [scopeMain, scopeAll, scopeCustom].forEach(r => r.querySelector('input').addEventListener('change', () => {
      o.versionScope = r.querySelector('input').value;
      typeChecks.style.display = o.versionScope === 'custom' ? 'inline-flex' : 'none';
      refreshUI();
    }));

    const colsSel = el('select');
    [['1', '单列'], ['2', '双列']].forEach(([v, t]) => colsSel.append(el('option', { value: v }, t)));
    colsSel.value = String(o.cols || 1);
    colsSel.addEventListener('change', () => { o.cols = Number(colsSel.value); refreshUI(); });
    const colsRow = el('label', { class: 'field', style: { width: '110px' } }, el('span', {}, '列数（合成图）'), colsSel);

    const fontInput = el('input', { type: 'number', min: '12', max: '28', step: '1', style: { width: '70px' } });
    fontInput.value = o.fontPt;
    fontInput.addEventListener('input', () => { o.fontPt = Number(fontInput.value) || 16; refreshUI(); });
    const scaleSel = el('select');
    [['1', '标准（1x）'], ['2', '高清（2x，推荐）'], ['3', '极清（3x）']].forEach(([v, t]) => scaleSel.append(el('option', { value: v }, t)));
    scaleSel.value = String(o.scale || 2);
    scaleSel.addEventListener('change', () => { o.scale = Number(scaleSel.value); applyZoom(); });
    const fmtSel = el('select');
    [['png', 'PNG（无损）'], ['jpeg', 'JPEG']].forEach(([v, t]) => fmtSel.append(el('option', { value: v }, t)));
    fmtSel.value = o.format || 'png';
    fmtSel.addEventListener('change', () => { o.format = fmtSel.value; refreshUI(); });

    // ---- 排版选项：文字字号 / 位置 / 间距 / 边距 / 中文字体 / 西文字体 ----
    const metaFontInput = el('input', { type: 'number', min: '8', max: '20', step: '1', style: { width: '70px' } });
    metaFontInput.value = o.metaFontPt != null ? o.metaFontPt : 10;
    metaFontInput.addEventListener('input', () => { o.metaFontPt = Number(metaFontInput.value) || 10; refreshUI(); });
    const mkAlignSel = (key, val) => {
      const sel = el('select');
      [['left', '左对齐'], ['center', '居中'], ['right', '右对齐']].forEach(([v, t]) => sel.append(el('option', { value: v }, t)));
      sel.value = val || 'left';
      sel.addEventListener('change', () => { o[key] = sel.value; refreshUI(); });
      return sel;
    };
    const textAlignSel = mkAlignSel('textAlign', o.textAlign);
    const eqAlignSel = mkAlignSel('eqAlign', o.eqAlign);
    const gapInput = el('input', { type: 'number', min: '0', max: '30', step: '1', style: { width: '70px' } });
    gapInput.value = o.gapPt != null ? o.gapPt : 4;
    gapInput.addEventListener('input', () => { o.gapPt = Math.max(0, Number(gapInput.value) || 0); refreshUI(); });
    const padInput = el('input', { type: 'number', min: '4', max: '80', step: '1', style: { width: '70px' } });
    padInput.value = o.padPt != null ? o.padPt : 27;
    padInput.addEventListener('input', () => { o.padPt = Math.max(4, Number(padInput.value) || 27); refreshUI(); });
    // 字体：中文（中文回退）默认微软雅黑；西文（英文/数字/符号）默认 Times New Roman
    const mkFontSel = (key, list, dflt) => {
      const sel = el('select');
      list.forEach(f => sel.append(el('option', { value: f.value }, f.label + '（' + f.value + '）')));
      sel.value = list.some(f => f.value === o[key]) ? o[key] : dflt;
      sel.addEventListener('change', () => { o[key] = sel.value; refreshUI(); });
      return sel;
    };
    const zhFontSel = mkFontSel('zhFont', K.ZH_FONTS, 'Microsoft YaHei');
    const enFontSel = mkFontSel('enFont', K.EN_FONTS, 'Times New Roman');

    // ---- 高度与垂直对齐：自适应（贴合内容）/ 设定高度（统一画布，内容超出自动增高）----
    const heightModeSel = el('select');
    [['auto', '自适应（贴合内容）'], ['fixed', '设定高度（统一画布）']].forEach(([v, t]) =>
      heightModeSel.append(el('option', { value: v }, t)));
    heightModeSel.value = o.heightMode === 'fixed' ? 'fixed' : 'auto';
    heightModeSel.addEventListener('change', () => { o.heightMode = heightModeSel.value; refreshUI(); });
    const canvasHInput = el('input', { type: 'number', min: '40', max: '600', step: '5', style: { width: '70px' } });
    canvasHInput.value = o.canvasHeightPt != null ? o.canvasHeightPt : 120;
    canvasHInput.addEventListener('input', () => { o.canvasHeightPt = Math.max(40, Number(canvasHInput.value) || 120); refreshUI(); });
    const vAlignSel = el('select');
    [['top', '上对齐'], ['middle', '垂直居中'], ['bottom', '下对齐']].forEach(([v, t]) =>
      vAlignSel.append(el('option', { value: v }, t)));
    vAlignSel.value = ['top', 'middle', 'bottom'].includes(o.vAlign) ? o.vAlign : 'middle';
    vAlignSel.addEventListener('change', () => { o.vAlign = vAlignSel.value; refreshUI(); });

    const baseInput = el('input', { type: 'text', style: { width: '150px' } });
    baseInput.value = o.baseName || '化学方程式';
    baseInput.addEventListener('input', () => { o.baseName = baseInput.value; refreshUI(); });

    const saveAsk = mkRadio('imgsave', 'ask', '每次选择保存位置', o.saveMode !== 'auto');
    const saveAuto = mkRadio('imgsave', 'auto', '直接保存到默认目录', o.saveMode === 'auto');
    [saveAsk, saveAuto].forEach(r => r.querySelector('input').addEventListener('change', () => { o.saveMode = r.querySelector('input').value; }));

    const estLabel = el('div', { style: { fontSize: '12.5px', color: 'var(--text-sub)', margin: '8px 0' } }, '');
    // 可导出的「条目×版本」清单（随版本范围选项变化；预览与导出共用同一挑选规则）
    function exportItems() {
      const items = [];
      entries.forEach(e => {
        pickImageVersions(e, o.versionScope, o.allowedTypes).forEach(v => {
          items.push({ e, v, no: items.length + 1 });
        });
      });
      return items;
    }
    function estimate() {
      const n = exportItems().length;
      estLabel.textContent = `将导出 ${entries.length} 个条目 / ${n} 个版本` +
        (o.mode === 'multi' ? `（每条一张图 = ${n} 张图片）` : '（合成一张图）') +
        (n ? '' : '（当前选项下没有可导出的版本）');
    }

    // ---- 右侧实时预览：大幅 + 缩放 + 逐张切换 ----
    // 预览按 scale=1 构建真实版式（字体/字号/边距/对齐/列数与导出一致），再整体等比缩放显示。
    const PREVIEW_MAX_BLOCKS = 80; // 单图模式预览块数上限（超大卷防卡顿，导出不受限）
    let previewIndex = 0;          // 「每条一张图」当前预览的张序（0 起）
    let zoomMode = 'width';        // 'width' 适宽 | 'page' 整页 | 'abs' 绝对倍率
    let zoomAbs = 1;
    let curScale = 1;
    let contentW = 0, contentH = 0;
    let previewTimer = null;

    const switchBar = el('div', { class: 'check-row', style: { flexWrap: 'wrap', flex: '1', rowGap: '4px' } });
    const zoomLabel = el('span', { style: { fontSize: '12px', color: 'var(--text-sub)', minWidth: '42px', textAlign: 'center' } }, '100%');
    const zoomBtns = [];
    const mkZoomBtn = (label, title, fn) => {
      const b = el('button', { class: 'btn small secondary', title, onclick: fn }, label);
      zoomBtns.push(b);
      return b;
    };
    const zoomBar = el('div', { class: 'check-row', style: { flexWrap: 'wrap' } },
      mkZoomBtn('适宽', '预览宽度撑满预览区（默认）', () => { zoomMode = 'width'; applyZoom(); }),
      mkZoomBtn('整页', '完整可见当前图片', () => { zoomMode = 'page'; applyZoom(); }),
      mkZoomBtn('100%', '实际尺寸', () => { zoomMode = 'abs'; zoomAbs = 1; applyZoom(); }),
      mkZoomBtn('－', '缩小', () => zoomStep(1 / 1.2)),
      mkZoomBtn('＋', '放大', () => zoomStep(1.2)),
      zoomLabel);
    function zoomStep(factor) {
      zoomMode = 'abs';
      zoomAbs = Math.min(4, Math.max(0.15, (curScale || 1) * factor));
      applyZoom();
    }

    const previewHolder = el('div', { style: { position: 'relative', flex: '1 1 auto', minHeight: '200px', overflow: 'auto', background: '#f1eee7', border: '1px solid var(--border)', borderRadius: '6px' } });
    const previewWrap = el('div', { style: { position: 'relative' } });
    previewHolder.append(previewWrap);
    // 注意：不重用 iframe——Electron 下对已挂载 iframe 重赋 srcdoc 偶发不重载
    //（属性已更新而内容保持旧文档）。每次新建 iframe 并「先设 srcdoc 再挂载」：
    // 挂载即开始加载，行为确定（与「当前作业」预览一致）。
    // 预览边界描边：淡色虚线勾出图片边界，与预览区底色区分（仅预览容器样式，不进导出）
    let previewFrame = null;
    function mountPreviewFrame(html) {
      if (previewFrame && previewFrame.parentNode) previewFrame.parentNode.removeChild(previewFrame);
      const frame = el('iframe', { style: { position: 'absolute', top: '0', left: '0', border: 'none', background: '#fff', transformOrigin: 'top left' } });
      frame.onload = () => {
        try {
          const d = frame.contentDocument;
          const r = d.body.getBoundingClientRect();
          contentW = Math.max(1, Math.ceil(r.width));
          contentH = Math.max(1, Math.ceil(r.height));
          frame.style.width = contentW + 'px';
          frame.style.height = contentH + 'px';
          applyZoom();
        } catch (_) { /* 兜底忽略 */ }
      };
      frame.srcdoc = html;
      previewWrap.append(frame);
      previewFrame = frame;
      previewWrap.style.outline = '1px dashed #b9b2a0';
      return frame;
    }
    // Ctrl+滚轮缩放（stopPropagation 防止冒泡为整页界面缩放）
    previewHolder.addEventListener('wheel', (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      e.stopPropagation();
      zoomStep(e.deltaY < 0 ? 1.1 : 1 / 1.1);
    }, { passive: false });

    const previewInfo = el('div', { style: { fontSize: '11.5px', color: 'var(--text-sub)' } }, '');

    function applyZoom() {
      if (!contentW || !contentH) return;
      const availW = Math.max(60, previewHolder.clientWidth - 16);
      const availH = Math.max(60, previewHolder.clientHeight - 16);
      let k;
      if (zoomMode === 'abs') k = zoomAbs;
      else if (zoomMode === 'page') k = Math.min(availW / contentW, availH / contentH);
      else k = availW / contentW;
      k = Math.min(4, Math.max(0.15, k));
      curScale = k;
      previewWrap.style.width = Math.round(contentW * k) + 'px';
      previewWrap.style.height = Math.round(contentH * k) + 'px';
      previewFrame.style.transform = 'scale(' + k + ')';
      zoomLabel.textContent = Math.round(k * 100) + '%';
      // 缩放按钮高亮：当前模式对应按钮为主样式，其余为次样式
      zoomBtns.forEach(b => b.classList.add('secondary'));
      let activeBtn = null;
      if (zoomMode === 'width') activeBtn = zoomBtns[0];
      else if (zoomMode === 'page') activeBtn = zoomBtns[1];
      else if (Math.abs(curScale - 1) < 0.001) activeBtn = zoomBtns[2];
      if (activeBtn) activeBtn.classList.remove('secondary');
      previewInfo.textContent = `内容 ${contentW}×${contentH} px · 导出约 ${Math.round(contentW * o.scale)}×${Math.round(contentH * o.scale)} px（${o.scale}x 清晰度）`;
    }

    function renderSwitchBar(items) {
      switchBar.innerHTML = '';
      if (o.mode === 'multi') {
        if (!items.length) {
          switchBar.append(el('span', { style: { fontSize: '12px', color: 'var(--text-sub)' } }, '当前选项下没有可导出的版本'));
          return;
        }
        const prevBtn = el('button', {
          class: 'btn small secondary', style: { padding: '2px 10px' }, title: '上一张',
          onclick: () => { if (previewIndex > 0) { previewIndex--; rebuildPreview(); } }
        }, '◀');
        const nextBtn = el('button', {
          class: 'btn small secondary', style: { padding: '2px 10px' }, title: '下一张',
          onclick: () => { if (previewIndex < items.length - 1) { previewIndex++; rebuildPreview(); } }
        }, '▶');
        const sel = el('select', { style: { flex: '1', minWidth: '140px', fontSize: '12px' } });
        items.forEach((it, i) => {
          sel.append(el('option', { value: String(i) },
            `${i + 1}. ${it.e.name || '（未命名）'} [${K.EQ_TYPE_MAP[it.v.type] ? K.EQ_TYPE_MAP[it.v.type].short : it.v.type}]`));
        });
        sel.value = String(previewIndex);
        sel.addEventListener('change', () => { previewIndex = Number(sel.value) || 0; rebuildPreview(); });
        const ext = o.format === 'jpeg' ? 'jpg' : 'png';
        const fname = `${o.baseName || '化学方程式'}_${String(previewIndex + 1).padStart(3, '0')}_${sanitizeFileName(items[previewIndex].e.name)}.${ext}`;
        switchBar.append(prevBtn, sel, nextBtn,
          el('span', { style: { fontSize: '12px', color: 'var(--text-sub)' } },
            `第 ${previewIndex + 1} / ${items.length} 张`),
          el('span', { class: 'tag', title: fname }, fname));
      } else {
        const n = items.length;
        switchBar.append(el('span', { style: { fontSize: '12px', color: 'var(--text-sub)' } },
          n ? `合成一张图 · 共 ${n} 条方程式` + (n > PREVIEW_MAX_BLOCKS ? `（预览显示前 ${PREVIEW_MAX_BLOCKS} 条，导出为全部）` : '') : '当前选项下没有可导出的版本'));
      }
    }

    function rebuildPreview() {
      const items = exportItems();
      // 先收敛张序（版本范围等变化可能使列表变短），再渲染切换器（切换器要用 items[previewIndex]）
      if (previewIndex > items.length - 1) previewIndex = Math.max(0, items.length - 1);
      if (previewIndex < 0) previewIndex = 0;
      renderSwitchBar(items);
      if (!items.length) {
        contentW = contentH = 0;
        previewWrap.style.width = '0';
        previewWrap.style.height = '0';
        previewWrap.style.outline = 'none';
        if (previewFrame && previewFrame.parentNode) previewFrame.removeAttribute('srcdoc');
        previewHolder.querySelectorAll('.img-preview-empty').forEach(n => n.remove());
        const empty = el('div', { class: 'img-preview-empty', style: { position: 'absolute', inset: '0', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999', fontSize: '12px' } },
          '当前选项下没有可导出的版本');
        previewHolder.append(empty);
        previewInfo.textContent = '';
        return;
      }
      previewHolder.querySelectorAll('.img-preview-empty').forEach(n => n.remove());
      let html;
      if (o.mode === 'single') {
        const show = items.slice(0, PREVIEW_MAX_BLOCKS);
        const pOpt = Object.assign({}, o, { scale: 1, mode: 'single' });
        html = buildImageDocHtml(show.map(it => imageBlockHtml(it.e, it.v, it.no, pOpt)), pOpt);
      } else {
        const it = items[previewIndex];
        const pOpt = Object.assign({}, o, { scale: 1, mode: 'multi' });
        html = buildImageDocHtml([imageBlockHtml(it.e, it.v, it.no, pOpt)], pOpt);
      }
      mountPreviewFrame(html);
    }

    function refreshUI() {
      estimate();
      if (previewTimer) clearTimeout(previewTimer);
      previewTimer = setTimeout(rebuildPreview, 120); // 输入防抖
    }

    // 窗口尺寸变化：适宽/整页重算（绝对倍率不受影响）
    const onResize = () => { if (zoomMode !== 'abs') applyZoom(); };
    window.addEventListener('resize', onResize);

    const dirHint = (s.export.imagesFolder || 'data/exports（默认）');
    const grid = el('div', { class: 'form-grid' });
    grid.append(
      el('div', { class: 'full' }, el('div', { class: 'panel-title', style: { margin: '0 0 4px' } }, '产出形式'),
        el('div', { class: 'check-row' }, modeSingle, modeMulti)),
      el('div', { class: 'full' }, el('div', { class: 'panel-title', style: { margin: '0 0 4px' } }, '版本范围'),
        el('div', { class: 'check-row' }, scopeMain, scopeAll, scopeCustom, typeChecks)),
      el('div', { class: 'full' }, el('div', { class: 'panel-title', style: { margin: '0 0 4px' } }, '图片内容（方程式恒包含）'),
        el('div', { class: 'check-row' },
          mkCheck('number', '编号', o.number),
          mkCheck('showName', '反应名称', o.showName),
          mkCheck('showType', '类型标签', o.showType),
          mkCheck('showDifficulty', '难度', o.showDifficulty),
          mkCheck('showTextbook', '教材版本', o.showTextbook))),
      el('div', { class: 'full' }, el('div', { class: 'panel-title', style: { margin: '0 0 4px' } }, '排版（文字与方程式）'),
        el('div', { class: 'form-grid', style: { gridTemplateColumns: 'repeat(auto-fill, minmax(176px, 1fr))' } },
          el('label', { class: 'field' }, el('span', {}, '中文字体'), zhFontSel),
          el('label', { class: 'field' }, el('span', {}, '西文字体（英文/符号）'), enFontSel),
          el('label', { class: 'field' }, el('span', {}, '文字字号（pt）'), metaFontInput),
          el('label', { class: 'field' }, el('span', {}, '方程式字号（pt）'), fontInput),
          el('label', { class: 'field' }, el('span', {}, '文字位置'), textAlignSel),
          el('label', { class: 'field' }, el('span', {}, '方程式位置'), eqAlignSel),
          el('label', { class: 'field' }, el('span', {}, '文字-方程式间距（pt）'), gapInput),
          el('label', { class: 'field' }, el('span', {}, '图片内边距（pt）'), padInput),
          el('label', { class: 'field' }, el('span', {}, '图片高度'), heightModeSel),
          el('label', { class: 'field' }, el('span', {}, '设定高度（pt）'), canvasHInput),
          el('label', { class: 'field' }, el('span', {}, '垂直对齐'), vAlignSel)),
        el('div', { style: { fontSize: '12px', color: 'var(--text-sub)', marginTop: '4px' } },
          '图片宽度自动贴合内容（内容占据图片主体）；字体栈为「西文 + 中文」：英文/数字/符号用西文字体，中文用中文字体。',
          el('br'),
          '「设定高度」时整图统一画布高度（每条一张图可保证各图等高），内容按「垂直对齐」上/中/下摆放；内容超出时自动增高不裁切。')),
      colsRow,
      el('label', { class: 'field', style: { width: '130px' } }, el('span', {}, '清晰度'), scaleSel),
      el('label', { class: 'field', style: { width: '130px' } }, el('span', {}, '图片格式'), fmtSel),
      el('label', { class: 'field', style: { width: '170px' } }, el('span', {}, '文件名前缀'), baseInput),
      el('div', { class: 'full' }, el('div', { class: 'panel-title', style: { margin: '0 0 4px' } }, '保存方式'),
        el('div', { class: 'check-row' }, saveAsk, saveAuto),
        el('div', { style: { fontSize: '12px', color: 'var(--text-sub)' } }, `默认目录：${dirHint}（可在「设置 → 导出与统计」修改）`)),
      el('div', { class: 'full' }, estLabel)
    );

    // 左（选项，可滚动）+ 右（大幅实时预览）两栏
    const previewCol = el('div', { style: { flex: '1 1 auto', minWidth: '300px', display: 'flex', flexDirection: 'column', gap: '6px' } });
    previewCol.append(
      el('div', { class: 'check-row', style: { margin: '0', flexWrap: 'wrap', rowGap: '4px' } },
        el('span', { style: { fontWeight: 'bold', fontSize: '13px' } }, '实时预览'),
        switchBar),
      zoomBar,
      previewHolder,
      previewInfo,
      el('div', { style: { fontSize: '11.5px', color: 'var(--text-sub)' } },
        '预览为真实版式（字体/字号/边距/对齐与导出一致）；Ctrl+滚轮缩放，滚轮/Shift+滚轮滚动查看。'));

    const body = el('div', { style: { display: 'flex', gap: '14px', alignItems: 'stretch', height: 'min(64vh, 620px)' } },
      el('div', { style: { flex: '0 0 400px', width: '400px', overflowY: 'auto', paddingRight: '4px', minWidth: '0' } }, grid),
      previewCol);

    estimate();
    rebuildPreview();

    let exporting = false;
    const m = UI.modal({
      title: `导出图片（已勾选 ${entries.length} 条）`,
      width: Math.min(1220, Math.max(900, Math.round(window.innerWidth * 0.94))),
      body,
      buttons: [
        { text: '取消', value: null },
        {
          text: '导出', class: '', onClick: async (close) => {
            if (exporting) return;
            const items = exportItems();
            if (!items.length) { toast('当前选项下没有可导出的版本，请调整版本范围', 'warning'); return; }
            exporting = true;
            try {
              s.export.imageOptions = JSON.parse(JSON.stringify(o));
              await app.saveSettings();
              const r = await doExportImages(app, entries, o);
              if (r && r.ok) {
                close(null);
                toastOk(`已导出 ${r.files.length} 个图片文件${r.files.length === 1 ? '：' + r.files[0] : ''}`);
              } else if (r && r.canceled) {
                // 用户取消保存对话框，面板保持打开可继续调整
              } else {
                toastErr('导出失败：' + ((r && r.message) || '未知错误'));
              }
            } catch (e) { toastErr('导出失败：' + e.message); }
            exporting = false;
          }
        }
      ],
      onClose: () => {
        window.removeEventListener('resize', onResize);
        if (previewTimer) clearTimeout(previewTimer);
      }
    });
    void m;
  }
})();
