/*
 * 有机提取分片校验（子代理每写一片立即跑一次）：
 *   node scripts/validate-organic-part.js extraction/选择性必修3.part1.json
 * 校验内容：
 *   1. JSON 可解析、顶层 book/version/entries 结构
 *   2. 必填字段与取值范围（difficulty / reactionTypes / 分类维度）
 *   3. 每条 version.line 能被 parseEquationLine 解析（含双键/三键/聚合 n 约定）
 *   4. 组装后 validateVersion：error 必须为 0（warning 允许——有机提示/聚合宽松配平）
 *   5. thermochemical 必须有 deltaH；electrode 必须有 e-
 *   6. textbooks 章节名对齐表校验
 * 输出：PASS / 逐条问题清单（exit 1 便于子代理自检循环）
 */
const fs = require('fs');
const path = require('path');
const C = require('../src/libs/chem.js');

const BOOK = '选择性必修3';
// 章节名对齐表（MD 中第三章多节标题残缺，一律按此表写）
const CHAPTERS = {
  '第一章 有机化合物的结构特点与研究方法': [
    '第一节 有机化合物的结构特点', '第二节 研究有机化合物的一般方法'
  ],
  '第二章 烃': ['第一节 烷烃', '第二节 烯烃 炔烃', '第三节 芳香烃'],
  '第三章 烃的衍生物': [
    '第一节 卤代烃', '第二节 醇酚', '第三节 醛酮',
    '第四节 羧酸 羧酸衍生物', '第五节 有机合成'
  ],
  '第四章 生物大分子': ['第一节 糖类', '第二节 蛋白质', '第三节 核酸'],
  '第五章 合成高分子': ['第一节 合成高分子的基本方法', '第二节 高分子材料']
};
const ORGANIC_REACTION_TYPES = ['取代反应', '加成反应', '消去反应', '酯化反应', '加聚反应', '缩聚反应'];
const OLD_REACTION_TYPES = ['化合反应', '分解反应', '置换反应', '复分解反应', '氧化还原反应', '离子反应',
  '可逆反应', '燃烧反应', '中和反应', '水解反应', '电离', '电极反应', '热化学反应', '其他'];
const SUB_CATS = ['单质', '氧化物', '酸', '碱', '盐', '酸式盐', '氢化物', '过氧化物', '有机物', '胶体', '混合物', '其他'];
const KNOW_MODULES = ['物质及其变化', '金属及其化合物', '非金属及其化合物', '化学反应与能量', '电化学',
  '化学平衡', '水溶液中的离子平衡', '有机化学', '化学实验', '化学与生活', '其他'];

// 条件词 → code 映射与 merge-extraction.js 保持一致
const COND_CODE = {
  '点燃': 'ignite', '加热': 'heat', '高温': 'highTemperature', '催化剂': 'catalyst',
  '通电': 'electric', '光照': 'light', '浓硫酸': 'concH2SO4', '常温': 'roomTemperature', '高压': 'custom'
};

function main() {
  const file = process.argv[2];
  if (!file || !fs.existsSync(file)) { console.error('用法: node scripts/validate-organic-part.js <part.json>'); process.exit(1); }
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const problems = [];
  const warns = [];
  if (data.book !== BOOK) problems.push('book 应为 ' + BOOK);
  let vc = 0;
  (data.entries || []).forEach((e, i) => {
    const tag = '[' + (i + 1) + '] ' + (e.name || '（无名）');
    if (!e.name) problems.push(tag + '：缺 name');
    if (!e.description) warns.push(tag + '：description 为空（C 类题需要）');
    if (!['简单', '中等', '较难'].includes(e.difficulty)) problems.push(tag + '：difficulty 非法 ' + e.difficulty);
    if (!(e.textbooks || []).length) problems.push(tag + '：textbooks 为空');
    (e.textbooks || []).forEach(t => {
      if (!CHAPTERS[t.chapter]) problems.push(tag + '：章节名不在对齐表：' + t.chapter);
      else if (!CHAPTERS[t.chapter].includes(t.section)) problems.push(tag + '：节名不在对齐表：' + t.chapter + ' / ' + t.section);
      if (!t.context) problems.push(tag + '：textbooks 记录缺 context');
    });
    const checkDims = (field, allowed) => (e[field] || []).forEach(x => {
      if (!allowed.includes(x)) problems.push(tag + '：' + field + ' 非法值 ' + x);
    });
    checkDims('substanceCategories', SUB_CATS);
    checkDims('reactionTypes', OLD_REACTION_TYPES.concat(ORGANIC_REACTION_TYPES));
    checkDims('knowledgeModules', KNOW_MODULES);
    if (!(e.versions || []).length) problems.push(tag + '：versions 为空');
    (e.versions || []).forEach((rv, j) => {
      vc++;
      const vt = tag + ' v' + (j + 1);
      const r = C.parseEquationLine(rv.line || '');
      if (!r.ok) { problems.push(vt + '：解析失败 → ' + (rv.line || '') + ' :: ' + r.errors.join('；')); return; }
      if ((rv.reversible === true) !== r.reversible && rv.reversible != null) {
        warns.push(vt + '：reversible 字段与 line 符号不一致');
      }
      const v = {
        type: rv.type, reversible: r.reversible,
        reactants: r.reactants, products: r.products,
        conditions: (rv.conditions || []).map(w => ({ code: COND_CODE[w] || 'custom', text: w, position: 'auto' })),
        extras: {}
      };
      if (rv.type === 'thermochemical') {
        if (!rv.deltaH) problems.push(vt + '：热化学缺 deltaH');
        else v.extras.deltaH = String(rv.deltaH);
      }
      const st = C.validateVersion(v);
      if (!st.ok) problems.push(vt + '：校验失败 → ' + rv.line + ' :: ' + st.errors.join('；'));
      else if (st.warnings.length) warns.push(vt + '：warning ' + st.warnings[0]);
    });
  });
  const lcPath = path.join(path.dirname(file), 'organic-low-confidence.json');
  console.log('文件: ' + file);
  console.log('entries: ' + (data.entries || []).length + '，versions: ' + vc);
  if (warns.length) { console.log('--- 警告 ' + warns.length + ' 条（不阻断）---'); warns.slice(0, 20).forEach(w => console.log('  ' + w)); }
  if (problems.length) {
    console.log('--- 问题 ' + problems.length + ' 条（必须修复）---');
    problems.forEach(p => console.log('  ' + p));
    process.exit(1);
  }
  console.log('PASS');
}
main();
