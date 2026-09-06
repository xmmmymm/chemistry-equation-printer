/* 设置视图：学习项目、界面显示（字体大小实时缩放）、主题色、默认卷面格式、导出与统计、数据目录、关于 */
(function () {
  'use strict';
  const { el, toast, toastOk, toastErr, confirmDialog, modal } = UI;
  const K = window.Const;

  const ZOOM_MIN = 0.6, ZOOM_MAX = 1.6;
  const ZOOM_PRESETS = [
    { label: '小', factor: 0.9 },
    { label: '标准', factor: 1 },
    { label: '大', factor: 1.15 },
    { label: '特大', factor: 1.3 }
  ];

  App.views.settings = {
    async render(container, app) {
      const page = el('div', { class: 'view-list-page' });
      page.append(
        renderProjectsPanel(app),
        renderZoomPanel(app),
        renderThemePanel(app),
        renderDefaultLayoutPanel(app),
        renderExportPanel(app),
        renderDataPanel(app),
        await renderAboutPanel(app)
      );
      container.appendChild(page);
    }
  };

  // ---------- 学习项目（插为第一个面板） ----------
  function renderProjectsPanel(app) {
    const panel = el('div', { class: 'panel' });
    panel.append(el('div', { class: 'panel-title' }, '学习项目'));

    const curId = app.currentProjectId();
    const list = el('div', {});
    (app.state.projects || []).forEach(p => {
      const stats = app.projectPairStats(p);
      const isCur = p.id === curId;
      const row = el('div', { class: 'project-row', style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 6px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' } });
      // 注意：row.append 是原生 DOM 方法，会把 null 转成字符串 "null" 渲染出来；
      // 条件子项必须先 filter(Boolean) 再 append（el() 才会跳过空子项）
      [
        el('span', { style: { fontWeight: isCur ? 'bold' : 'normal' } }, p.name || '未命名项目'),
        isCur ? el('span', { class: 'tag' }, '当前') : null,
        el('span', { class: 'tag' }, `${stats.round} 轮`),
        el('span', { style: { fontSize: '12px', color: 'var(--text-sub)', flex: '1' } },
          `落后 ${stats.laggards} 对 · ${ScopePicker.scopeSummary(app, p.scope)}`),
        isCur ? null : el('button', {
          class: 'btn small', onclick: async () => { await app.switchProject(p.id); }
        }, '切换'),
        el('button', {
          class: 'btn small secondary', onclick: async () => {
            const name = await UI.promptDialog('重命名学习项目', '项目名称', p.name);
            if (!name) return;
            await app.renameProject(p.id, name);
            toastOk('项目已重命名');
          }
        }, '改名'),
        p.id === 'default' ? null : el('button', {
          class: 'btn small secondary', onclick: () => openScopeEditor(app, p), title: '默认项目范围为全部题库，不可修改'
        }, '改范围'),
        p.id === 'default' ? null : el('button', {
          class: 'btn small danger', onclick: async () => {
            const hist = await window.bridge.history.list(p.id);
            const ok = await confirmDialog('删除学习项目',
              `确定删除「${p.name}」吗？将同时删除该项目的 ${hist.length} 份历史作业与全部出题标记（计数），且不可恢复。`, true);
            if (!ok) return;
            await app.deleteProject(p.id);
            toastOk('项目已删除（含历史作业与出题标记）');
          }
        }, '删除')
      ].filter(Boolean).forEach(node => row.append(node));
      list.append(row);
    });
    panel.append(list);

    const actions = el('div', { class: 'check-row', style: { marginTop: '10px' } });
    actions.append(
      el('button', {
        class: 'btn', onclick: () => openCreateProjectDialog(app)
      }, '＋ 新建学习项目')
    );
    panel.append(actions);

    panel.append(el('div', { class: 'settings-hint' },
      '所有作业生成归属当前学习项目：项目各有出题范围、「方程式+题型」出题标记、学习进度（轮数）与历史作业；题库、模板、系统设置全局共享。',
      el('br'),
      '学习进度 = 范围内所有可出「方程式+题型」对已出次数的最小值；出题只出计数 ≤ 轮数的对（不再重复前几轮已出的题），新扩进范围的条目优先补上。',
      el('br'),
      '默认项目（全部题库）不可删除、范围不可改、可改名。'));
    return panel;
  }

  // 新建项目弹窗：名称 + 使用全部题库勾选 + 范围选择器
  function openCreateProjectDialog(app) {
    const nameInput = el('input', { type: 'text', style: { width: '100%' }, placeholder: '如：高一上学期·金属及其化合物' });
    const allCb = el('input', { type: 'checkbox' });
    allCb.checked = true; // 默认使用全部题库
    let scope = {};
    const scopeBox = el('div', {});
    const rerenderScope = () => {
      scopeBox.innerHTML = '';
      scopeBox.append(ScopePicker.render(app, scope, {
        disabled: allCb.checked,
        onChange: () => rerenderScope() // 章节级联需要重建选项
      }));
    };
    rerenderScope();
    allCb.addEventListener('change', () => rerenderScope());

    const box = el('div', {},
      el('label', { class: 'field', style: { marginBottom: '8px' } }, el('span', {}, '项目名称'), nameInput),
      el('label', { class: 'check-item', style: { marginBottom: '6px' } }, allCb, '使用全部题库（不限制出题范围）'),
      el('div', { style: { maxHeight: '340px', overflow: 'auto', border: '1px solid var(--border)', borderRadius: '6px', padding: '8px' } }, scopeBox));

    modal({
      title: '新建学习项目', width: 640, body: box,
      buttons: [
        { text: '取消', value: null },
        {
          text: '创建并切换', class: '', onClick: async (close) => {
            const name = nameInput.value.trim();
            if (!name) { toastErr('请输入项目名称'); return; }
            const useAll = allCb.checked;
            const finalScope = useAll ? {} : JSON.parse(JSON.stringify(scope));
            close(null);
            const r = await app.createProject(name, finalScope);
            if (r && r.ok) {
              toastOk(`学习项目「${name}」已创建` + (r.switched ? '，已切换为当前项目' : '（未切换：当前作业未处理）'));
            }
          }
        }
      ]
    });
  }

  // 改范围弹窗（default 不可改，调用方已禁用）
  function openScopeEditor(app, p) {
    const scope = JSON.parse(JSON.stringify(p.scope || {}));
    const scopeBox = el('div', {});
    const rerenderScope = () => {
      scopeBox.innerHTML = '';
      scopeBox.append(ScopePicker.render(app, scope, { onChange: () => rerenderScope() }));
    };
    rerenderScope();
    const box = el('div', {},
      el('div', { style: { fontSize: '12.5px', color: 'var(--text-sub)', marginBottom: '8px' } },
        `调整「${p.name}」的出题范围（空 = 全部题库）。范围变更后，学习进度（轮数）将按新范围自动重算。`),
      el('div', { style: { maxHeight: '380px', overflow: 'auto', border: '1px solid var(--border)', borderRadius: '6px', padding: '8px' } }, scopeBox));
    modal({
      title: '修改项目范围', width: 640, body: box,
      buttons: [
        { text: '取消', value: null },
        {
          text: '保存', class: '', onClick: async (close) => {
            close(null);
            await app.updateProjectScope(p.id, JSON.parse(JSON.stringify(scope)));
            toast('范围已更新，学习进度已按新范围重算', 'info');
          }
        }
      ]
    });
  }

  // ---------- 界面显示（字体大小，实时生效） ----------
  let zoomLabel = null, zoomSlider = null, zoomHooked = false;
  if (!zoomHooked) {
    zoomHooked = true;
    // 快捷键/滚轮改缩放时，设置页滑块与百分比同步刷新
    document.addEventListener('uizoom', (e) => {
      if (zoomLabel) zoomLabel.textContent = Math.round(e.detail * 100) + '%';
      if (zoomSlider) zoomSlider.value = String(e.detail);
    });
  }

  function renderZoomPanel(app) {
    const panel = el('div', { class: 'panel' });
    panel.append(el('div', { class: 'panel-title' }, '界面显示（字体大小）'));

    const cur = app.getUiZoom();
    zoomLabel = el('span', { class: 'zoom-value' }, Math.round(cur * 100) + '%');
    zoomSlider = el('input', { type: 'range', min: '0.6', max: '1.6', step: '0.05', value: String(cur) });
    zoomSlider.addEventListener('input', () => { app.setUiZoom(Number(zoomSlider.value)); });

    const presetRow = el('div', { class: 'zoom-presets' });
    ZOOM_PRESETS.forEach(p => {
      presetRow.append(el('button', {
        class: 'btn small secondary',
        onclick: () => app.setUiZoom(p.factor)
      }, p.label));
    });
    presetRow.append(el('button', {
      class: 'btn small secondary', title: '恢复 100%', onclick: () => app.setUiZoom(1)
    }, '重置'));

    panel.append(
      el('div', { class: 'zoom-row' }, zoomSlider, zoomLabel),
      presetRow,
      el('div', { class: 'settings-hint' },
        '调整立即生效并自动保存：整体界面（文字、按钮、卡片）等比缩放，布局自动重排；导出与打印的卷面字号不受影响。',
        el('br'),
        '快捷键：Ctrl + = 放大　Ctrl + - 缩小　Ctrl + 0 恢复 100%　Ctrl + 滚轮 缩放界面',
        el('br'),
        '（卷面预览区内的 Ctrl + 滚轮仍为卷面缩放）')
    );
    return panel;
  }

  // ---------- 主题色（实时生效） ----------
  function renderThemePanel(app) {
    const panel = el('div', { class: 'panel' });
    panel.append(el('div', { class: 'panel-title' }, '主题色'));
    const s = app.state.settings;
    const active = (s.theme && s.theme.preset) || 'paper';

    const row = el('div', { class: 'theme-row' });
    Object.entries(K.THEME_PRESETS).forEach(([name, preset]) => {
      const v = preset.vars;
      const swatch = el('span', { class: 'theme-swatch' },
        el('span', { style: { background: v['--bg'] } }),
        el('span', { style: { background: v['--bg-card'] } }),
        el('span', { style: { background: v['--btn'] } }));
      const btn = el('button', {
        class: 'btn small ' + (name === active ? '' : 'secondary'),
        onclick: async () => {
          s.theme = {
            preset: name,
            background: v['--bg'], card: v['--bg-card'], text: v['--text']
          };
          app.applyTheme();
          await app.saveSettings();
          App.refreshView();
          toastOk('主题已切换：' + preset.label);
        }
      }, swatch, preset.label);
      row.append(btn);
    });
    panel.append(row, el('div', { class: 'settings-hint' }, '点击立即切换并自动保存，应用于全部界面。'));
    return panel;
  }

  // ---------- 默认卷面格式（新作业初始排版） ----------
  function renderDefaultLayoutPanel(app) {
    const panel = el('div', { class: 'panel' });
    panel.append(el('div', { class: 'panel-title' }, '默认卷面格式（新作业）'));
    const s = app.state.settings;

    const paperSel = el('select');
    Object.keys(K.PAPER_SIZES).forEach(k => paperSel.append(el('option', { value: k }, k)));
    paperSel.value = s.defaultPaper.size || 'A4';
    const orientSel = el('select');
    [['portrait', '纵向'], ['landscape', '横向']].forEach(([v, t]) => orientSel.append(el('option', { value: v }, t)));
    orientSel.value = s.defaultPaper.orientation || 'portrait';

    const m = s.defaultPaper.margins || {};
    const mkMargin = (label, key) => {
      const input = el('input', { type: 'text', style: { width: '70px' }, value: m[key] || '2cm' });
      input.addEventListener('input', () => { s.defaultPaper.margins = s.defaultPaper.margins || { top: '2cm', bottom: '2cm', left: '2cm', right: '2cm' }; s.defaultPaper.margins[key] = input.value; dirty(); });
      return el('label', { class: 'field' }, el('span', {}, label), input);
    };
    // 字体下拉（中文/西文；与「卷面格式」「导出图片」共用同一份字体清单）
    const mkFontSelect = (label, key, list) => {
      const sel = el('select');
      list.forEach(f => sel.append(el('option', { value: f.value }, f.label + '（' + f.value + '）')));
      sel.value = list.some(f => f.value === s.defaultFont[key]) ? s.defaultFont[key] : list[0].value;
      sel.addEventListener('change', () => { s.defaultFont[key] = sel.value; dirty(); });
      return el('label', { class: 'field' }, el('span', {}, label), sel);
    };

    const titleSize = el('input', { type: 'number', min: '10', max: '26', step: '0.5', style: { width: '70px' }, value: s.defaultFont.titleSizePt || 16 });
    titleSize.addEventListener('input', () => { s.defaultFont.titleSizePt = Number(titleSize.value) || 16; dirty(); });
    const bodySize = el('input', { type: 'number', min: '8', max: '18', step: '0.5', style: { width: '70px' }, value: s.defaultFont.fontSizePt || 12 });
    bodySize.addEventListener('input', () => { s.defaultFont.fontSizePt = Number(bodySize.value) || 12; dirty(); });
    const lineSel = el('select');
    [['single', '单倍'], ['1.5', '1.5 倍'], ['double', '2 倍']].forEach(([v, t]) => lineSel.append(el('option', { value: v }, t)));
    lineSel.value = s.defaultFont.lineSpacing || 'single';
    lineSel.addEventListener('change', () => { s.defaultFont.lineSpacing = lineSel.value; dirty(); });

    const hint = el('div', { class: 'settings-hint', style: { display: 'none' } }, '有未保存的修改');
    function dirty() { hint.style.display = ''; }

    const grid = el('div', { class: 'form-grid' });
    grid.append(
      el('label', { class: 'field' }, el('span', {}, '纸张'), paperSel),
      el('label', { class: 'field' }, el('span', {}, '方向'), orientSel),
      mkMargin('上边距（cm）', 'top'), mkMargin('下边距（cm）', 'bottom'),
      mkMargin('左边距（cm）', 'left'), mkMargin('右边距（cm）', 'right'),
      mkFontSelect('中文字体', 'chinese', K.ZH_FONTS),
      mkFontSelect('西文字体', 'latin', K.EN_FONTS),
      el('label', { class: 'field' }, el('span', {}, '标题字号（pt，黑体加粗）'), titleSize),
      el('label', { class: 'field' }, el('span', {}, '正文字号（pt）'), bodySize),
      el('label', { class: 'field' }, el('span', {}, '行距'), lineSel)
    );

    const saveBtn = el('button', {
      class: 'btn', onclick: async () => {
        await app.saveSettings();
        hint.style.display = 'none';
        toastOk('默认卷面格式已保存，之后新生成的作业将自动套用');
      }
    }, '保存默认值');
    const readBtn = el('button', {
      class: 'btn secondary', onclick: () => {
        const w = app.state.worksheet;
        if (!w) { toastErr('当前没有作业，无法读取'); return; }
        const L = w.layoutSettings;
        s.defaultPaper.size = L.paper.size;
        s.defaultPaper.orientation = L.paper.orientation;
        s.defaultPaper.margins = JSON.parse(JSON.stringify(L.margins));
        s.defaultFont.chinese = L.font.chinese;
        s.defaultFont.latin = L.font.latin;
        s.defaultFont.titleSizePt = L.font.titleSizePt;
        s.defaultFont.fontSizePt = L.font.bodySizePt;
        s.defaultFont.lineSpacing = L.spacing.lineSpacing;
        App.refreshView();
        toastOk('已读取当前作业的卷面格式，请点击「保存默认值」生效');
      }
    }, '从当前作业读取');

    panel.append(
      grid,
      el('div', { class: 'check-row', style: { marginTop: '8px' } }, saveBtn, readBtn, hint),
      el('div', { class: 'settings-hint' }, '仅作为之后新生成作业的初始卷面格式；已保存的历史作业不受影响，每份作业仍可在「卷面格式」中单独调整。')
    );
    return panel;
  }

  // ---------- 导出与统计（自「数据管理」迁入） ----------
  function renderExportPanel(app) {
    const panel = el('div', { class: 'panel' });
    panel.append(el('div', { class: 'panel-title' }, '导出与统计'));
    const s = app.state.settings;
    const dirBtn = el('button', {
      class: 'btn secondary small', onclick: async () => {
        const dir = await window.bridge.exportFile.chooseDir();
        if (!dir) return;
        s.export.folder = dir;
        await app.saveSettings();
        dirLabel.textContent = '导出目录：' + dir;
        toastOk('导出目录已更新');
      }
    }, '选择导出目录…');
    const dirLabel = el('div', { style: { fontSize: '12.5px', color: 'var(--text-sub)', margin: '6px 0' } },
      '导出目录：' + (s.export.folder || 'data/exports（默认）'));

    const imgDirBtn = el('button', {
      class: 'btn secondary small', onclick: async () => {
        const dir = await window.bridge.exportFile.chooseDir();
        if (!dir) return;
        s.export.imagesFolder = dir;
        await app.saveSettings();
        imgDirLabel.textContent = '图片导出目录：' + dir;
        toastOk('图片导出目录已更新');
      }
    }, '选择图片导出目录…');
    const imgDirLabel = el('div', { style: { fontSize: '12.5px', color: 'var(--text-sub)', margin: '6px 0' } },
      '图片导出目录：' + (s.export.imagesFolder || 'data/exports（默认）'));

    const mkToggle = (label, obj, key, hint) => {
      const cb = el('input', { type: 'checkbox' });
      cb.checked = obj[key] !== false;
      cb.addEventListener('change', async () => { obj[key] = cb.checked; await app.saveSettings(); });
      return el('label', { class: 'check-item', title: hint || '' }, cb, label);
    };

    panel.append(
      dirBtn, dirLabel,
      imgDirBtn, imgDirLabel,
      el('div', { class: 'check-row', style: { marginTop: '8px' } },
        mkToggle('导出时同时生成答案卷', s.export, 'includeAnswer'),
        mkToggle('保存历史作业时累计出题次数', s.statistics, 'countOnSave'),
        mkToggle('导出文件时累计出题次数', s.statistics, 'countOnExport')),
      el('div', { class: 'settings-hint' }, '图片导出目录是「题库管理 → 导出图片」的默认保存位置；导出时可再单独选择。'));
    return panel;
  }

  // ---------- 数据目录 ----------
  function renderDataPanel(app) {
    const panel = el('div', { class: 'panel' });
    panel.append(el('div', { class: 'panel-title' }, '数据目录'));
    panel.append(
      el('div', { style: { fontSize: '12.5px', color: 'var(--text-sub)', margin: '6px 0', wordBreak: 'break-all' } },
        `数据目录：${app.state.dataDir}`),
      el('button', {
        class: 'btn secondary small', onclick: async () => {
          const r = await window.bridge.dir.openData();
          if (r && r.ok) toastOk('已在资源管理器中打开数据目录');
          else toastErr('打开失败：' + ((r && r.message) || '未知错误'));
        }
      }, '打开数据目录'),
      el('div', { class: 'settings-hint' }, '题库、历史作业、模板、备份均保存在该目录；可用「数据管理」中的备份功能整体备份。')
    );
    return panel;
  }

  // ---------- 关于 ----------
  async function renderAboutPanel(app) {
    const panel = el('div', { class: 'panel' });
    panel.append(el('div', { class: 'panel-title' }, '关于'));

    const entries = app.state.library.entries || [];
    const versionCount = entries.reduce((n, e) => n + (e.versions || []).length, 0);
    let historyCount = '…';
    try {
      const list = await window.bridge.history.list();
      historyCount = String(list.length);
    } catch (_) { historyCount = '—'; }

    panel.append(
      el('div', { style: { fontSize: '13px', fontWeight: 'bold', margin: '4px 0' } }, '高中化学方程式组卷打印系统'),
      el('div', { style: { fontSize: '12.5px', color: 'var(--text-sub)', margin: '6px 0' } },
        `版本 ${app.state.version || '1.0.0'} · 完全离线运行`,
        el('br'),
        `题库 ${entries.length} 条 / ${versionCount} 个版本 · 历史作业 ${historyCount} 份`),
      el('button', {
        class: 'btn danger small', style: { marginTop: '6px' }, onclick: async () => {
          if (!app.state.defaults) { toastErr('默认设置不可用'); return; }
          const ok1 = await confirmDialog('恢复全部默认设置',
            '将把界面缩放、主题、默认卷面格式、导出目录、统计开关等全部恢复为默认值。确定继续吗？', true);
          if (!ok1) return;
          app.state.settings = structuredClone(app.state.defaults);
          await app.saveSettings();
          await app.setUiZoom(app.getUiZoom());
          app.applyTheme();
          App.refreshView();
          toastOk('已恢复全部默认设置');
        }
      }, '恢复全部默认设置'),
      el('div', { class: 'settings-hint', style: { marginTop: '8px' } },
        '快捷键：Ctrl + = / Ctrl + - / Ctrl + 0 界面缩放　·　当前作业页：Ctrl + 滚轮 卷面缩放、Shift + 滚轮 水平滚动')
    );
    return panel;
  }
})();
