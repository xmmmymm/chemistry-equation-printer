/*
 * 一次性数据迁移：清洗导入数据的尾随空格 + 册别归一化（初中化学(x册) → 九年级x册）。
 * 用法：node scripts/migrate-user-data.js <data目录>
 * 迁移前自动备份为 <data>/backups/migrate_<timestamp>/。
 */
const fs = require('fs');
const path = require('path');

const BOOK_MAP = { '初中化学(上册)': '九年级上册', '初中化学(下册)': '九年级下册' };
const NEW_BOOKS = ['九年级上册', '九年级下册', '必修第一册', '必修第二册', '选择性必修1', '选择性必修2'];

const dataDir = process.argv[2];
if (!dataDir || !fs.existsSync(path.join(dataDir, 'library.json'))) {
  console.error('用法: node scripts/migrate-user-data.js <data目录>');
  process.exit(1);
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// 备份
const bakDir = path.join(dataDir, 'backups', 'migrate_' + stamp());
fs.mkdirSync(bakDir, { recursive: true });
for (const f of ['library.json', 'classifications.json']) {
  const p = path.join(dataDir, f);
  if (fs.existsSync(p)) fs.copyFileSync(p, path.join(bakDir, f));
}
console.log('备份 → ' + bakDir);

// ---- library.json：trim + book 归一化 ----
const lib = JSON.parse(fs.readFileSync(path.join(dataDir, 'library.json'), 'utf8'));
let trimmed = 0, remapped = 0;
for (const e of (lib.entries || [])) {
  for (const t of (e.textbooks || [])) {
    for (const k of ['version', 'book', 'chapter', 'section']) {
      const v = String(t[k] || '');
      if (v !== v.trim()) { t[k] = v.trim(); trimmed++; }
    }
    if (BOOK_MAP[t.book]) { t.book = BOOK_MAP[t.book]; remapped++; }
  }
  for (const f of ['substanceCategories', 'reactionTypes', 'knowledgeModules', 'tags']) {
    const orig = e[f] || [];
    const clean = orig.map(x => String(x).trim()).filter(Boolean);
    if (JSON.stringify(orig) !== JSON.stringify(clean)) { e[f] = clean; trimmed++; }
  }
}
fs.writeFileSync(path.join(dataDir, 'library.json'), JSON.stringify(lib, null, 2));
console.log(`library.json: ${lib.entries.length} 条，清洗字段 ${trimmed} 处，册别归一化 ${remapped} 本`);

// ---- classifications.json：册别补九年级两册 + 去掉误加到教材版本的初中册 ----
const clsPath = path.join(dataDir, 'classifications.json');
if (fs.existsSync(clsPath)) {
  const cls = JSON.parse(fs.readFileSync(clsPath, 'utf8'));
  const before = cls.books.slice();
  cls.books = NEW_BOOKS.filter(b => cls.books.includes(b) || NEW_BOOKS.indexOf(b) < 2);
  // 保留用户可能自定义的其他册别
  for (const b of before) if (!cls.books.includes(b)) cls.books.push(b);
  const badVer = cls.textbookVersions.filter(v => BOOK_MAP[String(v).trim()]);
  if (badVer.length) cls.textbookVersions = cls.textbookVersions.filter(v => !BOOK_MAP[String(v).trim()]);
  fs.writeFileSync(clsPath, JSON.stringify(cls, null, 2));
  console.log('classifications.json: books=' + cls.books.join('/') + (badVer.length ? '，移除误置于教材版本的: ' + badVer.join('/') : ''));
}

console.log('迁移完成');
