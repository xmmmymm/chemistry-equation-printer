#!/usr/bin/env node
/*
 * 引擎副本「本地补丁」校验台。
 *
 * 为什么需要它：本项目允许对个别引擎副本打本地补丁（登记在 data/ENGINE-PATCHES.json），
 * `tools/sync-from-source.js` 因此不再按「上游哈希 == 本地哈希」判定这些文件。
 * 本脚本把那份登记变成**可执行的回归**：既校验哈希（补丁完好 / 上游未变），
 * 也跑行为断言（补丁真的修好了它声称修的问题）。
 *
 * 用法：
 *   node tools/test-engine-patches.js            # 校验（哈希 + 行为断言）
 *   node tools/test-engine-patches.js --update   # 重新打补丁后刷新登记哈希
 *
 * 退出码：0 = 全部通过；1 = 有失败
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SKILL_ROOT = path.resolve(__dirname, '..');
const PATCH_FILE = path.join(SKILL_ROOT, 'data', 'ENGINE-PATCHES.json');
const UPDATE = process.argv.includes('--update');

const sha256File = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

/** 引擎上游根目录（可选，仅用于比对补丁的 upstreamSha256）。未配置 → 跳过上游哈希校验。 */
const SOURCE_ROOT = (() => {
  const fromEnv = process.env.CHEMEQ_SOURCE;
  if (fromEnv) return path.resolve(fromEnv);
  try {
    const p = JSON.parse(fs.readFileSync(path.join(SKILL_ROOT, 'data', 'SOURCE.json'), 'utf8')).sourceProject;
    return p ? path.resolve(p) : null;
  } catch (_) { return null; }
})();

function readPatchFile() {
  try { return JSON.parse(fs.readFileSync(PATCH_FILE, 'utf8')); }
  catch (e) { console.error('✗ 读不了 ' + PATCH_FILE + '：' + e.message); process.exit(1); }
}

// ============================================================
// 行为断言（每个补丁一条，键 = 登记表的 label）
// ============================================================

/** 把 questionXml 的 run 序列还原成「[下标] {上标}」文本，便于断言 */
function flattenRuns(xml) {
  const re = /<w:r>(?:<w:rPr>(?<pr>.*?)<\/w:rPr>)?<w:t[^>]*>(?<t>[^<]*)<\/w:t><\/w:r>/g;
  let out = '', m;
  while ((m = re.exec(xml)) !== null) {
    const t = m.groups.t, pr = m.groups.pr || '';
    if (/superscript/.test(pr)) out += '{' + t + '}';
    else if (/subscript/.test(pr)) out += '[' + t + ']';
    else out += t;
  }
  return out;
}

const BEHAVIOR = {
  'engine/chem.js': () => {
    const C = require(path.join(SKILL_ROOT, 'engine', 'chem.js'));
    // 每个用例：{ name, run: () => 实际值, expect: 期望值 }
    const cases = [
      // ① 多位数下标（上游只吃第一位）
      { name: '多位数下标全吃：C17H35 → C₁₇H₃₅（不得出现 C₁7H₃5）', run: () => C.formulaUnicode('C17H35'), expect: 'C₁₇H₃₅', forbid: ['₁7', '₃5'] },
      { name: '多位数下标全吃：C6H12O6 → C₆H₁₂O₆', run: () => C.formulaUnicode('C6H12O6'), expect: 'C₆H₁₂O₆', forbid: ['₁2', '₂2', '₁1'] },
      { name: '多位数下标全吃：C3H5(OCOC17H35)3 → C₃H₅(OCOC₁₇H₃₅)₃', run: () => C.formulaUnicode('C3H5(OCOC17H35)3'), expect: 'C₃H₅(OCOC₁₇H₃₅)₃' },
      // 结晶水 ·5 不受影响（回归上游既有断言）
      { name: '结晶水 ·5 仍保持正常字号：CuSO4·5H2O → CuSO₄·5H₂O', run: () => C.formulaUnicode('CuSO4·5H2O'), expect: 'CuSO₄·5H₂O' },
      // ② 尾随 +/- 电荷转上标（与 formulaHTML() 对齐）
      { name: '尾随电荷转上标：H+ → H⁺', run: () => C.formulaUnicode('H+'), expect: 'H⁺', forbid: ['H+'] },
      { name: '尾随电荷转上标：OH- → OH⁻', run: () => C.formulaUnicode('OH-'), expect: 'OH⁻', forbid: ['OH-'] },
      { name: '尾随电荷转上标：e- → e⁻', run: () => C.formulaUnicode('e-'), expect: 'e⁻', forbid: ['e-'] },
      { name: '尾随电荷转上标：NO3- → NO₃⁻', run: () => C.formulaUnicode('NO3-'), expect: 'NO₃⁻' },
      { name: '尾随电荷转上标：CH3COO- → CH₃COO⁻', run: () => C.formulaUnicode('CH3COO-'), expect: 'CH₃COO⁻' },
      { name: '^ 记法仍正确：SO4^2- → SO₄²⁻', run: () => C.formulaUnicode('SO4^2-'), expect: 'SO₄²⁻' },
      { name: '配离子带尾随电荷：[Ag(NH3)2]+ → [Ag(NH₃)₂]⁺', run: () => C.formulaUnicode('[Ag(NH3)2]+'), expect: '[Ag(NH₃)₂]⁺' },
      // ③ 整式：equationUnicodeText 与 PDF/docx 同形
      {
        name: '整式与 PDF 同形：2H+ + SO4^2- = H2O → 2H⁺ + SO₄²⁻ = H₂O',
        run: () => C.equationUnicodeText({ type: 'ionic', reversible: false, conditions: [], reactants: [{ formula: 'H+', coefficient: 2 }, { formula: 'SO4^2-', coefficient: 1 }], products: [{ formula: 'H2O', coefficient: 1 }] }),
        expect: '2H⁺ + SO₄²⁻ = H₂O'
      },
      {
        name: '整式电子：2e- = H2 → 2e⁻ = H₂',
        run: () => C.equationUnicodeText({ type: 'ionic', reversible: false, conditions: [], reactants: [{ formula: '2e-', coefficient: 1 }], products: [{ formula: 'H2', coefficient: 1 }] }),
        expect: '2e⁻ = H₂'
      }
    ];
    return cases.map((c) => {
      let got;
      try { got = c.run(); } catch (e) { got = '抛错：' + e.message; }
      const forbidHit = (c.forbid || []).filter((f) => String(got).includes(f));
      return { name: c.name, ok: got === c.expect && !forbidHit.length, expect: c.expect, got, forbidHit };
    });
  },
  'engine/docx.js': () => {
    const Docx = require(path.join(SKILL_ROOT, 'engine', 'docx.js'));
    const K = require(path.join(SKILL_ROOT, 'engine', 'constants.js'));
    const Yml = require(path.join(SKILL_ROOT, 'tools', 'yml.js'));
    const layout = Yml.loadLayout('homework', {});
    const mkItem = (reactants, products) => ({
      itemId: 'q_patchtest', entryId: 'R_TEST', versionId: 'v_test', versionType: 'ionic',
      questionType: 'E', locked: false, showAnswerLine: false, pageBreakAfter: false,
      snapshot: {
        entryName: '补丁校验用条目', description: '', openPrompt: '', difficulty: '中等',
        version: { id: 'v_test', type: 'ionic', label: '离子方程式', reversible: false, conditions: [], reactants, products },
        entryId: 'R_TEST', takenAt: K.nowIso()
      }
    });
    const sp = (formula, extra) => Object.assign({ formula, coefficient: 1, gas: false, precipitate: false, isElectron: false }, extra || {});
    const cases = [
      {
        name: 'Fe^2+ 渲染为 Fe{2+}（不得出现 ^ 或把电荷数字当下标）',
        reactants: [sp('Fe^2+', { charge: 2 }), sp('OH-', { charge: -1 })],
        products: [sp('Fe(OH)2', { precipitate: true })],
        expect: 'Fe{2+} + OH{−}══Fe(OH)[2]↓',
        forbid: ['^']
      },
      {
        name: 'SO4^2- 渲染为 SO[4]{2−}',
        reactants: [sp('SO4^2-', { charge: -2 }), sp('Ba^2+', { charge: 2 })],
        products: [sp('BaSO4', { precipitate: true })],
        expect: 'SO[4]{2−} + Ba{2+}══BaSO[4]↓',
        forbid: ['^']
      },
      {
        name: 'H+ / e- 渲染为 H{+} / e{−}',
        reactants: [sp('H+', { charge: 1 }), sp('e-', { isElectron: true })],
        products: [sp('H2', { gas: true })],
        expect: 'H{+} + e{−}══H[2]↑',
        forbid: ['^']
      },
      {
        name: '中性化学式不受影响：H2O / CH3COOH',
        reactants: [sp('H2O'), sp('CH3COOH')],
        products: [sp('CO2', { gas: true })],
        expect: 'H[2]O + CH[3]COOH══CO[2]↑',
        forbid: ['^']
      }
    ];
    const results = [];
    for (const c of cases) {
      const xml = Docx.questionXml(mkItem(c.reactants, c.products), 0, 'answer', layout);
      const flat = flattenRuns(xml);
      const forbidHit = (c.forbid || []).filter((f) => flat.includes(f));
      const ok = flat.includes(c.expect) && !forbidHit.length;
      results.push({ name: c.name, ok, expect: c.expect, got: flat, forbidHit });
    }
    return results;
  }
};

// ============================================================
// 主流程
// ============================================================
function main() {
  const reg = readPatchFile();
  const patches = reg.patches || {};
  const labels = Object.keys(patches);
  if (!labels.length) {
    console.log('本地补丁登记表为空（data/ENGINE-PATCHES.json 的 patches 为空对象）→ 无需校验 ✓');
    return 0;
  }

  let pass = 0, fail = 0;
  const lines = [];
  const check = (name, ok, extra) => {
    if (ok) pass++; else fail++;
    lines.push(`${ok ? '✓' : '✗'} ${name}${extra ? '  ' + extra : ''}`);
  };

  for (const label of labels) {
    const rec = patches[label];
    const localPath = path.join(SKILL_ROOT, ...label.split('/'));
    const upstreamPath = SOURCE_ROOT ? path.join(SOURCE_ROOT, ...(rec.upstreamFile || '').split('/')) : null;
    lines.push(`── ${label}（${rec.title || ''}）`);

    if (!fs.existsSync(localPath)) { check(`${label} 本地文件存在`, false, localPath); continue; }
    const localHash = sha256File(localPath);

    if (UPDATE) {
      rec.patchedSha256 = localHash;
      rec.patchedAt = new Date().toISOString();
      if (fs.existsSync(upstreamPath)) rec.upstreamSha256 = sha256File(upstreamPath);
      lines.push(`  ↻ 已刷新登记哈希 patchedSha256=${localHash.slice(0, 12)}… upstreamSha256=${String(rec.upstreamSha256).slice(0, 12)}…`);
      pass++;
      continue;
    }

    check(`${label} 本地补丁哈希与登记一致`, localHash === rec.patchedSha256,
      localHash === rec.patchedSha256 ? '' : `登记 ${String(rec.patchedSha256).slice(0, 12)}… 实际 ${localHash.slice(0, 12)}…（重新打补丁后跑 --update）`);

    if (fs.existsSync(upstreamPath)) {
      const upHash = sha256File(upstreamPath);
      check(`${label} 上游未变（${rec.upstreamFile}）`, upHash === rec.upstreamSha256,
        upHash === rec.upstreamSha256 ? '' : `上游 ${upHash.slice(0, 12)}… 登记 ${String(rec.upstreamSha256).slice(0, 12)}… → 补丁需重新评估`);
    } else if (!SOURCE_ROOT) {
      lines.push(`  ⓘ 未配置引擎上游（--source / CHEMEQ_SOURCE）→ 跳过「上游未变」校验（本地哈希与行为断言照常）`);
    } else {
      lines.push(`  ⚠ 上游文件不可达，跳过上游哈希比对：${upstreamPath}`);
    }

    const fn = BEHAVIOR[label];
    if (fn) {
      let results;
      try { results = fn(); } catch (e) { results = [{ name: label + ' 行为断言可运行', ok: false, got: '抛错：' + e.message }]; }
      for (const r of results) {
        check('行为：' + r.name, r.ok, r.ok ? '' : `期望 ${JSON.stringify(r.expect)} 实际 ${JSON.stringify(r.got)}${r.forbidHit && r.forbidHit.length ? ' 含禁止字符 ' + JSON.stringify(r.forbidHit) : ''}`);
      }
    } else {
      lines.push(`  ⚠ ${label} 没有登记行为断言（建议补上，否则补丁只靠哈希把关）`);
    }
  }

  if (UPDATE) {
    fs.writeFileSync(PATCH_FILE, JSON.stringify(reg, null, 2) + '\n', 'utf8');
    console.log('本地补丁校验台（--update）：');
    console.log(lines.join('\n'));
    console.log(`\n已更新 ${PATCH_FILE}`);
    return 0;
  }

  console.log('本地补丁校验台（data/ENGINE-PATCHES.json）：');
  console.log(lines.join('\n'));
  console.log(`\n结果：${pass}/${pass + fail} 通过${fail ? ' ✗' : ' ✓'}`);
  return fail ? 1 : 0;
}

process.exit(main());
