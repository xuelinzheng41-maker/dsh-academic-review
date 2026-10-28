# Upstream Inventory — ARS academic-paper-reviewer @ 1ec249df98728682dfbbdfb940a658338bfd6f80

Source: https://github.com/Imbad0202/academic-research-skills (Cheng-I Wu),
vendored read-only from a clone of the upstream repository at the pinned commit
(`<path to an ARS checkout at 1ec249df>`; the bytes are read out of its git object
store, so a checkout made with any `core.autocrlf` setting is equivalent).
Skill version 1.11.1 (2026-08-15); repo plugin.json version 3.23.2.
License: CC BY-NC 4.0.

**What the numbers in this file are — read this before editing one.** Every byte
count below is a **repository byte count**: the size of the blob in the pinned
commit's git object store, which is exactly what the vendoring pipeline copies into
`vendor/`. It is never the size of a checkout. A `core.autocrlf=true` checkout
inflates every file by its line count, because each LF arrives as CRLF, and that is
how the previous edition of this table went wrong — by exactly one byte per line,
on all 88 rows, the 74 vendored files and the 14 upstream-only scripts alike. To
re-derive any row, `git cat-file -s <commit>:<path>` in the upstream clone, or
`stat` the file under `vendor/`; the two must agree, because the pipeline reads
the object store too. `tests/release-invariants.test.mjs` re-measures the 44
vendored rows on every run, so that column cannot drift silently again. The 14
upstream-only sizes cannot be stat()ed from this package, so the suite reaches them
in two steps rather than trusting them: on every run, with no clone and no
environment variable, it builds a throwaway fixture repository and proves the check
itself can fail; and when `DSH_UPSTREAM_CLONE` names a clone of the pinned commit
the fourteen are compared against that object store, while without it the run
NAMES all fourteen as unverified rather than reporting a skip.

## academic-paper-reviewer/ (28 files, all vendored unmodified)

| File | Bytes |
|---|---|
| SKILL.md | 48,548 |
| agents/field_analyst_agent.md | 11,494 |
| agents/eic_agent.md | 28,807 |
| agents/methodology_reviewer_agent.md | 45,049 |
| agents/domain_reviewer_agent.md | 34,167 |
| agents/perspective_reviewer_agent.md | 34,502 |
| agents/devils_advocate_reviewer_agent.md | 43,018 |
| agents/editorial_synthesizer_agent.md | 42,807 |
| references/calibration_mode_protocol.md | 15,840 |
| references/changelog.md | 1,396 |
| references/editorial_decision_standards.md | 13,142 |
| references/guided_mode_protocol.md | 2,036 |
| references/integration_guide.md | 680 |
| references/quality_rubrics.md | 6,400 |
| references/reviewer_sprint_prompt_source.md | 49,020 |
| references/review_criteria_framework.md | 6,335 |
| references/review_panel_provenance_protocol.md | 9,656 |
| references/review_quality_thinking.md | 3,337 |
| references/re_review_mode_protocol.md | 53,211 |
| references/sprint_contract_protocol.md | 32,853 |
| references/statistical_reporting_standards.md | 30,511 |
| references/top_journals_by_field.md | 12,916 |
| templates/editorial_decision_template.md | 11,650 |
| templates/peer_review_report_template.md | 15,184 |
| templates/revision_response_template.md | 7,595 |
| examples/hei_paper_review_example.md | 34,657 |
| examples/interdisciplinary_review_example.md | 28,262 |
| examples/subclaim_decomposition_example.md | 8,528 |

(Total: 1 SKILL.md + 7 agents + 14 references + 3 templates + 3 examples =
28 files.)

## academic-pipeline/ (30 files, all vendored unmodified)

| File | Bytes |
|---|---|
| SKILL.md | 59,581 |
| agents/claim_ref_alignment_audit_agent.md | 45,398 |
| agents/collaboration_depth_agent.md | 10,031 |
| agents/integrity_verification_agent.md | 75,249 |
| agents/pipeline_orchestrator_agent.md | 178,444 |
| agents/state_tracker_agent.md | 27,397 |
| examples/full_pipeline_example.md | 18,078 |
| examples/integrity_failure_recovery.md | 27,485 |
| examples/mid_entry_example.md | 13,715 |
| references/adapters/.gitkeep | 0 |
| references/adapters/overview.md | 10,193 |
| references/ai_research_failure_modes.md | 15,983 |
| references/changelog.md | 5,919 |
| references/claim_audit_calibration_protocol.md | 14,557 |
| references/claim_verification_protocol.md | 31,231 |
| references/external_review_protocol.md | 6,329 |
| references/integrity_review_protocol.md | 7,315 |
| references/literature_corpus_consumers.md | 11,962 |
| references/mode_advisor.md | 8,257 |
| references/passport_as_reset_boundary.md | 19,057 |
| references/pipeline_state_machine.md | 29,019 |
| references/plagiarism_detection_protocol.md | 13,795 |
| references/process_summary_protocol.md | 16,150 |
| references/progress_dashboard_template.md | 1,524 |
| references/reinforcement_content.md | 1,396 |
| references/reproducibility_audit.md | 2,667 |
| references/score_trajectory_protocol.md | 3,913 |
| references/team_collaboration_protocol.md | 10,312 |
| references/two_stage_review_protocol.md | 3,041 |
| templates/pipeline_status_template.md | 3,813 |

(Total: 1 SKILL.md + 5 agents + 20 references (one of them a `.gitkeep` in
`references/adapters/`) + 1 template + 3 examples = 30 files.)

### What the pipeline's own tree names and this port does not ship

The pipeline's instructions call **47 upstream scripts** from the repository-root
`scripts/` directory: **36 named directly** in its own Markdown plus **11 more that
those import** (`_skill_lint`, `ars_mark_read`, `audit_snapshot`,
`bibliographic_integrity_signals`, `build_claim_standing_candidate_ledger`,
`claim_standing_discovery`, `claim_standing_stance_runner`, `file_lock`,
`policy_anchor_disclosure_referee`, `research_workflow_profile`,
`resolve_review_target_context`). Together they are **1,806,561 repository bytes**, and
their third-party imports are `jsonschema`, `yaml`/`ruamel.yaml`, `pypdf`,
`defusedxml` and `referencing`. **This port vendors none of them, deliberately** - see
`docs/PORT_SPEC.md` for the reasoning. The upstream `scripts/` directory as a whole
is 642 files and stays out.

## shared/ files referenced by the reviewer tree (vendor unmodified)

- shared/ground_truth_isolation_pattern.md (16,356)
- shared/handoff_schemas.md (98,506)
- shared/cross_model_verification.md (85,267)
- shared/mode_spectrum.md (5,292)
- shared/model_tiering.md (12,791)
- shared/sprint_contract.schema.json (19,423)
- shared/references/routing_core.md (5,181)
- shared/references/intent_clarification_protocol.md (11,564)
- shared/references/review_criteria_consumer_protocol.md (9,863)
- shared/contracts/reviewer/full.json (3,782)
- shared/contracts/reviewer/methodology_focus.json (2,232)
- shared/contracts/reviewer/review_panel_provenance.schema.json (8,038)
- shared/contracts/reviewer/review_panel_provenance_input.schema.json (3,593)
- shared/contracts/reviewer/review_panel_provenance_carrier.schema.json (4,211)
- shared/contracts/revision/revision_roadmap.schema.json (11,499)
- shared/contracts/re_review/traceability.schema.json (38,611) + precommitment,
  verdict_record, input_manifest, and legacy/v1_0/ (4 files)
- Transitive (review-target binding): shared/contracts/review_target/*
  (7 schemas), shared/review_criteria_registry.json,
  shared/review_criteria_sources/msr-2027-technical-papers.2026-08-24.json,
  shared/review_criteria_sources/sigsoft-empirical-standards.2026-08-24.json

## scripts/ referenced (advisory checkers; optional in Phase 1)

check_panel_synthesis.py (49,629), check_acronyms.py (57,950),
verify_panel_recommendations.py (19,279), audit_panel_claims.py (17,678),
check_pipeline_integrity.py (13,472), review_panel_provenance.py (25,433),
check_sprint_contract.py (15,615), check_phase_conformance.py (97,103),
revision_roadmap.py (85,648), ars_write_scope_guard.py (30,786),
check_re_review_synthesis.py (148,996),
check_reviewer_sprint_prompt_sync.py (16,614),
recompute_receipts.py (57,049), review_criteria_binding.py (38,385).

## Referencing map (which reviewer file references which shared/scripts path)

- SKILL.md → routing_core, intent_clarification_protocol,
  ground_truth_isolation_pattern, mode_spectrum,
  review_criteria_consumer_protocol, cross_model_verification,
  sprint_contract.schema.json, reviewer/full.json, reviewer/methodology_focus.json,
  contracts/re_review/, model_tiering.md; scripts: check_panel_synthesis,
  check_acronyms, verify_panel_recommendations, audit_panel_claims,
  check_pipeline_integrity, review_panel_provenance, check_sprint_contract,
  check_phase_conformance.
- eic/methodology/domain/perspective/devils_advocate agents →
  check_pipeline_integrity, check_phase_conformance, check_panel_synthesis;
  DA also → handoff_schemas, cross_model_verification.
- editorial_synthesizer_agent → ground_truth_isolation_pattern,
  cross_model_verification, revision_roadmap.schema.json,
  review_panel_provenance_carrier.schema.json; scripts: check_pipeline_integrity,
  ars_write_scope_guard, revision_roadmap.
- field_analyst_agent → ground_truth_isolation_pattern.
- calibration_mode_protocol → cross_model_verification.
- editorial_decision_standards → handoff_schemas; scripts: check_re_review_synthesis.
- review_panel_provenance_protocol → the 3 provenance schemas + reviewer/full.json;
  scripts: review_panel_provenance.
- re_review_mode_protocol → contracts/re_review/*, revision_roadmap.schema.json,
  handoff_schemas; scripts: check_re_review_synthesis.
- sprint_contract_protocol → sprint_contract.schema.json, contracts/reviewer/,
  contracts/, contracts/re_review/; scripts: check_reviewer_sprint_prompt_sync,
  check_phase_conformance, recompute_receipts, check_re_review_synthesis,
  check_panel_synthesis.
- statistical_reporting_standards → check_phase_conformance.
- peer_review_report_template → handoff_schemas.
- editorial_decision_template → check_re_review_synthesis.
- reviewer_sprint_prompt_source → check_reviewer_sprint_prompt_sync,
  check_phase_conformance, check_panel_synthesis.
- templates/revision_response_template.md — no shared/scripts refs.

## Not vendored

The upstream repository's non-skill trees `commands/`, `evals/`, `tests/`,
`audits/`, `.claude/`, `.github/`, `tools/`, and the repo-root `scripts/`
directory (`academic-pipeline/` left this list in 0.5.0, when it became the fifth
vendored tree). The root `scripts/` entry is one of the two reasons the reviewer
is not a *demonstrated* file producer - those scripts exist upstream but live
outside every skill tree - and it is also why the pipeline's integrity stages
cannot run from this package at all: this port vendors the five skill trees plus
`shared/`, nothing else. It is not a reason to withhold the write-policy block — every served skill
carries it, unconditionally.

`deep-research/` and `academic-paper/` **are** vendored as of 0.2.0,
`sr-screener/` as of 0.4.0 and `academic-pipeline/` as of 0.5.0, each in its own
tree and inventoried by `vendor-manifest.json`. This file carries a byte row for
every file in two of the five trees (the reviewer's, which is the one a review
actually runs, and the pipeline's, whose references are the ones that dangle), a
byte row for the `shared/` files the reviewer names, and a class table for the rest;
the SHA-256 pins for all 342 files live in `vendor-manifest.json`.

## sr-screener/ (25 files, vendored unmodified, not executed)

`sr-screener` is the first served tree that ships executable payload, so it gets
one line of description even though its file-by-file pins live in
`vendor-manifest.json`:

| Class | Files | Executed by this plugin? |
|---|---|---|
| Markdown (SKILL.md + 14 more) | 15 | no — served as text |
| Python under `scripts/` | 6 — `build_outputs.py`, `build_workflow.py`, `merge_decisions.py`, `prepare_fulltext.py`, `prepare_records.py`, `srlib.py` | **no** — shipped verbatim and pinned, never run, never audited |
| `.js` workflow templates under `templates/workflows/` | 2 | **no** — template text |
| `.json` templates (`templates/screening_config.template.json`, `examples/example_config_dta.json`) | 2 | **no** — data |

Upstream states the requirement in its own body: Python 3.9+, standard library
only, `openpyxl` optional. The host's shell is what would run these scripts; this
plugin cannot see what they write, which is why policy A reaches the skill as
instruction and metadata only (`docs/PORT_SPEC.md` §1.6).
