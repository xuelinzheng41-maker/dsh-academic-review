# Upstream Inventory — ARS academic-paper-reviewer @ 1ec249df98728682dfbbdfb940a658338bfd6f80

Source: https://github.com/Imbad0202/academic-research-skills (Cheng-I Wu),
vendored read-only copy at `D:\A粒球计算\tmp\ars-upstream`.
Skill version 1.11.1 (2026-08-15); repo plugin.json version 3.23.2.
License: CC BY-NC 4.0.

## academic-paper-reviewer/ (28 files, all vendored unmodified)

| File | Bytes |
|---|---|
| SKILL.md | 49,098 |
| agents/field_analyst_agent.md | 11,731 |
| agents/eic_agent.md | 29,146 |
| agents/methodology_reviewer_agent.md | 45,498 |
| agents/domain_reviewer_agent.md | 34,589 |
| agents/perspective_reviewer_agent.md | 34,939 |
| agents/devils_advocate_reviewer_agent.md | 43,461 |
| agents/editorial_synthesizer_agent.md | 43,301 |
| references/calibration_mode_protocol.md | 16,096 |
| references/changelog.md | 1,406 |
| references/editorial_decision_standards.md | 13,378 |
| references/guided_mode_protocol.md | 2,070 |
| references/integration_guide.md | 695 |
| references/quality_rubrics.md | 6,484 |
| references/reviewer_sprint_prompt_source.md | 49,344 |
| references/review_criteria_framework.md | 6,433 |
| references/review_panel_provenance_protocol.md | 9,853 |
| references/review_quality_thinking.md | 3,395 |
| references/re_review_mode_protocol.md | 53,555 |
| references/sprint_contract_protocol.md | 33,153 |
| references/statistical_reporting_standards.md | 31,016 |
| references/top_journals_by_field.md | 13,122 |
| templates/editorial_decision_template.md | 11,903 |
| templates/peer_review_report_template.md | 15,489 |
| templates/revision_response_template.md | 7,843 |
| examples/hei_paper_review_example.md | 35,048 |
| examples/interdisciplinary_review_example.md | 28,561 |
| examples/subclaim_decomposition_example.md | 8,608 |

(Total: 1 SKILL.md + 7 agents + 14 references + 3 templates + 3 examples =
28 files.)

## shared/ files referenced by the reviewer tree (vendor unmodified)

- shared/ground_truth_isolation_pattern.md (16,644)
- shared/handoff_schemas.md (99,731)
- shared/cross_model_verification.md (86,039)
- shared/mode_spectrum.md (5,357)
- shared/model_tiering.md (12,882)
- shared/sprint_contract.schema.json (19,905)
- shared/references/routing_core.md (5,213)
- shared/references/intent_clarification_protocol.md (11,734)
- shared/references/review_criteria_consumer_protocol.md (10,101)
- shared/contracts/reviewer/full.json (3,896)
- shared/contracts/reviewer/methodology_focus.json (2,307)
- shared/contracts/reviewer/review_panel_provenance.schema.json (8,301)
- shared/contracts/reviewer/review_panel_provenance_input.schema.json (3,713)
- shared/contracts/reviewer/review_panel_provenance_carrier.schema.json (4,333)
- shared/contracts/revision/revision_roadmap.schema.json (11,833)
- shared/contracts/re_review/traceability.schema.json (39,527) + precommitment,
  verdict_record, input_manifest, and legacy/v1_0/ (4 files)
- Transitive (review-target binding): shared/contracts/review_target/*
  (7 schemas), shared/review_criteria_registry.json,
  shared/review_criteria_sources/msr-2027-technical-papers.2026-08-24.json,
  shared/review_criteria_sources/sigsoft-empirical-standards.2026-08-24.json

## scripts/ referenced (advisory checkers; optional in Phase 1)

check_panel_synthesis.py (50,960), check_acronyms.py (59,031),
verify_panel_recommendations.py (19,706), audit_panel_claims.py (18,003),
check_pipeline_integrity.py (13,812), review_panel_provenance.py (26,177),
check_sprint_contract.py (15,986), check_phase_conformance.py (99,283),
revision_roadmap.py (87,615), ars_write_scope_guard.py (31,333),
check_re_review_synthesis.py (151,760),
check_reviewer_sprint_prompt_sync.py (17,023),
recompute_receipts.py (58,463), review_criteria_binding.py (39,289).

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

## Not vendored (Phase 1)

All other skills (academic-paper, deep-research, academic-pipeline,
sr-screener), commands/, evals/, tests/, audits/, .claude/, .github/,
tools/. Exception candidate: deep-research/agents/socratic_mentor_agent.md,
only if Phase 2.5 coaching is implemented.
