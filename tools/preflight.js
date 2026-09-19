#!/usr/bin/env node
/*
 * 预检与归一（阶段 2）——纯 Node，不依赖 Electron / DOM。
 *
 * 职责：
 *   1. 范围归一（B8）：口语 → 引擎枚举（册别简称、章名/节名简称、难度中英、全半角、枚举大小写）
 *   2. 零命中 / 多候选拦截（B6）：列候选让用户选，**禁止自动放宽到全库**
 *   3. 失效 ID 校验（B11）
 *   4. 运行时可出题数：buildCandidates → distinct entry.id 数量（**不是 available 版本数**）
 *   5. 四选项流（B1）与题型等比缩放 + 最大余数（B4）
 *   6. 文件名预览 + 快照信息（供复述框）
 *
 * 用法：
 *   node tools/preflight.js --job <job.json>
 *   node tools/preflight.js --job <job.json> --out <写入归一后 job 的路径>   # 可选：落盘归一后的 job
 *   node tools/preflight.js --self-test                                      # 6 基准场景对照 04-可出题量预检.md
 *
 * job.json 里与预检相关的字段：
 *   generation.scopeInput   : { books:[], chapters:[], sections:[], ... }  口语/简写都可以（数组或字符串）
 *   generation.scopes       : 归一后的范围对象（若已填且 scopeInput 为空，则直接使用）
 *   generation.exclude / excludeInput、manualEntryIds、totalCount、questionTypeCounts、
 *   difficultyCounts、difficultyRatios、versionStrategy、allowedVersionTypes
 *   scenario / export
 *
 * 退出码：0 = 预检通过（可以进复述框）；2 = 有拦截项（B6/B11/B7）；3 = 用法或数据错误
 */
'use strict';

const fs = require('fs');
const path = require('path');

const SKILL_ROOT = path.resolve(__dirname, '..');
const G = require(path.join(SKILL_ROOT, 'engine', 'generator.js'));
const K = require(path.join(SKILL_ROOT, 'engine', 'constants.js'));

// ============================================================
// 一、通用文本归一
// ============================================================

/** 全角 → 半角（ASCII 区）+ 去所有空白 + 中文标点归一 */
function toHalfWidth(s) {
  return String(s == null ? '' : s)
    .replace(/[\uFF01-\uFF5E]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/\u3000/g, ' ');
}

const CN_DIGIT = { 〇: '0', 零: '0', 一: '1', 二: '2', 两: '2', 三: '3', 四: '4', 五: '5', 六: '6', 七: '7', 八: '8', 九: '9', 十: '10' };

/** 中文数字 → 阿拉伯数字（"第一章"→"第1章"；"十"→"10"） */
function cnNumToArabic(s) {
  return String(s == null ? '' : s).replace(/[〇零一二两三四五六七八九十]/g, (c) => CN_DIGIT[c] || c);
}

/** 匹配键：全角转半角 + 中文数字转阿拉伯 + 去空白 + 去连接标点 + 小写 */
function matchKey(s) {
  return cnNumToArabic(toHalfWidth(s))
    .replace(/[\s\u00a0]+/g, '')
    .replace(/[·・\-—_、,，.。:：;；'"'"（）()【】\[\]]/g, '')
    .toLowerCase();
}

/** 取输入为字符串数组 */
function asArray(v) {
  if (v == null || v === '') return [];
  if (Array.isArray(v)) return v.filter((x) => x != null && String(x).trim() !== '');
  return [v];
}

/** 去重 */
function uniq(a) { return Array.from(new Set(a)); }

// ============================================================
// 二、维度索引
// ============================================================

// 册别别名（"必修一" → "必修第一册"）——归一映射表 B8 的实现依据
const BOOK_ALIASES = {
  必修一: '必修第一册', 必修1: '必修第一册', 必修第一册: '必修第一册', 必修第1册: '必修第一册',
  必修二: '必修第二册', 必修2: '必修第二册', 必修第二册: '必修第二册', 必修第2册: '必修第二册',
  选修一: '选择性必修1', 选修1: '选择性必修1', 选必一: '选择性必修1', 选必1: '选择性必修1',
  选择性必修一: '选择性必修1', 选择性必修1: '选择性必修1',
  选修二: '选择性必修2', 选修2: '选择性必修2', 选必二: '选择性必修2', 选必2: '选择性必修2',
  选择性必修二: '选择性必修2', 选择性必修2: '选择性必修2',
  选修三: '选择性必修3', 选修3: '选择性必修3', 选必三: '选择性必修3', 选必3: '选择性必修3',
  选择性必修三: '选择性必修3', 选择性必修3: '选择性必修3',
  九上: '九年级上册', 九年级上: '九年级上册', 九年级上册: '九年级上册', 初三上: '九年级上册',
  九下: '九年级下册', 九年级下: '九年级下册', 九年级下册: '九年级下册', 初三下: '九年级下册'
};

// 难度别名（题库中文 ↔ 引擎键 ↔ 英文口语）
const DIFFICULTY_ALIASES = {
  simple: '简单', easy: '简单', 易: '简单', 容易: '简单', 简单: '简单', 基础: '简单', 低: '简单',
  medium: '中等', normal: '中等', middle: '中等', 中: '中等', 中等: '中等', 一般: '中等', 中档: '中等',
  hard: '较难', difficult: '较难', 难: '较难', 较难: '较难', 困难: '较难', 高: '较难', 拔高: '较难'
};

// 版本类型别名
const VERSION_TYPE_ALIASES = {
  chemical: 'chemical', 化学: 'chemical', 化学方程式: 'chemical',
  ionic: 'ionic', 离子: 'ionic', 离子方程式: 'ionic',
  ionization: 'ionization', 电离: 'ionization', 电离方程式: 'ionization',
  hydrolysis: 'hydrolysis', 水解: 'hydrolysis', 水解方程式: 'hydrolysis',
  electrode: 'electrode', 电极: 'electrode', 电极反应: 'electrode', 电极反应式: 'electrode',
  thermochemical: 'thermochemical', 热化学: 'thermochemical', 热化学方程式: 'thermochemical'
};

const VERSION_STRATEGY_ALIASES = {
  chemicalonly: 'chemicalOnly', 只出化学: 'chemicalOnly', 仅化学: 'chemicalOnly',
  ioniconly: 'ionicOnly', 只出离子: 'ionicOnly', 仅离子: 'ionicOnly',
  preferchemical: 'preferChemical', 优先化学: 'preferChemical',
  preferionic: 'preferIonic', 优先离子: 'preferIonic',
  allavailable: 'allAvailable', 全版本: 'allAvailable', 所有可用版本: 'allAvailable', 全部: 'allAvailable',
  custom: 'custom', 指定: 'custom', 教师指定: 'custom'
};

const SCENARIOS = ['homework', 'timedDrill', 'examPrep'];
const SCENARIO_ALIASES = {
  homework: 'homework', 课后作业: 'homework', 作业: 'homework', 课后: 'homework',
  timeddrill: 'timedDrill', 限时练: 'timedDrill', 课堂限时练: 'timedDrill', 限时: 'timedDrill', 小测: 'timedDrill',
  examprep: 'examPrep', 备考: 'examPrep', 备考练习: 'examPrep', 复习: 'examPrep', 备考练习卷: 'examPrep'
};

/**
 * 构建维度索引。
 * @param {object} library data/library.json
 * @param {object} classifications data/classifications.json
 */
function buildIndex(library, classifications) {
  const cls = classifications || {};
  const entries = (library && library.entries) || [];

  // 册别：以 classifications.books 为权威
  const books = (cls.books || []).slice();

  // 章 / 节：以「题库中真实出现的 book/chapter/section」为权威（数据驱动，含树外的九年级）
  const chapterRecords = []; // {book, chapter}
  const sectionRecords = []; // {book, chapter, section}
  const seenCh = new Set();
  const seenSec = new Set();
  for (const e of entries) {
    for (const t of (e.textbooks || [])) {
      if (!t.book) continue;
      if (t.chapter) {
        const k = t.book + '\u0000' + t.chapter;
        if (!seenCh.has(k)) { seenCh.add(k); chapterRecords.push({ book: t.book, chapter: t.chapter }); }
      }
      if (t.section) {
        const k = t.book + '\u0000' + (t.chapter || '') + '\u0000' + t.section;
        if (!seenSec.has(k)) { seenSec.add(k); sectionRecords.push({ book: t.book, chapter: t.chapter || '', section: t.section }); }
      }
    }
  }

  // 章 / 节：classifications 里补树（题库可能没有某些节的数据）
  for (const [book, chs] of Object.entries(cls.chapters || {})) {
    for (const c of (chs || [])) {
      if (!c || !c.chapter) continue;
      const k = book + '\u0000' + c.chapter;
      if (!seenCh.has(k)) { seenCh.add(k); chapterRecords.push({ book, chapter: c.chapter }); }
      for (const s of (c.sections || [])) {
        const k2 = book + '\u0000' + c.chapter + '\u0000' + s;
        if (!seenSec.has(k2)) { seenSec.add(k2); sectionRecords.push({ book, chapter: c.chapter, section: s }); }
      }
    }
  }

  const dim = (values) => {
    const byKey = new Map();
    for (const v of values) {
      const k = matchKey(v);
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k).push(v);
    }
    return { values: values.slice(), byKey };
  };

  return {
    library, classifications: cls, entries,
    books,
    bookDim: dim(books),
    chapterRecords,
    sectionRecords,
    substanceCategories: dim(cls.substanceCategories || []),
    reactionTypes: dim(cls.reactionTypes || []),
    knowledgeModules: dim(cls.knowledgeModules || []),
    tags: dim(cls.tags || []),
    textbookVersions: dim(cls.textbookVersions || [])
  };
}

// ============================================================
// 三、单维度解析（精确 → 别名 → 唯一子串；多命中 = 歧义）
// ============================================================

/**
 * @returns {{matched: string[], unmatched: string[], ambiguous: Array}}
 */
function resolveDimension(index, rawValues, opts) {
  opts = opts || {};
  const label = opts.label || '值';
  const aliases = opts.aliases || null;
  const narrowing = opts.narrowing || null; // 字符串数组：先按这些值缩小候选
  const records = opts.records || null;     // [{book, chapter, section}] 形式
  const dim = opts.dim || null;             // {values, byKey}
  const outKey = opts.outKey || null;

  const matched = [];
  const unmatched = [];
  const ambiguous = [];

  const allowed = narrowing && narrowing.length
    ? (records || []).filter((r) => narrowing.includes(r.book))
    : (records || null);

  for (const raw of asArray(rawValues)) {
    const token = String(raw).trim();
    if (!token) continue;
    const key = matchKey(token);

    // ① 别名直命中（"必修一"→"必修第一册"、"easy"→"简单"、"离子"→"ionic"…）
    if (aliases) {
      let aliasHit = null;
      for (const [ak, av] of Object.entries(aliases)) {
        if (matchKey(ak) === key) { aliasHit = av; break; }
      }
      if (aliasHit) { matched.push(aliasHit); continue; }
    }

    // ② 记录式维度（章 / 节）
    //    歧义判定按**记录组合**（book+chapter[+section]），不按单个名称：
    //    例如「复习与提高」这个名字本身唯一，但出现在 6 个不同的 册/章 组合里，
    //    引擎语义是「节 = 跨册跨章匹配该节名」，实际范围并不等价，必须让用户选（B6）。
    if (records) {
      const pool = allowed || records;
      const combo = (r) => [r.book, r.chapter || '', r.section || ''].join(' / ');
      let hits = pool.filter((r) => matchKey(r[outKey]) === key);
      if (!hits.length) hits = pool.filter((r) => matchKey(r[outKey]).includes(key) || key.includes(matchKey(r[outKey])));
      const combos = uniq(hits.map(combo));
      if (combos.length === 1) {
        matched.push(hits[0][outKey]);
        if (opts.onHit) hits.forEach((h) => opts.onHit(h));
        if (opts.onResolve) opts.onResolve(token, hits[0]);
      } else if (combos.length === 0) {
        unmatched.push(token);
      } else {
        // 多候选：列候选（B6），**不自动放宽**
        ambiguous.push({ input: token, dimension: label, candidates: combos });
      }
      continue;
    }

    // ③ 枚举式维度
    if (dim) {
      const exact = dim.byKey.get(key);
      if (exact && exact.length) {
        if (exact.length === 1) matched.push(exact[0]);
        else ambiguous.push({ input: token, dimension: label, candidates: exact.slice() });
        continue;
      }
      // 唯一子串匹配
      const partial = dim.values.filter((v) => matchKey(v).includes(key) || key.includes(matchKey(v)));
      if (partial.length === 1) matched.push(partial[0]);
      else if (partial.length === 0) unmatched.push(token);
      else ambiguous.push({ input: token, dimension: label, candidates: partial.slice() });
      continue;
    }

    unmatched.push(token);
  }

  return { matched: uniq(matched), unmatched, ambiguous };
}

// ============================================================
// 四、范围解析
// ============================================================

/**
 * 把 scopeInput（口语）解析成引擎 scopes 对象。
 * @returns {{scopes, mapping, unmatched, ambiguous}}
 */
function resolveScope(index, scopeInput, baseScopes) {
  scopeInput = scopeInput || {};
  const base = baseScopes || {};
  const scopes = {};
  const mapping = [];   // 归一依据（复述框「范围映射结果」）
  const unmatched = [];
  const ambiguous = [];

  const record = (dim, input, output, note) => {
    mapping.push({ dimension: dim, input, resolved: output, note: note || '' });
  };

  // ---- 册别 ----
  const bookRes = resolveDimension(index, scopeInput.books, {
    label: '册别', dim: index.bookDim, aliases: BOOK_ALIASES
  });
  if (bookRes.matched.length) scopes.books = bookRes.matched;
  bookRes.unmatched.forEach((u) => unmatched.push({ dimension: '册别', input: u }));
  bookRes.ambiguous.forEach((a) => ambiguous.push(a));
  asArray(scopeInput.books).forEach((raw) => {
    const hit = bookRes.matched.find((m) => matchKey(BOOK_ALIASES[matchKey(raw)] || raw) === matchKey(m) || matchKey(m) === matchKey(raw));
    if (hit && matchKey(hit) !== matchKey(raw)) record('册别', raw, hit, '简称归一');
    else if (hit) record('册别', raw, hit, '');
  });

  // ---- 章（章名跨册唯一，但允许用户同时给册别缩小范围）----
  const bookNarrow = scopes.books && scopes.books.length ? scopes.books : null;
  const resolvedChapterRecords = [];
  const chRes = resolveDimension(index, scopeInput.chapters, {
    label: '章', records: index.chapterRecords, outKey: 'chapter', narrowing: bookNarrow,
    onResolve: (token, rec) => resolvedChapterRecords.push({ token, rec })
  });
  if (chRes.matched.length) scopes.chapters = chRes.matched;
  chRes.unmatched.forEach((u) => unmatched.push({ dimension: '章', input: u }));
  chRes.ambiguous.forEach((a) => ambiguous.push(a));
  for (const { token, rec } of resolvedChapterRecords) {
    record('章', token, `${rec.book} / ${rec.chapter}`, matchKey(rec.chapter) === matchKey(token) ? '' : '简称归一');
  }

  // ---- 节（需与章配对：同一节名可能属于多章 → 记录组合歧义走 B6）----
  const resolvedSectionRecords = [];
  const secRes = resolveDimension(index, scopeInput.sections, {
    label: '节', records: index.sectionRecords, outKey: 'section', narrowing: bookNarrow,
    onResolve: (token, rec) => resolvedSectionRecords.push({ token, rec })
  });
  if (secRes.matched.length) scopes.sections = secRes.matched;
  secRes.unmatched.forEach((u) => unmatched.push({ dimension: '节', input: u }));
  secRes.ambiguous.forEach((a) => ambiguous.push(a));
  for (const { token, rec } of resolvedSectionRecords) {
    record('节', token, `${rec.book} / ${rec.chapter} / ${rec.section}`,
      matchKey(rec.section) === matchKey(token) ? '' : '简称归一');
    // 节命中时**不**自动把它的章带进范围：保持「用户没勾就不约束」的语义，
    // 避免范围越选越少（引擎侧 册别分组细化 已保证正确性）。
  }

  // ---- 枚举维度（大小写 / 全半角 / 中英归一）----
  const enumDims = [
    ['textbookVersions', '教材版本', index.textbookVersions],
    ['substanceCategories', '物质类别', index.substanceCategories],
    ['reactionTypes', '反应类型', index.reactionTypes],
    ['knowledgeModules', '知识模块', index.knowledgeModules],
    ['tags', '标签', index.tags]
  ];
  for (const [field, label, dim] of enumDims) {
    const res = resolveDimension(index, scopeInput[field], { label, dim });
    if (res.matched.length) scopes[field] = res.matched;
    res.unmatched.forEach((u) => unmatched.push({ dimension: label, input: u }));
    res.ambiguous.forEach((a) => ambiguous.push(a));
    asArray(scopeInput[field]).forEach((raw) => {
      const hit = res.matched.find((m) => matchKey(m) === matchKey(raw));
      if (hit && matchKey(hit) !== matchKey(raw)) record(label, raw, hit, '大小写/全半角归一');
    });
  }

  // ---- 难度（中英归一）----
  const diffRes = resolveDimension(index, scopeInput.difficulties, {
    label: '难度', dim: { values: K.DIFFICULTIES, byKey: new Map(K.DIFFICULTIES.map((d) => [matchKey(d), [d]])) }, aliases: DIFFICULTY_ALIASES
  });
  if (diffRes.matched.length) scopes.difficulties = diffRes.matched;
  diffRes.unmatched.forEach((u) => unmatched.push({ dimension: '难度', input: u }));
  diffRes.ambiguous.forEach((a) => ambiguous.push(a));
  asArray(scopeInput.difficulties).forEach((raw) => {
    const hit = diffRes.matched.find((m) => matchKey(m) === matchKey(raw));
    if (hit && matchKey(hit) !== matchKey(raw)) record('难度', raw, hit, '中英归一');
  });

  // ---- 版本类型 ----
  const vtRes = resolveDimension(index, scopeInput.versionTypes, {
    label: '版本类型', dim: { values: K.EQ_TYPES.map((t) => t.code), byKey: new Map(K.EQ_TYPES.map((t) => [matchKey(t.code), [t.code]])) }, aliases: VERSION_TYPE_ALIASES
  });
  if (vtRes.matched.length) scopes.versionTypes = vtRes.matched;
  vtRes.unmatched.forEach((u) => unmatched.push({ dimension: '版本类型', input: u }));
  vtRes.ambiguous.forEach((a) => ambiguous.push(a));
  asArray(scopeInput.versionTypes).forEach((raw) => {
    const hit = vtRes.matched.find((m) => matchKey(m) === matchKey(raw));
    if (hit && matchKey(hit) !== matchKey(raw)) record('版本类型', raw, hit, '中文归一');
  });

  // ---- 布尔项 ----
  if (scopeInput.starred === true || scopeInput.mustInclude === true) {
    // B7：本 skill 不支持（题库无数据）
    ambiguous.push({
      input: scopeInput.starred === true ? 'starred 星标筛选' : 'mustInclude 必出机制',
      dimension: '不支持的能力',
      candidates: ['本 skill 不支持：题库中 starred / mustInclude 全为 false。starred → 改用 tags 标签筛选；mustInclude → 改用 manualEntryIds 手选必出']
    });
  }

  // ---- 与已填 scopes 合并（scopeInput 优先；两者都有则并集去重）----
  for (const [k, v] of Object.entries(base)) {
    if (v == null) continue;
    if (Array.isArray(v)) {
      if (!v.length) continue;
      scopes[k] = uniq([...(scopes[k] || []), ...v]);
    } else if (!(k in scopes)) {
      scopes[k] = v;
    }
  }

  return { scopes, mapping, unmatched, ambiguous };
}

// ============================================================
// 五、可出题数（条目数权威口径）
// ============================================================

/** 构造引擎可用的完整 generation settings */
function buildSettings(job) {
  const gen = (job && job.generation) || {};
  const d = K.defaultGenerationSettings();
  return Object.assign({}, d, {
    scopes: gen.scopes || {},
    exclude: gen.exclude || {},
    totalCount: Number(gen.totalCount) > 0 ? Number(gen.totalCount) : d.totalCount,
    questionTypeCounts: Object.assign({ B: 0, C: 0, D: 0, E: 0, H: 0 }, gen.questionTypeCounts || {}),
    difficultyMode: gen.difficultyMode || d.difficultyMode,
    difficultyCounts: Object.assign({ simple: 0, medium: 0, hard: 0 }, gen.difficultyCounts || {}),
    difficultyRatios: Object.assign({ simple: 0, medium: 0, hard: 0 }, gen.difficultyRatios || {}),
    versionStrategy: gen.versionStrategy || d.versionStrategy,
    allowedVersionTypes: Array.isArray(gen.allowedVersionTypes) && gen.allowedVersionTypes.length
      ? gen.allowedVersionTypes : d.allowedVersionTypes,
    includeMustInclude: false,
    allowDuplicateEntry: false,
    allowSameEntryDifferentVersion: !!gen.allowSameEntryDifferentVersion,
    manualEntryIds: asArray(gen.manualEntryIds)
  });
}

/**
 * 候选统计。
 * **可出题数 = distinct entry.id 数量**（默认去重口径）；available 是版本数，只作参考。
 */
function candidateStats(library, settings) {
  const cands = G.buildCandidates(library, settings, {});
  const entryIds = new Set();
  for (const c of cands) entryIds.add(c.entry.id);
  return {
    entryCount: entryIds.size,   // ← 对外报数用这个
    versionCount: cands.length,  // ← 引擎 shortage 里的 available 是这一项
    entryIds: Array.from(entryIds),
    availableTypes: G.availableQuestionTypes(cands)
  };
}

/** 版本策略对照表 */
const STRATEGY_ORDER = ['chemicalOnly', 'ionicOnly', 'preferChemical', 'preferIonic', 'allAvailable'];

function strategyTable(library, settings) {
  const rows = [];
  for (const s of STRATEGY_ORDER) {
    const st = Object.assign({}, settings, { versionStrategy: s });
    const stats = candidateStats(library, st);
    rows.push({
      strategy: s,
      label: K.VERSION_STRATEGIES[s] || s,
      entries: stats.entryCount,
      versions: stats.versionCount,
      availableTypes: stats.availableTypes
    });
  }
  return rows;
}

// ============================================================
// 六、题型等比缩放 + 最大余数法（B4）
// ============================================================

/**
 * 题型指定数之和 > 总题数时：等比缩 + 最大余数取整，保证 Σ = total。
 * @returns {{counts, scaled:boolean, before, after}}
 */
function scaleTypeCounts(typeCounts, total) {
  const types = ['B', 'C', 'D', 'E', 'H'];
  const before = {};
  let sum = 0;
  for (const t of types) { before[t] = Number(typeCounts && typeCounts[t]) || 0; sum += before[t]; }
  if (sum <= total || sum === 0) return { counts: before, scaled: false, before, after: before };

  const raw = {};
  const floor = {};
  let floorSum = 0;
  for (const t of types) {
    raw[t] = before[t] * total / sum;
    floor[t] = Math.floor(raw[t]);
    floorSum += floor[t];
  }
  let remainder = total - floorSum;
  // 最大余数法：按小数部分降序补 1；余数相同时按原数量降序（更稳定）
  const order = types.slice().sort((a, b) => {
    const fa = raw[a] - floor[a], fb = raw[b] - floor[b];
    if (Math.abs(fb - fa) > 1e-9) return fb - fa;
    return before[b] - before[a];
  });
  const after = Object.assign({}, floor);
  for (let i = 0; i < remainder && i < order.length; i++) after[order[i]] += 1;
  // 极端情况（types 数量少于余数）循环补
  let guard = 0;
  while (Object.values(after).reduce((a, b) => a + b, 0) < total && guard++ < 1000) {
    for (const t of order) {
      if (Object.values(after).reduce((a, b) => a + b, 0) >= total) break;
      after[t] += 1;
    }
  }
  return { counts: after, scaled: true, before, after };
}

// ============================================================
// 七、手选 ID 校验（B11）
// ============================================================

function validateManualIds(library, ids, settings) {
  const byId = new Map();
  for (const e of (library.entries || [])) byId.set(e.id, e);
  const invalid = [];
  const valid = [];
  for (const raw of asArray(ids)) {
    const id = String(raw).trim();
    if (!id) continue;
    const e = byId.get(id);
    if (!e) { invalid.push({ id, reason: '条目不存在（可能已被删除）' }); continue; }
    if (e.enabled === false) { invalid.push({ id, name: e.name, reason: '条目已被禁用' }); continue; }
    const vs = G.versionsForEntry(e, settings.versionStrategy, settings.allowedVersionTypes,
      settings.scopes && settings.scopes.versionTypes);
    if (!vs.length) {
      invalid.push({
        id, name: e.name,
        reason: `在当前版本策略（${K.VERSION_STRATEGIES[settings.versionStrategy] || settings.versionStrategy}）下无可用版本`
      });
      continue;
    }
    // 是否在范围内
    const refined = G.refineBooksByScope(library.entries, settings.scopes);
    if (settings.scopes && Object.keys(settings.scopes).length && !G.entryInScope(e, settings.scopes, refined)) {
      invalid.push({ id, name: e.name, reason: '不在本次范围内（手选必出**不会**自动放宽范围）' });
      continue;
    }
    valid.push({ id, name: e.name, versionId: vs[0].id, versionType: vs[0].type });
  }
  return { valid, invalid };
}

// ============================================================
// 八、附加验收核查（AC-14）
// ============================================================

/** kind: containsFormula | containsName | difficultyIs | versionTypeIs */
function checkAcceptance(items, rule) {
  const kind = rule.kind;
  const need = Number(rule.minCount) || 1;
  let hits = 0;
  const matchedNames = [];
  for (const it of items) {
    const snap = it.snapshot || {};
    const v = snap.version || {};
    let ok = false;
    if (kind === 'containsFormula') {
      const all = [...(v.reactants || []), ...(v.products || [])];
      ok = all.some((sp) => String(sp.formula || '').replace(/\^\d*[+-]?/g, '').includes(rule.value));
    } else if (kind === 'containsName') {
      ok = String(snap.entryName || '').includes(rule.value);
    } else if (kind === 'difficultyIs') {
      ok = snap.difficulty === rule.value;
    } else if (kind === 'versionTypeIs') {
      ok = v.type === rule.value;
    }
    if (ok) { hits++; matchedNames.push(snap.entryName || it.entryId); }
  }
  return { rule, ok: hits >= need, hits, need, matchedNames };
}

// ============================================================
// 九、文件名预览
// ============================================================

const SCENARIO_LABEL = { homework: 'homework', timedDrill: 'timedDrill', examPrep: 'examPrep' };

function sanitizeName(s) {
  return String(s == null ? '' : s).replace(/[\\/:*?"<>|]/g, '_');
}

function dateStamp(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * 文件名预览。naming.pattern: {yyyy-mm-dd}_{scenario}_{totalCount}题{volumeSuffix}{collisionSuffix}{ext}
 * 会做一次实际存在性探测（避让 -2 … -99），但**只是预览**；真正写入时以 app 报告的为准。
 */
function previewFileNames(job, scenario, totalCount, channels) {
  const today = dateStamp(new Date());
  const dir = job.outputDir ? path.resolve(job.outputDir) : path.join(SKILL_ROOT, 'out', today);
  const base = `${today}_${SCENARIO_LABEL[scenario] || scenario}_${totalCount}题`;
  const out = { dir, files: [] };
  const suffixes = { question: '_题目', answer: '_答案' };
  const wanted = [];
  if (channels.pdf) { wanted.push({ ch: 'pdf', role: 'question', ext: '.pdf' }); wanted.push({ ch: 'pdf', role: 'answer', ext: '.pdf' }); }
  if (channels.docx) { wanted.push({ ch: 'docx', role: 'question', ext: '.docx' }); wanted.push({ ch: 'docx', role: 'answer', ext: '.docx' }); }
  if (channels.images) { wanted.push({ ch: 'images', role: 'main', ext: '.png' }); }

  const taken = new Set();
  for (const w of wanted) {
    const suffix = w.role === 'main' ? '' : (suffixes[w.role] || '');
    let name = sanitizeName(base + suffix + w.ext);
    let n = 1;
    while ((taken.has(name) || fs.existsSync(path.join(dir, name))) && n < 100) {
      n += 1;
      name = sanitizeName(base + suffix + '-' + n + w.ext);
    }
    taken.add(name);
    out.files.push({ channel: w.ch, role: w.role, name, path: path.join(dir, name), exists: fs.existsSync(path.join(dir, name)) });
  }
  return out;
}

// ============================================================
// 十、快照信息
// ============================================================

function snapshotInfo(library, driftInfo) {
  const metaPath = path.join(SKILL_ROOT, 'data', 'SOURCE.json');
  let meta = null;
  try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch (_) {}
  const versions = ((library && library.entries) || []).reduce((a, e) => a + ((e.versions || []).length), 0);
  return {
    updatedAt: (library && library.updatedAt) || (meta && meta.library && meta.library.updatedAt) || null,
    entries: ((library && library.entries) || []).length,
    versions,
    syncedAt: (meta && meta.syncedAt) || null,
    sha256: (meta && meta.library && meta.library.sha256) || null,
    drift: driftInfo && typeof driftInfo.drift === 'boolean' ? driftInfo.drift : null,
    driftNote: driftInfo && driftInfo.note ? driftInfo.note : ''
  };
}

// ============================================================
// 十一、主预检
// ============================================================

function loadJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

// ============================================================
// 十一·前 冲突链：当次 > 记忆 > 默认（§3.1 决策块 11 / AC-12）
// ============================================================

/** 惰性引用 skill-state，避免循环 require */
function stateModule() {
  try { return require(path.join(__dirname, 'skill-state.js')); } catch (_) { return null; }
}

function isPlainObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }

/**
 * 用记忆补全 job 里**没有显式给出**的字段。
 * 判定「显式给出」：字段存在且非空（scopes 非空对象、questionTypeCounts 之和 > 0、
 * difficulties 有值、totalCount > 0、scenario 非空、versionStrategy 非空且非 'ASK'）。
 *
 * ⚠ 因为 §3.3 的默认值本身就是「空对象 = 全库 / 全 0 = 不指定」，
 *    空值无法与「没填」区分。所以想**明确主张默认值**（例如「这次就是全库，别用上次的范围」）
 *    必须在 job 里写 `"useMemory": false`（或 CLI 加 `--no-memory`）。
 *    这样默认值才永远可被明确主张，冲突链「当次 > 记忆 > 默认」才没有歧义。
 * @returns {{job, memoryReport}}
 */
function applyMemory(job) {
  const S = stateModule();
  if (!S) return { job, memoryReport: { applied: false, reason: 'skill-state 模块不可用' } };
  if (job && job.useMemory === false) {
    return { job: JSON.parse(JSON.stringify(job)), memoryReport: { applied: false, disabled: true, note: 'job.useMemory=false：本次不使用记忆（当次参数即全部）' } };
  }
  const mem = S.memory();
  const last = mem.last || null;
  const used = [];
  const job2 = JSON.parse(JSON.stringify(job || {}));
  job2.generation = job2.generation || {};

  if (!mem.exists || !last) {
    return {
      job: job2,
      memoryReport: {
        applied: false, exists: mem.exists, corrupted: mem.corrupted,
        note: mem.note || '没有上次记录',
        sources: {}
      }
    };
  }

  // 场景
  if (!job2.scenario) { job2.scenario = last.scenario; used.push('scenario'); }
  // 版本策略（'ASK' = 还没问出来）
  const vs = job2.generation.versionStrategy;
  if (!vs || vs === 'ASK') {
    if (last.versionStrategy) { job2.generation.versionStrategy = last.versionStrategy; used.push('versionStrategy'); }
  }
  // 题量
  if (!(Number(job2.generation.totalCount) > 0) && Number(last.totalCount) > 0) {
    job2.generation.totalCount = last.totalCount; used.push('totalCount');
  }
  // 范围（记忆里存的是归一后的 scopes）
  const hasScopeInput = isPlainObj(job2.generation.scopeInput) && Object.keys(job2.generation.scopeInput).length;
  const hasScopes = isPlainObj(job2.generation.scopes) && Object.keys(job2.generation.scopes).length;
  if (!hasScopeInput && !hasScopes && isPlainObj(last.scopes) && Object.keys(last.scopes).length) {
    job2.generation.scopes = JSON.parse(JSON.stringify(last.scopes));
    used.push('scopes');
  }
  // 题型分布
  const tc = job2.generation.questionTypeCounts;
  const tcSum = tc ? ['B', 'C', 'D', 'E', 'H'].reduce((a, t) => a + (Number(tc[t]) || 0), 0) : 0;
  if (tcSum === 0 && last.questionTypeCounts) {
    const ls = ['B', 'C', 'D', 'E', 'H'].reduce((a, t) => a + (Number(last.questionTypeCounts[t]) || 0), 0);
    if (ls > 0) { job2.generation.questionTypeCounts = Object.assign({ B: 0, C: 0, D: 0, E: 0, H: 0 }, last.questionTypeCounts); used.push('questionTypeCounts'); }
  }
  // 难度
  const dc = job2.generation.difficultyCounts;
  const dr = job2.generation.difficultyRatios;
  const dSum = (o) => o ? ['simple', 'medium', 'hard'].reduce((a, k) => a + (Number(o[k]) || 0), 0) : 0;
  if (dSum(dc) === 0 && dSum(dr) === 0 && last.difficulty) {
    const mode = last.difficulty.mode || 'counts';
    const src = mode === 'ratios' ? last.difficulty.ratios : last.difficulty.counts;
    if (dSum(src) > 0) {
      if (mode === 'ratios') job2.generation.difficultyRatios = Object.assign({ simple: 0, medium: 0, hard: 0 }, src);
      else job2.generation.difficultyCounts = Object.assign({ simple: 0, medium: 0, hard: 0 }, src);
      job2.generation.difficultyMode = mode;
      used.push('difficulty');
    }
  }
  // 附加要求模板
  if (!job2.extraAcceptance && last.extraTemplate) { job2.extraAcceptance = last.extraTemplate; used.push('extraAcceptance'); }
  // 导出通道
  if (!job2.export && last.export) { job2.export = JSON.parse(JSON.stringify(last.export)); used.push('export'); }

  return {
    job: job2,
    memoryReport: {
      applied: used.length > 0,
      exists: true,
      corrupted: !!mem.corrupted,
      updatedAt: mem.updatedAt || null,
      usedFields: used,
      note: mem.corrupted
        ? '上次的偏好记录损坏 → 按系统默认 + 一行说明（不阻塞）'
        : (used.length ? '以下字段取自上次记忆：' + used.join('、') : '本次全部字段都由当次指令显式给出（未用记忆）')
    }
  };
}

/**
 * @returns {{ok, exitCode, job, diagnostics, preflight, restate, snapshot}}
 */
function preflight(job, opts) {
  opts = opts || {};
  const library = opts.library || loadJson(path.join(SKILL_ROOT, 'data', 'library.json'));
  const classifications = opts.classifications || loadJson(path.join(SKILL_ROOT, 'data', 'classifications.json'));
  const index = buildIndex(library, classifications);

  // ---- 冲突链：当次 > 记忆 > 默认（可用 --no-memory 关闭）----
  const memRes = opts.memory === false ? { job, memoryReport: { applied: false, note: '已用 --no-memory 关闭记忆' } } : applyMemory(job);
  job = memRes.job;
  const memoryReport = memRes.memoryReport;

  const genIn = job.generation || {};

  // ---- 场景 ----
  let scenario = job.scenario || 'homework';
  const sk = matchKey(scenario);
  if (SCENARIO_ALIASES[sk]) scenario = SCENARIO_ALIASES[sk];
  if (!SCENARIOS.includes(scenario)) scenario = 'homework';

  // ---- 版本策略 ----
  let versionStrategy = genIn.versionStrategy || 'ASK';
  if (versionStrategy !== 'ASK') {
    const vk = matchKey(versionStrategy);
    versionStrategy = VERSION_STRATEGY_ALIASES[vk] || versionStrategy;
  }

  // ---- 范围归一 ----
  const resolved = resolveScope(index, genIn.scopeInput || {}, genIn.scopes || {});
  const resolvedExclude = resolveScope(index, genIn.excludeInput || {}, genIn.exclude || {});

  // ---- 组 settings ----
  const job2 = JSON.parse(JSON.stringify(job));
  job2.scenario = scenario;
  job2.generation = Object.assign({}, genIn);
  job2.generation.scopes = resolved.scopes;
  job2.generation.exclude = resolvedExclude.scopes;
  if (versionStrategy !== 'ASK') job2.generation.versionStrategy = versionStrategy;

  const settings = buildSettings(job2);
  const total = settings.totalCount;

  // ---- 诊断收集 ----
  const diagnostics = {
    unmatched: [...resolved.unmatched, ...resolvedExclude.unmatched],
    ambiguous: [...resolved.ambiguous, ...resolvedExclude.ambiguous],
    invalidManualIds: [],
    blockers: [],   // 必须让用户先决策的项
    warnings: []
  };

  // B7：H 题型恒 0
  if (Number(settings.questionTypeCounts.H) > 0) {
    diagnostics.blockers.push({
      code: 'B7_H_UNAVAILABLE',
      title: 'H 开放题不可用',
      detail: `请求了 ${settings.questionTypeCounts.H} 道 H 开放题，但题库中所有条目的 openPrompt 均为空，H 题型不可出。`,
      suggestion: '改用 C 题型（给文字描述写方程式）——题库 392 条条目全部有文字描述，C 恒可用。',
      options: ['改为 C 题型', '取消开放题要求']
    });
    job2.generation.questionTypeCounts = Object.assign({}, settings.questionTypeCounts, { H: 0 });
    settings.questionTypeCounts.H = 0;
  }

  // B6：范围零命中 / 多候选
  if (diagnostics.ambiguous.length) {
    diagnostics.blockers.push({
      code: 'B6_AMBIGUOUS',
      title: '范围口语有多候选',
      detail: '以下说法能匹配到多个候选，请让老师选一个（不会自动放宽到全库）。',
      items: diagnostics.ambiguous
    });
  }
  if (diagnostics.unmatched.length) {
    diagnostics.blockers.push({
      code: 'B6_UNMATCHED',
      title: '范围口语零命中',
      detail: '以下说法在题库/分类体系里找不到对应项，请让老师换一种说法或从候选里选（不会自动放宽到全库）。',
      items: diagnostics.unmatched,
      hints: {
        册别: index.books,
        章: index.chapterRecords.map((r) => `${r.book} / ${r.chapter}`),
        节: index.sectionRecords.map((r) => `${r.book} / ${r.chapter} / ${r.section}`)
      }
    });
  }

  // B11：手选 ID 校验
  const manual = validateManualIds(library, settings.manualEntryIds, settings);
  diagnostics.invalidManualIds = manual.invalid;
  if (manual.invalid.length) {
    diagnostics.blockers.push({
      code: 'B11_INVALID_MANUAL_ID',
      title: '手选必出中有失效条目',
      detail: '以下手选 ID 不可用，请剔除后再出卷。',
      items: manual.invalid,
      options: ['剔除失效项', '换成题库中其他条目']
    });
  }
  job2.generation.manualEntryIds = manual.valid.map((v) => v.id);

  // B3：manualExceed / mustExceed
  if (manual.valid.length > total) {
    diagnostics.blockers.push({
      code: 'B3_MANUAL_EXCEED',
      title: '手选必出数超过总题数',
      detail: `手选必出 ${manual.valid.length} 题 > 总题数 ${total} 题。`,
      options: [`减到 ${total} 个以内`, `把总题数提到 ${manual.valid.length} 题`, '改「优先但不保证」（本项目不支持，需手工剔除）']
    });
  }

  // B4：typeOverflow → 等比缩 + 最大余数
  const scaled = scaleTypeCounts(job2.generation.questionTypeCounts, total);
  if (scaled.scaled) {
    diagnostics.warnings.push({
      code: 'B4_TYPE_OVERFLOW',
      title: '题型指定数之和超过总题数，已等比缩',
      before: scaled.before,
      after: scaled.after,
      formula: '等比缩 + 最大余数法，保证 Σ = 总题数'
    });
    job2.generation.questionTypeCounts = scaled.after;
    settings.questionTypeCounts = Object.assign({}, scaled.after);
  }

  // ---- 可出题数（条目数权威口径）----
  const current = candidateStats(library, settings);
  const strategies = strategyTable(library, settings);

  const shortage = current.entryCount < total;
  const zeroHit = current.entryCount === 0;

  if (zeroHit || shortage) {
    diagnostics.blockers.push({
      code: zeroHit ? 'B1_ZERO_CANDIDATE' : 'B1_SHORTAGE',
      title: zeroHit ? '命中 0 条条目（非版本策略损失）' : '题量不足',
      detail: zeroHit
        ? `范围「${describeScopes(resolved.scopes)}」+ 版本策略「${K.VERSION_STRATEGIES[settings.versionStrategy] || settings.versionStrategy}」命中 0 条条目。`
        : `范围内最多能出 ${current.entryCount} 题（条目数），请求 ${total} 题，还差 ${total - current.entryCount} 题。`,
      authoritativeCount: current.entryCount,
      requestedCount: total,
      // 四选项流（B1）
      options: [
        { key: 'reduce', label: `减题量到 ${Math.max(0, current.entryCount)} 题`, effect: `totalCount → ${current.entryCount}` },
        { key: 'widen', label: '放宽范围', effect: '去掉部分册/章/节限制（由老师指定，不自动放宽）' },
        { key: 'strategy', label: '换版本策略', effect: '改用对照表里可出题数更多的策略（如 allAvailable）' },
        { key: 'allowSameEntryDifferentVersion', label: '允许同条目不同版本（临时）', effect: `上限放宽到 ${current.versionCount} 个候选版本` }
      ],
      strategyTable: strategies,
      notes: '⚠ 引擎 shortage 里的 available 是**候选版本数**，不是可出题数；对外报数一律用条目数。'
    });
  }

  // ---- 题型分配提示 ----
  const typeNotes = [];
  const explicit = Object.entries(settings.questionTypeCounts).filter(([, n]) => Number(n) > 0);
  if (!explicit.length) typeNotes.push('题型全 0 → 引擎自动用随机题型补足（只从实际可出题型里选）');
  for (const t of ['B', 'C', 'D', 'E', 'H']) {
    const n = Number(settings.questionTypeCounts[t]) || 0;
    if (n > 0 && !current.availableTypes.includes(t)) {
      diagnostics.blockers.push({
        code: 'B1_TYPE_UNAVAILABLE',
        title: `题型 ${t} 在当前候选中不可出`,
        detail: `请求 ${n} 道 ${K.QUESTION_TYPES[t]}，但候选池可出题型只有 ${current.availableTypes.join('/')}。`,
        options: ['换题型', '放宽范围']
      });
    }
  }

  // ---- 附加验收（AC-14）----
  const extra = asArray(job.extraAcceptance);

  // ---- 文件名预览 ----
  const channels = {
    pdf: job.export ? job.export.pdf !== false : true,
    docx: job.export ? job.export.docx !== false : true,
    images: !!(job.export && job.export.images)
  };
  const files = previewFileNames(job2, scenario, total, channels);
  const snap = snapshotInfo(library, job.snapshot);

  const hardBlock = diagnostics.blockers.filter((b) => ['B6_AMBIGUOUS', 'B6_UNMATCHED', 'B11_INVALID_MANUAL_ID', 'B3_MANUAL_EXCEED', 'B7_H_UNAVAILABLE', 'B1_TYPE_UNAVAILABLE'].includes(b.code));
  const softBlock = diagnostics.blockers.filter((b) => ['B1_SHORTAGE', 'B1_ZERO_CANDIDATE'].includes(b.code));

  return {
    ok: diagnostics.blockers.length === 0,
    exitCode: hardBlock.length || softBlock.length ? 2 : 0,
    scenario,
    versionStrategy,
    job: job2,
    diagnostics,
    memoryReport,
    preflight: {
      authoritativeCount: current.entryCount,
      versionCount: current.versionCount,
      requestedCount: total,
      shortage: shortage,
      zeroHit,
      availableTypes: current.availableTypes,
      availableTypesLabel: current.availableTypes.map((t) => `${t} ${K.QUESTION_TYPES[t]}`),
      strategies,
      typeNotes,
      manualValid: manual.valid,
      extraAcceptance: extra,
      scales: scaled.scaled ? { before: scaled.before, after: scaled.after } : null
    },
    restate: {
      scenario,
      scenarioLabel: { homework: '课后作业', timedDrill: '课堂限时练', examPrep: '备考练习' }[scenario],
      totalCount: total,
      questionTypeCounts: settings.questionTypeCounts,
      difficultyMode: settings.difficultyMode,
      difficultyCounts: settings.difficultyCounts,
      versionStrategy: settings.versionStrategy,
      versionStrategyLabel: K.VERSION_STRATEGIES[settings.versionStrategy] || settings.versionStrategy,
      scopeResolved: resolved.scopes,
      scopeMapping: resolved.mapping,
      scopeExclude: resolvedExclude.scopes,
      scopeDescription: describeScopes(resolved.scopes),
      files: files.files,
      outputDir: files.dir,
      snapshot: snap,
      channels
    },
    snapshot: snap
  };
}

/** 范围的中文描述（复述框用） */
function describeScopes(scopes) {
  if (!scopes || !Object.keys(scopes).length) return '全库';
  const parts = [];
  if (scopes.books && scopes.books.length) parts.push('册：' + scopes.books.join('、'));
  if (scopes.chapters && scopes.chapters.length) parts.push('章：' + scopes.chapters.join('、'));
  if (scopes.sections && scopes.sections.length) parts.push('节：' + scopes.sections.join('、'));
  if (scopes.difficulties && scopes.difficulties.length) parts.push('难度：' + scopes.difficulties.join('、'));
  if (scopes.tags && scopes.tags.length) parts.push('标签：' + scopes.tags.join('、'));
  if (scopes.reactionTypes && scopes.reactionTypes.length) parts.push('反应类型：' + scopes.reactionTypes.join('、'));
  if (scopes.substanceCategories && scopes.substanceCategories.length) parts.push('物质类别：' + scopes.substanceCategories.join('、'));
  if (scopes.knowledgeModules && scopes.knowledgeModules.length) parts.push('知识模块：' + scopes.knowledgeModules.join('、'));
  if (scopes.versionTypes && scopes.versionTypes.length) parts.push('版本类型：' + scopes.versionTypes.join('、'));
  return parts.join('；');
}

// ============================================================
// 十二、自检：6 基准场景对照 docs/reference/04-可出题量预检.md
// ============================================================

function selfTest() {
  const library = loadJson(path.join(SKILL_ROOT, 'data', 'library.json'));
  const classifications = loadJson(path.join(SKILL_ROOT, 'data', 'classifications.json'));
  const cases = [
    { name: '全库 · 仅化学', scopes: {}, strategy: 'chemicalOnly', expectEntries: 301, expectVersions: 304 },
    { name: '全库 · 全版本', scopes: {}, strategy: 'allAvailable', expectEntries: 392, expectVersions: 531 },
    { name: '必修第一册/第一章 · 仅化学', scopes: { books: ['必修第一册'], chapters: ['第一章 物质及其变化'] }, strategy: 'chemicalOnly', expectEntries: 45, expectVersions: 45 },
    { name: '必修第一册/第一章/第二节 · 优先化学', scopes: { books: ['必修第一册'], chapters: ['第一章 物质及其变化'], sections: ['第二节 离子反应'] }, strategy: 'preferChemical', expectEntries: 30, expectVersions: 30 },
    { name: '选择性必修2 · 仅化学', scopes: { books: ['选择性必修2'] }, strategy: 'chemicalOnly', expectEntries: 3, expectVersions: 3 },
    { name: '选择性必修3 · 仅离子', scopes: { books: ['选择性必修3'] }, strategy: 'ionicOnly', expectEntries: 0, expectVersions: 0 }
  ];
  let pass = 0;
  const lines = [];
  for (const c of cases) {
    const settings = buildSettings({ generation: { scopes: c.scopes, versionStrategy: c.strategy, totalCount: 10 } });
    const st = candidateStats(library, settings);
    const okE = st.entryCount === c.expectEntries;
    const okV = st.versionCount === c.expectVersions;
    if (okE && okV) pass++;
    lines.push(`${okE && okV ? '✓' : '✗'} ${c.name}：条目数 ${st.entryCount}（期望 ${c.expectEntries}）｜版本数 ${st.versionCount}（期望 ${c.expectVersions}）`);
  }
  console.log('预检基准对照（docs/reference/04-可出题量预检.md）：');
  console.log(lines.join('\n'));
  console.log(`\n结果：${pass}/${cases.length} 一致${pass === cases.length ? ' ✓' : ' ✗'}`);
  return pass === cases.length ? 0 : 1;
}

// ============================================================
// 十三、CLI
// ============================================================

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) process.exit(selfTest());
  const jobArg = args.find((a) => !a.startsWith('--'));
  if (!jobArg) {
    console.error('用法：node tools/preflight.js --job <job.json>');
    console.error('      node tools/preflight.js --self-test');
    process.exit(3);
  }
  const jobPath = path.resolve(jobArg);
  if (!fs.existsSync(jobPath)) { console.error('job.json 不存在：' + jobPath); process.exit(3); }

  let job;
  try { job = JSON.parse(fs.readFileSync(jobPath, 'utf8')); }
  catch (e) { console.error('job.json 解析失败：' + e.message); process.exit(3); }

  let result;
  try { result = preflight(job, { memory: !args.includes('--no-memory') }); }
  catch (e) {
    console.error(JSON.stringify({ ok: false, error: 'PREFLIGHT_FAILED', message: e.message, stack: e.stack }, null, 2));
    process.exit(3);
  }

  const outArgIdx = args.indexOf('--out');
  if (outArgIdx >= 0 && args[outArgIdx + 1]) {
    const outPath = path.resolve(args[outArgIdx + 1]);
    const rel = path.relative(SKILL_ROOT, outPath);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      console.error('拒绝写入 skill 项目之外的路径：' + outPath);
      process.exit(3);
    }
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(result.job, null, 2), 'utf8');
    result.writtenJob = outPath;
  }

  console.log(JSON.stringify(result, null, 2));
  process.exit(result.exitCode);
}

module.exports = {
  preflight, buildIndex, resolveScope, buildSettings, candidateStats, strategyTable,
  scaleTypeCounts, validateManualIds, checkAcceptance, previewFileNames, snapshotInfo,
  describeScopes, matchKey, toHalfWidth, cnNumToArabic, asArray, uniq, applyMemory,
  BOOK_ALIASES, DIFFICULTY_ALIASES, VERSION_TYPE_ALIASES, VERSION_STRATEGY_ALIASES, SCENARIO_ALIASES
};

if (require.main === module) main();
