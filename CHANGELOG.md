# Changelog

All notable changes to `dsh-academic-skills` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
The plugin is licensed **CC BY-NC 4.0** (see [`LICENSE`](LICENSE) and
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)); version numbers here never
imply a change of license.

## [0.5.1] - 2026-10-28

Two limits the gate wrote down became guards. **No tool, route, state schema or served
payload changed**: the same five skills, the same payloads (64,541 / 47,984 / 59,934 /
51,753 / 33,212), the same 684-byte block with the same hash, and the same one
853-byte notice. What changed is what can be **checked** — and one number that nothing
here can check, now named as such instead of trusted.

### Added — the verb-count guard walks the repository instead of a list

It used to watch four named documents. The gate showed that was a list and not a net: a
fifth document quoting the counts kept the suite green, and the next one to quote them
would be unchecked until a human remembered. The scan is a filesystem walk, not a git
listing, and it now walks the Markdown files on disk outside a short list of directories —
**29 files on this tree** — and requires every file that quotes a claim to be accounted
for: pinned against a live measurement, or exempt with a file, the claim kinds it covers
and a reason. A file that quotes and is neither
fails; so does an exemption that has gone stale, and so does an exemption asked to cover a
claim kind it never declared. History gets a stance rather than an exclusion: a claim is
history unless it sits in the section whose heading names the version in `package.json`,
and a claim in that section must be pinned. What the scan leaves out is that short list,
each directory named with its reason where the walk is defined rather than restated here:
vendored trees carry their own byte pins, and the rest are tool state rather than published
text. The list lives with the code, so it can move without this paragraph going quietly
wrong. Today's run prints: 29 files scanned, 5 quote a claim — 3 pinned, 3 recorded as
history, 1 exempt with its reason. The count is this tree's, not a constant: if it moves,
the printed number disagrees with this sentence, which is how a stale sentence gets caught
instead of trusted — it caught one here already — and the inventory's claim about how much
of its table the run measures now agrees with what the run prints.

### Fixed — the instrument's loss reads as a decision, in two fixtures

The orchestration instrument's object rule refuses more than the by-role case its
docstring first named. A directive whose **object** is something other than the producer
is refused even when the producer is named on that same line: "Dispatch the stage to
`academic-paper`" fires nothing, and that is not by-role at all — it is the shape a mere
mention wears, which is exactly what the rule exists to refuse. The header now states the
wider class where the other blind spots live, and both halves sit next to each other as
fixtures, so the next reader meets a trade instead of a gap: "Dispatch
`academic-paper`." fires, "Dispatch the stage to `academic-paper`." does not, and the
by-role case below the pair is still inert. The predicate itself was **not** widened —
the change is comment-only, verified line by line (sixteen changed lines, none of them
code) — so every corpus verdict is identical.

- **One more fixed here, and not about the instrument:** `docs/UPSTREAM_INVENTORY.md` said
  the suite "re-measures the 44 vendored rows on every run" while it re-measures every
  vendored byte row in that document and prints the total — 74 when this note was written,
  and the number lives in that printed line rather than here. 44 was the pre-0.5.0 reach,
  the reviewer's 28 and the shared 16, left behind when the pipeline's 30 rows arrived. The
  direction is the part worth recording: it claimed *less* coverage than existed, which is
  why nobody chased it. A number that flatters the tool gets audited; a number that
  understates it sits there.

### Found — one number this repository cannot recompute, exempted by name

The new scan's first run found an unpinned claim that was already in the tree:
`docs/UPSTREAM_INVENTORY.md:110`, the 1,806,561 bytes of upstream scripts the pipeline
calls and this port does not vendor. Nothing in this repository can recompute that
number — it was measured in the upstream clone when the pipeline tree was vendored — so
it is exempted by name with its reason, and for one claim kind only: any other claim
shape on that page still has to be pinned, and the exemption dies the day the sentence
does. That is the honest stance available. The alternatives are to delete the number from
the prose or to vendor the scripts, and both are worse than a named exemption that says
why it exists.

### Not in this release — the net's own limit

Five documents quote that same 1,806,561 in a bare byte-count form the parser does not
match. Extending the net to bare byte counts is a policy decision about five sentences,
not a mechanical widening, and it is not in this release: the scan asserts what it has
checked, never that everything is checked.

## [0.5.0] - 2026-10-28

The fifth and last served skill, a payload that shrank because a problem went
away, and a rename. **The tools and the state schema did not change**: the five
`academic_review_*` tools, their arguments, the review-state schema, both slash
commands and the served skill names are identical to 0.4.1, and existing
`.academic-review/` directories keep loading exactly as they are. **The panel URL
changed**: the route prefix moved with the package name, so the three read-only GET
routes are now under `/plugins/dsh-academic-skills/reviews` — a bookmark, script or
reverse proxy that names the old prefix needs updating, and the browser client's API
root moved with it. And the served text is **not** byte-for-byte what 0.4.1 served.
Two causes, kept apart because merging them would hide one. **The rename is
length-neutral, not byte-neutral:** the write-policy block and the port notice carry
markers that name the package, so the rename rewrote 12 bytes inside each served
payload — 24 in `academic-pipeline`, which carries both — and changed no length at
all, because `dsh-academic-review` and `dsh-academic-skills` are both 19 characters,
which is why the totals that did not move did not move. **Separately**, two port
notices dissolved when the fifth tree supplied the file they named, and for that
reason alone two payloads shrank: `academic-paper` 65,113 → 64,541 and
`deep-research` 52,316 → 51,753 (see *Changed* below). Neither cause is the other —
the rename moved no byte count, and the shrinkage owes nothing to the rename.

### Renamed — the package, the repository, the routes and the tarball

- **Package:** `dsh-academic-skills` (was `dsh-academic-review`), version 0.5.0.
  The directory a checkout sits in may keep its old name; nothing in the package
  depends on it.
- **Repository:** `xuelinzheng41-maker/dsh-academic-review` →
  `xuelinzheng41-maker/dsh-academic-skills`. GitHub redirects the old paths and the
  existing releases (v0.4.0, v0.4.1) are reachable under the new name.
- **Install strings:** `dsh plugin --profile <profile> add
  github:xuelinzheng41-maker/dsh-academic-skills` (optionally `…#v0.5.0`), or the
  release tarball `./dsh-academic-skills-0.5.0.tgz`. The CI badge URL moved with the
  repository.
- **Panel routes:** `/plugins/dsh-academic-skills/reviews`, `…/reviews/<id>` and
  `…/reviews/<id>/report`; the client's API root moved with them.
- **Served text:** the `write-policy` and `port-notice` marker comments inside the
  served block and the served notice were renamed with the package. Same structure,
  same lengths, and nothing else in the served text moved *for this reason* — the two
  payloads that did shrink shrank because a port notice dissolved, which is a different
  cause and is stated at the top of this entry.

**Why now.** The name was written when the plugin served one skill's worth of review.
It now serves five skills, four of which are not the reviewer, so a name that says
"review" understates what is in the box. Doing it in the release that adds the fifth
tree means one upgrade, one re-pin, one explanation.

**What did not change, and this is the whole list:** the plugin id
(`academic-review`, so an existing `cordis.patch.yml` row still resolves), the five
tool names (`academic_review_*`), the two slash commands (`/ars-review`,
`/ars-review-status`), the state directory (`.academic-review/`), the served skill
names (they are upstream's, not this package's) and the licence (CC BY-NC 4.0).
Nothing needs migrating: point the same profile at the new name and the same state
directories load.

**Reading the rest of this file:** entries before 0.5.0 name the package, the
repository and the route prefix as they were at the time. That is what was true then,
and history here is not rewritten.

### Added — `academic-pipeline` (upstream 3.23.2, SKILL.md last_updated 2026-10-24)

- **30 files** (SKILL.md, 5 agents, 20 references, 1 template, 3 examples), served
  prompt-only: no tool, no state, no GUI, no slash command. An **orchestrator** — it
  detects stages, recommends modes, dispatches `deep-research` / `academic-paper` /
  `academic-paper-reviewer` and tracks state; it does not write the paper itself.
- **A third write-record instrument, `orchestration-closure`**: a stage table gives a
  served producer a slot, so a skill that writes nothing dispatches the skill that
  does. `writePolicyBasis` now sits on three of the five skills (paper
  `prose-drafting`, sr-screener `bundled-script`, pipeline
  `orchestration-closure`), and on the reviewer and `deep-research` the key is
  **absent rather than null** — one basis per skill, naming the instrument that
  fired, never a summary of the skill. `academic-pipeline`'s own parsed body carries
  39 writing verbs / 18 drafting verbs, under both thresholds; the suite prints those
  two counts every run and stores them nowhere, which is the point: a near miss is not
  an instrument.

### Changed — the payloads, and one of them got smaller

- `academic-paper` **65,113 → 64,541** (−572) and `deep-research` **52,316 → 51,753**
  (−563): both used to carry a port notice for
  `academic-pipeline/references/literature_corpus_consumers.md`, a file that existed
  only in a skill this port did not vendor. The fifth tree supplies it, so the
  notices are gone and the payloads shrank by exactly the text each no longer needs.
  That is an improvement recorded with its cause, not a shrinking number.
- `academic-pipeline` is the **only** skill served with a port notice today: **853
  bytes**, four dangling targets (`docs/PERFORMANCE.md`, two `docs/design/` specs,
  `scripts/adapters/`). The reviewer (47,984) and `sr-screener` (33,212) are
  unchanged; five payloads total **257,424 bytes**, of which 3,420 are the 684-byte
  write-policy block, five times over.
- Distinct dangling targets across the port: **11 → 9**, all under `docs/`,
  `examples/` or `scripts/`, none in port. The shared scope specifically went
  **11 distinct references over 16 sites → 7 over 9** (5 `docs/design/`, 1
  `examples/`, 1 `scripts/adapters/`, 0 `academic-pipeline/`), and the movement is
  recorded with its cause: it has gone 14 → 11 → 7 because each later tree resolved
  references an earlier one left dangling.

### Vendoring — 342 files

- **199 skill files** (28 + 53 + 63 + 25 + 30) + **143 shared** = 342 (was 279).
- The registry-receipt rule now supplies **nothing extra** (`byScan: 143`,
  `byRegistryReceipt: 0`): `shared/contracts/README.md`, new with the pipeline tree,
  names `shared/review_criteria_sources/`, so the path scan reaches both criteria
  receipts. The rule is still tested with that one mention blanked, and must then
  supply exactly those two files.
- **120 non-Markdown files** (`.json` 109, `.py` 6, `.js` 2, `.tex` 1, `.yaml` 1,
  `.gitkeep` 1). The last is an empty placeholder in the pipeline tree — the case
  that keeps "non-Markdown" from meaning "code", and "payload" from meaning "text".

### The honest edge, recorded in the docs rather than left to be discovered

`academic-pipeline`'s integrity stages call **47 upstream scripts** (36 named directly,
11 imported), **1,806,561 bytes** between them, whose third-party imports include
`jsonschema`, `yaml`, `pypdf` and `defusedxml`. **This port vendors none of them**,
deliberately: shipping 1.8 MB of Python the plugin never executes, cannot audit and
cannot test would be worse than not shipping it. The upstream `scripts/` directory is
642 files and stays out. Consequence, stated plainly in both languages: every stage
that depends on those checks **fails rather than pretends**, and the host must supply
the upstream repository and a Python 3 environment with those packages for those
stages to run at all. This is a stronger statement than `sr-screener`'s, whose six
scripts ship inside its own tree — there, the plugin can say "they are here and I
never run them"; here there is nothing to run.

### The structural lesson

The reachable unit is not the skill, it is the **reference closure**. One new shared
file, `shared/contracts/README.md`, pulled 23 files into view that no skill names.
And vendoring a tree closed dangling references *inside `shared/` files that no skill
owns*: four references this port used to report as missing resolved when the pipeline
arrived, and three of those four are named only from `shared/`.

### Docs

`README.md` and `README.zh-CN.md` now describe five skills, the five payloads and the
two notices that disappeared; `docs/PORT_SPEC.md` gains §1.7 for the unshipped
scripts; `docs/UPSTREAM_INVENTORY.md` carries byte rows for the pipeline tree;
`THIRD_PARTY_NOTICES.md` attributes the fifth tree and the 342-file vendored set.

## [0.4.1] - 2026-10-28

A hardening release. **No tool, route, state schema or served payload changed**: the
five `academic_review_*` tools, their arguments, the review-state schema, the panel's
routes and both slash commands are identical to 0.4.0, the four served skills are the
same vendored bytes, and every served body is byte-for-byte what 0.4.0 served. There
is nothing new to use, which is why neither README gained a feature paragraph: there
is no feature. What changed is what the release gate can see.

### Added — release invariants that survived an adversarial pass

- **Four shapes the guards never parsed are parsed now**, each found by attacking the
  guards rather than by a document failing: a **six-hex pin**, which the old pattern
  missed because it required at least seven characters; an **uppercase hex pin**
  (`1EC249DF`), so a wrong pin in capitals can no longer sit in a document
  indefinitely; an **install line that avoids the word "add"**
  (`dsh plugin install <repo>@0.3.9`), which would have handed a reader a different
  release while the guard stayed green; and an **unbracketed CHANGELOG heading**
  (`## 0.4.0 - 2026-10-27`), which the bracketed-only pattern did not see at all, so
  a section for a release that never existed could have sat above the real one.
- **An install instruction is now defined rather than guessed at:** a line that names
  this package or repository **and** carries a package-manager command. Naming the
  package stops the guard from parsing every sentence containing "install"; the
  command shape stops it from parsing prose that merely mentions the package. The
  deliberate unversioned line at `README.md:435` — `add <repo>`, which installs
  whatever the default branch is — stays legal and is now asserted to remain **seen**
  rather than merely tolerated: a widened matcher that stopped recognising it would
  leave the documents reading correctly while the guard quietly stopped covering a
  line it used to cover.
- **Two rules that fell out of the CHANGELOG widening:** every versioned section must
  carry a release date, because a heading without one is a draft rather than a
  release note; and no two sections may claim the same version, because a duplicate
  means one of them is a stale edit and whichever is read first decides what the file
  says the release contains. The first section must also remain the shipped version
  and the highest one, so an entry inserted below an older heading cannot leave the
  file claiming the older release is current.
- **The commit scan's two masks are proved narrow on every run**, in both directions
  and in any environment: the review-id mask (`rev-YYYYMMDD-<hex>`, which this
  plugin generates itself) and the sha256 mask (a digest quoted beside the word
  "sha256") must not swallow the pinned commit, and must actually mask the shape
  they claim to mask. Both are counted in the pass line, so a mask that stops masking
  anything shows up as a zero instead of disappearing into silence.
- **The fourteen upstream-only script sizes now have a mechanism test that needs no
  clone.** The suite builds a throwaway repository, commits fourteen files of known
  content, nudges one byte of one of them, and requires exactly one problem naming
  that file and both values — so the check is proved able to fail on every machine,
  not assumed to be. When `DSH_UPSTREAM_CLONE` names a clone of the pinned commit,
  all fourteen are verified against that object store; when it is unset the run
  **names every one of the fourteen** as unverified instead of printing a skip,
  because a check that goes quiet where it cannot run is exactly how a documented
  number becomes an assumed one.

### Unchanged

- The four served skills (1.11.1, 2.12.1, 3.3.1, 1.0.0) and their vendored bytes, the
  five tools, the review-state schema, the panel, both slash commands, the shared
  closure, and the CC BY-NC 4.0 terms. 0 of the 279 pins moved.

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
