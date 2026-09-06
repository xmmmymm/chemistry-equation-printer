# 化学方程式教材提取规范（v1）

供子代理使用。目标：从人教版教材 Markdown 中提取所有化学方程式，输出为统一 JSON，
由父代理用项目引擎（chem.js）做机器校验、跨册合并后导入应用。

## 一、输出文件

写到 `E:\DSH work\方程式\extraction\<book>.json`，结构：

```json
{
  "book": "必修第一册",
  "version": "人教版",
  "entries": [ ... ],
  "excluded": [ { "raw": "...", "location": "...", "reason": "..." } ]
}
```

## 二、entry 结构（字段全部必填，无内容则空数组/空串）

```json
{
  "name": "钠与水的反应",
  "description": "金属钠与水反应生成氢氧化钠和氢气",
  "difficulty": "中等",
  "difficultyReason": "物质3种，系数为2，有气体符号",
  "textbooks": [ { "chapter": "第二章", "section": "第一节", "context": "实验2-2" } ],
  "substanceCategories": ["单质", "碱", "氢化物"],
  "reactionTypes": ["氧化还原反应", "离子反应"],
  "knowledgeModules": ["金属及其化合物"],
  "tags": [],
  "versions": [
    { "type": "chemical", "line": "2Na + 2H2O = 2NaOH + H2↑", "conditions": [], "reversible": false },
    { "type": "ionic", "line": "2Na + 2H2O = 2Na+ + 2OH- + H2↑", "conditions": [], "reversible": false }
  ],
  "source": "人教版·必修第一册"
}
```

- `textbooks`：同一反应在教材多处出现时**合并到一个 entry**，每个出现位置一条（chapter 填"第X章"或"第X单元"原文格式，section 填节名或栏目名，context 填栏目如"正文/实验2-2/练习与应用/思考与讨论/资料卡片"）。
- `versions.type`：`chemical`（化学方程式）/ `ionic`（离子方程式）/ `ionization`（电离方程式）/ `hydrolysis`（水解方程式）/ `electrode`（电极反应式，含 e-）/ `thermochemical`（热化学方程式，物质带 (g)/(l) 状态且有焓变）。
- `versions.line`：**一行式**，书写规范见第三节。条件不写进 line（写 conditions 数组）。
- `versions.conditions`：条件词数组，只用这些词：`点燃 / 加热 / 高温 / 催化剂 / 通电 / 光照 / 常温 / 浓硫酸 / 高压`，教材原文的其他条件（如"MnO2 作催化剂"→`催化剂`；"Δ/△"→`加热`）照此映射。无条件则 `[]`。
- `versions.reversible`：可逆反应 true（⇌）。
- 热化学版本额外字段 `"deltaH": "-571.6 kJ/mol"`（教材原值，注意与系数匹配；若教材给的是每 mol 数值而 line 系数不同，按 line 系数换算）。
- 电极版本额外字段 `"electrode": "负极"` 和可选 `"medium": "碱性介质"`。
- `source` 固定为 `人教版·<book>`。

## 三、一行式书写规范（严格照此，父代理机器校验）

- 系数 + 化学式：`2Na + 2H2O = 2NaOH + H2↑`；元素下标直接连写数字（H2O、CO2、Ca(OH)2、Fe3O4、KClO3）。
- 离子电荷：单价离子直接 `Na+`、`OH-`、`H+`、`Cl-`；多价用 `^`：`Ca^2+`、`SO4^2-`、`Fe^3+`；电子 `e-`。
- 气体 `↑`、沉淀 `↓` 只标在生成物：`H2↑`、`CaCO3↓`。
- 可逆用 `⇌`：`N2 + 3H2 ⇌ 2NH3`。
- 状态标注只用于热化学：`2H2(g) + O2(g) = 2H2O(l)`，仅允许 (g)(l)(s)(aq)。
- 浓/稀等浓度修饰**不写入**化学式（`4HCl(浓)` 写成 `4HCl`，把"浓盐酸"体现在 name/description，如"二氧化锰与浓盐酸共热反应"）。
- LaTeX 转换对照：`\mathrm{H}_2\mathrm{O}`→`H2O`；`\mathrm{Ca}^{2+}`→`Ca^2+`；`\stackrel{\text{点燃}}{=}`→等号+conditions:["点燃"]；`\xrightarrow{\text{高温}}`→等号+conditions:["高温"]；`\rightleftharpoons`→⇌+reversible:true；`\uparrow`→↑；`\triangle`→conditions:["加热"]。
- **必须配平**（教材原文未配平的文字式要自己配平；无法配平的进 excluded）。

## 四、分类取值范围（只能用这些值；不确定就不填该维度）

- substanceCategories：单质 / 氧化物 / 酸 / 碱 / 盐 / 氢化物 / 过氧化物 / 有机物 / 胶体 / 混合物 / 其他
- reactionTypes：化合反应 / 分解反应 / 置换反应 / 复分解反应 / 氧化还原反应 / 离子反应 / 可逆反应 / 燃烧反应 / 中和反应 / 水解反应 / 电离 / 电极反应 / 热化学反应 / 其他
- knowledgeModules：物质及其变化 / 金属及其化合物 / 非金属及其化合物 / 化学反应与能量 / 电化学 / 化学平衡 / 水溶液中的离子平衡 / 有机化学 / 化学实验 / 化学与生活 / 其他
- tags：高频 / 易错 / 月考重点 / 期中考前 / 基础必会 / 补充题（教材数据不确定就不打，父代理会按出现册数补"高频"）
- 各维度可多选（按反应实际涉及的物质与类型判断）。

## 五、难度标准（三选一）

- 简单：物质 2–3 种；系数多为 1、2；无条件或单一简单条件；强酸强碱中和、简单沉淀、一步完全电离。
- 中等：物质 3–4 种；系数出现 3、4；有气体/沉淀符号；涉及弱电解质、拆分判断、可逆号。
- 较难：物质 ≥4 种；系数大或配平复杂；多条件；明显氧化还原复杂配平；可逆、分步电离、双水解、新型电池电极、盖斯定律。

## 六、处理规则

1. **范围**：正文、实验、思考与讨论、资料卡片、科学史话、练习与应用（习题）中的方程式全部提取。
2. **文字反应式**（如"碳+氧气→二氧化碳"）：查上下文确定化学式后转为配平的一行式；无法确定的进 excluded（写明原因）。
3. **有机方程式**（甲烷、乙烯、乙醇、乙酸、酯化等）：正常提取，substanceCategories 含"有机物"。
4. **聚合记法**（淀粉/纤维素/蛋白质，如 (C6H10O5)n、nC6H12O6）：无法解析，进 excluded。
5. **同一反应多版本**：教材给出化学式和离子式两种写法（或正文给化学式、习题考离子式）→ 同一 entry 下多个 version。
6. **同一反应多次出现**（同册内）：合并为一个 entry，textbooks 记多处位置。
7. **同一反应名称不同**（如"实验室制氧气"与"加热高锰酸钾"）：以反应本身（反应物+生成物）判重，合并，name 取更通用者，另一个写进 description。
8. **仅出现在图像/图题描述中的反应**（图无法看到）：按图题文字判断能否提取，不能则 excluded。
9. **半反应/示意式**（如 Fe^3+ --还原剂--> Fe^2+ 这种标氧化还原方向的）：不是完整方程式，excluded。
10. 教材中重复印刷的同一方程式（如章节复习再出现）只算一次，但 context 可补充。

## 七、搜索策略（建议）

教材是 Markdown + LaTeX。先用 grep 定位方程式密集行，再读上下文确定分类：
- 模式：`xrightarrow`、`stackrel`、`rightleftharpoons`、`triangle`、`uparrow`、`downarrow`、`= \mathrm`、`+ \mathrm`、文字式模式 `氧气 \$\\xrightarrow`
- 电离/离子式：`= \mathrm{H}+`、`+ \mathrm{OH}`、`^ {2 +}`、`^ {3+}`
- 热化学：`\Delta H`、`kJ/mol`、`(g)`、`(l)`
- 电极：`e^`、`e ^`、`失电子`、`得电子`、`负极`、`正极`、`阳极`、`阴极`
- 文字式：`\xrightarrow{\text{点燃}}` 前后接中文词

读完整个提取过程后统计：entries 数、excluded 数，写入 JSON。

## 八、质量要求

- 一行式必须能被机器解析：无空格异常、无全角符号、无 LaTeX 残留。
- 宁可少而准：不确定的反应放 excluded，父代理会复核。
- name 用"反应"描述（"X与Y反应""X的分解""X的燃烧""实验室制X"），与教材栏目语境一致。
- description 用一句完整文字描述（供 C 类题使用），忠实于教材语境。
