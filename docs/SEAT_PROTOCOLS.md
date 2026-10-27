# Seat Protocols — DSH dispatch of the ARS academic-paper-reviewer panel

Unofficial DSH port of ARS `academic-paper-reviewer` v1.11.1 (commit
`1ec249df98728682dfbbdfb940a658338bfd6f80`), per `docs/PORT_SPEC.md`.
This document defines how the orchestrator spawns each seat, what each seat
receives, the required return payload, the read-only rule, DA CRITICAL
adjudication, and the pre-report human checkpoint. Prompt files live in
`assets/prompts/` (one per role, 7 total).

## 1. Seat roster and prompt files

| Seat id | Role marker | Upstream agent file (vendored, unmodified) | Prompt file | Phase |
|---|---|---|---|---|
| `field-analyst` | — | field_analyst_agent.md | assets/prompts/field-analyst.md | 0 (pre-pass) |
| `eic` | `EIC` | eic_agent.md | assets/prompts/seat-eic.md | 1 |
| `methodology` | `R1` | methodology_reviewer_agent.md | assets/prompts/seat-methodology.md | 1 |
| `domain` | `R2` | domain_reviewer_agent.md | assets/prompts/seat-domain.md | 1 |
| `perspective` | `R3` | perspective_reviewer_agent.md | assets/prompts/seat-perspective.md | 1 |
| `da` | `DA` | devils_advocate_reviewer_agent.md | assets/prompts/seat-da.md | 1 |
| `editorial-synthesizer` | — | editorial_synthesizer_agent.md | assets/prompts/editorial-synthesizer.md | 2 (final pass) |

Each prompt file = a thin DSH wrapper (dispatch mechanics, inputs, JSON return
envelope, DSH-adapted rules — each marked `[DSH adaptation]`) + an instruction
to follow the **unmodified** vendored agent file, which stays authoritative for
role identity, phase boundary, output discipline, and report format. Where they
differ: vendored review-substance rules win; wrapper dispatch/return mechanics
win. Upstream wording is preserved verbatim wherever quoted (read-only rule,
untrusted-material rule, DA challenge framing, synthesizer role, calibration
status, confidence disclaimer).

## 2. How the orchestrator spawns each seat

**DSH `subagent` tool (default mechanism, Phase 1).** One call per seat:

```
subagent({
  prompt_file: "assets/prompts/seat-eic.md",
  inputs: { review_id, seat_id: "eic", role_marker: "EIC", mode,
            paper_path, paper_sha256,
            configuration_card: <card #1 from confirmed panel config> }
})
```

- Seats are **stateless single dispatches**, not long-lived teammates, matching
  upstream Mode B "single-phase agents" semantics. Sequence per
  `docs/PORT_SPEC.md` §2.2: field-analyst → human panel-confirmation
  checkpoint → 5 seat dispatches (any order; no peer visibility) →
  editorial-synthesizer after all 5 `submitted` → human report-approval
  checkpoint.
- **Seat isolation (upstream Iron Rule #2):** a seat's `inputs` never include
  another seat's report or card. Only its own configuration card (cards are
  public panel configuration, not peer output) plus the paper payload.
- **`agent_teams` alternative:** for later multi-phase orchestration the same
  prompts can be registered as teammate profiles and dispatched via
  `agent_teams`; the input/output contracts below are identical. Phase 1 uses
  plain `subagent`; nothing in the prompts depends on which mechanism spawns
  them.
- Sandbox: seats get read access to the manuscript and the vendored tree; no
  write access to the manuscript (see §5). Seat reports are submitted to state
  only via the orchestrator calling `academic_review_submit`.

Mode panel subsets: `full` = all 7; `quick` = field-analyst + eic;
`methodology-focus` = field-analyst + eic + methodology. (Upstream mode
table preserved; `re-review`/`guided`/`calibration` are out of Phase 1.)

## 3. Exactly what each seat receives

Every seat dispatch carries:

| Field | Value |
|---|---|
| `review_id` | from review state (`rev-…`) |
| `seat_id` | per §1 roster |
| `role_marker` | `EIC` / `R1` / `R2` / `R3` / `DA` (— for pre-pass/synthesis) |
| `mode` | `full` / `quick` / `methodology-focus` |
| `paper_path` | absolute path; extension ∈ {.md, .tex, .txt} (enforced at `academic_review_create`) |
| `paper_sha256` | 64-hex SHA-256 of the paper file bytes; the seat verifies it before reviewing; mismatch ⇒ seat returns `status:"failed", error:"paper_hash_mismatch"` |

Additions per seat: field-analyst gets nothing extra (reads the whole paper);
the 4 card-backed seats each get their **own** configuration card; `da` gets
none ("the fixed Devil's Advocate … receives no dynamic configuration card");
editorial-synthesizer gets the 5 committed seat payloads (read from review
state, not from seats directly) and the typed panel-provenance artifact.

## 4. Required return payload

Seats commit exactly one JSON object (full schema in the prompt files and
`docs/PORT_SPEC.md` §3):

```json
{ "seat_id": "…", "role": "<upstream agent name>", "status": "submitted|failed",
  "findings": [ { "id": "<seat>-F<n>",
                 "severity": "critical|major|minor|comment",
                 "dimension": "<D1..D6 or free-text axis>",
                 "title": "…", "detail": "…",
                 "evidence": [ { "quote": "verbatim manuscript quote",
                                 "location": "§/line anchor" } ],
                 "confidence": 1-5 } ],
  "verdict": "accept|minor_revision|major_revision|reject",
  "summary": "…", "calibration_status": "NOT_CALIBRATED",
  "provenance": { "model": "<id or unknown>", "provider": "<or unknown>",
                  "peer_output_visible": false, "context_fresh": true,
                  "human_operator": "<or unknown>" },
  "created_at": "<ISO-8601 with timezone>" }
```

- **Evidence anchoring is mandatory:** every finding carries ≥1 verbatim quote
  + location, or it is not a finding. Never invent findings — the synthesizer's
  no-fabrication rule is applied port-wide.
- `confidence` is upstream's 1–5 score, "an uncertainty/scope disclosure only;
  it never changes consensus counts, severity, decision bearing, or
  arbitration." `calibration_status` is always `NOT_CALIBRATED`.
- The upstream Markdown report formats (Reviewer Identity, Overall
  Recommendation, Criterion-Bound Judgements table, …) are preserved inside the
  payload as `report_markdown` / `summary` content [DSH adaptation: JSON
  envelope wraps, not replaces, the upstream report shape].
- Variants: field-analyst returns `field_analysis` + `configuration_cards[4]`
  (no verdict); editorial-synthesizer returns `decision`,
  `decision_letter_markdown`, `revision_roadmap_markdown`, `consensus`,
  `disagreements`, `da_critical_adjudications[]`, and the mandatory CC
  BY-NC 4.0 attribution `report_footer`, with `status:"draft_complete"`.

The orchestrator persists a seat payload via `academic_review_submit`
(validates seat_id, severity enum, evidence presence, timestamps; seat reports
immutable once submitted).

## 5. Read-only rule (never edit the manuscript)

Upstream Iron Rule #6, verbatim: "Reviewers MUST NOT modify the submitted
manuscript. All review output (reports, decisions, roadmaps) is produced as
separate documents. The reviewer examines the paper — it never rewrites it. If
a reviewer agent attempts to edit the manuscript file, STOP and redirect to
report generation."

DSH enforcement [DSH adaptation]: seats are dispatched without write
permission to the paper path; the prompt wrapper restates the rule and
declares any write attempt a protocol failure terminating the seat with
`status:"failed"`. All artifacts go under the review directory through the
review-state tools. No tool or seat ever produces a revised manuscript or
patch.

## 6. DA CRITICAL adjudication rule

Upstream Iron Rule #4, verbatim: "Every Devil's Advocate CRITICAL issue is
adjudicated visibly in the Editorial Decision — a validated or genuinely
unresolved one blocks silent Accept finalization … One the Journal-Fit
Reviewer adjudicates and rejects is recorded with its rejection rationale and
does not veto by itself (#574 B1: an unvalidated negative claim carries the
same evidence burden as a positive one). Silently bypassing a DA CRITICAL is
never allowed."

Port behavior: the `da` seat labels challenges `critical`/`major`/…
([DSH adaptation] severity mapping stated in seat-da.md); the synthesizer must
emit one `da_critical_adjudications[]` entry per `da` `critical` finding —
`{finding_id, adjudicated, outcome: validated|rejected|unresolved,
rationale}` — and the orchestrator refuses to record an `accept` decision
whose DA-CRITICAL set contains a validated or unresolved entry (surfaced to
the human at the §7 checkpoint; no silent bypass in any code path).

## 7. Human checkpoint before the final report

Two checkpoints ([DSH adaptation, per docs/PORT_SPEC.md §4]):

1. **Panel confirmation (after Phase 0):** the orchestrator presents the 4
   Reviewer Configuration Cards; the user confirms or edits them. Seats are
   dispatched only after `checkpoints.panel_confirmed_at` is set.
2. **Report approval (before final delivery):** the synthesizer produces a
   **draft** decision letter + roadmap and stops with
   `status:"draft_complete"`. The final report is rendered and state moves to
   `report_ready` **only** when the human explicitly approves
   (`academic_review_report --approve`). The plugin never auto-approves its
   own output; no unattended create→report pipeline exists.

## 8. Marked-adaptation register

All port deviations from upstream are marked `[DSH adaptation]` inside the
prompt files: (a) JSON return envelope + `academic_review_submit` contract;
(b) hash-verify-before-review; (c) DA severity mapping; (d) synthesizer
draft/stop + `--approve` checkpoint; (e) mandatory CC BY-NC 4.0 report
footer; (f) sandbox-level write denial replacing the upstream write-scope
guard hook (`scripts/ars_write_scope_guard.py`, not ported). Everything else
— persona, phase boundaries, output discipline, iron rules, report formats —
is upstream wording, followed via the unmodified vendored files.
