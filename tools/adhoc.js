#!/usr/bin/env node
/*
 * ad-hoc 条目：题库外「临时插入」的方程式（只走内存，绝不写盘）。
 *
 * 为什么单独一个模块：
 *   1. `data/library.json` 是本项目自有数据（source of truth），有 sha256 数据锁
 *      （tools/data-lock.js）。临时题**不能**写进题库，否则每次插题都要重新锁定，
 *      且违背「不写回题库」的边界。
 *   2. 引擎 `generate(library, settings, opts)` 只读内存里的 `library.entries`
 *      （engine/generator.js），因此把 ad-hoc 条目**合并进内存副本**即可让整条
 *      组卷管线（范围筛选 / 版本策略 / 题型分配 / 难度配额 / 化学正确性校验）
 *      原样复用，一行都不用重写。
 *
 * 语义（与用户拍板的 A+A 方案一致）：
 *   - **默认不受 scopes 范围约束**：手工给的题 = 点名要出，与 manualEntryIds 同语义。
 *     实现方式 = 把 ad-hoc 条目标记为 `_adHoc`，引擎在 buildCandidates 里放行范围筛选，
 *     同时由 preflight 把它们**钉进 manualEntryIds**（保证一定出现在卷面上）。
 *   - `adHocOptions.enforceScope === true` 时反过来：不钉、正常走范围筛选，
 *     范围外的一律剔除并如实报告（防超纲）。
 *   - **跨卷去重（A+A 的第二个 A）**：本次不做持久化去重；改为在 `.dsh/skill-state/
 *     last-run.json` 里记下用过的 ad-hoc id，下次命中就在报告里提示「上次也用过」。
 *
 * 用法：
 *   node tools/adhoc.js --self-test            # 自检（规范化 / 校验 / 合并）
 *   node tools/adhoc.js --example              # 打印一份可直接粘进 job.json 的样例
 */
'use strict';

const fs = require('fs');
const path = require('path');

const SKILL_ROOT = path.resolve(__dirname, '..');
const K = require(path.join(SKILL_ROOT, 'engine', 'constants.js'));
const Chem = require(path.join(SKILL_ROOT, 'engine', 'chem.js'));

/** ad-hoc 条目 id 前缀（与题库 R#### 不冲突，报告里一眼可辨） */
const ID_PREFIX = 'AD-';
const DEFAULT_DIFFICULTY = '中等';

const VALID_TYPES = K.EQ_TYPES.map((t) => t.code);
const TYPE_LABEL = {};
K.EQ_TYPES.forEach((t) => { TYPE_LABEL[t.code] = t.label; });
const VALID_DIFFICULTIES = K.DIFFICULTIES.slice();
const VALID_QUESTION_TYPES = ['B', 'C', 'D', 'E']; // H 恒不可用（题库 openPrompt 全空）
const VALID_CONDITION_CODES = K.CONDITION_PRESETS.map((c) => c.code);

function asArray(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function str(v) { return v == null ? '' : String(v).trim(); }

function pad3(n) { return String(n).padStart(3, '0'); }

// ============================================================
// 一、规范化
// ============================================================

/** 物种：{formula, coefficient, gas?, precipitate?, isElectron?} */
function normSpecies(raw, where, problems) {
  if (!raw || typeof raw !== 'object') {
    problems.push(`${where}：物种必须是对象（收到 ${JSON.stringify(raw)}）`);
    return null;
  }
  const formula = str(raw.formula);
  if (!formula) {
    problems.push(`${where}：缺少 formula（化学式 / 离子符号）`);
    return null;
  }
  let coef = raw.coefficient;
  if (coef == null || coef === '') coef = 1;
  if (typeof coef === 'string' && /^\d+$/.test(coef.trim())) coef = Number(coef.trim());
  if (!Number.isInteger(coef) || coef <= 0) {
    problems.push(`${where}：化学式「${formula}」的系数必须为正整数（收到 ${JSON.stringify(raw.coefficient)}）`);
    return null;
  }
  const sp = { formula, coefficient: coef };
  if (raw.gas === true) sp.gas = true;
  if (raw.precipitate === true) sp.precipitate = true;
  if (raw.isElectron === true) sp.isElectron = true;
  return sp;
}

/** 条件：{code, text, position?}；也接受裸字符串（自动按 custom 处理） */
function normCondition(raw, where, problems) {
  if (typeof raw === 'string') {
    const text = str(raw);
    if (!text) { problems.push(`${where}：条件文本为空`); return null; }
    return { code: 'custom', text, position: 'auto' };
  }
  if (!raw || typeof raw !== 'object') {
    problems.push(`${where}：条件必须是对象或字符串`);
    return null;
  }
  const text = str(raw.text);
  if (!text) { problems.push(`${where}：条件缺少 text`); return null; }
  let code = str(raw.code) || 'custom';
  if (!VALID_CONDITION_CODES.includes(code)) code = 'custom';
  const out = { code, text };
  if (raw.position) out.position = str(raw.position);
  return out;
}

/** 版本：{id, type, label, reversible, reactants, products, conditions, extras, questionCount} */
function normVersion(raw, entryId, idx, problems, warnings) {
  const where = `${entryId} 版本#${idx + 1}`;
  if (!raw || typeof raw !== 'object') {
    problems.push(`${where}：版本必须是对象`);
    return null;
  }
  const type = str(raw.type);
  if (!VALID_TYPES.includes(type)) {
    problems.push(`${where}：type 必须是 ${VALID_TYPES.join(' / ')} 之一（收到 ${JSON.stringify(raw.type)}）`);
    return null;
  }
  const reactants = asArray(raw.reactants)
    .map((s, i) => normSpecies(s, `${where} 反应物#${i + 1}`, problems)).filter(Boolean);
  const products = asArray(raw.products)
    .map((s, i) => normSpecies(s, `${where} 生成物#${i + 1}`, problems)).filter(Boolean);
  if (!reactants.length) problems.push(`${where}：缺少反应物（reactants 为空）`);
  if (!products.length) problems.push(`${where}：缺少生成物（products 为空）`);

  const conditions = asArray(raw.conditions)
    .map((c, i) => normCondition(c, `${where} 条件#${i + 1}`, problems)).filter(Boolean);

  const vid = str(raw.id) || `${entryId}-${type}`;
  const version = {
    id: vid,
    type,
    label: TYPE_LABEL[type] || type,
    reversible: raw.reversible === true,
    reactants,
    products,
    conditions,
    extras: (raw.extras && typeof raw.extras === 'object') ? raw.extras : {},
    questionCount: Number.isInteger(raw.questionCount) && raw.questionCount > 0 ? raw.questionCount : 1
  };
  return version;
}

/**
 * 规范化一条 ad-hoc 条目。
 * @returns {{entry: object|null, problems: string[], warnings: string[]}}
 */
function normEntry(raw, index, ctx) {
  const problems = [];
  const warnings = [];
  const fallbackName = `临时题 #${index + 1}`;

  if (!raw || typeof raw !== 'object') {
    return { entry: null, problems: [`临时题 #${index + 1}：必须是对象`], warnings };
  }

  const name = str(raw.name) || str(raw.title) || fallbackName;
  if (!str(raw.name) && !str(raw.title)) {
    warnings.push(`临时题 #${index + 1}：未写 name，已用「${fallbackName}」占位（建议补上，复述框与报告都会用到）`);
  }

  // id：允许教师指定，但必须避开题库与本次其它 ad-hoc
  let id = str(raw.id);
  if (id) {
    if (ctx.takenIds.has(id)) {
      return { entry: null, problems: [`临时题「${name}」：id「${id}」已被占用（题库条目或本次另一条临时题），请换一个`], warnings };
    }
  } else {
    id = ctx.nextId();
  }
  ctx.takenIds.add(id);

  const difficulty = str(raw.difficulty) || DEFAULT_DIFFICULTY;
  if (!VALID_DIFFICULTIES.includes(difficulty)) {
    return {
      entry: null,
      problems: [`临时题「${name}」：difficulty 必须是 ${VALID_DIFFICULTIES.join(' / ')} 之一（收到 ${JSON.stringify(raw.difficulty)}）`],
      warnings
    };
  }

  // 题型（钉进 manualEntryIds 时用；不写则默认 B）
  let questionType = str(raw.questionType).toUpperCase() || 'B';
  if (!VALID_QUESTION_TYPES.includes(questionType)) {
    return {
      entry: null,
      problems: [`临时题「${name}」：questionType 必须是 ${VALID_QUESTION_TYPES.join(' / ')} 之一（H 开放题题库无素材，不支持；收到 ${JSON.stringify(raw.questionType)}）`],
      warnings
    };
  }

  const rawVersions = asArray(raw.versions);
  if (!rawVersions.length) {
    return { entry: null, problems: [`临时题「${name}」：缺少 versions（至少要写 1 个方程式版本）`], warnings };
  }

  const versions = [];
  const seenVids = new Set();
  for (let i = 0; i < rawVersions.length; i++) {
    const v = normVersion(rawVersions[i], id, i, problems, warnings);
    if (!v) continue;
    let vid = v.id;
    let n = 2;
    while (seenVids.has(vid)) vid = `${v.id}-${n++}`;
    v.id = vid;
    seenVids.add(vid);
    versions.push(v);
  }
  if (!versions.length) {
    problems.push(`临时题「${name}」：所有版本都不合法，已丢弃`);
    return { entry: null, problems, warnings };
  }

  // 化学正确性：原子守恒 + 电荷守恒（引擎同款校验）
  const goodVersions = [];
  for (const v of versions) {
    let st;
    try { st = Chem.validateVersion(v); }
    catch (e) { problems.push(`临时题「${name}」版本「${v.id}」：校验异常 ${e.message}`); continue; }
    if (!st || st.ok === false) {
      const errs = (st && st.errors) || ['未知错误'];
      problems.push(`临时题「${name}」版本「${v.id}」（${TYPE_LABEL[v.type] || v.type}）：化学校验未通过 —— ${errs.join('；')}`);
      continue;
    }
    if (st.warnings && st.warnings.length) {
      st.warnings.forEach((w) => warnings.push(`临时题「${name}」版本「${v.id}」：${w}`));
    }
    goodVersions.push(v);
  }
  if (!goodVersions.length) {
    problems.push(`临时题「${name}」：没有通过守恒校验的版本，已丢弃`);
    return { entry: null, problems, warnings };
  }

  const description = str(raw.description);
  if (questionType === 'C' && !description) {
    return {
      entry: null,
      problems: [`临时题「${name}」：questionType 为 C（给文字描述写方程式）时必须写 description（文字描述）`],
      warnings
    };
  }

  const entry = {
    id,
    name,
    description,
    openPrompt: '',            // H 恒不可用
    difficulty,
    difficultyReason: str(raw.difficultyReason),
    starred: false,            // 本 skill 不支持 starred（B7）
    mustInclude: false,        // 本 skill 不支持 mustInclude（B7）
    enabled: true,
    textbooks: asArray(raw.textbooks).filter((t) => t && typeof t === 'object'),
    substanceCategories: asArray(raw.substanceCategories).map(str).filter(Boolean),
    reactionTypes: asArray(raw.reactionTypes).map(str).filter(Boolean),
    knowledgeModules: asArray(raw.knowledgeModules).map(str).filter(Boolean),
    tags: asArray(raw.tags).map(str).filter(Boolean),
    remark: str(raw.remark) || '本次临时插入（题库外）',
    source: str(raw.source) || 'ad-hoc',
    versions: goodVersions,
    questionCount: goodVersions.reduce((a, v) => a + (v.questionCount || 1), 0),
    lastUsedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    // ---- 本项目内部标记（不写盘；引擎据此放行范围筛选）----
    _adHoc: true,
    _adHocQuestionType: questionType
  };
  return { entry, problems, warnings };
}

// ============================================================
// 二、批量构建
// ============================================================

/**
 * 把 job.adHocEntries 规范化成引擎可用的条目数组。
 *
 * @param {Array} rawList          job.adHocEntries 原文
 * @param {object} opts
 * @param {object} opts.library    当前题库（用于 id 冲突检测）
 * @param {string} opts.idPrefix   默认 'AD-'
 * @returns {{entries, problems, warnings, summary}}
 */
function buildAdHocEntries(rawList, opts) {
  opts = opts || {};
  const library = opts.library || { entries: [] };
  const prefix = opts.idPrefix || ID_PREFIX;

  const takenIds = new Set((library.entries || []).map((e) => e.id));
  let seq = 0;
  const nextId = () => {
    let id;
    do { seq += 1; id = prefix + pad3(seq); } while (takenIds.has(id));
    return id;
  };

  const entries = [];
  const problems = [];
  const warnings = [];
  const ctx = { takenIds, nextId };

  asArray(rawList).forEach((raw, i) => {
    const r = normEntry(raw, i, ctx);
    r.problems.forEach((p) => problems.push(p));
    r.warnings.forEach((w) => warnings.push(w));
    if (r.entry) entries.push(r.entry);
  });

  const summary = entries.map((e) => ({
    id: e.id,
    name: e.name,
    difficulty: e.difficulty,
    questionType: e._adHocQuestionType,
    versions: e.versions.map((v) => ({ id: v.id, type: v.type, label: v.label }))
  }));

  return { entries, problems, warnings, summary };
}

// ============================================================
// 三、合并进内存题库（不改磁盘）
// ============================================================

/**
 * 返回一个**新的** library 对象（浅拷贝 + entries 追加），
 * 并把本次 ad-hoc 的报告挂在**不可枚举**属性上
 * （不可枚举 → 不会被 JSON.stringify / 展开运算符带进 result.json 或数据锁）。
 */
function mergeLibrary(library, entries, report) {
  const merged = Object.assign({}, library, {
    entries: (library.entries || []).concat(entries || [])
  });
  Object.defineProperty(merged, '__adhoc', {
    value: report || { entries: entries || [] },
    enumerable: false,
    writable: true,
    configurable: true
  });
  return merged;
}

/** 取回挂在 library 上的 ad-hoc 报告（没有则 null） */
function getAdHocReport(library) {
  return (library && library.__adhoc) || null;
}

/**
 * 一步到位：规范化 + 合并。
 * @returns {{library, entries, report, problems, warnings}}
 */
function applyAdHoc(library, rawList, opts) {
  const built = buildAdHocEntries(rawList, Object.assign({ library }, opts || {}));
  const report = {
    requested: asArray(rawList).length,
    accepted: built.entries.length,
    rejected: asArray(rawList).length - built.entries.length,
    entries: built.summary,
    problems: built.problems,
    warnings: built.warnings
  };
  return {
    library: mergeLibrary(library, built.entries, report),
    entries: built.entries,
    report,
    problems: built.problems,
    warnings: built.warnings
  };
}

// ============================================================
// 四、样例
// ============================================================

const EXAMPLE = [
  {
    name: '高锰酸钾与过氧化氢（酸性条件）',
    difficulty: '中等',
    questionType: 'B',
    description: '向酸性高锰酸钾溶液中滴加过氧化氢，紫色褪去并放出能使带火星木条复燃的气体。',
    tags: ['临时补充', '氧化还原'],
    knowledgeModules: ['物质及其变化'],
    reactionTypes: ['氧化还原反应', '离子反应'],
    versions: [
      {
        type: 'ionic',
        reactants: [
          { formula: 'MnO4^-', coefficient: 2 },
          { formula: 'H2O2', coefficient: 5 },
          { formula: 'H+', coefficient: 6 }
        ],
        products: [
          { formula: 'Mn^2+', coefficient: 2 },
          { formula: 'O2', coefficient: 5, gas: true },
          { formula: 'H2O', coefficient: 8 }
        ],
        conditions: []
      }
    ]
  },
  {
    name: '铝热反应（临时补一道化学方程式）',
    difficulty: '较难',
    questionType: 'E',
    versions: [
      {
        type: 'chemical',
        reactants: [
          { formula: 'Al', coefficient: 2 },
          { formula: 'Fe2O3', coefficient: 1 }
        ],
        products: [
          { formula: 'Al2O3', coefficient: 1 },
          { formula: 'Fe', coefficient: 2 }
        ],
        conditions: [{ code: 'highTemperature', text: '高温' }]
      }
    ]
  }
];

// ============================================================
// 五、自检
// ============================================================

function selfTest() {
  const lines = [];
  let pass = 0;
  let fail = 0;
  const check = (name, cond, extra) => {
    if (cond) { pass += 1; lines.push(`  ✓ ${name}`); }
    else { fail += 1; lines.push(`  ✗ ${name}${extra ? '  ← ' + extra : ''}`); }
  };

  const library = { entries: [{ id: 'R0001', name: '占位', versions: [] }] };

  // ---- 1. 合法条目：正常通过 ----
  const ok = applyAdHoc(library, EXAMPLE);
  check('合法条目全部接受（2/2）', ok.entries.length === 2 && ok.problems.length === 0,
    `accepted=${ok.entries.length} problems=${JSON.stringify(ok.problems)}`);
  check('自动分配 AD-### id', ok.entries.every((e) => /^AD-\d{3}$/.test(e.id)),
    ok.entries.map((e) => e.id).join(','));
  check('id 不与题库冲突', !ok.entries.some((e) => e.id === 'R0001'));
  check('标记 _adHoc 与题型', ok.entries[0]._adHoc === true && ok.entries[1]._adHocQuestionType === 'E');
  check('合并后 entries 变长', ok.library.entries.length === 3);
  check('合并对象带不可枚举 __adhoc', ok.library.__adhoc && ok.library.__adhoc.accepted === 2);
  check('__adhoc 不进 JSON（不污染 result.json）', !JSON.stringify(ok.library).includes('__adhoc'));
  check('原 library 未被改动（不写盘语义）', library.entries.length === 1);

  // ---- 2. 化学错误：必须被拒 ----
  const bad = applyAdHoc(library, [{
    name: '配平错误',
    versions: [{
      type: 'chemical',
      reactants: [{ formula: 'H2', coefficient: 2 }, { formula: 'O2', coefficient: 1 }],
      products: [{ formula: 'H2O', coefficient: 1 }]   // 应为 2H2O
    }]
  }]);
  check('原子不守恒 → 拒绝', bad.entries.length === 0 && bad.problems.some((p) => /化学校验未通过/.test(p)),
    JSON.stringify(bad.problems));

  // ---- 3. 电荷不守恒（离子方程式）----
  const badCharge = applyAdHoc(library, [{
    name: '电荷不平',
    versions: [{
      type: 'ionic',
      reactants: [{ formula: 'Fe^2+', coefficient: 1 }],
      products: [{ formula: 'Fe^3+', coefficient: 1 }]
    }]
  }]);
  check('电荷不守恒 → 拒绝', badCharge.entries.length === 0,
    JSON.stringify(badCharge.problems));

  // ---- 4. 字段缺失 / 非法值 ----
  check('缺 versions → 拒绝', applyAdHoc(library, [{ name: '空的' }]).entries.length === 0);
  check('type 非法 → 拒绝',
    applyAdHoc(library, [{ name: 'x', versions: [{ type: 'nope', reactants: [{ formula: 'H2' }], products: [{ formula: 'H2' }] }] }]).entries.length === 0);
  check('difficulty 非法 → 拒绝',
    applyAdHoc(library, [{ name: 'x', difficulty: '超难', versions: [{ type: 'chemical', reactants: [{ formula: 'H2' }], products: [{ formula: 'H2' }] }] }]).entries.length === 0);
  check('系数非正整数 → 拒绝',
    applyAdHoc(library, [{ name: 'x', versions: [{ type: 'chemical', reactants: [{ formula: 'H2', coefficient: 0 }], products: [{ formula: 'H2' }] }] }]).entries.length === 0);
  check('questionType=H → 拒绝（题库无开放题素材）',
    applyAdHoc(library, [{ name: 'x', questionType: 'H', versions: [{ type: 'chemical', reactants: [{ formula: 'H2' }], products: [{ formula: 'H2' }] }] }]).entries.length === 0);
  check('questionType=C 但无 description → 拒绝',
    applyAdHoc(library, [{ name: 'x', questionType: 'C', versions: [{ type: 'chemical', reactants: [{ formula: 'H2' }], products: [{ formula: 'H2' }] }] }]).entries.length === 0);

  // ---- 5. id 冲突 ----
  check('id 与题库冲突 → 拒绝',
    applyAdHoc(library, [{ id: 'R0001', name: 'x', versions: [{ type: 'chemical', reactants: [{ formula: 'H2' }], products: [{ formula: 'H2' }] }] }]).entries.length === 0);
  const dup = applyAdHoc(library, [
    { id: 'AD-900', name: 'a', versions: [{ type: 'chemical', reactants: [{ formula: 'H2' }], products: [{ formula: 'H2' }] }] },
    { id: 'AD-900', name: 'b', versions: [{ type: 'chemical', reactants: [{ formula: 'H2' }], products: [{ formula: 'H2' }] }] }
  ]);
  check('本次两条 id 重复 → 只留第一条', dup.entries.length === 1);

  // ---- 6. 系数写法宽容度 ----
  const coefStr = applyAdHoc(library, [{
    name: '系数写字符串',
    versions: [{
      type: 'chemical',
      reactants: [{ formula: 'H2', coefficient: '2' }, { formula: 'O2', coefficient: '1' }],
      products: [{ formula: 'H2O', coefficient: '2' }]
    }]
  }]);
  check('系数接受字符串数字', coefStr.entries.length === 1 && coefStr.entries[0].versions[0].reactants[0].coefficient === 2);
  const coefOmit = applyAdHoc(library, [{
    name: '省略系数默认 1',
    versions: [{
      type: 'chemical',
      reactants: [{ formula: 'H2' }, { formula: 'Cl2' }],
      products: [{ formula: 'HCl', coefficient: 2 }]
    }]
  }]);
  check('省略系数按 1 处理', coefOmit.entries.length === 1);

  // ---- 7. 条件写法宽容度 ----
  const condStr = applyAdHoc(library, [{
    name: '条件写字符串',
    versions: [{
      type: 'chemical',
      reactants: [{ formula: 'CaCO3', coefficient: 1 }],
      products: [{ formula: 'CaO', coefficient: 1 }, { formula: 'CO2', coefficient: 1 }],
      conditions: ['高温']
    }]
  }]);
  check('条件接受裸字符串', condStr.entries.length === 1 && condStr.entries[0].versions[0].conditions[0].code === 'custom');

  // ---- 8. 多版本 ----
  const multi = applyAdHoc(library, [{
    name: '一个反应两种写法',
    versions: [
      { type: 'chemical', reactants: [{ formula: 'NaOH', coefficient: 1 }, { formula: 'HCl', coefficient: 1 }], products: [{ formula: 'NaCl', coefficient: 1 }, { formula: 'H2O', coefficient: 1 }] },
      { type: 'ionic', reactants: [{ formula: 'OH-', coefficient: 1 }, { formula: 'H+', coefficient: 1 }], products: [{ formula: 'H2O', coefficient: 1 }] }
    ]
  }]);
  check('多版本条目接受', multi.entries.length === 1 && multi.entries[0].versions.length === 2);
  check('多版本 id 不重复', new Set(multi.entries[0].versions.map((v) => v.id)).size === 2);

  // ---- 9. 空输入 ----
  check('空输入 → 空结果', applyAdHoc(library, []).entries.length === 0);
  check('null 输入 → 空结果', applyAdHoc(library, null).entries.length === 0);

  console.log('ad-hoc 条目自检：');
  console.log(lines.join('\n'));
  console.log(`\n结果：通过 ${pass} 项，失败 ${fail} 项${fail === 0 ? ' ✓' : ' ✗'}`);
  return fail === 0 ? 0 : 1;
}

// ============================================================
// 六、CLI
// ============================================================

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) process.exit(selfTest());
  if (args.includes('--example')) {
    console.log(JSON.stringify({ adHocEntries: EXAMPLE, adHocOptions: { enforceScope: false } }, null, 2));
    return;
  }
  console.log('用法：');
  console.log('  node tools/adhoc.js --self-test   自检');
  console.log('  node tools/adhoc.js --example     打印可直接粘进 job.json 的样例');
}

module.exports = {
  ID_PREFIX,
  VALID_TYPES,
  VALID_QUESTION_TYPES,
  EXAMPLE,
  normSpecies,
  normCondition,
  normVersion,
  normEntry,
  buildAdHocEntries,
  mergeLibrary,
  getAdHocReport,
  applyAdHoc
};

if (require.main === module) main();
