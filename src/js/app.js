/* 应用中枢：状态、持久化、路由、统计、学习项目 */
(function () {
  'use strict';
  const { el, toastErr, toastOk, modal } = UI;
  const K = window.Const;

  const App = {
    state: {
      ready: false,
      dataDir: '',
      library: { version: 1, entries: [] },
      classifications: null,
      settings: null,
      trash: { version: 1, entries: [] },
      worksheet: null, // 当前作业
      lastGenSettings: null,
      projects: [],          // 学习项目清单 [{ id, name, scope, createdAt, updatedAt }]
      projectData: null,     // 当前项目运行数据（counts/countedItems/lastGenSettings）
      projectsData: {}       // 全部项目运行数据缓存 pid → data（当前项目与 projectData 同引用）
    },
    views: {},
    currentView: 'library'
  };
  window.App = App;

  // ---------- 持久化 ----------
  App.saveLibrary = async function () {
    this.state.library.updatedAt = K.nowIso();
    await window.bridge.saveData('library.json', this.state.library);
  };
  App.saveClassifications = async function () {
    await window.bridge.saveData('classifications.json', this.state.classifications);
  };
  App.saveSettings = async function () {
    await window.bridge.saveData('settings.json', this.state.settings);
  };
  App.saveTrash = async function () {
    await window.bridge.saveData('trash.json', this.state.trash);
  };

  // ---------- 界面显示：缩放（实时）与主题 ----------
  const UI_ZOOM_MIN = 0.6, UI_ZOOM_MAX = 1.6;
  const clampZoom = (f) => Math.min(UI_ZOOM_MAX, Math.max(UI_ZOOM_MIN, Number(f) || 1));

  // 实时设置界面缩放：更新内存 → IPC 生效（立即可见）→ 防抖持久化 → 广播给设置页滑块
  App.setUiZoom = async function (factor) {
    const z = clampZoom(factor);
    const s = this.state.settings;
    if (!s.ui) s.ui = { zoom: 1 };
    if (s.ui.zoom === z) return z;
    s.ui.zoom = z;
    try { await window.bridge.ui.setZoom(z); } catch (_) { /* 主进程已预置，失败不阻断 */ }
    this.scheduleSaveSettings();
    document.dispatchEvent(new CustomEvent('uizoom', { detail: z }));
    return z;
  };

  App.getUiZoom = function () {
    const s = this.state.settings;
    return clampZoom(s && s.ui && s.ui.zoom);
  };

  // 启动/重载后应用（主进程已在 loadFile 前预设，此处兜底）
  App.applyUiZoom = async function () {
    try { await window.bridge.ui.setZoom(this.getUiZoom()); } catch (_) {}
  };

  // 主题：按 settings.theme.preset 替换 CSS 变量（实时）
  App.applyTheme = function () {
    const presets = K.THEME_PRESETS || {};
    const name = (this.state.settings && this.state.settings.theme && this.state.settings.theme.preset) || 'paper';
    const preset = presets[name] || presets.paper;
    const root = document.documentElement;
    for (const [k, v] of Object.entries(preset.vars)) root.style.setProperty(k, v);
  };

  // 防抖保存设置（滑块拖动/滚轮缩放时避免高频写盘）
  let settingsSaveTimer = null;
  App.scheduleSaveSettings = function (delay) {
    if (settingsSaveTimer) clearTimeout(settingsSaveTimer);
    settingsSaveTimer = setTimeout(() => {
      settingsSaveTimer = null;
      this.saveSettings();
    }, delay || 350);
  };

  // ---------- 题库工具 ----------
  App.getEntry = function (id) {
    return this.state.library.entries.find(e => e.id === id) || null;
  };

  App.newEntry = function () {
    return {
      id: K.uid('R'),
      name: '',
      description: '',
      openPrompt: '',
      difficulty: '中等',
      difficultyReason: '',
      starred: false,
      mustInclude: false,
      enabled: true,
      textbooks: [],
      substanceCategories: [],
      reactionTypes: [],
      knowledgeModules: [],
      tags: [],
      remark: '',
      source: '',
      versions: [],
      questionCount: 0,
      lastUsedAt: '',
      createdAt: K.nowIso(),
      updatedAt: K.nowIso()
    };
  };

  // 删除 → 回收站
  App.deleteEntry = async function (id) {
    const idx = this.state.library.entries.findIndex(e => e.id === id);
    if (idx < 0) return;
    const [entry] = this.state.library.entries.splice(idx, 1);
    entry._deletedAt = K.nowIso();
    entry._originalId = entry.id;
    this.state.trash.entries.push(entry);
    await Promise.all([this.saveLibrary(), this.saveTrash()]);
    toastOk(`「${entry.name}」已移入回收站`);
  };

  App.restoreEntry = async function (id) {
    const idx = this.state.trash.entries.findIndex(e => e.id === id || e._originalId === id);
    if (idx < 0) return;
    const [entry] = this.state.trash.entries.splice(idx, 1);
    delete entry._deletedAt;
    // 若 id 冲突则换新 id
    if (this.state.library.entries.some(e => e.id === entry.id)) {
      entry.id = K.uid('R');
    }
    this.state.library.entries.push(entry);
    await Promise.all([this.saveLibrary(), this.saveTrash()]);
    toastOk(`「${entry.name}」已恢复到题库`);
  };

  // ---------- 当前作业 ----------
  // 新作业的卷面格式：默认值 ← settings.defaultFont/defaultPaper（「设置→默认卷面格式」）
  App.defaultLayoutFromSettings = function () {
    const layout = K.defaultLayoutSettings();
    const s = this.state.settings || {};
    const p = s.defaultPaper || {};
    if (p.size) layout.paper.size = p.size;
    if (p.orientation) layout.paper.orientation = p.orientation;
    if (p.margins) Object.assign(layout.margins, p.margins);
    const f = s.defaultFont || {};
    if (f.chinese) layout.font.chinese = f.chinese;
    if (f.latin) layout.font.latin = f.latin;
    if (f.titleSizePt) layout.font.titleSizePt = f.titleSizePt;
    if (f.fontSizePt) layout.font.bodySizePt = f.fontSizePt;
    if (f.lineSpacing) layout.spacing.lineSpacing = f.lineSpacing;
    if (f.questionSpacingPt) layout.spacing.questionSpacingPt = f.questionSpacingPt;
    return layout;
  };

  App.newWorksheet = function (items, generationSettings) {
    this.state.worksheet = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      title: '',
      createdAt: K.nowIso(),
      updatedAt: K.nowIso(),
      projectId: this.currentProjectId(), // 归属学习项目
      generationSettings: generationSettings || JSON.parse(JSON.stringify(K.defaultGenerationSettings())),
      layoutSettings: this.defaultLayoutFromSettings(),
      items: items || [],
      exportRecords: [],
      tempEntries: [],
      remark: ''
    };
    this.updateBadge();
  };

  App.updateBadge = function () {
    const badge = document.getElementById('worksheet-badge');
    const n = this.state.worksheet ? this.state.worksheet.items.length : 0;
    badge.textContent = n + ' 题';
  };

  // 出题次数累加（保存历史/导出时调用）
  App.recordUsage = async function (items) {
    const now = K.nowIso();
    for (const item of items) {
      const entry = this.getEntry(item.entryId);
      if (entry) {
        entry.questionCount = (entry.questionCount || 0) + 1;
        entry.lastUsedAt = now;
        const v = (entry.versions || []).find(v => v.id === item.versionId) ||
          (entry.versions || []).find(v => v.type === item.versionType);
        if (v) v.questionCount = (v.questionCount || 0) + 1;
      }
    }
    await this.saveLibrary();
  };

  // ---------- 学习项目 ----------
  const QTYPES = ['B', 'C', 'D', 'E', 'H'];

  function normalizeProjectData(d, pid) {
    const base = { version: 1, pid: pid || 'default', counts: {}, countedItems: {}, lastGenSettings: null };
    if (!d || typeof d !== 'object') return base;
    return {
      version: 1,
      pid: d.pid || pid || 'default',
      counts: (d.counts && typeof d.counts === 'object' && !Array.isArray(d.counts)) ? d.counts : {},
      countedItems: (d.countedItems && typeof d.countedItems === 'object' && !Array.isArray(d.countedItems)) ? d.countedItems : {},
      lastGenSettings: (d.lastGenSettings && typeof d.lastGenSettings === 'object') ? d.lastGenSettings : null
    };
  }

  App.currentProjectId = function () {
    const s = this.state.settings || {};
    return (s.learning && s.learning.currentProjectId) || 'default';
  };

  App.currentProject = function () {
    const id = this.currentProjectId();
    const list = this.state.projects || [];
    return list.find(p => p.id === id) ||
      list.find(p => p.id === 'default') ||
      list[0] || { id: 'default', name: '默认项目', scope: {} };
  };

  App.saveProjectData = async function () {
    const d = this.state.projectData;
    if (!d || !d.pid) return;
    await window.bridge.project.saveData(d.pid, d);
  };

  // 切换项目后重载该项目的运行数据（缓存与当前引用同步更新）
  App.loadProjectData = async function (pid) {
    let raw = null;
    try { raw = await window.bridge.project.data(pid); } catch (_) { raw = null; }
    const data = normalizeProjectData(raw, pid);
    this.state.projectsData = this.state.projectsData || {};
    this.state.projectsData[pid] = data;
    this.state.projectData = data;
    return data;
  };

  // 取指定项目的运行数据（优先缓存；未缓存时返回规范化骨架，不写盘）
  App.projectDataFor = function (pid) {
    if (this.state.projectData && this.state.projectData.pid === pid) return this.state.projectData;
    return (this.state.projectsData && this.state.projectsData[pid]) || normalizeProjectData(null, pid);
  };

  // 计数键：反应重复键（versionDupKey）+ '#' + 题型
  App.pairKey = function (version, qType) {
    if (!version) return null;
    try { return window.Chem.versionDupKey(version) + '#' + qType; } catch (_) { return null; }
  };

  App.pairCount = function (version, qType) {
    const key = this.pairKey(version, qType);
    if (!key) return 0;
    const d = this.state.projectData;
    return (d && d.counts && d.counts[key]) || 0;
  };

  /**
   * 项目学习进度（现算不落盘）：
   * round   = 范围内·启用条目·可出题对（typeSuitable）计数的 min（无对 → 0）
   * laggards= 计数 == round 的对数（“落后” = 尚未完成第 round+1 轮的对）
   * pairs   = 对总数
   * 同一反应跨条目/版本按 pairKey 合并（共享计数）。
   */
  App.projectPairStats = function (project) {
    project = project || this.currentProject();
    const Gen = window.Generator;
    const scope = project.scope || {};
    const data = this.projectDataFor(project.id);
    const counts = (data && data.counts) || {};
    const refined = Gen.refineBooksByScope(this.state.library.entries, scope);
    const pairs = new Map();
    for (const e of this.state.library.entries) {
      if (e.enabled === false) continue;
      if (!Gen.entryInScope(e, scope, refined)) continue;
      for (const v of (e.versions || [])) {
        for (const t of QTYPES) {
          if (!Gen.typeSuitable(e, v, t)) continue;
          const key = this.pairKey(v, t);
          if (!key || pairs.has(key)) continue;
          pairs.set(key, counts[key] || 0);
        }
      }
    }
    if (!pairs.size) return { round: 0, laggards: 0, pairs: 0 };
    let round = Infinity, laggards = 0;
    for (const c of pairs.values()) if (c < round) round = c;
    for (const c of pairs.values()) if (c === round) laggards++;
    return { round, laggards, pairs: pairs.size };
  };

  /**
   * 当前学习项目范围的可用分类值（facets）：
   * 「生成作业」范围选择器与「题库管理」侧栏据此只展示项目内实际存在的标签。
   * 教材维度（版本/册/章/节）按「命中范围的教材记录」收敛——例：项目范围=九上+九下时，
   * 条目身上的必修一记录不贡献册别/章/节（必修第一册不会出现在选项里）；
   * 其余维度（物质类别/反应类型/模块/标签/难度/版本类型）按范围内条目取值。
   * 含禁用条目（题库列表可见禁用条目，生成侧自动排除）。
   * 返回 { textbookVersions, books, chapters, sections, substanceCategories,
   *         reactionTypes, knowledgeModules, tags, difficulties, versionTypes }（均为 Set）。
   */
  App.projectFacets = function () {
    const Gen = window.Generator;
    const scope = (this.currentProject() || {}).scope || {};
    const entries = (this.state.library && this.state.library.entries) || [];
    const refined = Gen.refineBooksByScope(entries, scope);
    const f = {
      textbookVersions: new Set(), books: new Set(), chapters: new Set(), sections: new Set(),
      substanceCategories: new Set(), reactionTypes: new Set(), knowledgeModules: new Set(),
      tags: new Set(), difficulties: new Set(), versionTypes: new Set()
    };
    const books = scope.books || [], chapters = scope.chapters || [], sections = scope.sections || [];
    const hasBooks = books.length > 0;
    for (const e of entries) {
      if (!Gen.entryInScope(e, scope, refined)) continue;
      // 教材维度：仅统计命中范围的教材记录（册别分组细化语义下的“项目内位置”）
      for (const t of (e.textbooks || [])) {
        if (hasBooks) {
          if (!books.includes(t.book)) continue;
          if (refined.has(t.book)) {
            if (chapters.length && !chapters.includes(t.chapter)) continue;
            if (sections.length && !sections.includes(t.section)) continue;
          }
        } else {
          if (chapters.length && !chapters.includes(t.chapter)) continue;
          if (sections.length && !sections.includes(t.section)) continue;
        }
        if (t.version) f.textbookVersions.add(t.version);
        if (t.book) f.books.add(t.book);
        if (t.chapter) f.chapters.add(t.chapter);
        if (t.section) f.sections.add(t.section);
      }
      ['substanceCategories', 'reactionTypes', 'knowledgeModules', 'tags'].forEach(k =>
        (e[k] || []).forEach(v => { if (v) f[k].add(v); }));
      if (e.difficulty) f.difficulties.add(e.difficulty);
      (e.versions || []).forEach(v => { if (v.type) f.versionTypes.add(v.type); });
    }
    return f;
  };

  // 条目在当前项目内的出题计数 = 各版本×可出题型对计数的 min（无对 → 0）
  App.entryProjectCount = function (e) {
    const Gen = window.Generator;
    const data = this.state.projectData;
    const counts = (data && data.counts) || {};
    let min = null;
    for (const v of (e.versions || [])) {
      for (const t of QTYPES) {
        if (!Gen.typeSuitable(e, v, t)) continue;
        const key = this.pairKey(v, t);
        if (!key) continue;
        const c = counts[key] || 0;
        if (min === null || c < min) min = c;
      }
    }
    return min === null ? 0 : min;
  };

  // 保存历史/导出时按题去重累计项目计数（itemId 去重；全局 questionCount 行为不变）
  App.recordProjectUsage = async function (worksheet) {
    const w = worksheet || this.state.worksheet;
    if (!w) return 0;
    const pid = w.projectId || 'default';
    if (!(this.state.projects || []).some(p => p.id === pid)) return 0; // 项目不存在则跳过
    const isCurrent = pid === this.currentProjectId();
    let data;
    if (isCurrent && this.state.projectData && this.state.projectData.pid === pid) {
      data = this.state.projectData;
    } else if (this.state.projectsData && this.state.projectsData[pid]) {
      data = this.state.projectsData[pid];
    } else {
      let raw = null;
      try { raw = await window.bridge.project.data(pid); } catch (_) {}
      data = normalizeProjectData(raw, pid);
      this.state.projectsData = this.state.projectsData || {};
      this.state.projectsData[pid] = data;
    }
    let changed = 0;
    for (const item of (w.items || [])) {
      if (!item.itemId || !item.snapshot || !item.snapshot.version) continue;
      if (data.countedItems[item.itemId]) continue; // 同一题已计过
      const key = this.pairKey(item.snapshot.version, item.questionType);
      if (!key) continue;
      data.counts[key] = (data.counts[key] || 0) + 1;
      data.countedItems[item.itemId] = key;
      changed++;
    }
    if (!changed) return 0;
    await window.bridge.project.saveData(pid, data);
    return changed;
  };

  // 手动标记（题库行展开 ± 按钮）：counts 下限 0，不计 countedItems
  App.markPair = async function (version, qType, delta) {
    const d = this.state.projectData;
    if (!d) return 0;
    const key = this.pairKey(version, qType);
    if (!key) return 0;
    const cur = d.counts[key] || 0;
    const next = Math.max(0, cur + (delta || 0));
    if (next === cur) return cur;
    d.counts[key] = next;
    await this.saveProjectData();
    return next;
  };

  /**
   * 切换当前学习项目。内存中有作业时弹窗三选（保存并切换/放弃并切换/取消）。
   * opts.force：跳过确认弹窗（自动化/内部流程用）；opts.keepWorksheet：force 下保留内存作业（不清空）。
   * 返回 true=已切换。
   */
  App.switchProject = async function (pid, opts) {
    if (!(this.state.projects || []).some(p => p.id === pid)) return false;
    if (pid === this.currentProjectId()) return true;
    const hasWs = this.state.worksheet && this.state.worksheet.items.length;
    if (hasWs && !(opts && opts.force)) {
      const choice = await new Promise((resolve) => {
        modal({
          title: '切换学习项目',
          width: 480,
          body: el('div', {},
            `当前有未保存的作业「${this.state.worksheet.title || '未命名'}」（${this.state.worksheet.items.length} 题）。`,
            el('br'),
            '切换项目前请先处理当前作业：'),
          buttons: [
            { text: '保存并切换', class: '', onClick: (close) => close('save') },
            { text: '放弃并切换', class: 'secondary', onClick: (close) => close('discard') },
            { text: '取消', class: 'secondary', value: 'cancel' }
          ],
          onClose: resolve
        });
      });
      if (choice !== 'save' && choice !== 'discard') return false;
      if (choice === 'save') {
        if (typeof App.saveWorksheetHistory === 'function') {
          await App.saveWorksheetHistory(this);
        }
      } else {
        this.state.worksheet = null;
        this.updateBadge();
      }
    }
    this.state.settings.learning = this.state.settings.learning || {};
    this.state.settings.learning.currentProjectId = pid;
    await this.saveSettings();
    await this.loadProjectData(pid);
    const p = this.state.projects.find(x => x.id === pid);
    this.refreshView();
    toastOk(`已切换到学习项目「${p ? p.name : pid}」`);
    return true;
  };

  // 新建项目（创建成功即自动切换；切换弹窗由 switchProject 处理，opts.force 供自动化跳过确认）
  App.createProject = async function (name, scope, opts) {
    const id = K.uid('P').replace(/^P_/, 'P_'); // uid 形如 P_xxx，符合 [A-Za-z0-9_-]
    const now = K.nowIso();
    const p = { id, name: String(name || '未命名项目').trim() || '未命名项目', scope: scope && typeof scope === 'object' ? scope : {}, createdAt: now, updatedAt: now };
    this.state.projects.push(p);
    await window.bridge.projects.save(this.state.projects);
    const switched = await this.switchProject(id, opts);
    if (!switched) { // 用户在切换弹窗点了取消：项目仍保留在清单中，不自动切换
      this.refreshView();
    }
    return { ok: true, project: p, switched };
  };

  App.renameProject = async function (pid, name) {
    const p = this.state.projects.find(x => x.id === pid);
    if (!p) return false;
    p.name = String(name || '').trim() || p.name;
    p.updatedAt = K.nowIso();
    await window.bridge.projects.save(this.state.projects);
    this.refreshView();
    return true;
  };

  App.updateProjectScope = async function (pid, scope) {
    const p = this.state.projects.find(x => x.id === pid);
    if (!p || pid === 'default') return false; // 默认项目范围不可改
    p.scope = scope && typeof scope === 'object' ? scope : {};
    p.updatedAt = K.nowIso();
    await window.bridge.projects.save(this.state.projects);
    this.refreshView();
    return true;
  };

  // 删除项目（二次确认由调用方 UI 完成）：连同计数文件与历史作业；删除当前项目自动切回 default
  // （删除当前项目 = 用户已明确决定，切回 default 不再弹确认；内存作业按「放弃」处理）
  App.deleteProject = async function (pid) {
    if (!pid || pid === 'default') return false;
    const wasCurrent = pid === this.currentProjectId();
    const r = await window.bridge.projects.deleteProject(pid);
    this.state.projects = this.state.projects.filter(p => p.id !== pid);
    if (this.state.projectsData) delete this.state.projectsData[pid];
    if (this.state.projectData && this.state.projectData.pid === pid) {
      // 切回 default：强制（不弹三选），内存作业保留现状（项目删除后原作业不再有项目归属）
      this.state.projectData = null;
    }
    await window.bridge.projects.save(this.state.projects);
    if (wasCurrent) {
      // 内存作业保留（教师仍可另存/导出），仅切换项目归属
      const keepWs = this.state.worksheet;
      await this.switchProject('default', { force: true, keepWorksheet: true });
      this.state.worksheet = keepWs;
      this.updateBadge();
      this.refreshView();
    } else this.refreshView();
    return { ok: true, deleted: (r && r.deleted) || 0 };
  };

  // 当前作业「排除」：立即计数+持久化 → 移除该题 → 按轮数从未达标对随机补 1 题
  App.excludeWorksheetItem = async function (app, idx) {
    app = app || this;
    const C = window.Chem, Gen = window.Generator;
    const w = this.state.worksheet;
    if (!w || !w.items[idx]) return;
    const item = w.items[idx];
    const pid = w.projectId || 'default';
    const project = (this.state.projects || []).find(p => p.id === pid) || null;

    // 无版本快照（异常数据）：仅移除，不计数
    if (!item.snapshot || !item.snapshot.version) {
      w.items.splice(idx, 1);
      this.updateBadge();
      this.refreshView();
      return;
    }

    // 1. 计数 +1 并立即持久化（即使作业最终不保存也计）
    let data = this.projectDataFor(pid);
    if (!this.state.projectsData[pid] || this.state.projectsData[pid] !== data) {
      // 缓存缺失（非当前项目）：从磁盘装载
      let raw = null;
      try { raw = await window.bridge.project.data(pid); } catch (_) {}
      data = normalizeProjectData(raw, pid);
      this.state.projectsData[pid] = data;
    }
    const key = this.pairKey(item.snapshot.version, item.questionType);
    if (key) {
      data.counts[key] = (data.counts[key] || 0) + 1;
      if (item.itemId) data.countedItems[item.itemId] = key;
      await window.bridge.project.saveData(pid, data);
    }

    // 2. 从卷中移除
    w.items.splice(idx, 1);
    this.updateBadge();

    // 3. 随机补 1 题：项目范围内 ∧ 计数 ≤ 轮数 ∧ 反应键不在当前卷中；
    //    优先补当前卷中尚未出现过的题型，其次任意题型
    let replaced = null;
    if (project) {
      const round = this.projectPairStats(project).round;
      const gs = (w.generationSettings && w.generationSettings.totalCount)
        ? w.generationSettings : K.defaultGenerationSettings();
      const usedRk = new Set();
      w.items.forEach(it => {
        if (it.snapshot && it.snapshot.version) {
          try { usedRk.add(C.versionDupKey(it.snapshot.version)); } catch (_) {}
        }
      });
      const typesInSheet = new Set(w.items.map(it => it.questionType));
      const cands = Gen.buildCandidates(this.state.library, gs, { projectScope: project.scope });
      const eligible = [];
      for (const c of cands) {
        let rk = null;
        try { rk = C.versionDupKey(c.version); } catch (_) {}
        if (rk && usedRk.has(rk)) continue;
        const types = QTYPES.filter(t =>
          Gen.typeSuitable(c.entry, c.version, t) && (data.counts[this.pairKey(c.version, t)] || 0) <= round);
        if (types.length) eligible.push({ c, types });
      }
      const tier1 = eligible.filter(e => e.types.some(t => !typesInSheet.has(t)));
      const pool = tier1.length ? tier1 : eligible;
      if (pool.length) {
        const pick = pool[Math.floor(Math.random() * pool.length)];
        const missing = pick.types.filter(t => !typesInSheet.has(t));
        const typePool = missing.length ? missing : pick.types;
        const qType = typePool[Math.floor(Math.random() * typePool.length)];
        replaced = Gen.makeItem(pick.c.entry, pick.c.version, qType);
        w.items.push(replaced);
      }
    }

    this.refreshView();
    if (replaced) {
      toastOk('已排除并标记已出题，已随机补充 1 题');
    } else {
      UI.toast('范围内已无未达标方程式可补，本题已排除（卷少一题）', 'warning', 4500);
    }
  };

  // ---------- 路由 ----------
  // refreshView 重建 DOM 会丢滚动位置，这些选择器命中的容器位置会被保留
  const SCROLL_KEEP_SELECTORS = [
    '.view-library .sidebar',      // 题库筛选面板
    '.lib-table-wrap',             // 题库列表（表格滚动容器）
    '.view-library .detail-area',
    '.ws-items',                   // 当前作业题目列表
    '.ws-preview .frameHolder',    // 卷面预览
    '.view-generate',              // 生成作业整页
    '.view-list-page'              // 历史作业 / 数据管理 / 设置整页
  ];
  App.showView = function (name) {
    this.currentView = name;
    document.querySelectorAll('#main-nav .nav-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.view === name);
    });
    const container = document.getElementById('view-container');
    container.innerHTML = '';
    const view = this.views[name];
    if (view && view.render) view.render(container, this);
  };

  App.refreshView = function () {
    // 重渲染前记录各滚动容器位置，渲染后还原（题库筛选/勾选、作业题目调整后不跳回顶端）
    // 同步还原即可：视图 DOM 与纸张 wrap 的布局尺寸都在 render 内同步确定
    const saved = SCROLL_KEEP_SELECTORS.map(s => {
      const n = document.querySelector(s);
      return n ? { s, t: n.scrollTop, l: n.scrollLeft } : null;
    }).filter(Boolean);
    this.showView(this.currentView);
    for (const { s, t, l } of saved) {
      const n = document.querySelector(s);
      if (n) { n.scrollTop = t; n.scrollLeft = l; }
    }
  };

  // ---------- 启动 ----------
  async function boot() {
    try {
      const init = await window.bridge.init();
      App.state.dataDir = init.dataDir;
      App.state.library = init.library;
      App.state.classifications = init.classifications;
      App.state.settings = init.settings;
      App.state.trash = init.trash;
      App.state.version = init.version || '';
      App.state.defaults = init.defaults || null; // 主进程 DEFAULT_SETTINGS 快照（恢复默认用）
      // 学习项目：清单 + 各项目运行数据（缺文件时给骨架）
      App.state.projects = Array.isArray(init.projects) && init.projects.length
        ? init.projects
        : [{ id: 'default', name: '默认项目', scope: {}, createdAt: '', updatedAt: '' }];
      const pid = init.currentProjectId || 'default';
      const projectsData = {};
      for (const p of App.state.projects) {
        projectsData[p.id] = normalizeProjectData(init.projectsData ? init.projectsData[p.id] : null, p.id);
      }
      if (!projectsData[pid]) projectsData[pid] = normalizeProjectData(null, pid);
      App.state.projectsData = projectsData;
      App.state.projectData = projectsData[pid];
      App.state.ready = true;
    } catch (e) {
      document.getElementById('view-container').innerHTML =
        `<div class="empty-state">数据目录初始化失败：${String(e.message || e)}<br>请检查程序目录的读写权限。</div>`;
      return;
    }

    // 界面缩放与主题（旧 settings.json 无 ui/theme.preset 字段时按默认处理）
    App.applyUiZoom();
    App.applyTheme();

    document.querySelectorAll('#main-nav .nav-btn').forEach(b => {
      b.addEventListener('click', () => App.showView(b.dataset.view));
    });

    // 全局快捷键：Ctrl+= 放大 / Ctrl+- 缩小 / Ctrl+0 重置（与浏览器习惯一致，实时生效）
    document.addEventListener('keydown', (e) => {
      if (!e.ctrlKey || e.altKey || e.metaKey) return;
      const k = e.key;
      if (k === '=' || k === '+') { e.preventDefault(); App.setUiZoom(App.getUiZoom() + 0.1); }
      else if (k === '-') { e.preventDefault(); App.setUiZoom(App.getUiZoom() - 0.1); }
      else if (k === '0') { e.preventDefault(); App.setUiZoom(1); }
    });

    // Ctrl+滚轮 = 界面缩放（页面级实时；卷面预览区内部的 Ctrl+滚轮由 worksheet.js 接管为卷面缩放）
    document.addEventListener('wheel', (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      App.setUiZoom(App.getUiZoom() * (e.deltaY < 0 ? 1.05 : 1 / 1.05));
    }, { passive: false });

    App.showView('library');
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
