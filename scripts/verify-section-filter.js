/* 功能验证：章节筛选引擎行为（直调 Generator，基于清洗后真实数据）
 * 口径说明：范围验证用 allAvailable 版本策略（不做版本类型过滤，验证「条目级范围」本身）；
 * 化学式候选过滤（chemicalOnly 等）是版本策略的正常行为，不属范围筛选语义。 */
const path = require('path');
const fs = require('fs');
const Gen = require('../src/libs/generator.js');
const K = require('../src/libs/constants.js');
const lib = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'library.json'), 'utf-8'));

let pass = 0, fail = 0;
function ok(v, msg) { if (v) pass++; else { fail++; console.error('✗', msg); } }
function eq(a, b, msg) { ok(JSON.stringify(a) === JSON.stringify(b), msg + `（期望 ${b}，实际 ${a}）`); }

function baseSettings(scopes) {
  const s = K.defaultGenerationSettings();
  s.scopes = scopes;
  s.versionStrategy = 'allAvailable'; // 不做版本类型过滤，验证范围语义
  return s;
}
function entryCount(scopes) {
  return new Set(Gen.buildCandidates(lib, baseSettings(scopes)).map(c => c.entry.id)).size;
}
const HIGH_BOOKS = ['必修第一册', '必修第二册', '选择性必修1', '选择性必修2'];

// 1) 册+章+节三级勾选出题：选一·第三章·第四节 沉淀溶解平衡
{
  const scopes = {
    books: ['选择性必修1'],
    chapters: ['第三章 水溶液中的离子反应与平衡'],
    sections: ['第四节 沉淀溶解平衡']
  };
  const expected = lib.entries.filter(e => (e.textbooks || []).some(t =>
    t.book === '选择性必修1' && t.chapter === '第三章 水溶液中的离子反应与平衡' && t.section === '第四节 沉淀溶解平衡')).length;
  const n = entryCount(scopes);
  console.log('三级筛选（选一·第三章·第四节 沉淀溶解平衡）条目数:', n, '（期望', expected + '）');
  ok(n >= 20, '沉淀溶解平衡可用条目充足（约 27 条口径）');
  eq(n, expected, '三级筛选命中数与数据核对');
  const s = baseSettings(scopes);
  s.totalCount = 10;
  const res = Gen.generate(lib, s);
  ok(res.ok, '三级勾选能出题: ' + (res.message || ''));
  eq(res.ok ? res.items.length : 0, 10, '生成 10 题');
}

// 2) 复合语义（章+节同勾）真实数据验证
{
  const scopes = {
    chapters: ['第三章 水溶液中的离子反应与平衡'],
    sections: ['第一节 电离平衡']
  };
  const expected = lib.entries.filter(e => (e.textbooks || []).some(t =>
    t.chapter === '第三章 水溶液中的离子反应与平衡' && t.section === '第一节 电离平衡')).length;
  eq(entryCount(scopes), expected, '复合语义命中数与数据核对');
}
// 2b) 跨记录不误命中：章节组合无同记录 → 0
{
  const n = entryCount({
    chapters: ['第三章 水溶液中的离子反应与平衡'],
    sections: ['第二节 乙烯与有机高分子材料']
  });
  eq(n, 0, '章+节无同记录组合 → 0 命中');
}

// 3) 初中册别 + 高中章（章不属于任何所勾册别）：章不细化任何册 → 九上整册生效
//    （v2 册别分组细化语义：章/节只细化「含它的册别」；不属于所勾册的章无法细化，
//      范围保持整册——旧“全局且”语义会把范围缩到跨册混合条目，越加条件越少，已废弃）
{
  const scopes = { books: ['九年级上册'], chapters: ['第三章 铁 金属材料'] };
  const n = entryCount(scopes);
  const expected = lib.entries.filter(e => (e.textbooks || []).some(t => t.book === '九年级上册')).length;
  eq(n, expected, '初中册+不属于它的章 → 整册语义（章被忽略）');
}

// 3b) 册别分组细化（v2 核心回归）：
//     「九上+九下」再加「必修一+第一章+第一节」→ 九上/九下整册 ∪ 必修一·第一章·第一节，
//     数量必须不少于只勾「九上+九下」（旧语义会从 74 条缩到 8 条）
{
  const A = { books: ['九年级上册', '九年级下册'] };
  const B = {
    books: ['九年级上册', '九年级下册', '必修第一册'],
    chapters: ['第一章 物质及其变化'],
    sections: ['第一节 物质的分类及转化']
  };
  const nA = entryCount(A), nB = entryCount(B);
  console.log('册别分组细化：A(九上+九下)=', nA, ' B(A+必修一+第一章+第一节)=', nB);
  ok(nB >= nA, `扩大范围不减条目（${nA} → ${nB}）`);
  const pureB = entryCount({
    books: ['必修第一册'], chapters: ['第一章 物质及其变化'], sections: ['第一节 物质的分类及转化']
  });
  // B ⊇ A ∪ 纯细化（并集可能有跨册条目重叠）
  ok(nB <= nA + pureB, 'B 不超过 A ∪ 纯细化的并集规模');
}

// 4) 只勾章：旧语义（任意记录命中）
{
  const scopes = { chapters: ['第八章 化学与可持续发展'] };
  const expected = lib.entries.filter(e => (e.textbooks || []).some(t => t.chapter === '第八章 化学与可持续发展')).length;
  const n = entryCount(scopes);
  console.log('勾「第八章」条目数:', n, '（期望', expected + '）');
  eq(n, expected, '只勾章语义');
}

// 5) 节级独立勾选（不带章）：全局节名唯一
{
  const scopes = { sections: ['第四节 沉淀溶解平衡'] };
  const expected = lib.entries.filter(e => (e.textbooks || []).some(t => t.section === '第四节 沉淀溶解平衡')).length;
  eq(entryCount(scopes), expected, '只勾节语义');
}

// 6) 排除范围与出题范围叠加（exclude 复合）
{
  const s = baseSettings({
    books: ['选择性必修1'],
    chapters: ['第三章 水溶液中的离子反应与平衡'],
    sections: ['第四节 沉淀溶解平衡']
  });
  s.totalCount = 5;
  s.exclude = { sections: ['第四节 沉淀溶解平衡'] };
  const res = Gen.generate(lib, s);
  ok(!res.ok && res.reason === 'shortage', '排除范围命中全部 → shortage');
}

console.log(`\n功能验证：通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail ? 1 : 0);
