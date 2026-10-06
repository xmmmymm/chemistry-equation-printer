# 实跑测试方案 · chem-equation-paper v1.2

> 用途：在**新会话**里对 `chem-equation-paper` 做一轮**全面、详尽、细致的实跑测试**，并修掉发现的问题。
> 配套启动提示词：`PROMPT-实跑测试启动提示词-v1.2.md`（直接粘贴给新会话）。
>
> 本方案基于 v1.2 架构写成（数据自持 + 自带 Electron 运行时 + 离子方程式补全）。
> 上一轮（v1.1 形态）的实跑已修掉 9 个问题，见 `README.md` §「实跑复检」——那些**都是回归项**，本轮必须复验。
>
> ⚠️ **v1.3 变更注记（执行本方案前必读）**：项目已加**确认闸门**（`README.md` §v1.3、规格 §3.2c）。
> 本方案里所有 `node tools/run-paper.js <job.json>` 调用**都要补 `--confirmed`**，否则只会拿到
> `CONFIRM_REQUIRED`（`exit 2`）且**零卷子产出**，方案里的产物断言会全部失败。两处例外：
> `--render-check`（只截图）与 `job.dryRun:true`（只组卷）不产交付物，**保持原样、不加** `--confirmed`。
> 另外预检结果多了 `intakeCoverage` 字段（逐项标注必问项来源 explicit/memory/default），
> 核对 `result.json` 时一并看它。

---

## 0. 定位、原则与证据标准

### 0.1 这轮测试要回答的问题

| # | 问题 | 为什么不能靠读代码回答 |
|---|---|---|
| Q1 | 卷子**真的出得来、内容真的对**吗？ | 只有解析真实 PDF / docx / PNG 才知道 |
| Q2 | v1.2 的「零项目外依赖」**真的成立**吗？ | 要真的把主项目藏起来跑一遍 |
| Q3 | 「数据自持 + 数据锁」的语义**真的按规格**吗？ | 要真的篡改 data/ 看各路工具怎么反应 |
| Q4 | 离子方程式补全的 17 条**化学上真的对吗**？ | 要跑守恒校验 + 逐条比对记录文档 |
| Q5 | 上一轮修的 9 个坑**有没有被 v1.2 改回去**？ | 要复跑回归 |
| Q6 | 文档/话术/参考表与代码**还一致**吗？ | 要逐条对照实算 |

### 0.2 证据标准（三层，逐层加严）

| 层 | 含义 | 例子 |
|---|---|---|
| **L1 存在性** | 文件在、exit 0、字段有 | 既有 17 条 AC 主要停在这一层 |
| **L2 结构性** | 解析产物内部结构 | `pdfinfo` 页面尺寸 = 210×297mm；docx 解压读 `word/document.xml` 的 run 序列；PNG 尺寸/像素；`result.json` 字段与 §4.3 对齐 |
| **L3 语义性** | 内容与需求一致、化学正确、跨通道一致 | PDF 文本与 docx 文本**逐题对齐**；离子方程式原子+电荷守恒；卷内无 H 题；C 题有 24pt 答案线；页数 == 实际 PDF 页数 |

> **硬性要求**：每个 Phase 的结论都要给 L2/L3 证据（原始命令 + 原始输出片段），不接受「通过」二字。

### 0.3 六条铁律（违反即失败）

1. **绝不写上游旧桌面版**（`chemistry-equation-printer`）——不新建、不修改、不删除任何文件（含临时文件）。
2. **`data/` 是自有数据**：测试中任何对 `data/*.json` 的篡改都必须**先备份、后还原**；合法改动后要 `npm run data:lock`。
3. **`engine/*.js` 副本**（chem/constants/generator/exporter/docx/importer）要改必须走 `data/ENGINE-PATCHES.json` 登记 + `npm run test:patches`；`engine/paper.js` 与 `engine/image.js` 是本项目新增，可直接改。
4. **不引入 npm 依赖**（Electron 运行时自带，也不装）。
5. **临时文件只落 `out/`**（已 gitignore）；结束前清理干净。
6. **不清楚就问用户**，不要猜着改。

### 0.4 工作区与工具约定

- 临时 job / 脚本放 `out/_manual/`；产物放 `out/_manual/<case>/`（显式 `outputDir`）。
- 已知环境坑：本机 **Node 的 `fs.rmSync`/`rmdirSync` 删目录会被静默拦截**（`unlinkSync` 正常）→ 清理目录一律「逐层删文件 + 尽力 rmdir」。
- 可用外部工具：`pdfinfo` / `pdftotext` / `pdftoppm`（poppler 已装）、`node` v24、`python` 3.14。
- 读图：用 `read_image` 直接看渲染出的 PNG（PDF 可先 `pdftoppm -png -r 110` 转图）。

### 0.5 当前基线（2026-09-19 实测，作为对照起点）

```
npm test          engine 238/0 · preflight 6/6 · state 9/9 · patches 6/6 · edge 62/62
data:check        ✓ 392 条 / 548 版本（sha256 6cc052772fa3…）
runtime:check     ✓ v33.4.11 @ runtime/electron/（73 文件 / 268.0 MB）
print-runtime     chem-equation-paper\runtime\electron\electron.exe
sync:check        全部一致 ✓（engine/docx.js 标记「本地补丁，上游未变」）
test:acceptance   17/17 PASS
```

---

## Phase 0 · 基线快照与冻结（先做，不改任何东西）

```powershell
cd "chem-equation-paper"
git log --oneline -10 ; git status --short
node --version ; npm --version
npm test                       # 五套快测
npm run data:check
npm run runtime:check
node tools/run-paper.js --print-runtime
npm run sync:check
```

**同时落三份指纹快照**（供后面「零写入 / 数据未被动 / sync 不动 data」三类断言用）：

| 快照 | 内容 | 用途 |
|---|---|---|
| `mainProject.json` | 主项目 `data/ src/libs/ scripts/ examples/ main.js preload.js package.json` 全量 `sha256 + bytes + mtimeMs` | Phase 6 零写入 |
| `dataDir.json` | 本项目 `data/*.json` 全量 `sha256 + bytes + mtimeMs` | Phase 2.1 的 D6/D7 |
| `runtimeDir.json` | `runtime/electron/**` 全量 `sha256`（73 文件） | Phase 2.2 的 R2 |

> 落点：`out/_manual/_baseline/`。写个小脚本 `out/_manual/snapshot.js` 复用（含 `--diff` 模式）。
> **AC-17 口径含 mtime**，所以快照要带 `mtimeMs`。

**验收**：六条命令全绿；三份快照落盘。任一不绿 → 先停下报告，别继续。

---

## Phase 1 · 快速回归 + 既有 AC 复验

### 1.1 五套快测

```powershell
npm test          # 期望：238 / 6 / 9 / 6 / 62 全过
```

### 1.2 17 条验收用例

```powershell
npm run test:acceptance
```
期望 `17/17 PASS`，证据在 `out/_acceptance/`。

### 1.3 逐条核对 AC 与 **v1.2 规格**是否仍对齐（重要）

规格在 v1.2 改过 3 条，要确认验收台跟上了：

| AC | v1.2 期望语义 | 要查什么 |
|---|---|---|
| AC-05 | 范围改为 **选择性必修3 / 第二章 烃** + ionicOnly | 是否真的改成这个范围？命中 0 的**原因**是「该章确实无离子版本」而不是别的 |
| AC-08 | **本地** `data/library.json` 被项目之外改动 → `sync:check` 报**数据锁不一致**（exit 1）；skill 仍能出卷 | 是否还在拿主项目做假源？篡改的是**本项目** data/ 吗？测完有没有还原？ |
| AC-17 | 主项目零写入仍然成立 | 主项目在本轮测试中**全程未被读写**（含 mtime） |

> 若验收台与规格不符 → 记为**问题**（规格是权威，测试台要改）。

### 1.4 上一轮 9 个坑的定点复验（防止被 v1.2 改回去）

逐个构造最小复现，确认**仍然修好**：

| # | 复现方式 | 期望 |
|---|---|---|
| 1 | `node tools/preflight.js --out out/_manual/x.json --job examples/job-homework-basic.json --no-memory` | exit 0 且写出 x.json（**不是**把 `--out` 的值当 job） |
| 2 | 跑 `dryRun:true` + 自定义 `outputDir` 的 job | `result.json` 落在 `outputDir` 内 |
| 3 | `outputDir` 指向 `C:\Windows\Temp\x` 与主项目 `data/` | `OUTPUT_DIR_FORBIDDEN` / exit 2 / 有 `result.json` / 无越界目录 |
| 4 | `{jobVersion:1,useMemory:false,generation:{totalCount:5}}` | `ASK_VERSION_STRATEGY` 拦截 exit 2；`restate.versionStrategy === "ASK"` |
| 5 | `run-paper.js examples/job-timedDrill-chapter1.json --render-check` | 输出 `scopes` 为归一后范围、`authoritativeCount` 与真实出卷一致 |
| 6 | 用「不可能满足」的 `extraAcceptance` 逼出重抽 ≥15 次 | `perItemRulesApplied[].count` 与实际 C 题数一致 |
| 7 | 在自定义嵌套 `outputDir` 下造 `_pending.json` | `node tools/skill-state.js pending` 能找到；`_` 开头目录被跳过 |
| 8 | 出一份含 `Fe^2+`/`OH-` 的卷子，解压答案卷 docx | 无 `^` 泄漏；run 序列为 `Fe`+上标`2+`、`OH`+上标`−`；与 PDF 一致 |
| 9 | 跑 `test:acceptance` 前后看真实 `out/{yyyy-mm-dd}/` | 不多出 docx、真实 `result.json` 被还原 |

---

## Phase 2 · v1.2 新增能力专测 ★本轮重点

### 2.1 数据自持与数据锁（`tools/data-lock.js`）

| # | 用例 | 步骤 | 期望 |
|---|---|---|---|
| D1 | 数据指纹与文档一致 | 实算 条目数/版本数/各版本类型分布/离子数 | `392 / 548 / ionic 142`；与 `docs/reference/02-题库统计.md`、`04-可出题量预检.md` 头部一致 |
| D2 | 正常锁 | `npm run data:check` | exit 0，打印 392/548 |
| D3 | 题库被外部改动 | 备份 → 改 `data/library.json`（如某条目 name 加个字符）→ 依次跑 `data:check` / `sync:check` / `skill-state drift` / **完整出卷** → 还原 | 前三个 exit 1 且 reason 明确；**出卷仍成功**（B12 不阻塞）、报告标注不一致；还原后复绿 |
| D4 | 分类表被改动 | 同上，改 `data/classifications.json` | reason = `classifications-changed` |
| D5 | 未锁定 | 备份 → 删 `data/SOURCE.json` 的 `library` 块 → `data:check` → 还原 | reason = `unlocked`，exit 1 |
| D6 | **`sync` 不再动 data/** | 跑 `npm run sync`（写模式）→ 与 `dataDir.json` 对比 | `data/` **零差异**（sha256 + mtime）；只有 `engine/` 可能变 |
| D7 | 重新锁定只动该动的 | 跑 `npm run data:lock` → 看 `SOURCE.json` | 只更新 `library`/`classifications`/`lockedAt`；**保留** `origin`/`files`/`electronRuntime`/`dataOwnership` |
| D8 | `origin` 只作溯源 | 备份 → 把 `origin.library.sha256` 改成乱码 → `data:check` / `sync:check` → 还原 | **都仍 exit 0**（origin 不参与判定） |
| D9 | 数据不可读 | 备份 → `data/library.json` 写成 `{`（坏 JSON）→ `data:check` / 出卷 → 还原 | `data:check` reason=`unreadable`；出卷报 `SNAPSHOT_CORRUPT` 类错误、exit≠0、无半成品 |

> ⚠ 每个 D 用例都必须有 `try/finally` 式的还原，测试后 `npm run data:check` 必须复绿。

### 2.2 自带 Electron 运行时（`tools/install-runtime.js` + `run-paper.js`）

| # | 用例 | 步骤 | 期望 |
|---|---|---|---|
| R1 | 就绪 | `npm run runtime:check` | exit 0，打印 v33.4.11 + 目录 |
| R2 | **完整性** | 与 `runtimeDir.json`（或直接与来源 dist 目录）逐文件 sha256 比对 | 73 文件全部一致；`version` 文件 = `33.4.11` |
| R3 | **缺失时不回退外部**（关键） | 临时把 `runtime/electron/electron.exe` 改名为 `.bak` → 跑 `run-paper.js examples/job-homework-basic.json --confirmed` 与 `--print-runtime` → 还原 | exit 4 + 明确指引；**绝不**使用主项目那份 electron.exe（旧版会兜底） |
| R4 | 环境变量越界告警 | `CHEMEQ_ELECTRON=<主项目 electron.exe>` 跑 `--print-runtime` | 打印越界告警；按设计仍可用（仅诊断） |
| R5 | SOURCE.json 指向项目外被拒 | 备份 → 把 `electronRuntime.path` 改成主项目路径 → `--print-runtime` → 还原 | 被 `insideSkill` 过滤，仍解析到 `runtime/electron/`（不是主项目） |
| R6 | `--from` 指向无效目录 | `node tools/install-runtime.js --from=C:\nope` | exit 2 + 指引；不产生半成品 |
| R7 | `--check` / `--print` 退出码 | 分别跑 | 就绪时 0；`--print` 只输出路径一行 |

### 2.3 离子方程式补全（17 条）正确性

| # | 用例 | 步骤 | 期望 |
|---|---|---|---|
| I1 | 计数 | 实算条目/版本/各类型 | 392 / 548；`ionic` **142**；与 README、04 表、SOURCE.json 三处一致 |
| I2 | **化学正确性（硬核）** | 对全部 142 个 ionic 版本跑引擎的原子守恒 + 电荷守恒校验（`engine/chem.js` 里的 balance/charge 校验函数） | **0 失败**；失败要逐条列出并复核 |
| I3 | 记录表与数据一致 | 解析 `docs/reference/05-离子方程式补全记录.md` 的 17 条（条目 id + 反应物 + 产物 + 系数），逐条与 `data/library.json` 对照 | 17/17 完全一致；无「文档说有、数据里没有」或反之 |
| I4 | 「不该补」的确实没补 | 从文档的「不该补 183 条」里抽样 ≥15 条（覆盖燃烧/受热分解/熔融电解/非水电池/纯有机） | 这些条目**没有** ionic 版本 |
| I5 | 「有争议 11 组 / 16 条」 | 抽样核对 | 确实**未补**（留待拍板），文档与数据一致 |
| I6 | 预检基准表全表复核 | 对 `04-可出题量预检.md` 里**每一行**范围 × 5 策略实算 | 全表逐格一致（不只 6 个基准） |
| I7 | 出卷层面变化合理 | `ionicOnly` / `preferIonic` 在「选必3」「选必3/第二章 烃」等范围的可出题数 | 与 04 表一致；选必3 整册离子从 0 变成表里的值要**有据** |
| I8 | 卷面抽检 | 出一份 `preferIonic` 的卷子，人工核对 3–5 道离子方程式的系数/电荷/条件/↑↓ | 化学正确、排版正确 |
| I9 | **顺着文档 §六 的线索查** | 读 `05-离子方程式补全记录.md` **§六「顺带发现、本次未修的问题」**，逐条复现 | 每条判定：真问题（→ 修或记已知限制）／误报；**别漏掉作者自己留下的线索** |
| I10 | §五 的校验与回归口径 | 复跑文档 §五声称的校验项（如「17/17 含带电物种」） | 与文档一致 |

### 2.4 引擎副本与补丁登记

| # | 用例 | 步骤 | 期望 |
|---|---|---|---|
| P1 | 补丁校验 | `npm run test:patches` | 6/6（哈希 + 4 条行为断言） |
| P2 | 上游是否变过 | 比对主项目 `src/libs/docx.js` 与 `ENGINE-PATCHES.json.upstreamSha256` | 未变 → `sync:check` 认账；**若已变** → 记为问题：需重新评估补丁 |
| P3 | 补丁行为仍生效 | 用**新数据**里含多价离子的条目（如 `SO4^2-`、`Cr2O7^2-`、`Al^3+`）走 docx | 电荷渲染与 PDF 一致、无 `^` 泄漏 |
| P4 | 本地补丁被改动要能发现 | 备份 → 在 `engine/docx.js` 里加一个空行 → `sync:check` → 还原 | exit 1，报「本地补丁已被改动（与登记哈希不符）」 |
| P5 | `paper.js`/`image.js` 不受登记表约束 | 确认 `sync-from-source.js` 的 `ENGINE_FILES` 不含这两个 | 不含（本项目新增文件） |

---

## Phase 3 · 端到端实跑与产物真实性（L2/L3）

### 3.1 示例 job 全跑

```powershell
# ⚠ v1.3：出卷调用一律补 --confirmed（确认闸门；见文件头注记）
foreach ($f in Get-ChildItem examples\job-*.json) { node tools/run-paper.js $f.FullName --confirmed }
```
对每份 `result.json` 核对：`ok / exitCode / scenario / snapshot(含 drift 语义) / generation(题量·题型·难度·版本类型·范围命中·notices·acceptance) / channels / failures / pendingPath / params / outputDir / intakeCoverage(必问项来源)`。

### 3.2 产物真实性（**必须做，不能只看文件在不在**）

| 通道 | 检查 |
|---|---|
| **PDF** | `pdfinfo` → `Pages` 与 `result.channels.pdf[].pages` **一致**；`Page size` ≈ `595.92 x 841.92 pts`（= 210×297mm，验证 mm→inch 换算）；`pdftotext -layout` → 题目/答案正文完整（标题、学生栏、题号、条件、↑↓、答案线）；`pdftoppm -png -r 110` → **用 `read_image` 肉眼看**版面 |
| **docx** | 解压 → `word/document.xml`；用「run 序列还原器」（普通/`subscript`/`superscript`）还原成可读文本；与 PDF 文本**逐题对齐**；确认 3 列表格（左式/条件/右式）、页脚引用存在 |
| **PNG** | 尺寸与 `result.channels.images[].widthPx/heightPx` 一致；`read_image` 肉眼核对（题号、名称、上下标、条件在等号上下方）；像素非纯白（用 Python/Node 统计非白像素占比） |

> 「run 序列还原器」在上一轮已写过（`tools/test-engine-patches.js` 里的 `flattenRuns`），直接复用。

### 3.3 跨通道一致性（L3）

同一份卷子：PDF 文本（`pdftotext`）↔ docx 文本（还原器）↔ `result.itemsPreview`（`equationUnicode`）**逐题对齐**，允许的差异只有上下标/条件位置的表示法。

### 3.4 多页压力

出 60 题与 100 题各一份（`allAvailable`）→ 报告页数 == PDF 实际页数；`overflowCount` 语义合理；无内容截断（对比首页/末页文本，确认最后一题在）。

### 3.5 场景与卷面

- 三场景标题/学生栏/页脚页码（homework 无栏；timedDrill/examPrep 有姓名·班级·日期）。
- 卷级 `answerLine.enabled=false` 恒不变；**C 题** `showAnswerLine=true` + `answerLineHeightPt=24`，B/D/E 无。
- 卷面模板固定：A4 纵 / 2cm / 1 栏 / 宋体+TNR 16-12-10.5 / 单倍 / 题距 6。

### 3.6 其他通道

- 图片：`png` 与 `jpeg` 各一次；`scale` / `number` / `showName` / `fontPt` 等覆盖项生效。
- `--render-check`：输出 `scopes` 与 `authoritativeCount` 与真实出卷一致。
- `dryRun`：不产卷子、`result.json` 落 `outputDir`、`itemsPreview` 完整。

---

## Phase 4 · 边界与异常

先跑现成的 62 项：`npm run test:edge`（它已覆盖归一/拦截/CLI/输出目录/`_pending`/补丁登记/数据锁/自带运行时）。
然后**补它没覆盖的**：

| # | 用例 | 期望 |
|---|---|---|
| B1 | 归一 B8 全表：`归一映射表.md` 声称的每条规则逐条实跑 | 与文档一致；**新数据新增的章/节名**也能归一 |
| B2 | 拦截：ASK / B6 多候选·零命中 / B7 H·starred·mustInclude / B11 / B3 / B4 | code 与文案与 SKILL.md §3.2 表一致 |
| B3 | 错误路径：缺 job / 坏 JSON / 空 job / `outputDir` 项目外 / `outputDir` 指向主项目 | 退出码 2/3 与 `error.code` 明确；无越界写入 |
| B4 | CLI：`--job` 顺序 / `--job=` / 位置参数 / 越界 `--out` / 无参 / 未知子命令 | 退出码 0/2/3 正确 |
| B5 | 并发同名出卷 | 记录实际行为（已知 TOCTOU 会互相覆盖）——确认是「已知限制」而非新回归 |
| B6 | `_pending` 全生命周期 | 生成 → `pending` 列出 → 重跑全成功清除 → `archive --force` 归档到 `.dsh/skill-state/archive/{日期}/` |
| B7 | 记忆：冲突链 当次>记忆>默认；坏记忆回退；`--no-memory` | 与 `决策清单.md` §四一致 |
| B8 | 数据文件损坏：`library.json` 坏 JSON / 缺 `entries` / 空文件 | 明确报错 + exit≠0 + 无半成品 |

---

## Phase 5 · 「零项目外依赖」实证 ★v1.2 核心承诺

| # | 用例 | 做法（**不碰主项目**） | 期望 |
|---|---|---|---|
| Z1 | 主项目不可达仍全功能 | `$env:CHEMEQ_SOURCE='C:\nope\nope'` 后跑 `sync:check` / `data:check` / `npm test` / **完整出卷（PDF+Word+图片）** | `sync:check` 跳过引擎上游比对但**数据锁照常校验**；其余全成功 |
| Z2 | 无主项目也能出卷 | 承 Z1 跑一份 PDF+docx+图片 的 job | exit 0，四类产物齐全且内容正确 |
| Z3 | 代码里没有隐藏的外部依赖 | grep `DSH work[\\/]方程式` 于 `tools/ app/ engine/` | 只允许出现在 `sync-from-source.js`（引擎上游默认值）与 `install-runtime.js`（运行时来源默认值），且都是**可选开发期**路径 |
| Z4 | 运行时/数据都在项目内 | `--print-runtime` 落在项目内；`data/` 在项目内 | 成立 |
| Z5 | `runtime/` 不入库 | `git check-ignore -v runtime/electron/electron.exe`；`git status` | 被忽略；未被跟踪 |
| Z6 | 依赖清单为空 | `package.json` 无 `dependencies`/`devDependencies`；无 `node_modules/` 必需 | 成立 |

> Z1/Z2 是**最容易翻车**的两项：旧版 `run-paper.js` 有主项目兜底、`sync` 会覆盖 data/。要确认真没了。

---

## Phase 6 · 主项目零写入（AC-17 口径）

在**全部测试结束后**再做一次：

```powershell
node out\_manual\snapshot.js --diff mainProject     # 与 Phase 0 快照对比
```
**期望：零差异（sha256 + bytes + mtimeMs）**。任何差异都要查明是哪个环节写的。

---

## Phase 7 · 文档一致性

逐条把「文档声称」与「实测」对照，不一致就记问题：

| 文档 | 要核对什么 |
|---|---|
| `README.md` | 目录清单、常用命令、v1.2 变更表、数字（392/548/142、73 文件/268MB/v33.4.11）、已知限制、坑表 |
| `.dsh/skills/.../SKILL.md` | 调用方式、两段式流程、拦截码表（含 `ASK_VERSION_STRATEGY`）、§4 参数语义、§6 job schema、§8 工具表 |
| `references/决策清单.md` | 必问/可默认/永不问、冲突链、`useMemory` 语义 |
| `references/归一映射表.md` | 每条归一规则、每个枚举全集（**vs `data/classifications.json` 实算**） |
| `references/文案模板.md` | intake 4 问、复述框五块、拒绝话术（含 ASK）、报告模板、红字提示 |
| `docs/reference/01·02·04·05` | 数据字典字段、统计数字、预检全表、离子补全记录 |
| `PROMPT-方程式出题skill.md` | §3.2b v1.2 变更记录与实际实现是否一致（规格是权威） |

> 特别检查：**v1.2 的新语义有没有同步进 skill 话术**——「数据锁」替代了「快照漂移」，
> SKILL.md / 文案模板里若还写着「快照时间 / 主项目已更新」，就是**过时话术**，要改。

---

## Phase 8 · 修复协议

发现问题时按类处置：

| 类 | 判定 | 处置 |
|---|---|---|
| **A 自有代码** | `tools/`、`app/`、`engine/paper.js`、`engine/image.js` | 直接修；注释写清「现象 / 根因 / 修法」；加回归断言 |
| **B 引擎副本** | `engine/{chem,constants,generator,exporter,docx,importer}.js` | 走 `data/ENGINE-PATCHES.json` 登记 + `npm run test:patches`；**不写主项目** |
| **C 数据** | `data/*.json` | 改完必须 `npm run data:lock`；若涉及化学内容，先在报告里说明依据 |
| **D 规格歧义** | 规格本身没说清 / 与实测冲突 | **问用户**，不猜 |

**每个修复后必须**：
1. 复跑受影响的专项；
2. 复跑 `npm test` 五套；
3. 复跑 `npm run test:acceptance`（17/17）；
4. 若改了 `data/` → `npm run data:lock` + `npm run data:check`；
5. 若改了 `engine/*.js` 副本 → `npm run test:patches` + `npm run sync:check`。

**给新回归留位置**：本轮新发现的边界，优先补进 `tools/test-edge.js`（纯 Node、秒级）；涉及产物结构的，补进 `tools/acceptance.js` 或新开 `tools/test-artifacts.js`。

---

## Phase 9 · 交付物

1. **测试报告**（按 Phase 组织）：每条用例 → 期望 / 实测 / 原始证据片段 / 结论（PASS·FAIL·已知限制）。
2. **修复清单**表：现象 / 根因 / 修法 / 回归断言 / 影响面。
3. **数字对账表**：文档声称 vs 实测（条目/版本/离子/预检全表/运行时文件数/体积）。
4. **主项目零写入证据**：Phase 0 vs Phase 6 的 sha256+mtime 对比表。
5. **新增/更新的回归工具**与 `npm test` 的新计数。
6. **已知限制更新**（README 段）。
7. **遗留待拍板项**（如离子补全的「有争议 11 组 / 16 条」）。

---

## 附：一页速查（命令清单）

```powershell
cd "chem-equation-paper"

# 基线
git status --short ; npm test ; npm run data:check ; npm run runtime:check
node tools/run-paper.js --print-runtime ; npm run sync:check

# 回归
npm run test:acceptance

# v1.2 新增能力
npm run data:lock ; npm run data:check
npm run runtime:check ; node tools/install-runtime.js --from=C:\nope
npm run test:patches ; npm run sync:check

# 出卷（四步：预检 → 复述确认 → 出卷）
node tools/skill-state.js state
node tools/preflight.js --job <job.json>          # 看 diagnostics / restate / intakeCoverage
node tools/run-paper.js <job.json>                # 未确认 → CONFIRM_REQUIRED，零卷子产出
node tools/run-paper.js <job.json> --confirmed    # 老师确认后 → 出卷

# 产物真实性
pdfinfo <pdf> ; pdftotext -layout <pdf> out.txt ; pdftoppm -png -r 110 <pdf> <prefix>
# docx：解压读 word/document.xml；PNG：read_image

# 零项目外依赖
$env:CHEMEQ_SOURCE='C:\nope\nope' ; npm run sync:check ; npm run data:check
```
