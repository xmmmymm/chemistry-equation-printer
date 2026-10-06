# ⚠️ 归档分支：旧桌面版组卷打印应用（已废弃）

这是 **chemistry-equation-printer 的旧桌面版**完整代码，**已停止维护、不再更新**。

| | 本分支（旧桌面版） | `main` 分支（现行） |
|---|---|---|
| 形态 | Electron 桌面 GUI（`main.js`，手动点按） | **给 AI agent 的出题 skill**（`chem-equation-paper`） |
| 状态 | **已废弃 / 只读归档** | 现行维护中 |
| 产物 | PDF / HTML | PDF / **Word** / **图片** |
| 出题流程 | 人工在界面里设置 | agent 澄清 → 预检 → **引擎级确认闸门** → 无头导出 |

> 引擎来源说明：本 skill 的 `engine/` 是从**本分支的 `src/libs/*.js` 复制**而来，
> 并带两个本地补丁（见 `main` 分支的 `NOTICE.md` 与 `data/ENGINE-PATCHES.json`）。
>
> 要拉取引擎副本：
> `git clone -b archive/desktop-app-v1 https://github.com/xmmmymm/chemistry-equation-printer.git`
> 然后 `npm run sync -- --source=<该克隆路径>`。

**请改用 [`main`](https://github.com/xmmmymm/chemistry-equation-printer/tree/main) 分支。**
