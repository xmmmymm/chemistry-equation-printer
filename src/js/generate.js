/* 生成作业视图：范围、题数、题型、难度、版本策略、手动选题 */
(function () {
  'use strict';
  const { el, toast, toastOk, toastErr, modal } = UI;
  const K = window.Const;

  let settings = null; // GenerationSettings
  let manualUsableCount = 0; // 手动选题面板「当前策略可出」条数（renderManualList 现算）

  App.views.generate = {
    render(container, app) {
      // 上次出题设置按项目持久化（projectData.lastGenSettings）；项目切换后按新项目复原。
      // settings._pid 记录设置所属项目，与当前项目不一致时重新装载。
      const pid = app.currentProjectId();
      if (!settings || settings._pid !== pid) {
        const lgs = app.state.projectData && app.state.projectData.lastGenSettings;
        settings = (lgs && JSON.parse(JSON.stringify(lgs))) || K.defaultGenerationSettings();
        settings._pid = pid;
      }
      container.appendChild(renderView(app));
    }
  };

  // 传给引擎/作业的设置副本（剥离 _pid 内部标记）
  function cleanSettings() {
    const s = JSON.parse(JSON.stringify(settings));
    delete s._pid;
    return s;
  }

  // 学习项目 opts（生成/换一批/单题替换共用）：项目范围 + 计数 + 轮数
  function projectGenOpts(app, extra) {
    const project = app.currentProject();
    const data = app.state.projectData;
    return Object.assign({
      projectScope: project.scope,
      projectCounts: data ? data.counts : {},
      round: app.projectPairStats(project).round
    }, extra || {});
  }

  // 生成成功时把设置持久化到当前项目（projectData.lastGenSettings，剥离 _pid）
  async function persistGenSettings(app) {
    const clean = cleanSettings();
    if (app.state.projectData) {
      app.state.projectData.lastGenSettings = JSON.parse(JSON.stringify(clean));
      await app.saveProjectData();
    }
    // 兼容保留：全局内存引用（旧行为），不再作为复原来源
    app.state.lastGenSettings = JSON.parse(JSON.stringify(clean));
  }

  function renderView(app) {
    const view = el('div', { class: 'view-generate' });
    // 项目范围前置过滤提示条
    const project = app.currentProject();
    const stats = app.projectPairStats(project);
    const scopeBar = el('div', { class: 'panel', style: { padding: '8px 12px', display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' } });
    scopeBar.append(
      el('span', { class: 'tag' }, '项目'),
      el('span', { style: { fontWeight: 'bold' } }, project.name),
      el('span', { style: { color: 'var(--text-sub)', fontSize: '12.5px' } },
        '项目范围：' + ScopePicker.scopeSummary(app, project.scope) + '（下方细化筛选在其上叠加）'),
      el('span', { style: { flex: '1' } }),
      el('span', { style: { color: 'var(--text-sub)', fontSize: '12.5px', title: '只出计数 ≤ 轮数的「方程式+题型」对，优先计数最低的对' } },
        `学习进度：${stats.round} 轮（落后 ${stats.laggards} 对）`));

    const grid = el('div', { class: 'gen-grid' });

    // 项目范围 facets：出题/排除范围选择器只显示项目内实际存在的分类标签
    const facets = app.projectFacets();
    // 当前设置可出题数（项目范围 ∧ 细化筛选 ∧ 排除范围 ∧ 版本策略）：
    // 与「题库管理」条目数不同时，最常见原因是版本策略过滤（如「只出化学方程式」
    // 会滤掉仅有离子/电离版本的条目——离子反应章节尤其明显），在此直接可见。
    const cands = Generator.buildCandidates(app.state.library, settings, { projectScope: project.scope });
    const candEntries = new Set(cands.map(c => c.entry.id)).size;
    scopeBar.append(
      el('span', {
        class: 'tag', style: { cursor: 'default' + (cands.length ? '' : '; color: var(--warning)') },
        title: '按当前细化筛选、排除范围与版本策略计算。比题库管理条目数少时，'
          + '通常是版本策略（如「只出化学方程式」）滤掉了没有该版本类型的条目，'
          + '可在下方「表达式版本策略」调整为「所有可用版本均可」。'
      }, `可出 ${cands.length} 题（${candEntries} 条方程式）`));
    grid.append(
      renderScopePanel(app, '出题范围（同维度多选为“或”；章/节仅细化含它的册别，未细化的册整册生效）', 'scopes', facets),
      renderScopePanel(app, '排除范围（命中即排除；选项已按当前项目范围收敛）', 'exclude', facets),
      renderCountsPanel(app),
      renderVersionPanel(app),
      renderOptionsPanel(app),
      renderManualPanel(app)
    );

    const actions = el('div', { class: 'panel', style: { marginTop: '14px', display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' } });
    actions.append(
      el('button', { class: 'btn', style: { fontSize: '15px', padding: '9px 26px' }, onclick: () => doGenerate(app) }, '🎲 随机生成作业'),
      el('button', {
        class: 'btn secondary', onclick: async () => {
          const name = await UI.promptDialog('保存出题设置模板', '模板名称', `出题模板_${new Date().toLocaleDateString()}`);
          if (!name) return;
          await window.bridge.templates.save({
            id: 'gen_' + Date.now().toString(36), name, kind: 'generation', settings: JSON.parse(JSON.stringify(settings))
          });
          toastOk('模板已保存');
        }
      }, '保存为模板'),
      el('button', {
        class: 'btn secondary', onclick: async () => {
          const list = await window.bridge.templates.list();
          const gens = list.filter(t => t.kind === 'generation');
          if (!gens.length) { toast('暂无出题模板', 'info'); return; }
          const box = el('div', {});
          gens.forEach(t => {
            box.append(el('div', { class: 'import-entry-row', style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
              el('span', {}, t.name),
              el('button', {
                class: 'btn small', onclick: () => {
                  settings = JSON.parse(JSON.stringify(t.settings));
                  m.close(null);
                  App.refreshView();
                }
              }, '使用')));
          });
          const m = modal({ title: '出题设置模板', width: 480, body: box, buttons: [{ text: '关闭', value: null }] });
        }
      }, '从模板载入'),
      el('button', { class: 'btn secondary', onclick: () => { settings = K.defaultGenerationSettings(); App.refreshView(); } }, '重置设置')
    );

    view.append(scopeBar, grid, actions);
    return view;
  }

  function renderScopePanel(app, title, key, facets) {
    // 范围维度渲染抽为共享组件 ScopePicker（学习项目范围选择器复用；生成页保持原行为）
    // facets：只显示当前项目范围内的分类标签（项目外的标签选不出也无作用）
    const panel = el('div', { class: 'panel' });
    panel.append(el('div', { class: 'panel-title' }, title));
    panel.append(ScopePicker.render(app, settings[key], {
      facets,
      onChange: (info) => {
        if (info && info.cascade) { App.refreshView(); return; } // 级联重建面板（settings 模块级持久，勾选不丢）
        updateManualCount(app);
      }
    }));
    return panel;
  }

  function renderCountsPanel(app) {
    const panel = el('div', { class: 'panel' });
    panel.append(el('div', { class: 'panel-title' }, '题数与题型'));

    const total = el('input', { type: 'number', min: '1', max: '200', value: settings.totalCount, style: { width: '90px' } });
    total.addEventListener('input', () => { settings.totalCount = Math.max(1, Number(total.value) || 1); updateManualCount(app); });
    panel.append(el('div', { class: 'check-row', style: { marginBottom: '10px' } }, '总题数：', total,
      el('span', { style: { fontSize: '12px', color: 'var(--text-sub)' } }, '（优先级：总题数 > 题型数量 > 难度比例）')));

    const grid = el('div', { class: 'form-grid' });
    const typeNames = { B: 'B 给反应物写产物', C: 'C 文字描述写方程式', D: 'D 部分空格补全', E: 'E 配平题', H: 'H 开放题' };
    for (const t of Object.keys(typeNames)) {
      const input = el('input', { type: 'number', min: '0', max: '200', value: settings.questionTypeCounts[t] || 0, style: { width: '70px' } });
      input.addEventListener('input', () => { settings.questionTypeCounts[t] = Math.max(0, Number(input.value) || 0); });
      grid.append(el('label', { class: 'field' }, el('span', {}, typeNames[t] + '（0 = 不指定）'), input));
    }
    panel.append(grid);
    panel.append(el('div', { style: { fontSize: '12px', color: 'var(--text-sub)', margin: '8px 0' } },
      '各题型之和可小于总题数（自动补足）；之和大于总题数将无法生成。C 类需条目有文字描述，H 类需有开放题干。'));

    // 难度
    const modeSel = el('select');
    [['counts', '按数量'], ['ratios', '按比例（%）'], ].forEach(([v, t]) => modeSel.append(el('option', { value: v }, t)));
    modeSel.value = settings.difficultyMode;
    modeSel.addEventListener('change', () => { settings.difficultyMode = modeSel.value; App.refreshView(); });

    const diffGrid = el('div', { class: 'form-grid', style: { marginTop: '6px' } });
    const diffDefs = [['simple', '简单'], ['medium', '中等'], ['hard', '较难']];
    diffDefs.forEach(([key, label]) => {
      const holder = settings.difficultyMode === 'ratios' ? settings.difficultyRatios : settings.difficultyCounts;
      const input = el('input', { type: 'number', min: '0', max: '100', value: holder[key] || 0, style: { width: '70px' } });
      input.addEventListener('input', () => { holder[key] = Math.max(0, Number(input.value) || 0); });
      diffGrid.append(el('label', { class: 'field' }, el('span', {}, label + (settings.difficultyMode === 'ratios' ? '（%）' : '（题数，0 = 不限）')), input));
    });
    panel.append(el('div', { class: 'check-row', style: { marginTop: '8px' } }, '难度设置：', modeSel));
    panel.append(diffGrid);
    return panel;
  }

  function renderVersionPanel(app) {
    const panel = el('div', { class: 'panel' });
    panel.append(el('div', { class: 'panel-title' }, '表达式版本策略'));
    const sel = el('select', { style: { width: '100%' } });
    Object.entries(K.VERSION_STRATEGIES).forEach(([code, label]) => sel.append(el('option', { value: code }, label)));
    sel.value = settings.versionStrategy;
    const customBox = el('div', { class: 'check-row', style: { marginTop: '8px', display: settings.versionStrategy === 'custom' ? 'flex' : 'none' } });
    sel.addEventListener('change', () => {
      settings.versionStrategy = sel.value;
      customBox.style.display = sel.value === 'custom' ? 'flex' : 'none';
      updateManualCount(app);
    });
    K.EQ_TYPES.forEach(t => {
      const cb = el('input', { type: 'checkbox' });
      cb.checked = settings.allowedVersionTypes.includes(t.code);
      cb.addEventListener('change', () => {
        if (cb.checked) settings.allowedVersionTypes.push(t.code);
        else settings.allowedVersionTypes = settings.allowedVersionTypes.filter(x => x !== t.code);
        updateManualCount(app);
      });
      customBox.append(el('label', { class: 'check-item' }, cb, t.label));
    });
    panel.append(sel, customBox);
    return panel;
  }

  function renderOptionsPanel(app) {
    const panel = el('div', { class: 'panel' });
    panel.append(el('div', { class: 'panel-title' }, '其他选项'));
    const mk = (label, field, hint) => {
      const cb = el('input', { type: 'checkbox' });
      cb.checked = !!settings[field];
      cb.addEventListener('change', () => { settings[field] = cb.checked; });
      return el('label', { class: 'check-item', title: hint || '' }, cb, label);
    };
    panel.append(el('div', { class: 'check-row', style: { 'flex-direction': 'column', alignItems: 'flex-start', gap: '8px' } },
      mk('包含必出题（范围内必出题优先加入）', 'includeMustInclude'),
      mk('允许同一反应条目重复出现', 'allowDuplicateEntry'),
      mk('允许同一反应的不同版本同时出现', 'allowSameEntryDifferentVersion')));
    return panel;
  }

  // 手动选题
  function renderManualPanel(app) {
    const panel = el('div', { class: 'panel gen-manual full' });
    const info = el('div', { class: 'panel-title' }, '手动选题（先勾选，不足部分随机补齐）');
    const countLabel = el('span', { style: { 'font-size': '12px', color: 'var(--text-sub)' } }, '');
    info.append(countLabel);
    panel.append(info);
    panel.append(el('div', { style: { 'font-size': '12px', color: 'var(--text-sub)', margin: '2px 0 6px' } },
      '列表按「项目范围 + 出题范围」显示（与题库管理口径一致）；灰显条目因已禁用 / 排除范围命中 / 当前版本策略下无可用版本而不可出，悬停可看原因。'));

    const listWrap = el('div', { style: { 'max-height': '260px', overflow: 'auto', background: 'var(--white)', border: '1px solid var(--border)', 'border-radius': '6px', padding: '6px' } });
    function renderManualList() {
      listWrap.innerHTML = '';
      const project = app.currentProject();
      const lib = app.state.library;
      // 列表口径 = 项目范围 ∧ 出题范围（细化筛选）——与题库管理的项目范围列表一致；
      // 版本策略/排除/禁用不把条目藏起来，而是灰显并注明原因（差异可见、可解释）
      const projIds = new Set(Generator.scopedEntries(lib, project.scope).map(e => e.id));
      const refinedScopes = Generator.refineBooksByScope(lib.entries, settings.scopes);
      const list = lib.entries.filter(e => projIds.has(e.id) &&
        Generator.entryInScope(e, settings.scopes, refinedScopes));
      const cands = Generator.buildCandidates(lib, settings, { projectScope: project.scope });
      const usable = new Map(); // entryId → 第一个可用候选（版本标签展示用）
      cands.forEach(c => { if (!usable.has(c.entry.id)) usable.set(c.entry.id, c); });
      // 排除范围命中的条目
      const excludedIds = new Set();
      if (Generator.scopeFilterActive(settings.exclude)) {
        const refinedEx = Generator.refineBooksByScope(lib.entries, settings.exclude);
        for (const e of lib.entries) {
          if (projIds.has(e.id) && Generator.entryInScope(e, settings.exclude, refinedEx)) excludedIds.add(e.id);
        }
      }
      manualUsableCount = usable.size;
      if (!list.length) {
        listWrap.append(el('div', { class: 'empty-state' }, '项目范围与出题范围下没有条目，请调整出题范围。'));
        updateLabel();
        return;
      }
      list.forEach(e => {
        const u = usable.get(e.id);
        let note = null;
        if (e.enabled === false) note = '已禁用';
        else if (excludedIds.has(e.id)) note = '排除范围命中';
        else if (!u) note = '当前版本策略下无可用版本';
        const cb = el('input', { type: 'checkbox' });
        if (note) {
          cb.disabled = 'disabled';
        } else {
          cb.checked = settings.manualEntryIds.includes(e.id);
          cb.addEventListener('change', () => {
            if (cb.checked) settings.manualEntryIds.push(e.id);
            else settings.manualEntryIds = settings.manualEntryIds.filter(x => x !== e.id);
            updateLabel();
          });
        }
        const row = el('label', {
          class: 'check-item', title: note || '',
          style: { display: 'flex', gap: '6px', padding: '3px 2px', alignItems: 'center', opacity: note ? '0.55' : '1' }
        },
          cb,
          el('span', {}, e.name),
          el('span', { class: 'difficulty-' + (e.difficulty || ''), style: { 'font-size': '12px' } }, e.difficulty || ''),
          u
            ? el('span', { class: 'tag' }, K.EQ_TYPE_MAP[u.version.type].short)
            : (note ? el('span', { class: 'tag' }, note) : null));
        listWrap.append(row);
      });
      updateLabel();
    }
    renderManualList();
    panel.append(listWrap);
    panel._renderManualList = renderManualList;
    return panel;
  }

  function updateLabel() {
    const label = document.querySelector('.gen-manual .panel-title span');
    if (!label) return;
    const n = settings.manualEntryIds.length;
    const total = settings.totalCount;
    label.textContent = `　已手动选择 ${n} / 总题数 ${total} · 可出 ${manualUsableCount} 条`
      + (n > total ? '　⚠ 超过总题数！' : (n < total ? `　（随机补齐 ${total - n} 题）` : ''));
  }

  function updateManualCount() {
    const panel = document.querySelector('.gen-manual');
    if (panel && panel._renderManualList) panel._renderManualList();
    else updateLabel();
  }

  function doGenerate(app) {
    if (settings.manualEntryIds.length > settings.totalCount) {
      UI.modal({
        title: '手动选题超过总题数', width: 440,
        body: el('div', {}, `手动选择了 ${settings.manualEntryIds.length} 题，超过总题数 ${settings.totalCount}。请减少手动选题或增加总题数。`),
        buttons: [{ text: '返回修改', value: null }]
      });
      return;
    }
    const result = Generator.generate(app.state.library, settings, projectGenOpts(app));
    if (result.ok) {
      persistGenSettings(app);
      app.newWorksheet(result.items, cleanSettings());
      (result.notices || []).forEach(n => toast(n, 'warning', 5000));
      toastOk(`已生成 ${result.items.length} 题的作业`);
      app.showView('worksheet');
      return;
    }
    if (result.reason === 'roundShortage') showRoundShortageModal(app, result);
    else if (result.reason === 'shortage') showShortageModal(app, result);
    else if (result.reason === 'mustExceed' || result.reason === 'typeOverflow' || result.reason === 'manualExceed') {
      UI.modal({ title: '无法生成', width: 460, body: el('div', {}, result.message), buttons: [{ text: '返回修改', value: null }] });
    }
  }

  // 轮数不足专属弹窗：范围内未达标的「方程式+题型」对已用尽
  function showRoundShortageModal(app, result) {
    const box = el('div', {});
    box.append(el('div', { style: { marginBottom: '12px' } },
      result.message || '范围内未达标的方程式+题型组合已用尽。'),
      el('div', { style: { fontSize: '12.5px', color: 'var(--text-sub)', marginBottom: '12px' } },
        '学习进度按轮数自动推进：每轮把范围内未达标（计数 ≤ 轮数）的对各出一次，落后对出完即进入下一轮。可选择：'));
    const options = [
      ['允许补充已达标方程式（继续出本轮已出过的）', () => {
        const result2 = Generator.generate(app.state.library, settings, projectGenOpts(app, { allowOverRound: true }));
        if (result2.ok) {
          persistGenSettings(app);
          app.newWorksheet(result2.items, cleanSettings());
          (result2.notices || []).forEach(n => toast(n, 'warning', 5000));
          toastOk(`已生成 ${result2.items.length} 题的作业（含已达标方程式）`);
          app.showView('worksheet');
        } else if (result2.reason === 'shortage') {
          showShortageModal(app);
        } else {
          toastErr(result2.message || '生成失败');
        }
      }],
      ['减少题数到可出数', () => {
        const r0 = Generator.generate(app.state.library, settings, projectGenOpts(app));
        // 可出数 = 轮数限制下能出的最大题数（试算到 1）
        let n = 0;
        for (let t = settings.totalCount; t >= 1; t--) {
          const s2 = JSON.parse(JSON.stringify(settings));
          s2.totalCount = t;
          const r = Generator.generate(app.state.library, s2, projectGenOpts(app));
          if (r.ok) { n = t; break; }
        }
        if (n >= 1) {
          settings.totalCount = n;
          App.refreshView();
          doGenerateAfterAdjust(app);
        } else {
          toast('当前范围内轮数限制下无法出题，请先扩大项目范围或清除计数', 'warning', 5000);
        }
      }],
      ['返回修改设置', () => {}],
      ['取消生成', () => {}]
    ];
    options.forEach(([text, fn]) => {
      box.append(el('div', { style: { marginBottom: '6px' } },
        el('button', { class: 'btn secondary', style: { width: '100%' }, onclick: () => { m.close(null); fn(); } }, text)));
    });
    const m = modal({ title: '本轮未达标方程式已用尽', width: 500, body: box, buttons: [] });
  }

  // 题目不足弹窗：先给出诊断（范围条数 vs 当前设置可出数 + 原因），再给出真正有效的处理选项。
  // 修复记录：旧版「减少题数」未带项目范围（按全库候选算，减不下来）、「允许重复出题」
  // 被生成引擎的候选移除逻辑架空（splice 后已用候选回不来），且缺少针对版本策略/细化筛选
  // 这两个最常见根因的选项——点了没效果看起来就是“选项失效”。
  function showShortageModal(app, result) {
    const project = app.currentProject();
    const lib = app.state.library;
    const projCount = Generator.scopedEntries(lib, project.scope).length;
    const cands = Generator.buildCandidates(lib, settings, projectGenOpts(app, { allowOverRound: true }));
    const candEntries = new Set(cands.map(c => c.entry.id)).size;
    const strategyLabel = K.VERSION_STRATEGIES[settings.versionStrategy] || settings.versionStrategy;
    const hasRefine = Generator.scopeFilterActive(settings.scopes);
    const hasExclude = Generator.scopeFilterActive(settings.exclude);
    const hasTypeCounts = Object.values(settings.questionTypeCounts || {}).some(v => Number(v) > 0);
    const d = settings.difficultyCounts || {}, r = settings.difficultyRatios || {};
    const hasDiff = (Number(d.simple) || 0) + (Number(d.medium) || 0) + (Number(d.hard) || 0) +
      (Number(r.simple) || 0) + (Number(r.medium) || 0) + (Number(r.hard) || 0) > 0;

    const box = el('div', {});
    box.append(el('div', { style: { marginBottom: '8px' } },
      `题目不足：按当前设置只能出 ${cands.length} 个候选（${candEntries} 条方程式），`
      + `不够总题数 ${settings.totalCount}（还差 ${(result && result.need) || (settings.totalCount - cands.length)} 题）。`));
    box.append(el('div', { style: { fontSize: '12.5px', color: 'var(--text-sub)', marginBottom: '10px' } },
      `项目范围内共 ${projCount} 条方程式；当前版本策略为「${strategyLabel}」`
      + (hasRefine ? '，且出题范围细化筛选在收窄' : '')
      + (hasExclude ? '，且排除范围在剔除条目' : '')
      + `。条目数与可出数差距大时，通常是版本策略滤掉了没有该版本类型的条目（如电离/离子方程式条目没有“化学方程式”版本）。`));

    const regen = (msg) => {
      App.refreshView();
      toast(msg, 'info', 2500);
      doGenerateAfterAdjust(app);
    };
    const options = [];
    // 1. 减少题数到可出数：逐级试算真实可生成数（带项目范围与轮数；连试 3 次防随机题型分配抖动）
    options.push(['减少题数到可出数', () => {
      let n = 0;
      for (let t = settings.totalCount; t >= 1 && !n; t--) {
        let allOk = true;
        for (let k = 0; k < 3; k++) {
          const s2 = JSON.parse(JSON.stringify(settings));
          s2.totalCount = t;
          if (!Generator.generate(lib, s2, projectGenOpts(app)).ok) { allOk = false; break; }
        }
        if (allOk) n = t;
      }
      if (!n) {
        // 轮数限制下 0 可出：放开轮数再试（至少能出多少算多少）
        for (let t = settings.totalCount; t >= 1 && !n; t--) {
          const s2 = JSON.parse(JSON.stringify(settings));
          s2.totalCount = t;
          if (Generator.generate(lib, s2, projectGenOpts(app, { allowOverRound: true })).ok) n = t;
        }
      }
      if (n >= 1) {
        settings.totalCount = n;
        regen(`已把总题数调整为 ${n}，正在重新生成…`);
      } else {
        toast('当前设置下 1 题也出不了：请扩大项目范围、清除细化筛选或更换版本策略', 'warning', 5000);
      }
    }]);
    // 2. 切换版本策略（最常见根因：策略滤掉了整章只有离子/电离版本的条目）
    if (settings.versionStrategy !== 'allAvailable') {
      options.push(['切换版本策略为「所有可用版本均可」', () => {
        settings.versionStrategy = 'allAvailable';
        settings.allowedVersionTypes = [];
        regen('已切换版本策略为「所有可用版本均可」，正在重新生成…');
      }]);
    }
    // 3. 清除细化筛选与排除范围
    if (hasRefine || hasExclude) {
      options.push(['清除细化筛选与排除范围（仅按项目范围出题）', () => {
        settings.scopes = {};
        settings.exclude = {};
        regen('已清除细化筛选与排除范围，正在重新生成…');
      }]);
    }
    // 4. 允许重复出题（生成引擎已修复：未用候选优先，用尽后回退复用）
    options.push(['允许重复出题（同一方程式可多次出现）', () => {
      settings.allowDuplicateEntry = true;
      regen('已允许重复出题，正在重新生成…');
    }]);
    // 5. 放宽题型数量
    if (hasTypeCounts) {
      options.push(['放宽题型要求（清除题型数量限制）', () => {
        settings.questionTypeCounts = { B: 0, C: 0, D: 0, E: 0, H: 0 };
        regen('已清除题型数量限制，正在重新生成…');
      }]);
    }
    // 6. 放宽难度
    if (hasDiff) {
      options.push(['放宽难度要求（清除难度限制）', () => {
        settings.difficultyCounts = { simple: 0, medium: 0, hard: 0 };
        settings.difficultyRatios = { simple: 0, medium: 0, hard: 0 };
        regen('已清除难度限制，正在重新生成…');
      }]);
    }
    options.push(['返回修改设置', () => {}]);
    options.push(['取消生成', () => {}]);
    options.forEach(([text, fn]) => {
      box.append(el('div', { style: { marginBottom: '6px' } },
        el('button', { class: 'btn secondary', style: { width: '100%' }, onclick: () => { m.close(null); fn(); } }, text)));
    });
    const m = modal({ title: '题目不足', width: 520, body: box, buttons: [] });
  }

  function doGenerateAfterAdjust(app) {
    setTimeout(() => doGenerate(app), 60);
  }
})();
