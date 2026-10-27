# Changelog

All notable changes to `dsh-academic-review` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
The plugin is licensed **CC BY-NC 4.0** (see [`LICENSE`](LICENSE) and
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)); version numbers here never
imply a change of license.

## [0.4.0] - 2026-10-27

Fourth served skill, and the first whose usefulness depends on executing code it
ships. **No tool, route or state schema changed**: the five `academic_review_*`
tools, their arguments, the review-state schema, the panel's three GET routes and
both slash commands are identical to 0.3.0, so `.academic-review/` directories
keep loading.

### Added

- The vendored **`sr-screener`** skill (upstream **1.0.0**, read from its own
  SKILL.md frontmatter, `last_updated` 2026-09-29, 25 files) is served next to the
  other three. It is **prompt-only**: no tool, no review state, no panel, no slash
  command.
- **The first executable payload.** `sr-screener` ships six Python scripts
  (`scripts/build_outputs.py`, `build_workflow.py`, `merge_decisions.py`,
  `prepare_fulltext.py`, `prepare_records.py`, `srlib.py`) plus two `.js`
  workflow templates and two `.json` templates. They are vendored verbatim and
  pinned by SHA-256 like every Markdown byte. This plugin **never executes them,
  never audits them, and cannot see what they write**; the host's shell runs them.
  Upstream states the requirement as **Python 3.9+, standard library only,
  `openpyxl` optional**, so without a Python 3.9+ toolchain that part of the skill
  does not work at all — it fails visibly rather than returning something that
  looks like a screen.
- **The rule is now served to every skill, unconditionally.** The earlier design
  gave the block only to skills an instrument had proved produce files, and that was
  the wrong default: it asked us to prove a negative about a prompt, which cannot be
  done. An adversarial pass found three shapes that write and that the detector
  scored as non-producers — writing through shell commands the skill does not ship,
  writing through inline `python -c`, and prose using "generate"/"produce", a verb
  the list does not contain — and each shipped with no policy at all. The
  both-directions table test could not see it, because when the detector misses a
  skill the detector and the table agree that it does not produce files. So
  `renderWritePolicyBlock()` now takes **no parameter at all** and does not consult
  the table: the block is attached, not selected, and no served skill can be without
  it. The block grew from 549 to **684 bytes** — the extra bullet names
  script-written artifacts (the `--out` target, the work directory, the log, the
  workbook).
- **The detector survives as documentation.** The table and its two instruments
  still record which skills are *demonstrated* producers, and by which instrument —
  prose drafting (writing verbs ≥ 40 and drafting verbs ≥ 20) or bundled-script
  execution (one line with an interpreter, an executable the package ships inside
  that skill's own directory, and an output argument). `academic-paper` is
  demonstrated the first way, `sr-screener` the second, and `writePolicyBasis`
  (`'prose-drafting'` / `'bundled-script'`) is on those two only, because no
  instrument measured the other two. Nothing is served or denied on that basis: the
  reviewer and `deep-research` go from 47,300 to 47,984 and 51,632 to 52,316 served
  bytes, one block each, while `academic-paper` (65,113) and `sr-screener`
  (33,212) do not move.

### Changed

- **Vendored set:** 279 files (was 254) — 169 skill files (28 + 53 + 63 + 25) +
  110 shared (108 by scan + 2 by registry receipt). The package now holds **89
  non-Markdown files** (`.json` 79, `.py` 6, `.js` 2, `.tex` 1, `.yaml` 1);
  all 89 are byte-identical to their git objects and to their pins, which makes the
  payload class extension-agnostic in practice as well as in the pipeline.
  `sr-screener` contributes ten of them.
- **Shared did not move:** the closure stays 110 files (108 by scan), and the four
  trees collectively reach 98 distinct shared targets. `sr-screener` names five
  `shared/` paths directly and reaches 74 once their own references are followed —
  every one already in the closure through the older trees, a differential of zero
  asserted by comparing two computed sets rather than by pinning a size.
- **The reference walk reads Markdown only**, deliberately: 16 of the 89 payload
  files carry 49 reference-shaped strings, 27 of which would dangle if the walk
  read them. A path inside a Python docstring is data, not an instruction to open a
  file in this port.

### Unchanged

- The reviewer skill (1.11.1), `deep-research` (2.12.1), `academic-paper`
  (3.3.1), the five tools, the review-state schema, the panel, both slash commands,
  and the CC BY-NC 4.0 terms. 0 of the 254 previous pins moved.

## [0.3.0] - 2026-10-27

Third served skill. **No tool, route or state schema changed**: the five
`academic_review_*` tools, their arguments, the review-state schema, the panel's
three GET routes and both slash commands are identical to 0.2.0, so
`.academic-review/` directories written by 0.1.1 or 0.2.0 keep loading.

### Added

- The vendored **`academic-paper`** skill (upstream **3.3.1**, read from its own
  SKILL.md frontmatter, `last_updated` 2026-08-15, 63 files, SKILL.md 65,335
  repository bytes) is served next to the reviewer and `deep-research`. It is
  **prompt-only**: no tool, no review state, no panel, no slash command. It
  depends on the host's file tools — that is how it drafts — and on whatever web
  tools the host gives the session.
- **Write policy A travels with it.** The rule is delivered as the **first block
  of the served text**: a 549-byte block is prepended to the body, before any
  drafting instruction, and mirrored in metadata as `writePolicy:
  'new-paths-only'` with `writePolicyEnforced: false`. This port cannot
  technically prevent the host's file tools from overwriting a path, so the rule
  is an instruction the model is told to follow, not an interlock. The
  file-producing skill table (`src/write-policy.ts`) is checked in both
  directions, so a skill that starts writing files must be listed and a listed
  skill that stops matching fails the suite.
- `vendor/academic-paper/` (63 files), vendored whole and byte-identical,
  including the only non-Markdown file in the whole port:
  `templates/latex_article_template.tex` (4,844 B, pinned from the upstream git
  object — the CRLF worktree copy would have been 5,043 B).

### Changed

- Vendored totals: **254 files** (was 181) — 144 skill files (28 reviewer + 53
  `deep-research` + 63 `academic-paper`) + 110 shared (108 by scan + 2 by
  registry receipt). All 181 previously pinned files are unchanged; 73 were
  added (63 skill + 10 shared).
- The computed `shared/` closure grew from 98 to 108 by scan, and the
  disclosure list shrank: **11 distinct** unvendored upstream targets (16
  reference sites) instead of 14 (22), because the three targets that used to
  dangle under `academic-paper/` now resolve inside the vendored tree. That drop
  is the evidence that the list is computed rather than maintained by hand.
- Per-skill own-tree port notices: reviewer 0, `deep-research` 1,
  `academic-paper` 1 (both name the same unvendored
  `academic-pipeline/references/literature_corpus_consumers.md`).
- The routing hint reads both `Triggers on:` and `Triggers:` (academic-paper
  writes the latter), so the third skill is served with its trigger guidance.
- README (both languages) and `docs/PORT_SPEC.md` document the three served
  skills, the new totals, the .tex file and the enforced-vs-instructed split.

### Unchanged

- The reviewer skill (1.11.1), `deep-research` (2.12.1), the five tools, the
  review-state schema, the GUI panel, both slash commands, and the CC BY-NC 4.0
  terms.

## [0.2.0] - 2026-10-27

Second served skill. The five review tools, their arguments, the review-state
schema and the panel routes are **unchanged**, so reviews written by 0.1.1 keep
loading.

### Added

- The vendored **`deep-research`** skill (upstream 2.12.1, SKILL.md
  `last_updated` 2026-08-15) is advertised next to the reviewer, from the same
  pinned commit (`1ec249df…`). It is served prompt-only: no tool, no review
  state, no panel, no slash command. It runs on the host's own `web_search` /
  `web_fetch` and file tools, so its output quality is bounded by what those
  host tools can reach.
- `vendor/deep-research/` (53 files), vendored whole and byte-identical.
- **Port notice (commit 4c84ffb).** A served skill whose own instructions name
  a file this port does not ship now gets a delimited block appended to its
  served text — `<!-- dsh-academic-review:port-notice:begin (not upstream text) -->`
  … `…:end -->` — naming the missing path and telling the model not to fabricate
  or paraphrase its content. The vendored files are never edited; the full list
  rides in `metadata.unavailableReferences` (+ `unavailableReferenceCount`).
  Today exactly one case exists: `deep-research/agents/bibliography_agent.md`
  points at `academic-pipeline/references/literature_corpus_consumers.md`, which
  is not vendored. The `shared/` protocol files carry a further 14 distinct
  references (22 sites) to unvendored upstream areas (academic-paper,
  academic-pipeline, docs/design, examples, scripts/adapters); those are
  metadata-only (`unavailableSharedReferences`,
  `unavailableSharedReferenceCount`) and are **not** appended to any body, because
  `shared/` is shared by every skill and a body notice would change the
  reviewer's served bytes. So `deep-research` inherits upstream cross-skill
  references this port cannot satisfy; a later round either vendors those skills
  or extends the notice to the shared scope.

### Changed

- `vendor-manifest.json` is **schemaVersion 2**: `skills` list with per-skill
  file counts, `sharedFiles` (computed), `sharedViaRegistryReceipts`, and the
  unchanged per-file SHA-256 map — 181 vendored files in total (28 reviewer +
  53 deep-research + 100 shared).
- The vendoring script carries one `SKILLS` list and **computes** the `shared/`
  closure by scanning every vendored file, instead of keeping a hand-maintained
  list; a missing target aborts the run before anything is written. Two
  `shared/review_criteria_sources/*.json` files are vendored by registry
  receipt because no vendored Markdown names them.
- The skill provider serves **N** skills: discovery is a directory scan
  (`vendor/<skill>/SKILL.md`), each skill gets its own absolute resource base
  and its own frontmatter metadata, and the plugin config accepts `skills` to
  narrow the set (an unknown name fails the mount and lists the available ones).
  `src/index.ts` still mounts the five tools and both slash commands once.
- README and `docs/PORT_SPEC.md` document the two served skills, the new
  manifest schema and the computed closure.

### Note

- **Write policy A — new paths only** is documented as a hard product rule, not
  a default: every file a skill produces goes to a new path (`deep-research`
  outputs included), and the manuscript is never overwritten, moved, renamed or
  deleted. Pointing a command at an existing output path is refused or renamed,
  never clobbered. Manuscript drift is reported (`paper_changed`), never
  repaired.

### Documentation

- The README is now bilingual: **Simplified Chinese** (`README.zh-CN.md`) next to
  the English one, with a language switch on line 1 of both, and
  `tests/readme-language-parity.test.mjs` keeping the two structurally identical
  (same code blocks, headings, tables, links and the legally load-bearing
  attribution wording).

## [0.1.1] - 2026-10-27

Round 2 hardening. No review-state schema change: existing reviews under
`<workspace>/.academic-review/` keep loading unchanged.

### Added

- **Slash commands** `/ars-review [quick|full] <path-to-manuscript>` and
  `/ars-review-status [review_id]` — thin adapters over `ReviewStore`
  (`src/commands.ts`), so a review opened from a command is the same record the
  tools and the panel see. Refusals (PDF, missing file, unimplemented mode, bad
  usage) are one actionable line each. Documented in `docs/COMMANDS.md`,
  covered by `tests/commands.test.mjs`.
- **GUI panel** — a pending-checkpoint card per review naming the checkpoint
  (`field_analysis_attachment`, `panel_confirmation`, `report_approval`), the
  exact next tool call in a copyable block, and a copy button; and the editorial
  decision letter rendered natively through a sanitising Markdown-to-React
  parser (`src/client/letter-markdown.tsx`, no raw HTML injection). The panel
  stays strictly read-only (GET only).
- **`pnpm test:e2e`** — a deterministic end-to-end harness (`scripts/e2e.mjs`)
  that mounts the plugin on a real cordis `Context`, drives the five tools
  through `ctx.tools`, asserts every transition on both the tool result and
  `state.json`, asserts the artifact set, resolves the three read-only routes
  through the real host prefix matcher, and covers both negative gates. No
  network and no model call.
- **CI** — GitHub Actions matrix pipeline (`.github/workflows/ci.yml`:
  Ubuntu + Windows × Node 22/24, `pnpm typecheck` / `test` /
  `verify:vendor` / `build`), issue forms
  (`.github/ISSUE_TEMPLATE/bug_report.yml`,
  `.github/ISSUE_TEMPLATE/feature_request.yml`) and a pull
  request template that demands the verification commands actually run.
- `CHANGELOG.md` (this file).

### Changed

- README: `Commands`, `Troubleshooting` and `Upgrade` sections, the CI badge,
  and `pnpm test:e2e` in the development block.
- `docs/PORT_SPEC.md`: the section 3 tool table is stated as authoritative
  against `src/tools.ts` (`approve` / `da_adjudications` arguments, no CLI
  flag), plus new `Slash commands` and `End-to-end harness` subsections.
- Re-vendoring reads each upstream file from the git object store
  (`git cat-file blob <commit>:<path>`) instead of copying a worktree.

### Fixed

- Vendored pins survive any checkout: `vendor-manifest.json` now describes the
  bytes the upstream repository stores, so `pnpm verify:vendor` no longer fails
  on machines whose `core.autocrlf` rewrites the worktree. `.gitattributes`
  pins `vendor/**` to `-text`, the vendoring script refuses a checkout that is
  not at the pinned commit and refuses a worktree copy that differs from the
  commit beyond line endings.

## [0.1.0] - 2026-10-27

First public Phase 1 release: an unofficial DSH port of the Academic Research
Skills skill `academic-paper-reviewer` v1.11.1 (commit
`1ec249df98728682dfbbdfb940a658338bfd6f80`), reviewer-only.

### Added

- Vendored upstream tree, byte-identical: `vendor/academic-paper-reviewer/`
  (28 files) plus the `shared/` dependency set, pinned by
  `vendor-manifest.json` and checked by `pnpm verify:vendor`.
- Skill provider for `academic-paper-reviewer` (unmodified upstream body).
- Five review-state tools, every transition validated in `src/state.ts`:
  `academic_review_create`, `academic_review_status`,
  `academic_review_confirm` (the only path out of `created`),
  `academic_review_submit`, `academic_review_report`.
- Manuscript SHA-256 pinning with `paper_changed` on drift; `.md` / `.tex` /
  `.txt` only, PDF refused at create.
- The two human checkpoints: field-analysis attach + panel confirmation, and
  approval-gated report close with mandatory Devil's Advocate CRITICAL
  adjudication.
- Read-only GUI panel in the sidebar-right pane, served by three authenticated
  GET routes (`/plugins/dsh-academic-review/reviews`, `/reviews/<id>`,
  `/reviews/<id>/report`).
- Review modes `full`, `quick`, `methodology-focus`; `re-review`, `guided`
  and `calibration` refused explicitly.
- Documentation (`docs/PORT_SPEC.md`, `docs/SEAT_PROTOCOLS.md`,
  `docs/UPSTREAM_INVENTORY.md`, `docs/VERIFICATION.md`,
  `MAINTENANCE.md`, `CONTRIBUTING.md`), an example review under
  `examples/review-example/`, and unit tests in `tests/`.
- CC BY-NC 4.0 `LICENSE` and `THIRD_PARTY_NOTICES.md` with the upstream
  attribution block.
