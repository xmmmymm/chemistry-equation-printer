/* 历史作业视图 */
(function () {
  'use strict';
  const { el, toast, toastOk, confirmDialog } = UI;
  const K = window.Const;

  let searchText = '';

  App.views.history = {
    async render(container, app) {
      container.appendChild(el('div', { class: 'empty-state' }, '正在加载历史作业…'));
      // 历史作业按当前学习项目过滤（旧文件无 projectId → 归属 default）
      const list = await window.bridge.history.list(app.currentProjectId());
      container.innerHTML = '';
      container.appendChild(renderList(app, list));
    }
  };

  function renderList(app, list) {
    const page = el('div', { class: 'view-list-page' });
    const panel = el('div', { class: 'panel' });

    const toolbar = el('div', { class: 'list-toolbar' });
    const search = el('input', { type: 'text', placeholder: '搜索标题…', value: searchText });
    search.addEventListener('input', () => {
      searchText = search.value;
      // 重建表格时保持页面滚动位置（高度塌陷会把滚动顶回去）
      const page = document.querySelector('.view-list-page');
      const st = page ? page.scrollTop : 0;
      tableWrap.innerHTML = '';
      tableWrap.append(renderTable(app, filter(list)));
      if (page) page.scrollTop = st;
    });
    toolbar.append(
      el('div', { class: 'panel-title', style: { margin: '0' } },
        `历史作业（${list.length} 份 · ${App.currentProject().name}）`),
      search);
    panel.append(toolbar);

    const tableWrap = el('div', { style: { overflow: 'auto' } });
    tableWrap.append(renderTable(app, filter(list)));
    panel.append(tableWrap);
    page.append(panel);
    return page;

    function filter(l) {
      if (!searchText) return l;
      return l.filter(w => (w.title || '').toLowerCase().includes(searchText.toLowerCase()));
    }
  }

  function renderTable(app, list) {
    const table = el('table', { class: 'list' });
    table.append(el('thead', {}, el('tr', {},
      el('th', {}, '标题'), el('th', {}, '题数'), el('th', {}, '创建时间'), el('th', {}, '最后修改'),
      el('th', {}, '导出记录'), el('th', {}, '操作'))));
    const tbody = el('tbody');
    if (!list.length) tbody.append(el('tr', {}, el('td', { colspan: '6' }, el('div', { class: 'empty-state' }, '暂无历史作业。生成并保存作业后会出现在这里。'))));
    list.forEach(w => {
      tbody.append(el('tr', {},
        el('td', { style: { fontWeight: 'bold' } }, w.title || '未命名作业'),
        el('td', {}, String(w.itemCount || 0)),
        el('td', {}, K.fmtDateTime(w.createdAt)),
        el('td', {}, K.fmtDateTime(w.updatedAt)),
        el('td', {}, String((w.exportRecordCount || 0))),
        el('td', {}, actions(app, w))));
    });
    table.append(tbody);
    return table;
  }

  function actions(app, summary) {
    const box = el('div', { style: { display: 'flex', gap: '4px', flexWrap: 'wrap' } });
    const mk = (text, fn, cls) => el('button', { class: 'btn small ' + (cls || 'secondary'), onclick: fn }, text);
    box.append(
      mk('查看', async () => {
        const w = await window.bridge.history.get(summary.id);
        if (!w) { toast('作业文件不存在', 'error'); return; }
        showDetail(w);
      }),
      mk('重新打开编辑', async () => {
        const w = await window.bridge.history.get(summary.id);
        if (!w) { toast('作业文件不存在', 'error'); return; }
        if (app.state.worksheet && app.state.worksheet.items.length) {
          const ok = await confirmDialog('覆盖当前作业', '当前作业尚未保存，重新打开历史作业将覆盖当前作业。继续吗？', true);
          if (!ok) return;
        }
        app.state.worksheet = {
          id: w.id, title: w.title || '', createdAt: w.createdAt, updatedAt: K.nowIso(),
          projectId: w.projectId || app.currentProjectId(),
          generationSettings: w.generationSettings || K.defaultGenerationSettings(),
          layoutSettings: w.layoutSettings || K.defaultLayoutSettings(),
          items: w.items || [], exportRecords: w.exportRecords || [],
          tempEntries: [], remark: w.remark || ''
        };
        app.updateBadge();
        toastOk('已打开历史作业');
        app.showView('worksheet');
      }, ''),
      mk('复制为新作业', async () => {
        const w = await window.bridge.history.get(summary.id);
        if (!w) { toast('作业文件不存在', 'error'); return; }
        app.state.worksheet = {
          id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          title: (w.title || '未命名作业') + '（副本）',
          createdAt: K.nowIso(), updatedAt: K.nowIso(),
          projectId: w.projectId || app.currentProjectId(),
          generationSettings: w.generationSettings || K.defaultGenerationSettings(),
          layoutSettings: w.layoutSettings || K.defaultLayoutSettings(),
          items: JSON.parse(JSON.stringify(w.items || [])),
          exportRecords: [], tempEntries: [], remark: ''
        };
        app.updateBadge();
        toastOk('已复制为新作业');
        app.showView('worksheet');
      }),
      mk('删除', async () => {
        const ok = await confirmDialog('删除历史作业', `确定删除「${summary.title || '未命名作业'}」的历史记录吗？（不影响出题次数统计）`, true);
        if (!ok) return;
        await window.bridge.history.delete(summary.id);
        App.refreshView();
      }, 'danger')
    );
    return box;
  }

  function showDetail(w) {
    const box = el('div', {});
    box.append(el('div', { style: { marginBottom: '10px' } },
      el('div', { style: { fontWeight: 'bold', 'font-size': '16px' } }, w.title || '未命名作业'),
      el('div', { style: { color: 'var(--text-sub)', 'font-size': '12.5px', 'margin-top': '4px' } },
        `创建：${K.fmtDateTime(w.createdAt)} · 修改：${K.fmtDateTime(w.updatedAt)} · 共 ${(w.items || []).length} 题`)));
    (w.items || []).forEach((item, i) => {
      const row = el('div', { class: 'import-entry-row', style: { display: 'flex', gap: '8px', alignItems: 'baseline' } });
      const stem = el('div', { style: { flex: '1' } });
      try { stem.innerHTML = DocBuilder.renderQuestion(item, i + 1).stem; } catch (e) { stem.textContent = item.snapshot.entryName; }
      row.append(el('span', { style: { 'font-weight': 'bold' } }, (i + 1) + '.'), stem,
        el('span', { class: 'tag' }, item.questionType));
      box.append(row);
    });
    if ((w.exportRecords || []).length) {
      box.append(el('div', { class: 'panel-title', style: { marginTop: '12px' } }, '导出记录'));
      w.exportRecords.forEach(r => {
        box.append(el('div', { style: { 'font-size': '12.5px', marginBottom: '2px' } },
          `${K.fmtDateTime(r.time)} · ${r.type} · ${r.fileType === 'question' ? '题目卷' : '答案卷'} · ${r.filePath}`));
      });
    }
    UI.modal({ title: '历史作业详情', width: 680, body: box, buttons: [{ text: '关闭', value: null }] });
  }
})();
