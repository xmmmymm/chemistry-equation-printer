# 启动提示词 · 实跑测试（v1.2）

> 用法：把下面「提示词正文」整段复制，粘到**新会话**的第一条消息里。
> 它自带全部必要上下文，新会话不需要本会话的任何历史。

---

## 提示词正文（复制以下全部内容）

````text
对本项目做一轮尽可能全面、详尽、细致的**实跑测试**，并修掉测试中发现的问题。

## 项目
- 路径：`chem-equation-paper`（工作目录就是它）
- 它是什么：一个「化学方程式出题 skill」——agent 澄清老师需求 → 预检可出题量 → 复述确认 →
  无头组卷导出 Word/PDF/图片 → 结构化汇报。产物落 `out/{yyyy-mm-dd}/`。
- 架构刚做过大调整（规格 v1.2）：**零项目外依赖** —— 题库数据 `data/` 是**本项目自有**
  （不再是从主项目同步的快照，改完要 `npm run data:lock`）、Electron 运行时**自带**在
  `runtime/electron/`（v33.4.11，268MB/73 文件，已 gitignore）、`npm run sync` **只同步 engine 副本**。
  另新增了 17 条离子方程式（现 392 条 / 548 版本 / 离子 142 个）。

## 第一步（必做）
按顺序读完这四份，再动手：
1. `README.md` —— 当前形态、常用命令、v1.2 变更、已知限制、历史坑表
2. `PROMPT-实跑测试方案-v1.2.md` —— **本轮测试的完整方案（Phase 0–9），照着执行**
3. `PROMPT-方程式出题skill.md` §3.2b —— v1.2 规格变更记录（规格是权威）
4. `.dsh/skills/chem-equation-paper/SKILL.md` —— skill 本体（对外承诺）

## 目标
用**真实运行**（不是读代码）验证项目在当前形态下**全部对外承诺成立**，并修掉发现的问题。
要回答这六个问题：
Q1 卷子真的出得来、内容真的对吗？　Q2「零项目外依赖」真的成立吗？
Q3「数据自持 + 数据锁」语义真的按规格吗？　Q4 补全的离子方程式化学上真的对吗？
Q5 上一轮修的 9 个坑有没有被 v1.2 改回去？　Q6 文档/话术/参考表与代码还一致吗？

## 证据标准（三层，逐层加严，不接受「通过」二字）
- **L1 存在性**：文件在、exit 0、字段有（既有 17 条 AC 主要停在这层，**不够**）
- **L2 结构性**：解析产物内部 —— `pdfinfo` 页面尺寸/页数、`pdftotext` 正文、`pdftoppm` 渲图后
  **用 read_image 肉眼核对**；docx 解压读 `word/document.xml` 的 run 序列（区分上下标）；
  PNG 尺寸与非白像素占比；`result.json` 字段与规格 §4.3 对齐
- **L3 语义性**：内容与需求一致、化学正确、跨通道一致 —— PDF 文本 ↔ docx 文本 ↔
  `result.itemsPreview` **逐题对齐**；离子方程式原子守恒 + 电荷守恒；卷内无 H 题；
  C 题有 24pt 答案线；**报告页数 == PDF 实际页数**

## 六条铁律（违反即失败）
1. **绝不写上游旧桌面版**（`chemistry-equation-printer`）：不新建、不修改、不删除任何文件（含临时文件）。
   测试前后要对上游做全量 `sha256 + bytes + mtimeMs` 快照，**必须零差异**。
2. **`data/` 是自有数据**：任何篡改（测数据锁用）都必须**先备份、后还原**；合法改动后跑
   `npm run data:lock`。测试结束 `npm run data:check` 必须复绿。
3. **`engine/*.js` 副本**（chem/constants/generator/exporter/docx/importer）要改必须走
   `data/ENGINE-PATCHES.json` 登记 + `npm run test:patches`；`engine/paper.js` 与 `engine/image.js`
   是本项目新增文件，可直接改。
4. **不引入任何 npm 依赖**（运行时已自带，也不要 `npm i electron`）。
5. **临时文件只落 `out/`**（已 gitignore），结束前清理干净。
6. **不清楚的事问我**，不要猜着改。

## 已知环境坑（别重复踩）
- 本机 Node 的 `fs.rmSync` / `rmdirSync` **删目录会被静默拦截**（`unlinkSync` 正常）
  → 清理目录一律「逐层删文件 + 尽力 rmdir」。
- 可用外部工具：`pdfinfo` / `pdftotext` / `pdftoppm`（poppler 已装）、`node` v24、`python` 3.14。
- Windows PowerShell：函数参数别叫 `$args`（自动变量），否则静默失效。

## 基线（今天实测，作为对照起点）
```
npm test          engine 238/0 · preflight 6/6 · state 9/9 · patches 6/6 · edge 62/62
data:check        ✓ 392 条 / 548 版本
runtime:check     ✓ v33.4.11 @ runtime/electron/（73 文件 / 268.0 MB）
sync:check        全部一致 ✓（engine/docx.js 标「本地补丁，上游未变」）
test:acceptance   17/17 PASS
```
Phase 0 请**自己重新量一遍**，别信上面这组数字。

## 执行方式
- 严格按 `PROMPT-实跑测试方案-v1.2.md` 的 **Phase 0 → 9** 顺序走，每完成一个 Phase 汇报一次
  （产出 / 原始证据 / 结论 / 下一步）。
- Phase 2（v1.2 新增能力：数据锁、自带运行时、离子补全）与 Phase 5（零项目外依赖实证）
  是本轮**重点**，别一带而过。
- 发现问题的修复协议见方案 Phase 8：A 自有代码直接修 / B 引擎副本走补丁登记 / C 数据走
  `data:lock` / D 规格歧义**问我**。每个修复都要「最小改动 + 注释写清现象·根因·修法 + 加回归断言」。
- 修完必须复跑：`npm test` 五套 + `npm run test:acceptance`（17/17）+ 受影响的专项。
- 把本轮新发现的边界补进 `tools/test-edge.js`（纯 Node 秒级）；涉及产物结构的补进
  `tools/acceptance.js` 或新开 `tools/test-artifacts.js`。

## 交付
1. 测试报告（按 Phase）：每条用例 → 期望 / 实测 / 原始证据片段 / 结论（PASS·FAIL·已知限制）
2. 修复清单表：现象 / 根因 / 修法 / 回归断言 / 影响面
3. 数字对账表：文档声称 vs 实测（条目·版本·离子·预检全表·运行时文件数与体积）
4. 主项目零写入证据：Phase 0 vs Phase 6 的 sha256+mtime 对比
5. 新增/更新的回归工具 + `npm test` 新计数
6. 已知限制更新（README 段）
7. 遗留待拍板项

先读完那四份文档，然后从 Phase 0 开始。有任何规格上说不清、或与实测冲突的地方，**停下来问我**。
````

---

## 附：新会话可以直接用的两句追问

- 想让它先只做诊断不动手：
  > 「先只跑 Phase 0–1，把基线和既有 AC 的结果给我看，别改任何文件。」
- 想让它重点盯 v1.2 新承诺：
  > 「Phase 2 和 Phase 5 是本轮重点：数据锁语义、自带运行时（尤其"缺失时不回退主项目"）、
  > 离子方程式补全的化学正确性、以及把主项目藏起来后能否全功能出卷。请把这两章的证据做厚。」
