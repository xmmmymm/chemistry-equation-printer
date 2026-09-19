/*
 * 组卷（阶段 3）——纯 Node，不依赖 DOM。
 *
 * 职责：
 *   1. 调 G.generate(library, settings, opts)   ← opts 全不传（无学习项目挂靠）
 *   2. 组卷后注入 perItemRules（C 题 showAnswerLine:true, answerLineHeightPt:24）
 *   3. 校验 items.length === totalCount，否则按 B1 处理
 *   4. 附加验收（AC-14）：snapshot 核查 + 不满足重抽 ≤1 次
 *   5. 统计：题型实际分布 / 难度实际分布 / 范围命中条目数
 *
 * 规格：PROMPT-方程式出题skill.md §3.3 perItemRules、§3.5 B1/B2/B5、AC-13/AC-14
 *
 * ⚠ 引擎内部会 shuffle（generator.js:428/523）：断言只能按**集合**，不能按顺序。
 */
'use strict';

const path = require('path');
const G = require(path.join(__dirname, 'generator.js'));
const K = require(path.join(__dirname, 'constants.js'));

// ============================================================
// 一、perItemRules 求值（§3.3 的声明式规则，最小可用实现）
// ============================================================

/**
 * 支持的 when 形式：
 *   "item.questionType == 'C'"
 *   "item.questionType != 'B'"
 *   "item.versionType == 'ionic'"
 *   "item.difficulty == '中等'"
 *   "item.entryId == 'R0014'"
 * 也接受结构化形式：{field:'questionType', op:'==', value:'C'}
 */
function evalWhen(item, when) {
  if (!when) return false;
  if (typeof when === 'object') {
    const field = when.field, op = when.op || '==', value = when.value;
    const actual = pickField(item, field);
    return compare(actual, op, value);
  }
  const m = String(when).match(/^\s*item\.([A-Za-z_][\w.]*)\s*(==|!=|>=|<=|>|<)\s*(.+?)\s*$/);
  if (!m) return false;
  const actual = pickField(item, m[1]);
  let value = m[3].trim();
  const q = value.match(/^'(.*)'$|^"(.*)"$/);
  if (q) value = q[1] != null ? q[1] : q[2];
  else if (/^-?\d+(\.\d+)?$/.test(value)) value = Number(value);
  else if (value === 'true') value = true;
  else if (value === 'false') value = false;
  return compare(actual, m[2], value);
}

function pickField(item, field) {
  const snap = item.snapshot || {};
  switch (field) {
    case 'questionType': return item.questionType;
    case 'versionType': return item.versionType;
    case 'entryId': return item.entryId;
    case 'versionId': return item.versionId;
    case 'difficulty': return snap.difficulty;
    case 'entryName': return snap.entryName;
    case 'blankStrategy': return item.blankStrategy;
    default: return undefined;
  }
}

function compare(actual, op, value) {
  switch (op) {
    case '==': return actual === value;
    case '!=': return actual !== value;
    case '>': return Number(actual) > Number(value);
    case '<': return Number(actual) < Number(value);
    case '>=': return Number(actual) >= Number(value);
    case '<=': return Number(actual) <= Number(value);
    default: return false;
  }
}

/** 默认 perItemRules（§3.3）：C 题自动开 24pt 答案线 */
function defaultPerItemRules() {
  return [{ when: "item.questionType == 'C'", set: { showAnswerLine: true, answerLineHeightPt: 24 } }];
}

/**
 * 注入 perItemRules。规则里的 set 允许 `null` 表示显式清空。
 * @returns {{items, applied}} applied: [{rule, count}]
 */
function applyPerItemRules(items, rules) {
  const applied = [];
  (rules || []).forEach((rule, ri) => {
    let count = 0;
    for (const it of items) {
      if (!evalWhen(it, rule.when)) continue;
      for (const [k, v] of Object.entries(rule.set || {})) {
        if (v === null) delete it[k];
        else it[k] = v;
      }
      count++;
    }
    applied.push({ index: ri, when: rule.when, set: rule.set, count });
  });
  return { items, applied };
}

// ============================================================
// 二、附加验收（AC-14）
// ============================================================

/**
 * rule.kind: containsFormula | containsName | difficultyIs | versionTypeIs
 * 支持 rule.formulaPattern（正则字符串）与 rule.value（子串）
 */
function matchAcceptance(item, rule) {
  const snap = item.snapshot || {};
  const v = snap.version || {};
  const value = rule.value;
  switch (rule.kind) {
    case 'containsFormula': {
      const all = [...(v.reactants || []), ...(v.products || [])];
      if (rule.formulaPattern) {
        const re = new RegExp(rule.formulaPattern);
        return all.some((sp) => re.test(String(sp.formula || '')));
      }
      return all.some((sp) => String(sp.formula || '').includes(value));
    }
    case 'containsName':
      return String(snap.entryName || '').includes(value);
    case 'difficultyIs':
      return snap.difficulty === value;
    case 'versionTypeIs':
      return v.type === value;
    default:
      return false;
  }
}

function checkAcceptance(items, rules) {
  return (rules || []).map((rule) => {
    const need = Number(rule.minCount) || 1;
    const matched = items.filter((it) => matchAcceptance(it, rule));
    return {
      label: rule.label || describeRule(rule),
      rule,
      need,
      hits: matched.length,
      ok: matched.length >= need,
      matchedEntryIds: matched.map((it) => it.entryId),
      matchedNames: matched.map((it) => (it.snapshot || {}).entryName || it.entryId)
    };
  });
}

function describeRule(rule) {
  switch (rule.kind) {
    case 'containsFormula': return `含物质 ${rule.value} 的题 ≥ ${rule.minCount || 1} 道`;
    case 'containsName': return `条目名含「${rule.value}」的题 ≥ ${rule.minCount || 1} 道`;
    case 'difficultyIs': return `难度为「${rule.value}」的题 ≥ ${rule.minCount || 1} 道`;
    case 'versionTypeIs': return `版本类型为 ${rule.value} 的题 ≥ ${rule.minCount || 1} 道`;
    default: return '附加要求';
  }
}

// ============================================================
// 三、统计
// ============================================================

function typeActual(items) {
  const out = { B: 0, C: 0, D: 0, E: 0, H: 0 };
  for (const it of items) out[it.questionType] = (out[it.questionType] || 0) + 1;
  return out;
}

function difficultyActual(items) {
  const out = { 简单: 0, 中等: 0, 较难: 0 };
  for (const it of items) {
    const d = (it.snapshot || {}).difficulty || '未标注';
    out[d] = (out[d] || 0) + 1;
  }
  return out;
}

function versionTypeActual(items) {
  const out = {};
  for (const it of items) out[it.versionType] = (out[it.versionType] || 0) + 1;
  return out;
}

function entryIdsOf(items) { return Array.from(new Set(items.map((it) => it.entryId))); }

// ============================================================
// 四、失败原因翻译（§3.5 B1/B2/B3/B4）
// ============================================================

const REASON_LABEL = {
  shortage: '题量不足',
  roundShortage: '学习项目轮数限制导致不足',
  manualExceed: '手动必出数超过总题数',
  mustExceed: '必出题数超过总题数',
  typeOverflow: '题型指定数之和超过总题数'
};

function translateFailure(result, ctx) {
  const reason = result.reason;
  const total = (ctx && ctx.totalCount) || 0;
  const authoritative = ctx && typeof ctx.authoritativeCount === 'number' ? ctx.authoritativeCount : null;
  const base = {
    reason,
    label: REASON_LABEL[reason] || reason,
    message: result.message || '',
    need: result.need,
    available: result.available
  };
  if (reason === 'shortage') {
    base.note = '⚠ 引擎报的 available 是**候选版本数**，不是可出题数；对外报数一律用条目数。'
      + (authoritative != null ? `本次范围可出 ${authoritative} 题（条目数）。` : '');
    base.options = [
      { key: 'reduce', label: `减题量到 ${authoritative != null ? Math.min(authoritative, total) : '可出上限'} 题` },
      { key: 'widen', label: '放宽范围（由老师指定，不自动放宽）' },
      { key: 'strategy', label: '换版本策略（如 allAvailable）' },
      { key: 'allowSameEntryDifferentVersion', label: '允许同条目不同版本（临时开启，上限放宽到候选版本数）' }
    ];
    if (authoritative === 0) {
      base.label = '命中 0 条条目（非版本策略损失）';
    }
  } else if (reason === 'roundShortage') {
    base.note = '（本项目不应出现，请检查 opts：本 skill 恒不传 projectScope/projectCounts/round）';
  } else if (reason === 'manualExceed' || reason === 'mustExceed') {
    base.note = '按 §3.5 B3，应在**复述框阶段**拦截，不进 generate。';
    base.options = ['减少必出题数', '提高总题数', '改「优先但不保证」（本项目不支持）'];
  } else if (reason === 'typeOverflow') {
    base.note = '按 §3.5 B4，应在预检阶段用「等比缩 + 最大余数法」处理，Σ 必须等于总题数。';
  }
  return base;
}

// ============================================================
// 五、组卷主入口
// ============================================================

/**
 * @param {object} library data/library.json
 * @param {object} settings 引擎 generation settings（由 tools/preflight.js buildSettings 产出）
 * @param {object} opts { totalCount, perItemRules, extraAcceptance, maxRedraws, authoritativeCount }
 * @returns {{
 *   ok, items, notices, failures, redraws, perItemRulesApplied,
 *   stats: {requested, produced, typeActual, difficultyActual, versionTypeActual, entryIds, scopesHit},
 *   acceptance: []
 * }}
 */
function generatePaper(library, settings, opts) {
  opts = opts || {};
  const total = Number(opts.totalCount || settings.totalCount) || 10;
  const rules = opts.perItemRules && opts.perItemRules.length ? opts.perItemRules : defaultPerItemRules();
  const maxRedraws = typeof opts.maxRedraws === 'number' ? opts.maxRedraws : 1; // AC-14：重抽 ≤1 次
  const extraAcceptance = opts.extraAcceptance || [];

  // ---- 1. 组卷（opts 全不传）----
  let result = G.generate(library, settings, {});
  if (!result.ok) {
    return {
      ok: false,
      failure: translateFailure(result, { totalCount: total, authoritativeCount: opts.authoritativeCount }),
      items: [],
      notices: [],
      failures: [],
      redraws: 0,
      acceptance: []
    };
  }

  let items = result.items;
  const notices = result.notices.slice();
  const failures = [];
  let redraws = 0;

  // ---- 2. perItemRules ----
  const applied = applyPerItemRules(items, rules);

  // ---- 3. 附加验收（AC-14）：不满足重抽 ≤ maxRedraws 次 ----
  let acceptance = checkAcceptance(items, extraAcceptance);
  let failedRules = acceptance.filter((a) => !a.ok);
  while (failedRules.length && redraws < maxRedraws) {
    redraws++;
    const retry = G.generate(library, settings, {});
    if (!retry.ok) {
      failures.push({ stage: 'redraw', attempt: redraws, reason: retry.reason, message: retry.message });
      break;
    }
    const candidateItems = retry.items;
    const candidateAcceptance = checkAcceptance(candidateItems, extraAcceptance);
    const candidateFailed = candidateAcceptance.filter((a) => !a.ok);
    // 重抽结果更差就不换（按「未满足的规则条数」比较）
    if (candidateFailed.length <= failedRules.length) {
      items = candidateItems;
      acceptance = candidateAcceptance;
      failedRules = candidateFailed;
      notices.push(`附加验收未满足，已重抽第 ${redraws} 次`);
    } else {
      failures.push({ stage: 'redraw', attempt: redraws, reason: 'worse', message: '重抽结果更差，保留原卷' });
      break;
    }
  }
  // 重抽后要重新注入 perItemRules（新 items 是干净对象）
  if (redraws > 0) applyPerItemRules(items, rules);

  // ---- 4. 校验题量 ----
  if (items.length !== total) {
    return {
      ok: false,
      failure: {
        reason: 'shortage',
        label: items.length === 0 ? '命中 0 条条目（非版本策略损失）' : '题量不足',
        message: `请求 ${total} 题，实际只组出 ${items.length} 题。`,
        need: total - items.length,
        note: '⚠ 引擎报的 available 是候选版本数，不是可出题数；对外报数一律用条目数。',
        options: [
          { key: 'reduce', label: `减题量到 ${items.length} 题` },
          { key: 'widen', label: '放宽范围（由老师指定，不自动放宽）' },
          { key: 'strategy', label: '换版本策略（如 allAvailable）' },
          { key: 'allowSameEntryDifferentVersion', label: '允许同条目不同版本（临时开启）' }
        ]
      },
      items,
      notices,
      failures,
      redraws,
      acceptance
    };
  }

  // ---- 5. 统计 ----
  const cands = G.buildCandidates(library, settings, {});
  const scopeEntryIds = new Set(cands.map((c) => c.entry.id));

  return {
    ok: true,
    items,
    notices,
    failures,
    redraws,
    perItemRulesApplied: applied.applied,
    acceptance,
    acceptanceUnmet: acceptance.filter((a) => !a.ok),
    stats: {
      requested: total,
      produced: items.length,
      typeActual: typeActual(items),
      difficultyActual: difficultyActual(items),
      versionTypeActual: versionTypeActual(items),
      entryIds: entryIdsOf(items),
      scopesHit: {
        entries: scopeEntryIds.size,     // ← 条目数口径
        versions: cands.length,          // ← 候选版本数（仅参考）
        books: uniqBooks(items)
      }
    }
  };
}

function uniqBooks(items) {
  const s = new Set();
  for (const it of items) {
    for (const t of ((it.snapshot || {}).textbooks || [])) if (t.book) s.add(t.book);
  }
  return Array.from(s);
}

/** items.json 中间产物（人可读，§7 坑 9：不要用 .md 当 Word/PDF 上游） */
function toItemsJson(items) {
  return items.map((it, i) => ({
    no: i + 1,
    itemId: it.itemId,
    entryId: it.entryId,
    entryName: (it.snapshot || {}).entryName,
    questionType: it.questionType,
    versionType: it.versionType,
    versionLabel: (it.snapshot || {}).version ? (it.snapshot.version.label || '') : '',
    difficulty: (it.snapshot || {}).difficulty,
    showAnswerLine: it.showAnswerLine != null ? it.showAnswerLine : null,
    answerLineHeightPt: it.answerLineHeightPt != null ? it.answerLineHeightPt : null,
    equationUnicode: equationUnicode(it)
  }));
}

/** 用引擎 chem.js 出纯文本方程式（能出 "2H₂ =点燃= 2H₂O"） */
function equationUnicode(item) {
  try {
    const C = require(path.join(__dirname, 'chem.js'));
    const v = (item.snapshot || {}).version;
    if (!v) return '';
    if (typeof C.equationUnicodeText === 'function') return C.equationUnicodeText(v);
  } catch (_) {}
  return '';
}

module.exports = {
  generatePaper, applyPerItemRules, evalWhen, defaultPerItemRules,
  checkAcceptance, matchAcceptance, translateFailure,
  typeActual, difficultyActual, versionTypeActual, toItemsJson, equationUnicode,
  REASON_LABEL
};
