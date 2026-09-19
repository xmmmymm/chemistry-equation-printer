---
name: chem-equation-paper
description: 从化学方程式题库快照出卷并导出 Word / PDF / 图片。当用户说「出一份化学方程式卷子 / 作业 / 限时练 / 备考练习」「给我出 10 道方程式题」「把这些章节的方程式出成卷子」「出题打印」等意图时使用。流程：澄清需求（场景 / 范围 / 版本策略）→ 预检可出题数 → 复述确认 → 无头组卷导出 → 结构化汇报。产物落在本项目 out/{yyyy-mm-dd}/，绝不写入题库主项目。
version: 1.1.0
---

# 方程式出题 skill（chem-equation-paper）

## 0. 这个 skill 做什么

老师在对话里说一句「出 10 道必修一的化学方程式作业」，你负责：

1. **澄清**（必问 3 项 + 1 项附加要求）——不要静默替老师决定版本策略；
2. **预检**——把口语范围归一成引擎能懂的范围，算出「最多能出几题」，不够就当场给选项；
3. **复述确认**——用老师看得懂的话把「要出几题、什么范围、存哪、叫什么名」摆出来；
4. **执行**——一条命令无头组卷导出 PDF 双卷 + Word 双卷（图片点名才出）；
5. **汇报**——产物路径、卷面统计、引擎 notices 原文、快照时间与漂移状态、参数存档。

**卷面格式是固定的**（`layout.yml`），老师不需要调；只有**场景包**（标题 + 有无学生栏）随场景变。

---

## 1. 三条不可违反的边界

| # | 边界 | 具体要求 |
|---|---|---|
| **1** | **绝不写主项目** | 主项目 `E:\DSH work\方程式` 只读。题库、设置、历史作业、导出目录、备份目录**一个字节都不碰**。产物只落本项目 `out/`。 |
| **2** | **不写回题库** | 条目的 `questionCount` / `lastUsedAt` **只读不改**（v1.1 已取消写回）。 |
| **3** | **不自动放宽** | 范围零命中时**禁止**自动放宽到全库；必须列候选让老师选（B6）。 |

> 交付验收含 **AC-17：出卷前后对主项目做全量 sha256 快照 → 零差异**。任何时候都不要在主项目路径下创建临时文件。

---

## 2. 调用方式（一条命令）

```powershell
cd "E:\DSH work\方程式出题skill"
node tools/run-paper.js <job.json>
```

- `job.json` 的 schema 见 §6；启动器会用**借用的** Electron 运行时（主项目那份，不安装、不复制）跑 `app/main.js`。
- 退出码：`0` = ≥1 个通道成功（`ok:true`）；非 0 = 全部失败（`ok:false`）。
- 无论成功失败，都会打印一份 JSON，并写 `result.json` 到 `out/{yyyy-mm-dd}/`。
- **无头**：不会有任何对话框。

辅助命令（纯 Node，不需要 Electron，用于澄清阶段）：

```powershell
node tools/skill-state.js state                  # intake 第一步：drift + memory + pending 一次拿全
node tools/skill-state.js drift                  # 快照漂移检测（不阻塞出卷）
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
[restate] 复述框（老师确认/改）
   ↓  （老师说“改” → 回 intake，只问变化项）
[execute]  node tools/run-paper.js <job.json>
   ↓
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
| `drift` | 快照时间 / 条目数 / 是否与主项目一致 → **抄进复述框**，漂移**不阻塞**（B12） |
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

固定五块，用老师看得懂的话写（**模板见 `references/文案模板.md` §二**）：

1. **全参数表**——场景、题量、题型分布、难度目标、版本策略、导出通道
2. **范围映射结果**——老师说的口语 → 归一后的册/章/节（含**归一依据**，来自 `restate.scopeMapping`）
3. **预检可出题数**——**必须是条目数**（`preflight.authoritativeCount`，不是引擎的 `available` 版本数）；不足时给四选项
4. **文件名预览**——`restate.files[].name`（含避让后的实际名）+ `restate.outputDir`
5. **快照时间与漂移状态**——`restate.snapshot`

可改项（`restateModifiable`）：题量、题型分布、难度目标、手选必出、排除范围、导出通道、是否出图片。
**永不问**：卷面参数、`allowDuplicateEntry`、`includeMustInclude`、学习项目挂靠。

**拦截项必须当场解决**（看 `diagnostics.blockers[].code`）：

| code | 你要做的 |
|---|---|
| `B6_AMBIGUOUS` | 把 `blockers[].items[].candidates` **列给老师选** |
| `B6_UNMATCHED` | 列 `blockers[].items[].hints` 里的候选（册/章/节全集），**禁止自动放宽到全库** |
| `B11_INVALID_MANUAL_ID` | 列失效 ID + 原因，要求剔除 |
| `B3_MANUAL_EXCEED` | 给三选项（减必出 / 升题量 / 改优先但不保证） |
| `B7_H_UNAVAILABLE` | 拒绝 + 建议改 C 题型 |
| `B1_TYPE_UNAVAILABLE` | 该题型在当前范围出不了 → 换题型或放宽范围 |
| `B1_SHORTAGE` / `B1_ZERO_CANDIDATE` | **四选项流**（减题量 / 放宽范围 / 换策略 / 允许同条目不同版本） |
| `B4_TYPE_OVERFLOW`（在 `warnings`） | 报「原请求 → 缩后」对照（已自动等比缩 + 最大余数） |

### 3.3 执行

确认后写 `job.json`（§6）→ `node tools/run-paper.js <job.json>` → 读 `result.json`。

- `result.ok === true` 表示 **≥1 个通道成功**（AC-10）；逐通道看 `result.channels`。
- `result.failures` 非空 → 有通道失败，按 §4.6 出**红字提示** + `_pending` 路径。
- 退出码 `0` / 非 0 与 `ok` 一致。

### 3.4 报告（`interaction.report` 全量）

按 `references/文案模板.md` §三 输出：

- 各通道**产物绝对路径**（含字节数；PDF 另报页数）← `result.channels.*`
- 卷面统计：题量（请求/实际）、题型实际分布、难度实际分布、范围命中条目数 ← `result.generation`
- 引擎 `notices` **原文转述**（不加工、不省略）
- **附加要求核查**：`result.generation.acceptance`（命中 / 要求 / 是否满足 / 重抽次数）
- 快照信息：时间 / 条目数 / 版本数 / 漂移状态 ← `result.snapshot`
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

**量化后果（必须主动提示老师）**：
- 全库 392 条里，`chemicalOnly` 只剩 **301** 条（损失 91 条）；
- **选择性必修 3（有机）离子版本 = 0 条** → `ionicOnly` 命中 0 条；
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
| B12 | 快照漂移 | `sync:check` 比对 sha256；**不阻塞出卷**，报告标注「快照时间 X / 主项目已更新 Y」 |
| B13 | 溢页 / 页数不齐 | 接受自然分页；报题卷/答案卷页数；**不裁剪、不补空白页** |
| B14 | 文件被占用 / 目录不可写 | 后缀避让 `-2 … -99`；仍失败 → 通道隔离；全失败 → `_pending` + 报路径 |

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
| `export.pdf` / `export.docx` | 默认 `true`（双卷） |
| `export.images` | 默认 `false`；老师点名要图片才 `true` |
| `export.imagesOnDemand` | 图片规格覆盖（默认取 §3.3 `imageOptions`，即 `engine/image.js` 的 `defaultImageOptions()`） |
| `layoutOverrides` | 留空即可（卷面固定）；只允许覆盖 `title` / `subtitle` / `note` / `studentInfo` |
| `outputDir` | `null` = `out/{yyyy-mm-dd}/`；**必须在本项目内**（写主项目路径会被拒绝） |
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
cd "E:\DSH work\方程式出题skill"
node tools/preflight.js --job my-job.json        # ① 预检 → 看 diagnostics / restate
node tools/run-paper.js my-job.json              # ② 出卷 → 打印 result.json
node tools/skill-state.js pending                # ③ 看有没有失败留痕
```

---

## 7. 自检清单（交付前逐项确认）

- [ ] 主项目 `E:\DSH work\方程式` 下**没有任何文件被创建/修改**（AC-17）
- [ ] `npm run test:engine` = 「通过 238 项，失败 0 项」
- [ ] `npm run sync:check` = 「全部一致 ✓」
- [ ] 预检报的是**条目数**，不是引擎的 `available` 版本数
- [ ] 卷内**没有 H 题**；C 题有 24pt 答案线、B/D/E 没有
- [ ] 复述框里能看到：题量、范围、存哪、叫什么名、快照时间
- [ ] 失败通道有红字提示 + `_pending` 路径；全失败时退出码非 0

## 8. 配套文件与工具

| 文件 | 内容 |
|---|---|
| `layout.yml` | 固定卷面模板（A4 纵 / 2cm / 1 栏 / 宋体+TNR 16/12/10.5 / 单倍 / 题距 6 / 自动分页 / 页脚页码） |
| `presets.yml` | 场景预设包（三场景标题 + 学生栏开关 + 共用项） |
| `references/决策清单.md` | 必问 3 项 / 可默认项 / 永不问项 / 冲突链 |
| `references/归一映射表.md` | 口语 → 引擎枚举（B8 的实现依据） |
| `references/文案模板.md` | intake / 复述框 / 报告 / 拒绝 / 红字提示话术 + 常见追问 |
| `../../../PROMPT-方程式出题skill.md` | 需求规格 v1.1 全文（含 17 条验收用例） |

| 工具 | 作用 |
|---|---|
| `tools/preflight.js` | 归一 + 预检 + 文件名预览 + 诊断 + 记忆补全（`--self-test` 跑 6 基准对照） |
| `tools/run-paper.js` | 出卷启动器（借 Electron 运行时跑 `app/main.js`；`--render-check` 只截图） |
| `tools/skill-state.js` | 记忆 / 漂移 / `_pending` 生命周期（`state` / `drift` / `memory` / `pending` / `archive`） |
| `tools/sync-from-source.js` | 从主项目同步快照与引擎副本；`--check` 只比对（漂移检测） |
| `engine/paper.js` | 组卷编排（调 `G.generate` + perItemRules + 附加验收核查） |
| `engine/image.js` | 图片通道文档构建（移植主项目已验证实现） |
| `app/main.js` / `app/harness.html` | 无头 Electron 主进程 / 薄渲染壳 |
| `tools/yml.js` | 极小 YAML 子集解析 + `layout.yml`/`presets.yml` 装载（无依赖） |
