[English](README.md) | **简体中文**

# dsh-academic-review

[![CI](https://github.com/xuelinzheng41-maker/dsh-academic-review/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/xuelinzheng41-maker/dsh-academic-review/actions/workflows/ci.yml)

> **范围：** 本移植提供 **两个** ARS 技能 —— `academic-paper-reviewer` 与 `deep-research`；
> 只有评审人（reviewer）配有工具、评审状态和 GUI 面板，`deep-research` 以纯提示词
> （prompt-only）技能的形式提供。`academic-paper`、`academic-pipeline` 与 `sr-screener`
> **不**在本次发布范围内。评审输入仅支持 `.md` / `.tex` / `.txt`：不做 PDF 解析，也没有
> OCR。任何技能都不会改写你的稿件（见 [写入策略 A](#写入策略-a--只写新路径)）。

这是 Academic Research Skills（ARS，学术研究技能）中 `academic-paper-reviewer` 与
`deep-research` 两个技能面向 DeepSeek Harness 的 **非官方 DSH 移植（unofficial DSH port）**。
本项目与上游作者及上游项目无任何关联，未获其资助，也未获其背书。

本插件通过一个 DSH 技能提供者（skill provider）同时提供两棵随包内置（vendored）的上游技能树。
只有评审人接入了插件代码：5 席同行评审面板所需的评审状态工具（不可变的逐席报告存储、
稿件 SHA-256 钉定，以及上游协议要求的两处人工检查点），外加只读面板和两个斜杠命令。
`deep-research` 则 **原样提供，没有工具、没有状态、也没有 GUI** —— 它运行在宿主自身的
`web_search` / `web_fetch` 与文件工具之上，因此其产出质量受这些宿主工具实际能触及的范围限制。

## 归属与许可

- 上游作品：Academic Research Skills（学术研究技能），技能 `academic-paper-reviewer`
  v1.11.1（SKILL.md last_updated 2026-08-15），作者 **Cheng-I Wu**
  （ORCID https://orcid.org/0009-0008-9523-0103），
  https://github.com/Imbad0202/academic-research-skills，按 commit
  `1ec249df98728682dfbbdfb940a658338bfd6f80` 随包内置（vendored）。
- 上游许可：**CC BY-NC 4.0**（Attribution-NonCommercial 4.0 International，署名—**非商业**性使用 4.0 国际）。
  本移植以同一许可分发，不得以 MIT、Apache-2.0 或任何其他条款重新许可。
- 完整的归属声明、随包文件清单与修改清单见 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。
- 覆盖本仓库全部内容的完整许可文本见 [`LICENSE`](LICENSE)。

## 本插件提供什么

### 提供的技能（两个）

两棵技能树都按钉定的 ARS commit `1ec249df98728682dfbbdfb940a658338bfd6f80` 原样 vendored 到
`vendor/` 下，并保留各自的上游名称。版本列取自每棵 vendored `SKILL.md` frontmatter 中的
`metadata.version`，在加载时读取 —— 不是插件里写死的数字。

| 技能 | 上游版本 | 本插件新增 | 资源基目录 |
| --- | --- | --- | --- |
| `academic-paper-reviewer` | **1.11.1**（SKILL.md `last_updated` 2026-08-15） | 五个 `academic_review_*` 工具、评审状态目录、只读 GUI 面板，以及 `/ars-review` 与 `/ars-review-status`。 | `vendor/academic-paper-reviewer` |
| `deep-research` | **2.12.1**（SKILL.md `last_updated` 2026-08-15） | 只做提供，不做增补：上游正文原样加载，没有工具、没有状态、没有 GUI、没有斜杠命令。 | `vendor/deep-research` |

`deep-research` 是上游的 13 个 agent 的研究流水线，需要网页搜索、页面抓取和文件工具。
本插件不提供其中任何一个，也不做任何拦截：你的 DSH 宿主已经交给会话的
`web_search` / `web_fetch` / 文件工具，就是它查证材料的唯一手段。**因此它的产出质量受这些
宿主工具的限制** —— 没有网络访问时，这个技能仍能推理，但无法核实来源。

### 本移植未随附的内容 —— 移植提示块

被提供的技能就是上游文本，而上游文本有时会让 agent 去打开一个位于*另一个* ARS 技能里的文件。
本移植无法随附这些文件，于是明确说出来。当某个技能的**自身**说明指向一个本包并未包含的文件时，
提供者会在被提供的正文末尾追加一段带标记的块 —— 这只是运行时文本，vendored 文件本身永远不会被修改 ——
并把完整清单放进 `metadata.unavailableReferences` / `metadata.unavailableReferenceCount`。
提示块里会告知模型：不要臆造缺失内容。

目前恰好只有 **一** 例：`deep-research/agents/bibliography_agent.md` 指向
`academic-pipeline/references/literature_corpus_consumers.md`，而这是本移植未随附的上游技能。
下面就是你会看到追加在 `deep-research` 正文之后的块，逐字如下：

```text
<!-- dsh-academic-review:port-notice:begin (not upstream text) -->
**Port notice - not upstream text.** This DSH port does not ship 1 file that this skill's own instructions tell you to read:

- `academic-pipeline/references/literature_corpus_consumers.md` - named by `agents/bibliography_agent.md`

Do not fabricate or paraphrase the content of these files. If a step needs one, say the
reference is unavailable in this port, continue with the material that is present, and
tell the user which reference is missing.
<!-- dsh-academic-review:port-notice:end -->
```

**如实的局限。** `vendor/shared/` 下的共享协议文件 —— *两个*技能都会读 —— 含有 **14 个不同**
引用（22 处引用位置）指向本移植未随附的上游目录：`academic-paper/` 下 3 个、
`academic-pipeline/` 下 4 个、`docs/design/` 下 5 个、`examples/` 下 1 个、`scripts/adapters/` 下 1 个。
这些只出现在技能 **metadata** 中（`metadata.unavailableSharedReferences` /
`metadata.unavailableSharedReferenceCount`），并且刻意 **不**追加到技能正文：`shared/` 被每个
被提供的技能同样地引用，由它派生的正文提示块也会同时出现在评审人身上，从而改变评审人被提供的字节。

直说就是：**`deep-research` 继承了本移植无法满足的上游跨技能引用。** 除了这些缺失目标之外，它是被忠实提供的。
后续轮次要么把这些被引用的技能一并 vendored，要么把提示块扩展到 `shared/` 范围；在那之前，
metadata 就是“缺了什么”的完整记录，而提示块是对话内的警示。

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

本次发布不在范围内：`academic-paper`、`academic-pipeline` 与 `sr-screener` 三个技能，
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

稿件永远不被写入；每次工具调用都会重新校验钉定的 SHA-256（漂移时报 `paper_changed`）；
没有证据原文加位置的评审意见会被拒绝；席位不得声称自己看到了同侪输出；PDF 输入被拒绝而不是被解析。

### 硬性限制

- **输入格式**：仅 `.md`、`.tex` 与 `.txt`。PDF **不会**被解析 —— `academic_review_create` 直接拒绝。
  需要时请先转换。
- **稿件只读**：插件永远不写入被评审的论文。
- **工具只属于评审人**：`deep-research` 以纯提示词技能提供（没有工具、没有状态、没有 GUI）；
  本次发布没有流水线集成，也没有 re-review/guided/calibration 评审模式。
- **两处人工检查点**：面板启动之前，以及编辑决定关闭评审之前。

## 写入策略 A — 只写新路径

**这是硬性产品规则，不是默认值；任何配置、模式或提示词都无法放宽它。**

1. **技能产出的任何文件都写到新路径。** 一次评审会写入 `state.json`、
   `seats/<seat_id>.json`、`seats/<seat_id>.md`、`editorial_decision.md` 与
   `revision_roadmap.md`，全部位于 `<workspace>/.academic-review/<review_id>/` 之下，
   而 review id 每次运行都重新生成 —— 因此新的评审绝不会落在已有目录或文件之上。
   输出文档是新建的，绝不追加到、也绝不覆盖别人的文件。
2. **稿件永远不会被覆盖、移动、重命名或删除。** 不是被工具、不是被斜杠命令、不是被面板、
   不是被某个席位、也不是被编辑综合席。插件只会读取它（可能对它做哈希，用于钉定字节）。
3. **`deep-research` 的输出遵循同一规则。** 该技能本身没有写工具；一次运行产出的任何东西
   （报告、笔记、参考文献）都必须写到新路径，而它读取的一切保持只读。
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
dsh plugin --profile <profile> add github:xuelinzheng41-maker/dsh-academic-review#v0.2.0
dsh plugin --profile <profile> add ./dsh-academic-review-0.2.0.tgz
```

构建产物（`lib/`）是有意提交进仓库的，因此从 git 安装不需要构建步骤。bundle patch
`cordis.patch.yml` 会插入一行插件（`id: academic-review`、`name: dsh-academic-review`），
并配置 `stateDir: .academic-review`。

安装后，会话会获得五个 `academic_review_*` 工具和**两个**技能 —— `academic-paper-reviewer` 与
`deep-research`（见 `docs/PORT_SPEC.md`）。评审只写入 `<workspace>/.academic-review/<review_id>/`，不写别处。
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

### 0.1.1 → 0.2.0

0.2.0 提供第二个技能。已有评审不受影响：五个工具、它们的参数、评审状态 schema 与面板路由都未改动，
因此 0.1.1 写下的 `.academic-review/` 目录仍可正常加载。

- **新增：** 随包内置的 `deep-research` 技能（上游 2.12.1）与评审人并列提供。它不增加任何工具；
  它使用会话自身的 `web_search` / `web_fetch` 与文件工具。
- **随包管理：** `vendor-manifest.json` 现为 schemaVersion 2（技能清单、逐技能与总文件数、
  计算得出的 `sharedFiles` 清单，以及同样的逐文件 SHA-256 映射）。随包文件共 181 个。
- **未变：** 评审人技能（1.11.1）、五个工具、评审状态、面板、斜杠命令，以及 CC BY-NC 4.0 条款。
- **规则强化：** [写入策略 A](#写入策略-a--只写新路径) —— 只写新路径；稿件永远不会被覆盖、移动或删除。

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
