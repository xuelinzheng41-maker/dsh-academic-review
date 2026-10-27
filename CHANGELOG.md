# Changelog

All notable changes to `dsh-academic-review` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
The plugin is licensed **CC BY-NC 4.0** (see [`LICENSE`](LICENSE) and
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)); version numbers here never
imply a change of license.

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
