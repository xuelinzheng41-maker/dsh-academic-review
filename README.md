**English** | [简体中文](README.zh-CN.md)

# dsh-academic-review

[![CI](https://github.com/xuelinzheng41-maker/dsh-academic-review/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/xuelinzheng41-maker/dsh-academic-review/actions/workflows/ci.yml)

> **Scope:** this port serves **four** ARS skills — `academic-paper-reviewer`,
> `deep-research`, `academic-paper` and `sr-screener` — and only the reviewer has
> tools, review state and a GUI panel. The other three are prompt-only:
> `deep-research` is a research pipeline, `academic-paper` a writing pipeline, and
> `sr-screener` a screening pipeline whose usefulness depends on running its own
> bundled Python scripts on your host (`Python 3.9+`; this plugin ships those
> scripts and never runs them). `academic-pipeline` is **not** part of this
> release. Reviewer input is `.md` / `.tex` / `.txt` only: there is no PDF
> parsing and no OCR.
> The plugin's own tools and commands never rewrite your manuscript (see
> [Write policy A](#write-policy-a--new-paths-only)). All four served skills carry
> the same rule as an *instruction* prepended to the body — the same 684 bytes in
> every skill, whether or not it writes. It is not enforcement.

An **unofficial DSH port** of the Academic Research Skills (ARS) skills
`academic-paper-reviewer`, `deep-research` and `academic-paper` for DeepSeek
Harness. It is not affiliated with, sponsored by, or endorsed by the upstream
author or project.

The plugin serves all four vendored upstream skills through one DSH skill
provider. Only the reviewer is wired to plugin code: the review-state tools a
5-seat peer-review panel needs (an immutable per-seat report store, manuscript
SHA-256 pinning, and the two human checkpoints the upstream protocol requires),
plus the read-only panel and two slash commands. `deep-research`,
`academic-paper` and `sr-screener` are served **as-is, with no tools, no state
and no GUI**: `deep-research` runs on the host's own `web_search` /
`web_fetch` and file tools, so its output quality is bounded by what those host
tools can actually reach; `academic-paper` drafts with the same host file tools,
and `sr-screener` writes by running its own bundled Python through the host's
shell — which is why [Write policy A](#write-policy-a--new-paths-only) is
prepended to all four served bodies as text the model is told to follow.

## Attribution and license

- Upstream work: Academic Research Skills, skills `academic-paper-reviewer`
  v1.11.1, `deep-research` v2.12.1 and `academic-paper` v3.3.1 (each SKILL.md
  last_updated 2026-08-15), and `sr-screener` v1.0.0 (SKILL.md last_updated
  2026-09-29), by **Cheng-I Wu**
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

### Skills served (four)

All four trees are vendored unmodified under `vendor/` from the pinned ARS
commit `1ec249df98728682dfbbdfb940a658338bfd6f80`, and all keep their upstream
names. The version column is the `metadata.version` in each vendored `SKILL.md`
frontmatter, read at load time — not a number typed into the plugin.

**Every row carries the write-policy block, and that is deliberate.** A 684-byte
section stating policy A is prepended to the served body of each of the four — the
same 684 bytes four times, not a feature of some rows and not of others — because
we cannot prove that a skill will never write a file. A missing block is the
expensive error; an unneeded one costs a reader 684 bytes — nine non-empty lines of
rule text between its two markers — that change nothing. What differs per row is
everything else: what the plugin adds, and what the skill needs from the host.

| Skill | Upstream version | What this plugin adds | Resource base |
| --- | --- | --- | --- |
| `academic-paper-reviewer` | **1.11.1** (SKILL.md `last_updated` 2026-08-15) | The five `academic_review_*` tools, the review state directory, the read-only GUI panel, and `/ars-review` + `/ars-review-status`. | `vendor/academic-paper-reviewer` |
| `deep-research` | **2.12.1** (SKILL.md `last_updated` 2026-08-15) | No tool, no state, no GUI, no slash command; the upstream body is otherwise loaded verbatim, and it looks things up with the session's own web and file tools. | `vendor/deep-research` |
| `academic-paper` | **3.3.1** (SKILL.md `last_updated` 2026-08-15) | No tool, no state, no GUI, no slash command. Drafts with the session's own file tools; `writePolicyBasis: 'prose-drafting'` records the instrument that measured it as a file producer. | `vendor/academic-paper` |
| `sr-screener` | **1.0.0** (SKILL.md `last_updated` 2026-09-29) | **It needs `Python 3.9+` on the host**: screening works by running its own six bundled scripts, which this plugin ships and pins but never runs, audits or guarantees. No tool, no state, no GUI, no slash command; `writePolicyBasis: 'bundled-script'` records the instrument that measured it. | `vendor/sr-screener` |

The vendored set is **279 files**: 169 skill files (28 + 53 + 63 + 25) plus 110
shared (108 reached by the path scan, 2 vendored by registry receipt because no
vendored Markdown names them). Every pin is a SHA-256 in `vendor-manifest.json`, checked by
`pnpm verify:vendor`.

`deep-research` is a 13-agent research pipeline that expects web search, page
fetching and file tools. This plugin supplies none of them and intercepts
nothing: whatever `web_search` / `web_fetch` / file tools your DSH host already
gives the session are the only means it has to look things up. **Its output
quality is therefore bounded by those host tools** — with no network access the
skill can still reason, but it cannot verify sources.

`academic-paper` is upstream's 12-agent writing pipeline (11 modes, and by far
the largest vendored tree: **63 files** — 12 `agents/`, 29 `references/`, 11
`templates/`, 10 `examples/` and its `SKILL.md`, 65,335 repository bytes). It was
the first vendored skill that instructs the model to write files — 85 writing
verbs and 46 drafting verbs in its own body — which is why the record in
`src/write-policy.ts` lists it as a **demonstrated** file producer by **prose
drafting**. The record explains how we know, and does not decide who gets the block.

`sr-screener` is upstream's protocol-driven screening pipeline for systematic,
scoping and rapid reviews (8 modes, **25 files**: six Python scripts under
`scripts/`, two `.js` workflow templates and one `.json` template under
`templates/`, one example `.json` under `examples/`, and its `SKILL.md`, 33,843
repository bytes). It is the second **demonstrated** producer, by a **different
mechanism**: its body tells the model to run its own bundled scripts with an output
argument, so the record lists it by **bundled-script execution** rather than by
drafting vocabulary. It shows no prose signal at all, and that is measurable:
`sr-screener` carries 24 writing verbs and 3 drafting verbs, both under the
thresholds of 40 and 20, so the drafting instrument never fires for it.

**Two skills are *demonstrated* producers, by two different mechanisms.**
`academic-paper` drafts documents; `sr-screener` writes by running its own
scripts. That is the record, not the gate: all four served bodies carry the
identical 684-byte block, `writePolicy: 'new-paths-only'` and
`writePolicyEnforced: false` sit in the metadata of all four, and
`writePolicyBasis` — the instrument that *measured* this one — is present on these
two only.

The `.tex` and the ten new payload files are the same proof twice.
`academic-paper`'s tree holds
`templates/latex_article_template.tex` (4,844 B) — the only non-Markdown file in
the three skill trees this port vendored before `sr-screener`, and the first
non-Markdown payload it ever shipped. `sr-screener`'s tree now holds ten of its
own (six `.py`, two `.js`, two `.json`), and the package carries **89**
non-Markdown files in all (`.json` 79, `.py` 6, `.js` 2, `.tex` 1,
`.yaml` 1), each pinned from the git object store rather than from a checkout.
The `.tex` proved the vendoring pipeline is extension-agnostic; the ten prove it
again.

What they do **not** get is as important as what they do: no tool, no review
state, no GUI panel, no slash command — their modes are modes of their own
prompts, not of this plugin. What they **do** depend on is the host:
`academic-paper` drafts with the session's own file tools and looks things up
with whatever web tools exist; `sr-screener` screens by running its own bundled
Python through the session's shell, so **without Python 3.9+ on the host that part
of the skill does not work at all** — and it fails visibly, the command erroring,
rather than quietly returning something that looks like a screen.

### What this port does not ship — the port notice

A served skill is upstream text, and upstream text sometimes tells the agent to
open a file that lives in a *different* ARS skill. This port cannot ship those,
so it says so. When a served skill's **own** instructions name a file this
package does not contain, the provider appends a delimited block to the served
body — runtime text only, the vendored files themselves are never edited — and
carries the full list in `metadata.unavailableReferences` /
`metadata.unavailableReferenceCount`. The model is told, in the notice, not to
fabricate the missing content.

Today **two** own-tree cases exist, in two of the four skills, and both name the
same file:
`deep-research/agents/bibliography_agent.md` and
`academic-paper/agents/literature_strategist_agent.md` point at
`academic-pipeline/references/literature_corpus_consumers.md`, an upstream skill
this port does not vendor. The reviewer's own tree is clean and so is
`sr-screener`'s, so neither of those receives a notice: carrying the block and
carrying a notice are independent facts about a skill. This is the block you will see appended to the
`deep-research` body (the `academic-paper` one differs only in the `named by`
path), verbatim:

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
which *all four* served skills read — contain **11 distinct references** (16
reference sites) to upstream areas this port does not vendor: 4 under
`academic-pipeline/`, 5 under `docs/design/`, 1 under `examples/` and 1 under
`scripts/adapters/`. Those are surfaced in skill **metadata only**
(`metadata.unavailableSharedReferences` /
`metadata.unavailableSharedReferenceCount`), and deliberately **not** appended to
the skill body: `shared/` is reached identically by every served skill, so a body
notice derived from it would fire on the reviewer too and would change the
reviewer's served bytes.

That list is **computed, not maintained**, and the computation shows it moving:
vendoring `academic-paper` took it from 14 distinct targets down to 11, because
the three targets that used to dangle under `academic-paper/` now resolve inside
the vendored tree. A hand-written list would still say 14.

Two different shared counts appear in this port, and they measure different things.
The package **holds 110 shared files** (108 reached by scanning the vendored
trees, plus 2 vendored on a criteria-registry citation alone), while the four skill
trees **collectively reach 98 distinct shared targets** — the extra files are the
shared-to-shared closure those 98 pull in, which is why the two numbers differ by
12 and neither is wrong. `sr-screener` adds nothing to either: it names five
`shared/` paths directly and reaches 74 of them once those files' own references
are followed, and every one of the 74 was already in the closure through the older
trees.

The walk reads **Markdown only**, and that is load-bearing rather than convenient:
16 of the 89 payload files contain 49 reference-shaped strings, 27 of which would
dangle if the walk read them. A path inside a Python docstring or a JSON-schema
string is data a program consumes, not an instruction telling the agent to open a
file in this port — so `pnpm test` reads 190 Markdown files and 0 payload files,
and the in-port-dangling count stays a meaningful zero.

Say it plainly: **`deep-research` and `academic-paper` inherit upstream
cross-skill references that this port cannot satisfy.** Both are served
faithfully, minus those targets. A later round either vendors the referenced
skills (`academic-pipeline`) or extends the notice to cover the `shared/` scope;
until then, the metadata is the complete record of what is missing and the notice
is the in-conversation warning.

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

Out of scope for this release: the `academic-pipeline` and `sr-screener`
skills, and the `re-review` / `guided` / `calibration` review modes (refused
explicitly, with no silent fallback).

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

The plugin never writes to the manuscript, and every tool call re-verifies the
pinned SHA-256 (`paper_changed` on drift); a finding without an evidence quote
plus location is refused; a seat may not claim peer-output visibility; PDF input
is rejected rather than parsed. Those are guarantees of plugin code. The
write-new-paths rule inside a *served skill* is an instruction to the model, not
one of these guarantees — see [Write policy A](#write-policy-a--new-paths-only).

### Hard limits

- **Input formats**: `.md`, `.tex`, and `.txt` only. PDF is **not** parsed —
  `academic_review_create` rejects it outright. Convert first if needed.
- **Read-only manuscript**: the plugin never writes to the paper under review.
- **Tooling is reviewer-only**: `deep-research`, `academic-paper` and
  `sr-screener` are served as prompt-only skills (no tools, no state, no GUI);
  there is no pipeline integration, and no re-review/guided/calibration review
  modes in this release.
- **Every skill is instructed, none is sandboxed**: `academic-paper` writes with
  the host's own file tools, `sr-screener` writes by running its own bundled
  scripts — and the reviewer and `deep-research` may write with the session's own
  tools too. This plugin cannot intercept any of those paths, so policy A reaches
  all four as prepended text plus `writePolicyEnforced: false` in metadata, never
  as an interlock. A skill we cannot show writes is not denied the rule; it is
  given the same 684 bytes.
- **The detector is documentation, not a gate**: `src/write-policy.ts` still names
  the skills it can *demonstrate* write files, and by which instrument, because
  that is a useful answer — but nothing is served or refused on that basis. Its
  blind spots are documented rather than hidden: a body that writes through shell
  commands it does not ship, through inline `python -c`, or through prose that says
  "generate" or "produce" scores as a non-producer and still receives the block.
- **Bundled code is shipped, not executed**: the six Python scripts ship verbatim
  and SHA-256-pinned; this plugin never runs them, never audits what they do and
  cannot see what they write. Screening needs `Python 3.9+` (standard library
  only; `openpyxl` optional) on the host, and the host's shell is what would run
  them. Without a Python toolchain, that part of the skill does not work at all.
- **Two human checkpoints**: before the panel starts and before the final
  editorial decision closes the review.

## Write policy A — new paths only

**This is a hard product rule, not a default, and no configuration, mode or
prompt can relax it.**

**Enforced or only instructed — read this before quoting the rule.** The part this
plugin owns, it enforces: the five `academic_review_*` tools and the two slash
commands write new paths only and refuse an existing one. The part a *skill* does
is prompt text, and this port cannot technically prevent the host's file tools
from overwriting a path: it never sees those calls, so it cannot intercept, block
or undo a write, and there is no sandbox around the writing skill.

For every served skill the rule is therefore delivered as the **first block of the
served text** — the same 684-byte block prepended to each of the four bodies,
before any drafting instruction or any command line — and mirrored in metadata as
`writePolicy: 'new-paths-only'` and `writePolicyEnforced: false` on all four, with
`writePolicyBasis` on the two an instrument measured. That is an instruction the
model is told to follow, **not an interlock**; the metadata says so
machine-readably so nobody can quote `writePolicy` as enforcement. Treat it as a
strong instruction with a visible audit trail in the served payload, never as a
runtime guarantee.

**Why the reviewer, which writes nothing, carries the rule anyway.** Because we
cannot prove a negative about a prompt. No measurement can show a skill will never
produce a file: the model may write through the host's tools, run a command, or use
a verb our detector does not know. The two failure directions are not symmetric —
a missing block loses the policy at exactly the moment a skill writes, while an
unneeded block costs 684 bytes of harmless instruction — so we stopped gating and
started attaching.

**The block is attached, not selected.** `renderWritePolicyBlock()` in
`src/write-policy.ts` takes **no parameter at all** — arity zero — and does not
consult the file-producing table, so there is no input by which a skill could be
left out and no path that omits it: a skill cannot be served without the block.
That is a statement about the signature, not about our intentions, which is why it
is worth having; a signature cannot forget. `tests/write-policy.test.mjs` proves
it the only way a guarantee can be proven — it calls the renderer with a skill name
that appears in **no** table and asserts the full 684 bytes still come back.

**Two instruments, kept as evidence — they are not the gate.** The table in
`src/write-policy.ts` records which skills we can *demonstrate* produce files, and
by which of two measured instruments: **prose drafting** — writing verbs at or
above 40 **and** drafting verbs at or above 20 — or **bundled-script execution** —
one line carrying an interpreter, an executable this package actually ships inside
*that skill's own* directory (resolved on disk, not in the text), and an output
argument. `academic-paper` is demonstrated the first way
(`writePolicyBasis: 'prose-drafting'`), `sr-screener` the second
(`'bundled-script'`); the reviewer and `deep-research` are demonstrated by
neither, and receive the block anyway.

Three write shapes that qa-gate built adversarially are now fixtures in
`tests/write-policy.test.mjs` — a skill that writes with shell commands it does not
ship (`mkdir -p exports && ls > out/inventory.md`), one that writes through inline
`python -c`, and one whose prose says "generate the deliverable" — and all three
score as non-producers while still being served the block. That is the whole reason
the serving rule stopped consulting the table: the table's both-directions check
proves the record matches the detector, never that the detector is right. When the
detector misses a skill, the detector and the table agree that it does not produce
files, and the test passes on a shared blind spot. Absence from the table means "we
could not show that it writes", never "it does not write".

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
3. **All four served skills follow the same rule.** None of them has a write tool
   of its own, and none of them can be constrained by one: `academic-paper` writes
   through the host's file tools, `sr-screener` by running its own scripts, and the
   reviewer and `deep-research` with whatever the session gives them. Anything a
   run produces (a paper draft, a screen, a report, notes, a bibliography) goes to a
   new path, and everything a skill reads — the manuscript included — stays
   read-only. In every case the rule is instruction rather than interlock, which is
   why the block is on all four bodies and why the transcript is where to check it.
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
dsh plugin --profile <profile> add github:xuelinzheng41-maker/dsh-academic-review#v0.4.0
dsh plugin --profile <profile> add ./dsh-academic-review-0.4.0.tgz
```

The build output (`lib/`) is committed on purpose, so a git install needs no
build step. The bundle patch `cordis.patch.yml` inserts one plugin row
(`id: academic-review`, `name: dsh-academic-review`) configured with
`stateDir: .academic-review`.

After installing, the session gains five `academic_review_*` tools and **four**
skills — `academic-paper-reviewer`, `deep-research`, `academic-paper` and
`sr-screener` (see `docs/PORT_SPEC.md`). A review writes to
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

### 0.3.0 → 0.4.0

0.4.0 adds the fourth served skill. **No tool, route or state schema changed**: the
five tools, their arguments, the review-state schema, the panel routes and both
slash commands are identical to 0.3.0, so `.academic-review/` directories keep
loading.

- **New:** the vendored `sr-screener` skill (upstream **1.0.0**), served
  prompt-only — no tools, no state, no GUI, no slash command. It is the first
  skill whose usefulness depends on running its own bundled code: six Python
  scripts, `Python 3.9+`, standard library only, `openpyxl` optional. This
  plugin ships and pins those scripts and never runs or audits them; the host's
  shell is what would run them, and without a Python toolchain that part of the
  skill does not work at all.
- **Write policy A is now served to every skill, unconditionally.** The block
  (684 bytes, grown from 549 by the bullet naming script-written artifacts: the
  `--out` target, the work directory, the log and the workbook) is attached to all
  four served bodies, not selected for some, because we cannot prove a skill never
  writes. The detector and its two instruments survive as documentation —
  `academic-paper` demonstrated by prose drafting, `sr-screener` by bundled-script
  execution, and `writePolicyBasis` in metadata on those two only — and no longer
  gate serving. This is the round that removed the conditional: the reviewer and
  `deep-research` go from 47,300 to 47,984 and 51,632 to 52,316 served bytes, which
  is the one block, once.
- **Vendoring:** 279 files (was 254) — 169 skill files (28 + 53 + 63 + 25) + 110
  shared (108 by scan + 2 by registry receipt). The package now holds 89
  non-Markdown files (`.json` 79, `.py` 6, `.js` 2, `.tex` 1, `.yaml` 1),
  all pinned from the git object store; `sr-screener` contributes ten of them.
  Shared did not move: the four trees reach 98 distinct shared targets and the
  fourth adds none.
- **Unchanged:** the reviewer skill (1.11.1), `deep-research` (2.12.1),
  `academic-paper` (3.3.1), five tools, review state, panel, both slash commands,
  the shared closure, CC BY-NC 4.0 terms.

To upgrade, replace the package with the 0.4.0 build from the same source and
restart the session.

### 0.2.0 → 0.3.0

0.3.0 adds the third served skill. **No tool, route or state schema changed**: the
five tools, their arguments, the review-state schema, the panel routes and both
slash commands are identical to 0.2.0, so `.academic-review/` directories keep
loading.

- **New:** the vendored `academic-paper` skill (upstream **3.3.1**), served
  prompt-only — no tools, no state, no GUI, no slash command. It drafts with the
  host's own file tools and looks things up with whatever web tools the host
  gives the session.
- **Write policy A travels with it:** the rule is the **first block of the served
  text** (549 bytes prepended), mirrored as `writePolicy: 'new-paths-only'` with
  `writePolicyEnforced: false`. This port cannot technically stop the host's file
  tools from overwriting a path, so it is an instruction, not an interlock.
- **Vendoring:** 254 files (was 181) — 144 skill files (28 + 53 + 63) + 110 shared
  (108 by scan + 2 by registry receipt), including the port's only non-Markdown
  file, `academic-paper/templates/latex_article_template.tex` (4,844 B). The
  disclosure list shrank from 14 distinct unvendored targets to 11 as the three
  `academic-paper/` targets started resolving.
- **Unchanged:** the reviewer skill (1.11.1), `deep-research` (2.12.1), five
  tools, review state, panel, both slash commands, CC BY-NC 4.0 terms.

To upgrade, replace the package with the 0.3.0 build from the same source and
restart the session.

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
  paths only; the plugin's own tools never overwrite, move or delete the
  manuscript.

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
