/* 当前作业视图：题目编辑、卷面预览、格式设置、导出 */
(function () {
  'use strict';
  const { el, toast, toastOk, toastErr, modal, confirmDialog } = UI;
  const C = window.Chem, K = window.Const;

  let previewMode = 'question';
  let measureBox = null;
  // 预览缩放：zoomMode 'width'=适宽(默认,随窗口重算) | 'page'=整页可见 | 'abs'=绝对倍率(previewZoom)
  let zoomMode = 'width';
  let previewZoom = 1;
  let itemsPanelCollapsed = false; // 题目列表折叠（预览独占整行）
  let resizeHooked = false;
  let currentApp = null;

  App.views.worksheet = {
    render(container, app) {
      if (!app.state.worksheet) {
        container.appendChild(el('div', { class: 'empty-state', style: { 'padding-top': '120px' } },
          el('div', { style: { 'font-size': '16px', 'margin-bottom': '14px' } }, '当前没有作业'),
          el('div', {}, '请先到“生成作业”随机生成，或在题库中手动加入题目。'),
          el('div', { style: { 'margin-top': '16px' } },
            el('button', { class: 'btn', onclick: () => app.showView('generate') }, '去生成作业'))));
        return;
      }
      if (!measureBox) measureBox = DocBuilder.createMeasureBox();
      measureBox.setCss(DocBuilder.docCSS(ws(app).layoutSettings));
      container.appendChild(renderView(app));
      renderPreview(app);
    }
  };

  function ws(app) { return app.state.worksheet; }

  // 窗口标题（左上角）跟随当前作业标题；无作业时恢复默认
  function syncWindowTitle(w) {
    const t = w && w.title && w.title.trim();
    document.title = t ? `${t} - 化学方程式组卷打印` : '高中化学方程式组卷打印系统';
  }

  function genSettings(w) {
    return w.generationSettings && w.generationSettings.totalCount ? w.generationSettings : K.defaultGenerationSettings();
  }

  function resolveEntry(app, id) {
    return app.getEntry(id) || (ws(app).tempEntries || []).find(e => e.id === id) || null;
  }

  function renderView(app) {
    const w = ws(app);
    currentApp = app;
    // 窗口标题（左上角）跟随当前作业标题
    syncWindowTitle(w);
    const view = el('div', { class: 'view view-worksheet' });

    // 工具栏
    const toolbar = el('div', { class: 'ws-toolbar' });
    const titleInput = el('input', { type: 'text', placeholder: '作业标题（用于卷面与文件名）', style: { width: '220px' } });
    titleInput.value = w.title || '';
    titleInput.addEventListener('input', () => {
      w.title = titleInput.value; w.layoutSettings.title = w.title || '化学方程式作业';
      syncWindowTitle(w); // 立即刷新窗口标题（左上角）
    });
    toolbar.append(
      titleInput,
      el('button', {
        class: 'btn small secondary', onclick: () => {
          const entry = app.newEntry();
          EntryEditor.openEntryEditor(app, entry, {
            temp: true,
            onSave: (saved) => {
              w.tempEntries = w.tempEntries || [];
              w.tempEntries.push(saved);
              const v = saved.versions[0];
              w.items.push(Generator.makeItem(saved, v, 'B'));
              app.updateBadge();
              App.refreshView();
              toastOk('临时录入已加入本次作业');
            }
          });
        }
      }, '＋ 临时录入'),
      el('button', {
        class: 'btn small secondary', onclick: async () => {
          if (!w.items.length) { toast('当前作业没有题目', 'warning'); return; }
          const ok = await confirmDialog('换一批', '将替换所有未锁定的题目（锁定题保留）。继续吗？');
          if (!ok) return;
          // 换一批同样守轮数（项目范围 + 计数 + 轮数）
          const project = app.currentProject();
          const opts = {
            projectScope: project.scope,
            projectCounts: app.state.projectData ? app.state.projectData.counts : {},
            round: app.projectPairStats(project).round
          };
          const result = Generator.regenerate(app.state.library, genSettings(w), w.items, opts);
          if (!result.ok) {
            if (result.reason === 'roundShortage') {
              // 放开限制重试（换一批语义：教师已确认要换）
              const result2 = Generator.regenerate(app.state.library, genSettings(w), w.items, Object.assign({}, opts, { allowOverRound: true }));
              if (!result2.ok) { toastErr(result.message || '换一批失败'); return; }
              w.items = result2.items;
              (result2.notices || []).forEach(n => toast(n, 'warning', 5000));
              app.updateBadge();
              App.refreshView();
              return;
            }
            toastErr(result.message || '换一批失败');
            return;
          }
          w.items = result.items;
          app.updateBadge();
          App.refreshView();
        }
      }, '🔄 换一批（保留锁定）'),
      el('button', {
        class: 'btn small secondary', title: itemsPanelCollapsed ? '展开题目列表' : '收起题目列表，预览独占全宽',
        onclick: () => { itemsPanelCollapsed = !itemsPanelCollapsed; App.refreshView(); }
      }, itemsPanelCollapsed ? '展开题目列表' : '收起题目列表'),
      el('span', { style: { flex: '1' } }),
      el('button', { class: 'btn small secondary', onclick: () => openLayoutSettings(app) }, '⚙ 卷面格式'),
      el('button', { class: 'btn small secondary', onclick: () => saveLayoutTemplate(app) }, '存为卷面模板'),
      el('button', { class: 'btn small secondary', onclick: () => loadLayoutTemplate(app) }, '载入卷面模板'),
      el('button', { class: 'btn small success', onclick: () => saveHistory(app) }, '💾 保存作业'),
      el('button', { class: 'btn small', onclick: () => exportAll(app, 'pdf') }, '🖨 导出 PDF'),
      el('button', { class: 'btn small secondary', onclick: () => exportAll(app, 'html') }, '导出 HTML'),
      el('button', { class: 'btn small secondary', onclick: () => exportAll(app, 'docx') }, '导出 Word (docx)')
    );

    // 主体
    const body = el('div', { class: 'ws-body' });
    let itemsPanel = null;
    if (!itemsPanelCollapsed) {
      itemsPanel = el('div', { class: 'ws-items' });
      renderItems(app, itemsPanel);
    }

    const previewPanel = el('div', { class: 'ws-preview' });
    const modeSwitch = el('div', { class: 'check-row', style: { 'margin-bottom': '4px', 'flex-wrap': 'wrap' } });
    modeSwitch.append('预览：',
      el('button', { class: 'btn small ' + (previewMode === 'question' ? '' : 'secondary'), onclick: () => { previewMode = 'question'; App.refreshView(); } }, '题目卷'),
      el('button', { class: 'btn small ' + (previewMode === 'answer' ? '' : 'secondary'), onclick: () => { previewMode = 'answer'; App.refreshView(); } }, '答案卷'),
      el('span', { style: { flex: '1' } }),
      el('button', { class: 'btn small secondary', title: '宽度撑满预览区（默认）', onclick: () => { zoomMode = 'width'; App.refreshView(); } }, '适宽'),
      el('button', { class: 'btn small secondary', title: '完整显示一页', onclick: () => { zoomMode = 'page'; App.refreshView(); } }, '整页'),
      el('button', { class: 'btn small secondary', title: '实际尺寸', onclick: () => { zoomMode = 'abs'; previewZoom = 1; App.refreshView(); } }, '100%'),
      el('button', { class: 'btn small secondary', title: '缩小', onclick: () => zoomStep(1 / 1.2) }, '－'),
      el('button', { class: 'btn small secondary', title: '放大', onclick: () => zoomStep(1.2) }, '＋'));
    const frameHolder = el('div', { class: 'frameHolder' });
    const info = el('div', { class: 'preview-info' });
    previewPanel.append(modeSwitch, frameHolder, info);
    previewPanel._frameHolder = frameHolder;

    if (itemsPanel) body.append(itemsPanel);
    body.append(previewPanel);
    view.append(toolbar, body);
    hookResize();
    return view;
  }

  // 缩放步进（相对当前有效倍率，切到绝对倍率模式）
  function zoomStep(factor) {
    const holder = document.querySelector('.ws-preview .frameHolder');
    const wrap = holder && holder.querySelector('.paper-wrap');
    const cur = wrap ? (parseFloat(wrap.dataset.scale) || 1) : 1;
    zoomMode = 'abs';
    previewZoom = Math.min(3, Math.max(0.25, cur * factor));
    App.refreshView();
  }

  // 自动适宽/整页：窗口尺寸变化时重算（绝对倍率不受影响）
  function hookResize() {
    if (resizeHooked) return;
    resizeHooked = true;
    let timer = null;
    window.addEventListener('resize', () => {
      if (zoomMode === 'abs') return;
      clearTimeout(timer);
      timer = setTimeout(() => { if (currentApp) renderPreview(currentApp); }, 150);
    });
  }

  function renderItems(app, panel) {
    const w = ws(app);
    panel.innerHTML = '';
    panel.append(el('div', { class: 'panel-title' }, `题目列表（${w.items.length} 题）`));
    if (!w.items.length) {
      panel.append(el('div', { class: 'empty-state' }, '暂无题目。'));
      return;
    }

    w.items.forEach((item, idx) => {
      const card = el('div', { class: 'ws-item-card' + (item.locked ? ' locked' : ''), draggable: 'true' });
      card.dataset.index = idx;

      const typeSel = el('select', { style: { 'font-size': '12px' } });
      Object.entries(K.QUESTION_TYPES).forEach(([t, label]) => typeSel.append(el('option', { value: t }, t + ' ' + label)));
      typeSel.value = item.questionType;
      typeSel.addEventListener('change', () => {
        item.questionType = typeSel.value;
        if (item.questionType === 'D' && !item.blankStrategy) item.blankStrategy = Generator.pickDStrategy(item.snapshot.version);
        App.refreshView();
      });

      const versionWrap = el('div', { class: 'check-row' });
      const entry = resolveEntry(app, item.entryId);
      if (entry) {
        K.EQ_TYPES.forEach(t => {
          const has = (entry.versions || []).some(v => v.type === t.code);
          const b = el('button', {
            class: 'btn small ' + (item.versionType === t.code ? '' : 'secondary'),
            disabled: has ? null : 'disabled',
            title: has ? '' : '该条目没有此版本',
            onclick: () => switchVersion(app, item, entry, t.code)
          }, t.short);
          versionWrap.append(b);
        });
      }

      const head = el('div', { class: 'ws-item-head' },
        el('span', { class: 'qnum' }, (idx + 1) + '.'),
        el('span', { class: 'tag' }, '题号 ' + item.itemId.slice(-4)),
        typeSel,
        versionWrap,
        el('span', { style: { flex: '1' } }),
        el('button', {
          class: 'btn small secondary', style: { padding: '2px 9px' },
          title: '标记该方程式+题型为已出题（计数 +1 并立即保存），从卷中移除，并从未达标题中随机补一题',
          onclick: () => app.excludeWorksheetItem(app, idx)
        }, '排除'),
        el('span', { class: 'difficulty-' + (item.snapshot.difficulty || '') }, item.snapshot.difficulty || ''),
        el('button', {
          class: 'btn small ' + (item.locked ? '' : 'secondary'), title: '锁定后换一批不替换',
          onclick: () => { item.locked = !item.locked; App.refreshView(); }
        }, item.locked ? '🔒 已锁' : '🔓 未锁'));
      card.append(head);

      // 题干预览
      const stemBox = el('div', { style: { 'margin-top': '4px' } });
      try {
        const r = DocBuilder.renderQuestion(item, idx + 1);
        stemBox.innerHTML = previewMode === 'question' ? r.stem : r.answer;
      } catch (e) {
        stemBox.textContent = '（渲染失败：' + e.message + '）';
      }
      card.append(stemBox);

      const meta = el('div', { class: 'ws-item-meta' },
        `${item.snapshot.entryName} · ${K.EQ_TYPE_MAP[item.versionType] ? K.EQ_TYPE_MAP[item.versionType].label : item.versionType} · 出题 ${entry ? (entry.questionCount || 0) : '?'} 次`
        + (item.pageBreakAfter ? ' · ⤓ 本题后分页' : '')
        + ((item.showAnswerLine != null ? item.showAnswerLine : w.layoutSettings.answerLine.enabled) ? ' · 有横线' : ''));
      card.append(meta);

      // 操作按钮
      const actions = el('div', { class: 'ws-item-actions' });
      const mk = (text, fn, cls) => el('button', { class: 'btn small ' + (cls || 'secondary'), onclick: fn }, text);
      actions.append(
        mk('↑', () => move(app, idx, -1)),
        mk('↓', () => move(app, idx, 1)),
        mk('随机替换', () => replaceItem(app, idx)),
        mk('删除', async () => {
          if (item.locked) {
            const ok = await confirmDialog('删除锁定题', '该题已被锁定，确定仍要删除吗？', true);
            if (!ok) return;
          }
          w.items.splice(idx, 1);
          app.updateBadge();
          App.refreshView();
        }, 'danger'),
        mk(item.questionType === 'D' ? '挖空设置' : '题干', () => {
          if (item.questionType === 'D') blankPickerDialog(app, idx);
          else itemDialog(app, idx);
        }),
        mk('单题格式', () => itemFormatDialog(app, idx))
      );
      if (item.questionType === 'D') {
        const stratSel = el('select', { style: { 'font-size': '11px' } });
        Object.entries(K.BLANK_STRATEGIES).forEach(([code, label]) => stratSel.append(el('option', { value: code }, label)));
        stratSel.value = item.blankStrategy || 'blankProducts';
        stratSel.addEventListener('change', () => {
          item.blankStrategy = stratSel.value;
          item.blankIndex = undefined;
          item._dInit = false;
          App.refreshView();
          // 直接选「自由点选」时打开点选对话框
          if (stratSel.value === 'custom') blankPickerDialog(app, idx);
        });
        actions.append(stratSel);
      }
      card.append(actions);

      // 拖拽
      card.addEventListener('dragstart', (e) => {
        card.classList.add('dragging');
        e.dataTransfer.setData('text/plain', String(idx));
      });
      card.addEventListener('dragend', () => card.classList.remove('dragging'));
      card.addEventListener('dragover', (e) => { e.preventDefault(); card.classList.add('drag-over'); });
      card.addEventListener('dragleave', () => card.classList.remove('drag-over'));
      card.addEventListener('drop', (e) => {
        e.preventDefault();
        card.classList.remove('drag-over');
        const from = Number(e.dataTransfer.getData('text/plain'));
        if (isNaN(from) || from === idx) return;
        const [moved] = w.items.splice(from, 1);
        w.items.splice(idx, 0, moved);
        App.refreshView();
      });

      panel.append(card);
    });
  }

  function move(app, idx, dir) {
    const w = ws(app);
    const to = idx + dir;
    if (to < 0 || to >= w.items.length) return;
    const [it] = w.items.splice(idx, 1);
    w.items.splice(to, 0, it);
    App.refreshView();
  }

  function replaceItem(app, idx) {
    const w = ws(app);
    const used = new Set(w.items.map(it => it.entryId));
    const item = w.items[idx];
    used.delete(item.entryId);
    // 单题替换同样守轮数
    const project = app.currentProject();
    const opts = {
      projectScope: project.scope,
      projectCounts: app.state.projectData ? app.state.projectData.counts : {},
      round: app.projectPairStats(project).round
    };
    let repl = Generator.replaceOne(app.state.library, genSettings(w), used, opts);
    if (!repl && opts.projectCounts) {
      // 轮数限制下无候选：放开限制兜底（教师明确要求替换）
      repl = Generator.replaceOne(app.state.library, genSettings(w), used, Object.assign({}, opts, { allowOverRound: true }));
    }
    if (!repl) { toast('范围内没有可替换的题目', 'warning'); return; }
    repl.locked = item.locked;
    w.items[idx] = repl;
    App.refreshView();
  }

  function switchVersion(app, item, entry, typeCode) {
    const v = (entry.versions || []).find(v => v.type === typeCode);
    if (!v) return;
    item.versionType = typeCode;
    item.versionId = v.id;
    item.snapshot.version = JSON.parse(JSON.stringify(v));
    // 校验题型适配
    if (item.questionType === 'C' && !entry.description) {
      toastWarnVersion('该条目没有文字描述，C 类题需要文字描述，已切换但请补充题干', item);
    }
    if (item.questionType === 'H' && !entry.openPrompt) {
      toastWarnVersion('该条目没有开放题干，H 类题需要 openPrompt，请编辑题干', item);
    }
    App.refreshView();
  }

  function toastWarnVersion(msg, item) { toast(msg, 'warning', 5000); }

  function itemDialog(app, idx) {
    const w = ws(app);
    const item = w.items[idx];
    const entry = resolveEntry(app, item.entryId);
    const box = el('div', {});
    const prompt = el('textarea', { rows: '3', style: { width: '100%' } });
    prompt.value = item.customPrompt || '';
    if (item.questionType === 'C') {
      box.append(el('label', { class: 'field' }, el('span', {}, '题干（默认：写出……的化学方程式。）'), prompt));
    } else if (item.questionType === 'H') {
      box.append(el('label', { class: 'field' }, el('span', {}, '开放题干（必填，答案不唯一）'), prompt));
    } else {
      box.append(el('div', {}, '该题型使用系统默认题干，无需自定义。'));
    }
    modal({
      title: `编辑第 ${idx + 1} 题`, width: 520, body: box,
      buttons: [
        { text: '取消', value: null },
        {
          text: '保存', onClick: (close) => {
            item.customPrompt = prompt.value.trim() || undefined;
            if (item.questionType === 'H' && !item.customPrompt && !entry.openPrompt) {
              toastErr('H 类题必须填写题干');
              return;
            }
            close(null);
            App.refreshView();
          }
        }
      ]
    });
  }

  // ---------- D 类自由勾选挖空 ----------
  /**
   * 挖空设置对话框：教师勾选任意要素——每个反应物/生成物（化学式）及其下方的系数子项、
   * 每个条件词，勾选即挖空。数据模型：item.blankSpec =
   * { blanks: [{ side:'reactants'|'products', idx, part:'species'|'coefficient' }],
   *   condIdxs: [词索引] }（索引对应 conditionLines 展开序，条件逐词挖空）
   */
  function blankPickerDialog(app, idx) {
    const w = ws(app);
    const item = w.items[idx];
    const v = item.snapshot.version;
    // 备份，取消时还原
    const origStrategy = item.blankStrategy;
    const origSpec = item.blankSpec ? JSON.parse(JSON.stringify(item.blankSpec)) : undefined;
    let saved = false;

    const condWords = C.conditionLines(v.conditions); // 条件词（复合词已拆分，与渲染序一致）

    const setCustom = () => {
      item.blankStrategy = 'custom';
      item.blankIndex = undefined;
      item._dInit = false;
    };
    if (item.blankStrategy !== 'custom' || !item.blankSpec || !Array.isArray(item.blankSpec.blanks)) {
      setCustom();
      item.blankSpec = specFromStrategy(item, v);
    }
    const spec = item.blankSpec;
    // 旧格式迁移：condition:true → condIdxs 全词
    if (!Array.isArray(spec.condIdxs)) spec.condIdxs = spec.condition ? condWords.map((_, i) => i) : [];

    const isBlank = (side, i, part) =>
      spec.blanks.some(b => b.side === side && b.idx === i && b.part === part);
    const toggleBlank = (side, i, part) => {
      const at = spec.blanks.findIndex(b => b.side === side && b.idx === i && b.part === part);
      if (at >= 0) spec.blanks.splice(at, 1);
      else spec.blanks.push({ side, idx: i, part });
    };
    // 物质完整 HTML（含系数、状态、气体沉淀符号）——列表行右侧显示
    const speciesFullHTML = (sp) => {
      let h = '';
      if (sp.coefficient && sp.coefficient !== 1) h += String(sp.coefficient);
      h += C.formulaHTML(sp.formula);
      if (sp.state) h += '(' + C.escapeHtml(sp.state) + ')';
      if (sp.gas) h += '↑';
      if (sp.precipitate) h += '↓';
      return h;
    };
    const hasCoef = (sp) => sp.coefficient && sp.coefficient !== 1;

    const box = el('div', {});
    box.append(el('div', { class: 'panel-title' }, '挖空要素（勾选即挖空）'));
    const list = el('div', { class: 'bp-list' });

    // 分组：反应物 / 生成物 / 反应条件（勾选项数量随方程式实际物质/条件数而定）
    function buildList() {
      list.innerHTML = '';
      const mkGroup = (title, renderRows) => {
        const g = el('div', { class: 'bp-group' });
        g.append(el('div', { class: 'bp-group-title' }, title));
        const rows = el('div', {});
        renderRows(rows);
        g.append(rows);
        list.append(g);
      };
      // 主行（化学式勾选）+ 系数子行（仅系数≠1 的物质有）
      const addSpecies = (rows, side, i, sp) => {
        const label = (side === 'reactants' ? '反应物' : '生成物') + (i + 1);
        const cb = el('input', { type: 'checkbox' });
        const formulaSpan = el('span', { class: 'bp-formula' });
        const coefWrap = el('div', { class: 'bp-subrow' });
        cb.addEventListener('change', () => { toggleBlank(side, i, 'species'); refresh(); });
        const row = el('div', { class: 'bp-row' },
          el('label', { class: 'bp-main' }, cb, el('span', { class: 'bp-name' }, label), formulaSpan));
        if (hasCoef(sp)) {
          const ccb = el('input', { type: 'checkbox' });
          ccb.addEventListener('change', () => { toggleBlank(side, i, 'coefficient'); refresh(); });
          coefWrap.append(el('label', { class: 'bp-sub' }, ccb, el('span', { class: 'bp-subname' }, '系数')));
          row.append(coefWrap);
        }
        rows.append(row);
        row._refresh = () => {
          cb.checked = isBlank(side, i, 'species');
          formulaSpan.innerHTML = cb.checked ? '＿＿＿＿' : speciesFullHTML(sp);
          formulaSpan.classList.toggle('blanked', cb.checked);
          if (coefWrap.firstChild) {
            const ccb = coefWrap.querySelector('input');
            ccb.checked = isBlank(side, i, 'coefficient');
            coefWrap.querySelector('.bp-subname').textContent = ccb.checked ? '系数（＿＿）' : '系数（' + sp.coefficient + '）';
          }
        };
      };
      mkGroup('反应物', (rows) => {
        if (!(v.reactants || []).length) rows.append(el('div', { class: 'bp-empty' }, '（无）'));
        (v.reactants || []).forEach((sp, i) => addSpecies(rows, 'reactants', i, sp));
      });
      mkGroup('生成物', (rows) => {
        if (!(v.products || []).length) rows.append(el('div', { class: 'bp-empty' }, '（无）'));
        (v.products || []).forEach((sp, i) => addSpecies(rows, 'products', i, sp));
      });
      mkGroup('反应条件', (rows) => {
        if (!condWords.length) rows.append(el('div', { class: 'bp-empty' }, '（本方程式无反应条件）'));
        condWords.forEach((word, i) => {
          const cb = el('input', { type: 'checkbox' });
          const nameSpan = el('span', { class: 'bp-formula' }, word);
          cb.addEventListener('change', () => {
            const at = spec.condIdxs.indexOf(i);
            if (at >= 0) spec.condIdxs.splice(at, 1);
            else spec.condIdxs.push(i);
            refresh();
          });
          const row = el('div', { class: 'bp-row' },
            el('label', { class: 'bp-main' }, cb, el('span', { class: 'bp-name' }, '条件' + (i + 1)), nameSpan));
          row._refresh = () => {
            cb.checked = spec.condIdxs.includes(i);
            nameSpan.textContent = cb.checked ? '＿＿' : word;
            nameSpan.classList.toggle('blanked', cb.checked);
          };
          rows.append(row);
        });
      });
    }
    function refresh() {
      list.querySelectorAll('.bp-row').forEach(r => { if (r._refresh) r._refresh(); });
      refreshPreview();
    }
    buildList();
    box.append(list);
    box.append(el('div', { class: 'bp-hint' },
      '勾选化学式将整物质挖空；勾选系数只挖空该系数（系数为 1 的物质省略系数、无此项）；条件逐词挖空。'));

    // 快捷策略
    const quick = el('div', { class: 'check-row', style: { marginTop: '8px', flexWrap: 'wrap' } });
    quick.append(el('span', { style: { fontSize: '12px', color: 'var(--text-sub)', alignSelf: 'center' } }, '快捷：'));
    const presetBtn = (label, fn, title) => el('button', {
      class: 'btn small secondary', title: title || '', onclick: () => { Object.assign(spec, fn()); refresh(); }
    }, label);
    quick.append(
      presetBtn('全部生成物', () => {
        spec.blanks = (v.products || []).map((_, i) => ({ side: 'products', idx: i, part: 'species' }));
        spec.condIdxs = [];
      }),
      presetBtn('随机一个生成物', () => {
        const i = v.products.length ? Math.floor(Math.random() * v.products.length) : 0;
        spec.blanks = [{ side: 'products', idx: i, part: 'species' }];
        spec.condIdxs = [];
      }),
      presetBtn('随机一个反应物', () => {
        const i = v.reactants.length ? Math.floor(Math.random() * v.reactants.length) : 0;
        spec.blanks = [{ side: 'reactants', idx: i, part: 'species' }];
        spec.condIdxs = [];
      }),
      presetBtn('全部系数', () => {
        spec.blanks = [
          ...(v.reactants || []).map((sp, i) => (hasCoef(sp) ? { side: 'reactants', idx: i, part: 'coefficient' } : null)).filter(Boolean),
          ...(v.products || []).map((sp, i) => (hasCoef(sp) ? { side: 'products', idx: i, part: 'coefficient' } : null)).filter(Boolean)
        ];
        spec.condIdxs = [];
      }),
      presetBtn('全部条件', () => { spec.condIdxs = condWords.map((_, i) => i); }),
      presetBtn('清空', () => { spec.blanks = []; spec.condIdxs = []; })
    );
    box.append(quick);

    box.append(el('div', { class: 'panel-title', style: { marginTop: '10px' } }, '卷面效果预览'));
    const previewBox = el('div', { class: 'bp-preview' });
    box.append(previewBox);
    function refreshPreview() {
      try {
        const r = DocBuilder.renderQuestion(item, idx + 1);
        previewBox.innerHTML = r.stem;
      } catch (e) {
        previewBox.textContent = '（预览失败：' + e.message + '）';
      }
    }
    refresh();

    modal({
      title: `第 ${idx + 1} 题挖空设置（D 部分空格补全）`, width: 560, body: box,
      buttons: [
        { text: '取消', value: null },
        {
          text: '保存', onClick: (close) => {
            if (!spec.blanks.length && !spec.condIdxs.length) {
              toast('未勾选任何挖空要素，该题将以完整方程式呈现', 'warning', 4000);
            }
            saved = true;
            close(null);
            App.refreshView();
          }
        }
      ],
      onClose: () => {
        if (!saved) { // 取消/点遮罩/×：还原原状态
          item.blankStrategy = origStrategy;
          item.blankSpec = origSpec;
          item._dInit = false;
          App.refreshView();
        }
      }
    });
  }

  // 经典策略 → 等价自由勾选挖空 spec（对话框首次打开时初始化）
  function specFromStrategy(item, v) {
    const strategy = item.blankStrategy || 'blankProducts';
    const condCount = C.conditionLines(v.conditions).length;
    switch (strategy) {
      case 'blankProducts':
        return { blanks: (v.products || []).map((_, i) => ({ side: 'products', idx: i, part: 'species' })), condIdxs: [] };
      case 'blankOneProduct': {
        const i = Math.min(item.blankIndex || 0, Math.max(0, (v.products || []).length - 1));
        return { blanks: [{ side: 'products', idx: i, part: 'species' }], condIdxs: [] };
      }
      case 'blankOneReactant': {
        const i = Math.min(item.blankIndex || 0, Math.max(0, (v.reactants || []).length - 1));
        return { blanks: [{ side: 'reactants', idx: i, part: 'species' }], condIdxs: [] };
      }
      case 'blankCoefficients':
        return {
          blanks: [
            ...(v.reactants || []).map((sp, i) => (sp.coefficient && sp.coefficient !== 1 ? { side: 'reactants', idx: i, part: 'coefficient' } : null)).filter(Boolean),
            ...(v.products || []).map((sp, i) => (sp.coefficient && sp.coefficient !== 1 ? { side: 'products', idx: i, part: 'coefficient' } : null)).filter(Boolean)
          ], condIdxs: []
        };
      case 'blankCondition':
        return { blanks: [], condIdxs: Array.from({ length: condCount }, (_, i) => i) };
      default:
        return { blanks: [], condIdxs: [] };
    }
  }

  function itemFormatDialog(app, idx) {
    const w = ws(app);
    const item = w.items[idx];
    const layout = w.layoutSettings;
    const showLine = item.showAnswerLine != null ? item.showAnswerLine : layout.answerLine.enabled;
    const lineCb = el('input', { type: 'checkbox' }); lineCb.checked = showLine;
    const lineH = el('input', { type: 'number', value: item.answerLineHeightPt || layout.answerLine.defaultHeightPt || 24, style: { width: '70px' } });
    const pbCb = el('input', { type: 'checkbox' }); pbCb.checked = !!item.pageBreakAfter;
    const box = el('div', { class: 'check-row', style: { 'flex-direction': 'column', 'align-items': 'flex-start', gap: '10px' } },
      el('label', { class: 'check-item' }, lineCb, '本题预留作答横线'),
      el('label', { class: 'check-item' }, '横线高度（pt）', lineH),
      el('label', { class: 'check-item' }, pbCb, '本题后分页'));
    modal({
      title: `第 ${idx + 1} 题格式`, width: 440, body: box,
      buttons: [
        { text: '取消', value: null },
        {
          text: '保存', onClick: (close) => {
            item.showAnswerLine = lineCb.checked;
            item.answerLineHeightPt = lineCb.checked ? Number(lineH.value) || 24 : undefined;
            item.pageBreakAfter = pbCb.checked;
            close(null);
            App.refreshView();
          }
        }
      ]
    });
  }

  // ---------- 预览 ----------
  // 缩放模型：zoomMode 'width'（适宽，随窗口重算）/ 'page'（整页可见）/ 'abs'（绝对倍率 previewZoom）
  // 布局模型：iframe 以原始像素尺寸绝对定位于 .paper-wrap 内，wrap 的布局尺寸 = 缩放后尺寸，
  // iframe 视觉尺寸与布局尺寸一致 → 放大后超出部分全部落在可滚动区域内（水平/垂直均可滚到）。

  function renderPreview(app) {
    const w = ws(app);
    const holder = document.querySelector('.ws-preview .frameHolder');
    if (!holder) return;
    holder.innerHTML = '';
    holder.scrollLeft = 0;
    holder.scrollTop = 0;
    try {
      const doc = DocBuilder.buildDocument(w.items, w.layoutSettings, previewMode, measureBox);
      const nPages = doc.paginated.pages.length;
      // 整数 px 尺寸：mm→px 为小数（297mm=1122.52px），逐页累计会溢出 iframe 元素高度
      // 产生内层滚动条（预览双滚动条的根因之二）。取整后内容高度与 iframe 完全一致。
      const pageH = Math.round(doc.heightMm * measureBox.pxPerMm);
      const frameW = Math.round(doc.widthMm * measureBox.pxPerMm);
      // 分页视觉分界：页与页之间断开 + 每页独立纸面阴影（仅预览注入，不影响导出 HTML/PDF）
      const PAGE_GAP_PX = 14;
      const frameH = pageH * nPages + PAGE_GAP_PX * Math.max(0, nPages - 1);
      const frame = el('iframe', { class: 'paper-frame' });
      frame.style.width = frameW + 'px';
      frame.style.height = frameH + 'px';
      frame.style.position = 'absolute';
      frame.style.left = '0';
      frame.style.top = '0';
      // 去掉 .paper-frame 的 1px 边框：边框使内容盒比纸面小 2px → 恒定溢出 → 内层滚动条
      // （预览双滚动条的根因之一）。纸面外观由每页的 box-shadow 提供。
      frame.style.border = 'none';
      frame.style.transformOrigin = 'top left';
      const wrap = el('div', { class: 'paper-wrap' });
      wrap.style.position = 'relative';
      wrap.append(frame);

      const fitWidth = () => Math.max(0.1, (holder.clientWidth - 16) / frameW);
      const fitPage = () => Math.max(0.1, Math.min((holder.clientWidth - 16) / frameW, (holder.clientHeight - 16) / pageH));
      let curScale = 1;
      const applyScale = () => {
        const s = zoomMode === 'abs' ? previewZoom
          : zoomMode === 'page' ? fitPage() : fitWidth();
        curScale = s;
        wrap.style.width = (frameW * s) + 'px';
        wrap.style.height = (frameH * s) + 'px';
        wrap.dataset.scale = String(s);
        frame.style.transform = `scale(${s})`;
        const info = document.querySelector('.ws-preview .preview-info');
        if (info) {
          info.textContent = `${doc.widthMm}×${doc.heightMm} mm · ${nPages} 页 · ${Math.round(s * 100)}%` +
            `（Ctrl+滚轮缩放 · Shift+滚轮水平滚动 · 滚轮垂直滚动）` +
            (doc.paginated.overflowCount ? ` · ⚠ ${doc.paginated.overflowCount} 题过长可能被截断` : '');
        }
      };
      applyScale();
      // Ctrl+滚轮缩放 / Shift+滚轮水平滚动（普通滚轮=垂直滚动，走浏览器默认）
      // stopPropagation：阻止冒泡到 app.js 的文档级 Ctrl+滚轮（界面缩放），避免双重缩放
      holder.addEventListener('wheel', (e) => {
        if (e.ctrlKey) {
          e.preventDefault();
          e.stopPropagation();
          const next = Math.min(3, Math.max(0.25, curScale * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
          if (next === curScale) return;
          zoomMode = 'abs';
          previewZoom = next;
          applyScale();
        } else if (e.shiftKey) {
          e.preventDefault();
          holder.scrollLeft += (e.deltaY || e.deltaX);
        }
      }, { passive: false });
      holder.append(wrap);
      // 预览专用 CSS：页间断开 + 每页纸面阴影（导出与打印不含此样式）
      // 只保留外层 .frameHolder 一个滚动条：iframe 内部禁滚（整数 px + 去边框后本应零溢出，此为双保险）
      const previewCss = `<style>
.page { width: ${frameW}px !important; height: ${pageH}px !important; margin: 0 0 ${PAGE_GAP_PX}px 0; box-shadow: 0 2px 10px rgba(91,70,50,.28); border: none; }
.page:last-child { margin-bottom: 0; }
html, body { overflow: hidden; }
::-webkit-scrollbar { width: 0; height: 0; }
</style>`;
      frame.srcdoc = doc.html.replace('</head>', previewCss + '</head>');
    } catch (e) {
      holder.append(el('div', { class: 'empty-state' }, '预览生成失败：' + e.message));
    }
  }

  // ---------- 卷面格式 ----------
  function openLayoutSettings(app) {
    const w = ws(app);
    const L = w.layoutSettings;
    const box = el('div', {});

    const sec = (title) => { const d = el('div', { class: 'panel-title', style: { marginTop: '12px' } }, title); box.append(d); return el('div', { class: 'form-grid' }); };

    // 纸张
    let g = sec('纸张与边距');
    const paperSel = el('select');
    ['A4', 'A3', 'B5', '16K', 'custom'].forEach(p => paperSel.append(el('option', { value: p }, p === 'custom' ? '自定义' : p)));
    paperSel.value = L.paper.size;
    const orientSel = el('select');
    [['portrait', '纵向'], ['landscape', '横向']].forEach(([v, t]) => orientSel.append(el('option', { value: v }, t)));
    orientSel.value = L.paper.orientation;
    const cw = el('input', { type: 'number', value: L.paper.customWidthMm, style: { width: '80px' } });
    const ch = el('input', { type: 'number', value: L.paper.customHeightMm, style: { width: '80px' } });
    const mt = el('input', { type: 'text', value: L.margins.top });
    const mb = el('input', { type: 'text', value: L.margins.bottom });
    const ml = el('input', { type: 'text', value: L.margins.left });
    const mr = el('input', { type: 'text', value: L.margins.right });
    const marginPreset = el('select');
    [['', '边距预设'], ['narrow', '窄边距'], ['standard', '标准边距'], ['wide', '宽松边距']].forEach(([v, t]) => marginPreset.append(el('option', { value: v }, t)));
    marginPreset.addEventListener('change', () => {
      const map = { narrow: ['1.5cm', '1.5cm', '1.5cm', '1.5cm'], standard: ['2cm', '2cm', '2cm', '2cm'], wide: ['2.5cm', '2.5cm', '2.5cm', '2.5cm'] };
      if (map[marginPreset.value]) {
        [mt.value, mb.value, ml.value, mr.value] = map[marginPreset.value];
      }
    });
    g.append(
      el('label', { class: 'field' }, el('span', {}, '纸张'), paperSel),
      el('label', { class: 'field' }, el('span', {}, '方向'), orientSel),
      el('label', { class: 'field' }, el('span', {}, '自定义宽 mm'), cw),
      el('label', { class: 'field' }, el('span', {}, '自定义高 mm'), ch),
      el('label', { class: 'field' }, el('span', {}, '边距预设'), marginPreset),
      el('label', { class: 'field' }, el('span', {}, '上边距 (cm)'), mt),
      el('label', { class: 'field' }, el('span', {}, '下边距 (cm)'), mb),
      el('label', { class: 'field' }, el('span', {}, '左边距 (cm)'), ml),
      el('label', { class: 'field' }, el('span', {}, '右边距 (cm)'), mr));
    box.append(g);

    // 分栏字体
    g = sec('分栏与字体');
    const colSel = el('select');
    [1, 2, 3].forEach(n => colSel.append(el('option', { value: String(n) }, n + ' 栏')));
    colSel.value = String(L.columns);
    const gap = el('input', { type: 'number', value: L.columnGapMm, style: { width: '70px' } });
    const zhFont = el('select');
    K.ZH_FONTS.forEach(f => zhFont.append(el('option', { value: f.value }, f.label + '（' + f.value + '）')));
    zhFont.value = K.ZH_FONTS.some(f => f.value === L.font.chinese) ? L.font.chinese : 'SimSun';
    const enFont = el('select');
    K.EN_FONTS.forEach(f => enFont.append(el('option', { value: f.value }, f.label + '（' + f.value + '）')));
    enFont.value = K.EN_FONTS.some(f => f.value === L.font.latin) ? L.font.latin : 'Times New Roman';
    const titleSize = el('input', { type: 'number', value: L.font.titleSizePt, style: { width: '70px' } });
    const bodySize = el('input', { type: 'number', value: L.font.bodySizePt, style: { width: '70px' } });
    const noteSize = el('input', { type: 'number', value: L.font.noteSizePt, style: { width: '70px' } });
    g.append(
      el('label', { class: 'field' }, el('span', {}, '分栏'), colSel),
      el('label', { class: 'field' }, el('span', {}, '栏间距 (mm)'), gap),
      el('label', { class: 'field' }, el('span', {}, '中文字体'), zhFont),
      el('label', { class: 'field' }, el('span', {}, '西文字体'), enFont),
      el('label', { class: 'field' }, el('span', {}, '标题字号 (pt)'), titleSize),
      el('label', { class: 'field' }, el('span', {}, '正文字号 (pt)，小四=12'), bodySize),
      el('label', { class: 'field' }, el('span', {}, '说明字号 (pt)'), noteSize));
    box.append(g);

    // 行距
    g = sec('行距与题间距');
    const lineSel = el('select');
    [['single', '单倍'], ['1.5', '1.5 倍'], ['double', '2 倍'], ['custom', '固定值']].forEach(([v, t]) => lineSel.append(el('option', { value: v }, t)));
    lineSel.value = L.spacing.lineSpacing;
    const customLine = el('input', { type: 'number', value: L.spacing.customLineSpacingPt, style: { width: '70px' } });
    const qSpacing = el('input', { type: 'number', value: L.spacing.questionSpacingPt, style: { width: '70px' } });
    const fixedPer = el('input', { type: 'number', value: L.fixedQuestionsPerPage || 0, style: { width: '70px' } });
    g.append(
      el('label', { class: 'field' }, el('span', {}, '行距'), lineSel),
      el('label', { class: 'field' }, el('span', {}, '固定行距值 (pt)'), customLine),
      el('label', { class: 'field' }, el('span', {}, '题间距 (pt)'), qSpacing),
      el('label', { class: 'field' }, el('span', {}, '每页固定题数（0=关闭）'), fixedPer));
    box.append(g);

    // 横线
    g = sec('作答横线');
    const alCb = el('input', { type: 'checkbox' }); alCb.checked = L.answerLine.enabled;
    const alH = el('input', { type: 'number', value: L.answerLine.defaultHeightPt, style: { width: '70px' } });
    const alThick = el('select');
    [['thin', '细'], ['medium', '中'], ['thick', '粗']].forEach(([v, t]) => alThick.append(el('option', { value: v }, t)));
    alThick.value = L.answerLine.thickness;
    g.append(
      el('label', { class: 'check-item', style: { 'align-self': 'end' } }, alCb, '全局预留横线'),
      el('label', { class: 'field' }, el('span', {}, '横线高度 (pt)'), alH),
      el('label', { class: 'field' }, el('span', {}, '横线粗细'), alThick));
    box.append(g);

    // 卷首
    g = sec('卷首信息');
    const title = el('input', { type: 'text', value: L.title });
    const subtitle = el('input', { type: 'text', value: L.subtitle || '' });
    const note = el('input', { type: 'text', value: L.note || '' });
    const siCb = el('input', { type: 'checkbox' }); siCb.checked = L.studentInfo.enabled;
    const siFields = el('input', { type: 'text', value: (L.studentInfo.fields || []).join('、'), placeholder: '用、分隔，如：姓名、班级、日期' });
    g.append(
      el('label', { class: 'field' }, el('span', {}, '标题'), title),
      el('label', { class: 'field' }, el('span', {}, '副标题'), subtitle),
      el('label', { class: 'field' }, el('span', {}, '说明'), note),
      el('label', { class: 'check-item', style: { 'align-self': 'end' } }, siCb, '学生信息栏'),
      el('label', { class: 'field' }, el('span', {}, '信息栏字段'), siFields));
    box.append(g);

    // 页眉页脚
    g = sec('页眉页脚');
    const headerCb = el('input', { type: 'checkbox' }); headerCb.checked = L.header.enabled;
    const headerText = el('input', { type: 'text', value: L.header.text, placeholder: '页眉文字' });
    const headerUseTitle = el('input', { type: 'checkbox' }); headerUseTitle.checked = L.header.useTitle;
    const footerCb = el('input', { type: 'checkbox' }); footerCb.checked = L.footer.enabled;
    const footerFmt = el('select');
    [['number', '1'], ['pageNumber', '第 1 页'], ['pageNumberOfTotal', '第 1 页 共 3 页']].forEach(([v, t]) => footerFmt.append(el('option', { value: v }, t)));
    footerFmt.value = L.footer.format;
    g.append(
      el('label', { class: 'check-item', style: { 'align-self': 'end' } }, headerCb, '启用页眉'),
      el('label', { class: 'field' }, el('span', {}, '页眉文字'), headerText),
      el('label', { class: 'check-item', style: { 'align-self': 'end' } }, headerUseTitle, '页眉使用标题'),
      el('label', { class: 'check-item', style: { 'align-self': 'end' } }, footerCb, '启用页脚页码'),
      el('label', { class: 'field' }, el('span', {}, '页码格式'), footerFmt));
    box.append(g);

    modal({
      title: '卷面格式设置', width: 760, body: box,
      buttons: [
        { text: '取消', value: null },
        {
          text: '应用', onClick: (close) => {
            L.paper.size = paperSel.value;
            L.paper.orientation = orientSel.value;
            L.paper.customWidthMm = Number(cw.value) || 210;
            L.paper.customHeightMm = Number(ch.value) || 297;
            L.margins = { top: mt.value, bottom: mb.value, left: ml.value, right: mr.value };
            L.columns = Number(colSel.value) || 1;
            L.columnGapMm = Number(gap.value) || 8;
            L.font.chinese = zhFont.value;
            L.font.latin = enFont.value;
            L.font.titleSizePt = Number(titleSize.value) || 16;
            L.font.bodySizePt = Number(bodySize.value) || 12;
            L.font.noteSizePt = Number(noteSize.value) || 10.5;
            L.spacing.lineSpacing = lineSel.value;
            L.spacing.customLineSpacingPt = Number(customLine.value) || 20;
            L.spacing.questionSpacingPt = Number(qSpacing.value) || 6;
            L.fixedQuestionsPerPage = Number(fixedPer.value) || 0;
            L.answerLine.enabled = alCb.checked;
            L.answerLine.defaultHeightPt = Number(alH.value) || 24;
            L.answerLine.thickness = alThick.value;
            L.title = title.value;
            L.subtitle = subtitle.value;
            L.note = note.value;
            L.studentInfo.enabled = siCb.checked;
            L.studentInfo.fields = siFields.value.split(/[、,，]/).map(s => s.trim()).filter(Boolean);
            L.header.enabled = headerCb.checked;
            L.header.text = headerText.value;
            L.header.useTitle = headerUseTitle.checked;
            L.footer.enabled = footerCb.checked;
            L.footer.format = footerFmt.value;
            close(null);
            App.refreshView();
          }
        }
      ]
    });
  }

  function saveLayoutTemplate(app) {
    UI.promptDialog('保存卷面格式模板', '模板名称', `卷面模板_${new Date().toLocaleDateString()}`).then(async (name) => {
      if (!name) return;
      await window.bridge.templates.save({
        id: 'layout_' + Date.now().toString(36), name, kind: 'layout', settings: JSON.parse(JSON.stringify(ws(app).layoutSettings))
      });
      toastOk('卷面模板已保存');
    });
  }

  async function loadLayoutTemplate(app) {
    const list = await window.bridge.templates.list();
    const gens = list.filter(t => t.kind === 'layout');
    if (!gens.length) { toast('暂无卷面模板', 'info'); return; }
    const box = el('div', {});
    gens.forEach(t => {
      box.append(el('div', { class: 'import-entry-row', style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
        el('span', {}, t.name),
        el('button', {
          class: 'btn small', onclick: () => {
            ws(app).layoutSettings = JSON.parse(JSON.stringify(t.settings));
            m.close(null);
            App.refreshView();
          }
        }, '使用')));
    });
    const m = modal({ title: '卷面格式模板', width: 480, body: box, buttons: [{ text: '关闭', value: null }] });
  }

  // ---------- 保存与导出 ----------
  async function handleTempEntries(app) {
    const w = ws(app);
    if (!w.tempEntries || !w.tempEntries.length) return;
    return new Promise((resolve) => {
      const box = el('div', {});
      box.append(el('div', { style: { marginBottom: '10px' } },
        `本次作业有 ${w.tempEntries.length} 个临时录入的方程式，是否保存到题库？`));
      const allBtn = el('button', { class: 'btn success', style: { 'margin-right': '8px' } }, '全部保存');
      const noneBtn = el('button', { class: 'btn secondary', style: { 'margin-right': '8px' } }, '不保存');
      const list = el('div', { style: { marginTop: '10px' } });
      const checks = w.tempEntries.map(e => {
        const cb = el('input', { type: 'checkbox' }); cb.checked = true;
        list.append(el('label', { class: 'check-item', style: { display: 'block', marginBottom: '4px' } }, cb, e.name));
        return { e, cb };
      });
      box.append(allBtn, noneBtn, list);
      const m = modal({ title: '保存临时录入？', width: 480, body: box, buttons: [], onClose: () => resolve() });
      allBtn.addEventListener('click', async () => {
        for (const { e } of checks) app.state.library.entries.push(e);
        w.tempEntries = [];
        await app.saveLibrary();
        m.close(null);
        toastOk('临时方程式已保存到题库');
      });
      const partialBtn = el('button', { class: 'btn', style: { 'margin-right': '8px' } }, '保存勾选项');
      allBtn.parentNode.insertBefore(partialBtn, noneBtn);
      partialBtn.addEventListener('click', async () => {
        let n = 0;
        for (const { e, cb } of checks) {
          if (cb.checked) { app.state.library.entries.push(e); n++; }
        }
        w.tempEntries = [];
        await app.saveLibrary();
        m.close(null);
        toastOk(`已保存 ${n} 个临时方程式`);
      });
      noneBtn.addEventListener('click', () => { m.close(null); });
    });
  }

  async function saveHistory(app) {
    const w = ws(app);
    if (!w.items.length) { toast('当前作业没有题目', 'warning'); return; }
    await handleTempEntries(app);
    w.updatedAt = K.nowIso();
    if (!w.createdAt) w.createdAt = K.nowIso();
    await window.bridge.history.save({
      id: w.id, title: w.title, createdAt: w.createdAt, updatedAt: w.updatedAt,
      projectId: w.projectId || 'default',
      generationSettings: w.generationSettings, layoutSettings: w.layoutSettings,
      items: w.items, exportRecords: w.exportRecords || [], tempEntries: [], remark: w.remark || ''
    });
    if (app.state.settings.statistics.countOnSave !== false) {
      await app.recordUsage(w.items);
    }
    // 学习项目计数（按题去重；同一题保存/再导出不重复计）
    await app.recordProjectUsage(w);
    toastOk('作业已保存到历史，出题次数已累计');
    App.refreshView();
  }
  // 供 App.switchProject「保存并切换」调用
  App.saveWorksheetHistory = saveHistory;

  function exportBaseName(w) {
    const t = K.timestampForFile();
    const title = (w.title || '').trim().replace(/[\\/:*?"<>|]/g, '');
    return title ? `${t}_${title}` : t;
  }

  async function exportAll(app, kind) {
    const w = ws(app);
    if (!w.items.length) { toast('当前作业没有题目', 'warning'); return; }
    await handleTempEntries(app);

    // 每次导出弹出文件夹选择框（取消则中止本次导出）
    const dir = await window.bridge.exportFile.chooseDir();
    if (!dir) { toast('已取消导出', 'info'); return; }
    const abs = (name) => dir.replace(/[\/\\]+$/, '') + '\\' + name;

    const base = exportBaseName(w);
    try {
      if (kind === 'pdf') {
        const qDoc = DocBuilder.buildDocument(w.items, w.layoutSettings, 'question', measureBox);
        const aDoc = DocBuilder.buildDocument(w.items, w.layoutSettings, 'answer', measureBox);
        const r1 = await window.bridge.print.pdf(qDoc.html, qDoc.widthMm, qDoc.heightMm, abs(`${base}_题目.pdf`));
        recordExport(app, 'pdf', 'question', r1.path);
        let answerPath = null;
        if (app.state.settings.export.includeAnswer !== false) {
          const r2 = await window.bridge.print.pdf(aDoc.html, aDoc.widthMm, aDoc.heightMm, abs(`${base}_答案.pdf`));
          recordExport(app, 'pdf', 'answer', r2.path);
          answerPath = r2.path;
        }
        toastOk(`PDF 已导出到 ${r1.path}`);
        if (answerPath) window.bridge.file.showInFolder(answerPath);
        else window.bridge.file.showInFolder(r1.path);
      } else if (kind === 'html') {
        const qDoc = DocBuilder.buildDocument(w.items, w.layoutSettings, 'question', measureBox);
        const r = await window.bridge.exportFile.write(`${base}_题目.html`, qDoc.html, false, dir);
        recordExport(app, 'html', 'question', r.path);
        if (app.state.settings.export.includeAnswer !== false) {
          const aDoc = DocBuilder.buildDocument(w.items, w.layoutSettings, 'answer', measureBox);
          const r2 = await window.bridge.exportFile.write(`${base}_答案.html`, aDoc.html, false, dir);
          recordExport(app, 'html', 'answer', r2.path);
        }
        toastOk(`HTML 已导出到 ${r.path}`);
        window.bridge.file.showInFolder(r.path);
      } else if (kind === 'docx') {
        // 真正的 .docx（OOXML）：条件在符号上下方（无边框表格布局）、页码在页脚（PAGE 域）
        const qBytes = DocxBuilder.buildDocx(w.items, w.layoutSettings, 'question');
        const r = await window.bridge.exportFile.write(`${base}_题目.docx`, DocxBuilder.toBase64(qBytes), true, dir);
        recordExport(app, 'docx', 'question', r.path);
        if (app.state.settings.export.includeAnswer !== false) {
          const aBytes = DocxBuilder.buildDocx(w.items, w.layoutSettings, 'answer');
          const r2 = await window.bridge.exportFile.write(`${base}_答案.docx`, DocxBuilder.toBase64(aBytes), true, dir);
          recordExport(app, 'docx', 'answer', r2.path);
        }
        toastOk(`Word 文档已导出到 ${r.path}`);
        window.bridge.file.showInFolder(r.path);
      }
    } catch (e) {
      toastErr('导出失败：' + (e.message || e));
      return;
    }

    if (app.state.settings.statistics.countOnExport !== false) {
      await app.recordUsage(w.items);
    }
    // 学习项目计数（按题去重）
    await app.recordProjectUsage(w);
    // 保存导出记录到历史
    w.updatedAt = K.nowIso();
    await window.bridge.history.save({
      id: w.id, title: w.title, createdAt: w.createdAt, updatedAt: w.updatedAt,
      projectId: w.projectId || 'default',
      generationSettings: w.generationSettings, layoutSettings: w.layoutSettings,
      items: w.items, exportRecords: w.exportRecords || [], tempEntries: [], remark: w.remark || ''
    });
    App.refreshView();
  }

  function recordExport(app, type, fileType, filePath) {
    const w = ws(app);
    w.exportRecords = w.exportRecords || [];
    w.exportRecords.push({ id: K.uid('exp'), time: K.nowIso(), type, fileType, filePath });
  }
})();
