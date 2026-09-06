/*
 * scripts/add-ionic.js — 为可拆分的化学方程式自动生成「离子方程式」版本
 * 原理：强电解质（强酸/强碱/可溶盐）拆成离子 → 消去两侧相同的旁观离子 → 系数约分 → 引擎校验
 * 用法：node scripts/add-ionic.js          （dry-run，仅打印提案）
 *       node scripts/add-ionic.js --apply  （写入两处 library.json）
 */
const fs = require('fs');
const path = require('path');
const C = require('../src/libs/chem.js');
const K = require('../src/libs/constants.js');

const FILES = [
  path.join(__dirname, '..', 'build', 'win-unpacked', 'data', 'library.json'),
  path.join(__dirname, '..', 'data', 'library.json')
];

// ---------- 化学知识库 ----------
const STRONG_ACIDS = new Set(['HCl', 'H2SO4', 'HNO3', 'HBr', 'HI']);
const CATION_METALS = new Set(['Na', 'K', 'Li', 'Ba', 'Ca', 'Mg', 'Al', 'Zn', 'Fe', 'Cu', 'Ag', 'Pb', 'Sn', 'Mn', 'Ni', 'Hg', 'Sr', 'Cr', 'Ti']);

// 阴离子基团（顺序：长的优先）
const ANION_GROUPS = [
  ['CH3COO', -1], ['S2O3', -2], ['Cr2O7', -2], ['MnO4', -1], ['SiO3', -2],
  ['Al(OH)4', -1], ['HCO3', -1], ['HSO4', -1], ['HPO4', -2], ['H2PO4', -1],
  ['SO4', -2], ['SO3', -2], ['NO3', -1], ['NO2', -1], ['CO3', -2], ['PO4', -3], ['CrO4', -2],
  ['SCN', -1], ['CN', -1], ['ClO3', -1], ['ClO', -1],
  ['Cl', -1], ['Br', -1], ['I', -1], ['F', -1], ['S', -2], ['OH', -1]
];

/** 解析化合物 → { cat, catCount, catCharge, anion, anionCount, anionCharge } | null */
function parseCompound(F) {
  if (!F || /[·\[\]^]/.test(F)) return null;
  let m;
  m = F.match(/^\(NH4\)(\d*)(.+)$/);
  if (m) return finish('NH4', m[1] ? +m[1] : 1, m[2]);
  if (F.startsWith('NH4') && F.length > 3) return finish('NH4', 1, F.slice(3));
  m = F.match(/^H(\d*)(.+)$/);
  if (m && m[2] !== '' && m[2] !== 'O' && !/^O\d*$/.test(m[2])) return finish('H', m[1] ? +m[1] : 1, m[2]);
  m = F.match(/^([A-Z][a-z]?)(\d*)(.*)$/);
  if (m && CATION_METALS.has(m[1]) && m[3] !== '') return finish(m[1], m[2] ? +m[2] : 1, m[3]);
  // 尾部阳离子（有机酸盐：CH3COONa、(CH3COO)2Ca）
  for (const ec of ['Na', 'K', 'Li', 'Ag', 'Ca', 'Ba', 'Mg', 'Zn', 'Al']) {
    if (F.length > ec.length && F.endsWith(ec)) {
      const prefix = F.slice(0, F.length - ec.length);
      const pm = prefix.match(/^\(([A-Za-z0-9]+)\)(\d*)$/);
      if (pm) {
        const g = ANION_GROUPS.find(x => x[0] === pm[1]);
        if (!g) return null;
        return { cat: ec, catCount: 1, catCharge: g[1] * (pm[2] ? +pm[2] : 1) > 0 ? Math.abs(g[1]) * (pm[2] ? +pm[2] : 1) : Math.abs(g[1]) * (pm[2] ? +pm[2] : 1), anion: g[0], anionCount: pm[2] ? +pm[2] : 1, anionCharge: g[1] };
      }
      return finish(ec, 1, prefix);
    }
  }
  return null;
}

function finish(cat, catCount, anionPart) {
  let anion, anionCharge, anionCount;
  const pm = anionPart.match(/^\(([A-Za-z0-9]+)\)(\d*)$/);
  if (pm) {
    const g = ANION_GROUPS.find(x => x[0] === pm[1]);
    if (!g) return null;
    [anion, anionCharge] = g;
    anionCount = pm[2] ? +pm[2] : 1;
  } else {
    for (const [name, ch] of ANION_GROUPS) {
      if (anionPart.startsWith(name)) {
        const rest = anionPart.slice(name.length);
        const cm = rest.match(/^(\d*)$/);
        if (cm) { anion = name; anionCharge = ch; anionCount = cm[1] ? +cm[1] : 1; break; }
      }
    }
    if (!anion) return null;
  }
  const num = Math.abs(anionCharge) * anionCount;
  if (num % catCount !== 0) return null;
  const catCharge = num / catCount;
  if (catCharge < 1 || catCharge > 3) return null;
  return { cat, catCount, catCharge, anion, anionCount, anionCharge };
}

/** 溶解性判定（可溶盐才拆） */
function isSolublePair(cat, anion) {
  const alk = ['Na', 'K', 'Li', 'NH4'];
  if (alk.includes(cat)) return true;                 // 钾钠铵全溶
  switch (anion) {
    case 'NO3': return true;                          // 硝酸盐全溶（含 AgNO3）
    case 'CH3ACO': case 'ClO3': case 'MnO4': return true;
    case 'CH3COO': case 'NO2': case 'CN': case 'SCN': return true;
    case 'Cl': case 'Br': case 'I': return !['Ag', 'Pb', 'Hg'].includes(cat);
    case 'F': return !['Ca', 'Mg', 'Pb'].includes(cat);
    case 'SO4': return !['Ba', 'Pb', 'Ag', 'Ca'].includes(cat); // CaSO4/Ag2SO4 微溶保守不拆
    case 'HCO3': return ['Ca', 'Mg', 'Ba', 'Sr', 'Fe', 'Mn', 'Zn'].includes(cat);
    case 'OH': return cat === 'Ba';                   // Na/K 已在 alk；Ca 特判
    default: return false;                            // CO3/SO3/S/SiO3/PO4 等仅碱金属铵
  }
}

function ionToken(name, charge) {
  if (charge === 1) return name + '+';
  if (charge === -1) return name + '-';
  return name + '^' + Math.abs(charge) + (charge > 0 ? '+' : '-');
}

const dissCache = new Map();
/** 化学式 → 离子组成 [[ionToken, count], ...] | null（不拆） */
function dissociation(F) {
  if (dissCache.has(F)) return dissCache.get(F);
  let result = null;
  const p = parseCompound(F);
  if (p) {
    if (p.cat === 'H') {
      if (STRONG_ACIDS.has(F)) result = [[ionToken('H', 1), p.catCount], [ionToken(p.anion, p.anionCharge), p.anionCount]];
    } else if (p.anion === 'OH') {
      if (['Na', 'K', 'Li', 'Ba', 'Ca'].includes(p.cat)) {
        result = [[ionToken(p.cat, p.catCharge), p.catCount], ['OH-', p.anionCount]];
      }
    } else if (p.anion === 'Al(OH)4') {
      result = [[ionToken(p.cat, p.catCharge), p.catCount], ['Al(OH)4-', p.anionCount]];
    } else if (isSolublePair(p.cat, p.anion)) {
      result = [[ionToken(p.cat, p.catCharge), p.catCount], [ionToken(p.anion, p.anionCharge), p.anionCount]];
    }
  }
  dissCache.set(F, result);
  return result;
}

// ---------- 转换 ----------
function expandSide(list) {
  const out = [];
  for (const sp of list) {
    const d = dissociation(sp.formula);
    if (d) {
      for (const [tok, n] of d) out.push({ token: tok, coef: sp.coefficient * n, ion: true });
    } else {
      out.push({ token: sp.formula, coef: sp.coefficient, ion: false, gas: !!sp.gas, ppt: !!sp.precipitate });
    }
  }
  return out;
}

function mergeSide(items) {
  const map = new Map();
  for (const it of items) {
    const key = it.token + '|' + (it.gas ? 'g' : '') + (it.ppt ? 'p' : '');
    if (map.has(key)) map.get(key).coef += it.coef;
    else map.set(key, { ...it });
  }
  return [...map.values()].filter(x => x.coef > 0);
}

function gcdAll(nums) {
  const g = (a, b) => b ? g(b, a % b) : a;
  return nums.reduce((a, b) => g(a, b), 0);
}

function sideToString(items) {
  return items.map(it => (it.coef > 1 ? it.coef : '') + it.token + (it.gas ? '↑' : '') + (it.ppt ? '↓' : '')).join(' + ');
}

/** 化学式版本 → 离子式版本（成功返回 {line, reactants, products}） */
function toIonic(version) {
  let left = mergeSide(expandSide(version.reactants));
  let right = mergeSide(expandSide(version.products));
  // 消去旁观离子（离子才可消；分子不消）
  for (const l of left) {
    if (!l.ion) continue;
    const r = right.find(x => x.ion && x.token === l.token);
    if (r) {
      const min = Math.min(l.coef, r.coef);
      l.coef -= min; r.coef -= min;
    }
  }
  left = left.filter(x => x.coef > 0);
  right = right.filter(x => x.coef > 0);
  if (!left.length || !right.length) return null;
  // 必须至少有一个离子（否则等于没拆）
  if (!left.some(x => x.ion) && !right.some(x => x.ion)) return null;
  // 约分
  const g = gcdAll([...left, ...right].map(x => x.coef));
  if (g > 1) { left.forEach(x => x.coef /= g); right.forEach(x => x.coef /= g); }
  const line = sideToString(left) + (version.reversible ? ' ⇌ ' : ' = ') + sideToString(right);
  // 引擎校验
  const r = C.parseEquationLine(line);
  if (!r.ok) return { error: '解析失败: ' + r.errors.join(';') };
  const st = C.validateVersion({ type: 'ionic', reactants: r.reactants, products: r.products, conditions: [], reversible: version.reversible, extras: {} });
  if (!st.ok) return { error: '守恒失败: ' + st.errors.join(';') };
  return { line, reactants: r.reactants, products: r.products };
}

// ---------- 主流程 ----------
// 化学复核黑名单：非水溶液语境（气相/固相/非水体系），转离子式不当
const REJECT_NAME = ['钠与氯气', '黑火药', '爆炸', '氨与氯化氢', '碘化氢的分解', '乙烯与氯化氢', '亚硫酰氯', '锌锰电池', '锂-亚硫酰氯', '晶体'];

function main() {
  const apply = process.argv.includes('--apply');
  const lib = JSON.parse(fs.readFileSync(FILES[0], 'utf8'));
  const proposals = [];
  const rejects = { '已有离子版': 0, '无条件化学版缺失': 0, '带反应条件': 0, '浓/石灰乳/熔融语境': 0, '氧化物与水化合': 0, '固相/非溶液语境': 0, '无可拆强电解质': 0, '转换失败': 0 };

  for (const e of lib.entries) {
    const chem = e.versions.find(v => v.type === 'chemical');
    if (!chem) { if (e.versions.some(v => v.type === 'ionic')) { rejects['已有离子版']++; } continue; }
    if (e.versions.some(v => v.type === 'ionic')) { rejects['已有离子版']++; continue; }
    if ((chem.conditions || []).some(c => !['常温'].includes(c.text))) { rejects['带反应条件']++; continue; }
    const ctx = (e.name || '') + (e.description || '');
    if (/浓|石灰乳|熔融/.test(ctx) || REJECT_NAME.some(k => (e.name || '').includes(k))) { rejects['浓/石灰乳/熔融语境']++; continue; }
    // 固相反应标志：反应物含结晶水合物（·）或配合物固体
    if (chem.reactants.some(sp => /[·\[\]]/.test(sp.formula))) { rejects['固相/非溶液语境']++; continue; }
    const oxideOrWater = f => f === 'H2O' || /^[A-Z][a-z]?\d*O\d*$/.test(f) || /^H\d*O\d*$/.test(f);
    if (chem.reactants.every(sp => oxideOrWater(sp.formula))) { rejects['氧化物与水化合']++; continue; }
    if (![...chem.reactants, ...chem.products].some(sp => dissociation(sp.formula))) { rejects['无可拆强电解质']++; continue; }
    const r = toIonic(chem);
    if (!r || r.error) { rejects['转换失败']++; if (r && r.error) proposals.push({ name: e.name, book: (e.textbooks[0] || {}).book, chem: C.equationText(chem), ionic: null, error: r.error }); continue; }
    proposals.push({ name: e.name, book: (e.textbooks[0] || {}).book, chem: C.equationText(chem), ionic: r.line, result: r, entry: e, chemVersion: chem });
  }

  const ok = proposals.filter(p => p.ionic);
  const bad = proposals.filter(p => !p.ionic);
  console.log('=== 提案: ' + ok.length + ' 条成功 / ' + bad.length + ' 条转换失败 ===');
  for (const p of ok) {
    console.log('[OK] ' + p.name + '（' + p.book + '）');
    console.log('     ' + p.chem);
    console.log('  →  ' + p.ionic);
  }
  for (const p of bad) {
    console.log('[X] ' + p.name + ' :: ' + p.chem);
    console.log('     ' + p.error);
  }
  console.log('=== 拒绝统计 ===');
  for (const [k, v] of Object.entries(rejects)) if (v) console.log('  ' + k + ': ' + v);

  if (apply) {
    let added = 0;
    for (const p of ok) {
      p.entry.versions.push({
        id: K.uid('v'),
        type: 'ionic',
        label: '离子方程式',
        reversible: !!p.chemVersion.reversible,
        reactants: p.result.reactants,
        products: p.result.products,
        conditions: [],
        extras: {},
        questionCount: 0
      });
      added++;
    }
    const out = JSON.stringify(lib, null, 2);
    for (const f of FILES) fs.writeFileSync(f, out, 'utf8');
    console.log('=== 已写入: 新增 ' + added + ' 个离子版本 → 两处 library.json ===');
  }
}

main();
