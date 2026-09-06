/* 数据管理视图：导入导出、回收站、分类管理、备份恢复、设置 */
(function () {
  'use strict';
  const { el, toast, toastOk, toastErr, modal, confirmDialog } = UI;
  const C = window.Chem, K = window.Const;

  App.views.datamanage = {
    render(container, app) {
      const page = el('div', { class: 'view-list-page' });
      page.append(
        renderImportPanel(app),
        renderExportPanel(app),
        renderTrashPanel(app),
        renderClassPanel(app),
        renderBackupPanel(app)
        // 应用设置已迁至「设置」视图（js/settings.js）
      );
      container.appendChild(page);
    }
  };

  // ---------- 导入 ----------
  function renderImportPanel(app) {
    const panel = el('div', { class: 'panel' });
    panel.append(el('div', { class: 'panel-title' }, '导入题库（JSON）'));
    panel.append(el('div', { style: { fontSize: '12.5px', color: 'var(--text-sub)', marginBottom: '10px' } },
      '导入流程：选择文件 → 格式与学科校验 → 重复检测 → 错误报告 → 预览确认 → 导入。导入格式详见 README.md。'));

    const buttons = el('div', { class: 'check-row' });
    buttons.append(
      el('button', {
        class: 'btn', onclick: async () => {
          const r = await window.bridge.file.openJson();
          if (!r) return;
          if (r.error) { toastErr(r.error); return; }
          startImport(app, r.data, r.path);
        }
      }, '选择 JSON 文件导入…'),
      el('button', {
        class: 'btn secondary', onclick: async () => {
          try {
            const r = await window.bridge.file.readExample('sample-library.json');
            startImport(app, r.data, r.path);
          } catch (e) { toastErr('读取示例题库失败：' + e.message); }
        }
      }, '导入示例题库（examples/sample-library.json）')
    );
    panel.append(buttons);
    return panel;
  }

  function startImport(app, data, filePath) {
    const validation = Importer.validateImportData(data, app.state.library, filePath.split(/[\\/]/).pop());
    if (!validation.ok) {
      toastErr(validation.fatal);
      return;
    }

    // 预览弹窗
    const box = el('div', {});
    const summary = el('div', { class: 'import-summary' });
    const mkNum = (label, val, color) => el('div', {},
      el('div', { class: 'num', style: { color: color || 'var(--text)' } }, String(val)), label);
    summary.append(
      mkNum('总条数', validation.total),
      mkNum('校验通过', validation.total - validation.errorCount - validation.dupCount, 'var(--success)'),
      mkNum('错误（不导入）', validation.errorCount, 'var(--error)'),
      mkNum('重复', validation.dupCount, 'var(--warning)'),
      mkNum('警告', validation.warningCount, 'var(--warning)'));
    box.append(summary);

    // 重复条目处理选择
    const dupResults = validation.results.filter(r => r.dupOf && !r.errors.length);
    let dupAction = 'skip';
    let applyAll = dupResults.length > 1;
    if (dupResults.length) {
      const dupBox = el('div', { class: 'panel', style: { marginBottom: '10px' } });
      dupBox.append(el('div', { class: 'panel-title' }, `发现 ${dupResults.length} 个重复条目（忽略系数/顺序/条件/气体沉淀符号；反向反应不算重复）`));
      const sel = el('select');
      [['skip', '跳过重复条目（默认）'], ['import', '仍然导入'], ['overwrite', '覆盖题库中的同名反应'], ['copy', '新增为副本']].forEach(([v, t]) =>
        sel.append(el('option', { value: v }, t)));
      sel.value = 'skip';
      sel.addEventListener('change', () => { dupAction = sel.value; });
      dupBox.append(el('div', { class: 'check-row' }, '重复处理：', sel));
      const list = el('div', { style: { 'max-height': '140px', overflow: 'auto', marginTop: '8px' } });
      dupResults.forEach(r => {
        list.append(el('div', { class: 'import-entry-row has-dup' },
          `「${r.entry.name}」与题库中「${r.dupOf.entryName}」（${K.EQ_TYPE_MAP[r.dupOf.versionType].label}）重复`));
      });
      dupBox.append(list);
      box.append(dupBox);
    }

    // 明细预览
    const detailWrap = el('div', { style: { 'max-height': '300px', overflow: 'auto' } });
    validation.results.forEach((r, i) => {
      const cls = r.errors.length ? 'has-error' : (r.dupOf ? 'has-dup' : '');
      const row = el('div', { class: 'import-entry-row ' + cls });
      const status = r.errors.length ? '✗ 错误' : (r.dupOf ? '⚠ 重复' : '✓ 通过');
      const statusColor = r.errors.length ? 'var(--error)' : (r.dupOf ? 'var(--warning)' : 'var(--success)');
      row.append(
        el('div', { style: { display: 'flex', justifyContent: 'space-between' } },
          el('span', { style: { fontWeight: 'bold' } }, `${i + 1}. ${r.entry.name || '（无名称）'}`),
          el('span', { style: { color: statusColor } }, status)),
        el('div', { style: { fontSize: '12px', color: 'var(--text-sub)' } },
          r.entry.difficulty || '难度缺失' + ' · ' + (r.entry.versions || []).map(v => v.label).join(' / ')));
      (r.errors || []).slice(0, 4).forEach(e => {
        row.append(el('div', { style: { fontSize: '12px', color: 'var(--error)' } }, '· ' + e.message));
      });
      if (r.dupOf) {
        row.append(el('div', { style: { fontSize: '12px', color: 'var(--warning)' } },
          '· 与「' + r.dupOf.entryName + '」重复'));
      }
      (r.warnings || []).slice(0, 3).forEach(w => {
        row.append(el('div', { style: { fontSize: '12px', color: 'var(--warning)' } }, '· ' + w));
      });
      detailWrap.append(row);
    });
    box.append(detailWrap);

    modal({
      title: `导入预览：${validation.fileName || 'JSON 文件'}`, width: 720, body: box,
      buttons: [
        { text: '取消', value: null },
        {
          text: `导入 ${validation.total - validation.errorCount - (dupAction === 'skip' ? validation.dupCount : 0)} 条`, class: '',
          onClick: async (close) => {
            const handled = {};
            let imported = 0, skipped = 0, overwritten = 0;
            for (let i = 0; i < validation.results.length; i++) {
              const r = validation.results[i];
              if (r.errors.length) { handled[i] = 'skipped-error'; skipped++; continue; }
              if (r.dupOf) {
                if (dupAction === 'skip') { handled[i] = 'skipped-dup'; skipped++; continue; }
                if (dupAction === 'overwrite' && r.dupOf.entryId) {
                  const idx = app.state.library.entries.findIndex(e => e.id === r.dupOf.entryId);
                  if (idx >= 0) {
                    r.entry.questionCount = app.state.library.entries[idx].questionCount || 0;
                    r.entry.lastUsedAt = app.state.library.entries[idx].lastUsedAt || '';
                    app.state.library.entries[idx] = r.entry;
                    handled[i] = 'overwritten'; overwritten++; imported++;
                    continue;
                  }
                }
                if (dupAction === 'copy') r.entry.name = r.entry.name + '（副本）';
                handled[i] = 'imported-dup';
              } else {
                handled[i] = 'imported';
              }
              // id 冲突处理
              if (app.state.library.entries.some(e => e.id === r.entry.id)) r.entry.id = K.uid('R');
              app.state.library.entries.push(r.entry);
              imported++;
            }
            await app.saveLibrary();
            void applyAll;

            // 生成错误报告
            const reportJson = Importer.buildReportJson(validation, handled);
            const reportMd = Importer.buildReportMarkdown(validation);
            const baseName = 'import_report_' + K.timestampForFile();
            try {
              await window.bridge.report.save(baseName, reportJson, reportMd);
              toastOk(`导入完成：成功 ${imported} 条，跳过 ${skipped} 条。错误报告已保存到 data/reports/`);
            } catch (e) {
              toastErr('报告保存失败：' + e.message);
            }
            close(null);
            App.refreshView();
          }
        }
      ]
    });
  }

  // ---------- 导出 ----------
  function renderExportPanel(app) {
    const panel = el('div', { class: 'panel' });
    panel.append(el('div', { class: 'panel-title' }, '导出题库'));
    const buttons = el('div', { class: 'check-row' });
    buttons.append(
      el('button', {
        class: 'btn', onclick: async () => {
          const data = Importer.libraryToExportJson(app.state.library);
          const p = await window.bridge.file.saveJson(`题库导出_${K.timestampForFile()}.json`, data);
          if (p) toastOk('题库已导出：' + p);
        }
      }, '导出 JSON（完整备份/可再导入）'),
      el('button', {
        class: 'btn secondary', onclick: async () => {
          const csv = DocBuilder.libraryToCsv(app.state.library.entries);
          const p = await window.bridge.file.saveText(`题库导出_${K.timestampForFile()}.csv`, csv,
            [{ name: 'CSV', extensions: ['csv'] }]);
          if (p) toastOk('CSV 已导出（仅用于查看与简单编辑，不能反向导入）：' + p);
        }
      }, '导出 CSV（查看用）')
    );
    panel.append(buttons);
    return panel;
  }

  // ---------- 回收站 ----------
  function renderTrashPanel(app) {
    const panel = el('div', { class: 'panel' });
    panel.append(el('div', { class: 'panel-title' }, `回收站（${app.state.trash.entries.length} 条）`));
    const wrap = el('div', { style: { 'max-height': '260px', overflow: 'auto' } });
    if (!app.state.trash.entries.length) {
      wrap.append(el('div', { class: 'empty-state' }, '回收站为空。'));
    }
    app.state.trash.entries.forEach(e => {
      const row = el('div', { class: 'import-entry-row', style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } });
      row.append(
        el('div', {},
          el('div', {}, e.name || '（未命名）'),
          el('div', { style: { fontSize: '12px', color: 'var(--text-sub)' } },
            `删除时间：${K.fmtDateTime(e._deletedAt)} · 难度 ${e.difficulty || '—'}`)),
        el('div', { class: 'check-row' },
          el('button', {
            class: 'btn small', onclick: async () => {
              await app.restoreEntry(e.id);
              App.refreshView();
            }
          }, '恢复'),
          el('button', {
            class: 'btn small danger', onclick: async () => {
              const ok = await confirmDialog('彻底删除', `彻底删除「${e.name}」后无法恢复。确定吗？`, true);
              if (!ok) return;
              const idx = app.state.trash.entries.findIndex(x => x.id === e.id);
              if (idx >= 0) app.state.trash.entries.splice(idx, 1);
              await app.saveTrash();
              App.refreshView();
            }
          }, '彻底删除')));
      wrap.append(row);
    });
    panel.append(wrap);
    if (app.state.trash.entries.length) {
      panel.append(el('button', {
        class: 'btn danger', style: { marginTop: '10px' }, onclick: async () => {
          const ok1 = await confirmDialog('清空回收站', `将彻底删除回收站中的 ${app.state.trash.entries.length} 个条目，无法恢复。`, true);
          if (!ok1) return;
          const ok2 = await confirmDialog('二次确认', '真的要清空回收站吗？此操作不可撤销。', true);
          if (!ok2) return;
          app.state.trash.entries = [];
          await app.saveTrash();
          toastOk('回收站已清空');
          App.refreshView();
        }
      }, '清空回收站（二次确认）'));
    }
    return panel;
  }

  // ---------- 分类管理 ----------
  function renderClassPanel(app) {
    const panel = el('div', { class: 'panel' });
    panel.append(el('div', { class: 'panel-title' }, '分类与标签管理'));
    const cls = app.state.classifications;
    const grid = el('div', { class: 'form-grid' });

    const dims = [
      ['教材版本', 'textbookVersions'], ['册别', 'books'],
      ['物质类别', 'substanceCategories'], ['反应类型', 'reactionTypes'],
      ['知识模块', 'knowledgeModules'], ['自定义标签', 'tags']
    ];
    dims.forEach(([label, key]) => {
      const box = el('div', { class: 'panel', style: { padding: '8px' } });
      box.append(el('div', { style: { 'font-size': '12.5px', 'font-weight': 'bold', marginBottom: '6px' } }, label));
      const list = el('div', {});
      function renderList() {
        list.innerHTML = '';
        cls[key].forEach((v, i) => {
          // 标签名占满整行、操作按钮统一右对齐
          list.append(el('div', { class: 'class-row' },
            el('div', { class: 'class-row-name' },
              el('span', { class: 'tag', title: v }, v)),
            el('div', { class: 'class-row-actions' },
              el('button', {
                class: 'btn small secondary', onclick: async () => {
                  const name = await UI.promptDialog('重命名', `将「${v}」重命名为：`, v);
                  if (!name || name === v) return;
                  cls[key][i] = name;
                  // 同步题库引用
                  if (key !== 'textbookVersions' && key !== 'books') {
                    const fieldMap = { substanceCategories: 'substanceCategories', reactionTypes: 'reactionTypes', knowledgeModules: 'knowledgeModules', tags: 'tags' };
                    const f = fieldMap[key];
                    if (f) app.state.library.entries.forEach(e => {
                      e[f] = (e[f] || []).map(x => x === v ? name : x);
                    });
                  } else {
                    const f = key === 'textbookVersions' ? 'version' : 'book';
                    app.state.library.entries.forEach(e => (e.textbooks || []).forEach(t => { if (t[f] === v) t[f] = name; }));
                  }
                  await Promise.all([app.saveClassifications(), app.saveLibrary()]);
                  renderList();
                }
              }, '改名'),
              el('button', {
                class: 'btn small danger', title: '删除「' + v + '」', onclick: async () => {
                  cls[key].splice(i, 1);
                  await app.saveClassifications();
                  renderList();
                }
              }, '×'))));
        });
      }
      renderList();
      const input = el('input', { type: 'text', placeholder: '新增' + label });
      box.append(list, el('div', { class: 'class-add-row' }, input,
        el('button', {
          class: 'btn small', onclick: async () => {
            const v = input.value.trim();
            if (!v) return;
            if (cls[key].includes(v)) { toast('已存在', 'info'); return; }
            cls[key].push(v);
            await app.saveClassifications();
            input.value = '';
            renderList();
          }
        }, '添加')));
      grid.append(box);
    });
    panel.append(grid);
    return panel;
  }

  // ---------- 备份 ----------
  function renderBackupPanel(app) {
    const panel = el('div', { class: 'panel' });
    panel.append(el('div', { class: 'panel-title' }, '备份与恢复'));
    const listWrap = el('div', { style: { 'max-height': '200px', overflow: 'auto' } });
    panel.append(
      el('button', {
        class: 'btn', onclick: async () => {
          const r = await window.bridge.backup.create();
          toastOk(`备份完成：${r.name}`);
          renderBackupList();
        }
      }, '一键备份（保存到 data/backups）'),
      el('div', { style: { marginTop: '10px' } }, listWrap)
    );

    async function renderBackupList() {
      const list = await window.bridge.backup.list();
      listWrap.innerHTML = '';
      if (!list.length) {
        listWrap.append(el('div', { class: 'empty-state' }, '暂无备份。'));
        return;
      }
      list.forEach(name => {
        listWrap.append(el('div', { class: 'import-entry-row', style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
          el('span', {}, name),
          el('button', {
            class: 'btn small danger', onclick: async () => {
              const ok1 = await confirmDialog('恢复备份', `恢复「${name}」将覆盖当前全部数据（题库、历史、模板、设置）。恢复前系统会自动再保存一份当前数据。确定继续吗？`, true);
              if (!ok1) return;
              const ok2 = await confirmDialog('二次确认', '确定要恢复备份并覆盖当前数据吗？', true);
              if (!ok2) return;
              try {
                const r = await window.bridge.backup.restore(name);
                toastOk(`已恢复备份。当前数据已另存为 ${r.safeBackup}。界面即将重新加载。`);
                setTimeout(() => location.reload(), 1200);
              } catch (e) { toastErr('恢复失败：' + e.message); }
            }
          }, '恢复')));
      });
    }
    renderBackupList();
    return panel;
  }
})();
