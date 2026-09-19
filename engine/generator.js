/*
 * 随机组卷引擎：范围筛选、版本策略、必出题、题型/难度分配、手动+随机补齐。
 * 依赖：chem.js、constants.js；纯逻辑，浏览器/Node 均可运行。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./chem.js'), require('./constants.js'));
  } else {
    root.Generator = factory(root.Chem, root.Const);
  }
})(typeof self !== 'undefined' ? self : this, function (C, K) {
  'use strict';

  /**
   * 册别分组细化（v2 语义）：
   * 勾了册别 + 章/节时，先判定哪些册被「细化」——册 b 细化 ⇔ 题库中存在
   * 记录 {book: b, chapter ∈ 勾选章} 或 {book: b, section ∈ 勾选节}。
   * 数据驱动（不依赖章节树），初中册（树外）也能细化。
   */
  function refineBooksByScope(entries, filter) {
    const refined = new Set();
    if (!filter || !Array.isArray(filter.books) || !filter.books.length) return refined;
    const chapters = new Set(filter.chapters || []);
    const sections = new Set(filter.sections || []);
    if (!chapters.size && !sections.size) return refined;
    const books = new Set(filter.books);
    for (const e of (entries || [])) {
      for (const t of (e.textbooks || [])) {
        if (!books.has(t.book)) continue;
        if (chapters.has(t.chapter) || sections.has(t.section)) refined.add(t.book);
      }
    }
    return refined;
  }

  /**
   * 范围匹配（v2 · 册别分组细化）：
   * - 勾了册别：未被章/节细化的册整册生效；被细化的册要求「同一条教材记录」
   *   同时命中 册+章+节（跨记录不误命中）。例：勾「九上+九下+必修一+第一章+第一节」
   *   = 九上/九下整册 ∪ 必修一·第一章·第一节（册别各自分组，先前的全局“且”会把
   *   九年级两册整体排除，导致范围越选越少——已修复）。
   * - 未勾册别：章/节保持跨册语义（勾章 = 任意册的该章；章+节同记录命中）。
   * - 其余维度（物质类别/反应类型/模块/标签/难度/版本类型/星标/必出）仍为跨维度“且”。
   * refined：refineBooksByScope 的预计算结果（缺省时无法判定细化册，退化为逐记录匹配）。
   */
  function entryInScope(entry, filter, refined) {
    if (!filter) return true;
    const tbs = entry.textbooks || [];
    const books = filter.books || [];
    const chapters = filter.chapters || [];
    const sections = filter.sections || [];
    if (books.length) {
      const hit = tbs.some(t => {
        if (!books.includes(t.book)) return false;
        // 未细化册：整册生效（章/节条件不作用于该册）
        if (!refined || !refined.has(t.book)) return true;
        // 已细化册：同一条记录命中 章/节（未勾的维度不约束）
        return (!chapters.length || chapters.includes(t.chapter)) &&
          (!sections.length || sections.includes(t.section));
      });
      if (!hit) return false;
    } else {
      // 未勾册别：章+节复合语义（同一条教材记录同时命中，避免跨记录误命中）
      const compound = chapters.length && sections.length;
      if (compound && !tbs.some(t => chapters.includes(t.chapter) && sections.includes(t.section))) {
        return false;
      }
      if (chapters.length && !tbs.some(t => chapters.includes(t.chapter))) return false;
      if (sections.length && !tbs.some(t => sections.includes(t.section))) return false;
    }
    const checks = [
      ['textbookVersions', (v) => tbs.some(t => t.version === v)],
      ['substanceCategories', (v) => (entry.substanceCategories || []).includes(v)],
      ['reactionTypes', (v) => (entry.reactionTypes || []).includes(v)],
      ['knowledgeModules', (v) => (entry.knowledgeModules || []).includes(v)],
      ['tags', (v) => (entry.tags || []).includes(v)],
      ['difficulties', (v) => entry.difficulty === v]
    ];
    for (const [key, test] of checks) {
      const vals = filter[key];
      if (vals && vals.length) {
        if (!vals.some(test)) return false;
      }
    }
    if (filter.starred === true && !entry.starred) return false;
    if (filter.mustInclude === true && !entry.mustInclude) return false;
    if (filter.enabled === false && entry.enabled !== false) return false;
    if (filter.versionTypes && filter.versionTypes.length) {
      const types = (entry.versions || []).map(v => v.type);
      if (!filter.versionTypes.some(t => types.includes(t))) return false;
    }
    return true;
  }

  // 范围内条目（细化册预计算一次；含禁用条目，调用方自行按需过滤）
  function scopedEntries(library, filter) {
    const entries = (library && library.entries) || [];
    if (!filter) return entries.slice();
    const refined = refineBooksByScope(entries, filter);
    return entries.filter(e => entryInScope(e, filter, refined));
  }

  function versionsForEntry(entry, strategy, allowedTypes, scopeTypes) {
    let list = (entry.versions || []).slice();
    if (scopeTypes && scopeTypes.length) list = list.filter(v => scopeTypes.includes(v.type));
    switch (strategy) {
      case 'chemicalOnly': list = list.filter(v => v.type === 'chemical'); break;
      case 'ionicOnly': list = list.filter(v => v.type === 'ionic'); break;
      case 'preferChemical': {
        const chem = list.filter(v => v.type === 'chemical');
        if (chem.length) list = chem;
        break;
      }
      case 'preferIonic': {
        const ion = list.filter(v => v.type === 'ionic');
        if (ion.length) list = ion;
        break;
      }
      case 'custom':
        if (allowedTypes && allowedTypes.length) list = list.filter(v => allowedTypes.includes(v.type));
        break;
      case 'allAvailable':
      default:
        break;
    }
    return list;
  }

  // 筛选器是否有任何生效条件（空筛选器 = 不过滤）
  function scopeFilterActive(filter) {
    if (!filter) return false;
    for (const key of ['textbookVersions', 'books', 'chapters', 'sections', 'substanceCategories',
      'reactionTypes', 'knowledgeModules', 'tags', 'difficulties', 'versionTypes']) {
      const v = filter[key];
      if (Array.isArray(v) && v.length) return true;
    }
    if (filter.starred === true || filter.mustInclude === true || filter.enabled === false) return true;
    return false;
  }

  /**
   * 构建候选（entry × version）
   * opts.projectScope：学习项目出题范围（与 settings.scopes 为 AND，空对象 = 全库）
   */
  function buildCandidates(library, settings, opts) {
    const projectScope = opts && opts.projectScope;
    const entries = (library.entries || []).filter(e => e.enabled !== false);
    // 册别分组细化：三个筛选器各自预计算细化册集合（O(N) × 3）
    const refinedScopes = refineBooksByScope(entries, settings.scopes);
    const refinedProject = projectScope ? refineBooksByScope(entries, projectScope) : null;
    const refinedExclude = refineBooksByScope(entries, settings.exclude);
    const scoped = entries.filter(e => entryInScope(e, settings.scopes, refinedScopes) &&
      (!projectScope || entryInScope(e, projectScope, refinedProject)));
    const excludedIds = new Set();
    if (scopeFilterActive(settings.exclude)) {
      for (const e of entries) {
        if (entryInScope(e, settings.exclude, refinedExclude)) excludedIds.add(e.id);
      }
    }
    const scopeTypes = settings.scopes && settings.scopes.versionTypes;
    const cands = [];
    for (const e of scoped) {
      if (excludedIds.has(e.id)) continue;
      const vs = versionsForEntry(e, settings.versionStrategy, settings.allowedVersionTypes, scopeTypes);
      for (const v of vs) cands.push({ entry: e, version: v });
    }
    return cands;
  }

  function typeSuitable(entry, version, qType) {
    switch (qType) {
      case 'C': return !!(entry.description && entry.description.trim());
      case 'H': return !!(entry.openPrompt && entry.openPrompt.trim());
      default: return true;
    }
  }

  function pickDStrategy(version) {
    const strategies = [];
    if ((version.products || []).length >= 1) strategies.push('blankProducts', 'blankOneProduct');
    if ((version.reactants || []).length >= 2) strategies.push('blankOneReactant');
    const anyCoef = [...(version.reactants || []), ...(version.products || [])].some(sp => sp.coefficient && sp.coefficient !== 1);
    if (anyCoef) strategies.push('blankCoefficients');
    if ((version.conditions || []).length) strategies.push('blankCondition');
    if (!strategies.length) strategies.push('blankProducts');
    return strategies[Math.floor(Math.random() * strategies.length)];
  }

  function makeItem(entry, version, qType) {
    const now = K.nowIso();
    return {
      itemId: K.uid('q'),
      entryId: entry.id,
      versionId: version.id,
      versionType: version.type,
      questionType: qType,
      blankStrategy: qType === 'D' ? pickDStrategy(version) : undefined,
      customPrompt: undefined,
      locked: false,
      showAnswerLine: undefined,
      answerLineHeightPt: undefined,
      pageBreakAfter: false,
      snapshot: {
        entryName: entry.name,
        description: entry.description || '',
        openPrompt: entry.openPrompt || '',
        difficulty: entry.difficulty,
        version: JSON.parse(JSON.stringify(version)),
        entryId: entry.id,
        takenAt: now
      }
    };
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // 题型数量分配。availTypes：当前候选池实际可出题型（随机补足只用可出题型，
  // 否则题库缺 C/H 素材时会随机分到不可出的槽，误报“题目不足”）。
  // prealloc：手动/必出题已占用的题型数量（优先占对应题型槽，防止手动题被随机槽顶替而超总题数）
  function allocateTypes(total, typeCounts, availTypes, prealloc) {
    const types = ['B', 'C', 'D', 'E', 'H'];
    const avail = (availTypes && availTypes.length) ? availTypes : types;
    const fixed = {};
    let fixedSum = 0;
    for (const t of types) {
      const n = Number(typeCounts && typeCounts[t]) || 0;
      if (n > 0) { fixed[t] = n; fixedSum += n; }
    }
    if (fixedSum > total) return { error: '题型数量之和（' + fixedSum + '）超过总题数（' + total + '）' };
    const pre = prealloc || {};
    let preSum = 0;
    for (const t of types) preSum += (pre[t] || 0);
    // 手动/必出题槽：与其题型对应（可超出该题型指定数）；总占用超过 total → 报错
    if (preSum > total) return { error: '手动/必出题数量（' + preSum + '）超过总题数（' + total + '）' };
    const result = {};
    let assigned = 0;
    for (const t of types) {
      const need = pre[t] || 0;
      const have = fixed[t] || 0;
      result[t] = Math.max(need, have); // 手动题优先占对应题型（已有手动题时指定数不足也抬到手动数）
      assigned += result[t];
    }
    if (assigned > total) return { error: '题型数量与手动/必出题之和超过总题数' };
    let free = total - assigned;
    if (free > 0) {
      let pool = types.filter(t => !result[t] && avail.includes(t));
      if (!pool.length) pool = types.filter(t => !result[t]);
      if (!pool.length) pool = types;
      for (let i = 0; i < free; i++) {
        const t = pool[Math.floor(Math.random() * pool.length)];
        result[t] = (result[t] || 0) + 1;
      }
    }
    return { counts: result, autoFilled: free > 0 && (fixedSum > 0 || preSum > 0) };
  }

  // 候选池实际可出的题型：C 需要有文字描述的条目，H 需要有开放题干的条目
  function availableQuestionTypes(candidates) {
    const hasC = candidates.some(c => c.entry.description && String(c.entry.description).trim());
    const hasH = candidates.some(c => c.entry.openPrompt && String(c.entry.openPrompt).trim());
    const avail = ['B', 'D', 'E'];
    if (hasC) avail.push('C');
    if (hasH) avail.push('H');
    return avail;
  }

  // 难度目标序列（软约束）
  function allocateDifficulties(total, settings) {
    const targets = [];
    let c = { simple: 0, medium: 0, hard: 0 };
    if (settings.difficultyMode === 'ratios') {
      const r = settings.difficultyRatios || {};
      const sum = (Number(r.simple) || 0) + (Number(r.medium) || 0) + (Number(r.hard) || 0);
      if (sum > 0) {
        c.simple = Math.round(total * (r.simple / sum));
        c.medium = Math.round(total * (r.medium / sum));
        c.hard = total - c.simple - c.medium;
      }
    } else {
      const d = settings.difficultyCounts || {};
      const sum = (Number(d.simple) || 0) + (Number(d.medium) || 0) + (Number(d.hard) || 0);
      if (sum > 0) {
        if (sum !== total) {
          // 按比例缩放到总数
          c.simple = Math.round(total * d.simple / sum);
          c.medium = Math.round(total * d.medium / sum);
          c.hard = total - c.simple - c.medium;
        } else {
          c = { simple: d.simple, medium: d.medium, hard: d.hard };
        }
      }
    }
    for (const [k, label] of [['simple', '简单'], ['medium', '中等'], ['hard', '较难']]) {
      for (let i = 0; i < c[k]; i++) targets.push(label);
    }
    while (targets.length < total) targets.push(null);
    return shuffle(targets);
  }

  // 学习项目：反应+题型 计数键（versionDupKey + '#' + 题型）
  function pairKey(version, qType) {
    if (!version) return null;
    try { return C.versionDupKey(version) + '#' + qType; } catch (_) { return null; }
  }

  /**
   * 主生成入口。
   * opts（学习项目支持，可选）：
   *   projectScope  项目出题范围（与 settings.scopes AND；空对象 = 全库）
   *   projectCounts 项目计数表 { pairKey: 次数 }
   *   round         当前学习进度（轮数）
   *   allowOverRound true = 允许补充已达标方程式（继续出本轮已出过的）
   * 返回：
   *  { ok: true, items, notices[] }
   *  { ok: false, reason, need, available, message }
   *    reason: 'shortage'（真不足）| 'roundShortage'（轮数限制导致不足，放开限制则够）
   */
  function generate(library, settings, opts) {
    opts = opts || {};
    const notices = [];
    const total = Math.max(1, Number(settings.totalCount) || 1);
    const candidates = buildCandidates(library, settings, opts);
    const roundLimit = opts.projectCounts ? (typeof opts.round === 'number' ? opts.round : 0) : null;
    const allowOverRound = !!opts.allowOverRound;
    const pairCountOf = (version, qType) => {
      if (!opts.projectCounts) return 0;
      const key = pairKey(version, qType);
      return key ? (opts.projectCounts[key] || 0) : 0;
    };

    // 手动选题
    const manualIds = settings.manualEntryIds || [];
    if (manualIds.length > total) {
      return { ok: false, reason: 'manualExceed', message: `手动选择了 ${manualIds.length} 题，超过总题数 ${total}。` };
    }
    const byId = {};
    (library.entries || []).forEach(e => { byId[e.id] = e; });
    const items = [];
    const usedEntryIds = new Set();
    const usedKeys = new Set(); // entryId+versionId

    function tryAdd(entry, version, qType) {
      const key = entry.id + '#' + (version ? version.id : '');
      if (usedKeys.has(key) && !settings.allowDuplicateEntry) return false;
      if (usedEntryIds.has(entry.id) &&
          !settings.allowDuplicateEntry && !settings.allowSameEntryDifferentVersion) return false;
      const item = makeItem(entry, version, qType);
      items.push(item);
      usedKeys.add(key);
      usedEntryIds.add(entry.id);
      return true;
    }

    // 手动/必出题不受轮数限制（教师明确指定 = 意图明确），但超限时加入 notices

    // 1. 必出题（若开启）
    if (settings.includeMustInclude) {
      const must = candidates.filter(c => c.entry.mustInclude);
      const mustEntries = [];
      for (const c of must) {
        if (!mustEntries.includes(c.entry)) mustEntries.push(c.entry);
      }
      if (mustEntries.length > total) {
        return { ok: false, reason: 'mustExceed', message: `必出题（${mustEntries.length} 个）超过总题数（${total}）。` };
      }
      for (const e of mustEntries) {
        const vs = versionsForEntry(e, settings.versionStrategy, settings.allowedVersionTypes,
          settings.scopes && settings.scopes.versionTypes);
        if (!vs.length) { notices.push(`必出题「${e.name}」在当前版本策略下无可用版本，已跳过`); continue; }
        if (roundLimit !== null && !allowOverRound && pairCountOf(vs[0], 'B') > roundLimit) {
          notices.push(`「${e.name}」已达本轮出题上限，仍按指定加入`);
        }
        tryAdd(e, vs[0], 'B');
      }
    }

    // 2. 手动选题
    for (const id of manualIds) {
      const e = byId[id];
      if (!e) { notices.push('手动选题中有条目已不存在，已跳过'); continue; }
      if (usedEntryIds.has(e.id) && !settings.allowDuplicateEntry) { notices.push(`「${e.name}」已在卷中，跳过重复`); continue; }
      const vs = versionsForEntry(e, settings.versionStrategy, settings.allowedVersionTypes,
        settings.scopes && settings.scopes.versionTypes);
      if (!vs.length) { notices.push(`「${e.name}」在当前版本策略下无可用版本，已跳过`); continue; }
      if (roundLimit !== null && !allowOverRound && pairCountOf(vs[0], 'B') > roundLimit) {
        notices.push(`「${e.name}」已达本轮出题上限，仍按指定加入`);
      }
      tryAdd(e, vs[0], 'B');
    }

    // 3. 题型与难度分配（随机补足仅使用候选池可出的题型）
    const availTypes = availableQuestionTypes(candidates);
    // 手动/必出题已占用的槽：与其题型对应（否则手动题被随机槽顶替 → 超总题数）
    const manualTypes = {};
    items.forEach(it => { manualTypes[it.questionType] = (manualTypes[it.questionType] || 0) + 1; });
    const typeAlloc = allocateTypes(total, settings.questionTypeCounts, availTypes, manualTypes);
    if (typeAlloc.error) return { ok: false, reason: 'typeOverflow', message: typeAlloc.error };
    if (typeAlloc.autoFilled) notices.push('题型数量之和小于总题数，已自动用随机题型补足');
    const diffTargets = allocateDifficulties(total, settings);

    // 剩余题槽
    const slots = [];
    for (const [t, n] of Object.entries(typeAlloc.counts)) {
      for (let i = 0; i < n; i++) slots.push({ type: t });
    }
    // 手动/必出题占用对应题型的槽（手动题本身已是终态，不参与随机填充）
    const usedCount = items.length;
    const typeUsed = {};
    items.forEach(it => { typeUsed[it.questionType] = (typeUsed[it.questionType] || 0) + 1; });
    const slotsToFill = [];
    for (const s of slots) {
      if (typeUsed[s.type] > 0) { typeUsed[s.type]--; continue; }
      slotsToFill.push(s);
    }
    // 分配难度目标给待填槽
    const targets = diffTargets.slice(usedCount);

    // 4. 随机填充（某槽填不上时跳过该槽继续，而不是中断整卷）
    //    轮数约束：候选对的计数 > round 时排除（allowOverRound 时不排除）；
    //    低计数优先：合法候选按该槽题型计数升序稳定排序（shuffle 序为随机底序）
    const poolArr = shuffle(candidates);
    // 预计算每个候选的 5 个题型计数（避免重复计算 versionDupKey）
    const cntCache = new Map();
    const countsFor = (c) => {
      let m = cntCache.get(c);
      if (!m) {
        m = {};
        for (const t of ['B', 'C', 'D', 'E', 'H']) m[t] = pairCountOf(c.version, t);
        cntCache.set(c, m);
      }
      return m;
    };
    const overRound = (c, qType) => roundLimit !== null && !allowOverRound && countsFor(c)[qType] > roundLimit;

    let diffDeviated = 0;
    const skippedTypes = {};
    for (let si = 0; si < slotsToFill.length; si++) {
      const slot = slotsToFill[si];
      const targetDiff = targets[si] || null;
      // 槽内合法候选：未用 + 题型适配 + 轮数合法（allowOverRound 时不限）
      let legal = poolArr.filter(c => {
        if (!c) return false;
        if (usedKeys.has(c.entry.id + '#' + c.version.id)) {
          if (!settings.allowDuplicateEntry) return false;
        }
        if (usedEntryIds.has(c.entry.id) && !settings.allowDuplicateEntry &&
            !settings.allowSameEntryDifferentVersion) return false;
        if (!typeSuitable(c.entry, c.version, slot.type)) return false;
        if (overRound(c, slot.type)) return false;
        return true;
      });
      // 未用候选优先（允许重复时，未用候选用尽后才回退到已用候选——
      // 否则低计数稳定排序会把同一道题连刷整卷，重复也失去意义）
      const fresh = legal.filter(c => !usedKeys.has(c.entry.id + '#' + c.version.id));
      const base = fresh.length ? fresh : legal;
      // 低计数优先：按该题型计数升序稳定排序（shuffle 序为随机底序）
      const order = new Map(base.map((c, i) => [c, i]));
      const sorted = base.slice().sort((a, b) =>
        (countsFor(a)[slot.type] - countsFor(b)[slot.type]) || (order.get(a) - order.get(b)));
      let chosen = null;
      if (targetDiff) {
        chosen = sorted.find(c => c.entry.difficulty === targetDiff) || null;
        if (!chosen) { chosen = sorted[0] || null; if (chosen) diffDeviated++; }
      } else {
        chosen = sorted[0] || null;
      }
      // 回退池（未用耗尽 + 允许重复）：随机取，避免同分稳定排序连选同一题
      if (chosen && !fresh.length && settings.allowDuplicateEntry && legal.length > 1) {
        const byDiff = targetDiff ? legal.filter(c => c.entry.difficulty === targetDiff) : [];
        const fbPool = byDiff.length ? byDiff : legal;
        const pick = fbPool[Math.floor(Math.random() * fbPool.length)];
        if (pick !== chosen) {
          chosen = pick;
          if (targetDiff && chosen.entry.difficulty !== targetDiff) diffDeviated++;
        }
      }
      if (!chosen) {
        // 该题型在当前候选中无可用素材（如 C 类需文字描述 / H 类需开放题干 / 轮数已满）
        skippedTypes[slot.type] = (skippedTypes[slot.type] || 0) + 1;
        continue;
      }
      tryAdd(chosen.entry, chosen.version, slot.type);
    }

    const skippedNames = Object.entries(skippedTypes).map(([t, n]) =>
      `${K.QUESTION_TYPES[t] || t} × ${n}（缺${t === 'C' ? '文字描述' : t === 'H' ? '开放题干' : '可用条目'}）`);
    if (skippedNames.length) notices.push('以下题型素材不足已跳过：' + skippedNames.join('、'));

    if (diffDeviated > 0) {
      notices.push(`难度比例无法完全满足，有 ${diffDeviated} 题的难度与设定不同（已尽量接近）`);
    }

    if (items.length < total) {
      // 传了 projectCounts → 先以 allowOverRound=true 模拟填充，判断「放开限制能否凑够」
      if (opts.projectCounts && !allowOverRound) {
        const sim = generate(library, settings, Object.assign({}, opts, { allowOverRound: true }));
        if (sim.ok && sim.items && sim.items.length >= total) {
          return {
            ok: false, reason: 'roundShortage',
            need: total - items.length,
            available: candidates.length,
            availableUnlimited: true,
            message: `范围内未达标的方程式+题型组合已用尽：按当前学习进度（${roundLimit} 轮）只能出 ${items.length} 题，放开轮数限制可出满 ${total} 题。`
          };
        }
      }
      return {
        ok: false, reason: 'shortage',
        need: total - items.length,
        available: candidates.length,
        message: `当前范围内可用题目不足：还需要 ${total - items.length} 题，范围内可用 ${candidates.length} 个候选。`
      };
    }

    // 打乱题序（手动/必出题不强制在前）
    const shuffled = shuffle(items);
    return { ok: true, items: shuffled, notices };
  }

  /** 换一批：保留锁定题，替换其余（opts 透传：换一批同样守轮数） */
  function regenerate(library, settings, keepItems, opts) {
    const locked = keepItems.filter(it => it.locked);
    const lockedEntryIds = new Set(locked.map(it => it.entryId));
    const restSettings = JSON.parse(JSON.stringify(settings));
    restSettings.totalCount = settings.totalCount - locked.length;
    restSettings.manualEntryIds = [];
    restSettings.includeMustInclude = false;
    const result = generate(library, restSettings, opts);
    if (!result.ok) return result;
    const combined = [...locked, ...result.items].sort((a, b) =>
      (a.snapshot.takenAt || '').localeCompare(b.snapshot.takenAt || ''));
    // 排除与锁定题重复
    const seen = new Set();
    const final = [];
    for (const it of combined) {
      const key = it.entryId + '#' + it.versionId;
      if (seen.has(key)) continue;
      seen.add(key);
      final.push(it);
    }
    void lockedEntryIds;
    return { ok: true, items: final, notices: result.notices };
  }

  /** 单题替换：从题库随机换一题（避开已用条目；opts 透传守轮数） */
  function replaceOne(library, settings, usedEntryIds, opts) {
    const candidates = buildCandidates(library, settings, opts);
    const roundLimit = opts && opts.projectCounts ? (typeof opts.round === 'number' ? opts.round : 0) : null;
    const allowOverRound = !!(opts && opts.allowOverRound);
    const avail = candidates.filter(c => {
      if (usedEntryIds.has(c.entry.id)) return false;
      if (roundLimit !== null && !allowOverRound) {
        const key = pairKey(c.version, 'B');
        if (key && (opts.projectCounts[key] || 0) > roundLimit) return false;
      }
      return true;
    });
    const pool = avail.length ? avail : candidates;
    if (!pool.length) return null;
    const c = pool[Math.floor(Math.random() * pool.length)];
    return makeItem(c.entry, c.version, 'B');
  }

  return {
    buildCandidates, entryInScope, refineBooksByScope, scopedEntries, versionsForEntry, generate,
    regenerate, replaceOne, makeItem, pickDStrategy, typeSuitable, availableQuestionTypes,
    pairKey, scopeFilterActive
  };
});
