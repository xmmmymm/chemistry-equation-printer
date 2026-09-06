/* 反应条目编辑器：一行式方程式录入 + 结构化编辑 + 版本管理 */
(function () {
  'use strict';
  const { el, toast, toastErr, toastOk, modal } = UI;
  const C = window.Chem, K = window.Const;

  function defaultVersion(type, copyFrom) {
    const v = {
      id: K.uid('v'),
      type: type || 'chemical',
      label: K.EQ_TYPE_MAP[type || 'chemical'].label,
      reversible: false,
      reactants: [],
      products: [],
      conditions: [],
      extras: {},
      questionCount: 0
    };
    // 从现有版本预填物质（便于快速改写成离子/电离等新类型版本）
    if (copyFrom) {
      v.reversible = !!copyFrom.reversible;
      v.reactants = JSON.parse(JSON.stringify(copyFrom.reactants || []));
      v.products = JSON.parse(JSON.stringify(copyFrom.products || []));
      v.conditions = JSON.parse(JSON.stringify(copyFrom.conditions || []));
    }
    return v;
  }

  /**
   * 打开条目编辑器。
   * app: App；entry: LibraryEntry（新条目由调用方构造）；opts: { temp: bool, onSave(entry) }
   */
  function openEntryEditor(app, entry, opts) {
    opts = opts || {};
    const state = {
      entry: JSON.parse(JSON.stringify(entry)),
      activeVersionIndex: 0,
      forceConfirmed: false,
      lineDirty: false
    };
    if (!state.entry.versions.length) state.entry.versions.push(defaultVersion('chemical'));

    const body = el('div');
    const ctrl = modal({
      title: opts.temp ? '临时录入方程式' : (entry.id && entry.name ? '编辑条目：' + entry.name : '新增反应条目'),
      width: 880,
      body,
      buttons: [
        { text: '取消', value: null },
        {
          text: '保存', class: '',
          onClick: (close) => {
            const problems = validateEntry(state.entry);
            const hasErrors = problems.errors.length > 0;
            if (hasErrors && !state.forceConfirmed) {
              UI.confirmDialog('存在校验错误', el('div', {},
                el('div', { style: { marginBottom: '8px' } }, '以下问题需要处理：'),
                el('div', { style: { color: 'var(--error)', 'white-space': 'pre-line' } }, problems.errors.join('\n')),
                el('div', { style: { marginTop: '10px', color: 'var(--text-sub)' } },
                  '若属于系统无法判断的复杂情况，可选择“标记为待核对并保存”；否则请返回修改。'))
              ).then(ok => {
                if (ok) {
                  state.forceConfirmed = true;
                  toast('已标记为“待核对”，请尽快人工核对', 'warning');
                  doSave();
                }
              });
              return;
            }
            doSave();

            function doSave() {
              const now = K.nowIso();
              state.entry.updatedAt = now;
              if (!state.entry.createdAt) state.entry.createdAt = now;
              state.entry.versions.forEach(v => {
                v.checkStatus = C.validateVersion(v);
                if (state.forceConfirmed && v.checkStatus.errors.length) {
                  v.checkStatus.warnings.push('已由教师确认，标记为待核对');
                  v.checkStatus.errors = [];
                  v.checkStatus.ok = true;
                }
              });
              close(state.entry);
            }
          }
        }
      ],
      onClose: (v) => { if (v && opts.onSave) opts.onSave(v); }
    });
    ctrl.body.style.padding = '14px';

    render();

    function validateEntry(e) {
      const errors = [];
      if (!e.name || !e.name.trim()) errors.push('反应名称不能为空');
      if (!K.DIFFICULTIES.includes(e.difficulty)) errors.push('难度必须为：简单 / 中等 / 较难');
      if (!e.versions.length) errors.push('至少需要一个表达式版本');
      for (const v of e.versions) {
        if (!v.reactants.length || !v.products.length) {
          errors.push(`「${v.label}」缺少反应物或生成物`);
          continue;
        }
        const st = C.validateVersion(v);
        st.errors.forEach(m => errors.push(`「${v.label}」${m}`));
      }
      return { errors };
    }

    function activeVersion() {
      return state.entry.versions[state.activeVersionIndex] || state.entry.versions[0];
    }

    function render() {
      body.innerHTML = '';
      body.appendChild(renderBasicInfo());
      body.appendChild(renderClassification());
      body.appendChild(renderVersions());
    }

    function renderBasicInfo() {
      const e = state.entry;
      const panel = el('div', { class: 'panel', style: { marginBottom: '12px' } });
      const grid = el('div', { class: 'form-grid' });
      const mkText = (label, key, placeholder) => {
        const input = el('input', { type: 'text', value: e[key] || '', placeholder: placeholder || '' });
        input.addEventListener('input', () => { e[key] = input.value; });
        return el('label', { class: 'field' }, el('span', {}, label), input);
      };
      grid.append(
        mkText('反应名称 *', 'name', '如：钠与水反应'),
        el('label', { class: 'field' },
          el('span', {}, '难度 *'),
          difficultySelect(e)),
        mkText('文字描述（C 类题必需）', 'description', '如：金属钠与水反应生成氢氧化钠和氢气'),
        mkText('开放题干（H 类题必需）', 'openPrompt', '如：写出一个生成沉淀的复分解反应'),
        mkText('难度理由', 'difficultyReason'),
        mkText('备注', 'remark')
      );
      const checks = el('div', { class: 'check-row', style: { marginTop: '10px' } });
      const mkCheck = (label, key) => {
        const cb = el('input', { type: 'checkbox' });
        cb.checked = !!e[key];
        cb.addEventListener('change', () => { e[key] = cb.checked; });
        return el('label', { class: 'check-item' }, cb, label);
      };
      checks.append(mkCheck('星标（重点）', 'starred'), mkCheck('必出', 'mustInclude'), mkCheck('启用', 'enabled'));
      panel.append(el('div', { class: 'panel-title' }, '基本信息'), grid, checks);
      return panel;
    }

    function difficultySelect(e) {
      const sel = el('select');
      K.DIFFICULTIES.forEach(d => {
        sel.append(el('option', { value: d }, d));
      });
      sel.value = e.difficulty || '中等';
      sel.addEventListener('change', () => { e.difficulty = sel.value; });
      return sel;
    }

    function renderClassification() {
      const e = state.entry;
      const cls = app.state.classifications;
      const panel = el('div', { class: 'panel', style: { marginBottom: '12px' } });

      const mkMulti = (title, key, options) => {
        const box = el('div', { style: { marginBottom: '8px' } });
        const set = new Set(e[key] || []);
        box.append(el('div', { style: { fontSize: '12px', color: 'var(--text-sub)', marginBottom: '4px' } }, title));
        const wrap = el('div', { class: 'check-row' });
        options.forEach(opt => {
          const cb = el('input', { type: 'checkbox' });
          cb.checked = set.has(opt);
          cb.addEventListener('change', () => {
            if (cb.checked) set.add(opt); else set.delete(opt);
            e[key] = Array.from(set);
          });
          wrap.append(el('label', { class: 'check-item' }, cb, opt));
        });
        box.append(wrap);
        return box;
      };

      const textbookPanel = el('div', { style: { marginBottom: '8px' } });
      textbookPanel.append(el('div', { style: { fontSize: '12px', color: 'var(--text-sub)', marginBottom: '4px' } }, '教材章节（可多个）'));
      const tbList = el('div', {});
      function renderTbs() {
        tbList.innerHTML = '';
        (e.textbooks || []).forEach((t, i) => {
          tbList.append(el('div', { class: 'check-row', style: { marginBottom: '4px' } },
            el('span', { class: 'tag' }, `${t.version} / ${t.book} / ${t.chapter} / ${t.section}${t.context ? '（原栏目：' + t.context + '）' : ''}`),
            el('button', {
              class: 'btn small danger', onclick: () => { e.textbooks.splice(i, 1); renderTbs(); }
            }, '删除')));
        });
      }
      renderTbs();
      // ---- 章/节 datalist 建议（原生 datalist，保留自由输入能力）----
      const chDl = el('datalist', { id: K.uid('dlch') });
      const secDl = el('datalist', { id: K.uid('dlsec') });
      const chaptersTree = () => (cls.chapters || {});
      function rebuildChapterDl() {
        chDl.innerHTML = '';
        const arr = chaptersTree()[bs.value];
        if (arr) for (const c of arr) chDl.append(el('option', { value: c.chapter }));
        // 册别无树数据 → 不给建议，自由输入
      }
      function rebuildSectionDl() {
        secDl.innerHTML = '';
        const book = bs.value, ch = cs.value.trim();
        if (!book || !ch) return;
        const arr = chaptersTree()[book] || [];
        const hit = arr.find(c => c.chapter === ch);
        if (hit) for (const s of (hit.sections || [])) secDl.append(el('option', { value: s }));
      }
      const vs = el('select'), bs = el('select'),
        cs = el('input', { type: 'text', placeholder: '章', style: { width: '110px' }, list: chDl.id }),
        ss = el('input', { type: 'text', placeholder: '节（可空）', style: { width: '110px' }, list: secDl.id });
      cls.textbookVersions.forEach(v => vs.append(el('option', {}, v)));
      cls.books.forEach(v => bs.append(el('option', {}, v)));
      bs.addEventListener('change', () => { rebuildChapterDl(); rebuildSectionDl(); });
      cs.addEventListener('input', rebuildSectionDl);
      rebuildChapterDl();
      textbookPanel.append(tbList, chDl, secDl,
        el('div', { class: 'check-row' }, vs, bs, cs, ss,
          el('button', {
            class: 'btn small', onclick: async () => {
              if (!cs.value.trim()) { toast('请填写章', 'warning'); return; }
              // 新章/节不在树中 → 并入 App.state.classifications.chapters 并保存（幂等）
              const book = bs.value;
              const chName = cs.value.trim();
              const secName = ss.value.trim();
              cls.chapters = cls.chapters || {};
              cls.chapters[book] = cls.chapters[book] || [];
              let chObj = cls.chapters[book].find(c => c.chapter === chName);
              let treeChanged = false;
              if (!chObj) {
                chObj = { chapter: chName, sections: [] };
                cls.chapters[book].push(chObj);
                treeChanged = true;
              }
              if (secName && !(chObj.sections || []).includes(secName)) {
                chObj.sections = chObj.sections || [];
                chObj.sections.push(secName);
                treeChanged = true;
              }
              if (treeChanged) {
                try {
                  await app.saveClassifications();
                  rebuildChapterDl();
                  rebuildSectionDl();
                } catch (err) {
                  toastErr('章节树保存失败：' + (err && err.message ? err.message : err));
                }
              }
              e.textbooks = e.textbooks || [];
              e.textbooks.push({ version: vs.value, book: bs.value, chapter: chName, section: secName });
              renderTbs();
            }
          }, '添加章节')));

      panel.append(
        el('div', { class: 'panel-title' }, '分类'),
        textbookPanel,
        mkMulti('物质类别', 'substanceCategories', cls.substanceCategories),
        mkMulti('反应类型', 'reactionTypes', cls.reactionTypes),
        mkMulti('知识模块', 'knowledgeModules', cls.knowledgeModules),
        mkMulti('自定义标签', 'tags', cls.tags)
      );
      return panel;
    }

    function renderVersions() {
      const wrap = el('div', { class: 'panel' });
      const tabs = el('div', { class: 'check-row', style: { marginBottom: '10px' } });
      state.entry.versions.forEach((v, i) => {
        tabs.append(el('button', {
          class: 'btn small ' + (i === state.activeVersionIndex ? '' : 'secondary'),
          onclick: () => { state.activeVersionIndex = i; render(); }
        }, `${i + 1}. ${v.label}`));
      });
      tabs.append(el('button', {
        class: 'btn small success', onclick: () => {
          const used = state.entry.versions.map(v => v.type);
          const avail = K.EQ_TYPES.filter(t => !used.includes(t.code));
          if (!avail.length) { toast('六种版本类型都已添加', 'info'); return; }
          state.entry.versions.push(defaultVersion(avail[0].code, activeVersion()));
          state.activeVersionIndex = state.entry.versions.length - 1;
          toast('已复制当前版本的内容，请按新版本类型修改物质', 'info', 5000);
          render();
        }
      }, '＋ 添加版本'));

      wrap.append(el('div', { class: 'panel-title' }, '表达式版本'), tabs);

      const v = activeVersion();
      if (v) wrap.appendChild(renderOneVersion(v));
      return wrap;
    }

    function renderOneVersion(v) {
      const box = el('div', { class: 'eq-editor-box' });
      const head = el('div', { class: 'check-row', style: { marginBottom: '8px' } });
      const typeSel = el('select');
      K.EQ_TYPES.forEach(t => typeSel.append(el('option', { value: t.code }, t.label)));
      typeSel.value = v.type;
      typeSel.addEventListener('change', () => {
        v.type = typeSel.value;
        v.label = K.EQ_TYPE_MAP[v.type].label;
        render();
      });
      const revCb = el('input', { type: 'checkbox' });
      revCb.checked = !!v.reversible;
      revCb.addEventListener('change', () => { v.reversible = revCb.checked; renderOnePreview(); });
      head.append(
        el('label', { class: 'check-item' }, '类型 ', typeSel),
        el('label', { class: 'check-item' }, revCb, '可逆反应（⇌）'),
        el('span', { style: { flex: '1' } }),
        el('span', { class: 'tag' }, `出题次数：${v.questionCount || 0}`),
        el('button', {
          class: 'btn small danger', onclick: () => {
            if (state.entry.versions.length <= 1) { toastErr('至少保留一个版本'); return; }
            UI.confirmDialog('删除版本', `确定删除「${v.label}」吗？该版本的出题次数记录将一并删除。`, true)
              .then(ok => {
                if (!ok) return;
                state.entry.versions.splice(state.activeVersionIndex, 1);
                state.activeVersionIndex = 0;
                render();
              });
          }
        }, '删除此版本'));
      box.append(head);

      // 一行式输入
      const lineInput = el('input', { type: 'text', placeholder: '如：2Na + 2H2O = 2NaOH + H2↑；有机：CH2=CH2 + Br2 = CH2BrCH2Br；聚合：nCH2=CH2 = [CH2-CH2]n' });
      lineInput.value = C.editorLine(v);
      const parseStatus = el('div', { class: 'check-result' });
      const parseBtn = el('button', {
        class: 'btn small', onclick: () => {
          const r = C.parseEquationLine(lineInput.value);
          if (!r.ok) {
            parseStatus.innerHTML = `<span class="err">解析失败：${C.escapeHtml(r.errors.join('；'))}</span>`;
            if (r.warnings.length) parseStatus.innerHTML += `<div class="warn">${C.escapeHtml(r.warnings.join('；'))}</div>`;
            return;
          }
          v.reactants = r.reactants;
          v.products = r.products;
          v.reversible = r.reversible;
          revCb.checked = v.reversible;
          parseStatus.innerHTML = '<span class="ok">已解析为结构化数据</span>' +
            (r.warnings.length ? `<div class="warn">${C.escapeHtml(r.warnings.join('；'))}</div>` : '');
          renderOnePreview();
          renderSpeciesChips();
        }
      }, '解析');
      box.append(el('div', { class: 'eq-input-row' }, lineInput, parseBtn), parseStatus);

      // 条件按钮
      const condWrap = el('div', { class: 'cond-buttons' });
      const activeCondCodes = new Set((v.conditions || []).map(c => c.code + '|' + c.text));
      K.CONDITION_PRESETS.forEach(p => {
        if (p.code === 'custom') return;
        const chip = el('button', {
          class: 'cond-chip' + (activeCondCodes.has(p.code + '|' + p.text) ? ' on' : ''),
          onclick: () => {
            v.conditions = v.conditions || [];
            const idx = v.conditions.findIndex(c => c.code === p.code && c.text === p.text);
            if (idx >= 0) v.conditions.splice(idx, 1);
            else v.conditions.push({ code: p.code, text: p.text, position: 'auto' });
            renderVersions();
          }
        }, p.text === '△' ? '加热 △' : p.text);
        condWrap.append(chip);
      });
      const customInput = el('input', { type: 'text', placeholder: '自定义条件', style: { width: '110px' } });
      condWrap.append(customInput, el('button', {
        class: 'btn small', onclick: () => {
          const t = customInput.value.trim();
          if (!t) return;
          v.conditions = v.conditions || [];
          v.conditions.push({ code: 'custom', text: t, position: 'auto' });
          renderVersions();
        }
      }, '添加'));
      (v.conditions || []).forEach((c, i) => {
        condWrap.append(el('span', { class: 'tag' }, c.code === 'heat' ? '△' : c.text,
          el('a', {
            href: '#', style: { marginLeft: '4px' }, onclick: (ev) => {
              ev.preventDefault(); v.conditions.splice(i, 1); renderVersions();
            }
          }, '×')));
      });
      box.append(el('div', { style: { fontSize: '12px', color: 'var(--text-sub)', margin: '8px 0 0' } }, '反应条件（显示在等号/可逆号上方）'), condWrap);

      // 附加设置
      const extrasWrap = el('div', { class: 'check-row', style: { marginTop: '8px' } });
      if (v.type === 'thermochemical') {
        const dh = el('input', { type: 'text', placeholder: '如：-571.6 kJ/mol', value: (v.extras && v.extras.deltaH) || '', style: { width: '180px' } });
        dh.addEventListener('input', () => { v.extras = v.extras || {}; v.extras.deltaH = dh.value; });
        extrasWrap.append(el('label', { class: 'check-item' }, 'ΔH =', dh));
      }
      if (v.type === 'electrode') {
        const es = el('select');
        ['', '正极', '负极', '阳极', '阴极'].forEach(x => es.append(el('option', {}, x)));
        es.value = (v.extras && v.extras.electrode) || '';
        es.addEventListener('change', () => { v.extras = v.extras || {}; v.extras.electrode = es.value || undefined; });
        extrasWrap.append(el('label', { class: 'check-item' }, '电极：', es));
      }
      const medium = el('input', { type: 'text', placeholder: '介质（可选，如：酸性）', value: (v.extras && v.extras.medium) || '', style: { width: '150px' } });
      medium.addEventListener('input', () => { v.extras = v.extras || {}; v.extras.medium = medium.value; });
      extrasWrap.append(el('label', { class: 'check-item' }, medium));
      box.append(extrasWrap);

      // 物质点选编辑
      const speciesWrap = el('div');
      function renderSpeciesChips() {
        speciesWrap.innerHTML = '';
        speciesWrap.append(el('div', { style: { fontSize: '12px', color: 'var(--text-sub)', margin: '8px 0 0' } }, '点击物质编辑系数、化学式、状态、气体、沉淀：'));
        const chips = el('div', { class: 'species-chips' });
        const mkChip = (sp, side) => {
          const chip = el('button', { class: 'species-chip', onclick: () => editSpecies(sp, side) });
          chip.innerHTML = C.speciesHTML(sp);
          return chip;
        };
        v.reactants.forEach(sp => chips.append(mkChip(sp, 'reactants')));
        chips.append(el('span', { style: { alignSelf: 'center', color: 'var(--text-sub)' } }, v.reversible ? '⇌' : '='));
        v.products.forEach(sp => chips.append(mkChip(sp, 'products')));
        speciesWrap.append(chips);
      }
      function editSpecies(sp, side) {
        const bodyBox = el('div', {});
        const formula = el('input', { type: 'text', value: sp.formula, style: { width: '120px' } });
        // 系数：正整数或聚合度 n / 2n（聚合式），用文本输入避免 number 输入吞掉 n
        const coef = el('input', { type: 'text', inputmode: 'numeric', placeholder: '1（聚合式可填 n / 2n / (n-1) / (2n-1)）', value: sp.coefficient || 1, style: { width: '190px' } });
        const state = el('select');
        ['', 's', 'l', 'g', 'aq'].forEach(s => state.append(el('option', {}, s)));
        state.value = sp.state || '';
        const gas = el('input', { type: 'checkbox' }); gas.checked = !!sp.gas;
        const ppt = el('input', { type: 'checkbox' }); ppt.checked = !!sp.precipitate;
        bodyBox.append(el('div', { class: 'check-row' },
          el('label', { class: 'check-item' }, '化学式 ', formula),
          el('label', { class: 'check-item' }, '系数 ', coef),
          el('label', { class: 'check-item' }, '状态 ', state),
          el('label', { class: 'check-item' }, gas, '气体 ↑'),
          el('label', { class: 'check-item' }, ppt, '沉淀 ↓')));
        const note = el('div', { style: { marginTop: '8px', fontSize: '12px', color: 'var(--text-sub)' } },
          '提示：气体 ↑ 与沉淀 ↓ 只能标在生成物；一个生成物不能同时有 ↑ 和 ↓。');
        bodyBox.append(note);
        modal({
          title: '编辑物质', width: 470, body: bodyBox,
          buttons: [
            { text: '取消', value: null },
            {
              text: '确定', onClick: (close) => {
                const cv = String(coef.value).trim();
                let c;
                if (C.isPolymerCoef(cv)) c = cv; // 聚合度 n / 2n / (n-1) / (2n-1)（教材副产物规则）
                else {
                  c = parseInt(cv, 10);
                  if (!Number.isInteger(c) || c <= 0) { toastErr('系数必须为正整数（聚合式可填 n / 2n / (n-1) / (2n-1)）'); return; }
                }
                if (side === 'reactants' && (gas.checked || ppt.checked)) {
                  toastErr('气体/沉淀符号只能标在生成物');
                  return;
                }
                if (gas.checked && ppt.checked) { toastErr('不能同时标注 ↑ 和 ↓'); return; }
                const fp = C.parseFormula(formula.value.trim());
                if (!fp.ok) { toastErr('化学式无法解析：' + fp.error); return; }
                sp.formula = formula.value.trim();
                sp.coefficient = c;
                sp.state = state.value || undefined;
                sp.gas = gas.checked || undefined;
                sp.precipitate = ppt.checked || undefined;
                sp.charge = fp.charge || undefined;
                sp.isElectron = fp.isElectron || undefined;
                close(null);
                renderOnePreview();
                renderSpeciesChips();
              }
            }
          ]
        });
      }
      renderSpeciesChips();
      box.append(speciesWrap);

      // 预览与校验
      const previewBox = el('div', { class: 'eq-preview' });
      const checkBox = el('div', { class: 'check-result' });
      function renderOnePreview() {
        previewBox.innerHTML = C.equationHTML(v) +
          (v.extras && v.extras.deltaH ? `　ΔH = ${C.escapeHtml(v.extras.deltaH)}` : '') +
          (v.extras && v.extras.electrode ? `　（${C.escapeHtml(v.extras.electrode)}）` : '');
        const st = C.validateVersion(v);
        checkBox.innerHTML =
          (st.ok ? '<span class="ok">✓ 校验通过' + (st.warnings.length ? '（有警告）' : '') + '</span>'
            : `<span class="err">✗ ${C.escapeHtml(st.errors.join('；'))}</span>`) +
          (st.warnings.length ? `<div class="warn">⚠ ${C.escapeHtml(st.warnings.join('；'))}</div>` : '');
      }
      renderOnePreview();
      box.append(el('div', { style: { fontSize: '12px', color: 'var(--text-sub)', margin: '8px 0 0' } }, '预览：'), previewBox, checkBox);

      // 添加反应物/生成物
      const addRow = el('div', { class: 'check-row', style: { marginTop: '6px' } });
      const newFormula = el('input', { type: 'text', placeholder: '化学式', style: { width: '110px' } });
      const newSide = el('select');
      newSide.append(el('option', { value: 'reactants' }, '反应物'), el('option', { value: 'products' }, '生成物'));
      addRow.append(newFormula, newSide, el('button', {
        class: 'btn small', onclick: () => {
          const f = newFormula.value.trim();
          if (!f) return;
          const fp = C.parseFormula(f);
          if (!fp.ok) { toastErr('化学式无法解析：' + fp.error); return; }
          v[newSide.value].push({
            formula: f, coefficient: 1,
            charge: fp.charge || undefined, isElectron: fp.isElectron || undefined
          });
          renderOnePreview();
          renderSpeciesChips();
          lineInput.value = C.editorLine(v);
        }
      }, '添加物质'));
      box.append(addRow);

      return box;
    }
  }

  window.EntryEditor = { openEntryEditor, defaultVersion };
})();
