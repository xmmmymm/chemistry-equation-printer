# chem-equation-paper（方程式出题 skill）

基于化学方程式题库快照**组卷并导出 Word / PDF / 图片**的独立项目。
给 AI agent 用：agent 澄清需求 → 预检可出题量 → 复述确认 → 无头组卷导出 → 汇报产物路径。

## 与主项目的关系：**只读**

| | 主项目 | 本项目 |
|---|---|---|
| 路径 | `E:\DSH work\方程式` | `E:\DSH work\方程式出题skill` |
| 关系 | 数据源 + 引擎来源 | 消费方（**绝不写回主项目任何文件**） |
| 数据 | `data/library.json`（392 条 / 531 版本） | `data/` 下**快照副本**，由 `tools/sync-from-source.js` 复制 |
| 引擎 | `src/libs/*.js` | `engine/` 下**副本**，同上 |
| Electron | `node_modules/electron/dist/electron.exe`（180MB） | **借用**（不复制、不安装；路径记录在 `data/SOURCE.json`） |
| 产物 | — | 本项目 `out/{yyyy-mm-dd}/` |

主项目的题库、设置、历史作业、导出目录**不会被本 skill 读写**。
出卷前后对主项目做全量 sha256 快照 → **零差异**（AC-17，含 mtime）。

## 目录

```
.dsh/skills/chem-equation-paper/   skill 本体 ★入库
    SKILL.md                       触发语义 + 两段式流程 + 三清单 + 调用方式
    layout.yml                     固定卷面模板（A4 纵 / 2cm / 1 栏 / 宋体+TNR 16/12/10.5 …）
    presets.yml                    场景预设包（homework / timedDrill / examPrep）
    references/                    决策清单 / 归一映射表 / 文案模板
.dsh/skill-state/                  运行时状态（last-run.json / archive/）——已 gitignore
app/                               无头 Electron 入口
    main.js                        主进程：预检 → 组卷 → 渲染 → 导出 → result.json
    harness.html                   薄渲染壳（普通 <script> 加载 engine/*，无 IPC）
    lib/render-check.js            开发期：只渲染卷面截图
engine/                            引擎副本 + 本项目新增
    chem/constants/generator/exporter/docx/importer.js   主项目副本（哈希一致）
    paper.js                       ★新增：组卷编排（perItemRules / 附加验收 / 失败翻译）
    image.js                       ★新增：图片通道文档构建
    test-chem.js + fixtures/       回归测试（238 项）
data/                              题库快照（library.json / classifications.json / SOURCE.json）
docs/reference/                    数据字典、题库统计、可出题量预检（主项目投喂包复制）
tools/
    preflight.js                   ★预检与归一（B1/B4/B6/B8/B11 + 6 基准自检）
    skill-state.js                 ★记忆 / 漂移 / _pending 生命周期（B10/B12）
    acceptance.js                  ★17 条验收用例测试台
    sync-from-source.js            同步 + 漂移检查
    run-paper.js                   出卷启动器（借 Electron 运行时）
    yml.js                         极小 YAML 子集解析（无依赖）
examples/                          可直接跑的 job.json 示例
out/                               出卷产物——已 gitignore
PROMPT-方程式出题skill.md          实施提示词（需求规格 v1.1 全文）
```

## 常用命令

```powershell
# 回归
npm run test:engine        # 引擎副本回归：应为「通过 238 项，失败 0 项」
npm run test:preflight     # 预检 6 个基准场景对照 docs/reference/04-可出题量预检.md
npm run test:state         # 状态管理自检（记忆 / 漂移 / pending / 冲突链）
npm run test:acceptance    # 跑 §3.4 全部 17 条验收用例（含主项目零写入校验）

# 快照
npm run sync               # 从主项目同步数据快照 + 引擎副本，重写 data/SOURCE.json
npm run sync:check         # 只比对不写入；有漂移 exit 1

# 出卷（三步）
node tools/skill-state.js state              # ① intake 第一步：drift + memory + pending
node tools/preflight.js --job my-job.json    # ② 预检：归一 + 可出题数（条目数）+ 诊断
node tools/run-paper.js my-job.json          # ③ 出卷：打印 result.json + 落 out/{日期}/

# 开发期
node tools/run-paper.js my-job.json --render-check   # 只渲染卷面截图，不产出卷子
node tools/preflight.js --self-test
```

## 当前状态

- ✅ 阶段 0 基线自检：`test:engine` 238/0、`sync:check` 全部一致
- ✅ 阶段 1 skill 本体：`SKILL.md` / `layout.yml` / `presets.yml` / `references/`（决策清单、归一映射表、文案模板）
- ✅ 阶段 2 预检与归一：`tools/preflight.js`，6 个基准场景与预检表 **6/6 一致**
- ✅ 阶段 3 组卷：`engine/paper.js`（`G.generate` + perItemRules + AC-14 附加验收，重抽 ≤1 次）
- ✅ 阶段 4 无头导出：`app/main.js` + `app/harness.html`，PDF 双卷 / Word 双卷 / 图片（点名才产）
- ✅ 阶段 5 交互层：两段式流程 + 复述框 + 三清单 + 全套话术
- ✅ 阶段 6 记忆与 `_pending`：`tools/skill-state.js`（冲突链 当次 > 记忆 > 默认；>30 天归档）
- ✅ 阶段 7 验收：**§3.4 全部 17 条通过（17/17）**，证据在 `out/_acceptance/`
- ✅ 主项目零写入：出卷前后全量 sha256 + mtime **零差异**

### 已知限制与未做项（对照规格 §3.6）

- H 开放题（题库 `openPrompt` 全空）、mustInclude / starred 机制（题库无数据）
- 学习项目挂靠（`projectScope` / `projectCounts` / `round`）
- 批量 / AB 卷与跨卷避重；覆盖约束（每节 ≥1 题）
- 读主项目 `settings.json` 的卷面默认与 `data/templates/`
- 图片 multi 模式（单张模式已实现）；难度未满足自动重试；强制裁页 / 补空白页
- `_pending` 自动重试（只做 intake 轮手动提示）；联网 / 云
- **任何对主项目的写入**（设计上不可能）

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
原始投喂包与澄清方案在主项目 `docs\需求厘清\` 与 `PROMPT-方程式出题skill-需求厘清方案.md`。
