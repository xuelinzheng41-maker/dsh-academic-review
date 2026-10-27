# DSH Port Spec — dsh-academic-review (0.3.0: reviewer surface + two prompt-only skills)

Status: draft for T2/T3 implementation · Prepared by T1 · Target plugin: `dsh-academic-review`

This is an **unofficial DSH port** of the `academic-paper-reviewer` skill from
Academic Research Skills (ARS) by Cheng-I Wu. Upstream: version 1.11.1 of the
skill, vendored from ARS repository
https://github.com/Imbad0202/academic-research-skills at pinned commit
`1ec249df98728682dfbbdfb940a658338bfd6f80`. Upstream skill metadata:
`version: 1.11.1`, `last_updated: 2026-08-15`. (The repo-level plugin.json
at that commit says 3.23.2; the skill-local version is authoritative for the
reviewer skill.) License: **CC BY-NC 4.0** — see `THIRD_PARTY_NOTICES.md`
and section 5 below.

Served set (0.3.0): `academic-paper-reviewer` (1.11.1) is the only skill wired
to plugin code — tools, review state, panel, slash commands. `deep-research`
(2.12.1) and `academic-paper` (3.3.1) are vendored and served prompt-only: no
tool, no state, no panel. `academic-pipeline` and `sr-screener` remain **out of
scope** and must not be started.

---

## 1. Inventory and dependency map

### 1.1 What the reviewer skill is

ARS `academic-paper-reviewer` is a prompt-only "agent team" (no runtime code of
its own; orchestration is Claude-Code-style subagent dispatch plus advisory
Python checker scripts in the repo `scripts/` directory). It simulates a 5-seat
journal peer-review panel plus a field-analysis pre-pass and an editorial
synthesis pass:

- **Phase 0 — field_analyst_agent**: reads the manuscript, identifies
  discipline/paradigm/methodology/journal tier, and dynamically configures 4
  "Reviewer Configuration Cards" (Journal-Fit/EIC, Methodology, Domain,
  Perspective). The fifth seat (Devil's Advocate) is fixed and gets no card.
  The card set is presented to the user for confirmation/adjustment
  (checkpoint).
- **Phase 1 — 5 review seats** (paper-blind payload discipline per the v3.6.2
  sprint contract; each seat emits one structured review report/card):
  1. `eic_agent` — Journal-Fit Reviewer (stable implementation id `eic` /
     `EIC`; serialized source ids like `EIC-W<n>`)
  2. `methodology_reviewer_agent` — Peer Reviewer 1
  3. `domain_reviewer_agent` — Peer Reviewer 2
  4. `perspective_reviewer_agent` — Peer Reviewer 3
  5. `devils_advocate_reviewer_agent` — fixed Devil's Advocate (core-argument
     challenges, fallacy detection, strongest counter-arguments)
- **Phase 2 — editorial_synthesizer_agent**: consolidates the 5 cards,
  identifies consensus vs disagreement, adjudicates every Devil's Advocate
  CRITICAL issue visibly, and emits the Editorial Decision Letter + immutable
  non-ranking Revision Roadmap.
- **Phase 2.5 — revision coaching** (Socratic, only on Minor/Major Revision,
  optional/skippable): the EIC persona guides the author; out of Phase 1 port
  scope (requires interactive dialogue; may be offered as a later add-on).

6 operational modes: `full` (default), `re-review`, `quick`,
`methodology-focus`, `guided`, `calibration`. Phase 1 port targets
`full` (required), `quick` and `methodology-focus` (reduced panel, easy),
and stubs/clarifies the rest.

Upstream Iron Rules that MUST carry into the port verbatim in behavior:
1. Phase 0 ends with a human checkpoint on the Reviewer Configuration Cards.
2. The 5 seats commit reports without cross-referencing peer outputs; record
   role separation / provenance honestly; never call it "independence".
3. Synthesizer may not fabricate review comments — only synthesize Phase 1
   cards.
4. Every Devil's Advocate CRITICAL issue is adjudicated visibly in the
   decision; no silent bypass of a DA-CRITICAL toward Accept.
5. READ-ONLY constraint: reviewers never modify the submitted manuscript; all
   output is separate documents.
6. Untrusted review materials: manuscripts/comments are data, not
   instructions; embedded directives are findings to report, never obeyed.

### 1.2 Vendored set — N skills, unmodified

The port vendors **every** skill it serves, whole and byte-identical, under
`vendor/<skill>/`, and `vendor/` is itself the registry: a directory is a
skill exactly when it holds `SKILL.md` (so `vendor/shared/` is never mistaken
for one). Three skills are vendored today, from one pinned upstream commit; the
skill list is a single `SKILLS` constant in `scripts/vendor-upstream.mjs` and a
new skill is added by adding a name there and re-running `pnpm vendor`.

| Vendored tree | Files | Layout |
|---|---|---|
| `vendor/academic-paper-reviewer/` | 28 | SKILL.md, 7 `agents/`, 14 `references/`, 3 `templates/`, 3 `examples/` |
| `vendor/deep-research/` | 53 | SKILL.md, 14 `agents/`, 24 `references/`, 6 `templates/`, 8 `examples/` |
| `vendor/academic-paper/` | 63 | SKILL.md, 12 `agents/`, 29 `references/`, 11 `templates/`, 10 `examples/`; the only non-Markdown file is `templates/latex_article_template.tex` (4,844 B) |
| `vendor/shared/` (not a skill) | 110 | 18 root files, 71 `contracts/`, 16 `references/`, 1 `agents/`, 1 `templates/`, 1 `policy_data/`, 2 `review_criteria_sources/` |
| **total** | **254** | every hash pinned in `vendor-manifest.json` (144 skill files + 110 shared) |

File-by-file sizes for the reviewer tree are in `docs/UPSTREAM_INVENTORY.md`;
the `deep-research` tree is inventoried by `vendor-manifest.json` (one SHA-256
per file). Do not edit vendored content; DSH-specific adaptation lives in the
plugin layer (see §2).

`deep-research` is upstream's 13-agent research pipeline (8 modes: full
research, quick brief, paper review, lit-review, fact-check, three-way
literature scan, Socratic guided dialogue, systematic review) and expects web
search, page fetching and file tools. This port registers **no tool for it**:
it is served as a prompt-only skill on the session's own `web_search` /
`web_fetch` / file tools, so its reach — and therefore its output quality — is
bounded by what the host provides, and there is no review state, no panel and
no slash command behind it.

`academic-paper` is upstream's 12-agent writing pipeline (11 modes, version
**3.3.1**, SKILL.md `last_updated` 2026-08-15, **63 files**, SKILL.md 65,335
repository bytes). It is the first vendored skill that *instructs the model to
write files* — 85 writing verbs and 46 drafting verbs in its own body, against 24
/ 4 for the reviewer and 18 / 4 for `deep-research` — so it is the one entry in
`src/write-policy.ts`'s `FILE_PRODUCING_SKILLS` table. Policy A is **prepended**
to its served body (549 bytes) so the rule is read before the drafting
instructions, and mirrored in metadata as `writePolicy: 'new-paths-only'` plus
`writePolicyEnforced: false`; those two metadata keys appear on this skill only.
The vendored tree is also the only one holding a non-Markdown file,
`templates/latex_article_template.tex`, pinned byte-for-byte from the upstream git
object (4,844 B; the CRLF worktree copy would have been 5,043 B and wrong).

**Served-body port notice (commit 4c84ffb).** A served skill is upstream text,
and upstream text can name a file that lives in another ARS skill this port does
not vendor. The provider therefore scans each served skill's *own* tree at load
time (`src/references.ts`) and, when something it names is absent, appends a
delimited block to the served body between
`<!-- dsh-academic-review:port-notice:begin (not upstream text) -->` and
`<!-- dsh-academic-review:port-notice:end -->`, listing at most 6 targets and
instructing the model not to fabricate or paraphrase the missing content. The
vendored files are never edited; the notice is runtime text only. The full list
always travels in `metadata.unavailableReferences` (+
`unavailableReferenceCount`).

Today two own-tree misses exist, one per prompt-only skill, and they name the
same file: `deep-research/agents/bibliography_agent.md` and
`academic-paper/agents/literature_strategist_agent.md` both point at
`academic-pipeline/references/literature_corpus_consumers.md`. Per-skill
`metadata.unavailableReferenceCount` today: reviewer **0**, `deep-research`
**1**, `academic-paper` **1** — the reviewer's own tree is clean, so the reviewer
never receives a notice.

**Scope 2 — the shared closure — is metadata-only.** `vendor/shared/` is reached
identically by every served skill and contains **11 distinct references** (16
reference sites) to unvendored upstream areas (4 `academic-pipeline/`, 5
`docs/design/`, 1 `examples/`, 1 `scripts/adapters/`). A body notice derived from
that scope would fire on every skill and would change the reviewer's served
bytes, so those misses are reported in
`metadata.unavailableSharedReferences` (+ `unavailableSharedReferenceCount`) and
**not** appended to any body.

The count moved when `academic-paper` was vendored: **14 distinct targets before,
11 now**, because the three targets that used to dangle under `academic-paper/`
now resolve inside the vendored tree. That drop is the evidence that the list is
*computed* — a hand-maintained list would still say 14.

Consequence, stated plainly: `deep-research` and `academic-paper` inherit
upstream cross-skill references this port cannot satisfy; a later round either
vendors `academic-pipeline` or extends the notice to the shared scope
deliberately.

**`vendor-manifest.json` schemaVersion 2** is the single source of truth for
what is vendored and what the pins are:

```jsonc
{
  "schemaVersion": 2,
  "upstream": { "skill": "academic-paper-reviewer", "skillVersion": "1.11.1",
                "repository": "…", "commit": "1ec249df…", "author": "Cheng-I Wu",
                "license": "CC BY-NC 4.0" },   // repository-level pin
  "vendored": {
    "skillDir": "vendor",
    "skills": ["academic-paper-reviewer", "deep-research", "academic-paper"],
    "skillFileCounts": { "academic-paper-reviewer": 28, "deep-research": 53,
                         "academic-paper": 63 },
    "skillFileCount": 144,
    "sharedFileCount": 110,
    "sharedFileCounts": { "byScan": 108, "byRegistryReceipt": 2 },
    "totalFileCount": 254
  },
  "skills": [ { "name": "…", "dir": "vendor/…", "fileCount": 28 }, … 3 entries ],
  "sharedFiles": [ "shared/…", … 110 entries ],
  "sharedViaRegistryReceipts": [ { "file": "shared/review_criteria_sources/…",
                                   "criterionIds": [ … ] }, … ],
  "files": { "<skill-or-shared>/<path>": "<sha256 of the repository blob>", … 254 }
}
```

- `files` stays authoritative: exactly one entry per vendored file, hashed from
  the upstream object store at the pinned commit (not from a checkout — see
  `docs/VERIFICATION.md` §16). `pnpm verify:vendor` fails on a modified,
  missing **or extra** file.
- `skills` / `vendored.skillFileCounts` describe the served set, and the
  per-skill file count must equal the number of `files` entries under that
  skill's directory.
- `sharedFiles` is **computed**, not hand-listed (§1.3).
- `sharedViaRegistryReceipts` names the two
  `shared/review_criteria_sources/*.json` files that no vendored Markdown
  mentions but that `shared/review_criteria_registry.json` cites by criterion
  id; they are vendored by receipt and counted separately
  (`sharedFileCounts.byRegistryReceipt`).
- Nothing in `src/` parses this layout: the plugin reads only the repository
  pin and the counts, and the skill metadata comes from each vendored
  `SKILL.md` frontmatter at discovery time.

### 1.3 `shared/` dependency map

These upstream `shared/` files are actually referenced by the reviewer tree
(grep-verified) and must be vendored unmodified, preserving relative path
`vendor/shared/...` so vendored links still resolve:

| Referenced by | shared/ path | Size |
|---|---|---|
| SKILL.md, field_analyst, editorial_synthesizer | `shared/ground_truth_isolation_pattern.md` | 16.6 KB |
| SKILL.md | `shared/references/routing_core.md` | 5.2 KB |
| SKILL.md | `shared/references/intent_clarification_protocol.md` | 11.7 KB |
| SKILL.md | `shared/mode_spectrum.md` | 5.4 KB |
| SKILL.md | `shared/model_tiering.md` | 12.9 KB |
| SKILL.md | `shared/sprint_contract.schema.json` | 19.9 KB |
| SKILL.md | `shared/contracts/reviewer/full.json` | 3.9 KB |
| SKILL.md | `shared/contracts/reviewer/methodology_focus.json` | 2.3 KB |
| SKILL.md, re_review protocol | `shared/contracts/re_review/` (5 current + `legacy/v1_0/` 4) | 39.5 KB traceability + rest |
| SKILL.md, editorial_synthesizer, re_review | `shared/contracts/revision/revision_roadmap.schema.json` | 11.8 KB |
| SKILL.md, devils_advocate, calibration protocol | `shared/cross_model_verification.md` | 86 KB |
| SKILL.md | `shared/references/review_criteria_consumer_protocol.md` | 10.1 KB |
| editorial_synthesizer | `shared/contracts/reviewer/review_panel_provenance_carrier.schema.json` | 4.3 KB |
| review_panel_provenance protocol, SKILL.md | `shared/contracts/reviewer/review_panel_provenance{,_input}.schema.json` | 12.0 KB |
| eic/DA/… agents, handoff refs | `shared/handoff_schemas.md` | 99.7 KB |

Transitive dependencies referenced by the review-criteria consumer protocol
(#684), needed if target-criteria binding is exercised:
`shared/contracts/review_target/*` (7 schemas) +
`shared/review_criteria_registry.json` +
`shared/review_criteria_sources/*.json`. T3 may defer the #684 binding
feature but should vendor these files if referenced paths are kept intact;
otherwise the adapter (§4) declares `criteria_binding_unavailable` exactly
as upstream does without a resolved binding.

**Decision rule — computed, not hand-listed (schemaVersion 2):** the vendoring
script no longer carries a fixed list. `computeSharedClosure()` scans every
vendored file of **every** skill for `shared/…` mentions (Markdown links, code
spans, bare prose), expands a directory reference to the files it holds
(recursively), ignores template placeholders such as
`shared/contracts/<domain>/<mode>.json` and the bare token `shared/`, lets a
file inside `shared/` name siblings relative to itself and to `shared/`, and
iterates to a fixpoint. A target that does not exist upstream is collected and
the run throws with the full list **before anything is written**. Result today:
108 files by scan + 2 by registry receipt = 110 under `vendor/shared/`; the table
above records the reviewer's share of that closure. The closure grew by 10 when
`academic-paper` joined (98 → 108 by scan), and 13 of the 110 are reachable
through that skill alone. (Upstream `shared/` has 155
files; most belong to other skills and are NOT vendored.)

### 1.4 `scripts/` dependency map (advisory checkers)

The reviewer tree references these repo-root Python scripts. They are CI /
advisory verifiers, not runtime requirements of the review flow:

- `scripts/check_panel_synthesis.py` (gate before decision-letter attachments)
- `scripts/check_acronyms.py`, `scripts/verify_panel_recommendations.py`,
  `scripts/audit_panel_claims.py` (three advisory letter attachments)
- `scripts/check_pipeline_integrity.py`, `scripts/check_phase_conformance.py`,
  `scripts/check_sprint_contract.py`, `scripts/check_reviewer_sprint_prompt_sync.py`,
  `scripts/check_re_review_synthesis.py`, `scripts/review_panel_provenance.py`,
  `scripts/revision_roadmap.py`, `scripts/ars_write_scope_guard.py`,
  `scripts/recompute_receipts.py`, `scripts/review_criteria_binding.py`

Phase 1 port: vendor the attachment scripts (`check_acronyms.py`,
`verify_panel_recommendations.py`, `audit_panel_claims.py`) and
`check_panel_synthesis.py` if feasible; otherwise the adapter reports "the
check did not run", which upstream itself defines as a valid outcome. The
others (`academic-pipeline` hooks, write-scope guards) map to DSH-native
mechanisms (§2) and need not be ported in Phase 1.

### 1.5 What must NOT be vendored

Skills this port does not serve (`academic-pipeline/`, `sr-screener/`), and the
upstream repository's non-skill trees `commands/`, `evals/`, `tests/`,
`audits/`, `.github/`, `.claude/`.

`deep-research/` **is** vendored (§1.2) — the reviewer's Phase 2.5 coaching
references `deep-research/agents/socratic_mentor_agent.md` for its L5 question
texts, and that file ships inside the fully vendored tree, so the reference
resolves. Phase 2.5 coaching itself remains unimplemented: the reference
resolving is not the feature.

`academic-paper/` **is** vendored too (§1.2), as of 0.3.0. Nothing in the plugin
calls into it: it is served as a prompt-only skill, its own references resolve
inside the vendored tree, and the one place this port had to touch its served
output is policy A, which is prepended text plus metadata — not an edit to the
vendored files.

---

## 2. DSH mapping

### 2.1 Seat → subagent mapping

| Upstream agent | DSH subagent prompt id | Phase | Input | Output |
|---|---|---|---|---|
| `field_analyst_agent` | `field-analyst` (pre-pass) | 0 | paper text, mode | 4 Reviewer Configuration Cards (JSON + human-readable) → **user checkpoint** |
| `eic_agent` | `seat-eic` | 1 | paper-blind payload + card #1 + role marker `EIC` | EIC review card |
| `methodology_reviewer_agent` | `seat-methodology` | 1 | payload + card #2 + marker `R1` | methodology card |
| `domain_reviewer_agent` | `seat-domain` | 1 | payload + card #3 + marker `R2` | domain card |
| `perspective_reviewer_agent` | `seat-perspective` | 1 | payload + card #4 + marker `R3` | perspective card |
| `devils_advocate_reviewer_agent` | `seat-da` (fixed, no card) | 1 | payload + marker `DA` | DA card |
| `editorial_synthesizer_agent` | `editorial-synthesizer` (final pass) | 2 | 5 committed cards + manuscript + provenance | Decision Letter + Revision Roadmap |

Each subagent prompt = DSH prompt wrapper (dispatch instructions, tool policy,
output contract) + the **unmodified vendored agent .md file** included as the
persona/protocol body. The wrapper states: read-only file policy for seats,
the seat's role marker, and the instruction-data-boundary rule (vendored text
already contains it; wrapper repeats it as a hard rule).

### 2.2 How DSH tools are invoked

- The plugin's main skill command (e.g. `dsh-academic-review`) runs in the
  session; it uses the review-state tools (§3) to persist state between calls.
- **field_analyst pre-pass**: the session calls the `field-analyst` subagent
  with the paper path and mode. Result (4 cards) is stored via
  `academic_review_create` / state update and presented to the user. Review
  cannot proceed to Phase 1 until the user confirms or edits the cards
  (`academic_review_status` shows `awaiting_panel_confirmation`).
- **Phase 1 seats**: dispatched as DSH `subagent` calls, one per seat, with
  **no peer card visibility** (iron rule #2): each receives only the paper
  payload, its own configuration card, and its marker. Panel provenance
  (invocation-context freshness, peer-output visibility = none, model family,
  provider, human operator) is recorded per the vendored
  `review_panel_provenance` contract.
- **Phase 2 synthesizer**: dispatched with the five committed cards (read
  from review-state), the manuscript, and the provenance artifact. It runs
  only after all five seats are `submitted`.
- `agent_teams` is NOT used for the panel itself in Phase 1 (seats are
  stateless prompt dispatches, not long-lived teammates); the plugin MAY use
  `agent_teams` only for later multi-phase orchestration. DSH file sandbox:
  seats get read access to the workspace and the manuscript; write access is
  restricted to the review-state directory via tool calls, never direct file
  writes by seats.
- Modes: `full` = all 6 dispatches; `quick` = field-analyst + seat-eic only;
  `methodology-focus` = field-analyst + seat-eic + seat-methodology;
  `guided`/`re-review`/`calibration` return a clear "not implemented in
  Phase 1" message in Phase 1 (documented, non-silent).

---

## 3. Review-state JSON schema and tool API

State root (canonical for every task): `<workspace>/.academic-review/<review_id>/state.json`,
with per-seat outputs at `seats/<seat_id>.json` + `seats/<seat_id>.md`, and the synthesizer
outputs `editorial_decision.md` / `revision_roadmap.md` in the same directory.
Vendor layout is likewise fixed: `vendor/academic-paper-reviewer/` (28 upstream files)
and `vendor/shared/` (the §1.3 set), preserving upstream relative paths so vendored
references resolve. Any other path in a task description is superseded by this section.

```jsonc
{
  "schema_version": "1",
  "review_id": "rev-20261027-<8hex>",          // unique, tool-generated
  "created_at": "2026-10-27T10:00:00+08:00",   // ISO-8601 with offset
  "updated_at": "…",
  "mode": "full",                              // full|quick|methodology-focus
  "paper": {
    "path": "D:/…/manuscript.md",
    "sha256": "<hex sha-256 of file bytes>",
    "bytes": 12345,
    "format": "md"                             // md|tex|txt only
  },
  "upstream_skill_version": "1.11.1",
  "upstream_commit": "1ec249df98728682dfbbdfb940a658338bfd6f80",
  "status": "created",                         // created|panel_configured|awaiting_panel_confirmation
                                               // |in_review|all_submitted|awaiting_synthesis_approval
                                               // |report_ready|abandoned
  "field_analysis": {                          // Phase 0 output
    "analyst_run_at": "…",
    "primary_discipline": "…", "secondary_disciplines": ["…"],
    "research_paradigm": "…", "methodology_type": "…",
    "target_journal_tier": "…", "paper_maturity": "…",
    "configuration_cards": [ {seat, identity, expertise, focus}, ×4 ]
  },
  "panel": {
    "seats": [
      {
        "seat_id": "eic",                      // eic|methodology|domain|perspective|da
        "role_marker": "EIC",                  // EIC|R1|R2|R3|DA
        "agent_file": "vendor/academic-paper-reviewer/agents/eic_agent.md",
        "status": "pending",                   // pending|dispatched|submitted|failed
        "dispatched_at": null, "submitted_at": null,
        "configuration_card": 1,               // null for da
        "report": {                            // set on submit
          "findings": [ {
              "id": "eic-F1", "severity": "critical|major|minor|comment",
              "title": "…", "detail": "…",
              "evidence": [ { "quote": "…", "location": "§4.2 / line 210" } ]
          } ],
          "verdict": "accept|minor_revision|major_revision|reject",
          "summary": "…",
          "provenance": { "model": "…", "peer_output_visible": false,
                          "context_fresh": true, "human_operator": "…" }
        }
      }, … ×5
    ]
  },
  "synthesis": {
    "requested_at": null, "completed_at": null,
    "decision": null,                          // accept|minor_revision|major_revision|reject
    "decision_letter_path": "reviews/<id>/editorial_decision.md",
    "revision_roadmap_path": "reviews/<id>/revision_roadmap.md",
    "da_critical_adjudications": [ { "finding_id": "da-F1",
        "adjudicated": true, "outcome": "validated|rejected|unresolved", "rationale": "…" } ]
  },
  "checkpoints": {
    "panel_confirmed_at": null,                // human checkpoint after Phase 0
    "report_approved_at": null                 // human checkpoint before final report
  },
  "advisory_checks": { "acronyms": "not_run", "suggested_references": "not_run",
                       "reviewer_claims": "not_run" }   // not_run|passed|failed|skipped
}
```

Every finding must carry at least one evidence quote + manuscript location.
Timestamps are ISO-8601 with timezone. `paper.sha256` is recomputed on every
tool call; any mismatch fails the call with `paper_changed`.

### Tool API (all names prefixed `academic_review_`)

This table is authoritative and mirrors `src/tools.ts`: every row is one
`ctx.tools.register(defineTool(...))` call, and the registered names are exactly
`academic_review_create`, `academic_review_status`, `academic_review_confirm`,
`academic_review_submit`, `academic_review_report` — five tools, no more.

The two prompt-only skills do not touch this surface: neither `deep-research`
nor `academic-paper` registers a tool (§1.2), so the tool list below is still
complete and its arguments, results and error codes are unchanged by 0.3.0.

| Tool | Args | Behavior |
|---|---|---|
| `create` | `paper_path`, `mode?` | Validates extension ∈ {.md,.tex,.txt} (reject .pdf and others with a clear error + guidance), computes SHA-256, writes initial state, status=`created` |
| `status` | `review_id` | Returns state summary: status, per-seat status, decision, advisory checks, pending checkpoint |
| `confirm` | `review_id`, `action` ∈ {`attach`,`confirm`}; when `action=attach`: `primary_discipline`, `secondary_disciplines[]`, `research_paradigm`, `methodology_type`, `target_journal_tier`, `paper_maturity`, `configuration_cards[]` (one per peer seat: `{seat, identity, expertise, focus}`; the DA seat takes none) | Checkpoint-1 tool surface. `action=attach` stores the field-analysis record (including `analyst_run_at`) and moves `created` → `awaiting_panel_confirmation`; `action=confirm` requires an attached analysis, accepts optional user-edited `configuration_cards`, records `checkpoints.panel_confirmed_at`, and moves → `in_review`. `confirm` is the **only** transition that makes a review submittable — the review never self-confirms. Refuses unknown ids (`review_not_found`), a manuscript edited mid-review (`paper_changed`), and out-of-order calls such as confirm-before-attach or a second attach (`state_conflict`) |
| `submit` | `review_id`, `seat_id`, `report` (findings+evidence+verdict+provenance) | Accepts a seat's committed report; validates seat_id, severity enum, ≥1 evidence per finding; sets seat status=`submitted`, timestamp; refuses if seat already submitted or panel not confirmed; when all 5 submitted → status=`all_submitted` |
| `report` | `review_id`, `approve?: boolean`, `da_adjudications?: [{finding_id, outcome, rationale}]` | Phase 2 entry: runs the synthesizer subagent over the 5 cards, writes decision letter + roadmap, records DA-CRITICAL adjudications; final render/delivery requires an explicit human approval flag — the tool refuses to mark `report_ready` without it (checkpoint per §4) |

Field-analysis attach and the panel-confirmation record are **tool-surface**
operations, reached only through `academic_review_confirm`
(`action=attach` / `action=confirm`). A chat session can therefore drive a review
from `created` to `all_submitted` and on to `report_ready` without out-of-band
calls; nothing in the plugin attaches or confirms implicitly, and `submit` keeps
refusing with `panel_not_confirmed` until `confirm` has run.

Remaining supporting operations are not separate tools: advisory-check result
attach and the DA-CRITICAL adjudication record ride on the `status` and
`report` calls. All state mutations are append-friendly timestamps; seat reports
are immutable once submitted.

### Slash commands (`/ars-review`, `/ars-review-status`)

Two human commands sit on the same state layer as the five tools. They are thin
adapters in `src/commands.ts` over `ReviewStore` — no transition, schema check,
atomic write or lifecycle guard is re-implemented, and no write path was added
to the web surface.

| Command | Hint | Reads / writes |
|---|---|---|
| `/ars-review` | `[quick|full] <path-to-manuscript>` | writes: `ReviewStore.create`; prints review id, mode, seats, review dir and the exact `academic_review_confirm(action="attach", …)` call that comes next |
| `/ars-review-status` | `[review_id]` | reads only: `ReviewStore.list` / `read` / `status`; defaults to the newest review by `updated_at` |

- Registration shape (verified against `@deepseek-ai/dsh-commands` typings and
  the installed 0.2.1-rc.2 runtime, not guessed):
  `ctx.commands.register({ name, description, input: { hint }, handler })`;
  the handler returns `{ kind: 'success' | 'error', text }`. Names must match
  `/^[a-z][a-z0-9_-]*$/u`, so no leading slash is passed.
- The registry is resolved lazily (`commands` is deliberately not a required
  `inject`): a composition without a command registry still mounts the tools
  and the skill, and a registry that appears later is picked up through the
  `internal/service` event.
- A review opened by `/ars-review` is the same record
  `academic_review_status` and the panel routes report — same directory, same
  `state.json`, same checkpoints.
- Refusals (PDF, missing/unreadable file, unimplemented mode, bad usage) are one
  actionable line each and leave no state behind.
- Grammar, rendered output and refusal texts: `docs/COMMANDS.md`; coverage:
  `tests/commands.test.mjs`.

### End-to-end harness (`pnpm test:e2e`)

`scripts/e2e.mjs` is a deterministic end-to-end check that needs no model and
no network. It mounts the plugin on a real cordis `Context`
(`tests/helpers.mjs` → `mountReviewPlugin`) inside a throwaway OS-temp
workspace with a temp state dir, then drives everything through `ctx.tools`
only:

1. `create` → `confirm(action=attach)` with four configuration cards →
   `confirm(action=confirm)` → five `submit` calls with fixture seat cards →
   `report(approve=false)` → `report(approve=true)` + a DA adjudication →
   `report_ready`.
2. Every transition is asserted twice: on the tool result the model would read
   and on the `state.json` the store wrote.
3. The artifact set is asserted (`state.json`, `seats/<seat>.json` +
   `seats/<seat>.md` for all five seats, `editorial_decision.md`,
   `revision_roadmap.md`).
4. The three read-only routes (`/plugins/dsh-academic-review/reviews`,
   `/reviews/<id>`, `/reviews/<id>/report`) are resolved through the real host
   prefix semantics (`tests/host-prefix-matcher.mjs`) and driven end to end:
   200 for list/detail/report, 404 for an unknown id, 401 unauthenticated,
   405 for POST.
5. Both negative gates run: `.pdf` refused with `unsupported_format` (no review
   directory written) and a one-byte manuscript edit after checkpoint 1 refused
   with `paper_changed` (no seat written).
6. Isolation: `globalThis.fetch` is trapped and must stay at zero calls; no
   model client exists in the process; every run uses a unique temp root that is
   removed at the end, so no review state ever lands in the repository.

Determinism comes from fixed fixtures plus pattern-asserted clock values (the
review id is `rev-YYYYMMDD-8hex`; timestamps are produced by the plugin's own
`nowIso()`). Exit code 0 when every check passes, 1 otherwise. The unit suite
is `pnpm test` (`node --test tests/*.test.mjs`).

---

## 4. Adapter rules

**Write policy A — new paths only (hard product rule).** No configuration, mode,
prompt or upstream instruction can relax it:

- every file a skill produces is written to a **new** path (the review directory
  `<workspace>/<stateDir>/<review_id>/` with a freshly generated `review_id`;
  `state.json`, `seats/<seat_id>.json`, `seats/<seat_id>.md`,
  `editorial_decision.md`, `revision_roadmap.md`), never onto an existing file;
- the manuscript is **never overwritten, moved, renamed or deleted** — it is
  read, and hashed to pin its bytes, and that is all;
- an output path that already exists is **refused or renamed**, never clobbered
  (no overwrite, no append, no "move it out of the way");
- `deep-research` has no write tool: anything a run produces must go to a new
  path, and its inputs are read-only;
- `academic-paper` writes with the host's file tools, which this plugin never
  sees: for that skill the rule travels as the prepended policy block plus
  `writePolicy` / `writePolicyEnforced: false` in metadata, and the model is
  told to treat every output as a new path;
- manuscript drift is reported (`paper_changed`), never repaired: the plugin
  does not restore or rewrite the file, it asks for a new review.

**Scope of that guarantee (read before quoting it).** The bullets above are
enforced by this plugin's own code, which owns the five `academic_review_*` tools
and both slash commands. Policy A as it applies to a *skill* is not enforceable
here: a skill body is prompt text, the model writes with the host's file tools,
and this plugin never sees those calls. So for a skill that instructs writing
(`academic-paper`) the rule travels as a block prepended to the served body plus
`metadata.writePolicy = 'new-paths-only'` and `metadata.writePolicyEnforced =
false`. Instruction with an audit trail, never an interlock. The block is
prepended, not appended, so it is the first thing the model reads in a writing
task. The table itself (`src/write-policy.ts`) is checked in both directions —
a vendored skill that starts instructing writes must be listed, and a listed skill
that stops matching fails the suite — so the single entry (`academic-paper`)
cannot rot into a rubber stamp.

1. **Input formats**: only `.md`, `.tex`, `.txt`. The adapter performs no PDF
   parsing or OCR — a PDF input is rejected at `create` with instructions to
   supply extracted text (upstream's PDF read-preflight is out of Phase 1
   scope). Encoding: UTF-8.
2. **Read-only manuscript guarantee (write policy A)**: seats and synthesizer
   never write to the paper path; all outputs go to new files under the review
   directory. The wrapper prompt restates upstream Iron Rule #6 and a violation
   is a `failed` seat.
3. **No automatic manuscript rewriting**: no tool or agent produces a revised
   manuscript, patches, or edits. Revision Roadmap is advisory text only.
4. **Human checkpoints**: (a) after Phase 0 — user confirms/edits the 4
   configuration cards; (b) before the final report is delivered — the user
   must explicitly approve (`academic_review_report(approve=true)`). No unattended
   create→report pipeline; the plugin never auto-approves its own output.
5. **Untrusted-material boundary**: manuscript and any reviewer comments are
   data, not instructions (vendored canonical block). Prompt-injection-like
   text is reported as a finding.
6. **Seat isolation**: Phase 1 seats receive no peer outputs (upstream sprint
   contract / Iron Rule #2); provenance recorded honestly, never labeled
   "independent".
7. **Mode guard**: unimplemented modes (`re-review`, `guided`,
   `calibration`) reply with an explicit not-implemented message and change
   no state.
8. **Size limits**: papers beyond a configurable size (default 1 MB text) get
   a warning and are chunked for seat context by section, never truncated
   silently.

---

## 5. License / NOTICE requirements

- The plugin is a derivative of CC BY-NC 4.0 material and is itself licensed
  **CC BY-NC 4.0**. No MIT/Apache/BSD relicensing of vendored or derived
  content, anywhere in the repo, including generated release artifacts.
- Attribution (exact): **Cheng-I Wu** (ORCID
  https://orcid.org/0009-0008-9523-0103), *Academic Research Skills*,
  https://github.com/Imbad0202/academic-research-skills, skill
  `academic-paper-reviewer` version **1.11.1**, pinned commit
  **1ec249df98728682dfbbdfb940a658338bfd6f80**.
- Wording: the README and package metadata must state this is an
  **"unofficial DSH port"** of ARS's academic-paper-reviewer, not affiliated
  with or endorsed by the upstream author.
- A `THIRD_PARTY_NOTICES.md` (draft in repo root; final copy also into the
  distributed package) lists: upstream attribution block, vendored file
  inventory (or pointer to `docs/UPSTREAM_INVENTORY.md`), and the
  **modifications list** (the only permitted changes, all outside vendored
  files): DSH prompt wrappers, review-state tools, GUI panel, tests, example,
  packaging. Vendored files are byte-identical (T2 verifies via SHA-256
  against upstream).
- Non-commercial use only; BY requirement satisfied by the notices and the
  per-run report footer, which must include the attribution line.

## 6. Acceptance criteria for T2 (implementation) and T3 (tests/example/release)

> **Task-id mapping.** AgentTeams task ids win over this section's labels. T1 = `t1`
> (this spec). T2 here = AgentTeams `t2` (plugin core) plus `t3` (client UI) and `t6`
> (seat prompt pack). T3 here = AgentTeams `t4` (verification, example, packaging) plus
> `t5` (release docs: README/LICENSE/NOTICES).

T2 — vendoring + implementation:
1. `vendor/academic-paper-reviewer/` contains all 28 files byte-identical
   (SHA-256 match vs upstream tree; script-verifiable).
2. `vendor/shared/` contains exactly the §1.3 dependency set, byte-identical.
3. `academic_review_create/status/submit/report` tools implemented with the
   §3 schema; state file round-trips; SHA-256 paper pinning works.
4. .pdf/.docx inputs rejected at create; .md/.tex/.txt accepted.
5. 7 DSH subagent prompt wrappers wired to vendored agent files; seats cannot
   see peer cards; synthesizer runs only after 5 submits.
6. Human checkpoints enforced (panel confirmation; `academic_review_report(approve=true)`).
7. GUI panel can create a review, show seat statuses, show the final decision.
8. No plugin code writes into `vendor/`.

T3 — tests, example, release:
1. Unit tests: state schema validation, seat lifecycle, SHA-256 mismatch,
   format gate, checkpoint refusal paths, advisory-check "not_run" fallback.
2. Integration test: full-mode end-to-end on the vendored example manuscript
   (or a small synthetic .md) — 5 seat cards + decision letter + roadmap,
   both checkpoints exercised.
3. Example directory demonstrating a full review run artifacts.
4. `THIRD_PARTY_NOTICES.md` finalized; README carries "unofficial DSH port"
   wording, CC BY-NC 4.0, attribution block; no MIT/Apache license files
   anywhere.
5. Release packaging: installable DSH plugin archive; vendored content
   included unmodified with notices.
