# Examples — dsh-academic-skills

End-to-end example material for the plugin.

## Contents

- `sample-paper.md` — a 2,001-byte self-contained manuscript (.md) used as the
  review target in Phase 1. Its pinned SHA-256 is
  `cc2e5cb07d0f662c94bf5922425b8516e898e44e0bbec1ca70740805f0c279ca`.
- `review-example/` — the full artifact set produced by driving the five
  `academic_review_*` tools over that paper in `full` mode:
  - `state.json` — the review state (5 seats, 17 findings, both checkpoints
    recorded, decision `major_revision`)
  - `seats/<seat_id>.json` / `.md` — the five committed seat reports
    (`eic`, `methodology`, `domain`, `perspective`, `da`)
  - `editorial_decision.md` — the Editorial Decision Letter, including the
    per-seat verdict table, the role-separation notice, and the DA-CRITICAL
    adjudication
  - `revision_roadmap.md` — the non-ranking Revision Roadmap

## How to reproduce

1. Install the plugin into a DSH profile (see the repository `README.md`).
2. From a session in the workspace, ask the agent to review
   `examples/sample-paper.md` in `full` mode. The flow is:
   `academic_review_create` → `academic_review_confirm` (`attach`, then
   `confirm`) → five `academic_review_submit` calls →
   `academic_review_report` (refused without `approve`, then accepted with
   `approve` plus the DA adjudication).
3. Approve the two human checkpoints when prompted: the reviewer
   configuration cards, and the final report.
4. Compare the produced `.academic-review/<review_id>/` tree against
   `review-example/`.

> Reviews are keyed by the manuscript SHA-256, so re-running over the same file
> produces the same structure; review ids (`rev-YYYYMMDD-8hex`) and timestamps
> differ per run.

Licensing: all example material here is part of this repository and is
distributed under CC BY-NC 4.0 (see `../LICENSE` and
`../THIRD_PARTY_NOTICES.md`).
