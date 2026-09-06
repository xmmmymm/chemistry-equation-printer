/*
 * 选必1 提取结果自动修复：
 * A. 多价离子无^写法（Fe3+ → Fe^3+）——token 级识别纯离子 token
 * B. 电极式减号失电子（X - ne- = Y → X = Y + ne-）——SPEC 规定电子作产物
 * 修复后重跑全量校验，剩余失败逐条输出。
 */
const fs = require('fs');
const path = require('path');
const C = require('../src/libs/chem.js');

const FILE = path.join(__dirname, '..', 'extraction', '选择性必修1.json');
const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));

// 已知会出现的离子元素/基团（用于 token 级修复，避免误伤化学式内下标）
const MULTI_CHARGE = /^(Fe|Zn|Mg|Cu|Ca|Ba|Hg|Cr|Al|Ni|Pb|Sn|Mn|Co|Cd|Sr|Ag|Ti)(\d{1,2})([+-])$/;
const GROUP_CHARGE = /^(SO4|NO3|CO3|PO4|HCO3|HSO4|MnO4|Cr2O7|ClO|ClO3|S2O3|OH|SCN|CN)(\d?)(\d?)([+-])$/;

function fixIonToken(tok) {
  let m = tok.match(MULTI_CHARGE);
  if (m && Number(m[2]) > 1) return m[1] + '^' + m[2] + m[3];
  // 基团多价：SO42- → SO4^2-（子代理可能写成 SO42- 形式）
  m = tok.match(/^(SO4|NO3|CO3|PO4|HCO3|MnO4|Cr2O7|S2O3)(\d)([+-])$/);
  if (m && Number(m[2]) > 1) return m[1] + '^' + m[2] + m[3];
  return tok;
}

// 电极式减号失电子 → 电子移到产物侧
function fixElectrodeLine(line) {
  // 模式：左侧含 "- ne-"（且不是电荷负号）
  // 匹配 " A - 2e- = B " 把 - 2e- 移到右侧
  const m = line.match(/^(.*?)(?:\s*-\s*(\d+)\s*e-\s*)(=[^=]*)$/);
  if (m) {
    const left = m[1].trim();
    const n = m[2];
    const right = m[3].replace(/^=/, '').trim();
    return `${left} = ${right} + ${n}e-`.replace(/\s+/g, ' ').trim();
  }
  return null;
}

let fixedIon = 0, fixedElec = 0;
const stillFail = [];

for (const e of data.entries) {
  for (const v of e.versions) {
    let line = v.line;
    // B: 电极式减号修复（先做，避免离子修复干扰）
    const fe = fixElectrodeLine(line);
    if (fe) { line = fe; fixedElec++; }
    // A: token 级多价离子修复
    const toks = line.split(' ');
    const fixed = toks.map(t => {
      // token 可能带前缀系数如 "2Fe3+" 或尾部 "↑"
      const pref = t.match(/^(\d*)(.*)$/);
      const core = pref[2];
      const m = core.match(/^(.*?)(↑|↓)?$/);
      const body = m[1];
      const suffix = m[2] || '';
      if (MULTI_CHARGE.test(body) || /^(SO4|NO3|CO3|PO4|HCO3|MnO4|Cr2O7|S2O3)(\d)([+-])$/.test(body)) {
        fixedIon++;
        return (pref[1] || '') + fixIonToken(body) + suffix;
      }
      return t;
    });
    v.line = fixed.join(' ');
    // 修复后校验
    const r = C.parseEquationLine(v.line);
    if (!r.ok) { stillFail.push({ name: e.name, line: v.line, kind: 'PARSE', msg: r.errors.join(';') }); continue; }
    const extras = {};
    if (v.type === 'thermochemical' && v.deltaH) extras.deltaH = v.deltaH;
    if (v.type === 'electrode' && v.electrode) extras.electrode = v.electrode;
    const st = C.validateVersion({ type: v.type, reactants: r.reactants, products: r.products, conditions: [], reversible: v.reversible, extras });
    if (!st.ok) stillFail.push({ name: e.name, line: v.line, kind: 'BAL', msg: st.errors.join(';') });
  }
}

console.log('修复: 多价离子 ' + fixedIon + ' 处, 电极式 ' + fixedElec + ' 处');
console.log('修复后仍失败: ' + stillFail.length + ' 条');
stillFail.forEach(f => console.log('  [' + f.kind + '] ' + f.name + ' :: ' + f.line + ' → ' + f.msg));

fs.writeFileSync(FILE, JSON.stringify(data, null, 2), 'utf8');
console.log('已写回 ' + FILE);
