[English](README.md) | **简体中文**

# dsh-academic-review

[![CI](https://github.com/xuelinzheng41-maker/dsh-academic-review/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/xuelinzheng41-maker/dsh-academic-review/actions/workflows/ci.yml)

> **范围：** 本移植提供 **四个** ARS 技能 —— `academic-paper-reviewer`、`deep-research`、
> `academic-paper` 与 `sr-screener`；只有评审人（reviewer）配有工具、评审状态和 GUI 面板。
> 其余三个都是纯提示词（prompt-only）：`deep-research` 是研究流水线，`academic-paper` 是
> 写作流水线，`sr-screener` 是筛查流水线 —— 而它的可用性取决于能否在你自己的宿主上运行它
> 自带的 Python 脚本（`Python 3.9+`；本插件随包提供这些脚本，但从不运行它们）。
> `academic-pipeline` **不**在本次发布范围内。评审输入仅支持 `.md` / `.tex` / `.txt`：
> 不做 PDF 解析，也没有 OCR。插件自身的工具与命令永远不会改写你的稿件（见
> [写入策略 A](#写入策略-a--只写新路径)）；四个随包技能全部把同一条规则作为**指令**前置到
> 正文之前 —— 每个技能都是同样的 684 字节，无论它是否会写文件。那是指令，不是强制。

这是 Academic Research Skills（ARS，学术研究技能）中 `academic-paper-reviewer`、
`deep-research`、`academic-paper` 与 `sr-screener` 四个技能面向 DeepSeek Harness 的
**非官方 DSH 移植（unofficial DSH port）**。本项目与上游作者及上游项目无任何关联，
未获其资助，也未获其背书。

本插件通过一个 DSH 技能提供者（skill provider）同时提供四棵随包内置（vendored）的上游技能树。
只有评审人接入了插件代码：5 席同行评审面板所需的评审状态工具（不可变的逐席报告存储、
稿件 SHA-256 钉定，以及上游协议要求的两处人工检查点），外加只读面板和两个斜杠命令。
`deep-research`、`academic-paper` 与 `sr-screener` 则 **原样提供，没有工具、没有状态、
也没有 GUI**：`deep-research` 运行在宿主自身的 `web_search` / `web_fetch` 与文件工具之上，
因此其产出质量受这些宿主工具实际能触及的范围限制；`academic-paper` 用同样的宿主文件工具来
起草，`sr-screener` 则通过宿主的 shell 运行它自带的 Python 来写文件 —— 因此
[写入策略 A](#写入策略-a--只写新路径) 以文本形式前置到这两者的被提供正文之前，作为模型被告知
要遵守的规则。

## 归属与许可

- 上游作品：Academic Research Skills（学术研究技能），技能 `academic-paper-reviewer`
  v1.11.1、`deep-research` v2.12.1 与 `academic-paper` v3.3.1（三者 SKILL.md
  last_updated 均为 2026-08-15），以及 `sr-screener` v1.0.0（SKILL.md
  last_updated 2026-09-29），作者 **Cheng-I Wu**
  （ORCID https://orcid.org/0009-0008-9523-0103），
  https://github.com/Imbad0202/academic-research-skills，按 commit
  `1ec249df98728682dfbbdfb940a658338bfd6f80` 随包内置（vendored）。
- 上游许可：**CC BY-NC 4.0**（Attribution-NonCommercial 4.0 International，署名—**非商业**性使用 4.0 国际）。
  本移植以同一许可分发，不得以 MIT、Apache-2.0 或任何其他条款重新许可。
- 完整的归属声明、随包文件清单与修改清单见 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。
- 覆盖本仓库全部内容的完整许可文本见 [`LICENSE`](LICENSE)。

## 本插件提供什么

### 提供的技能（四个）

四棵技能树都按钉定的 ARS commit `1ec249df98728682dfbbdfb940a658338bfd6f80` 原样 vendored 到
`vendor/` 下，并保留各自的上游名称。版本列取自每棵 vendored `SKILL.md` frontmatter 中的
`metadata.version`，在加载时读取 —— 不是插件里写死的数字。

**每一行都带写入策略块，这是有意的。** 684 字节的策略 A 段落被前置到四个被提供正文的每一个
之前 —— 同一段 684 字节出现四次，不是某些行才有的特性、也不是某些行没有 —— 因为我们无法证明
一个技能永远不会写文件。缺块是代价高昂的错误；多一块则只是让读者多读 684 字节、即两个标记之间
九行非空规则文本，而不改变任何行为。各行不同的是其余部分：本插件新增了什么，以及该技能需要宿主
提供什么。

| 技能 | 上游版本 | 本插件新增 | 资源基目录 |
| --- | --- | --- | --- |
| `academic-paper-reviewer` | **1.11.1**（SKILL.md `last_updated` 2026-08-15） | 五个 `academic_review_*` 工具、评审状态目录、只读 GUI 面板，以及 `/ars-review` 与 `/ars-review-status`。 | `vendor/academic-paper-reviewer` |
| `deep-research` | **2.12.1**（SKILL.md `last_updated` 2026-08-15） | 没有工具、没有状态、没有 GUI、没有斜杠命令；上游正文原样加载，靠会话自己的网页与文件工具查证材料。 | `vendor/deep-research` |
| `academic-paper` | **3.3.1**（SKILL.md `last_updated` 2026-08-15） | 没有工具、没有状态、没有 GUI、没有斜杠命令。靠会话自己的文件工具起草；`writePolicyBasis: 'prose-drafting'` 记录的是把它实测为文件产出者的那件仪器。 | `vendor/academic-paper` |
| `sr-screener` | **1.0.0**（SKILL.md `last_updated` 2026-09-29） | **它需要宿主上有 `Python 3.9+`**：筛查靠在宿主上运行它自带的六个脚本完成，而这些脚本本插件只随包提供并钉定，从不运行、从不审计、也不保证存在。没有工具、没有状态、没有 GUI、没有斜杠命令；`writePolicyBasis: 'bundled-script'` 记录把它实测出来的那件仪器。 | `vendor/sr-screener` |

随包文件共 **279 个**：技能文件 169 个（28 + 53 + 63 + 25），加上 110 个 shared
（108 个由路径扫描得到，2 个按 registry receipt 随包，因为没有任何随包 Markdown 提到它们）。
每一条都由 `vendor-manifest.json` 里的 SHA-256 钉定，并由 `pnpm verify:vendor` 校验。

`deep-research` 是上游的 13 个 agent 的研究流水线，需要网页搜索、页面抓取和文件工具。
本插件不提供其中任何一个，也不做任何拦截：你的 DSH 宿主已经交给会话的
`web_search` / `web_fetch` / 文件工具，就是它查证材料的唯一手段。**因此它的产出质量受这些
宿主工具的限制** —— 没有网络访问时，这个技能仍能推理，但无法核实来源。

`academic-paper` 是上游的 12 个 agent 的写作流水线（11 种模式，也是随包内置的树中最大的
一棵：**63 个文件** —— 12 个 `agents/`、29 个 `references/`、11 个 `templates/`、10 个
`examples/`，加上它的 `SKILL.md`，仓库字节数 65,335）。它是第一个指示模型写文件的随包技能
—— 其正文里有 85 个写作动词、46 个起草动词 —— 因此 `src/write-policy.ts` 的记录把它列为
按**散文起草**实测到的文件产出者。记录说明的是我们凭什么知道，它不决定谁拿到写入策略块。

`sr-screener` 是上游的协议驱动筛查流水线，用于系统综述、范围综述与快速综述（8 种模式，
**25 个文件**：`scripts/` 下 6 个 Python 脚本，`templates/` 下 2 个 `.js` 工作流模板与
1 个 `.json` 模板，`examples/` 下 1 个示例 `.json`，加上它的 `SKILL.md`，仓库字节数
33,843）。它是第二个**被实测到的**产出者，但用的是**另一种机制**：它的正文让模型用自己的脚本
并带输出参数去运行，因此记录按**随包脚本执行**列出它，而不是靠起草词汇。它完全没有散文信号，
而且这是可测的：`sr-screener` 有 24 个写作动词、3 个起草动词，都低于 40 与 20 这两条阈值，
所以起草这件仪器对它永远不会触发。

**两个技能是*被实测到的*文件产出者，但用的是两种不同机制。** `academic-paper` 起草文档；
`sr-screener` 靠运行自己的脚本来写。那是记录，不是闸门：四个被提供的正文都携带同一段 684
字节的块，`writePolicy: 'new-paths-only'` 与 `writePolicyEnforced: false` 出现在四个技能的
metadata 里，而 `writePolicyBasis` —— 实测出这个技能的那件仪器 —— 只在这两个上出现。

`.tex` 与十个新载荷文件是同一件事的两次证明。`academic-paper` 的树里有
`templates/latex_article_template.tex`（4,844 B）—— 它在本移植 vendoring `sr-screener`
之前的那三棵树里是唯一的非 Markdown 文件，也是本移植第一次随包提供的非 Markdown 载荷；
`sr-screener` 的树现在自带十个（6 个 `.py`、2 个 `.js`、2 个 `.json`），整个包一共带
**89 个**非 Markdown 文件（`.json` 79、`.py` 6、`.js` 2、`.tex` 1、`.yaml` 1），
每一个都从 git 对象库钉定，而不是取自工作区。`.tex` 证明了 vendoring 流程与扩展名无关，
这十个又证明了一次。

它们**没有**得到什么，和它们得到什么一样重要：没有工具、没有评审状态、没有 GUI 面板、
没有斜杠命令 —— 它们那些模式是自己提示词里的模式，不是本插件的模式。它们**依赖**的是宿主：
`academic-paper` 用会话自己的文件工具起草、用宿主的 web 工具（如果有）查证；`sr-screener`
则通过宿主的 shell 运行自带的 Python 来筛查，所以**宿主上没有 Python 3.9+ 时，这个技能的那部分
完全不工作** —— 而且是显式失败（命令报错），不会安静地返回一个看起来像筛查结果的东西。

### 本移植未随附的内容 —— 移植提示块

被提供的技能就是上游文本，而上游文本有时会让 agent 去打开一个位于*另一个* ARS 技能里的文件。
本移植无法随附这些文件，于是明确说出来。当某个技能的**自身**说明指向一个本包并未包含的文件时，
提供者会在被提供的正文末尾追加一段带标记的块 —— 这只是运行时文本，vendored 文件本身永远不会被修改 ——
并把完整清单放进 `metadata.unavailableReferences` / `metadata.unavailableReferenceCount`。
提示块里会告知模型：不要臆造缺失内容。

目前共有 **两** 个自身树内的例子（出现在四个技能中的两个里），而且指向同一个文件：
`deep-research/agents/bibliography_agent.md` 与
`academic-paper/agents/literature_strategist_agent.md` 都指向
`academic-pipeline/references/literature_corpus_consumers.md`，而这是本移植未随附的上游技能。
评审人自身树是干净的，`sr-screener` 的也是，所以这两者永远不会收到提示块 ——
“带前置块”和“带提示块”是两件互相独立的事。下面就是你会看到追加在 `deep-research`
正文之后的块（`academic-paper` 那份只有 `named by` 路径不同），逐字如下：

```text
<!-- dsh-academic-review:port-notice:begin (not upstream text) -->
**Port notice - not upstream text.** This DSH port does not ship 1 file that this skill's own instructions tell you to read:

- `academic-pipeline/references/literature_corpus_consumers.md` - named by `agents/bibliography_agent.md`

Do not fabricate or paraphrase the content of these files. If a step needs one, say the
reference is unavailable in this port, continue with the material that is present, and
tell the user which reference is missing.
<!-- dsh-academic-review:port-notice:end -->
```

**如实的局限。** `vendor/shared/` 下的共享协议文件 —— *四个*技能都会读 —— 含有 **11 个不同**
引用（16 处引用位置）指向本移植未随附的上游目录：`academic-pipeline/` 下 4 个、
`docs/design/` 下 5 个、`examples/` 下 1 个、`scripts/adapters/` 下 1 个。
这些只出现在技能 **metadata** 中（`metadata.unavailableSharedReferences` /
`metadata.unavailableSharedReferenceCount`），并且刻意 **不**追加到技能正文：`shared/` 被每个
被提供的技能同样地引用，由它派生的正文提示块也会同时出现在评审人身上，从而改变评审人被提供的字节。

这份清单是**算出来的，不是手工维护的**，而且算出来的结果在动：vendoring `academic-paper` 之后，
它从 14 个不同目标降到 11 个 —— 过去悬在 `academic-paper/` 下的 3 个目标，现在落在随包内置的树
里解析成功。手写清单到今天还会写着 14。

本移植里出现两个不同的 shared 计数，它们量的是两件事。包**持有 110 个 shared 文件**
（108 个由扫描随包树的 Markdown 得到，另有 2 个仅凭 criteria-registry 引用就随包），而四棵技能树
**合计触达 98 个不同的 shared 目标** —— 多出来的文件是那 98 个目标拉进来的 shared-to-shared
闭包，所以两个数字相差 12，谁都没错。`sr-screener` 对两者都不增加：它直接点名 5 个
`shared/` 路径，顺着这些文件自身的引用走下来共触达 74 个，而这 74 个本来就已经通过更早的树
进入闭包了。

遍历**只读 Markdown**，而且这是承重设计而不是图省事：89 个载荷文件里有 16 个含合计 49 处
引用形状的字符串，若遍历去读它们，其中 27 处会悬空。Python docstring 或 JSON schema 字符串里
的路径是程序消费的数据，不是让 agent 去打开本移植里某个文件的指令 —— 因此 `pnpm test` 读 190 个
Markdown 文件、0 个载荷文件，而“端口内悬空”这个计数才仍然是一个有意义的 0。

直说就是：**`deep-research` 与 `academic-paper` 继承了本移植无法满足的上游跨技能引用。**
两者都是被忠实提供的，只是缺了这些目标。后续轮次要么把被引用的技能（`academic-pipeline`）
一并 vendored，要么把提示块扩展到 `shared/` 范围；在那之前，metadata 就是“缺了什么”的完整记录，
而提示块是对话内的警示。

### 工具

每一次状态迁移都在 `src/state.ts` 中校验。

| 工具 | 用途 |
| --- | --- |
| `academic_review_create` | 钉定一份稿件（仅 .md/.tex/.txt），记录其 SHA-256，创建评审目录并布置面板席位。 |
| `academic_review_status` | 状态、逐席状态、建议性结论、建议性检查项、待办检查点。 |
| `academic_review_confirm` | 人工检查点 1：`action=attach` 保存领域分析（学科、范式、方法、期刊层级、成熟度 + 审稿人配置卡）并把 `created` -> `awaiting_panel_confirmation`；`action=confirm` 记录用户批准并把状态 -> `in_review`。这是让席位变得可提交的唯一路径。 |
| `academic_review_submit` | 提交一个席位报告；在面板检查点之前、席位未知时、或同一席位重复提交时都会被拒绝。 |
| `academic_review_report` | 汇总生成 `editorial_decision.md` 与 `revision_roadmap.md`；只有用户批准、且每条 Devil's Advocate 的 CRITICAL 评审意见都完成裁决之后，`approve: true` 才会关闭评审。 |

### GUI 面板

DSH 右侧栏（sidebar-right）中的 **Academic Review** 标签页列出工作区内的每一次评审 —— 评审 id、
稿件名、模式、席位表（`eic`、`methodology`、`domain`、`perspective`、`da`，外加编辑综合席一行）
以及逐席状态标签（`pending | dispatched | submitted | failed`）、按严重度统计的评审意见数、
最后更新时间，和一个待办检查点徽标。报告就绪后，可以直接从面板打开编辑决定信。
面板严格只读：它由三条需要鉴权的 GET 路由提供（`/plugins/dsh-academic-review/reviews`、
`/reviews/<id>`、`/reviews/<id>/report`），不执行任何修改操作。

### 评审模式

| 模式 | 面板 | 适用场景 |
| --- | --- | --- |
| `full` | 全部 5 席 + 编辑综合席 | 针对整篇稿件的投稿级评审。 |
| `quick` | 压缩的面板快速通过 | 投稿前或小改之后的快速体检。 |
| `methodology-focus` | 侧重方法学席位 | 你希望方法/统计被最严格地审视。 |

本次发布不在范围内：`academic-pipeline` 与 `sr-screener` 两个技能，
以及 `re-review` / `guided` / `calibration` 三种评审模式（明确拒绝，不会静默降级）。

### 评审状态目录布局

位于会话工作区之下：

```
.academic-review/<review_id>/state.json
.academic-review/<review_id>/seats/<seat_id>.json
.academic-review/<review_id>/seats/<seat_id>.md
.academic-review/<review_id>/editorial_decision.md
.academic-review/<review_id>/revision_roadmap.md
```

### 保证

插件永远不会写入稿件，并且每次工具调用都会重新校验钉定的 SHA-256（漂移时报 `paper_changed`）；
没有证据原文加位置的评审意见会被拒绝；席位不得声称自己看到了同侪输出；PDF 输入被拒绝而不是被解析。
以上都是插件代码给出的保证。**被提供的技能**内部的“只写新路径”规则是对模型的指令，不属于这些保证
—— 详见 [写入策略 A](#写入策略-a--只写新路径)。

### 硬性限制

- **输入格式**：仅 `.md`、`.tex` 与 `.txt`。PDF **不会**被解析 —— `academic_review_create` 直接拒绝。
  需要时请先转换。
- **稿件只读**：插件永远不写入被评审的论文。
- **工具只属于评审人**：`deep-research`、`academic-paper` 与 `sr-screener` 以纯提示词技能
  提供（没有工具、没有状态、没有 GUI）；本次发布没有流水线集成，也没有
  re-review/guided/calibration 评审模式。
- **每个技能都只有指令，没有一个有沙箱**：`academic-paper` 用宿主自己的文件工具写文件，
  `sr-screener` 靠运行自带的脚本来写 —— 而评审人与 `deep-research` 也可能用会话自己的工具写。
  这些路径本插件一条都无法拦截，所以策略 A 到四个技能那里都只是前置文本加上 metadata 里的
  `writePolicyEnforced: false`，从来不是互锁。我们无法证明一个技能不会写，所以不会把它排除在
  规则之外 —— 它同样拿到那 684 字节。
- **检测器只是文档，不是闸门**：`src/write-policy.ts` 仍然记下它能够*实测*出会写文件的技能，
  以及是被哪件仪器测出的，因为那是有价值的答案 —— 但没有任何技能因为这条记录而被提供或被拒绝。
  它的盲区是写进文档的、不是藏起来的：靠它自己不随附的 shell 命令写、靠内联 `python -c` 写、
  或靠"generate"/"produce"这类散文写出的正文，都会被判为非产出者，并且照样拿到写入策略块。
- **随包代码只提供，不执行**：六个 Python 脚本原样随包并按 SHA-256 钉定；本插件从不运行它们、
  从不审计它们做什么、也看不见它们写了什么。筛查需要宿主上有 `Python 3.9+`（仅标准库，
  `openpyxl` 可选），真正执行它们的是宿主的 shell。没有 Python 工具链时，这个技能的那部分
  完全不工作。
- **两处人工检查点**：面板启动之前，以及编辑决定关闭评审之前。

## 写入策略 A — 只写新路径

**这是硬性产品规则，不是默认值；任何配置、模式或提示词都无法放宽它。**

**哪些是强制，哪些只是指令 —— 引用这条规则之前请先读这里。** 属于插件自己那部分，它是强制执行的：
五个 `academic_review_*` 工具与两个斜杠命令只写新路径，遇到已存在的路径就拒绝。属于**技能**的那部分
是提示词文本，而本移植在技术上无法阻止宿主的文件工具覆盖某个路径：它看不到那些调用，因此既不能拦截，
也不能阻止或撤销一次写入，写作技能外面也没有沙箱。

因此对每个被提供的技能，这条规则的交付方式都是**被提供文本的第一个块** —— 同一段 684 字节的块
被前置到四个正文的每一个之前，排在所有起草指令或命令行之前 —— 并在 metadata 中镜像为
`writePolicy: 'new-paths-only'` 与 `writePolicyEnforced: false`（四个都有），外加
`writePolicyBasis`（只在被仪器实测过的两个上）。它是模型被告知要遵守的**指令，不是互锁**；
metadata 用机器可读的方式这么写，就是为了没人能把 `writePolicy` 当成"已强制"来引用。请把它当作
一条强指令加一份在被提供载荷里可见的审计痕迹，而不是运行时保证。

**为什么连一个不写文件的评审人也照样带这条规则？** 因为我们无法对提示词证明一个否定命题。没有
任何测量能说明某个技能永远不会产出文件：模型可能通过宿主的工具写、可能执行一条命令、也可能用了
我们检测器不认识的动词。两个失效方向并不对称 —— 缺块会在技能真正动笔的那一刻丢掉规则，而多一块
只是多 684 字节无害的指令 —— 所以我们不再设闸门，改为人人附带。

**块是附带上去的，不是挑选出来的。** `src/write-policy.ts` 里的 `renderWritePolicyBlock()`
**不接受任何参数** —— arity 为零 —— 也不查询那张文件产出表，因此不存在能让某个技能被落下的输入，
也不存在漏掉它的路径：一个技能不可能在没有这块的情况下被提供。这是关于函数签名的陈述，不是关于
我们意图的陈述，正因如此它才有价值：签名不会忘记。`tests/write-policy.test.mjs` 用唯一能证明
保证的方式证明了它 —— 它拿一个**不在任何表里**的技能名去调用渲染器，并断言完整的 684 字节照样
返回。

**两件仪器，留作证据 —— 它们不是闸门。** `src/write-policy.ts` 里的表记下我们能够*实测*出会
产出文件的技能，以及是哪两件仪器之一测出的：**散文起草** —— 写作动词 ≥ 40 **且** 起草动词
≥ 20；或**随包脚本执行** —— 同一行里出现解释器、一个本包确实随附在该技能**自己目录内**的可执行
文件（按磁盘解析，不按文本），以及一个输出参数。`academic-paper` 由第一件测出
（`writePolicyBasis: 'prose-drafting'`），`sr-screener` 由第二件测出
（`'bundled-script'`）；评审人与 `deep-research` 两件都测不出，但照样拿到写入策略块。

qa-gate 对抗式造出的三种写入形态现在已是 `tests/write-policy.test.mjs` 里的 fixture —— 一个靠
自己不随附的 shell 命令写（`mkdir -p exports && ls > out/inventory.md`）、一个靠内联
`python -c` 写、一个正文只写"generate the deliverable" —— 三者都被判为非产出者，却照样被提供
写入策略块。这正是提供规则不再查表的原因：表的双向校验只证明记录与检测器一致，从不证明检测器是
对的。当检测器漏掉一个技能时，检测器与表会一致地认为它不产出文件，测试就在共同的盲区上通过。
不在表里只意味着"我们没能证明它会写"，从不意味着"它不会写"。

1. **技能产出的任何文件都写到新路径。** 一次评审会写入 `state.json`、
   `seats/<seat_id>.json`、`seats/<seat_id>.md`、`editorial_decision.md` 与
   `revision_roadmap.md`，全部位于 `<workspace>/.academic-review/<review_id>/` 之下，
   而 review id 每次运行都重新生成 —— 因此新的评审绝不会落在已有目录或文件之上。
   输出文档是新建的，绝不追加到、也绝不覆盖别人的文件。
2. **稿件永远不会被覆盖、移动、重命名或删除。** 不是被工具、不是被斜杠命令、不是被面板、
   不是被某个席位、也不是被编辑综合席。插件只会读取它（可能对它做哈希，用于钉定字节）。
3. **四个被提供的技能遵循同一规则。** 它们都没有自己的写工具，也都无法被某个工具约束：
   `academic-paper` 通过宿主的文件工具写，`sr-screener` 靠运行自己的脚本写，评审人与
   `deep-research` 用会话给它们的任何工具写。一次运行产出的任何东西（论文草稿、筛查结果、报告、
   笔记、参考文献）都写到新路径，而技能读到的一切（包括稿件）保持只读。在每一种情形里，规则都是以
   指令而非互锁的形式存在 —— 这正是写入策略块出现在四个正文里的原因，也正是需要你在对话记录里用
   眼睛核查它的原因。
4. **已存在的输出路径会被拒绝，绝不被覆盖。** 如果某个命令或某次运行被指向已存在的路径，
   正确行为是拒绝或另取新名 —— 绝不覆盖写入、绝不追加、也绝不把它挪开后再写。
5. **漂移只报告，不修复。** 如果稿件字节在评审期间发生变化，插件以 `paper_changed` 拒绝，
   并请你重新开一次评审。它不会还原、重写、另存或“修好”你的文件 —— 它手上唯一的副本，
   就是它钉定的那个 SHA-256。

后果：删掉整个 `.academic-review/` 目录只会丢失评审历史，不会碰你任何东西。这就是有意的取舍。

## 命令

两个面向人的斜杠命令与工具位于同一状态层之上。它们是对 `ReviewStore` 的薄适配层
（`src/commands.ts`），所以用命令开的评审，与五个工具和只读面板看到的记录完全一致 ——
同一目录、同一份 `state.json`、同一批检查点，没有第二条写入路径。

| 命令 | 提示 | 作用 |
| --- | --- | --- |
| `/ars-review` | `[quick|full] <path-to-manuscript>` | 开一次评审，然后打印 review id、模式与席位清单、解析出的评审目录，以及紧接着要执行的那次 `academic_review_confirm(action="attach", …)` 调用。`.pdf`、缺失或不可读的文件、未知模式和缺失参数，各自以一行可执行的提示拒绝，且不留下任何状态。 |
| `/ars-review-status` | `[review_id]` | 只读。报告工作区中最新的评审（或指定那一次）：生命周期状态、带结论的逐席状态、待办人工检查点、建议性结论，以及下一步该调什么。 |

完整语法、渲染输出与拒绝文案见 [`docs/COMMANDS.md`](docs/COMMANDS.md)。命令需要一个提供 DSH 命令注册表的宿主。
该服务是惰性解析的，因此即使组合里没有命令注册表，五个工具和技能依然会挂载。

## 文档

- [`docs/PORT_SPEC.md`](docs/PORT_SPEC.md) —— 移植规格：上游清单与依赖图、7-agent → 5-seat 的 DSH 映射、
  评审状态 JSON schema、工具 API，以及适配规则。
- [`docs/SEAT_PROTOCOLS.md`](docs/SEAT_PROTOCOLS.md) —— 每个席位如何被派发、收到什么、返回什么，
  以及 DA CRITICAL 裁决与检查点规则。
- [`docs/UPSTREAM_INVENTORY.md`](docs/UPSTREAM_INVENTORY.md) —— vendored `academic-paper-reviewer`
  树的逐文件清单（`deep-research` 树由 `vendor-manifest.json` 记录）。
- [`docs/VERIFICATION.md`](docs/VERIFICATION.md) —— 验证记录：随包字节、工具行为与界面是如何被验证的。
- [`docs/COMMANDS.md`](docs/COMMANDS.md) —— 两个斜杠命令：参数语法、渲染输出，以及它们交接的确切工具调用。
- [`MAINTENANCE.md`](MAINTENANCE.md) —— 上游同步策略与发布维护。
- [`CONTRIBUTING.md`](CONTRIBUTING.md) —— 如何贡献。
- [`CHANGELOG.md`](CHANGELOG.md) —— 按 Keep a Changelog 格式记录的发布历史。

## 安装

直接从本仓库把包加进一个 DSH profile：

```bash
dsh plugin --profile <profile> add github:xuelinzheng41-maker/dsh-academic-review
```

钉定的 tag 或发布 tarball 用法相同：

```bash
dsh plugin --profile <profile> add github:xuelinzheng41-maker/dsh-academic-review#v0.4.1
dsh plugin --profile <profile> add ./dsh-academic-review-0.4.1.tgz
```

构建产物（`lib/`）是有意提交进仓库的，因此从 git 安装不需要构建步骤。bundle patch
`cordis.patch.yml` 会插入一行插件（`id: academic-review`、`name: dsh-academic-review`），
并配置 `stateDir: .academic-review`。

安装后，会话会获得五个 `academic_review_*` 工具和**四个**技能 —— `academic-paper-reviewer`、
`deep-research`、`academic-paper` 与 `sr-screener`（见 `docs/PORT_SPEC.md`）。评审只写入 `<workspace>/.academic-review/<review_id>/`，不写别处。
可以用插件的 `skills: [...]` 配置收窄提供范围（默认：所有 vendored 技能）；未知名称会让挂载失败，
并列出实际存在的技能。

> **许可说明：** `LICENSE` 文件是逐字未改的 CC BY-NC 4.0 法律文本。GitHub 的许可识别器对这段文本
> 报 `NOASSERTION`/`Other`，所以侧栏可能不会显示 “CC BY-NC 4.0”。本项目的许可就是 CC BY-NC 4.0 ——
> **非商业**（non-commercial）—— 与上文及 `LICENSE` 所述完全一致。

## 开发

```bash
pnpm install
pnpm typecheck       # tsc -p tsconfig.json --noEmit
pnpm test            # node --test tests/*.test.mjs
pnpm build           # tsc + browser entrypoint
pnpm verify:vendor   # SHA-256 check of every vendored file
pnpm test:e2e        # deterministic end-to-end harness (scripts/e2e.mjs)
```

从本地 ARS checkout 重新 vendored（永远不要手工编辑 vendored 文件）：

```bash
pnpm vendor -- --upstream <path to an ARS checkout>
```

vendored 目录树与上游逐字节一致，并由测试套件和 `pnpm verify:vendor` 依据 `vendor-manifest.json`
（commit `1ec249df`）核对。

## 升级

### 0.3.0 → 0.4.0

0.4.0 增加第四个被提供的技能。**没有任何工具、路由或状态 schema 变化**：五个工具、它们的参数、
评审状态 schema、面板路由与两个斜杠命令都与 0.3.0 完全一致，因此 `.academic-review/` 目录
仍可正常加载。

- **新增：** 随包内置的 `sr-screener` 技能（上游 **1.0.0**），以纯提示词方式提供 ——
  没有工具、没有状态、没有 GUI、没有斜杠命令。它是第一个可用性取决于能否运行自带代码的技能：
  六个 Python 脚本、需要 `Python 3.9+`、仅标准库、`openpyxl` 可选。本插件随包提供并钉定
  这些脚本，从不运行、也从不审计；真正执行它们的是宿主的 shell，没有 Python 工具链时这个技能的
  那部分完全不工作。
- **写入策略 A 现在无条件提供给每个技能。** 这个块（684 字节，从 549 增长，新增的那条 bullet
  点名脚本写出的产物：`--out` 目标、工作目录、日志与工作簿）被附带在全部四个被提供的正文上，
  而不是挑选给其中一些，因为我们无法证明某个技能永远不会写。检测器与它的两件仪器作为文档保留
  —— `academic-paper` 由散文起草实测出来、`sr-screener` 由随包脚本执行实测出来，`writePolicyBasis`
  只在这两个的 metadata 里 —— 不再决定提供与否。本轮移除的正是那个条件：评审人与
  `deep-research` 的被提供字节数从 47,300 变为 47,984、从 51,632 变为 52,316，变化量就是这一个块，
  一次。
- **随包管理：** 共 279 个文件（原 254 个）—— 技能文件 169 个（28 + 53 + 63 + 25）+ shared 110 个
  （108 个由扫描得到 + 2 个按 registry receipt）。包内现有 89 个非 Markdown 文件
  （`.json` 79、`.py` 6、`.js` 2、`.tex` 1、`.yaml` 1），全部从 git 对象库钉定；
  其中十个来自 `sr-screener`。shared 没有变动：四棵树触达 98 个不同的 shared 目标，
  第四个技能没有新增。
- **未变：** 评审人技能（1.11.1）、`deep-research`（2.12.1）、`academic-paper`（3.3.1）、
  五个工具、评审状态、面板、两个斜杠命令、shared 闭包，以及 CC BY-NC 4.0 条款。

升级方式：用同一来源换成 0.4.0 的构建，然后重启会话。

### 0.2.0 → 0.3.0

0.3.0 增加第三个被提供的技能。**没有任何工具、路由或状态 schema 变化**：五个工具、它们的参数、
评审状态 schema、面板路由与两个斜杠命令都与 0.2.0 完全一致，因此 `.academic-review/` 目录仍可正常加载。

- **新增：** 随包内置的 `academic-paper` 技能（上游 **3.3.1**），以纯提示词方式提供 ——
  没有工具、没有状态、没有 GUI、没有斜杠命令。它用宿主自己的文件工具起草，用宿主提供的 web 工具查证。
- **写入策略 A 随它一起走：** 规则是**被提供文本的第一个块**（前置 549 字节），并在 metadata 中镜像为
  `writePolicy: 'new-paths-only'` 与 `writePolicyEnforced: false`。本移植在技术上无法阻止宿主的
  文件工具覆盖路径，所以这是指令，不是互锁。
- **随包管理：** 共 254 个文件（原 181 个）—— 技能文件 144 个（28 + 53 + 63）+ shared 110 个
  （108 个由扫描得到 + 2 个按 registry receipt），其中包含本移植唯一的非 Markdown 文件
  `academic-paper/templates/latex_article_template.tex`（4,844 B）。披露清单从 14 个不同的未随包
  目标降到 11 个，因为 `academic-paper/` 下的那 3 个目标开始解析成功。
- **未变：** 评审人技能（1.11.1）、`deep-research`（2.12.1）、五个工具、评审状态、面板、
  两个斜杠命令，以及 CC BY-NC 4.0 条款。

升级方式：用同一来源换成 0.3.0 的构建，然后重启会话。

### 0.1.1 → 0.2.0

0.2.0 多提供一个技能。已有评审不受影响：五个工具、它们的参数、评审状态 schema 与面板路由
都未改动，因此 0.1.1 写下的 `.academic-review/` 目录仍可正常加载。

- **新增：** 随包内置的 `deep-research` 技能（上游 2.12.1）与评审人并列提供。它不增加任何工具；
  它使用会话自身的 `web_search` / `web_fetch` 与文件工具。
- **随包管理：** `vendor-manifest.json` 现为 schemaVersion 2（技能清单、逐技能与总文件数、
  计算得出的 `sharedFiles` 清单，以及同样的逐文件 SHA-256 映射）。随包文件共 181 个。
- **未变：** 评审人技能（1.11.1）、五个工具、评审状态、面板、斜杠命令，以及 CC BY-NC 4.0 条款。
- **规则强化：** [写入策略 A](#写入策略-a--只写新路径) —— 只写新路径；插件自身的工具永远不会覆盖、
  移动或删除你的稿件。

升级方式：用同一来源换成 0.2.0 的构建，然后重启会话，具体如下。

### 0.1.0 → 0.1.1

0.1.1 是一个加固版本：评审状态格式没有变化，无需迁移。已位于 `<workspace>/.academic-review/` 下的评审仍可加载。

1. 用与之前相同的安装来源（git 安装、钉定 tag，或发布 tarball）把包换成 0.1.1 的构建：
   `dsh plugin --profile <profile> add <same-source-at-0.1.1>`。
2. 重启 DSH 会话，让新的 bundle patch 与插件代码生效。
3. 可选检查：在工作区执行 `/ars-review-status`，它仍应报告升级前的那几次评审。

两个版本之间的变化（详见 [`CHANGELOG.md`](CHANGELOG.md)）：

- GitHub Actions CI（Ubuntu + Windows × Node 22/24），并带 issue 表单与 PR 模板。
- `/ars-review` 与 `/ars-review-status` 两个斜杠命令。
- GUI 面板：待办检查点卡片（含确切的下一步调用），以及原生渲染的编辑决定信（不使用原始 HTML）。
- `pnpm test:e2e`，一个基于真实工具注册表与真实宿主前缀匹配器的确定性端到端测试。
- vendored 字节改为从上游 git 对象库读取，因此 `pnpm verify:vendor` 在任何 checkout 上都能通过，
  不受 `core.autocrlf` 影响。

## 故障排查

### GitHub 把许可显示为 `NOASSERTION`（或 “Other”）

那是 GitHub 的许可识别器，不是许可本身。[`LICENSE`](LICENSE) 是**逐字未改的 CC BY-NC 4.0 法律文本**；
识别器无法对这段标准文本取指纹，因此拒绝断言一个许可。仓库本身、包清单（`"license": "CC-BY-NC-4.0"`）
以及 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) 都写明 CC BY-NC 4.0，许可也在
[`docs/VERIFICATION.md`](docs/VERIFICATION.md) 中被验证。这里没有任何部分可以被重新许可：
MIT、Apache-2.0 或 BSD 条款都不适用。

### PDF 稿件会被拒绝

这是设计使然，也是唯一的格式拒绝。Phase 1 不解析 PDF、不做 OCR，因此 `academic_review_create`
（以及 `/ars-review`）会以 `unsupported_format` 拒绝 `.pdf`，并提示你先提取文本。用你手头任意工具
转成 `.md`、`.tex` 或 `.txt`，然后重新开评审。拒绝发生在创建任何状态目录之前。

### 为什么是五个工具？

每次状态迁移一个工具，模型因此能清楚看到自己下一步被允许做什么，并按机器可读的错误码而非散文来分支：

| 工具 | 它负责的迁移 |
| --- | --- |
| `academic_review_create` | 钉定稿件、打开评审与面板 |
| `academic_review_confirm` | 仅人工检查点 1 —— 离开 `created` 的唯一路径 |
| `academic_review_submit` | 每次调用提交一张不可变的席位卡 |
| `academic_review_report` | 先汇总，再走需批准才能关闭的流程 |
| `academic_review_status` | 只读摘要，包含待办检查点 |

它们都是适配层：所有校验、schema 检查与原子写入都在 `src/state.ts`，斜杠命令也通过同一个 store 驱动它。
把它们拆开，可以让危险操作（`confirm`）与常规操作分离，也不存在一个可以跳过任何关闸的“全干”调用。

### 为什么是两处人工检查点？

两处都来自上游协议的铁律，并且由状态机强制执行，而不是靠提示词文字：

1. **领域分析之后、任何席位被派发之前**（`field_analysis_attachment` → `panel_confirmation`）。
   领域分析员提出学科、范式、方法、层级与成熟度，以及每个同侪席位一张审稿人配置卡。
   面板构成由用户决定，因此必须由 `academic_review_confirm(action="confirm")` 记录其批准；
   在那之前 `academic_review_submit` 会以 `panel_not_confirmed` 拒绝，且没有任何东西会自我确认。
2. **编辑决定关闭评审之前**（`report_approval`）。汇总会写出决定信草稿与路线图；关闭需要
   `academic_review_report(approve=true)`，且如果 Devil's Advocate 提出了 CRITICAL 级意见，
   每一条都必须带有明确裁决（否则报 `da_adjudication_required`）。插件从不批准自己的产出，
   任何 DA-CRITICAL 议题都不能被静默绕过。

## 商标与背书声明

DeepSeek、DSH 与 Academic Research Skills 是各自所有者的商标或项目名称。本项目是一个独立的、
非官方的移植；它未获 DeepSeek 或上游作者的背书，与二者均无关联，也未受其资助。
