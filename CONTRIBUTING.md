# Contributing to dsh-academic-skills

Thanks for your interest in this unofficial port of ARS
`academic-paper-reviewer`.

## License first

This entire repository is licensed **CC BY-NC 4.0**. By contributing you agree
your contribution is released under CC BY-NC 4.0 as part of this project. Do
not introduce code or text under MIT, Apache-2.0, or any other license, and do
not add dependencies whose licenses are incompatible with redistribution under
CC BY-NC 4.0.

## Ground rules

- **Never edit `vendor/` by hand.** The vendored upstream tree must stay
  byte-identical to commit `1ec249df98728682dfbbdfb940a658338bfd6f80`
  (checked by `pnpm verify:vendor` and the test suite). Upstream changes come
  only through the sync procedure in `MAINTENANCE.md`.
- **Read-only manuscript**: no code path may write to the paper under review.
- **Input gate**: `.md`/`.tex`/`.txt` only; never add PDF parsing.
- **Keep the two human checkpoints.** No automation may bypass the panel-start
  checkpoint or the pre-report approval.
- **No scope creep into later phases**: the `academic-pipeline` skill, plus the
  re-review/guided/calibration review modes, is explicitly out of scope; refuse it
  rather than falling back silently. `deep-research`, `academic-paper` and
  `sr-screener` are vendored and served, but as prompt-only skills — none of the
  three gets a tool, state or panel.
- **Vendored code is served, never executed.** No `child_process`, `exec`,
  `spawn` or any other execution path may exist in `src/`. A vendored script is
  pinned text, not a program this plugin runs. The reason is the honesty boundary
  policy A depends on: this plugin cannot see or audit what a script writes, so
  running one would put bytes on disk that no policy can account for.
  `tests/no-code-execution.test.mjs` fails if an execution path appears.
- Findings must carry an evidence quote plus location; seats must not see each
  other's outputs.
- **Bilingual docs**: any user-facing doc change updates **both** `README.md`
  and `README.zh-CN.md` in the same PR; `tests/readme-language-parity.test.mjs`
  fails if the two drift apart.

## Workflow

1. Open an issue describing the change.
2. Fork/branch; keep changes minimal and documented.
3. Run the full gate:

   ```bash
   pnpm typecheck && pnpm test && pnpm build && pnpm verify:vendor
   ```

4. If you changed anything that affects reviews (tools, prompts, adapters),
   update `docs/PORT_SPEC.md` / `docs/SEAT_PROTOCOLS.md` and add tests.
5. Submit a pull request referencing the issue; maintainers review for
   behavioral and licensing compliance.

## Reporting problems

Review quality bugs (wrong verdicts, missing evidence, broken checkpoint) and
licensing issues are both in scope for the tracker. Security-relevant issues
(prompt injection via manuscripts, state tampering) — please mark them clearly
in the report.
