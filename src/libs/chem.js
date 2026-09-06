/*
 * 化学核心模块：化学式解析、一行式方程式解析、学科校验、渲染。
 * 可在浏览器（script 标签）与 Node（require）两种环境使用。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Chem = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- 元素表 ----------
  const ELEMENTS = new Set(('H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se ' +
    'Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu ' +
    'Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr Rf Db Sg Bh Hs ' +
    'Mt Ds Rg Cn Nh Fl Mc Lv Ts Og').split(' '));

  // 常见无机含碳物质：允许；元素组成含 C 且不在其中 → 疑似有机物
  function isOrganicFormula(formula, composition) {
    const comp = composition || parseFormula(formula).composition;
    if (!comp || !comp.C) return false;
    const f = normalizeText(formula);
    if (/CO3/.test(f)) return false; // 碳酸盐/碳酸氢盐/碳酸根
    if (/CN/.test(f)) return false; // 氰化物/硫氰化物
    if (/^(C|CO|CO2|CS2|H2CO3|COCl2)(\^?\d*[+-])?$/.test(f)) return false;
    if (/^(CaC2|Na2C2|Al4C3|Fe3C|SiC|CaCO3)(\^?\d*[+-])?$/.test(f)) return false; // 金属碳化物/碳硅化物（无机）
    return true;
  }

  // ---------- 输入归一化 ----------
  const SUB_MAP = { '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9' };
  const SUP_MAP = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁺': '+', '⁻': '-' };

  function normalizeText(s) {
    if (!s) return '';
    let out = '';
    for (const ch of s) {
      if (SUB_MAP[ch]) out += SUB_MAP[ch];
      else if (SUP_MAP[ch]) out += SUP_MAP[ch];
      else if (ch === '＋') out += '+';
      else if (ch === '＝' || ch === '⩶') out += '=';
      // 注意：≡（三键）不再归一为 =——需保留三键身份用于渲染（CH≡CH）；
      // 它仅是化学式内键级字符，不会作方程式主分隔符（主分隔符要求两侧空格）
      else if (ch === '≡') out += ch;
      else if (ch === '⇌' || ch === '⇄' || ch === '⇋' || ch === '↔' || ch === '⟷') out += '⇌';
      else if (ch === '→' || ch === '⟶' || ch === '⇒') out += '=';
      else if (ch === '−' || ch === '–' || ch === '—') out += ch === '−' ? '-' : ch;
      else if (ch === '・' || ch === '•' || ch === '．' || ch === '*') out += '·';
      else if (ch === '↑' || ch === '↓') out += ch;
      else out += ch;
    }
    return out;
  }

  // ---------- 化学式解析 ----------
  /**
   * 解析化学式 → { ok, composition: {El: count}, charge, isElectron, organic, error }
   */
  function parseFormula(rawFormula) {
    const res = { ok: true, composition: {}, charge: 0, isElectron: false, organic: false, error: '' };
    let f = normalizeText(String(rawFormula || '')).trim();
    if (!f) return { ...res, ok: false, error: '化学式为空' };

    // 电子
    if (/^e(\^?-)?$/.test(f)) { res.isElectron = true; res.composition = {}; return res; }
    if (/^e-/i.test(f)) { res.isElectron = true; return res; }

    // 电荷：先取尾部符号
    // 形如 X^2- / X^2+ / X+ / X- / X2-（尾随数字视为下标，电荷为 ±1，与 NO3- 约定一致）
    let m = f.match(/\^(\d*)[+-]$/);
    if (m) {
      res.charge = (m[1] ? parseInt(m[1], 10) : 1) * (f.endsWith('+') ? 1 : -1);
      f = f.slice(0, f.length - m[0].length);
    } else {
      m = f.match(/[+-]$/);
      if (m) {
        res.charge = m[0] === '+' ? 1 : -1;
        f = f.slice(0, -1);
        // 形如 Ca2+ 这种歧义写法：尾部数字保留为下标（如 NO3-），多价离子请用 ^n 写法
      }
    }
    if (!f) return { ...res, ok: false, error: '化学式主体为空' };

    res.organic = false;

    // 递归下降解析
    let pos = 0;
    function parseExpr(stopAtParen) {
      const comp = {};
      while (pos < f.length) {
        const ch = f[pos];
        if (ch === '(' || ch === '[') {
          const close = ch === '(' ? ')' : ']';
          pos++;
          const inner = parseExpr(true);
          if (inner === null) return null;
          if (f[pos] !== close) { res.error = '括号不匹配'; return null; }
          pos++; // 跳过闭括号
          let num = readNumber();
          if (num === null) num = 1;
          // 链节式尾缀：[链节]n 或 (链节)n —— n 为聚合度，仅在紧随闭括号且到串尾时识别
          //（整体一个物质，元素组成按 1 个链节计，聚合守恒由 validateVersion 的「每组」特判处理）
          if (f[pos] === 'n' && pos === f.length - 1) {
            pos++;
            res.chainUnit = true;
          }
          for (const k in inner) comp[k] = (comp[k] || 0) + inner[k] * num;
        } else if (ch === ')' || ch === ']') {
          if (stopAtParen) return comp;
          res.error = '括号不匹配'; return null;
        } else if (ch === '·') {
          pos++;
          let mult = readNumber();
          if (mult === null) mult = 1;
          const inner = parseExpr(false);
          if (inner === null) return null;
          for (const k in inner) comp[k] = (comp[k] || 0) + inner[k] * mult;
        } else if (ch === '=' || ch === '≡' || ch === '-') {
          // 键级字符（双键 = / 三键 ≡ / 单键短横 -）：仅作词法符号，不参与元素组成
          //（守恒校验只看元素计数；结构简式如 CH2=CH2 / CH3-CH2-OH 与紧凑式同组成）
          pos++;
        } else if (/[A-Z]/.test(ch)) {
          let sym = ch; pos++;
          if (pos < f.length && /[a-z]/.test(f[pos])) { sym += f[pos]; pos++; }
          if (!ELEMENTS.has(sym)) { res.error = '未知元素符号：“' + sym + '”'; return null; }
          let num = readNumber();
          if (num === null) num = 1;
          comp[sym] = (comp[sym] || 0) + num;
        } else if (/[0-9]/.test(ch)) {
          res.error = '数字位置不合法（系数请写在最前）'; return null;
        } else {
          res.error = '无法识别的字符：“' + ch + '”'; return null;
        }
      }
      return comp;
    }
    function readNumber() {
      let s = '';
      while (pos < f.length && /[0-9]/.test(f[pos])) { s += f[pos]; pos++; }
      return s === '' ? null : parseInt(s, 10);
    }

    const comp = parseExpr(false);
    if (comp === null) return { ...res, ok: false };
    if (pos !== f.length) return { ...res, ok: false, error: '化学式解析未完成：' + f.slice(pos) };
    res.composition = comp;
    res.organic = isOrganicFormula(f, comp);
    return res;
  }

  function formulaComposition(formula) {
    const p = parseFormula(formula);
    return p.ok ? p : null;
  }

  // ---------- 一行式方程式解析 ----------
  /**
   * 输入如 "2Na + 2H2O = 2NaOH + H2↑"
   * 返回 { ok, reversible, reactants, products, errors[], warnings[] }
   */
  function parseEquationLine(line) {
    const out = { ok: true, reversible: false, reactants: [], products: [], errors: [], warnings: [] };
    let s = normalizeText(String(line || '')).trim();
    if (!s) { out.errors.push('方程式为空'); return { ...out, ok: false }; }

    let reversible = false;
    let parts = null;
    // 主分隔符：优先匹配「两侧均为空格的独立 ⇌ / <=> / =」——避免有机双键被截断
    //（如 CH2=CH2 + Br2 = CH2BrCH2Br 中的 CH2=CH2 不含空格，不会被误切）
    const mSep = s.match(/\s(<=>|⇌|=)\s/);
    if (mSep) {
      const idx = mSep.index;
      parts = [s.slice(0, idx), s.slice(idx + mSep[0].length)];
      reversible = mSep[1] !== '=';
    } else {
      // 全部无空格分隔时退回旧逻辑：取第一个出现的分隔符
      for (const sep of ['⇌', '=', '<=>']) {
        if (s.includes(sep)) {
          const idx = s.indexOf(sep);
          parts = [s.slice(0, idx), s.slice(idx + sep.length)];
          reversible = (sep === '⇌' || sep === '<=>');
          break;
        }
      }
    }
    if (!parts) { out.errors.push('缺少等号“=”或可逆号“⇌”'); return { ...out, ok: false }; }
    out.reversible = reversible;

    const left = parseSide(parts[0], out);
    const right = parseSide(parts[1], out);
    out.reactants = left;
    out.products = right;
    if (!left.length) out.errors.push('反应物为空');
    if (!right.length) out.errors.push('生成物为空');
    if (out.errors.length) out.ok = false;
    return out;
  }

  function parseSide(text, out) {
    const list = [];
    const trimmed = text.trim();
    if (!trimmed) return list;
    // 用“空格 + 空格”分隔物种，避免误切离子电荷（如 Ca^2+ + H2O、Na+ + OH-）
    const tokens = trimmed.split(/\s+\+\s+/).filter(t => t.trim());
    if (tokens.length <= 1 && trimmed.includes('+') && !/\s\+\s/.test(trimmed)) {
      out.warnings.push('建议在加号两侧留空格，例如 “Na+ + OH-”，以免与离子电荷混淆');
    }
    for (const tok of tokens) {
      const sp = parseSpeciesToken(tok, out);
      if (sp) list.push(sp);
    }
    return list;
  }

  function parseSpeciesToken(token, out) {
    let t = token.trim();
    if (!t) return null;
    let gas = false, precipitate = false, state = null;
    // 状态符号
    const stMatch = t.match(/\((s|l|g|aq)\)$/i);
    if (stMatch) { state = stMatch[1].toLowerCase(); t = t.slice(0, -stMatch[0].length).trim(); }
    if (t.endsWith('↑')) { gas = true; t = t.slice(0, -1).trim(); }
    else if (t.endsWith('↓')) { precipitate = true; t = t.slice(0, -1).trim(); }
    // 系数
    let coefficient = 1;
    // 聚合度 n 系数：行首 n / 2n / n-1 / 2n-1（教材副产物规则，可带括号与空格，
    // 规范化为 '(n-1)' / '(2n-1)'），后接大写字母开头的化学式。
    // 词法边界：Zn/Sn 等元素符号以大写开头且 parseFormula 能整体解析，不受影响；
    // n 永远不是元素符号（无小写开头元素），故行首小写 n 只能是聚合度。
    const nCoefMatch = t.match(/^\(?\s*\d*n\s*(?:-\s*\d+)?\s*\)?\s*(?=[A-Z])/);
    if (nCoefMatch) {
      coefficient = parsePolyCoef(nCoefMatch[0]).canon;
      t = t.slice(nCoefMatch[0].length);
    } else {
      const cMatch = t.match(/^(\d+)\s+/);
      if (cMatch) { coefficient = parseInt(cMatch[1], 10); t = t.slice(cMatch[0].length).trim(); }
      else {
        const cMatch2 = t.match(/^(\d+)(?=[A-Za-z])/);
        // "2H2O" 这种紧贴写法：最前数字是系数
        if (cMatch2 && cMatch2[1].length > 0) {
          coefficient = parseInt(cMatch2[1], 10);
          t = t.slice(cMatch2[1].length);
        }
      }
    }
    if (!t) { out.errors.push('存在空的化学式片段'); return null; }
    const fp = parseFormula(t);
    if (!fp.ok) { out.errors.push('化学式“' + t + '”无法解析：' + fp.error); return null; }
    if (fp.organic) out.warnings.push('“' + t + '”为有机物化学式，已按元素组成参与守恒校验，请人工核对写法（键级 =/≡ 不参与元素计数）');
    return {
      formula: t,
      coefficient,
      state: state || undefined,
      gas: gas || undefined,
      precipitate: precipitate || undefined,
      charge: fp.charge || undefined,
      isElectron: fp.isElectron || undefined
    };
  }

  // ---------- 校验 ----------
  function sumComposition(speciesList) {
    const sum = {};
    for (const sp of speciesList) {
      const fp = parseFormula(sp.formula);
      if (!fp.ok) continue;
      for (const el in fp.composition) {
        sum[el] = (sum[el] || 0) + (sp.coefficient || 1) * fp.composition[el];
      }
    }
    return sum;
  }

  function sumCharge(speciesList) {
    let q = 0;
    for (const sp of speciesList) {
      if (sp.isElectron) q -= (sp.coefficient || 1);
      else {
        const fp = parseFormula(sp.formula);
        q += (sp.coefficient || 1) * (fp.ok ? fp.charge : (sp.charge || 0));
      }
    }
    return q;
  }

  // ---------- 聚合式（加聚/缩聚）约定 ----------
  // 系数位允许 'n' / '2n' / '(n-1)' / '(2n-1)' 字符串（教材副产物规则）；链节式 [链节]n 中
  // n 为聚合度（组成按 1 个链节计）。守恒特判：任一侧含 n 系数或链节式时比较「每组」（n 取 1）
  // 的元素组成；教材 (n-1)/(2n-1) 写法因链节省略端基会恰差一分子 H2O——识别为教材端基约定
  //（提示性 warning），其余不守恒为提示性 warning，均不作 error（机械配平对聚合式无意义）。
  // 教材副产物规则系数解析：'n' / '2n' / 'n-1' / '2n-1'（可带括号与空格）。
  // 规则（人教版选三）：由一种单体缩聚，生成的小分子为 (n-1) 个；由两种单体缩聚为 (2n-1) 个。
  // 规范化存储：含减法的带括号 '(n-1)' / '(2n-1)'，纯系数不带括号 'n' / '2n'。
  function parsePolyCoef(c) {
    const m = /^\(?\s*(\d*)n\s*(?:-\s*(\d+))?\s*\)?\s*$/.exec(String(c == null ? '' : c).trim());
    if (!m) return null;
    const a = m[1] ? parseInt(m[1], 10) : 1;
    const b = m[2] ? parseInt(m[2], 10) : 0;
    const canon = b > 0 ? '(' + (m[1] || '') + 'n-' + b + ')' : ((m[1] || '') + 'n');
    return { a, b, canon };
  }
  function isPolymerCoef(c) {
    return typeof c === 'string' && parsePolyCoef(c) !== null;
  }
  function polyCoefValue(c) {
    const p = parsePolyCoef(c);
    return p ? Math.max(p.a - p.b, 0) : 1; // 按组比较取 n=1：n→1，2n→2，(n-1)→0，(2n-1)→1
  }
  function isChainUnitFormula(formula) {
    return /[\]\)]\s*n$/.test(String(formula || ''));
  }
  function isPolymerVersion(version) {
    return [...(version.reactants || []), ...(version.products || [])]
      .some(sp => isPolymerCoef(sp.coefficient) || isChainUnitFormula(sp.formula));
  }
  function sumCompositionPerGroup(speciesList) {
    const sum = {};
    for (const sp of speciesList) {
      const fp = parseFormula(sp.formula);
      if (!fp.ok) continue;
      const c = isPolymerCoef(sp.coefficient) ? polyCoefValue(sp.coefficient) : (sp.coefficient || 1);
      for (const el in fp.composition) {
        sum[el] = (sum[el] || 0) + c * fp.composition[el];
      }
    }
    return sum;
  }

  /**
   * 学科校验。version: { type, reversible, reactants, products, conditions, extras }
   * 返回 CheckStatus：{ ok, atomBalance, chargeBalance, electronBalance, warnings[], errors[] }
   */
  function validateVersion(version) {
    const st = {
      ok: true, atomBalance: false, chargeBalance: null, electronBalance: null,
      warnings: [], errors: []
    };
    const type = version.type || 'chemical';
    const reactants = version.reactants || [];
    const products = version.products || [];

    if (!reactants.length) st.errors.push('缺少反应物');
    if (!products.length) st.errors.push('缺少生成物');

    // 聚合式特判：任一侧含 n 系数或 [链节]n 时启用（系数允许 n 形式、按每组比较守恒）
    const polymer = isPolymerVersion(version);

    // 系数必须为正整数（聚合式额外允许 n / 2n / (n-1) / (2n-1) 教材规则形式）
    for (const sp of [...reactants, ...products]) {
      const c = sp.coefficient;
      const valid = (Number.isInteger(c) && c > 0) || (polymer && isPolymerCoef(c));
      if (!valid) {
        st.errors.push('化学式“' + sp.formula + '”的系数必须为正整数（聚合式允许 n / 2n / (n-1) / (2n-1)，禁止分数系数）');
      }
    }

    // 化学式可解析 + 有机提示
    for (const sp of [...reactants, ...products]) {
      const fp = parseFormula(sp.formula);
      if (!fp.ok) st.errors.push('化学式“' + sp.formula + '”无法解析：' + fp.error);
      else if (fp.organic) st.warnings.push('“' + sp.formula + '”为有机物化学式，已按元素组成参与守恒校验，请人工核对写法（键级 =/≡ 不参与元素计数）');
    }

    // 原子守恒（聚合式按每组（n 取 1）比较）
    if (!st.errors.length || (reactants.length && products.length)) {
      const left = polymer ? sumCompositionPerGroup(reactants) : sumComposition(reactants);
      const right = polymer ? sumCompositionPerGroup(products) : sumComposition(products);
      const diff = [];
      const diffMap = {}; // el → 左-右（聚合式按组差值，用于识别教材端基约定）
      const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
      for (const k of keys) {
        const l = left[k] || 0, r = right[k] || 0;
        if (l !== r) {
          diffMap[k] = l - r;
          diff.push(`${k}：左 ${l} 个 / 右 ${r} 个`);
        }
      }
      st.atomBalance = diff.length === 0;
      if (!st.atomBalance) {
        if (polymer) {
          // 教材副产物规则（(n-1)H2O / (2n-1)H2O）：链节方括号省略端基，按组比较恰差一分子
          // H2O（单体侧多 2H、1O）——这正是教材缩聚式的写法，给专属提示不作 error
          const dk = Object.keys(diffMap);
          if (dk.length === 2 && diffMap.H === 2 && diffMap.O === 1) {
            st.warnings.push('聚合式按教材副产物规则（(n-1)H2O / (2n-1)H2O）书写：链节未标端基，按每组比较恰差一分子 H2O，属教材端基约定，无须修改');
          } else {
            // 其余不严格配平：教材聚合式副产物系数可能为 n-1/2n-1 等形式，不强制机械配平
            st.warnings.push('聚合式按每组（n 约掉）比较元素组成仍不守恒（' + diff.join('；') + '），教材聚合式副产物系数可能为 n-1/2n-1 形式，请人工核对');
          }
        } else {
          st.errors.push('原子不守恒（' + diff.join('；') + '），方程式未配平');
        }
      }
    }

    // 电荷守恒：ionic / ionization / hydrolysis / electrode（聚合式 n 为符号量，跳过电荷比较）
    if (!polymer && ['ionic', 'ionization', 'hydrolysis', 'electrode'].includes(type)) {
      st.chargeBalance = sumCharge(reactants) === sumCharge(products);
      if (!st.chargeBalance) {
        st.errors.push(`电荷不守恒（左 ${fmtCharge(sumCharge(reactants))} / 右 ${fmtCharge(sumCharge(products))}）`);
      }
    }

    // 电极反应式：必须有电子
    if (type === 'electrode') {
      const hasE = [...reactants, ...products].some(sp => sp.isElectron || /^e-?$/i.test(normalizeText(sp.formula)));
      st.electronBalance = hasE;
      if (!hasE) st.errors.push('电极反应式必须包含电子 e⁻');
      const el = version.extras && version.extras.electrode;
      if (!el) st.warnings.push('建议在“更多设置”中标注电极（正极/负极/阳极/阴极）');
    }

    // 热化学：必须有 ΔH，建议标注状态
    if (type === 'thermochemical') {
      const dh = version.extras && version.extras.deltaH;
      if (!dh || !String(dh).trim()) st.errors.push('热化学方程式必须包含 ΔH');
      const noState = [...reactants, ...products].some(sp => !sp.state);
      if (noState) st.warnings.push('热化学方程式建议为每种物质标注状态 (s)/(l)/(g)/(aq)');
    }

    // 气体/沉淀符号规则（化学方程式、离子方程式）
    if (['chemical', 'ionic'].includes(type)) {
      for (const sp of reactants) {
        if (sp.gas) st.errors.push('气体符号 ↑ 只能标在生成物后（“' + sp.formula + '”是反应物）');
        if (sp.precipitate) st.errors.push('沉淀符号 ↓ 只能标在生成物后（“' + sp.formula + '”是反应物）');
      }
      for (const sp of products) {
        if (sp.gas && sp.precipitate) st.errors.push('“' + sp.formula + '”不能同时标注 ↑ 和 ↓');
      }
    }

    // 电离/水解建议
    if (type === 'ionization' && !version.reversible) {
      st.warnings.push('强电解质用“=”，弱电解质电离建议用可逆号“⇌”，请确认');
    }
    if (type === 'hydrolysis' && !version.reversible) {
      st.warnings.push('水解反应通常程度较小，建议使用可逆号“⇌”');
    }

    st.ok = st.errors.length === 0;
    st.lastCheckedAt = new Date().toISOString();
    return st;
  }

  function fmtCharge(q) {
    if (q > 0) return '+' + q;
    return String(q);
  }

  // ---------- 重复检测键 ----------
  /**
   * 忽略系数、顺序、条件、气体沉淀符号；反应方向相反不算重复。
   */
  function versionDupKey(version) {
    const key = (list) => (list || []).map(sp => sp.formula).sort().join(',');
    return key(version.reactants) + '=>' + key(version.products);
  }

  function reverseDupKey(version) {
    const key = (list) => (list || []).map(sp => sp.formula).sort().join(',');
    return key(version.products) + '=>' + key(version.reactants);
  }

  // ---------- 显示渲染 ----------
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /** 化学式 → 带下标/上标 HTML 片段 */
  function formulaHTML(formula) {
    const norm = normalizeText(formula);
    // 电子
    if (/^e(\^?-)?$/.test(norm)) return 'e<sup>−</sup>';
    // 电荷
    let body = norm, charge = null;
    let m = norm.match(/\^(\d*)[+-]$/);
    if (m) { charge = (m[1] ? m[1] : '') + (norm.endsWith('+') ? '+' : '−'); body = norm.slice(0, -m[0].length); }
    else {
      m = norm.match(/[+-]$/);
      if (m) { charge = m[0] === '+' ? '+' : '−'; body = norm.slice(0, -1); }
    }
    // 链节式尾缀：[链节]n / (链节)n 的聚合度 n 按教材惯例渲染为下标
    let tailSubN = false;
    if (/[\]\)]n$/.test(body)) { body = body.slice(0, -1); tailSubN = true; }
    let html = '';
    for (let i = 0; i < body.length; i++) {
      const ch = body[i];
      if (/[0-9]/.test(ch)) html += '<sub>' + ch + '</sub>';
      else html += escapeHtml(ch);
    }
    if (tailSubN) html += '<sub>n</sub>';
    if (charge) html += '<sup>' + escapeHtml(charge) + '</sup>';
    return html;
  }

  function speciesHTML(sp, opts) {
    opts = opts || {};
    // 系数挖空：blankCoefficient=全部系数挖空；blankCoefSp=指定物质单独挖系数
    const coefBlank = opts.blankCoefficient === true ||
      (opts.blankCoefSp && opts.blankCoefSp.includes(sp));
    let html = '';
    if (coefBlank) html += '<span class="blank-coef">____</span>';
    else if (sp.coefficient && sp.coefficient !== 1) html += String(sp.coefficient);
    html += formulaHTML(sp.formula);
    if (sp.state) html += '(' + escapeHtml(sp.state) + ')';
    if (sp.gas) html += '↑';
    if (sp.precipitate) html += '↓';
    return html;
  }

  function sideHTML(list, opts) {
    opts = opts || {};
    return (list || []).map(sp => {
      if (opts.blankSpecies && opts.blankSpecies.includes(sp)) {
        const coefBlank = opts.blankCoefficient === true ||
          (opts.blankCoefSp && opts.blankCoefSp.includes(sp));
        // 物质挖空：系数是否保留可见（系数同时挖空时并入同一条横线）
        const prefix = (!coefBlank && sp.coefficient && sp.coefficient !== 1) ? String(sp.coefficient) : '';
        return prefix + '<span class="blank-species">________</span>';
      }
      return speciesHTML(sp, opts);
    }).join(' + ');
  }

  function conditionText(conditions) {
    return (conditions || []).map(c => c.code === 'heat' ? '△' : (c.text || c.code)).join('、');
  }

  // 条件分行列表（多条件竖排堆叠，如 MnO2 / △，避免宽条件横向溢出压到两侧化学式）
  function conditionLines(conditions) {
    return (conditions || [])
      .map(c => (c.code === 'heat' ? '△' : (c.text || c.code)))
      .map(t => String(t || '').trim())
      .filter(Boolean);
  }

  // —— 条件布局引擎 ——
  // 估算条件文本宽度（父级 em 单位；条件字号为父级 0.7em）
  function condCharEm(ch) {
    if (/[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF\u3000-\u303F]/.test(ch)) return 1.0; // CJK/全角
    if (ch === '\u25B3' || ch === '\u25B2') return 1.0; // △▲
    if (ch === 'M' || ch === 'W') return 0.9;
    if (/[A-Z]/.test(ch)) return 0.72;
    if (/[0-9a-z]/.test(ch)) return 0.5;
    return 0.35;
  }
  function condWidthEm(t) {
    let w = 0;
    for (const ch of String(t || '')) w += condCharEm(ch);
    return w * 0.7;
  }

  // 复合条件拆词词典（贪心最长匹配）：“高温高压密闭容器” → 高温 / 高压 / 密闭容器
  // 注意：不收录“高温高压”等可再拆的组合词——用户规则要求拆到最小语义词
  // 有机常见条件：NaOH溶液/NaOH醇溶液（卤代烃水解/消去）、Ni（催化加氢）、FeBr3（苯溴代催化）、
  // 液溴、浓盐酸、煮沸、醇、水、水浴（加热）、℃数带符号整体作一个词
  const COND_WORDS = [
    '密闭容器', '催化剂', '浓硫酸', '稀硫酸', '干燥器',
    '高温', '高压', '低温', '常温', '点燃', '加热', '通电', '光照', '催化',
    'MnO2', '△',
    'NaOH溶液', 'NaOH醇溶液', '水浴加热', '水浴',
    '浓盐酸', '液溴', '煮沸', 'FeBr3', '500℃', '150℃', '50℃',
    'Ni', '醇', '水'
  ];
  COND_WORDS.sort((a, b) => b.length - a.length); // 最长优先

  /** 把一条条件文本拆成独立词（词典贪心匹配，匹配不到的连续片段归为一个词） */
  function splitConditionWords(t) {
    const s = String(t || '').replace(/\s+/g, '').trim();
    if (!s) return [];
    const out = [];
    let i = 0, buf = '';
    while (i < s.length) {
      let matched = '';
      for (const w of COND_WORDS) {
        if (s.startsWith(w, i)) { matched = w; break; }
      }
      if (matched) {
        if (buf) { out.push(buf); buf = ''; }
        out.push(matched);
        i += matched.length;
      } else {
        buf += s[i];
        i++;
      }
    }
    if (buf) out.push(buf);
    return out.filter(Boolean);
  }

  /**
   * 条件布局（修正版）：
   * 1. 拆词（复合词如“高温高压密闭容器”拆成独立词）；
   * 2. 排序：△（加热）垫底（多条件时 △ 放下方、催化剂/MnO2 等放上方——教材惯例），
   *    其余按宽度短者优先；
   * 3. 单一条件 → 一律放符号上方（过宽则加长符号收容），不再出现“上方空着、
   *    单独的催化剂掉到下方”；
   * 4. 多条件：上方只放 1 个词（排序第一、宽度 ≤ SIGN_CAP），其余词全部放符号下方，
   *    每词一行（短者贴近符号）；
   * 5. 下方单词宽度 > BELOW_CAP → 加长符号（signMinEm），使该词收进符号跨度。
   * 返回 { above: [单个词或空], below: [最贴近符号的在前], signMinEm }。
   */
  function conditionLayout(conds) {
    // 每条条件先拆词再汇总
    const words = [];
    for (const t of (conds || [])) {
      words.push(...splitConditionWords(t));
    }
    if (!words.length) return { above: [], below: [], signMinEm: 0 };
    const isHeat = (t) => t === '△';
    const sorted = words.slice().sort((a, b) => {
      const ha = isHeat(a) ? 1 : 0, hb = isHeat(b) ? 1 : 0;
      if (ha !== hb) return ha - hb; // △ 垫底（单条件时不受影响，仍进上方）
      const wa = condWidthEm(a), wb = condWidthEm(b);
      if (Math.abs(wa - wb) > 0.01) return wa - wb;
      return 0;
    });
    const SIGN_CAP = 2.2; // 符号 2em + 余量：「催化剂/浓硫酸」等 2.1em 词可入上方
    const BELOW_CAP = 3.5; // 下方空旷区单行容量
    let above = [], below = [], signMinEm = 0;
    if (words.length === 1) {
      // 单一条件：一律上方；过宽则加长符号收容（如“密闭容器”）
      above = [sorted[0]];
      const w = condWidthEm(sorted[0]);
      if (w > SIGN_CAP) signMinEm = Math.max(signMinEm, w + 0.5);
      return { above, below, signMinEm };
    }
    // 上方：第一个词（若放得下）
    if (sorted.length && condWidthEm(sorted[0]) <= SIGN_CAP) {
      above = [sorted[0]];
      below = sorted.slice(1);
    } else {
      above = [];
      below = sorted.slice();
    }
    // 下方过宽的词 → 加长符号
    for (const t of below) {
      const w = condWidthEm(t);
      if (w > BELOW_CAP) signMinEm = Math.max(signMinEm, w + 0.5);
    }
    return { above, below, signMinEm };
  }

  /**
   * 符号区（条件 + 等号/可逆号/长横线）HTML。
   * signText: '——'（B类题干）等；缺省按版本取 ══/⇌。
   * 布局规则：上方单行（最短/△词）；其余词下方每词一行（短者贴符号）；超宽词加长符号。
   * opts.blankCondition: 条件整组挖空；opts.condBlankIdxs: 逐词挖空（conditionLines 展开序）。
   * 结构：.eq-eq > .eq-anchor > (.eq-cond 上方)? + .eq-sign + (.eq-cond-below 下方堆叠)?
   * 条件相对 .eq-anchor 绝对定位，等号相对 .eq-eq 上下 padding 撑开行盒。
   */
  function signZoneHTML(version, signText, opts) {
    opts = opts || {};
    const rawConds = conditionLines(version.conditions);
    // 条件词过滤：整组挖空（blankCondition）或逐词挖空（condBlankIdxs）
    let conds = rawConds;
    if (opts.blankCondition) conds = [];
    else if (opts.condBlankIdxs && opts.condBlankIdxs.length) {
      conds = rawConds.filter((_, i) => !opts.condBlankIdxs.includes(i));
    }
    const condBlanked = rawConds.length > 0 && conds.length === 0; // 条件全部被挖（符号变空）
    const showCond = conds.length > 0;
    let above = [], below = [], signMinEm = 0;
    if (showCond) {
      if (opts.condBottom) {
        below = conds.map(t => String(t).trim()).filter(Boolean);
      } else {
        const L = conditionLayout(conds);
        above = L.above; below = L.below; signMinEm = L.signMinEm;
      }
    }
    const signChar = (opts.blankCondition || condBlanked) ? '＿＿' : (signText || (version.reversible ? '⇌' : '══'));
    const isArrow = signChar === '⇌';
    const signKind = isArrow ? 'sign-arrow' : (signChar === '＿＿' ? 'sign-blank' : 'sign-dash');
    const cl = (arr) => arr.map(t => `<span class="cl">${escapeHtml(t)}</span>`).join('');
    const signStyle = signMinEm ? ` style="min-width:${signMinEm.toFixed(2)}em;"` : '';
    // 加长符号：横线类符号用重复字符把可见线段填满目标宽度（⇌ 单字形无法重复，靠 min-width 容纳）
    let signTextOut = signChar;
    if (signMinEm && !isArrow && signChar !== '＿＿') {
      signTextOut = signChar.charAt(0).repeat(Math.ceil(signMinEm));
    }
    // 条件必须放在 .eq-anchor 内部（绝对定位的包含块 = 锚点，而非含 padding 的 .eq-eq）
    let anchorInner = '';
    // above 数组顺序 = 靠近符号优先；flex 纵排自上而下渲染，故反转使首位最贴近符号
    if (showCond && above.length) anchorInner += `<span class="eq-cond">${cl(above.slice().reverse())}</span>`;
    anchorInner += `<span class="eq-sign"${signStyle}>${escapeHtml(signTextOut)}</span>`;
    if (showCond && below.length) anchorInner += `<span class="eq-cond-below">${cl(below)}</span>`;
    const inner = `<span class="eq-anchor">${anchorInner}</span>`;
    const nA = showCond ? above.length : 0;
    const nB = showCond ? below.length : 0;
    // 行盒撑开量：⇌ 字形上下都高，需要更大 padding
    const padTop = nA ? ((isArrow ? 0.85 : 0.55) + 0.81 * (nA - 1)) : 0;
    const padBottom = nB ? ((isArrow ? 0.85 : 0.55) + 0.81 * (nB - 1)) : 0;
    const cls = 'eq-eq ' + signKind + (opts.condBottom ? ' cond-bottom' : '');
    const st = (padTop || padBottom)
      ? ` style="padding-top:${padTop.toFixed(2)}em;padding-bottom:${padBottom.toFixed(2)}em;"` : '';
    return `<span class="${cls}"${st}>${inner}</span>`;
  }

  /**
   * 完整方程式 HTML（条件按布局引擎放在等号上下方）。
   * opts: { blankCoefficient: 全部系数留空, blankCondition: 条件整组留空, condBlankIdxs: 条件逐词留空,
   *         signText: 覆盖等号文本(如 ——), condBottom: 强制条件在下方, hideDeltaH: 不显示 ΔH }
   * 热化学方程式的 ΔH（extras.deltaH）默认显示在方程式之后（答案卷/挖空/配平题）；
   * B 类题干（给反应物写产物）不经过本函数，由调用方只渲染左侧。
   */
  function equationHTML(version, opts) {
    opts = opts || {};
    const sep = signZoneHTML(version, null, opts);
    const left = sideHTML(version.reactants, opts);
    const right = sideHTML(version.products, opts);
    let out = `<span class="eq">${left}${sep}${right}</span>`;
    const dh = version.extras && version.extras.deltaH;
    if (dh && !opts.hideDeltaH) {
      out += `<span class="eq-dh">　ΔH = ${escapeHtml(dh)}</span>`;
    }
    return out;
  }

  /** 规范化纯文本（用于 CSV / 搜索 / 编辑器回填） */
  function equationText(version) {
    const side = (list) => (list || []).map(sp => {
      let s = (sp.coefficient && sp.coefficient !== 1 ? sp.coefficient : '') + sp.formula;
      if (sp.state) s += '(' + sp.state + ')';
      if (sp.gas) s += '↑';
      if (sp.precipitate) s += '↓';
      return s;
    }).join(' + ');
    let eq = side(version.reactants) + (version.reversible ? ' ⇌ ' : ' = ') + side(version.products);
    const cond = conditionText(version.conditions);
    if (cond) eq += '（条件：' + cond + '）';
    if (version.extras && version.extras.deltaH) eq += '  ΔH = ' + version.extras.deltaH;
    return eq;
  }

  /** 编辑器一行式回填文本（可再次被 parseEquationLine 解析） */
  function editorLine(version) {
    const side = (list) => (list || []).map(sp => {
      let s = (sp.coefficient && sp.coefficient !== 1 ? sp.coefficient + ' ' : '') + sp.formula;
      if (sp.state) s += '(' + sp.state + ')';
      if (sp.gas) s += '↑';
      if (sp.precipitate) s += '↓';
      return s;
    }).join(' + ');
    return side(version.reactants) + ' ' + (version.reversible ? '⇌' : '=') + ' ' + side(version.products);
  }

  // ---------- Unicode 下标/上标美化（剪贴板复制用） ----------
  const SUB_DIGITS = { '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉' };
  const SUP_CHARS = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '+': '⁺', '-': '⁻' };

  /** 化学式 → Unicode：元素后数字变下标；^ 后电荷变上标；结晶水 ·5 的 5 保持正常 */
  function formulaUnicode(f) {
    let out = '';
    for (let i = 0; i < f.length; i++) {
      const ch = f[i];
      if (ch === '^') {
        i++;
        while (i < f.length && SUP_CHARS[f[i]]) { out += SUP_CHARS[f[i]]; i++; }
        i--; // 抵消外层 for 的自增
        continue;
      }
      if (SUB_DIGITS[ch] && /[A-Za-z)\]]$/.test(out)) { out += SUB_DIGITS[ch]; continue; }
      out += ch;
    }
    return out;
  }

  /** Unicode 美化纯文本（如 2H₂ =点燃= 2H₂O；SO₄²⁻ 电荷上标）。
   * 符号约定：始终使用等号 = / 可逆号 ⇌（条件夹在双符号之间，如 =点燃= / ⇌高温⇌），不用箭头。 */
  function equationUnicodeText(version) {
    const side = (list) => (list || []).map(sp => {
      let s = (sp.coefficient && sp.coefficient !== 1 ? sp.coefficient : '') + formulaUnicode(sp.formula);
      if (sp.state) s += '(' + sp.state + ')';
      if (sp.gas) s += '↑';
      if (sp.precipitate) s += '↓';
      return s;
    }).join(' + ');
    const cond = conditionText(version.conditions);
    const sym = version.reversible ? '⇌' : '=';
    const sign = cond ? ' ' + sym + cond + sym + ' ' : ' ' + sym + ' ';
    let eq = side(version.reactants) + sign + side(version.products);
    if (version.extras && version.extras.deltaH) eq += '　ΔH = ' + version.extras.deltaH;
    return eq;
  }

  return {
    ELEMENTS,
    normalizeText,
    parseFormula,
    parseEquationLine,
    validateVersion,
    versionDupKey,
    reverseDupKey,
    formulaHTML,
    speciesHTML,
    sideHTML,
    equationHTML,
    signZoneHTML,
    conditionLayout,
    splitConditionWords,
    equationText,
    editorLine,
    equationUnicodeText,
    formulaUnicode,
    conditionText,
    conditionLines,
    escapeHtml,
    isOrganicFormula,
    isPolymerCoef,
    polyCoefValue,
    isChainUnitFormula,
    isPolymerVersion
  };
});
