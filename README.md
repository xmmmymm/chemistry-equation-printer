# chem-equation-paper

> **给 AI agent 的化学方程式出题 skill**：从自有题库组卷，导出 **Word / PDF / 图片**。
> 流程是 agent 澄清需求 → 预检可出题量 → 复述确认 → 无头组卷导出 → 汇报产物路径。

面向高中化学教师：**无 GUI、完全离线**、不联网、不依赖任何在线服务；题库、引擎、Electron 运行时
全在项目内，克隆下来 `npm i` 就能跑。

> ⚠️ **本仓库已换内容**：这里现在是 **chem-equation-paper**（给 AI agent 用的出题 skill），
> 取代了原先同名的**桌面版组卷打印应用**（已废弃）。
> 旧桌面版的完整代码仍保留在归档分支 [`archive/desktop-app-v1`](https://github.com/xmmmymm/chemistry-equation-printer/tree/archive/desktop-app-v1)，
> 查看方式：<https://github.com/xmmmymm/chemistry-equation-printer/tree/archive/desktop-app-v1>。详见下方「与上游项目的关系」。

## 特点

- **确认闸门**：不带 `--confirmed` **一个字节都不生成**（`CONFIRM_REQUIRED`，`exit 2`）——
  把「先复述、老师点头才出」从话术约定升级为引擎级关卡
- **零项目外依赖**：题库 `data/` 自持、引擎副本 `engine/` 在库内、Electron 运行时装进 `runtime/`
- **化学正确性内建**：原子守恒 + 电荷守恒校验；553 个版本全部通过
- **零副作用**：对上游项目只读，出卷前后全量 sha256 快照验证**零差异**（AC-17）

## 快速开始

```powershell
git clone https://github.com/xmmmymm/chemistry-equation-printer.git
cd chemistry-equation-printer
npm i --no-save electron@33.4.11   # 取一份 Electron dist
npm run runtime:install            # 装进 runtime/electron/
npm run paper -- examples/job.json --confirmed
```

产物落在 `out/{yyyy-mm-dd}/`。

## 与旧桌面版的关系：引擎副本来自本仓库的归档分支

本项目**取代**了原先挂在同一仓库地址下的**桌面 GUI 应用**（**已废弃**）。
旧版是需要手动点按的 Electron 桌面 app；本项目是它的**改进替代品**——同样的题库与引擎，
但改成**给 AI agent 调用的无头 skill**，出题流程更严谨（引擎级确认闸门）、产物格式更多（多了 Word 与图片通道）。

> 旧桌面版的完整代码保留在本仓库归档分支 **`archive/desktop-app-v1`**，未删除：
> <https://github.com/xmmmymm/chemistry-equation-printer/tree/archive/desktop-app-v1>
>
> 下面的「上游」一律指这份旧代码（`src/libs/*.js` 引擎、`scripts/test-chem.js` 等）。

| | 上游（旧桌面版，已废弃 → `archive/desktop-app-v1`） | 本项目（`main`） |
|---|---|---|
| 形态 | Electron 桌面 GUI（`main.js`） | **AI agent skill**（`.dsh/skills/chem-equation-paper/` + `tools/`） |
| 关系 | **可选**：仅作引擎副本的上游（`npm run sync` 用） | 完全自持的独立项目（**绝不写回上游任何文件**） |
| 数据 | — | `data/library.json`（392 条 / 553 版本）——**本项目自有数据（source of truth）** |
| 引擎 | `src/libs/*.js` | `engine/` 下**副本**（已在库内；上游更新时手动 `npm run sync` 拉取） |
| Electron | `node_modules/electron/dist/`（268MB） | `runtime/electron/` **自带一份**（v33.4.11，268MB / 73 文件；`npm run runtime:install` 装入） |
| 产物 | — | 本项目 `out/{yyyy-mm-dd}/` |

**本项目不需要上游在场也能完整出卷**——数据、引擎、Electron 运行时全在项目内。
上游只出现在一处**可选的开发期**用途：`npm run sync`（拉引擎副本）；未配置时它只是跳过比对，不影响出卷。

**要拉取引擎副本**：把旧版检出到本地，再指向它——

```powershell
git clone -b archive/desktop-app-v1 https://github.com/xmmmymm/chemistry-equation-printer.git ../旧桌面版
npm run sync -- --source=../旧桌面版      # 或设环境变量 CHEMEQ_SOURCE
```

- **数据独立**：`data/` 不从上游同步，改题库直接改本项目这一份；改动后用
  `npm run data:lock` 重新锁定（`data/SOURCE.json` 里的 `library` 哈希），`npm run sync:check` 会校验。
  `data/SOURCE.json` 的 `origin` 块只记录历史来源（fork 点），不参与任何判定。
- **运行时自带**：`runtime/electron/`（已 gitignore，见下）；`tools/run-paper.js` 只接受**项目内**路径，
  不会悄悄退回外部目录。`node tools/run-paper.js --print-runtime` 可查当前用的是哪一个。
- 上游的题库、设置、历史作业、导出目录**不会被本 skill 读写**。
  出卷前后对上游做全量 sha256 快照 → **零差异**（AC-17，含 mtime）。
- **上游路径默认未配置**：要跑引擎漂移比对时用 `node tools/sync-from-source.js --source=<上游克隆路径>`
  或设环境变量 `CHEMEQ_SOURCE`。

> ⚠️ `runtime/` 与 `node_modules/` 一样**不入版本库**：`electron.exe` 单文件 188MB，超过 GitHub 的
> 100MB 硬上限，提交会直接推不上去。新克隆 / 换机后跑一次 `npm run runtime:install` 即可（见下）。

## 目录

```
.dsh/skills/chem-equation-paper/   skill 本体 ★入库
    SKILL.md                       触发语义 + 两段式流程 + 三清单 + 调用方式
    layout.yml                     固定卷面模板（A4 纵 / 2cm / 1 栏 / 宋体+TNR 16/12/10.5 …）
    presets.yml                    场景预设包（homework / timedDrill / examPrep）
    references/                    决策清单 / 归一映射表 / 文案模板
.dsh/skill-state/                  运行时状态（last-run.json / archive/）——已 gitignore
app/                               无头 Electron 入口
    main.js                        主进程：预检 → 确认闸门 → 组卷 → 渲染 → 导出 → result.json
    harness.html                   薄渲染壳（普通 <script> 加载 engine/*，无 IPC）
    lib/render-check.js            开发期：只渲染卷面截图
engine/                            引擎副本 + 本项目新增
    chem/constants/generator/exporter/docx/importer.js   上游引擎副本
                                  （docx.js 与 chem.js 带**本地补丁**，见 data/ENGINE-PATCHES.json）
    paper.js                       ★新增：组卷编排（perItemRules / 附加验收 / 失败翻译）
    image.js                       ★新增：图片通道文档构建
    test-chem.js + fixtures/       回归测试（238 项）
data/                              **本项目自有题库**（library.json / classifications.json / SOURCE.json）
    ENGINE-PATCHES.json            ★新增：引擎副本本地补丁登记表（sync:check 据此认账）
                                   —— 2 项：engine/docx.js（Word 电荷）、engine/chem.js（纯文本下标+电荷）
runtime/electron/                  ★新增：**本项目自带的 Electron 运行时**（v33.4.11，268MB / 73 文件）
                                   ——已 gitignore；npm run runtime:install 装入
docs/reference/                    数据字典、题库统计、可出题量预检（上游投喂包复制 + 本项目补全记录）
tools/
    preflight.js                   ★预检与归一（B1/B4/B6/B8/B11 + ASK 拦截 + intakeCoverage + 6 基准自检）
    skill-state.js                 ★记忆 / 数据锁 / _pending 生命周期（B10/B12）
    data-lock.js                   ★题库数据锁：data/ 变更后重新锁定（npm run data:lock）
    install-runtime.js             ★Electron 运行时装入/校验（npm run runtime:install / runtime:check）
    acceptance.js                  ★18 条验收用例测试台（跑批收尾自检真实产物目录零污染）
    test-engine-patches.js         ★引擎副本本地补丁校验台（哈希 + 17 条行为断言）
    test-edge.js                   ★边界与异常回归（106 项，纯 Node 秒级）
    sync-from-source.js            只同步引擎副本（补丁感知；数据不同步）
    run-paper.js                   出卷启动器（用本项目 runtime/electron/ 启动；`--confirmed` 过确认闸门；`--print-runtime` 查路径）
    yml.js                         极小 YAML 子集解析（无依赖）
examples/                          可直接跑的 job.json 示例
out/                               出卷产物——已 gitignore
PROMPT-方程式出题skill.md          实施提示词（需求规格 v1.1 全文 + v1.2 变更记录）
```

## 常用命令

```powershell
# 回归
npm test                   # 五套快测一把跑：engine 238 / preflight 6 / state 9 / patches 19-21 / edge 106
npm run test:engine        # 引擎副本回归：应为「通过 238 项，失败 0 项」
npm run test:preflight     # 预检 6 个基准场景对照 docs/reference/04-可出题量预检.md
npm run test:state         # 状态管理自检（记忆 / 数据锁 / pending / 冲突链）
npm run test:patches       # 引擎副本本地补丁校验（哈希 + 17 条行为断言）→ 21/21；未配置上游时 19/21（跳过 2 条上游哈希校验）
npm run test:edge          # 边界与异常回归（归一/拦截/CLI/输出目录/_pending/补丁登记/数据锁/自带运行时/公式渲染/版本类型归一/intake 覆盖度）
npm run test:acceptance    # 跑 §3.4 全部 17 条验收用例 + 本项目 AC-18（18/18；含上游零写入校验 + 真实产物目录零污染自检）

# 数据（本项目自有，不从上游同步）
npm run data:lock          # 改完题库后重新锁定（写 data/SOURCE.json 的 library/classifications）
npm run data:check         # 只校验数据锁；不一致 exit 1

# Electron 运行时（本项目自带，268MB）
npm run runtime:check      # 校验 runtime/electron/ 是否就绪
npm run runtime:install    # 装入（默认找本项目 node_modules/electron/dist；可 -- --from=<Electron dist 目录>）
node tools/run-paper.js --print-runtime   # 查当前实际使用的 electron.exe 路径

# 引擎副本（上游可选：未配置时 sync 直接跳过引擎比对，不影响出卷）
npm run sync               # 从上游拉取 engine/*.js 引擎副本（**不动 data/**）；需 --source=<克隆路径> 或 CHEMEQ_SOURCE
npm run sync:check         # 只比对不写入：引擎漂移 + 数据锁；有问题 exit 1（登记过的本地补丁不算漂移）

# 出卷（四步：预检 → 复述确认 → 出卷）
node tools/skill-state.js state              # ① intake 第一步：drift + memory + pending
node tools/preflight.js --job my-job.json    # ② 预检：归一 + 可出题数（条目数）+ 诊断 + intakeCoverage
node tools/run-paper.js my-job.json          # ③ 未确认 → CONFIRM_REQUIRED，零卷子产出
node tools/run-paper.js my-job.json --confirmed   # ④ 老师确认覆盖度后 → 出卷，落 out/{日期}/

# 开发期
node tools/run-paper.js my-job.json --render-check   # 只渲染卷面截图，不产出卷子
node tools/preflight.js --self-test
```

## 当前状态

- ✅ 阶段 0 基线自检：`test:engine` 238/0、`sync:check` 全部一致
- ✅ 阶段 1 skill 本体：`SKILL.md` / `layout.yml` / `presets.yml` / `references/`（决策清单、归一映射表、文案模板）
- ✅ 阶段 2 预检与归一：`tools/preflight.js`，6 个基准场景与预检表 **6/6 一致**；**预检表全表 77 行 × 5 策略逐格复核一致**
- ✅ 阶段 3 组卷：`engine/paper.js`（`G.generate` + perItemRules + AC-14 附加验收，重抽 ≤1 次）
- ✅ 阶段 4 无头导出：`app/main.js` + `app/harness.html`，PDF 双卷 / Word 双卷 / 图片（点名才产）
- ✅ 阶段 5 交互层：两段式流程 + 复述框 + 三清单 + 全套话术
- ✅ 阶段 6 记忆与 `_pending`：`tools/skill-state.js`（冲突链 当次 > 记忆 > 默认；>30 天归档）
- ✅ 阶段 7 验收：**§3.4 全部 17 条通过 + 本项目 AC-18（18/18）**，证据在 `out/_acceptance/`
- ✅ 引擎上游零写入：出卷前后全量 sha256 + mtime **零差异**
- ✅ v1.2 零项目外依赖：`data/` 自有 + `runtime/electron/` 自带；题库 **392 条 / 553 版本**（离子方程式 147 个）
- ✅ v1.3 确认闸门：`intakeCoverage` 逐项标注必问项来源（explicit / memory / default）；
  **不带 `--confirmed` 一个字节都不生成**（`CONFIRM_REQUIRED`，`exitCode 2`）——把「先复述、
  老师点头才出」从话术升级为引擎级关卡
- ✅ v1.4 开源发布：清除本机绝对路径（代码改环境变量 / `--source`，文档改相对表述），
  补 LICENSE / 仓库元数据，标注上游 `chemistry-equation-printer` 已废弃、本项目为改进替代品

### v1.4 变更：开源发布（去除本机路径绑定）

**问题**：代码与文档里有 40 余处本机绝对路径（`E:\DSH work\方程式` 等），直接公开会让别人
的机器上跑出指向作者本机的默认路径。

**修法**（只动「可选开发期」路径，不动任何出卷逻辑与判定）：

| 位置 | 变更前 | 变更后 |
|---|---|---|
| `tools/sync-from-source.js` | 兜底默认 `'E:/DSH work/方程式'` | **未配置即跳过引擎比对**（`--source=` / `CHEMEQ_SOURCE`）；`JOBS[].from` 改为惰性求值，避免 `path.join(null,…)` 抛错 |
| `tools/install-runtime.js` | 兜底默认上游 electron dist 路径 | 兜底改为**本项目 `node_modules/electron/dist`**；找不到时给出两条明确指令（先 `npm i --no-save electron` 或 `--from=`） |
| `tools/test-engine-patches.js` | 兜底默认上游路径 | 未配置上游 → **跳过「上游未变」校验**（本地哈希 + 行为断言照常，19/21） |
| `tools/acceptance.js` | `SOURCE_ROOT` 硬编码 | 读 `CHEMEQ_SOURCE`，缺省不比对；AC-17 标注 `skipped`（新增 `skipped` 字段贯通 result.json / summary.json / 终端输出） |
| `tools/skill-state.js` | 兜底默认上游路径 | 改为 `null`（该变量仅用于溯源显示，不参与判定） |
| `data/SOURCE.json` | `sourceProject` / `origin.project` / `electronRuntime.path` 为本机绝对路径 | 置 `null` / 改相对路径 + 加 `*Note` 说明；历史来源改记为仓库名 |

> 验证：清理后 `npm test` 全绿（engine 238 / preflight 6 / state 9 / patches 19 / edge 106），
> `data:check`、`sync:check` 均 exit 0；配 `CHEMEQ_SOURCE` 指向本地上游时 `patches` 回到 21/21、
> `sync:check` 8 个引擎文件全部一致。

### v1.2 变更：零项目外依赖 + 离子方程式补全

**① 数据从「主项目快照」改为「本项目自有数据」**

原先 `data/library.json` 是上游旧桌面版 `data/library.json` 的同步副本，
改这一份会被下次 `npm run sync` 覆盖。现已解耦：

| 项 | 变更前 | 变更后 |
|---|---|---|
| `data/library.json` / `classifications.json` | 主项目快照副本，sync 会覆盖 | **本项目自有数据（source of truth）**，sync 不碰 |
| `data/SOURCE.json` | 快照元数据（源路径 / 源哈希 / 同步时间） | 数据锁（`library` / `classifications` 哈希）+ `origin` 历史来源 + `sourceProject`（引擎上游） |
| `npm run sync` | 同步 data + engine | **只同步 engine 副本** |
| `npm run sync:check` | 引擎漂移 + 主项目题库比对 | 引擎漂移 + **数据锁一致性**；主项目不可达时跳过引擎比对、数据锁照常校验 |
| B12「漂移」语义 | 主项目题库已更新 → 标注 | **本地题库 vs 数据锁不一致**（data/ 被项目之外改动）→ 标注，仍不阻塞出卷 |
| 新增命令 | — | `npm run data:lock` / `npm run data:check`（改完题库重新锁定 / 只校验） |

**② Electron 运行时改为本项目自带（零项目外依赖的最后一块）**

原先 `tools/run-paper.js` 借用主项目的 `node_modules/electron/dist/electron.exe`（v33.4.11，268MB），
现整份 dist 已复制进本项目 `runtime/electron/`（73 文件，逐文件 sha256 校验一致）：

| 项 | 变更前 | 变更后 |
|---|---|---|
| 运行时位置 | 上游的 `node_modules/electron/dist/` | `runtime/electron/`（本项目内，已 gitignore） |
| 解析顺序 | 环境变量 → SOURCE.json（可为项目外）→ **主项目兜底** | 环境变量（显式覆盖，越界告警）→ SOURCE.json（**必须是项目内**）→ `runtime/electron/` |
| 缺失时 | 静默退回主项目那份 | 明确报错 + `npm run runtime:install` 指引（**不会**退回外部） |
| 新工具 | — | `tools/install-runtime.js`（`runtime:install` 装入 / `runtime:check` 校验 / `--print-runtime` 查路径） |

> `runtime/` 已 gitignore：`electron.exe` 单文件 188MB，超 GitHub 100MB 硬上限，提交会推不上去。
> 新克隆 / 换机后跑 `npm run runtime:install`（默认从 `data/SOURCE.json` 记录的来源复制，
> 也可 `-- --from=<任意 Electron dist 目录>`）。

**③ 离子方程式补全：17 条**

审计全库 392 条目 / 531 版本：含化学方程式的条目 301 条，其中已有离子方程式的 85 条。
逐条做化学判定后分三档——**该补 17 条**（水溶液离子反应，且库里已有同类先例）、
**不该补 183 条**（燃烧/高温固气反应、受热分解、氧化物与水化合、熔融电解、非水体系电池、
浓硫酸/浓盐酸/石灰乳语境、纯有机反应）、**有争议 11 组 / 16 条**（未补，留待拍板）。
补全后：**553 版本 / 离子方程式 147 个**（第一轮 17 条 → 548/142；第二轮拍板 5 条 → 553/147），全部通过引擎原子守恒 + 电荷守恒校验。
逐条对照表见 `docs/reference/05-离子方程式补全记录.md`。

### v1.3 变更：intake 覆盖度 + 确认闸门（AC-18）

**问题**：「先复述、老师点头才出」原本只是 `SKILL.md` 的**流程约定 + 话术**，引擎不管。
两处实测证据：

- `restate.versionStrategyAsked` 只表示「最终值不是 ASK」——源码里就是 `versionStrategy !== 'ASK'`，
  **记忆补上的同样为 `true`**，不能当「agent 问过老师」的证据；
- 一个只写 `{"jobVersion":1,"generation":{"totalCount":10}}` 的 job，会被记忆补成「跟上次一样」
  并 **`exit 0` 放行**（实测）；`app/main.js` 只过滤 `BLOCKING_CODES`，**没有确认关卡**，
  所以 agent 不看复述框直接跑 `run-paper` 也能出卷。

**方案**（两件，配套）：

| # | 改动 | 位置 |
|---|---|---|
| ① | 预检结果新增 **`intakeCoverage`**：逐项标注 `explicit`（当次问到）/ `memory`（沿用上次）/ `default`（系统默认），并给 `verdict` = `intake-complete` / `intake-incomplete` / `blocked`、`unasked[]`（被记忆或默认替答的**必问项**）、`needsConfirm[]` | `tools/preflight.js` |
| ② | **确认闸门**：`run-paper` 不带 `--confirmed` → 只回 `CONFIRM_REQUIRED` + `restate` + `intakeCoverage`，**零卷子产出**（`exitCode 2`，只写 result.json）；`--confirmed` 才进导出 | `app/main.js` + `tools/run-paper.js` |

`intakeCoverage` 判来源的办法：在记忆合并**之前**留一份「当次原始 job」（`rawJob`），
再逐项比对——`rawJob` 里有 → `explicit`；`memoryReport.usedFields` 里有 → `memory`；否则 `default`。
`--no-memory` 时不存在 `memory` 来源，非显式项一律 `default`。

> **行为变更（破坏性）**：出卷命令从 `run-paper.js <job>` 变为 `run-paper.js <job> --confirmed`。
> `tools/acceptance.js` 的 `runPaper()` 已统一带上（那些用例模拟的就是「老师已确认」）；
> 未确认路径由 AC-18 与 `test-edge` 的 13 项断言覆盖。
> 豁免：`--render-check`（只截图）与 `job.dryRun:true`（只组卷）不产交付物，不受闸门约束。

**验收**：新增 **AC-18**（未确认 exit 2 + 零卷子产出 + result.json 仍带 restate/覆盖度 +
已确认出卷 + dryRun 豁免 + 覆盖度来源标注）；AC-12 加 4 条断言（记忆补上的必问项必须标 `memory`、
`verdict=intake-incomplete`）；`test-edge` 93 → **106** 项。跑批：**18/18 通过**。

### 实跑复检（第二轮深度测试）修复的问题

超出 17 条 AC 的实跑测试（真实产物解析：PDF 文本/页面尺寸、docx XML、PNG 像素；边界/异常电池；
CLI/错误路径；并发；`_pending` 生命周期）共发现 **9** 个问题，全部已修
（当时的 `test:edge` 是 62 项；第三轮补到 75 项、拍板后又补到 **93** 项）：

| # | 现象 | 根因 | 修法 |
|---|---|---|---|
| 1 | `--out <path> --job <job.json>` 把 `--out` 的值当成 job 路径 | CLI 用「第一个不以 `--` 开头的参数」取 job | `tools/preflight.js` 加 `parseArgs()`：取值型开关连值一起跳过，并支持 `--job=` |
| 2 | `dryRun` 的 `result.json` 落到默认目录而非 `job.outputDir` | `finish()` 漏传第二参 `outDir`（README 坑 5 只修了拦截分支） | `app/main.js` dryRun 分支补 `, outDir` |
| 3 | `outputDir` 越界 → `UNCAUGHT`/exit 9、**不写 result.json** | `resolveOutDir()` 从 `main()` 抛出，落到顶层 catch | 读 job 后立即预检 `outputDir`，给 `OUTPUT_DIR_FORBIDDEN`(exit 2) 并把 result.json 落默认目录 |
| 4 | `versionStrategy` 缺失时复述框回显 `chemicalOnly`（把「没问」伪装成「已选定」） | `restate` 用了 `buildSettings` 的兜底值 | restate 如实回显 `"ASK"`；并按定稿行为**升级为 blocker**（`ASK_VERSION_STRATEGY`，exit 2，不进导出） |
| 5 | `--render-check` 忽略 `scopeInput` 归一（应 60 条却按 392 条渲染） | 直接 `buildSettings(原始 job)`，没先跑 preflight | 先 `preflight()` 拿归一后的 job 再 `buildSettings`，并输出 `scopes`/`authoritativeCount` |
| 6 | 重抽后 `perItemRulesApplied[].count` 是陈旧值（实测 36/40 不一致） | 重抽后重新注入了规则，但没重算 `applied` | `engine/paper.js` 改为 `applied = applyPerItemRules(...)` |
| 7 | 自定义 `outputDir` 下的 `_pending.json` 被 `skill-state pending` 完全漏掉 | 只扫 `out/*/_pending.json` 一层 | 递归扫描（≤3 层，跳过 `_` 开头的测试/开发目录） |
| 8 | **Word 通道把离子电荷渲染错**（`Fe^2+` → `Fe ^ ₂ + ²`） | `engine/docx.js` `speciesRunSpecs()` 逐字符照抄 formula，又把 `sp.charge` 追加成上标 | **本地补丁**：新增 `splitFormulaCharge()`，与 `chem.js formulaHTML()` 对齐；登记在 `data/ENGINE-PATCHES.json`，`sync:check` 认账 |
| 9 | 跑一次 `test:acceptance` 会在**真实** `out/{yyyy-mm-dd}/` 留下 2 个 docx、并覆盖真实 `result.json` | AC-15 要验证「不指定 outputDir 落默认目录」，写完不清理 | AC-15 记录跑前目录内容，断言后只删本次新建的文件、还原被覆盖的 `result.json`（**第三轮补完**：还要还原 mtime，见下表第 4 条） |

> 第 8 条是**上游继承**的 bug（主项目 `src/libs/docx.js` 同一份代码），影响 553 个版本中的 209 个（37.8%）——
> Word 双卷是默认通道，故每份含离子方程式的 Word 卷子都受影响；PDF 通道正确。
> 按项目铁律不写主项目，故在本项目副本打补丁：`tools/test-engine-patches.js` 校验（哈希 + 行为断言），
> `sync-from-source.js` 对登记过的文件比对「上游哈希 + 补丁哈希」而非裸哈希 → `sync:check` 仍 exit 0。
> 上游修好后跑 `npm run sync`，并删除 `data/ENGINE-PATCHES.json` 里那一项。

### 实跑复检（第三轮 · v1.2 形态）修复的问题

对 v1.2 形态做的第三轮实跑测试（真实产物解析 + 零外依赖实证 + 数据锁电池 + 离子化学审计 +
边界/异常 + 文档对账）共发现 4 个**代码/数据**问题，全部已修：

| # | 现象 | 根因 | 修法 | 类别 |
|---|---|---|---|---|
| 1 | **纯文本通道公式渲染错**（`result.json` 的 `itemsPreview` 与 PDF/docx 不一致）：`C17H35` → `C₁7H₃5`；`H+` → `H+`（应 `H⁺`）、`OH-` → `OH-`（应 `OH⁻`）、`e-` → `e-`（应 `e⁻`） | `engine/chem.js` `formulaUnicode()`：① 下标判定只认「前一个输出字符是字母/右括号」，连排数字的第二位被漏；② 只认 `^` 记法，而 `formulaHTML()` 还认尾随 `+`/`-`，两条通道规则不对齐 | **本地补丁**（登记 `data/ENGINE-PATCHES.json`）：下标判定追加 `\u2080-\u2089`；按 `formulaHTML()` 同款规则先摘尾随电荷再补 Unicode 上标 | B 引擎副本 |
| 2 | **`custom` 版本策略下中文版本类型不可用**：`{"versionStrategy":"custom","allowedVersionTypes":["离子"]}` → 候选 0 → 误报 `B1_ZERO_CANDIDATE` 拦截 | `tools/preflight.js` 的 `resolveScope()` 只归一 `scopeInput.versionTypes`，没管 `generation.allowedVersionTypes`（策略参数直接进了 `buildSettings()`）；而 `归一映射表.md` §六 明写「离子 → ionic」 | `preflight.js` 新增 `normalizeAllowedVersionTypes()`：同一张 `VERSION_TYPE_ALIASES` + `matchKey()` 逐项归一；认不出的值原样保留 | A 自有代码 |
| 3 | **题库文本字段的 `^` 记法泄漏到卷面**：60 题卷的第 23 题题干印出 `CO3^2-`（PDF 文本层与 docx XML 都能搜到 `^`） | 12 条 `description` + 1 条 `difficultyReason` 用 `^` 写电荷/指数；description 是**纯文本**（C 题题干原样渲染，不解析化学式记法） | 只做记法转换：`^` 后的指数/电荷转 Unicode 上标（**不动** ASCII 下标风格，避免 12 条与 400 条风格混排）→ `npm run data:lock` | C 数据 |
| 4 | 跑一次 `test:acceptance` 会改掉真实 `out/{日期}/result.json` 的 **mtime**（内容已还原） | AC-15 只写回字节，没还原时间戳 | AC-15 备份 `atimeMs/mtimeMs` 并用 `fs.utimesSync` 还原；再加 2 条断言（默认目录无残留、result.json 内容+mtime 已还原）；`main()` 跑批收尾对真实产物目录做 sha256+bytes+mtime 全量自检 | A 自有代码 |

> 顺带修掉的文档/口径不一致 7 处：`SKILL.md` 的「选必3 离子版本 = 0 条」（v1.2 补全后整册 17 条、
> 第二章烃才是 0）、「借用的 Electron 运行时（主项目那份）」（现为自带）、`test-edge` 项数 56→93、
> §8 工具表缺 `install-runtime.js`、§8 引用规格写成「v1.1 全文」；`05-离子方程式补全记录.md` 的
> 历史值 `edge 59`（实为当时的 62，现为 75）；`data/ENGINE-PATCHES.json` 的 `531 个版本中 185 个`（现为 553 / 209）。


### 已知限制与未做项（对照规格 §3.6）

- H 开放题（题库 `openPrompt` 全空）、mustInclude / starred 机制（题库无数据）
- 学习项目挂靠（`projectScope` / `projectCounts` / `round`）
- 批量 / AB 卷与跨卷避重；覆盖约束（每节 ≥1 题）
- 读上游 `settings.json` 的卷面默认与 `data/templates/`
- 图片 multi 模式（单张模式已实现）；难度未满足自动重试；强制裁页 / 补空白页
- `_pending` 自动重试（只做 intake 轮手动提示）；联网 / 云
- **任何对上游项目的写入**（设计上不可能）
- 并发同名出卷会互相覆盖（`resolveOutputPath` 用 `fs.existsSync` 判避让，存在 TOCTOU；
  同一时刻跑两份同名 job 时后写者覆盖前者）。规格只要求「文件被占用 → 后缀避让」，未涉及并发，暂不做
- `layoutOverrides` 按设计只允许 `title` / `subtitle` / `note` / `studentInfo`（卷面固定）
- **`docs/reference/01-数据字典.md` 是上游投喂包原文**：第 1 节的「数据文件总览」列的是**上游桌面版**的
  `settings.json` / `projects.json` / `trash.json` 等，本项目 `data/` 下并没有这些文件（只有
  `library.json` / `classifications.json` / `SOURCE.json` / `ENGINE-PATCHES.json`）。字段口径仍准，文件清单不可照搬
- **`engine/chem.js` `parseEquationLine()` 不接受「系数 + 方括号/圆括号」紧贴写法**（上游缺陷，未打补丁）：
  `2[Ag(NH3)2]+`、`2(C6H10O5)n` 报「数字位置不合法」。**不在本项目出卷路径上**（题库系数是独立字段），
  只影响上游桌面版编辑器的一行式文本输入。**已记下，暂不动**（要改就走 `data/ENGINE-PATCHES.json` 登记 + 行为断言）
- **两个本地补丁（`engine/docx.js`、`engine/chem.js`）的上游回流**：两个 bug 在上游 `src/libs/` 里同样存在。
  **已记下，暂不动**（铁律：绝不写上游）。上游修好后跑 `npm run sync`，并删除 `data/ENGINE-PATCHES.json` 里对应项
- **题库有 3 组疑似重复条目**（`R0193`/`R0316`、`R0195`/`R0317`、`R0188`/`R0319`）：
  已拍板**全部保留两条**（分属不同教材位置 / `R0319` 名称已显式标注「（结构简式）」），只把 `R0193` 的
  乙醇写法统一为 `CH₃CH₂OH`。同卷仍可能同时抽到 A、B 两组的两条（不同 entryId），属已知的内容层重复
- **`R0372` 与 `R0355` 的「新制氢氧化铜」写法口径**：已拍板**统一为含 NaOH 的写法**
  （`R0372` 化学式版补 NaOH、产物改葡萄糖酸钠，并补出离子式），与 `R0355`/`R0354`/`R0371` 口径一致

### 实现中踩到并已修复的坑（供日后维护参考）

| # | 现象 | 根因 | 修法 |
|---|---|---|---|
| 1 | `executeJavaScript` 报「Script failed to execute」 | 默认 sandbox 下脚本跑在**隔离世界**，看不到页面主世界的 `window.__harness` | `webPreferences.sandbox: false`（仍 `contextIsolation: true`，无 IPC、无 node 集成） |
| 2 | 第二卷 / 图片构建失败 | `loadFile(卷面 html)` 会**替换整个页面**，`window.__harness` 随之消失 | 每轮渲染前重新 `loadFile(harness.html)` 并等 `ping().ok` |
| 3 | 图片尺寸量不到 | 同上（页面已是图片文档） | 主进程**内联**测量脚本 `document.body.getBoundingClientRect()`，不调 `harness.measure()` |
| 4 | 题量不足仍出卷 | `app/main.js` 跑了预检但没用拦截结果 | 预检 blocker（B1/B3/B6/B7/B11）→ 直接 `exitCode 2`，不进导出 |
| 5 | 拦截分支的 `result.json` 落到默认目录 | 拦截分支调 `finish()` 时没传输出目录 | 统一走 `resolveOutDir(job)`（默认目录 + 显式 `outputDir` 都正确） |
| 6 | 空 `scopes: {}` 被记忆覆盖 | 默认值本身就是空值，无法与「没填」区分 | job 加 `useMemory: false` 显式主张默认值（CLI：`--no-memory`） |
| 7 | 本机 Node 的 `fs.rmSync` 静默不删目录 | 环境拦截目录删除（`unlinkSync` 正常） | 验收台改用「逐层删文件」的 `rmrf` |

## 规格与决策来源

需求由外部 AI 六域澄清后冻结为《需求规格 v1.1》，全文（含十二决策块、机器可读 YAML、17 条验收用例、明确不做）
见 `PROMPT-方程式出题skill.md`；v1.0 → v1.1 的变更记录见该文件 §3.2。
原始投喂包与澄清方案在旧桌面版的 `docs\需求厘清\` 与 `PROMPT-方程式出题skill-需求厘清方案.md`。

## 开发

```powershell
npm test                    # 五套快测
npm run test:acceptance     # 18 条验收用例（需 Electron 运行时）
npm run data:lock           # 改完题库后重新锁定数据
```

代码零 `dependencies`（只用 Node 内置模块 + `tools/yml.js` 极小 YAML 解析）。
唯一的大件是 Electron 运行时，按需装入 `runtime/`（已 gitignore）。

## 配套项目

| 项目 | 关系 |
|---|---|
| [xkw-toolkit](https://github.com/xmmmymm/xkw-toolkit) | 互补的**另一条出题链路**：走学科网/组卷网实时抓取（依赖网校通会员，CDP 复用登录态）。本工具走**内置教材题库**（392 条，完全离线、已机器校验配平与守恒）。可串联：xkw-toolkit 攒题 → 转 JSON → 交给本工具排版打印。 |
| [chem-reaction-3d](https://github.com/xmmmymm/chem-reaction-3d) | 把 289 个方程做成断键成键的 3D 微观演示，适合讲评时回放反应机理——本工具出**考题**，它讲**原理**。 |
| [electrolyte-ionization](https://github.com/xmmmymm/electrolyte-ionization) | 题库中「电离方程式」那一类（共 21 条）的原理讲解：离子从晶格到溶液的 3D 过程。 |

全部项目见索引：**[chem-edu-index](https://github.com/xmmmymm/chem-edu-index)**

## 许可

[MIT](LICENSE) © xmmmymm。题库数据与引擎代码的来源见 README 顶部「与上游项目的关系」。
