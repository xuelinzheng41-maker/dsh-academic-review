# THIRD-PARTY NOTICES — dsh-academic-review

This project, `dsh-academic-review`, is an **unofficial DSH port** of the
`academic-paper-reviewer` skill from **Academic Research Skills (ARS)**. It is
not affiliated with, sponsored by, or endorsed by the upstream author or
project.

## Upstream attribution (required by CC BY-NC 4.0)

- **Work:** Academic Research Skills — skill `academic-paper-reviewer`
  (version **1.11.1**, last_updated 2026-08-15)
- **Author:** Cheng-I Wu (ORCID https://orcid.org/0009-0008-9523-0103)
- **Source:** https://github.com/Imbad0202/academic-research-skills
- **Pinned commit vendored:** `1ec249df98728682dfbbdfb940a658338bfd6f80`
- **License:** Creative Commons Attribution-NonCommercial 4.0 International
  (CC BY-NC 4.0) — https://creativecommons.org/licenses/by-nc/4.0/

## Vendored upstream content

- `vendor/academic-paper-reviewer/` — 28 Markdown files (SKILL.md, 7 agent
  definitions, 13 references, 3 templates, 3 examples), copied **unmodified**.
- `vendor/shared/` — the upstream `shared/` files referenced by the reviewer
  skill (routing core, instruction-data-boundary pattern, handoff schemas,
  cross-model verification, mode spectrum, model tiering, sprint contract
  schema, reviewer panel provenance + review contracts, revision roadmap
  schema, re-review contracts, review-target criteria binding closure), copied
  **unmodified**.

Full file-by-file inventory with sizes and SHA-256 verification procedure:
`docs/UPSTREAM_INVENTORY.md` and `docs/PORT_SPEC.md`. Byte-identity is
enforced by `vendor-manifest.json`, `pnpm verify:vendor`, and the test suite.

## Modifications (this port)

All changes relative to upstream live **outside** the vendored directories;
vendored files are byte-identical to upstream (SHA-256 verified):

1. DSH subagent prompt wrappers for the 7 reviewer roles (field_analyst
   pre-pass, 5 review seats, editorial_synthesizer final pass) in
   `assets/prompts/`.
2. Review-state tools: `academic_review_create`, `academic_review_status`,
   `academic_review_submit`, `academic_review_report` (JSON state, seat
   lifecycle, findings/evidence, timestamps, paper SHA-256 pinning).
3. Adapter layer: `.md`/`.tex`/`.txt`-only input gate, read-only-manuscript
   enforcement, human checkpoints before panel start and before final report.
4. GUI panel for review progress and decision display.
5. Tests, example materials, and DSH plugin packaging/release scaffolding.
6. Documentation: `docs/PORT_SPEC.md`, `docs/SEAT_PROTOCOLS.md`,
   `docs/UPSTREAM_INVENTORY.md`, `docs/VERIFICATION.md`, this notice.

No vendored upstream file is modified; nothing in the vendored tree is
relicensed. This port adds no additional restrictions beyond CC BY-NC 4.0.

## License of this port

Because it incorporates and derives from CC BY-NC 4.0 material, this port as a
whole is distributed under **CC BY-NC 4.0** (see `LICENSE`). It must **not**
be relicensed under MIT, Apache-2.0, or any other license. Generated review
reports produced by the plugin carry the attribution footer below.

## Per-report attribution footer

Every generated review report, editorial decision letter, and revision roadmap
must end with:

> Produced with dsh-academic-review, an unofficial DSH port of the
> academic-paper-reviewer skill from Academic Research Skills by Cheng-I Wu
> (https://github.com/Imbad0202/academic-research-skills), v1.11.1,
> commit 1ec249df98728682dfbbdfb940a658338bfd6f80. CC BY-NC 4.0.
