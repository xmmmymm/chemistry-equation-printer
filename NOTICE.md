# 致谢与来源说明（NOTICE）

本项目为 MIT 许可，版权归 © 2026 xmmmymm 所有。

## 引擎代码来源

`engine/` 目录下的 `chem.js`、`constants.js`、`generator.js`、`exporter.js`、`docx.js`、
`importer.js`、`test-chem.js` 及 `engine/fixtures/sample-library.json` 是**上游项目引擎的副本**，
来源：

> **chemistry-equation-printer —— 旧桌面版组卷打印应用（已废弃）**
> 本仓库归档分支 `archive/desktop-app-v1`
> <https://github.com/xmmmymm/chemistry-equation-printer/tree/archive/desktop-app-v1>
>
> 引擎位于该分支的 `src/libs/*.js`（另有 `scripts/test-chem.js`、`examples/sample-library.json`）。

原作者与著作权人同为 xmmmymm，按同一 **MIT** 许可授权，因此本项目以相同 MIT 许可发布。

其中 `engine/docx.js` 与 `engine/chem.js` 带**本项目本地补丁**（修复 Word / 纯文本通道的离子电荷与下标渲染），
补丁登记在 [`data/ENGINE-PATCHES.json`](data/ENGINE-PATCHES.json)，并由
`tools/test-engine-patches.js` 持续校验。

本项目**新增**（不在上游副本清单内）的文件包括 `engine/paper.js`、`engine/image.js`、
`app/`、`tools/`、`.dsh/skills/chem-equation-paper/`。

## 题库数据

`data/library.json` 与 `data/classifications.json` 为**本项目自有数据**（source of truth），
其历史 fork 点来自旧桌面版的 `data/` 目录，之后由本项目自持、不再随上游同步
（见 `data/SOURCE.json` 的 `origin` 块，仅供溯源）。

`node tools/sync-from-source.js` **只**同步 `engine/` 引擎副本，**绝不**写入 `data/`。
