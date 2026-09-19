# chem-equation-paper（方程式出题 skill）

基于化学方程式题库快照**组卷并导出 Word / PDF / 图片**的独立项目。
给 AI agent 用：agent 澄清需求 → 预检可出题量 → 组卷 → 无头导出 → 汇报产物路径。

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

## 目录

```
.dsh/skills/chem-equation-paper/   skill 本体（SKILL.md / layout.yml / presets.yml / references/）★入库
.dsh/skill-state/                  运行时状态（last-run.json / archive/）——已 gitignore
app/                               无头 Electron 入口（main.js + harness.html）
engine/                            引擎副本（chem/constants/generator/exporter/docx/importer + 回归测试）
data/                              题库快照（library.json / classifications.json / SOURCE.json）
docs/reference/                    数据字典、题库统计、可出题量预检（从主项目投喂包复制）
tools/                             sync-from-source.js（同步+漂移检查）、run-paper.js（启动器）
out/                               出卷产物——已 gitignore
PROMPT-方程式出题skill.md          实施提示词（交给新会话执行）
```

## 常用命令

```powershell
npm run test:engine     # 引擎副本回归：应为「通过 238 项，失败 0 项」
npm run sync            # 从主项目同步数据快照 + 引擎副本，重写 data/SOURCE.json
npm run sync:check      # 只比对不写入；有漂移 exit 1（可放进验收）
npm run paper -- <job.json>   # 出卷（需 app/main.js 已实现）
```

## 当前状态

- ✅ 仓库已重建（旧 `.git` 备份于 `E:\DSH work\方程式\backups\skill-dir-git-before-reinit-20260919-123559`）
- ✅ 数据快照 + 引擎副本已就位，哈希与主项目一致；回归测试 238/0
- ✅ 同步工具与启动器已就位
- ⬜ **skill 本体与无头入口待实现** → 见 `PROMPT-方程式出题skill.md`（按阶段 0→7 执行）

## 规格与决策来源

需求由外部 AI 六域澄清后冻结为《需求规格 v1.1》，全文（含十二决策块、YAML、验收用例、明确不做）
见 `PROMPT-方程式出题skill.md`；v1.0 → v1.1 的变更记录见该文件 §3.2。
原始投喂包与澄清方案在主项目 `docs\需求厘清\` 与 `PROMPT-方程式出题skill-需求厘清方案.md`。
