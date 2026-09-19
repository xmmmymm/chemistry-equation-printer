/*
 * 极小 YAML 子集解析器 + skill 配置装载（纯 Node，无依赖）。
 *
 * 为什么自己写：本项目**不引入任何 npm 依赖**（规格 §边界 3），而 layout.yml / presets.yml
 * 是 skill 内嵌的固定模板，语法用到的只有：
 *   - 块映射（缩进）
 *   - 行内流式映射 {a: 1, b: "x"} 与流式序列 [a, b, c]
 *   - 块序列（"- key: v"）
 *   - 字符串（裸/单引号/双引号）、数字、true/false/null
 *   - 注释（#）与空行
 * 足够覆盖这两个文件，且解析结果可断言（见 tools/config.js 的 selfTest）。
 */
'use strict';

const fs = require('fs');
const path = require('path');

/** 剥掉一行里不在引号内的注释 */
function stripComment(line) {
  let inS = false, inD = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "'" && !inD) inS = !inS;
    else if (c === '"' && !inS) inD = !inD;
    else if (c === '#' && !inS && !inD) return line.slice(0, i);
  }
  return line;
}

/** 按分隔符切分（跳过引号与括号内的分隔符） */
function splitTop(s, seps) {
  const out = [];
  let depth = 0, inS = false, inD = false, cur = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "'" && !inD) inS = !inS;
    else if (c === '"' && !inS) inD = !inD;
    else if (!inS && !inD && (c === '{' || c === '[')) depth++;
    else if (!inS && !inD && (c === '}' || c === ']')) depth--;
    if (!inS && !inD && depth === 0 && seps.includes(c)) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}

/** 找到顶层冒号位置（跳过引号/括号内的冒号） */
function topColon(s) {
  let depth = 0, inS = false, inD = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "'" && !inD) inS = !inS;
    else if (c === '"' && !inS) inD = !inD;
    else if (!inS && !inD && (c === '{' || c === '[')) depth++;
    else if (!inS && !inD && (c === '}' || c === ']')) depth--;
    else if (!inS && !inD && depth === 0 && c === ':') return i;
  }
  return -1;
}

/** 标量：去引号、识别 bool/null/数字，否则当字符串（含 @preset.xxx 占位符） */
function scalar(s) {
  s = String(s).trim();
  if (!s) return '';
  if ((s.startsWith("'") && s.endsWith("'")) || (s.startsWith('"') && s.endsWith('"'))) {
    return s.slice(1, -1).replace(/''/g, "'");
  }
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === 'null' || s === '~') return null;
  if (/^-?\d+$/.test(s)) return parseInt(s, 10);
  if (/^-?\d*\.\d+$/.test(s)) return parseFloat(s);
  return s;
}

/** 解析值：流式映射 / 流式序列 / 标量 */
function parseValue(s) {
  s = String(s).trim();
  if (!s) return '';
  if (s.startsWith('{') && s.endsWith('}')) {
    const inner = s.slice(1, -1).trim();
    if (!inner) return {};
    const o = {};
    for (const part of splitTop(inner, ',')) {
      const p = part.trim();
      if (!p) continue;
      const ci = topColon(p);
      if (ci < 0) continue;
      const k = scalar(p.slice(0, ci));
      o[String(k)] = parseValue(p.slice(ci + 1));
    }
    return o;
  }
  if (s.startsWith('[') && s.endsWith(']')) {
    const inner = s.slice(1, -1).trim();
    if (!inner) return [];
    return splitTop(inner, ',').map((x) => parseValue(x)).filter((x) => x !== '');
  }
  return scalar(s);
}

/**
 * 解析 YAML 子集文本。
 * @returns {object|Array}
 */
function parseYaml(text) {
  const rawLines = String(text == null ? '' : text).replace(/\r\n?/g, '\n').split('\n');
  // 预处理：去注释、去空行、算缩进
  const lines = [];
  for (const raw of rawLines) {
    const noComment = stripComment(raw);
    if (!noComment.trim()) continue;
    const indent = noComment.match(/^[ ]*/)[0].length;
    lines.push({ indent, text: noComment.trim() });
  }
  let pos = 0;

  function parseBlock(minIndent) {
    if (pos >= lines.length) return null;
    const isSeq = lines[pos].text.startsWith('- ') || lines[pos].text === '-';
    if (isSeq) {
      const arr = [];
      while (pos < lines.length && lines[pos].indent >= minIndent && (lines[pos].text.startsWith('- ') || lines[pos].text === '-')) {
        const cur = lines[pos];
        const rest = cur.text === '-' ? '' : cur.text.slice(2).trim();
        pos++;
        if (!rest) {
          // "- " 后跟嵌套块
          const child = (pos < lines.length && lines[pos].indent > cur.indent) ? parseBlock(cur.indent + 1) : null;
          arr.push(child);
          continue;
        }
        const ci = topColon(rest);
        if (ci >= 0) {
          // "- key: value" —— 元素是映射；把同一缩进层级的后续 key 一起收进来
          const obj = {};
          obj[String(scalar(rest.slice(0, ci)))] = parseValue(rest.slice(ci + 1));
          while (pos < lines.length && lines[pos].indent > cur.indent && !lines[pos].text.startsWith('- ')) {
            const l = lines[pos];
            const c2 = topColon(l.text);
            if (c2 < 0) break;
            const k2 = String(scalar(l.text.slice(0, c2)));
            const v2 = l.text.slice(c2 + 1).trim();
            pos++;
            if (!v2) {
              obj[k2] = (pos < lines.length && lines[pos].indent > l.indent) ? parseBlock(l.indent + 1) : null;
            } else {
              obj[k2] = parseValue(v2);
            }
          }
          arr.push(obj);
        } else {
          arr.push(parseValue(rest));
        }
      }
      return arr;
    }
    const obj = {};
    while (pos < lines.length && lines[pos].indent >= minIndent) {
      const l = lines[pos];
      if (l.text.startsWith('- ')) break;
      const ci = topColon(l.text);
      if (ci < 0) { pos++; continue; }
      const key = String(scalar(l.text.slice(0, ci)));
      const vtext = l.text.slice(ci + 1).trim();
      pos++;
      if (!vtext) {
        obj[key] = (pos < lines.length && lines[pos].indent > l.indent) ? parseBlock(l.indent + 1) : null;
      } else {
        obj[key] = parseValue(vtext);
      }
    }
    return obj;
  }

  return parseBlock(0);
}

// ============================================================
// skill 配置装载
// ============================================================

const SKILL_ROOT = path.resolve(__dirname, '..');
const SKILL_DIR = path.join(SKILL_ROOT, '.dsh', 'skills', 'chem-equation-paper');

const K = require(path.join(SKILL_ROOT, 'engine', 'constants.js'));

function readYaml(p) {
  return parseYaml(fs.readFileSync(p, 'utf8'));
}

/**
 * 解析 layout.yml 的占位符：@preset.title / @preset.studentInfoEnabled
 * @param {object} layout
 * @param {object} preset 已合并的场景包（含 title / studentInfoEnabled / footer / header / studentInfoFields / subtitle / note）
 */
function resolvePlaceholders(layout, preset) {
  const out = JSON.parse(JSON.stringify(layout));
  const ctx = {
    'preset.title': preset.title,
    'preset.studentInfoEnabled': preset.studentInfoEnabled,
    'preset.subtitle': preset.subtitle,
    'preset.note': preset.note
  };
  const resolveVal = (v) => {
    if (typeof v === 'string' && v.startsWith('@')) {
      const key = v.slice(1);
      return Object.prototype.hasOwnProperty.call(ctx, key) ? ctx[key] : v;
    }
    return v;
  };
  const walk = (o) => {
    for (const k of Object.keys(o)) {
      if (o[k] && typeof o[k] === 'object' && !Array.isArray(o[k])) walk(o[k]);
      else if (Array.isArray(o[k])) o[k] = o[k].map(resolveVal);
      else o[k] = resolveVal(o[k]);
    }
  };
  walk(out);
  return out;
}

/**
 * 装载 layout：固定模板 layout.yml → 解析占位符 → 引擎默认值补全（防止模板缺字段）。
 * @param {string} scenario
 * @param {object} overrides 只允许 title / subtitle / note / studentInfo（§6 job.layoutOverrides）
 */
function loadLayout(scenario, overrides) {
  const rawLayout = readYaml(path.join(SKILL_DIR, 'layout.yml'));
  const presets = readYaml(path.join(SKILL_DIR, 'presets.yml'));
  const sp = presets.scenarioPresets || {};
  const common = sp.common || {};
  const scene = sp[scenario] || sp.homework || {};

  const preset = {
    title: scene.title || '化学方程式作业',
    studentInfoEnabled: !!scene.studentInfoEnabled,
    subtitle: common.subtitle != null ? common.subtitle : '',
    note: common.note != null ? common.note : '',
    header: Object.assign({ enabled: false, text: '', useTitle: false }, common.header || {}),
    footer: Object.assign({ enabled: true, format: 'number' }, common.footer || {}),
    studentInfoFields: common.studentInfoFields || ['姓名', '班级', '日期']
  };

  let layout = resolvePlaceholders(rawLayout, preset);
  // 引擎默认值兜底（模板缺字段时不至于 undefined 崩）
  layout = deepMerge(K.defaultLayoutSettings(), layout);
  // 共用项（页眉页脚/学生栏字段）落位
  layout.footer = Object.assign({}, layout.footer, preset.footer);
  layout.header = Object.assign({}, layout.header, preset.header);
  if (!layout.studentInfo || !(layout.studentInfo.fields || []).length) {
    layout.studentInfo = Object.assign({ enabled: false, fields: [] }, layout.studentInfo || {}, { fields: preset.studentInfoFields });
  }

  // 只允许覆盖 title / subtitle / note / studentInfo
  if (overrides && typeof overrides === 'object') {
    const allowed = ['title', 'subtitle', 'note', 'studentInfo'];
    for (const k of allowed) {
      if (Object.prototype.hasOwnProperty.call(overrides, k)) {
        if (k === 'studentInfo') layout.studentInfo = Object.assign({}, layout.studentInfo, overrides.studentInfo || {});
        else layout[k] = overrides[k];
      }
    }
  }
  return layout;
}

function deepMerge(base, over) {
  const out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
  for (const [k, v] of Object.entries(over || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base && typeof base[k] === 'object' && !Array.isArray(base[k])) {
      out[k] = deepMerge(base[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/** 读场景预设（供文案/预览用） */
function loadPresets() {
  return readYaml(path.join(SKILL_DIR, 'presets.yml')).scenarioPresets || {};
}

module.exports = { parseYaml, parseValue, scalar, loadLayout, loadPresets, resolvePlaceholders, SKILL_DIR, SKILL_ROOT, deepMerge };
