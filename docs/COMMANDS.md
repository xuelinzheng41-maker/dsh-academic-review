# COMMANDS — `/ars-review` and `/ars-review-status`

Two human slash commands sit on top of the review state layer. They are thin
adapters: every transition, schema check, atomic write, and lifecycle guard
still lives in `src/state.ts` (`ReviewStore`), exactly the layer the five
`academic_review_*` tools drive. A review opened from `/ars-review` is
indistinguishable from one opened by the model — same directory, same
`state.json`, same checkpoints — and the read-only panel routes stay read-only
(no write path was added for the commands).

| Command | Hint | Reads/writes |
| --- | --- | --- |
| `/ars-review` | `[quick|full] <path-to-manuscript>` | writes: `ReviewStore.create` |
| `/ars-review-status` | `[review_id]` | reads only: `ReviewStore.list` / `read` / `status` |

Both commands resolve their workspace the same way the tools do
(`workspaceOfAgent`: the configured `workspaceRoot`, else the session cwd), so
state lands in `<workspace>/<stateDir>/<review_id>/` with the default
`stateDir` being `.academic-review`.

## 1. `/ars-review [quick|full] <path-to-manuscript>`

Opens a peer-review run for one manuscript.

Arguments:

- `quick` | `full` — optional mode token, first token only. `full` (default)
  lays out all five seats (`eic`, `methodology`, `domain`, `perspective`,
  `da`); `quick` lays out the EIC seat alone. `methodology-focus` (EIC +
  methodology) is also accepted because the state layer implements it. The
  upstream `re-review`, `guided`, and `calibration` modes are refused, never
  simulated.
- `<path-to-manuscript>` — required, `.md`, `.tex`, or `.txt`. Relative paths
  resolve against the process cwd. Surround the path with quotes if it
  contains spaces.

On success it prints, in plain text: the `review_id`, the mode and seat list,
the resolved review directory, any warnings (e.g. an oversized manuscript),
and the exact next call. Example:

```text
Review rev-20261027-8bc42b2d created (quick mode, 1 seat).
Manuscript: D:/papers/paper.md (2001 bytes, sha256 cc2e5cb0...)
Review directory: D:/ws/.academic-review/rev-20261027-8bc42b2d
Seats:
  - eic (EIC): Journal-Fit Reviewer / Editor-in-Chief - pending
Next step - attach the field-analyst pass (human checkpoint 1):
  academic_review_confirm(
    review_id="rev-20261027-8bc42b2d",
    action="attach",
    primary_discipline="<primary discipline>", secondary_disciplines=["<secondary discipline>"],
    research_paradigm="<paradigm>", methodology_type="<methodology type>",
    target_journal_tier="<tier>", paper_maturity="<maturity>",
    configuration_cards=[
      {"seat": "eic", "identity": "<...>", "expertise": "<...>", "focus": "<...>"}
    ]
  )
Then show those cards to the user and record the checkpoint with academic_review_confirm(review_id="rev-20261027-8bc42b2d", action="confirm") only after they approve them; no seat may be dispatched before that.
```

The handoff to the tools is exactly this, in order:

1. `academic_review_confirm(review_id, action="attach", …)` — stores the
   field-analyst output and moves `created → awaiting_panel_confirmation`.
   One configuration card per non-DA seat is required (`full` = four cards,
   `quick` = one); the Devil's Advocate takes none.
2. `academic_review_confirm(review_id, action="confirm")` — records human
   checkpoint 1 (`awaiting_panel_confirmation → in_review`) *after the user
   approves the cards*. Nothing confirms implicitly.
3. `academic_review_submit(review_id, seat_id, report)` — one immutable card
   per seat.
4. `academic_review_report(review_id)` — writes the draft decision letter and
   roadmap; `approve=true` only after the user approves the draft.

Refusals are one actionable line each (never a stack trace) and leave no state
behind: a `.pdf` manuscript (`PDF manuscripts are not supported by this Phase 1
port … extract the text to .md, .tex, or .txt`), a missing or unreadable file
(`cannot read manuscript "<path>": …`), an unimplemented mode, or missing
arguments (the usage line `Usage: /ars-review [quick|full]
<path-to-manuscript>`).

## 2. `/ars-review-status [review_id]`

Reports one review: lifecycle status and mode, per-seat state with the
committed verdict, the pending human checkpoint, the advisory decision when
synthesis has run, which seats are still open, and the exact next call.

- `[review_id]` — optional. Omitted (or empty) means "the newest review in this
  workspace", chosen from `ReviewStore.list()` by `updated_at`.
- Unknown ids refuse with `review "<id>" was not found under <root>`.
- A workspace with no reviews refuses with `no reviews in <root> yet - open one
  with /ars-review [quick|full] <path-to-manuscript>`.

Example:

```text
Review rev-20261027-8bc42b2d: awaiting_synthesis_approval (quick mode)
Manuscript: D:/papers/paper.md
Seats (1/1 submitted):
  - eic (EIC): submitted, verdict major_revision
Pending checkpoint: report_approval
Decision: major_revision
Review directory: D:/ws/.academic-review/rev-20261027-8bc42b2d
Next: ask the user to approve the draft letter, then call academic_review_report(review_id="rev-20261027-8bc42b2d", approve=true)
```

The `Next:` line is derived from the record's status:

| Status | Next call |
| --- | --- |
| `created`, `panel_configured` | `academic_review_confirm(action="attach", …)` |
| `awaiting_panel_confirmation` | `academic_review_confirm(action="confirm")` after the user approves the cards |
| `in_review` | `academic_review_submit` for each open seat |
| `all_submitted` | `academic_review_report(review_id)` (draft, `approve` unset) |
| `awaiting_synthesis_approval` | `academic_review_report(review_id, approve=true)` after approval |
| `report_ready` | nothing pending; prints the letter and roadmap paths |
| `abandoned` | open a new run with `/ars-review` |

## 3. Host API (verified, not guessed)

Registration uses the command registry service from `@deepseek-ai/dsh-commands`:

```ts
ctx.commands.register({
  name: 'ars-review',                 // /^[a-z][a-z0-9_-]*$/u
  description: '…',                   // non-empty, shown in discovery UI
  input: { hint: '[quick|full] <path-to-manuscript>' },
  handler(invocation) {               // { commandId, agent, rawInput, attachments, signal }
    return { kind: 'success', text: '…' }  // or { kind: 'error', text: '…' }
  },
})
```

Confirmed against `@deepseek-ai/dsh-commands` `lib/types/index.d.ts`
(`CommandRuntime.register`, `CommandDefinition`, `CommandInvocation`) and the
installed 0.2.1-rc.2 runtime in DSH Desktop, where `normalizeDefinition`
enforces the name pattern, the non-empty description, the string `input.hint`,
and `normalizeResult` accepts only `{ kind: 'success' | 'error', text }`.
Registering returns a fiber-scoped disposer, so the definitions unload with the
plugin.

The registry is reached lazily — `commands` is deliberately **not** in the
plugin's `inject` list — so a headless composition without a command registry
still mounts the tools and the skill, and a registry that appears later is
picked up through the `internal/service` event.

## 4. Tests

`tests/commands.test.mjs` drives both commands through a fake command registry
(the host's job) against the real `ReviewStore`: registration and hints, the
happy path for `full`/`quick`, `.pdf` refusal, missing manuscript, empty
input, newest-review default, unknown review id, empty workspace, the fully
synthesized status render, and one parity test proving a review created by
`/ars-review` is readable through `academic_review_status`.
