/* 标题加粗黑体抽查：docx 落盘（由外层解包断言） + html/pdf 纯字符串断言 */
const fs = require('fs');
const path = require('path');
const docx = require('../src/libs/docx.js');
const K = require('../src/libs/constants.js');
const exporter = require('../src/libs/exporter.js');

const layout = K.defaultLayoutSettings();
const item = {
  entryId: 'x', versionId: 'v', questionType: 'B',
  snapshot: {
    entry: { name: '铁与氯气' },
    version: { type: 'chemical', reactants: [{ formula: 'Fe' }], products: [{ formula: 'FeCl3' }], conditions: [] }
  }
};

// html/pdf 通道：docCSS 纯字符串
const css = exporter.docCSS(layout).replace(/\n/g, ' ');
const htmlOk = /\.doc-title[^}]*SimHei/.test(css) && /\.doc-title[^}]*font-weight: bold/.test(css);
console.log('html/pdf .doc-title SimHei+bold:', htmlOk);

// docx 通道：题目卷 + 答案卷落盘，供外层解包断言
const outDir = path.join(__dirname, '..', 'build');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'tmp-title-question.docx'), Buffer.from(docx.buildDocx([item], layout, 'question')));
fs.writeFileSync(path.join(outDir, 'tmp-title-answer.docx'), Buffer.from(docx.buildDocx([item], layout, 'answer')));
console.log('docx written to build/tmp-title-{question,answer}.docx');
process.exit(htmlOk ? 0 : 1);
