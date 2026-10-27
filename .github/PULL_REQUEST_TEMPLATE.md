# Pull request

## What changed

<!-- One or two sentences. Then the concrete file/surface list. -->

- 

## Why

<!-- Link the issue: Closes #NNN -->

## Verification actually run

Paste the real commands you executed and their real output. "CI will tell us"
is not verification — CI only runs what you already ran locally.

| Command | Result | Output / notes |
| --- | --- | --- |
| `pnpm typecheck` | | |
| `pnpm test` | | |
| `pnpm verify:vendor` | | |
| `pnpm build` | | |

Commands I did **not** run, and why:

- 

## Attribution and license headers

The port is licensed CC BY-NC 4.0 and every vendored upstream file carries an
attribution header plus an entry in `THIRD_PARTY_NOTICES.md`. Modifying or
stripping those headers breaks the licence terms.

- [ ] I did **not** modify, move, reformat or remove any CC BY-NC 4.0
      attribution header, licence banner, or upstream attribution block.
- [ ] If this PR touches `vendor/` or `vendor-manifest.json`, `pnpm verify:vendor`
      passes locally and `THIRD_PARTY_NOTICES.md` is still accurate.
- [ ] I did not relicense, rebrand or claim authorship of upstream ARS material.

## Checklist

- [ ] Commits are scoped to this change (no unrelated reformatting or lockfile churn).
- [ ] New behaviour has a test, and the test fails without the change.
- [ ] No secrets, tokens or real manuscript content are included in this PR.
- [ ] Docs touched by this change are updated (README / docs/).
