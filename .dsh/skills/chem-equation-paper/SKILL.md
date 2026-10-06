---
name: chem-equation-paper
description: 从化学方程式题库出卷并导出 Word / PDF / 图片。当用户说「出一份化学方程式卷子 / 作业 / 限时练 / 备考练习」「给我出 10 道方程式题」「把这些章节的方程式出成卷子」「出题打印」等意图时使用。流程：澄清需求（场景 / 范围 / 版本策略）→ 预检可出题数 → 复述确认 → 无头组卷导出 → 结构化汇报。产物落在本项目 out/{yyyy-mm-dd}/，绝不写入题库或引擎上游项目。
version: 1.2.0
---

# 方程式出题 skill（chem-equation-paper）

## 0. 这个 skill 做什么

老师在对话里说一句「出 10 道必修一的化学方程式作业」，你负责：

1. **澄清**（必问 3 项 + 1 项附加要求）——不要静默替老师决定版本策略；
2. **预检**——把口语范围归一成引擎能懂的范围，算出「最多能出几题」，不够就当场给选项；
3. **复述确认**——用老师看得懂的话把「要出几题、什么范围、存哪、叫什么名」摆出来；
4. **执行**——一条命令无头组卷导出 PDF 双卷 + Word 双卷（图片点名才出）；
5. **汇报**——产物路径、卷面统计、引擎 notices 原文、题库数据时间与数据锁状态、参数存档。

**卷面格式是固定的**（`layout.yml`），老师不需要调；只有**场景包**（标题 + 有无学生栏）随场景变。

---

## 1. 三条不可违反的边界

| # | 边界 | 具体要求 |
|---|---|---|
| **1** | **绝不写引擎上游** | 上游项目（旧版桌面应用，仓库 `chemistry-equation-printer` 的归档分支 `archive/desktop-app-v1`）只读。题库、设置、历史作业、导出目录、备份目录**一个字节都不碰**。产物只落本项目 `out/`。 |
| **2** | **不写回题库** | 条目的 `questionCount` / `lastUsedAt` **只读不改**（v1.1 已取消写回）。 |
| **3** | **不自动放宽** | 范围零命中时**禁止**自动放宽到全库；必须列候选让老师选（B6）。 |

> 交付验收含 **AC-17：出卷前后对上游做全量 sha256 快照 → 零差异**。任何时候都不要在上游路径下创建临时文件。
> 上游未配置（未设 `CHEMEQ_SOURCE`）时该快照自动跳过并标注 `skipped`，其余验收照常。

---

## 2. 调用方式（一条命令）

```powershell
cd chem-equation-paper            # 本项目根目录
node tools/run-paper.js <job.json>              # ① 预检 + 复述框 + 覆盖度报告（不生成卷子）
node tools/run-paper.js <job.json> --confirmed  # ② 老师确认覆盖度后 → 出卷
```

- **`--confirmed` 是确认闸门**（AC-18）：不带它时只回 `CONFIRM_REQUIRED` + `restate` +
  `intakeCoverage`，**一个字节都不写盘**（`exitCode 2`）。详见 §3.2b。
- `job.json` 的 schema 见 §6；启动器会用**本项目自带的** Electron 运行时（`runtime/electron/`，v33.4.11，不安装、不复制、不依赖项目外）跑 `app/main.js`。
- 退出码：`0` = ≥1 个通道成功（`ok:true`）；非 0 = 全部失败（`ok:false`）。
- 无论成功失败，都会打印一份 JSON，并写 `result.json` 到 `out/{yyyy-mm-dd}/`。
- **无头**：不会有任何对话框。

辅助命令（纯 Node，不需要 Electron，用于澄清阶段）：

```powershell
node tools/skill-state.js state                  # intake 第一步：drift + memory + pending 一次拿全
node tools/skill-state.js drift                  # 题库数据锁检测（不阻塞出卷）
node tools/skill-state.js memory                 # 读偏好记忆
node tools/skill-state.js pending                # 列 _pending 未完成项（intake 轮要提示）
node tools/skill-state.js archive                # >30 天的 _pending 归档到 .dsh/skill-state/archive/
node tools/preflight.js --job <job.json>         # 预检（归一 + 可出题数 + 文件名预览 + 诊断 + 记忆补全）
node tools/preflight.js --job <job.json> --no-memory   # 忽略记忆，纯按当次参数预检
node tools/preflight.js --self-test              # 6 个基准场景对照 docs/reference/04-可出题量预检.md
node tools/run-paper.js <job.json> --render-check      # 开发期：只渲染卷面截图（不产出卷子）
```

> 预检**默认会做记忆补全**（冲突链 当次 > 记忆 > 默认），结果里 `memoryReport.usedFields`
> 说明哪些字段取自记忆 → 复述框**只重点讲变化项**（AC-12）。

---

## 3. 两段式流程

```
[intake] 必问 3 项 + 附加要求 1 项
   ↓  （先跑 node tools/skill-state.js state：拿 drift / memory / pending）
[resolve + preflight]  node tools/preflight.js --job <job.json>
   ↓  （有拦截项 → 当场给选项，不进 generate）
[restate] 复述框 + intakeCoverage 覆盖度报告（老师确认/改）
   ↓  （老师说“改” → 回 intake，只问变化项）
[execute]  node tools/run-paper.js <job.json> --confirmed
   ↓  （不带 --confirmed → CONFIRM_REQUIRED，不生成任何卷子）
[report]  全量报告
```

> **话术全部现成**：`references/文案模板.md`（intake 4 问 / 复述框 / 报告 / 拒绝 / 红字提示 / 常见追问）。
> 直接套用，不要自己临时组织措辞。

### 3.0 开工第一步：拿运行时状态

```powershell
node tools/skill-state.js state
```

一次返回三块：

| 块 | 用途 |
|---|---|
| `drift` | 题库数据时间 / 条目数 / 是否与数据锁一致 → **抄进复述框**，异常**不阻塞**（B12） |
| `memory` | 上次的偏好（`last`）→ 用于冲突链「当次 > 记忆 > 默认」；损坏时给默认 + 一行说明 |
| `pending` | 未完成的导出留痕 → **intake 轮提示**「上次有导出没成功，要现在重试吗？」（B10） |

`tools/preflight.js` **已自动做记忆补全**（可用 `--no-memory` 关闭），并在结果里给
`memoryReport.usedFields` 告诉你哪些字段取自记忆——**复述框只重点讲变化项**（AC-12）。

### 3.1 intake：必问 3 项 + 1 项

一次问完，**不要拆成多轮盘问**。四项固定为：

| 顺序 | 问什么 | 选项 | 默认（老师答“随便/你定”） |
|---|---|---|---|
| 1 | **场景** | `homework` 课后作业 / `timedDrill` 课堂限时练 / `examPrep` 备考练习 | `homework` |
| 2 | **范围**（口语即可） | 例：「必修一第一章」「选必 3 的烃」「全库」「九上和九下」 | 全库 |
| 3 | **版本策略**（**必问、无静默默认**） | 见 §4.1 六选一 | 建议 `preferChemical`；老师答「推荐/照旧」取 `preferChemical` |
| 4 | **附加要求**（可空） | 例：「来 2 道文字描述题」「钠相关至少 2 题」「要 15 题」「别出有机」 | 无 |

题量默认 **10 题**，在**复述框**里可改（属于 `restateModifiable`），不必在 intake 单独问一轮。

**附加要求 → 结构化字段的映射**（老师口语 → `job` 字段）：

| 老师说法 | 落到哪 |
|---|---|
| 「要 15 题」「出 20 道」 | `generation.totalCount` |
| 「来 2 道文字描述题」 | `generation.questionTypeCounts.C = 2` |
| 「简单 8 道、中等 1 道、较难 1 道」 | `generation.difficultyMode='counts'` + `difficultyCounts` |
| 「钠相关至少 2 题」「铁相关≥3」 | `extraAcceptance: [{kind:'containsFormula', value:'Na', minCount:2}]` |
| 「要某某那道题」 | `generation.manualEntryIds`（用条目 id，如 `R0014`） |
| 「别出有机」 | `generation.exclude: {knowledgeModules:['有机化学']}` |
| 「只要高频题」 | `generation.scopes: {tags:['高频']}` |
| 「出图片」 | `export.images = true` |

### 3.2 复述框（确认后才执行）

固定六块，用老师看得懂的话写（**模板见 `references/文案模板.md` §二**）：

1. **全参数表**——场景、题量、题型分布、难度目标、版本策略、导出通道
2. **范围映射结果**——老师说的口语 → 归一后的册/章/节（含**归一依据**，来自 `restate.scopeMapping`）
3. **预检可出题数**——**必须是条目数**（`preflight.authoritativeCount`，不是引擎的 `available` 版本数）；不足时给四选项
4. **文件名预览**——`restate.files[].name`（含避让后的实际名）+ `restate.outputDir`
5. **数据时间与数据锁状态**——`restate.snapshot`（题库是本项目自有数据；异常不阻塞出卷，只标注）
6. **intake 覆盖度**——`intakeCoverage`：每个参数**是谁给的**（`explicit` 当次问到 / `memory` 记忆补的 / `default` 系统默认）

### 3.2b intake 覆盖度与确认闸门（AC-18）

`intakeCoverage.verdict` 三档，**必须在复述框里如实讲**：

| verdict | 含义 | 你要做的 |
|---|---|---|
| `intake-complete` | 必问 3 项（场景/范围/版本策略）**都是当次问到的** | 正常复述，等老师点头 |
| `intake-incomplete` | 必问项里有 `unasked[]` 是**记忆/默认替答的** | 复述框里**点明这几项不是老师说的**，请老师确认或改；别当成「老师已经确认过」 |
| `blocked` | 版本策略仍是 ASK | 回 intake 补问（见上表 `ASK_VERSION_STRATEGY`） |

> ⚠ 为什么需要它：`restate.versionStrategyAsked` 只表示「最终值不是 ASK」——**记忆补上的同样为
> `true`**，不能当「agent 问过老师」的证据。实测：一个只写 `totalCount` 的 job 会被记忆补成
> 「跟上次一样」并 `exit 0` 放行。`intakeCoverage` 把这种「漏问」显式标出来。

**确认闸门（引擎级，不只是话术）**：`node tools/run-paper.js <job.json>` **不带 `--confirmed`
时一个字节都不生成**，只回 `CONFIRM_REQUIRED` + `restate` + `intakeCoverage`（`exitCode 2`）。
把覆盖度摆给老师、老师点头后，才带 `--confirmed` 重跑：

```powershell
node tools/run-paper.js my-job.json --confirmed
```

> 豁免：`--render-check`（只截图）与 `job.dryRun:true`（只组卷）不产交付物，不受闸门约束。
> `intakeCoverage.needsConfirm` 列出所有「不是当次显式给出」的项——这些都要老师在复述框里过目。

可改项（`restateModifiable`）：题量、题型分布、难度目标、手选必出、排除范围、导出通道、是否出图片。
**永不问**：卷面参数、`allowDuplicateEntry`、`includeMustInclude`、学习项目挂靠。

**拦截项必须当场解决**（看 `diagnostics.blockers[].code`）：

| code | 你要做的 |
|---|---|
| `ASK_VERSION_STRATEGY` | **你漏问了第 3 问**：版本策略没指定（或写了 `"ASK"`）。回 intake 补问六选一，**不进导出**（规格：每次必问、无静默默认）。话术见 `references/文案模板.md` §四 |
| `B6_AMBIGUOUS` | 把 `blockers[].items[].candidates` **列给老师选** |
| `B6_UNMATCHED` | 列 `blockers[].items[].hints` 里的候选（册/章/节全集），**禁止自动放宽到全库** |
| `B11_INVALID_MANUAL_ID` | 列失效 ID + 原因，要求剔除 |
| `B3_MANUAL_EXCEED` | 给三选项（减必出 / 升题量 / 改优先但不保证） |
| `B7_H_UNAVAILABLE` | 拒绝 + 建议改 C 题型 |
| `B1_TYPE_UNAVAILABLE` | 该题型在当前范围出不了 → 换题型或放宽范围 |
| `B1_SHORTAGE` / `B1_ZERO_CANDIDATE` | **四选项流**（减题量 / 放宽范围 / 换策略 / 允许同条目不同版本） |
| `B4_TYPE_OVERFLOW`（在 `warnings`） | 报「原请求 → 缩后」对照（已自动等比缩 + 最大余数） |

### 3.3 执行

确认后写 `job.json`（§6）→ `node tools/run-paper.js <job.json> --confirmed` → 读 `result.json`。

- **`--confirmed` 是硬要求**（AC-18）：不带它，app 只回 `CONFIRM_REQUIRED` + `restate` +
  `intakeCoverage`，**不生成任何卷子**（`exitCode 2`）。它的语义是「老师已经看过并确认了
  intake 覆盖度」，不是「agent 自己觉得可以了」。
- `result.ok === true` 表示 **≥1 个通道成功**（AC-10）；逐通道看 `result.channels`。
- `result.failures` 非空 → 有通道失败，按 §4.6 出**红字提示** + `_pending` 路径。
- 退出码 `0` / 非 0 与 `ok` 一致。

### 3.4 报告（`interaction.report` 全量）

按 `references/文案模板.md` §三 输出：

- 各通道**产物绝对路径**（含字节数；PDF 另报页数）← `result.channels.*`
- 卷面统计：题量（请求/实际）、题型实际分布、难度实际分布、范围命中条目数 ← `result.generation`
- 引擎 `notices` **原文转述**（不加工、不省略）
- **附加要求核查**：`result.generation.acceptance`（命中 / 要求 / 是否满足 / 重抽次数）
- 题库数据信息：时间 / 条目数 / 版本数 / 数据锁状态 ← `result.snapshot`
- 本次生效的完整参数 ← `result.params`
- 题卷 / 答案卷页数 ← `result.channels.pdf[].pages`
- 失败通道的红字提示 + `_pending` 路径（若有）

---

## 4. 参数语义（必须记住的坑）

### 4.1 版本策略六选一（`versionStrategy`）

| key | 文案 | 语义 | 什么时候用 |
|---|---|---|---|
| `chemicalOnly` | 只出化学方程式 | 仅 `type=chemical` | 老师明确「只要化学方程式」 |
| `ionicOnly` | 只出离子方程式 | 仅 `type=ionic` | 离子专练 |
| `preferChemical` | 优先化学方程式 | 有条目化学版本就只用化学，否则用其余 | **建议默认** |
| `preferIonic` | 优先离子方程式 | 有离子版本就只用离子，否则用其余 | 离子专练（想尽量多） |
| `allAvailable` | 所有可用版本均可 | 六类全可 | 老师不在意写法 |
| `custom` | 教师指定版本类型 | 需配 `allowedVersionTypes` | 老师点名「只要电离和水解」 |

> ⚠ **不指定 = 拦截**：`versionStrategy` 缺失或写成 `"ASK"` 时，预检直接给
> `ASK_VERSION_STRATEGY` 拦截（`exitCode: 2`，不进导出），**不会**静默用 `chemicalOnly` 出卷；
> `restate.versionStrategy` 也如实回显 `"ASK"`。看到这个 code 就是**你漏问了第 3 问**，回 intake 补问。

**量化后果（必须主动提示老师）**：
- 全库 392 条里，`chemicalOnly` 只剩 **301** 条（损失 91 条）；
- **选择性必修 3（有机）整册离子版本 = 17 条**（第三章 烃的衍生物 13 + 第四章 生物大分子 4；
  第二轮拍板补全后由 16 变 17），但**第二章 烃 = 0 条**（纯有机反应，无离子式）→
  老师要「选必3 的烃 + 只出离子」时命中 0 条，走 B6/B1 零候选流（别自动放宽到整册）；
- **选择性必修 2 只有 6 条**条目（`chemicalOnly` 3 条）。

### 4.2 题型（`questionTypeCounts`）

`B` 给反应物写产物并配平｜`C` 给文字描述写方程式｜`D` 部分空格补全｜`E` 配平题｜`H` 开放题。

- **`H` 恒为 0**（题库 `openPrompt` 全空，H 不可用）。老师要开放题 → **B7 拒绝 + 建议改 C 题型**。
- 全 0 = 不指定 → 引擎自动用随机题型补足（只从**实际可出**的题型里选）。
- 题型指定数之和 > 总题数 → **B4：等比缩 + 最大余数**，复述框给「原请求 → 缩后」对照。

### 4.3 难度（软约束）

- 题库用中文值 `简单/中等/较难`，引擎键是 `simple/medium/hard`——**归一表必须覆盖**（B8）。
- 默认 `difficultyMode: counts` 且全 0 = 不限制。
- 难度**不满足不重试**：`notices` 原文转述 + 报实际分布表（B5）。

### 4.4 去重与必出

- 同条目一卷只出一次（`allowDuplicateEntry: false` 恒定）；`includeMustInclude: false` 恒定。
- 老师点名要某道题 → `manualEntryIds`（条目 id，如 `R0014`）；**进预检防 exceed**（B3）。
- 老师要「某物质相关 ≥N 题」→ 这是**附加验收**（AC-14），在 `job.extraAcceptance` 里声明，组卷后按 `snapshot` 核查，不满足**重抽 ≤1 次**。

### 4.5 答案线（C 题自动开）

- 卷级 `answerLine.enabled = false`（`layout.yml` 固定值，**不改**）。
- **C 题**由 `perItemRules` 注入 `showAnswerLine: true, answerLineHeightPt: 24` → C 题有 24pt 答案线，B/D/E 没有（AC-02）。
- 引擎语义：`item.showAnswerLine != null ? item.showAnswerLine : layout.answerLine.enabled`（**item 级覆盖卷级**）。

### 4.6 导出（§3.3 export）

- **PDF 双卷 + Word 双卷**恒产（`_题目` / `_答案`）。
- **图片点名才产**（`export.images: true`）；规格默认见 `engine/image.js` 的 `defaultImageOptions()`。
- 通道**互相隔离**：某通道失败不影响其他通道；**≥1 通道成功即算成功**（AC-10）。
- 全失败 → 留 `out/{yyyy-mm-dd}/_pending.json`（B9），退出码非 0。
- 部分失败 → 同样留 `_pending` + **红字提示**（话术见 `references/文案模板.md` §六）。
- 文件名冲突 → 后缀避让 `-2 … -99`（B14），旧文件字节不变（AC-11）。
- 写盘一律 `.tmp` + rename 事务（§7 坑 11）。

### 4.7 落盘位置

| 内容 | 路径 |
|---|---|
| 卷子产物 | `out/{yyyy-mm-dd}/` |
| 无头出参 | `out/{yyyy-mm-dd}/result.json` |
| 失败留痕 | `out/{yyyy-mm-dd}/_pending.json`（**只在失败时出现**；下次全成功会自动清掉同目录旧留痕） |
| 偏好记忆 | `.dsh/skill-state/last-run.json` |
| `_pending` 归档（>30 天） | `.dsh/skill-state/archive/{日期}/_pending.json` |

### 4.8 记忆与冲突链（AC-12）

- 出卷成功后 `app/main.js` 自动写 `.dsh/skill-state/last-run.json`（场景 / 范围 / 策略 / 题量 / 题型 / 难度 / 附加模板 / 导出通道）。
- 下次 `preflight` 自动补全**当次没给**的字段；`memoryReport.usedFields` 列出用了哪些。
- **冲突链：当次 > 记忆 > 默认**（老师这次说的永远赢）。
- **空值 ≠ 没填**：默认值本身就是「空对象 = 全库 / 全 0 = 不指定」，所以要**明确主张默认值**时
  必须写 `"useMemory": false`（否则记忆会把它补掉）。老师明确说「全库」「不限制难度」时就用它。
- 记忆损坏 → 系统默认 + 一行说明，**不阻塞**。

---

## 5. 异常处理速查（B1–B14 摘要，完整话术见 `references/文案模板.md`）

| # | 情形 | 你要做的 |
|---|---|---|
| B1 | 题量不足 / 候选 0 | **以预检的条目数为唯一权威**。不足 → **四选项流**：①减题量 ②放宽范围 ③换版本策略 ④允许同条目不同版本。候选 0 → 文案「命中 0 条条目（非版本策略损失）」 |
| B2 | `roundShortage` | 本项目不传 `round`，**不可达**；真出现 → 转述时附注「（本项目不应出现，请检查 opts）」 |
| B3 | `manualExceed` / `mustExceed` | **复述框阶段拦截**，给选项（减必出 / 升题量 / 改优先但不保证），**不进 generate** |
| B4 | `typeOverflow` | 等比缩 + 最大余数法，Σ = 总题数；复述框给对照 |
| B5 | 难度软约束未满足 | notices 原文 + 实际分布表；**不重试** |
| B6 | 范围零命中 / 章名不存在 / 多候选 | 复述框校验 + **列候选**让老师选；**禁止自动放宽到全库** |
| B7 | 请求 H / mustInclude / starred | 明确拒绝 + 理由 + 替代（H→C；mustInclude→`manualEntryIds`；starred→`tags` 筛选） |
| B8 | 口语记法 / 非枚举值 | 归一映射表（难度中英、册别简称、章名简称、全半角）；多候选 → B6；枚举外拒绝并附枚举表 |
| B9 | 导出失败 / 写盘失败 | 各通道独立；失败记入 `_pending`；部分失败 → **红字提示**；`.tmp` + rename 事务写 |
| B10 | `_pending` 生命周期 | **手动触发重试**（intake 轮提示）；**>30 天归档**到 `.dsh/skill-state/archive/` |
| B11 | 手选指向已禁用 / 已删条目 | 复述框前**列失效 ID + 原因**，要求剔除 |
| B12 | 题库数据锁异常 | `sync:check` 比对 `data/` 与 `data/SOURCE.json` 的数据锁；**不阻塞出卷**，报告标注「数据时间 X / 与数据锁不一致」 |
| B13 | 溢页 / 页数不齐 | 接受自然分页；报题卷/答案卷页数；**不裁剪、不补空白页** |
| B14 | 文件被占用 / 目录不可写 | 后缀避让 `-2 … -99`；仍失败 → 通道隔离；全失败 → `_pending` + 报路径 |
| **ADHOC_INVALID** | `adHocEntries` 里有不合法的临时题 | **硬拦截**（不进导出）：把 `blockers[].items` 的逐条错误念给老师（字段缺失 / 化学式解析不了 / **原子不守恒** / **电荷不守恒** / 版本策略下无可用版本），修正或剔除后重试。见 §6.2 |
| **AC-18** | `CONFIRM_REQUIRED`（没确认就出卷） | **不是错误，是关卡**：把 `restate` + `intakeCoverage` 摆给老师确认，点头后带 `--confirmed` 重跑。若 `intakeCoverage.verdict = intake-incomplete`，先点明 `unasked[]` 里哪几项不是老师说的 |

---

## 6. `job.json` schema（你写，无头入口读）

```json
{
  "jobVersion": 1,
  "scenario": "homework",
  "generation": {
    "totalCount": 10,
    "versionStrategy": "preferChemical",
    "scopes": {},
    "exclude": {},
    "questionTypeCounts": {"B": 0, "C": 0, "D": 0, "E": 0, "H": 0},
    "difficultyMode": "counts",
    "difficultyCounts": {"simple": 0, "medium": 0, "hard": 0},
    "manualEntryIds": [],
    "allowSameEntryDifferentVersion": false
  },
  "export": {"pdf": true, "docx": true, "images": false, "imagesOnDemand": null},
  "adHocEntries": [],
  "adHocOptions": {"enforceScope": false},
  "layoutOverrides": {},
  "outputDir": null,
  "dryRun": false,
  "extraAcceptance": [],
  "snapshot": {"drift": false, "checkedAt": "2026-09-19T05:00:00.000Z", "note": ""}
}
```

| 字段 | 说明 |
|---|---|
| `generation.scopeInput` | **口语范围**（推荐写这个）：`{books:["必修一"], chapters:["第一章"], sections:["离子反应"], difficulties:["中等","hard"], tags:[...], ...}`，值可以是字符串或数组；由 `preflight.js` 归一。**与 `scopes` 二者给一个即可** |
| `generation.scopes` | **归一后的范围对象**（`preflight.js` 的输出直接回填）：`{books, chapters, sections, textbookVersions, substanceCategories, reactionTypes, knowledgeModules, tags, difficulties, versionTypes}`，空对象 = 全库 |
| `generation.excludeInput` / `generation.exclude` | 同结构，取反排除 |
| `generation.questionTypeCounts` | `H` **必须为 0**；全 0 = 引擎自动补足 |
| `generation.manualEntryIds` | 手选必出（条目 id 数组，如 `["R0014"]`）；**先过预检**防 exceed（B3） |
| `generation.allowSameEntryDifferentVersion` | 只在 **B1 四选项流第 ④ 项**被老师选中时临时置 `true` |
| `adHocEntries` | **题库外临时插入的方程式**（数组）。老师给了一道题库里没有的方程式、要求「加进这份卷子」时用。**只走内存，不写 `data/library.json`**（数据锁 sha256 不变）。字段见 §6.2 |
| `adHocOptions.enforceScope` | 默认 `false` = 临时题**点名要出**（钉进必出，不受范围约束）；`true` = 与库内条目同等受范围筛选（防超纲，范围外的会被剔除并在报告里列出 `scopeDropped`） |
| `export.pdf` / `export.docx` | 默认 `true`（双卷） |
| `export.images` | 默认 `false`；老师点名要图片才 `true` |
| `export.imagesOnDemand` | 图片规格覆盖（默认取 §3.3 `imageOptions`，即 `engine/image.js` 的 `defaultImageOptions()`） |
| `layoutOverrides` | 留空即可（卷面固定）；只允许覆盖 `title` / `subtitle` / `note` / `studentInfo` |
| `outputDir` | `null` = `out/{yyyy-mm-dd}/`；**必须在本项目内**（写项目外路径会被拒绝） |
| `dryRun` | `true` = 只组卷不导出（用于自检） |
| `extraAcceptance` | AC-14 附加要求，`kind` ∈ `containsFormula` / `containsName` / `difficultyIs` / `versionTypeIs`，例：`[{"kind":"containsFormula","value":"Na","minCount":2,"label":"钠相关≥2题"}]` |
| `snapshot` | 把 `skill-state.js drift` 的结果抄进来，供报告标注（B12） |
| `maxRedraws` | 附加验收不满足时的重抽次数上限，默认 `1`（AC-14：重抽 ≤1 次） |
| `useMemory` | 默认 `true`（允许记忆补全**没填**的字段）。**要明确主张默认值**（如「这次就是全库」，不让上次的范围记忆生效）必须写 `false`——因为 §3.3 的默认值本身就是「空对象 = 全库 / 全 0 = 不指定」，空值无法与「没填」区分。CLI 等价开关：`--no-memory` |

`result.json` 字段见 `PROMPT-方程式出题skill.md` §4.3。

### 6.1 完整可跑示例（照抄即可）

```json
{
  "jobVersion": 1,
  "scenario": "timedDrill",
  "generation": {
    "scopeInput": {"books": ["必修一"], "chapters": ["第一章"]},
    "totalCount": 10,
    "versionStrategy": "preferChemical",
    "questionTypeCounts": {"B": 0, "C": 0, "D": 0, "E": 0, "H": 0},
    "difficultyMode": "counts",
    "difficultyCounts": {"simple": 4, "medium": 4, "hard": 2},
    "manualEntryIds": [],
    "allowSameEntryDifferentVersion": false
  },
  "export": {"pdf": true, "docx": true, "images": false, "imagesOnDemand": null},
  "layoutOverrides": {},
  "outputDir": null,
  "dryRun": false,
  "extraAcceptance": [],
  "snapshot": {"drift": false, "checkedAt": null, "note": ""}
}
```

```powershell
cd chem-equation-paper            # 本项目根目录
node tools/preflight.js --job my-job.json        # ① 预检 → 看 diagnostics / restate / intakeCoverage
node tools/run-paper.js my-job.json              # ② 未确认 → CONFIRM_REQUIRED，不生成卷子
node tools/run-paper.js my-job.json --confirmed  # ③ 老师确认后 → 出卷，打印 result.json
node tools/skill-state.js pending                # ④ 看有没有失败留痕
```

### 6.2 临时插入题库外的方程式（`adHocEntries`）

**什么时候用**：老师说「再加一道 XXX 方程式，题库里没有」。这是**唯一**允许引入库外方程式的通道。

> ⚠ 不要为了插一道题去改 `data/library.json` —— 那会触发数据锁不一致（B12），且违背「不写回题库」的边界。
> `adHocEntries` 只在**内存副本**里合并，磁盘题库与数据锁 sha256 一个字节都不动。

```json
"adHocEntries": [
  {
    "name": "酸性高锰酸钾与过氧化氢",
    "difficulty": "中等",
    "questionType": "B",
    "description": "向酸性高锰酸钾溶液中滴加过氧化氢，紫色褪去并放出能使带火星木条复燃的气体。",
    "tags": ["临时补充"],
    "versions": [
      {
        "type": "ionic",
        "reactants": [
          {"formula": "MnO4^-", "coefficient": 2},
          {"formula": "H2O2", "coefficient": 5},
          {"formula": "H+", "coefficient": 6}
        ],
        "products": [
          {"formula": "Mn^2+", "coefficient": 2},
          {"formula": "O2", "coefficient": 5, "gas": true},
          {"formula": "H2O", "coefficient": 8}
        ],
        "conditions": []
      }
    ]
  }
],
"adHocOptions": {"enforceScope": false}
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `name` | ✅ | 条目名（复述框与报告都用它） |
| `difficulty` | | `简单` / `中等` / `较难`，默认 `中等` |
| `questionType` | | `B` / `C` / `D` / `E`，默认 `B`。**`H` 不支持**（题库无开放题素材）；`C` 必须同时写 `description` |
| `description` | C 题必填 | 文字描述（C 题型据此出题） |
| `id` | | 不写则自动分配 `AD-001`…；写了就不能与题库条目或本次其它临时题重名 |
| `versions[]` | ✅ | 至少 1 个；字段与题库 `versions` 完全一致（`type` ∈ 六种方程式类型、`reactants`/`products` 的 `formula`+`coefficient`、可选 `conditions`） |
| `tags` / `knowledgeModules` / `reactionTypes` / `substanceCategories` / `textbooks` | | 与题库条目同义，用于筛选与报告 |

**引擎会做什么**：
- 逐条做**原子守恒 + 电荷守恒**校验（与题库同款 `engine/chem.js`）——配平写错、电荷不平**直接硬拦截**（`ADHOC_INVALID`，`exitCode 2`，不进导出），错误信息逐条列出。
- 默认 `enforceScope:false` → 临时题**钉进必出**，一定出现在卷面上，不受 `scopes` 约束（与 `manualEntryIds` 同语义）。
- `enforceScope:true` → 不钉，与库内条目同等受范围筛选；被范围挡掉的会在 `result.json` 的 `adhoc.scopeDropped` 与复述框里如实列出。
- **占用总题数**：临时题算在 `totalCount` 里（要 10 题 + 2 道临时题 → `totalCount` 写 12）。
- 报告里 `result.json.adhoc` 给出 `requested / accepted / rejected / pinned / scopeDropped / entries`；复述框里是 `restate.adhoc`。

**跨卷去重**：本项目**不**持久化记录临时题（没有桌面版那种 `used.json`）。临时题每次都要重新给；
若同一道题反复插入，报告里会照常出现，需要老师自己留意。

**零副作用的证据**（`npm run test:adhoc` 会逐项断言）：
- `data/library.json` 字节不变、`data:check` 仍为「392 条 / 553 版本」
- `result.json` 的 `snapshot.entries` 仍是 **392**（临时题不虚增题库口径）
- 出卷产物落在 `out/{yyyy-mm-dd}/`，题库目录无任何写入

可直接照抄的完整样例：`examples/job-adhoc-external.json`。

---

## 7. 自检清单（交付前逐项确认）

- [ ] 引擎上游项目下**没有任何文件被创建/修改**（AC-17；上游未配置时该快照 `skipped`）
- [ ] `npm run test:engine` = 「通过 238 项，失败 0 项」
- [ ] `npm run test:edge` = 「通过 106 / 失败 0」
- [ ] `npm run test:adhoc` = 「通过 25 项」+「通过 27 项」（临时插入题库外方程式：校验 / 进卷 / 范围开关 / 零副作用）
- [ ] `npm run test:patches` = 「21/21 通过」（2 个本地补丁：`engine/docx.js`、`engine/chem.js`；未配置上游时 19/21）
- [ ] `npm run test:acceptance` = 「18/18 通过」（含 AC-18 覆盖度 / 确认闸门）
- [ ] `npm run data:check` = 「数据已锁定：392 条 / 553 版本」
- [ ] `npm run runtime:check` = 「Electron 运行时就绪（本项目自带）」
- [ ] `npm run sync:check` = 「全部一致 ✓」
- [ ] 预检报的是**条目数**，不是引擎的 `available` 版本数
- [ ] 卷内**没有 H 题**；C 题有 24pt 答案线、B/D/E 没有
- [ ] 复述框里能看到：题量、范围、存哪、叫什么名、题库数据时间、**intake 覆盖度**（哪几项是记忆/默认给的）
- [ ] 出卷命令带 `--confirmed`；不带时**零卷子产出**（`CONFIRM_REQUIRED`，只留 result.json）
- [ ] 失败通道有红字提示 + `_pending` 路径；全失败时退出码非 0

## 8. 配套文件与工具

| 文件 | 内容 |
|---|---|
| `layout.yml` | 固定卷面模板（A4 纵 / 2cm / 1 栏 / 宋体+TNR 16/12/10.5 / 单倍 / 题距 6 / 自动分页 / 页脚页码） |
| `presets.yml` | 场景预设包（三场景标题 + 学生栏开关 + 共用项） |
| `references/决策清单.md` | 必问 3 项 / 可默认项 / 永不问项 / 冲突链 |
| `references/归一映射表.md` | 口语 → 引擎枚举（B8 的实现依据） |
| `references/文案模板.md` | intake / 复述框 / 报告 / 拒绝 / 红字提示话术 + 常见追问 |
| `../../../PROMPT-方程式出题skill.md` | 需求规格全文（v1.1 正文 + §3.2b 的 v1.2 变更记录，含 17 条验收用例） |

| 工具 | 作用 |
|---|---|
| `tools/preflight.js` | 归一 + 预检 + 文件名预览 + 诊断 + 记忆补全（`--self-test` 跑 6 基准对照）；也归一 `custom` 策略的 `allowedVersionTypes` |
| `tools/run-paper.js` | 出卷启动器（用**本项目自带**的 `runtime/electron/` 跑 `app/main.js`；**`--confirmed` = 确认闸门放行**，不带则只回 `CONFIRM_REQUIRED` + 覆盖度；`--render-check` 只截图；`--print-runtime` 查路径） |
| `tools/skill-state.js` | 记忆 / 数据锁 / `_pending` 生命周期（`state` / `drift` / `memory` / `pending` / `archive`） |
| `tools/adhoc.js` | **题库外临时插入的方程式**（§6.2）：规范化 + 化学校验 + 内存合并（不写盘）。`--self-test` 跑 25 项；`--example` 打印可粘贴样例 |
| `tools/data-lock.js` | 题库数据锁：`data/` 是本项目自有数据；合法变更后重新锁定（`npm run data:lock`） |
| `tools/install-runtime.js` | Electron 运行时装入 / 校验（`npm run runtime:install` / `runtime:check` / `--print`） |
| `tools/sync-from-source.js` | 只同步**引擎副本**（数据不同步）；`--check` 只比对（引擎漂移 + 数据锁）；登记过的本地补丁按 `data/ENGINE-PATCHES.json` 认账 |
| `tools/test-engine-patches.js` | 校验引擎副本的本地补丁（哈希 + 行为断言）；重新打补丁后 `--update` 刷新登记 |
| `tools/test-edge.js` | 边界与异常回归（归一 / 拦截 / CLI / 输出目录 / `_pending` / 补丁登记 / 数据锁 / 自带运行时 / 公式渲染 / 版本类型归一 / 离子式拍板结论，**93 项**） |
| `tools/test-adhoc.js` | ad-hoc 集成回归（**27 项**）：临时题确实进卷 / 每题题型生效 / `enforceScope` 开关 / 非法题硬拦截 / 数据锁与快照零副作用 |
| `data/ENGINE-PATCHES.json` | 本地补丁登记表（上游哈希 / 补丁哈希 / 症状 / 根因 / 修法）—— 现有 2 项：`engine/docx.js`（Word 电荷渲染）、`engine/chem.js`（纯文本多位数下标 + 尾随电荷） |
| `engine/paper.js` | 组卷编排（调 `G.generate` + perItemRules + 附加验收核查） |
| `engine/image.js` | 图片通道文档构建（移植自上游已验证实现） |
| `app/main.js` / `app/harness.html` | 无头 Electron 主进程 / 薄渲染壳 |
| `tools/yml.js` | 极小 YAML 子集解析 + `layout.yml`/`presets.yml` 装载（无依赖） |
