# dsh-academic-review

> **Phase 1 scope:** this port covers **one** ARS skill — `academic-paper-reviewer`.
> `deep-research`, `academic-paper`, `academic-pipeline` and `sr-screener` are **not**
> part of this release. Input is `.md` / `.tex` / `.txt` only: there is no PDF
> parsing and no OCR. The plugin never rewrites your manuscript.

An **unofficial DSH port** of the Academic Research Skills (ARS) skill
`academic-paper-reviewer` for DeepSeek Harness, Phase 1 (reviewer only).
It is not affiliated with, sponsored by, or endorsed by the upstream author or
project.

The plugin serves the vendored upstream reviewer skill through a DSH skill
provider and adds the review-state tools a 5-seat peer-review panel needs: an
immutable per-seat report store, manuscript SHA-256 pinning, and the two human
checkpoints the upstream protocol requires.

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

## What Phase 1 provides

- **Skill provider**: `academic-paper-reviewer` (upstream name, unmodified body)
  with `resourceBase = <package>/vendor/academic-paper-reviewer`.
- **Tools** (every state transition is validated in `src/state.ts`):

  | Tool | Purpose |
  | --- | --- |
  | `academic_review_create` | Pin a manuscript (.md/.tex/.txt only), record its SHA-256, open the review directory and the panel seats. |
  | `academic_review_status` | Status, per-seat state, advisory decision, advisory checks, pending checkpoint. |
  | `academic_review_confirm` | Human checkpoint 1: `action=attach` stores the field analysis (discipline, paradigm, methodology, tier, maturity + the reviewer configuration cards) and moves `created` -> `awaiting_panel_confirmation`; `action=confirm` records the user's approval and moves -> `in_review`. The only path that makes seats submittable. |
  | `academic_review_submit` | Commit one seat report; refused before the panel checkpoint, for an unknown seat, or twice for the same seat. |
  | `academic_review_report` | Synthesize `editorial_decision.md` and `revision_roadmap.md`; `approve: true` closes the review only after the user approves and every Devil's Advocate CRITICAL finding is adjudicated. |

- **GUI panel**: an **Academic Review** tab in the DSH sidebar-right pane shows
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

Out of scope for Phase 1: `deep-research`, `academic-pipeline`, and the
`re-review` / `guided` / `calibration` modes (refused explicitly, with no
silent fallback).

- **Review state layout** under the session workspace:

```
.academic-review/<review_id>/state.json
.academic-review/<review_id>/seats/<seat_id>.json
.academic-review/<review_id>/seats/<seat_id>.md
.academic-review/<review_id>/editorial_decision.md
.academic-review/<review_id>/revision_roadmap.md
```

- **Guarantees**: the manuscript is never written to; every tool call re-verifies
  the pinned SHA-256 (`paper_changed` on drift); a finding without an evidence
  quote plus location is refused; a seat may not claim peer-output visibility;
  PDF input is rejected rather than parsed.

### Hard limits

- **Input formats**: `.md`, `.tex`, and `.txt` only. PDF is **not** parsed —
  `academic_review_create` rejects it outright. Convert first if needed.
- **Read-only manuscript**: the plugin never writes to the paper under review.
- **Phase 1 is reviewer-only**: no deep-research, no pipeline integration, and
  no re-review/guided/calibration modes in this release.
- **Two human checkpoints**: before the panel starts and before the final
  editorial decision closes the review.

## Documentation

- [`docs/PORT_SPEC.md`](docs/PORT_SPEC.md) — port specification: upstream
  inventory and dependency map, the 7-agent → 5-seat DSH mapping, the
  review-state JSON schema, the tool API, and adapter rules.
- [`docs/SEAT_PROTOCOLS.md`](docs/SEAT_PROTOCOLS.md) — how each seat is
  dispatched, what it receives and returns, and the DA CRITICAL adjudication
  and checkpoint rules.
- [`docs/UPSTREAM_INVENTORY.md`](docs/UPSTREAM_INVENTORY.md) — file-by-file
  inventory of the vendored upstream tree.
- [`docs/VERIFICATION.md`](docs/VERIFICATION.md) — verification records:
  how vendored bytes, tool behavior, and the UI were validated.
- [`MAINTENANCE.md`](MAINTENANCE.md) — upstream sync policy and release
  maintenance.
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — how to contribute.

## Install

Add the package to a DSH profile straight from this repository:

```bash
dsh plugin --profile <profile> add github:xuelinzheng41-maker/dsh-academic-review
```

A pinned tag or the release tarball works the same way:

```bash
dsh plugin --profile <profile> add github:xuelinzheng41-maker/dsh-academic-review#v0.1.0
dsh plugin --profile <profile> add ./dsh-academic-review-0.1.0.tgz
```

The build output (`lib/`) is committed on purpose, so a git install needs no
build step. The bundle patch `cordis.patch.yml` inserts one plugin row
(`id: academic-review`, `name: dsh-academic-review`) configured with
`stateDir: .academic-review`.

After installing, the session gains five `academic_review_*` tools and the
`academic-paper-reviewer` skill (see `docs/PORT_SPEC.md`). A review writes to
`<workspace>/.academic-review/<review_id>/`.

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
```

Re-vendoring from a local ARS checkout (never edit vendored files by hand):

```bash
pnpm vendor -- --upstream <path to an ARS checkout>
```

The vendored tree is byte-identical to upstream and is checked against
`vendor-manifest.json` (commit `1ec249df`) by both the test suite and
`pnpm verify:vendor`.

## Trademark and endorsement disclaimer

DeepSeek, DSH, and Academic Research Skills are the marks or project names of
their respective owners. This project is an independent, unofficial port; it is
not endorsed by, affiliated with, or sponsored by DeepSeek or by the upstream
author.
