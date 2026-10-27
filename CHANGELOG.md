# Changelog

All notable changes to `dsh-academic-review` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
The plugin is licensed **CC BY-NC 4.0** (see [`LICENSE`](LICENSE) and
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)); version numbers here never
imply a change of license.

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
