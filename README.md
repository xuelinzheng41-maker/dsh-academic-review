**English** | [简体中文](README.zh-CN.md)

# dsh-academic-review

[![CI](https://github.com/xuelinzheng41-maker/dsh-academic-review/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/xuelinzheng41-maker/dsh-academic-review/actions/workflows/ci.yml)

> **Scope:** this port serves **two** ARS skills — `academic-paper-reviewer`
> and `deep-research` — and only the reviewer has tools, review state and a GUI
> panel; `deep-research` is served as a prompt-only skill. `academic-paper`,
> `academic-pipeline` and `sr-screener` are **not** part of this release. Reviewer
> input is `.md` / `.tex` / `.txt` only: there is no PDF parsing and no OCR.
> No skill ever rewrites your manuscript (see [Write policy A](#write-policy-a--new-paths-only)).

An **unofficial DSH port** of the Academic Research Skills (ARS) skills
`academic-paper-reviewer` and `deep-research` for DeepSeek Harness.
It is not affiliated with, sponsored by, or endorsed by the upstream author or
project.

The plugin serves both vendored upstream skills through one DSH skill provider.
Only the reviewer is wired to plugin code: the review-state tools a 5-seat
peer-review panel needs (an immutable per-seat report store, manuscript SHA-256
pinning, and the two human checkpoints the upstream protocol requires), plus the
read-only panel and two slash commands. `deep-research` is served **as-is, with
no tools, no state and no GUI** — it runs on the host's own `web_search` /
`web_fetch` and file tools, so its output quality is bounded by what those host
tools can actually reach.

## Attribution and license

- Upstream work: Academic Research Skills, skill `academic-paper-reviewer`
  v1.11.1 (SKILL.md last_updated 2026-08-15) by **Cheng-I Wu**
  (ORCID https://orcid.org/0009-0008-9523-0103),
  https://github.com/Imbad0202/academic-research-skills, vendored at commit
  `1ec249df98728682dfbbdfb940a658338bfd6f80`.
- Upstream license: **CC BY-NC 4.0** (Attribution-NonCommercial 4.0
  International). This port is distributed under the same license and must not
  be relicensed under MIT, Apache-2.0, or any other terms.
- See [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) for the full
  attribution block, the vendored file inventory, and the list of modifications.
- See [`LICENSE`](LICENSE) for the full license text that covers this entire
  repository.

## What this plugin provides

### Skills served (two)

Both trees are vendored unmodified under `vendor/` from the pinned ARS commit
`1ec249df98728682dfbbdfb940a658338bfd6f80`, and both keep their upstream names.
The version column is the `metadata.version` in each vendored `SKILL.md`
frontmatter, read at load time — not a number typed into the plugin.

| Skill | Upstream version | What this plugin adds | Resource base |
| --- | --- | --- | --- |
| `academic-paper-reviewer` | **1.11.1** (SKILL.md `last_updated` 2026-08-15) | The five `academic_review_*` tools, the review state directory, the read-only GUI panel, and `/ars-review` + `/ars-review-status`. | `vendor/academic-paper-reviewer` |
| `deep-research` | **2.12.1** (SKILL.md `last_updated` 2026-08-15) | Nothing but service: the upstream body is loaded verbatim. No tools, no state, no GUI, no slash command. | `vendor/deep-research` |

`deep-research` is a 13-agent research pipeline that expects web search, page
fetching and file tools. This plugin supplies none of them and intercepts
nothing: whatever `web_search` / `web_fetch` / file tools your DSH host already
gives the session are the only means it has to look things up. **Its output
quality is therefore bounded by those host tools** — with no network access the
skill can still reason, but it cannot verify sources.

### What this port does not ship — the port notice

A served skill is upstream text, and upstream text sometimes tells the agent to
open a file that lives in a *different* ARS skill. This port cannot ship those,
so it says so. When a served skill's **own** instructions name a file this
package does not contain, the provider appends a delimited block to the served
body — runtime text only, the vendored files themselves are never edited — and
carries the full list in `metadata.unavailableReferences` /
`metadata.unavailableReferenceCount`. The model is told, in the notice, not to
fabricate the missing content.

Today exactly **one** case exists:
`deep-research/agents/bibliography_agent.md` points at
`academic-pipeline/references/literature_corpus_consumers.md`, an upstream skill
this port does not vendor. This is the block you will see appended to the
`deep-research` body, verbatim:

```text
<!-- dsh-academic-review:port-notice:begin (not upstream text) -->
**Port notice - not upstream text.** This DSH port does not ship 1 file that this skill's own instructions tell you to read:

- `academic-pipeline/references/literature_corpus_consumers.md` - named by `agents/bibliography_agent.md`

Do not fabricate or paraphrase the content of these files. If a step needs one, say the
reference is unavailable in this port, continue with the material that is present, and
tell the user which reference is missing.
<!-- dsh-academic-review:port-notice:end -->
```

**The honest limitation.** The shared protocol files under `vendor/shared/` —
which *both* served skills read — contain **14 distinct references** (22
reference sites) to upstream areas this port does not vendor: 3 under
`academic-paper/`, 4 under `academic-pipeline/`, 5 under `docs/design/`, 1 under
`examples/` and 1 under `scripts/adapters/`. Those are surfaced in skill
**metadata only** (`metadata.unavailableSharedReferences` /
`metadata.unavailableSharedReferenceCount`), and deliberately **not** appended to
the skill body: `shared/` is reached identically by every served skill, so a body
notice derived from it would fire on the reviewer too and would change the
reviewer's served bytes.

Say it plainly: **`deep-research` inherits upstream cross-skill references that
this port cannot satisfy.** It is served faithfully, minus those targets. A later
round either vendors the referenced skills or extends the notice to cover the
`shared/` scope; until then, the metadata is the complete record of what is
missing and the notice is the in-conversation warning.

### Tools

Every state transition is validated in `src/state.ts`.

| Tool | Purpose |
| --- | --- |
| `academic_review_create` | Pin a manuscript (.md/.tex/.txt only), record its SHA-256, open the review directory and the panel seats. |
| `academic_review_status` | Status, per-seat state, advisory decision, advisory checks, pending checkpoint. |
| `academic_review_confirm` | Human checkpoint 1: `action=attach` stores the field analysis (discipline, paradigm, methodology, tier, maturity + the reviewer configuration cards) and moves `created` -> `awaiting_panel_confirmation`; `action=confirm` records the user's approval and moves -> `in_review`. The only path that makes seats submittable. |
| `academic_review_submit` | Commit one seat report; refused before the panel checkpoint, for an unknown seat, or twice for the same seat. |
| `academic_review_report` | Synthesize `editorial_decision.md` and `revision_roadmap.md`; `approve: true` closes the review only after the user approves and every Devil's Advocate CRITICAL finding is adjudicated. |

### GUI panel

An **Academic Review** tab in the DSH sidebar-right pane shows
every review in the workspace — review id, paper name, mode, a seat table
(`eic`, `methodology`, `domain`, `perspective`, `da`, plus the editorial
synthesizer row) with per-seat status chips
(`pending | dispatched | submitted | failed`), findings counts by severity,
last update, and a pending-checkpoint badge. From the panel you can open the
editorial decision letter once the report is ready. The panel is strictly
read-only: it is served by three authenticated GET routes
(`/plugins/dsh-academic-review/reviews`,
`/reviews/<id>`, `/reviews/<id>/report`) and performs no mutations.

### Review modes

| Mode | Panel | Use when |
| --- | --- | --- |
| `full` | All 5 seats + editorial synthesizer | Submission-grade review of the whole manuscript. |
| `quick` | Compressed panel pass | A fast sanity pass before submission or after minor edits. |
| `methodology-focus` | Methodology seat emphasized | You want the methods/statistics scrutinized hardest. |

Out of scope for this release: the `academic-paper`, `academic-pipeline` and
`sr-screener` skills, and the `re-review` / `guided` / `calibration` review
modes (refused explicitly, with no silent fallback).

### Review state layout

Under the session workspace:

```
.academic-review/<review_id>/state.json
.academic-review/<review_id>/seats/<seat_id>.json
.academic-review/<review_id>/seats/<seat_id>.md
.academic-review/<review_id>/editorial_decision.md
.academic-review/<review_id>/revision_roadmap.md
```

### Guarantees

The manuscript is never written to; every tool call re-verifies
the pinned SHA-256 (`paper_changed` on drift); a finding without an evidence
quote plus location is refused; a seat may not claim peer-output visibility;
PDF input is rejected rather than parsed.

### Hard limits

- **Input formats**: `.md`, `.tex`, and `.txt` only. PDF is **not** parsed —
  `academic_review_create` rejects it outright. Convert first if needed.
- **Read-only manuscript**: the plugin never writes to the paper under review.
- **Tooling is reviewer-only**: `deep-research` is served as a prompt-only
  skill (no tools, no state, no GUI); there is no pipeline integration, and no
  re-review/guided/calibration review modes in this release.
- **Two human checkpoints**: before the panel starts and before the final
  editorial decision closes the review.

## Write policy A — new paths only

**This is a hard product rule, not a default, and no configuration, mode or
prompt can relax it.**

1. **Any file a skill produces is written to a new path.** A review writes
   `state.json`, `seats/<seat_id>.json`, `seats/<seat_id>.md`,
   `editorial_decision.md` and `revision_roadmap.md` under
   `<workspace>/.academic-review/<review_id>/`, and the review id is generated
   fresh for every run — so a new review never lands on top of an existing
   directory or file. Output documents are created, never appended to or
   overwritten on top of someone else's file.
2. **The manuscript is never overwritten, moved, renamed or deleted.** Not by a
   tool, not by a slash command, not by the panel, not by a seat and not by the
   editorial synthesizer. The plugin only ever reads it (it may hash it, to pin
   the bytes).
3. **`deep-research` outputs follow the same rule.** That skill has no write tool
   of its own; anything a run produces (a report, notes, a bibliography) must go
   to a new path, and everything it reads stays read-only.
4. **An existing output path is refused, never clobbered.** If a command or a
   run is pointed at a path that already exists, the correct behaviour is to
   refuse or to pick a new name — never to write over it, append to it, or
   rename it out of the way.
5. **Drift is reported, never repaired.** If the manuscript's bytes change
   mid-review the plugin refuses with `paper_changed` and asks you to open a new
   review. It does not restore, rewrite, re-save or "fix" your file — the only
   copy it holds is the SHA-256 it pinned.

Consequence: deleting the whole `.academic-review/` directory loses review
history and touches nothing of yours. That is the intended trade.

## Commands

Two human slash commands sit on the same state layer as the tools. They are
thin adapters (`src/commands.ts`) over `ReviewStore`, so a review opened from a
command is the same record the five tools and the read-only panel see — same
directory, same `state.json`, same checkpoints, no second write path.

| Command | Hint | What it does |
| --- | --- | --- |
| `/ars-review` | `[quick|full] <path-to-manuscript>` | Opens a review, then prints the review id, mode and seat list, the resolved review directory, and the exact `academic_review_confirm(action="attach", …)` call that comes next. `.pdf`, missing or unreadable files, unknown modes and missing arguments are refused in one actionable line each, with no state left behind. |
| `/ars-review-status` | `[review_id]` | Read-only. Reports the newest review in the workspace (or the named one): lifecycle status, per-seat state with verdicts, the pending human checkpoint, the advisory decision, and the next call to make. |

Full grammar, rendered output and refusal texts: [`docs/COMMANDS.md`](docs/COMMANDS.md).
The commands need a host that provides the DSH command registry. The service is
resolved lazily, so a composition without one still mounts the five tools and
the skill.

## Documentation

- [`docs/PORT_SPEC.md`](docs/PORT_SPEC.md) — port specification: upstream
  inventory and dependency map, the 7-agent → 5-seat DSH mapping, the
  review-state JSON schema, the tool API, and adapter rules.
- [`docs/SEAT_PROTOCOLS.md`](docs/SEAT_PROTOCOLS.md) — how each seat is
  dispatched, what it receives and returns, and the DA CRITICAL adjudication
  and checkpoint rules.
- [`docs/UPSTREAM_INVENTORY.md`](docs/UPSTREAM_INVENTORY.md) — file-by-file
  inventory of the vendored `academic-paper-reviewer` tree (the `deep-research`
  tree is inventoried by `vendor-manifest.json`).
- [`docs/VERIFICATION.md`](docs/VERIFICATION.md) — verification records:
  how vendored bytes, tool behavior, and the UI were validated.
- [`docs/COMMANDS.md`](docs/COMMANDS.md) — the two slash commands: argument
  grammar, rendered output, and the exact tool calls they hand off to.
- [`MAINTENANCE.md`](MAINTENANCE.md) — upstream sync policy and release
  maintenance.
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — how to contribute.
- [`CHANGELOG.md`](CHANGELOG.md) — release history in Keep a Changelog form.

## Install

Add the package to a DSH profile straight from this repository:

```bash
dsh plugin --profile <profile> add github:xuelinzheng41-maker/dsh-academic-review
```

A pinned tag or the release tarball works the same way:

```bash
dsh plugin --profile <profile> add github:xuelinzheng41-maker/dsh-academic-review#v0.2.0
dsh plugin --profile <profile> add ./dsh-academic-review-0.2.0.tgz
```

The build output (`lib/`) is committed on purpose, so a git install needs no
build step. The bundle patch `cordis.patch.yml` inserts one plugin row
(`id: academic-review`, `name: dsh-academic-review`) configured with
`stateDir: .academic-review`.

After installing, the session gains five `academic_review_*` tools and **two**
skills — `academic-paper-reviewer` and `deep-research` (see
`docs/PORT_SPEC.md`). A review writes to
`<workspace>/.academic-review/<review_id>/` and nowhere else. The provider can be
narrowed with the plugin's `skills: [...]` config (default: every vendored
skill); an unknown name fails the mount and lists the skills that do exist.

> **License note:** the `LICENSE` file is the verbatim CC BY-NC 4.0 legalcode.
> GitHub's license detector reports it as `NOASSERTION`/`Other` for that text,
> so the sidebar may not show "CC BY-NC 4.0". The license is CC BY-NC 4.0 —
> non-commercial — exactly as stated above and in `LICENSE`.

## Development

```bash
pnpm install
pnpm typecheck       # tsc -p tsconfig.json --noEmit
pnpm test            # node --test tests/*.test.mjs
pnpm build           # tsc + browser entrypoint
pnpm verify:vendor   # SHA-256 check of every vendored file
pnpm test:e2e        # deterministic end-to-end harness (scripts/e2e.mjs)
```

Re-vendoring from a local ARS checkout (never edit vendored files by hand):

```bash
pnpm vendor -- --upstream <path to an ARS checkout>
```

The vendored tree is byte-identical to upstream and is checked against
`vendor-manifest.json` (commit `1ec249df`) by both the test suite and
`pnpm verify:vendor`.

## Upgrade

### 0.1.1 → 0.2.0

0.2.0 serves a second skill. Nothing about an existing review changes: the five
tools, their arguments, the review-state schema and the panel routes are
untouched, so `.academic-review/` directories written by 0.1.1 keep loading.

- **New:** the vendored `deep-research` skill (upstream 2.12.1) is advertised
  next to the reviewer. It adds no tool; it uses the session's own
  `web_search` / `web_fetch` and file tools.
- **Vendoring:** `vendor-manifest.json` is now schemaVersion 2 (skills list,
  per-skill and total file counts, a computed `sharedFiles` list, and the same
  per-file SHA-256 map). 181 vendored files total.
- **Unchanged:** the reviewer skill (1.11.1), five tools, review state, panel,
  slash commands, and the CC BY-NC 4.0 terms.
- **Rule reinforced:** [Write policy A](#write-policy-a--new-paths-only) — new
  paths only; the manuscript is never overwritten, moved or deleted.

To upgrade, replace the package with the 0.2.0 build from the same source and
restart the session, exactly as below.

### 0.1.0 → 0.1.1

0.1.1 is a hardening release: no review-state format change, nothing to
migrate. Reviews already under `<workspace>/.academic-review/` keep loading.

1. Replace the package with the 0.1.1 build, using the same install source as
   before (git install, pinned tag, or the release tarball):
   `dsh plugin --profile <profile> add <same-source-at-0.1.1>`.
2. Restart the DSH session so the new bundle patch and plugin code load.
3. Optional check: `/ars-review-status` in the workspace still reports the
   reviews it reported before the upgrade.

What changed between the two versions (details in [`CHANGELOG.md`](CHANGELOG.md)):

- GitHub Actions CI (Ubuntu + Windows × Node 22/24) with issue forms and a PR
  template.
- `/ars-review` and `/ars-review-status` slash commands.
- GUI panel: a pending-checkpoint card with the exact next call, and the
  editorial decision letter rendered natively (no raw HTML).
- `pnpm test:e2e`, a deterministic end-to-end harness over the real tool
  registry and the real host prefix matcher.
- Vendored bytes are now taken from the upstream git object store, so
  `pnpm verify:vendor` passes on any checkout regardless of `core.autocrlf`.

## Troubleshooting

### GitHub reports `NOASSERTION` (or "Other") for the license

That is GitHub's license detector, not the license. [`LICENSE`](LICENSE) is the
**verbatim CC BY-NC 4.0 legalcode**, unmodified; the detector cannot fingerprint
the canonical text and therefore declines to assert a license. The repository,
the package manifest (`"license": "CC-BY-NC-4.0"`) and
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) all state CC BY-NC 4.0, and
the license is verified in [`docs/VERIFICATION.md`](docs/VERIFICATION.md).
Nothing here is relicensable: no MIT, Apache-2.0, or BSD terms apply.

### A PDF manuscript is refused

By design, and it is the only format refusal. Phase 1 does not parse PDFs and
runs no OCR, so `academic_review_create` (and `/ars-review`) reject `.pdf` with
`unsupported_format` and a message telling you to extract the text first.
Convert to `.md`, `.tex`, or `.txt` with any tool you already use, then open the
review again. The refusal happens before any state directory is created.

### Why are there five tools?

One tool per state transition, so the model can see exactly what it is allowed
to do next and branch on a machine-readable error code instead of prose:

| Tool | Transition it owns |
| --- | --- |
| `academic_review_create` | pins the manuscript, opens the review and the panel |
| `academic_review_confirm` | human checkpoint 1 only — the single path out of `created` |
| `academic_review_submit` | one immutable seat card per call |
| `academic_review_report` | synthesis, then the approval-gated close |
| `academic_review_status` | read-only summary, including the pending checkpoint |

They are adapters: every validation, schema check and atomic write lives in
`src/state.ts`, which the slash commands drive through the same store.
Splitting them keeps the dangerous operation (`confirm`) separate from the
routine ones, and leaves no single "do everything" call that could skip a gate.

### Why are there two human checkpoints?

Both come from the upstream protocol's iron rules and are enforced in state,
never by prompt text:

1. **After the field analysis, before any seat is dispatched**
   (`field_analysis_attachment` → `panel_confirmation`). The field analyst
   proposes the discipline, paradigm, methodology, tier and maturity plus one
   reviewer configuration card per peer seat. Panel composition is the user's
   call, so `academic_review_confirm(action="confirm")` must record their
   approval; `academic_review_submit` refuses with `panel_not_confirmed`
   until then, and nothing self-confirms.
2. **Before the editorial decision closes the review** (`report_approval`).
   Synthesis writes a draft letter and roadmap; closing requires
   `academic_review_report(approve=true)`, and if the Devil's Advocate raised a
   CRITICAL finding, every such finding must carry an explicit adjudication
   (`da_adjudication_required` otherwise). The plugin never approves its own
   output and a DA-CRITICAL issue cannot be silently bypassed.

## Trademark and endorsement disclaimer

DeepSeek, DSH, and Academic Research Skills are the marks or project names of
their respective owners. This project is an independent, unofficial port; it is
not endorsed by, affiliated with, or sponsored by DeepSeek or by the upstream
author.
