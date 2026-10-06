# 任务：实现「方程式出题 skill」（chem-equation-paper）——完整实施

> 本文件是**自包含**的实施提示词，交给一个全新会话执行。会话不共享任何历史上下文，所需事实全部写在本文档内。
> 工作目录：`chem-equation-paper`　｜　规格版本：**v1.1**（v1.0 由外部 AI 六域澄清产出，本文件 §3.2 记录变更）
>
> ⚠️ **v1.2 补丁（已生效，见 §3.2b）**：`data/` 已从「主项目快照」改为**本项目自有数据**，
> `npm run sync` 只同步引擎副本、不再动数据；数据变更走 `npm run data:lock`。
> **Electron 运行时也已自带**（`runtime/electron/`，268MB，`npm run runtime:install` 装入）——
> 本项目**零项目外依赖**，主项目不在场也能完整出卷。
> 题库已补全 17 条离子方程式 → **392 条 / 548 版本**。
>
> ⚠️ **v1.3 补丁（已生效，见 §3.2c）**：预检结果新增 **`intakeCoverage`**（逐项标注必问项来源：
> `explicit` 当次问到 / `memory` 沿用上次 / `default` 系统默认）；出卷命令改为
> **`node tools/run-paper.js <job.json> --confirmed`** —— 不带 `--confirmed` 时**一个字节都不生成**
> （`CONFIRM_REQUIRED`，`exitCode 2`），把「先复述、老师点头才出」从话术升级为引擎级关卡。
> 下文凡出现「题库快照 / 快照副本 / 531 版本 / 主项目题库比对 / 借用 Electron 运行时」的表述，一律以 §3.2b 为准；
> 凡出现「`run-paper.js <job.json>`（不带 `--confirmed`）」的表述，一律以 §3.2c 为准。

---

## 角色与总目标

你是资深 Electron + Node 工程师，负责在**已就位的项目骨架**上实现一个「方程式出题 skill」：

**目标**：让 AI agent 在**澄清老师需求**后，基于题库快照自动出一份方程式卷子，导出 **Word / PDF / 图片**，
卷面格式**固定**（由 skill 内嵌模板定义），并把过程与结果结构化汇报。

**边界（最重要，违反即失败）**：
1. 本项目**独立**，与上游旧桌面版（`chemistry-equation-printer`，已废弃）**只读关系**——**绝不写入上游的任何文件**（题库、设置、历史、导出目录、备份目录全部不碰）。
2. 题库数据与引擎代码都是**副本**（已就位）；上游更新后由 `tools/sync-from-source.js` 手动同步，不做运行时联动。
3. 不引入任何 npm 依赖（Electron 运行时**本项目自带** `runtime/electron/`，见 §2.5 与 §3.2b）。

---

## 〇、开工前必读（3 分钟）

```powershell
cd "chem-equation-paper"
npm run test:engine     # 必须先看到「通过 238 项，失败 0 项」，证明引擎副本完好
npm run sync:check      # 必须看到「全部一致 ✓」，证明快照未漂移
```

两条不过，先停下来报告，不要开始写代码。

---

## 一、项目背景

### 1.1 这是什么

一个高中化学老师自用的**方程式题库**（392 条 / 531 版本），已有出题引擎、排版引擎、三种导出能力。
本 skill 把这些能力包装成"agent 可无人值守调用"的形态：`job.json` 进 → 卷子文件 + `result.json` 出。

### 1.2 为什么是独立项目

老师的要求是：skill 不与应用联动（不改题库、不进应用的历史作业、产物独立存放）。
因此本项目自带题库数据、引擎副本与 Electron 运行时，**零项目外依赖**。

### 1.3 术语

| 术语 | 含义 |
|---|---|
| **条目 entry** | 一条反应（如「氢气的燃烧」），392 条 |
| **版本 version** | 同一条目的不同写法：`chemical` 化学 / `ionic` 离子 / `ionization` 电离 / `hydrolysis` 水解 / `thermochemical` 热化学 / `electrode` 电极，共 531 个 |
| **题型 B/C/D/E/H** | B 给反应物写产物并配平｜C 给文字描述写方程式｜D 部分空格补全｜E 配平题｜**H 开放题（不可用）** |
| **版本策略** | 从条目的多个版本里取哪些（6 选 1，见 §2.2） |
| **范围 scopes** | 册 / 章 / 节 / 物质类别 / 反应类型 / 知识模块 / 标签 / 难度 |
| **可出题数** | 某范围 + 某策略下最多能出几题（**默认去重口径 = 候选条目数**） |
| **卷面模板 layoutSettings** | 决定卷子长什么样的全部参数 |

---

## 二、现状审计事实（动手前必读的代码锚点）

### 2.1 已就位的骨架（本次已建好并验证）

| 路径 | 内容 | 状态 |
|---|---|---|
| `engine/chem.js` `constants.js` `generator.js` `exporter.js` `docx.js` `importer.js` | 引擎副本（哈希与主项目一致） | ✅ |
| `engine/test-chem.js` + `engine/fixtures/sample-library.json` | 回归测试（已改写相对路径） | ✅ 238/0 通过 |
| `data/library.json` `data/classifications.json` | 题库 + 分类体系/章节树快照 | ✅ 哈希一致 |
| `data/SOURCE.json` | 快照元数据（源路径、sha256、条目数、Electron 运行时位置） | ✅ 由 sync 工具生成 |
| `tools/sync-from-source.js` | 同步 + 漂移检查（`--check` / `--data-only` / `--source=`） | ✅ 可用 |
| `tools/run-paper.js` | 出卷启动器（借 electron.exe 启动本项目 app） | ✅ 可用（app 未实现时会明确报错） |
| `docs/reference/01-数据字典.md` `02-题库统计.md` `04-可出题量预检.md` | 主项目投喂包复制（字段全表 / 统计 / 预检表） | ✅ |
| `app/` `.dsh/skills/chem-equation-paper/` | **空目录，待实现** | ⬜ |

### 2.2 引擎契约（`require('./engine/xxx.js')`）

**`constants.js` → `K`**

| 成员 | 说明 |
|---|---|
| `K.defaultGenerationSettings()` | 出题参数默认值（见 §3.3 YAML 的 `generation`） |
| `K.defaultLayoutSettings()` | 卷面参数默认值（见 §3.3 YAML 的 `layout`） |
| `K.paperSizeMm(paper)` | 纸型 → `{width, height}`（mm）；支持 `custom` 与 `landscape` |
| `K.EQ_TYPES` / `K.EQ_TYPE_MAP` | 六种版本类型 `{code, label, short}` |
| `K.QUESTION_TYPES` | `{B,C,D,E,H}` → 中文名 |
| `K.BLANK_STRATEGIES` | D 题型挖空策略（6 种） |
| `K.VERSION_STRATEGIES` | 六种版本策略的中文名 |
| `K.DIFFICULTIES` | `['简单','中等','较难']`（**题库中文值**） |
| `K.CONDITION_PRESETS` | 反应条件 code→文本（ignite 点燃 / heat △ / …） |
| `K.PAPER_SIZES` / `K.ZH_FONTS` / `K.EN_FONTS` | 纸型表 / 中文字体表 / 西文字体表 |
| `K.nowIso()` `K.uid(prefix)` `K.fmtDateTime()` `K.timestampForFile()` | 时间与 id 工具 |

**`generator.js` → `G`**

| 函数 | 语义要点 |
|---|---|
| `G.generate(library, settings, opts)` | **组卷主入口**。成功 `{ok:true, items, notices}`；失败 `{ok:false, reason, message, need?, available?}` |
| `G.buildCandidates(library, settings, opts)` | 候选池 `{entry, version}[]`；先滤 `enabled!==false` → 范围 AND → 排除 `exclude` → 展开版本 |
| `G.availableQuestionTypes(cands)` | 实际可出题型：恒有 `B/D/E`；有 `description` 加 `C`；有 `openPrompt` 加 `H` |
| `G.versionsForEntry(entry, strategy, allowedTypes, scopeTypes)` | 按策略取版本 |
| `G.entryInScope(entry, filter, refined)` / `G.refineBooksByScope(entries, filter)` / `G.scopedEntries(library, filter)` | 范围匹配（**册别分组细化**语义，见下） |
| `G.makeItem(entry, version, qType)` | 生成 item（含 `snapshot.version` 完整快照） |
| `G.typeSuitable(entry, version, qType)` | C 需 description；H 需 openPrompt；其余恒 true |

**范围语义（v2 · 册别分组细化，务必按此实现归一与预检）**：
- 勾了册别 + 章/节时：**被细化的册**要求**同一条教材记录**同时命中（册+章+节）；**未被细化的册**整册生效。
- "某册是否被细化" = 题库中是否存在 `{book:该册, chapter∈勾选章}` 或 `{book:该册, section∈勾选节}` 的记录（数据驱动）。
- 未勾册别时：章/节为**跨册**语义；章+节同勾要求同一条记录同时命中。
- 其余维度之间是**且**。

**`generate` 失败 reason 全表（必须逐条翻译，见 §3.5 B1/B2/B3/B4）**

| reason | 触发 | 附带字段 |
|---|---|---|
| `shortage` | 填不满总题数 | `need`、`available`（**候选版本数**）、`message` |
| `roundShortage` | 学习项目轮数限制导致（本 skill **不传 round，不可达**；留防御分支） | `need`、`available`、`availableUnlimited` |
| `manualExceed` | 手动必出数 > 总题数 | `message` |
| `mustExceed` | 必出题数 > 总题数 | `message` |
| `typeOverflow` | 题型指定数之和 > 总题数 | `message` |

> ⚠️ **`available` 是候选"版本"数，不是可出题数**。例：全库·全版本求 400 题 → `available=531`，实际只出得满 **392**（条目数）。
> **对外报"可出 N 题"必须用条目数**（`buildCandidates` 结果里 distinct `entry.id` 的数量）。

**`exporter.js` → `Doc`（渲染，依赖 DOM）**

| 函数 | 说明 |
|---|---|
| `Doc.buildDocument(items, layoutSettings, mode, measureBox)` | → `{html, paginated, widthMm, heightMm}`；`mode ∈ 'question' \| 'answer'` |
| `Doc.createMeasureBox()` | **依赖 DOM**（`document.createElement`）→ 必须在渲染进程里调用 |
| `Doc.renderQuestion` / `Doc.docCSS` / `Doc.paginate` / `Doc.dBlankOptions` / `Doc.stemText` / `Doc.strategySuitable` | 子函数 |

**`docx.js` → `Docx`（Word，纯 Node，无 DOM）**

| 函数 | 说明 |
|---|---|
| `Docx.buildDocx(items, layout, mode)` | → 字节（可直接写文件）；`mode ∈ 'question' \| 'answer'` |
| `Docx.toBase64(bytes)` | 转 base64（写文件用） |

**答案线覆盖语义（已审计确认）**：
- 是否画线：`item.showAnswerLine != null ? item.showAnswerLine : layout.answerLine.enabled`
- 线高：`item.answerLineHeightPt || layout.answerLine.defaultHeightPt || 24`
- → **item 级覆盖卷级**。AC-02 要求的"C 题有答案线、卷级 `answerLine.enabled=false` 不变"就靠这个实现。

### 2.3 数据契约（`data/library.json`）

顶层 `{version, updatedAt, entries[]}`。字段全表见 `docs/reference/01-数据字典.md`，此处只列**必须记住的坑**：

1. **难度两套写法**：题库 `简单/中等/较难` ↔ 引擎键 `simple/medium/hard`。
2. **默认策略 `chemicalOnly` 会大幅减量**：全库 392 条只有 **301 条**有化学版本；选择性必修 3（有机）**0 条**离子版本；选择性必修 2 只有 **6 条**条目。
3. **H 题型不可用**（`openPrompt` 全空）；`starred` / `mustInclude` 全 false；`tags` 仅 105/392 有值。
4. **章节树只覆盖高中 5 册**（19 章 50 节）；九年级两册只有教材文本（"第X单元 / 课题N"）。
5. `textbooks[]` **含完全重复记录**（767 → 去重 741），统计先去重。
6. **多价离子必须 `^` 记法**（`SO4^2-`）。
7. 条目 `questionCount` / `lastUsedAt` 在本项目中**只读不改**（v1.1 取消写回）。

### 2.4 导出通道参考实现（**移植主项目已验证的代码，不要自己发明**）

| 通道 | 主项目参考位置 | 必须照做的要点 |
|---|---|---|
| PDF | `上游旧桌面版 chemistry-equation-printer\main.js:2011-2052` | 离屏 `BrowserWindow({show:false, webPreferences:{offscreen:true, contextIsolation:true}})`；把 html 写成临时文件再 `loadFile`；等 `did-finish-load`（**带 5s 超时兜底**）+ 额外 200ms；`printToPDF({pageSize:{width: inchW, height: inchH}, margins:{0,0,0,0}, printBackground:false, preferCSSPageSize:false})` |
| 图片 | 同上 `main.js:1668-1700` | 离屏窗口 + 临时 html（放 `os.tmpdir()`）；`loadFile` 后等 250ms；用 `document.body.getBoundingClientRect()` 量尺寸（**不要用 `documentElement.scrollWidth`**，会带入右侧空白）；`setContentSize` 后等 150ms；`capturePage()`；`img.isEmpty()` 要判空 |
| Word | 同上 `main.js:1932-1945`（写文件方式） | `Docx.buildDocx(...)` → `Docx.toBase64(bytes)` → `Buffer.from(b64,'base64')` 写盘 |

> ⚠️ **PDF 最大坑**：此版本 Electron 的 `printToPDF` `pageSize` **按英寸解释**（实测 MediaBox = 传入值 × 72pt）。
> 必须 `mm / 25.4` 换算；直接传 mm 会产生 5 公里级巨型页面，PDF 查看器显示空白。
>
> ⚠️ **另一个坑**：主项目历史上有过"独立 electron 脚本加载应用的 `index.html` 会挂死（缺 IPC）"。
> 本项目**不加载主项目的 index.html**，而是自带一个**自包含**的薄渲染壳（§2.7），因此不会踩这个坑。

### 2.5 Electron 运行时事实（v1.2：本项目自带，不借用）

- `electron.exe` 是**通用运行时**：`electron.exe "<任意 app 目录>"` 可运行任何 Electron 应用。
- ~~本项目借用：`上游旧桌面版 chemistry-equation-printer\node_modules\electron\dist\electron.exe`（v33.4.11，180MB）~~
  **【v1.2 已改】**运行时实体已复制进本项目 `runtime/electron/`（v33.4.11，268MB / 73 文件），
  路径记录在 `data/SOURCE.json` → `electronRuntime.path`；装入/校验用 `npm run runtime:install` / `runtime:check`。
- 启动方式：`node tools/run-paper.js <job.json>`（该脚本已实现：解析运行时路径 → `spawn(electron, [SKILL_ROOT], {stdio:'inherit', env:{SKILLJOB}})` → 转发退出码）。
  解析顺序：`CHEMEQ_ELECTRON`（显式覆盖，越界告警）→ `SOURCE.json`（**必须项目内**）→ `runtime/electron/`；`--print-runtime` 可查实际路径。
- **不要 `npm i electron`**（运行时已自带，装了会重复 268MB）。若运行时缺失，脚本会给出明确提示。

### 2.6 已澄清的 5 项"资料未覆盖"事实（本次已从主项目代码查实，直接采信）

| # | 原待补充项 | 查实结果 |
|---|---|---|
| 1 | `settings.export` 含答案键名 | **`includeAnswer`**（boolean，默认 `true`；消费点 `src/js/worksheet.js:1030/1042/1054`，判断方式 `!== false`）。本项目不读应用设置，**自定义为 `export.includeAnswers`**（语义相同） |
| 2 | `buildDocx` 的 `mode` 取值 | **`'question'` \| `'answer'`**（`src/libs/docx.js:196/204/247/281/291/305`；调用点 `worksheet.js:1025-1056`）。`docx.js:247` 逻辑：`answer` 模式，或 `question` 模式下题型 **不属于 B/C/H** 时才输出答案线/答案相关元素 |
| 3 | `item.showAnswerLine` 覆盖优先级 | **item 级优先**：`item.showAnswerLine != null ? item.showAnswerLine : layout.answerLine.enabled`（`exporter.js:294`，同 `worksheet.js:250/632`）；高度 `item.answerLineHeightPt \|\| layout.answerLine.defaultHeightPt \|\| 24`（`exporter.js:296`） |
| 4 | 历史作业记录 schema | `data/history/worksheet_<id>.json`，对象 = worksheet：`{id, title, createdAt, updatedAt, projectId, generationSettings, layoutSettings, items, exportRecords, tempEntries, remark}`（`main.js:1817-1825` 写入；`app.js:163-176` 构造；`main.js:1790` 列出时要求 `ws.id`、用 `ws.title`）。**v1.1 已取消写入历史**，此事实仅备查 |
| 5 | 《常见遗漏清单》原件 | 即主项目 `PROMPT-方程式出题skill-需求厘清方案.md` §5 的 **P10**。全文 11 条已内联到本文档 **§6.3**，不必再去外部找 |

### 2.7 无头驱动范式（本项目采用的设计）

主项目用"env 变量 + `webContents.executeJavaScript`"驱动（`main.js:190` 的 `createWindow()` 内，共 7 个通道）。
本项目采用**同范式但自包含**的精简版：

```
tools/run-paper.js  →  electron.exe "<SKILL_ROOT>"   (env: SKILLJOB=<job.json 绝对路径>)
                          ↓
app/main.js（Electron 主进程，阶段 4 实现）
   ① 读 job.json
   ② require('./engine/generator.js') → 纯 Node 组卷（无需窗口）
   ③ require('./engine/docx.js')      → 纯 Node 出 Word（无需窗口）
   ④ 需要 DOM 的部分（分页/HTML/图片）→ 开离屏窗口加载 app/harness.html
      用 executeJavaScript 调 window.__harness.buildDocument(...) 拿 {html,widthMm,heightMm}
   ⑤ 用 html 走 PDF / 图片通道（§2.4）
   ⑥ 写 result.json → app.exit(0)；失败 → 打印 JSON 错误 → app.exit(非0)
app/harness.html（薄渲染壳）
   <script src="../engine/chem.js"></script>
   <script src="../engine/constants.js"></script>
   <script src="../engine/exporter.js"></script>
   window.__harness = { buildDocument, createMeasureBox, renderQuestion, ... }
   （引擎是 UMD：无 module 环境时挂到 root.Chem / root.Const / root.DocBuilder）
```

**注意**：`harness.html` 用普通 `<script src>` 加载即可，**不要**开 `nodeIntegration`、**不要**自建 IPC（主进程用 `executeJavaScript` 调用页面里的全局函数就够）。

---

## 三、需求规格 v1.1（已拍板，不得变更）

### 3.1 十二决策块

| # | 决策块 | 确定值 |
|---|---|---|
| 1 | 使用者场景 | 三预设包：`homework` 课后作业（默认）/ `timedDrill` 课堂限时练 / `examPrep` 备考；调用时按名指定；调用前确认 |
| 2 | 范围口径 | 单层 `scopes`：默认全库 + 调用时叠加；册/章/节优先映射 + 口语归一 + 零命中/多候选拦截；**运行时条目数预检** |
| 3 | 版本策略 | **每次必问、无静默默认**；建议 `preferChemical`；离子专练临时 `preferIonic`/`ionicOnly` |
| 4 | 题量题型 | 默认 10 题；`questionTypeCounts` 全 0 自动补足；**H 恒 0**；C 题自动开答案线 |
| 5 | 难度 | 不限制（软约束）；notices 原文转述 + 实际分布表 |
| 6 | 去重必出 | 同条目一卷一次；`includeMustInclude=false` 恒定；`manualEntryIds` 临时必出 + 预检拦截 |
| 7 | 卷面模板 | skill 内嵌固定 YAML（§4.6）：A4 纵 / 2cm / 1 栏 / 宋体+TNR 16/12/10.5 / 单倍 / 题距 6 / 自动分页 / 页脚页码；标题与学生栏随场景包 |
| 8 | 答案 | 恒双卷；PDF `_题目`/`_答案`；Word 双卷（`mode='question'`/`'answer'`） |
| 9 | 导出 | **PDF 双卷 + Word 双卷同产**；图片点名才产（默认规格见 YAML）；通道隔离回退 |
| 10 | 落盘 | 产物 `out/{yyyy-mm-dd}/`；`_pending` 同目录；记忆/归档 `.dsh/skill-state/`；**不写主项目任何位置** |
| 11 | 交互 | 两段式（intake 4 问 → 复述框 → 确认）；三清单；冲突链 **当次 > 记忆 > 默认**；全量报告 |
| 12 | 异常 | B1–B14 定稿（§3.5） |

### 3.2 规格变更记录 v1.0 → v1.1（**必读，防止照旧条款去写主项目**）

变更原因：老师拍板「skill 不与主项目联动，是单独的另一个项目」。

| 原 v1.0 条款 | 处置 | v1.1 |
|---|---|---|
| §10 落盘 `data/exports/{日期}/`（主项目） | **替换** | `out/{yyyy-mm-dd}/`（本项目） |
| §statistics 写回 `library.json`（事务 + 备份 + 乐观锁） | **整段作废** | 不写任何题库数据；`questionCount`/`lastUsedAt` 只读 |
| §history 写主项目 `data/history/` | **整段作废** | 不写主项目历史作业 |
| §dirs.backups 主项目 `data/backups/` | **作废** | 本项目不备份题库（无写回即无需） |
| 乐观锁比对 `library.updatedAt` | **降级** | 改为**快照漂移检测**：`npm run sync:check`（`tools/sync-from-source.js --check`），漂移不阻塞出卷，但报告里标注快照时间 |
| §5 需新增能力「事务写回 + 乐观锁 + 自动备份（中）」「历史作业写入器（中）」 | **删除** | 工作量减少两块 |
| `skill-state/`（项目根） | **修正** | `.dsh/skill-state/`（已 gitignore）；固定模板与预设包放**版本化**的 `.dsh/skills/chem-equation-paper/` 内 |
| AC-01 / AC-08 / AC-09 | **重写** | 见 §3.4（并新增 AC-16 / AC-17） |
| 落盘目录含主项目 `data/` 的一切引用 | **全部替换** | 见 §4.1 |

> **`_pending.json` 保留**（导出失败留痕），位置改为 `out/{yyyy-mm-dd}/_pending.json`。

### 3.2b 规格变更记录 v1.1 → v1.2（数据自持 + 离子方程式补全）

变更原因：老师拍板「**把本项目的数据独立出来，不要依赖于项目文件夹外的快照**」，并要求审计/补全离子方程式。

| 原 v1.1 条款 | 处置 | v1.2 |
|---|---|---|
| `data/library.json` / `classifications.json` = 主项目**快照副本** | **反转** | 改为**本项目自有数据（source of truth）**，`tools/sync-from-source.js` 不再同步、不再覆盖 |
| `data/SOURCE.json` = 快照元数据（源路径 / 源哈希 / 同步时间） | **改写** | 改为**数据锁**（`library` / `classifications` 哈希 + 计数）+ `origin`（历史来源，仅供溯源）+ `sourceProject`（引擎上游） |
| B12「漂移」= 主项目题库已更新 | **改语义** | 改为「**本地题库 vs 数据锁**不一致」（`data/` 被项目之外改动）；仍**不阻塞出卷**，报告里标注 |
| `npm run sync` 同步 data + engine | **收窄** | 只同步 **engine 副本**；数据变更改走 `npm run data:lock`（重新锁定）/ `npm run data:check`（只校验） |
| 主项目不可达 → `sync:check` exit 2 | **放宽** | 主项目不可达时跳过引擎上游比对，**数据锁照常校验**（本项目可脱离主项目独立运行） |
| Electron 运行时**借用**主项目 `node_modules/electron/dist/`（180MB） | **反转** | 整份 dist 复制进本项目 **`runtime/electron/`**（v33.4.11，268MB / 73 文件，逐文件 sha256 校验一致）；新增 `tools/install-runtime.js`（`npm run runtime:install` / `runtime:check`）；`tools/run-paper.js` **只接受项目内路径**，不再有主项目兜底 |
| AC-08「主项目题库被外部修改」 | **重写** | 「**本地** `data/library.json` 被项目之外改动 → `sync:check` 报数据锁不一致（exit 1）；skill 仍能出卷」 |
| 题库 392 条 / **531 版本** | **数据变更** | 补全 17 条离子方程式 → 392 条 / **548 版本**（离子方程式 125 → 142 个） |

> 本项目**零项目外依赖**：数据（`data/` 自有）、引擎（`engine/` 副本）、运行时（`runtime/electron/` 自带）全在项目内。
> 主项目路径只剩两处**可选开发期**用途：`npm run sync`（拉引擎副本）与 `npm run runtime:install`（重新装入运行时）。
> 离子方程式补全的逐条依据见 `docs/reference/05-离子方程式补全记录.md`。

### 3.2c 规格变更记录 v1.2 → v1.3（intake 覆盖度 + 确认闸门）

变更原因：老师追问「**agent 会在生成前尽可能地厘清需求吗**」。核查后确认：澄清原本只是
`SKILL.md` 的**流程约定 + 话术**，引擎侧没有任何关卡，存在两处真实缺口（均为实测）：

| # | 缺口 | 实测证据 |
|---|---|---|
| 1 | `restate.versionStrategyAsked` **不能**证明「agent 问过老师」 | 源码即 `versionStrategy !== 'ASK'`；**记忆补上的同样为 `true`** |
| 2 | 没有确认关卡，agent 不看复述框也能出卷 | `app/main.js` 只过滤 `BLOCKING_CODES`；`{"jobVersion":1,"generation":{"totalCount":10}}` 这种什么都没说的 job 会被记忆补成「跟上次一样」并 **`exit 0` 放行** |

| 原 v1.2 条款 | 处置 | v1.3 |
|---|---|---|
| 预检只给 `restate`（复述框素材） | **新增** | 结果里加 **`intakeCoverage`**：`items[]`（`key`/`label`/`required`/`source`/`value`）、`explicitKeys` / `memoryKeys` / `defaultKeys`、`unasked[]`（被记忆或默认替答的**必问项**）、`needsConfirm[]`、`verdict`、`note`。判来源办法：记忆合并**之前**留一份「当次原始 job」（`rawJob`），逐项比对 |
| 「先复述、老师点头才出」= 流程约定 + 话术 | **升级为引擎级关卡** | `run-paper` 不带 `--confirmed` → 只回 `CONFIRM_REQUIRED` + `restate` + `intakeCoverage`，**零卷子产出**（`exitCode 2`，只写 `result.json`）；`--confirmed`（经 `CHEMEQ_CONFIRMED` env 传给 child）才进导出 |
| 复述框五块 | **扩为六块** | 第六块「intake 覆盖度」：必问 3 项 + 关键可默认项的来源必须如实讲；`verdict=intake-incomplete` 时**先点明哪几项不是老师说的**，再请老师确认 |
| 无 | **新增 AC-18** | 见 §3.4；同时 AC-12 加 4 条断言（记忆补上的必问项必须标 `memory`、`verdict=intake-incomplete`、`unasked` 点名、题量仍是 `explicit`） |
| `test-edge` 93 项 | **扩充** | 93 → **106** 项（新增 N 段 13 项：来源三档 / verdict 三态 / `--no-memory` 无 memory 来源） |

`verdict` 三档：`intake-complete`（必问 3 项都 `explicit`）/ `intake-incomplete`
（有必问项被记忆或默认替答 → `unasked[]` 列出）/ `blocked`（版本策略仍是 ASK）。

> **豁免**：`--render-check`（只截图）与 `job.dryRun:true`（只组卷）不产交付物，不受闸门约束。
> **行为变更（破坏性）**：出卷命令从 `run-paper.js <job>` 变为 `run-paper.js <job> --confirmed`；
> `tools/acceptance.js` 的 `runPaper()` 已统一带上（那些用例模拟的就是「老师已确认」）。
> 落地位置：`tools/preflight.js`（`buildIntakeCoverage`）、`app/main.js`（闸门）、
> `tools/run-paper.js`（`--confirmed`）、`tools/acceptance.js`（AC-18 + AC-12 断言）、
> `tools/test-edge.js`（N 段）；文档：`SKILL.md` §2/§3.2/§3.2b/§5/§7、
> `references/文案模板.md`、`references/决策清单.md` §六、`README.md`。

### 3.3 机器可读 YAML（定稿）

> **版本口径**：正文仍是 v1.1 的条款文本，但**当前生效版本是 v1.3** ——
> v1.1 → v1.2 的三处变更（`data/` 改本项目自有 + 数据锁、Electron 运行时时自带、
> 离子方程式补全）见 §3.2b；v1.2 → v1.3 的两处变更（`intakeCoverage` 覆盖度报告、
> `--confirmed` 确认闸门）见 §3.2c。下面的 YAML 块里没有需要随 v1.2 改写的字段
> （`data/` 归属与运行时来源都不是 job 参数）；v1.3 只改了 `headless.launcher` 并新增
> `headless.confirmGate`，故把 `specVersion` 升到 `1.3`。

```yaml
skill: chem-equation-paper
specVersion: 1.3                       # v1.1 正文 + §3.2b（数据自持/自带运行时/离子补全）+ §3.2c（覆盖度/确认闸门）
scenarioPresets:                      # 阶段 1 落地为 .dsh/skills/chem-equation-paper/presets.yml
  homework:   {title: 化学方程式作业,        studentInfoEnabled: false}
  timedDrill: {title: 化学方程式课堂限时练,   studentInfoEnabled: true}
  examPrep:   {title: 化学方程式备考练习,     studentInfoEnabled: true}
  common:     {subtitle: "", note: "",
               header: {enabled: false, text: "", useTitle: false},
               footer: {enabled: true, format: number},
               studentInfoFields: [姓名, 班级, 日期]}
generation:                           # → generate(library, settings, opts).settings
  scopes: {}                          # 调用时叠加；默认全库
  exclude: {}
  totalCount: 10                      # 调用前确认，可改
  questionTypeCounts: {B: 0, C: 0, D: 0, E: 0, H: 0}   # H 恒 0
  difficultyMode: counts
  difficultyCounts: {simple: 0, medium: 0, hard: 0}
  difficultyRatios: {simple: 0, medium: 0, hard: 0}
  versionStrategy: ASK                # skill 指令：必问；建议 preferChemical；答"推荐/照旧"取 preferChemical
  allowedVersionTypes: []             # 仅 versionStrategy=custom 时生效
  includeMustInclude: false
  allowDuplicateEntry: false
  allowSameEntryDifferentVersion: false   # 仅作为 shortage 第四逃生选项临时开启
  manualEntryIds: []                  # 调用时临时必出；进预检防 exceed
opts:                                 # → generate 的 opts（本项目全部不传）
  projectScope: {}                    # 学习项目机制不参与：恒空
  projectCounts: null
  round: null                         # 不传 → roundShortage 不可达
  allowOverRound: null
layout:                               # 固定模板（阶段 1 落地为 .dsh/skills/chem-equation-paper/layout.yml）
  paper: {size: A4, orientation: portrait, customWidthMm: 210, customHeightMm: 297}
  margins: {top: 2cm, bottom: 2cm, left: 2cm, right: 2cm}
  columns: 1
  columnGapMm: 8
  font: {chinese: SimSun, latin: Times New Roman, titleSizePt: 16, bodySizePt: 12, noteSizePt: 10.5}
  spacing: {lineSpacing: single, customLineSpacingPt: 20, questionSpacingPt: 6}
  answerLine: {enabled: false, defaultHeightPt: 24, thickness: thin, color: "#000000"}
  fixedQuestionsPerPage: 0
  title: "@preset.title"
  studentInfo: {enabled: "@preset.studentInfoEnabled", fields: [姓名, 班级, 日期]}
perItemRules:                         # 阶段 3 实现：组卷后注入
  - when: "item.questionType == 'C'"
    set: {showAnswerLine: true, answerLineHeightPt: 24}   # 覆盖语义见 §2.6 #3（已确认）
export:
  channels: {pdf: always, docx: always, images: onDemand}
  pdf:  {dual: true, suffix: [_题目, _答案]}
  docx: {dual: true, mode: {question: question, answer: answer}}
  includeAnswers: true
  imageOptions: {mode: single, versionScope: main, allowedTypes: [chemical], number: false,
    showName: false, showType: false, showDifficulty: false, showTextbook: false,
    fontPt: 16, metaFontPt: 10, scale: 2, cols: 1, format: png, textAlign: left, eqAlign: left,
    gapPt: 4, padPt: 27, zhFont: Microsoft YaHei, enFont: Times New Roman,
    heightMode: auto, canvasHeightPt: 120, vAlign: middle, baseName: 化学方程式, saveMode: auto}
  naming:
    pattern: "{yyyy-mm-dd}_{scenario}_{totalCount}题{volumeSuffix}{collisionSuffix}{ext}"
    volumeSuffix: {question: "_题目", answer: "_答案"}
    sanitize: '将 \ / : * ? " < | > 替换为 _'
    collision: "-2 … -99"
  dirs: {out: "out/{yyyy-mm-dd}/", pending: "out/{yyyy-mm-dd}/_pending.json",
         skillState: ".dsh/skill-state/", archive: ".dsh/skill-state/archive/"}
  failure: {isolateChannels: true, pendingOnAllFail: true}
statistics: {enabled: false}          # v1.1：不写回题库（原 v1.0 整段作废）
history: {enabled: false}             # v1.1：不写主项目历史作业
interaction:
  flow: [intake, restate, confirm, execute, report]
  intakeQuestions: [scenario, scopeNL, versionStrategy, extraAcceptance]
  mustAsk: [scenario, scopeNL, versionStrategy]
  restateModifiable: [totalCount, questionTypeCounts, difficultyTargets, manualEntryIds, exclude, exportChannels, imagesOnDemand]
  neverAsk: [layoutSettings, allowDuplicateEntry, includeMustInclude, projectBinding]
  restateFrame: [全参数表, 范围映射结果, 预检可出题数(条目数), 文件名预览, 快照时间与漂移状态]
  conflictPriority: [currentInstruction, memory, systemDefault]
  memory: {file: ".dsh/skill-state/last-run.json",
           fields: [scenario, scopes, versionStrategy, totalCount, questionTypeCounts, difficulty, extraTemplate],
           corruptFallback: 系统默认 + 一行说明}
  report: [各通道路径, 卷面统计(题量/题型实际/难度实际/范围命中), notices 原文,
           快照信息(时间/条目数/漂移状态), 参数 YAML 存档, 题卷/答案卷页数]
exceptions: {B1: 运行时条目数权威+四选项流, B2: 防御翻译分支, B3: 复述框拦截,
  B4: 等比缩+最大余数, B5: notices 转述不重试, B6: 零命中/多候选列候选,
  B7: 拒绝+替代, B8: 归一表+枚举拒绝, B9: 导出失败留 _pending+红字,
  B10: 手动重试+30天归档, B11: 失效 ID 拦截, B12: 快照漂移检测（不阻塞）,
  B13: 自然分页+报页数, B14: 后缀避让+通道隔离回退}
batch: none                           # v1.1 一次一份
headless: {driver: env, envVar: SKILLJOB, launcher: "node tools/run-paper.js <job.json> --confirmed",
           confirmGate: "不带 --confirmed → CONFIRM_REQUIRED，零卷子产出（exitCode 2）；dryRun/render-check 豁免",
           wordPhase: pureNode, pdfImagePhase: electron(bundled),
           output: "result.json + exit code"}
```

### 3.4 验收用例（15 条 + v1.1 新增 2 条 + v1.3 新增 1 条 = 18 条）

| # | 类型 | 输入 | 预期 |
|---|---|---|---|
| AC-01 | 应成功 | 场景=homework、范围=全库、策略=preferChemical、10 题 | PDF 双卷 + docx 双卷落 `out/{yyyy-mm-dd}/`；命名合规；报告含页数/notices/快照信息；**主项目 data/ 下所有文件 sha256 与 mtime 不变** |
| AC-02 | 应成功 | 卷中含 C 题 | C 题有 24pt 答案线，B/D/E 无；卷级 `answerLine.enabled=false` 不变 |
| AC-03 | 应成功 | 场景=timedDrill vs homework | 前者标题「化学方程式课堂限时练」+ 学生栏三项；后者「化学方程式作业」无栏；两者页脚页码在 |
| AC-04 | 应拦截 | 范围=选择性必修2、10 题 | 复述框报可出 **6**（条目数）+ 四选项；不调 generate、无文件产出 |
| AC-05 | **应失败** | 范围=选择性必修3 + ionicOnly + 10 题 | 拒绝并文案「命中 0 条条目（非版本策略损失）」（预检表该格=0）；无文件 |
| AC-06 | **应失败** | intake 要求「来 2 道开放题」 | B7 拒绝 + 建议改 C 题型；卷内无 H |
| AC-07 | **应失败** | manualEntryIds 12 个 + totalCount=10 | B3 复述框拦截给三选项；不进 generate |
| AC-08 | 应成功 | 主项目 library.json 被外部修改后运行 | `sync:check` 报告漂移（exit 1）；skill 仍用旧快照出卷；报告标注快照时间与漂移状态 |
| AC-09 | 应成功 | 快照文件缺失/不可读 | 明确报错、退出码非 0、不产出半成品（或按 §3.5 B9 留 `_pending`） |
| AC-10 | 应成功 | 模拟 printToPDF 抛错 | Word 正常产出 + 报告注明 PDF 失败；**≥1 通道成功即算成功** |
| AC-11 | 应成功 | 同日同场景同题量出第二份 | 第二份文件名带 `-2`；旧文件字节不变 |
| AC-12 | 应成功 | 二次调用「跟上次一样但 15 题」 | 记忆供范围/策略；仅复述变化项 + 预检数刷新；记忆文件更新 |
| AC-13 | 应成功 | `difficultyCounts={simple:8,medium:1,hard:1}` | generate 仅调 1 次；notices 原文转述 + 实际分布表 |
| AC-14 | 应成功 | 附加要求「钠相关≥2 题」+ 全库 | snapshot 验后核查；不满足重抽 ≤1 次；报告核查结果 |
| AC-15 | 应成功 | env 无头跑全流程 | **无任何对话框**；打印 JSON；exit 0；文件落 `out/{yyyy-mm-dd}/` |
| **AC-16** | 应成功 | `npm run test:engine` | 输出「通过 238 项，失败 0 项」 |
| **AC-17** | 应成功 | 出卷前后对主项目做全量 sha256 快照 | **零差异**（证明只读边界）；`tools/sync-from-source.js --check` 通过 |
| **AC-18** | 应成功 | ① 同一 job 跑 `run-paper` 不带 `--confirmed`；② 带 `--confirmed`；③ `dryRun:true` 不带 `--confirmed` | ① `exit 2` + `CONFIRM_REQUIRED` + **零卷子产出**（仅 `result.json`，内含 `restate` + `intakeCoverage`）；② `exit 0` + 正常出卷；③ 豁免放行。另断言覆盖度来源标注：必问 3 项 `explicit`、未给项非 `explicit`、`unasked`/`needsConfirm` 正确（§3.2c） |

### 3.5 异常与边界 B1–B14（定稿行为）

| # | 情形 | 定稿行为 |
|---|---|---|
| **B1** | 题量不足 / 候选 0 | **运行时条目数为唯一权威**（预检表只作建议话术）；不足 → **四选项流**：①减题量 ②放宽范围 ③换版本策略 ④允许同条目不同版本（临时开 `allowSameEntryDifferentVersion`）；候选 0 文案「命中 0 条条目（非版本策略损失）」 |
| **B2** | `roundShortage` | 本项目不传 `round` → 不可达；**保留防御翻译分支**并附注"（本项目不应出现，请检查 opts）" |
| **B3** | `manualExceed` / `mustExceed` | **复述框阶段拦截**，给选项（减必出 / 升题量 / 改优先但不保证），**不进 generate** |
| **B4** | `typeOverflow` | **等比缩 + 最大余数法**取整，保证 Σ = `totalCount`；复述框给「原请求 → 缩后」对照 |
| **B5** | 难度软约束未满足 | notices 原文转述 + 实际分布表；**不重试** |
| **B6** | 范围零命中 / 章名不存在 / 多候选 | 复述框阶段校验 + **列出候选**让用户选；**禁止自动放宽到全库** |
| **B7** | 请求 H / mustInclude / starred | 明确拒绝 + 理由 + 替代（H→C 题型；mustInclude→`manualEntryIds`；starred→`tags` 筛选） |
| **B8** | 口语记法 / 非枚举值 | **归一映射表**（难度中英、册别简称、章名简称、全半角）；多候选 → 走 B6；枚举外拒绝并附枚举表 |
| **B9** | 导出失败 / 写盘失败 | 各通道独立隔离；失败通道记入 `_pending`；**导出成功但部分失败时红字提示**；`.tmp` + rename 事务写 |
| **B10** | `_pending` 生命周期 | **手动触发重试**（intake 轮提示存在未完成项）；**>30 天归档**到 `.dsh/skill-state/archive/`（**不是主项目 trash.json**） |
| **B11** | 手选指向已禁用/已删条目 | 复述框前列失效 ID + 原因，要求剔除 |
| **B12** | 快照漂移 | `sync:check` 比对 sha256；漂移**不阻塞出卷**，但报告标注"快照时间 X / 主项目已更新 Y" |
| **B13** | 溢页 / 页数不齐 | 接受自然分页；报告题卷/答案卷页数；**不裁剪、不补空白页** |
| **B14** | 文件被占用 / 目录不可写 | 后缀避让 `-2 … -99`；仍失败 → 通道隔离；全失败 → 留 `_pending` + 报路径 |

### 3.6 明确不做（v1.1）

H 开放题；mustInclude/starred 机制；学习项目挂靠（`projectScope`/`projectCounts`/`round`）；
批量/AB 卷与跨卷避重；覆盖约束（每节≥1 题）；读主项目 `settings.json` 的卷面默认与 `data/templates/`；
图片 multi 模式；难度未满足自动重试；强制裁页/补空白页；`saveMode=ask` 弹框；`_pending` 自动重试；
主项目 UI 同步；独立事件流水表；联网/云；**任何对主项目的写入**；`.md` 作为 Word/PDF 的上游（见 §7 坑 9）。

---

## 四、数据与文件设计

### 4.1 目录布局（最终形态）

```
chem-equation-paper\
├─ .dsh\
│  ├─ skills\chem-equation-paper\        ★入库
│  │  ├─ SKILL.md                        阶段 1：skill 本体（含三清单）
│  │  ├─ layout.yml                      阶段 1：固定卷面模板
│  │  ├─ presets.yml                     阶段 1：场景预设包
│  │  └─ references\
│  │     ├─ 归一映射表.md                 阶段 2
│  │     ├─ 文案模板.md                   阶段 5（复述框/报告/拒绝/红字）
│  │     └─ 决策清单.md                   阶段 1（必问/可默认/永不问）
│  └─ skill-state\                       gitignore
│     ├─ last-run.json                   阶段 6
│     └─ archive\                        阶段 6
├─ app\
│  ├─ main.js                            阶段 4：Electron 主进程（env SKILLJOB）
│  └─ harness.html                       阶段 4：薄渲染壳（加载 engine/*）
├─ engine\  data\  docs\reference\  tools\   ✅ 已就位
├─ out\                                  gitignore（产物）
├─ README.md  package.json  .gitignore    ✅ 已就位
└─ PROMPT-方程式出题skill.md              本文件
```

### 4.2 `job.json`（无头入参，阶段 4 实现）

```json
{
  "jobVersion": 1,
  "scenario": "homework",
  "generation": { "totalCount": 10, "versionStrategy": "preferChemical",
                  "scopes": {}, "exclude": {}, "questionTypeCounts": {"B":0,"C":0,"D":0,"E":0,"H":0},
                  "difficultyMode": "counts", "difficultyCounts": {"simple":0,"medium":0,"hard":0},
                  "manualEntryIds": [], "allowSameEntryDifferentVersion": false },
  "export": { "pdf": true, "docx": true, "images": false, "imagesOnDemand": null },
  "layoutOverrides": {},
  "outputDir": null,
  "dryRun": false
}
```

### 4.3 `result.json`（无头出参）

```json
{
  "ok": true,
  "exitCode": 0,
  "scenario": "homework",
  "snapshot": { "updatedAt": "2026-09-05T05:54:08.257Z", "entries": 392, "versions": 531,
                "drift": false, "syncedAt": "..." },
  "generation": { "requested": 10, "produced": 10, "typeActual": {"B":6,"C":2,"D":1,"E":1},
                  "difficultyActual": {"简单":3,"中等":5,"较难":2},
                  "scopesHit": {"books": ["必修第一册"], "entries": 108},
                  "notices": [] },
  "channels": { "pdf":   [{"role":"question","path":"...","bytes":123456,"pages":2},
                          {"role":"answer","path":"...","bytes":120000,"pages":2}],
                "docx":  [{"role":"question","path":"...","bytes":45000},
                          {"role":"answer","path":"...","bytes":44000}],
                "images": [] },
  "failures": [],
  "pendingPath": null,
  "restate": { "...": "复述框素材：场景/题量/题型/难度/版本策略/范围映射/可出题数/文件名/快照/通道" },
  "intakeCoverage": { "...": "v1.3：必问项来源标注 items[] + explicitKeys/memoryKeys/defaultKeys + unasked[] + needsConfirm[] + verdict（§3.2c）" },
  "params": { "...": "本次实际生效的完整参数（即 §3.3 YAML 实例）" }
}
```

> v1.3：未带 `--confirmed` 时 `result.json` 里 `ok:false` / `exitCode:2` /
> `error.code:"CONFIRM_REQUIRED"`，并**照常带** `restate` + `intakeCoverage`（供 agent 复述、老师确认）。

### 4.4 `.dsh/skill-state/last-run.json`（偏好记忆）

```json
{ "version": 1, "updatedAt": "2026-09-19T...",
  "last": { "scenario": "homework", "scopes": {}, "versionStrategy": "preferChemical",
            "totalCount": 10, "questionTypeCounts": {"B":0,"C":0,"D":0,"E":0,"H":0},
            "difficulty": {"mode":"counts","counts":{"simple":0,"medium":0,"hard":0}},
            "extraTemplate": null } }
```
损坏时：系统默认 + 一行说明（不阻塞）。

### 4.5 `out/{yyyy-mm-dd}/_pending.json`（失败留痕）

```json
{ "createdAt": "...", "jobPath": "...", "params": { "...": "..." },
  "failed": [{"channel":"pdf","role":"answer","error":"...","at":"..."}],
  "succeeded": [{"channel":"docx","role":"question","path":"..."}],
  "retryHint": "修好环境后重新执行：node tools/run-paper.js <job.json>" }
```

### 4.6 固定卷面模板（`.dsh/skills/chem-equation-paper/layout.yml`）

直接落 §3.3 YAML 的 `layout` 段（含 `@preset.title` / `@preset.studentInfoEnabled` 两个占位符，
运行时由场景预设包解析）。**不读主项目 `settings.json`。**

### 4.7 场景预设包（`.dsh/skills/chem-equation-paper/presets.yml`）

直接落 §3.3 YAML 的 `scenarioPresets` 段。

---

## 五、实施阶段（顺序执行，每阶段完成即自检）

### 阶段 0 · 基线自检（**必须先做**）

```powershell
cd "chem-equation-paper"
npm run test:engine      # 期望：通过 238 项，失败 0 项
npm run sync:check       # 期望：全部一致 ✓（exit 0）
git status               # 确认工作区干净
```
不通过就停下报告，不要继续。

### 阶段 1 · skill 本体与固定模板

产出：
- `.dsh/skills/chem-equation-paper/SKILL.md`：frontmatter（`name`/`description`/`version`，**不要**写 `disable-model-invocation`）
  + 触发语义（"出一份…方程式卷"）+ 两段式流程 + 三清单 + 调用方式（`node tools/run-paper.js <job.json>`）
  + 边界声明（只读主项目）
- `layout.yml`、`presets.yml`
- `references/决策清单.md`（必问 3 项 / 可默认项 / 永不问项）

自检：用文本编辑器通读 SKILL.md，确认一个**没有任何上下文**的 agent 只读它也能知道"先问什么、怎么调、产物在哪"。

### 阶段 2 · 预检与归一

产出（建议 `engine/` 同级新增 `lib/preflight.js`，纯 Node）：
- **范围归一映射表**（B8）：难度中英、册别简称（"必修一"→"必修第一册"）、章名简称、全半角
- **零命中 / 多候选拦截**（B6）：列出候选让用户选，**禁止自动放宽**
- **失效 ID 校验**（B11）
- **运行时可出题数**：`buildCandidates` → distinct `entry.id` 数量（**不是 `available`**）
- **四选项流**（B1）与 **题型等比缩放 + 最大余数**（B4）

自检：对以下场景打印预检结果，与 `docs/reference/04-可出题量预检.md` 对照：
全库仅化学 **301**；全库全版本 **392**；必修一第一章仅化学 **45**；必修一第一章第二节优先化学 **30**；
选择性必修2 仅化学 **3**；选择性必修3 仅离子 **0**。**6/6 必须一致。**

### 阶段 3 · 组卷

产出：
- 调 `G.generate`（`opts` 全不传）
- 组卷后注入 perItemRules（C 题 `showAnswerLine:true, answerLineHeightPt:24`）
- 校验 `items.length === totalCount`，否则按 B1 处理
- 附加验收（AC-14）：`snapshot` 核查 + 不满足重抽 ≤1 次

自检：固定随机种子不可用（引擎内部 shuffle），因此断言按**集合**而非顺序（主项目历史坑）。

### 阶段 4 · 无头导出入口

产出：`app/main.js` + `app/harness.html`（设计见 §2.7；参考实现见 §2.4）
- Word：主进程直接 `require('./engine/docx.js')` → 写文件（**不经过窗口**）
- PDF：离屏窗口 + `printToPDF`（**mm→inch 必须换算**）
- 图片：离屏窗口 + `capturePage`（按需通道）
- 命名/避让（B14）、`out/{yyyy-mm-dd}/`、`_pending`（B9）、`result.json`、`app.exit(code)`

自检：`node tools/run-paper.js test/job-smoke.json` → **无任何对话框**、打印 JSON、exit 0、文件落位。

### 阶段 5 · 交互层

产出：`references/文案模板.md` + SKILL.md 中的流程细则
- intake 4 问（必问 3 + 附加要求 1）
- **复述框**：全参数表 / 范围映射结果 / **预检可出题数（条目数）** / 文件名预览 / 快照时间与漂移状态
- 确认后执行；报告按 §3.3 `interaction.report` 全量输出
- 拒绝话术（B7）、红字提示（B9）

自检：把复述框文本拿给"不懂技术的老师"读，确认能看懂"要出几题、什么范围、存哪、叫什么名"。

### 阶段 6 · 记忆与 `_pending` 生命周期

- `last-run.json` 读写 + 损坏回退
- 冲突链：当次 > 记忆 > 默认
- `_pending` 手动重试提示（intake 轮）+ >30 天归档到 `.dsh/skill-state/archive/`

自检：AC-12（二次调用只复述变化项）。

### 阶段 7 · 验收、文档、回归

- 跑 §3.4 全部 17 条验收用例，逐条记录结果
- 更新 `README.md` 的"当前状态"段
- `npm run test:engine` 复跑（238/0）
- `git add -A && git commit`

---

## 六、验证清单（交付前逐项打勾）

### 6.1 功能

- [ ] AC-01 … AC-18 全部通过（§3.4；`npm run test:acceptance` 应报 18/18）
- [ ] `npm run test:engine` = 238/0
- [ ] `npm run sync:check` = 全部一致
- [ ] 预检 6 个基准场景与 `04-可出题量预检.md` 完全一致

### 6.2 边界（**最高优先级**）

- [ ] **出卷前后对上游旧桌面版（`chemistry-equation-printer`）做全量 sha256 快照 → 零差异**（AC-17）
- [ ] 上游 `data/`、`build/`、`backups/` 的 mtime 未被改动
- [ ] 本项目 `out/` 之外无散落产物；临时文件已清理
- [ ] `_pending` 只在失败时出现，且内容完整可重试

### 6.3 《常见遗漏清单》（逐条对照，来自主项目方案 §5 P10）

- [ ] 是否涉及"数量/配比"（而非只有开关）
- [ ] 是否涉及"顺序/排序"
- [ ] 是否涉及"命名/文案"
- [ ] 是否涉及"默认值"与"可覆盖"
- [ ] 是否涉及"失败时的行为"
- [ ] 是否涉及"与主项目的关系（只读/不写）"
- [ ] 是否涉及"数据被写回"的风险（本规格：无写回）
- [ ] 是否涉及"打印/纸张/物理尺寸"（mm→inch）
- [ ] 是否涉及"学生实际书写空间"（C 题答案线）
- [ ] 是否涉及"日后维护（题库更新、引擎同步）"
- [ ] 是否明确"不做"的边界

### 6.4 交付物

- [ ] `SKILL.md` 自包含可执行（新会话只读它就能跑通）
- [ ] `layout.yml` / `presets.yml` 与 §3.3 YAML 一致
- [ ] `result.json` 字段与 §4.3 一致
- [ ] README 状态段已更新
- [ ] 全部提交进 git

---

## 七、坑与注意（前人踩过，勿重复）

1. **PDF `pageSize` 按英寸解释**：`mm / 25.4` 换算；否则 MediaBox 巨大、查看器显示空白。（主项目 `main.js:2036-2039` 有注释）
2. **图片测量用 `document.body.getBoundingClientRect()`**，不要用 `documentElement.scrollWidth`（后者下限是窗口宽，会带右侧空白）。
3. **离屏窗口必须 `offscreen: true`**，且截图前要等渲染（PDF 200ms / 图片 250ms + setContentSize 后 150ms）；`capturePage` 要判 `isEmpty()`。
4. **不要加载主项目的 `index.html`**（缺 IPC 会挂死）——用本项目自包含的 `app/harness.html`。
5. **`available` 是版本数不是可出题数**（全库 531 vs 392），对外报数用条目数。
6. **默认 `chemicalOnly` 损失 91 条**（392→301）；选必 3 无离子版本、选必 2 仅 6 条——预检必须提前提示。
7. **H 题型不可用**（`openPrompt` 全空）；`starred`/`mustInclude` 无数据；`tags` 仅 105/392 有值。
8. **难度两套写法**（中文值 ↔ simple/medium/hard），归一表必须覆盖。
9. **`.md` 不能作为 Word/PDF 的上游**：Markdown 无法表达"条件在等号上下方"、双栏、答案线、每页固定题数；
   且本机 pandoc 无 LaTeX 引擎（出不了 PDF）。若要"人可读中间产物"，用 `items.json`；
   若要纯文本版卷子，用 `engine/chem.js` 的 `equationUnicodeText()`（能出 `2H₂ =点燃= 2H₂O`）。
10. **`generate` 内部会 shuffle**：断言只能按集合，不能按顺序。
11. **写文件用 `.tmp` + rename**（事务），避免半成品。
12. **`stdio: 'inherit'`**（不是 `'pipe'`）：本机沙箱下 pipe 捕获会 EPERM；`tools/run-paper.js` 已按此实现。
13. **不要 `npm i electron`**：运行时已自带（`runtime/electron/`，268MB），装了会重复一份；路径在 `data/SOURCE.json`。
14. **主项目引擎仍在迭代**：副本会漂移，交付前跑 `npm run sync:check`；升级引擎后必须复跑 `npm run test:engine`。

---

## 八、汇报要求

每个阶段结束时报告：
1. **本阶段产出**（文件清单 + 关键行数）
2. **自检结果**（贴原始输出，不要只写"通过"）
3. **与规格的偏差**（若有，说明原因；规格条款不得静默变更）
4. **下一步**

全部完成后给一份总报告，包含：
- AC-01…AC-18 的逐条结果（含原始证据：文件路径、字节数、页数、sha256 对比）
- **主项目零写入的证据**（出卷前后主项目全量 sha256 对比表）
- 已知限制与未做项（对照 §3.6）
- 后续建议（如引擎同步策略、图片通道是否补 multi 模式）

---

## 附：关键文件锚点速查（主项目，只读参考）

| 主题 | 位置 |
|---|---|
| 数据目录定位 | `main.js:8-21` |
| 原子写 / 读 JSON | `main.js:31-51` |
| 出题参数默认值 | `main.js:72-118`（`DEFAULT_SETTINGS`）；`src/libs/constants.js` `defaultGenerationSettings()` |
| PDF 导出 | `main.js:2011-2052` |
| 图片导出 | `main.js:1668-1700` |
| 写文件（binary） | `main.js:1932-1945` |
| 无头 env 范式 | `main.js:190`（`createWindow`）+ `225/265/305/406…`（`executeJavaScript`） |
| 组卷与导出调用点 | `src/js/worksheet.js:1025-1056` |
| 出题次数累加（**本项目不采用**） | `src/js/app.js:187-200`（`App.recordUsage`） |
| worksheet 对象 schema（备查） | `src/js/app.js:163-176` |
| 历史作业读写（**本项目不采用**） | `main.js:1790-1829` |
| 数据字典 / 统计 / 预检 | `docs/reference/01-数据字典.md`、`02-题库统计.md`、`04-可出题量预检.md`（本项目内） |
