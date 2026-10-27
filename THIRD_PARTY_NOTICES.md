# THIRD-PARTY NOTICES — dsh-academic-review

This project, `dsh-academic-review`, is an **unofficial DSH port** of **Academic
Research Skills (ARS)**. It serves four of that repository's skills, each vendored
unmodified. It is not affiliated with, sponsored by, or endorsed by the upstream
author or project.

## Upstream attribution (required by CC BY-NC 4.0)

- **Work:** Academic Research Skills (ARS) — a suite of skills for academic
  research, writing and review.
- **Author:** Cheng-I Wu (ORCID https://orcid.org/0009-0008-9523-0103)
- **Source:** https://github.com/Imbad0202/academic-research-skills
- **Pinned commit vendored:** `1ec249df98728682dfbbdfb940a658338bfd6f80` — every vendored
  byte is the blob at this commit, taken from the git object store rather than
  from a checkout.
- **License:** Creative Commons Attribution-NonCommercial 4.0 International
  (CC BY-NC 4.0) — https://creativecommons.org/licenses/by-nc/4.0/ —
  **Copyright (c) 2026 Cheng-I Wu**, as stated in the upstream `LICENSE`.

### The four vendored skills, with the version each declares for itself

These versions are read from each tree's **own** frontmatter
(`vendor/<skill>/SKILL.md`, `metadata.version` and `metadata.last_updated`). They
differ from one another because upstream's skills are versioned separately; they are
the upstream's numbers and are not harmonised here.

| Skill | Version | SKILL.md `last_updated` | Files |
|---|---|---|---|
| `academic-paper-reviewer` | 1.11.1 | 2026-08-15 | 28 |
| `deep-research` | 2.12.1 | 2026-08-15 | 53 |
| `academic-paper` | 3.3.1 | 2026-08-15 | 63 |
| `sr-screener` | 1.0.0 | 2026-09-29 | 25 |

**No vendored tree carries a per-skill licence or author field that could differ
from the repository licence.** All four frontmatters were read to check: their only
keys are `name`, `description`, and a `metadata` block holding `version`,
`last_updated`, `status`, `data_access_level`, `task_type` and `related_skills`.
No `license`, `licence`, `copyright` or `author` key exists in any of them, and no
skill directory contains a `LICENSE` file of its own. The repository licence above
therefore governs all four uniformly, and nothing overrides it.

## Preferred citation (surfaced from upstream `CITATION.cff`, not paraphrased)

Upstream ships `CITATION.cff` at its repository root, and its `message` field is an
instruction to cite it: *"If you use this software in your research, please cite it
using the metadata from this file."* Its fields, quoted:

- `type`: software
- `title`: Academic Research Skills for Claude Code
- `authors`: Wu, Cheng-I — ORCID https://orcid.org/0009-0008-9523-0103
- `repository-code` / `url`: https://github.com/Imbad0202/academic-research-skills
- `license`: CC-BY-NC-4.0
- `version`: 3.23.2
- `date-released`: 2026-10-24
- `doi`: 10.5281/zenodo.20696614

That DOI is the **Zenodo concept DOI**: it represents all versions and always
resolves to the latest, so it identifies the work rather than the commit this port
pins. For material reproduced here, cite the software as above and name the commit
`1ec249df98728682dfbbdfb940a658338bfd6f80`.

## Vendored upstream content — 279 files

Every file listed below was copied **unmodified** from the pinned commit. Composition
per tree, counted from `vendor-manifest.json`:

- `vendor/academic-paper-reviewer/` — **28 files**, all Markdown: SKILL.md, 7 agent
  definitions, 14 references, 3 templates, 3 examples.
- `vendor/deep-research/` — **53 files**, all Markdown: SKILL.md, 14 agents, 24
  references, 6 templates, 8 examples.
- `vendor/academic-paper/` — **63 files**: 62 Markdown (SKILL.md, 12 agents, 29
  references, 11 templates, 10 examples) plus one `.tex` LaTeX template.
- `vendor/sr-screener/` — **25 files**: 15 Markdown (SKILL.md, 4 agents, 7
  references, 3 examples) plus 6 Python scripts under `scripts/`, 2 `.js` workflow
  templates and 2 `.json` templates.
- `vendor/shared/` — **110 files**: 108 reached by scanning the four skill trees'
  own references (contracts, references, routing core, handoff schemas, mode
  spectrum, model tiering, provenance and review-target criteria closure), plus **2
  vendored because a criteria-registry receipt names them** rather than because any
  vendored Markdown does:
  `shared/review_criteria_sources/msr-2027-technical-papers.2026-08-24.json`
  and `shared/review_criteria_sources/sigsoft-empirical-standards.2026-08-24.json`.
  The split is recorded deliberately: "every shared file is referenced by some
  skill" would be a false simplification, and those two files are precisely the
  counter-example.

Totals: 169 skill files + 110 shared = **279**. Byte identity is enforced by
`vendor-manifest.json` (per-file SHA-256), `pnpm verify:vendor`, and the test
suite. A file-by-file inventory with sizes for the reviewer tree is in
`docs/UPSTREAM_INVENTORY.md`; the port's structural spec is `docs/PORT_SPEC.md`.

## 89 of those files are not Markdown — including executable code

A notices file is not only about prose, so the payload is called out explicitly:
**89 of the 279 vendored files are not Markdown** — `.json` 79, `.py` 6, `.js` 2,
`.tex` 1, `.yaml` 1.

- The `.json`/`.yaml` files are contracts, schemas, criteria sources and
  configuration templates.
- The `.tex` file is `academic-paper/templates/latex_article_template.tex`.
- The **six Python scripts** are `sr-screener/scripts/build_outputs.py`,
  `build_workflow.py`, `merge_decisions.py`, `prepare_fulltext.py`,
  `prepare_records.py` and `srlib.py`, plus `sr-screener`'s two `.js` workflow
  templates.

**On those scripts, plainly:** they are vendored verbatim and pinned by SHA-256 like
every other byte, and **this plugin never executes them, never audits them, and
cannot see what they write.** Screening that depends on them works only if your host
has **Python 3.9+** (standard library only; `openpyxl` optional), and then it is the
host's shell that runs them — not this plugin, which ships text and runs no vendored
program.

## The one thing this plugin adds to the served text

Two statements that sound contradictory and are both true:

1. **Every vendored file is byte-identical to its upstream blob**, and no vendored
   file is ever edited.
2. **What the model reads is not the vendored bytes alone.** When a skill is served,
   the provider prepends a delimited block to the body: write policy A inside
   `<!-- dsh-academic-review:write-policy:begin (not upstream text) -->` …
   `<!-- dsh-academic-review:write-policy:end -->`, and, where a skill's own
   instructions name a file this package does not ship, a port notice inside
   `<!-- dsh-academic-review:port-notice:begin (not upstream text) -->` … end.

Both are runtime text, marked and delimited as **not upstream text**, and neither is
written into a vendored file. So "the vendored files are byte-identical to upstream"
and "what the model reads contains a rule of ours" are both true at once, and
neither statement contradicts the other. Under CC BY-NC 4.0 the added text is ours
to license as we do; the upstream material it sits beside is not.

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
7. The prepended runtime text described above: write policy A on every served
   skill, and the port notice on the two skills whose own instructions name a file
   this package does not ship.

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
