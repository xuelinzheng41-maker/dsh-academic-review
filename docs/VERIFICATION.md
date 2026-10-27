# VERIFICATION — T4 end-to-end, example review, and package

Recorded 2026-10-27T03:42:46.293Z by task `t4` (attempt `f9cf426d`, member `qa-verifier`).
All commands ran on this machine against the packaged tarball installed into
temporary DSH profiles — never against the working tree.

## 0. Environment

- DSH Desktop 2.0.18 runtime: Node 24.21.0 / pnpm 11.8.0 at `%USERPROFILE%\.dsh\dsh-runtimes\dsh-plugin-desktop-primary-runtime\dependencies\node\bin\node.exe`
- dsh CLI: `C:\D\Deepseek\DSH Desktop\resources\app\node_modules\@deepseek-ai\dsh\lib\bin.js` (invoked as `node <dshBin> …` because `dsh` is not on PATH in this shell)
- Package under test: `D:\Deepseek\.pack\dsh-academic-review-0.1.0.tgz` built with `pnpm pack` from the working tree (60 vendored files included; see §7).
- E2E workspace: `D:\Deepseek\.t4-e2e-workspace` containing `sample-paper.md` (2001 bytes, SHA-256 `cc2e5cb07d0f662c94bf5922425b8516e898e44e0bbec1ca70740805f0c279ca`) and a fake `paper.pdf`.

## 1. Package and install

```
node <dshBin> plugin --profile qa-verify-t4 add D:/Deepseek/.pack/dsh-academic-review-0.1.0.tgz
```
Real output (exit 0):

```
Progress: resolved 0, reused 0, downloaded 1, added 0
dependencies:
+ dsh-academic-review file:D:/Deepseek/.pack/dsh-academic-review-0.1.0.tgz
Packages: +1
Progress: resolved 1, reused 0, downloaded 1, added 1, done
Done in 595ms using pnpm v11.8.0
dsh: initialized profile qa-verify-t4 at C:\Users\ASUS\.dsh\profiles\qa-verify-t4
```

The profile's `package.json` gained bundle `dsh-academic-review` over `@deepseek-ai/dsh-base`, and `node_modules/dsh-academic-review` contains `lib`, `vendor` (60 files), `vendor-manifest.json`, `cordis.patch.yml`, `LICENSE`, `THIRD_PARTY_NOTICES.md`, `docs`, `assets`.

## 2. Plugin loads in a live session (tool + skill registration)

```
node <dshBin> --profile qa-verify-t4 headless --json "List the names of every tool available to you whose name starts with academic_review_, and the names of every skill available. Output only compact JSON. Do not start a review."
```
Real final output (exit 0):

```json
{"tools":["academic_review_create","academic_review_report","academic_review_status","academic_review_submit"],"skills":["academic-paper-reviewer","diagnose-windows-sandbox-acl"]}
```

All four tools and the vendored `academic-paper-reviewer` skill are live in the session. (`diagnose-windows-sandbox-acl` is a pre-existing user skill, not part of this plugin.)

## 3. Stage 1 — create, .pdf rejection, checkpoint refusal, paper_changed

One headless run (`--profile qa-verify-t4`, workspace `D:\Deepseek\.t4-e2e-workspace`) executing the steps in order. Real output lines:

```
STEP 1 REFUSED: Error: academic_review_create failed - unsupported_format: PDF manuscripts are not
  supported by this Phase 1 port (no PDF parsing, no OCR). Extract the text to .md, .tex, or .txt
  and create the review again.
STEP 2 OK: review_id=rev-20261027-daeafa86, paper_sha256=cc2e5cb07d0f662c94bf5922425b8516e898e44e0bbec1ca70740805f0c279ca,
  bytes=2001, seats=eic, methodology, domain, perspective, da
STEP 3 OK: status=created (full mode), pending checkpoint=field_analysis_attachment
STEP 4 REFUSED: Error: academic_review_submit failed - panel_not_confirmed: the reviewer configuration
  cards have not been confirmed by the user yet (human checkpoint 1, docs/PORT_SPEC.md section 2.2);
  no seat report may be committed before it
STEP 5 OK: status refused with paper_changed (pinned cc2e5c…279ca, now a23132…1a0df); file restored to
  2001 bytes with SHA-256 CC2E5CB07D0F662C94BF5922425B8516E898E44E0BBEC1CA70740805F0C279CA — equals step 2's hash.
SUMMARY: create_md=ok, create_pdf_refused=yes, pre_confirm_submit_refused=yes,
  paper_changed_detected=yes, paper_restored=yes
```

On-disk check after stage 1 (`D:\Deepseek\.t4-e2e-workspace\.academic-review\rev-20261027-daeafa86\state.json`): status `created`, 5 seats `pending` with role markers EIC/R1/R2/R3/DA, `checkpoints: {panel_confirmed_at: null, report_approved_at: null}`, `paper.format: "md"`, upstream `1.11.1@1ec249df`.

## 4. Stage 2 — full-mode review end to end

### 4.1 Create (live session)

```
node <dshBin> --profile qa-verify-t4 headless --json "Open a peer-review run: call academic_review_create with paper_path=sample-paper.md and mode=full. …"
```
Real output (exit 0):

```
REVIEW rev-20261027-9e9ab217 SHA cc2e5cb07d0f662c94bf5922425b8516e898e44e0bbec1ca70740805f0c279ca
```

### 4.2 Human checkpoint 1 — field analysis attach + panel confirmation

There is **no model-facing tool** for `attachFieldAnalysis`/`confirmPanel`; per PORT_SPEC §3 these are "supporting internal operations". They were driven through the installed package's exported state machine (`lib/state.js`, the exact code the tools use):

```
node D:/Deepseek/.t4-e2e-workspace/tasks/checkpoint1.mjs   # imports ReviewStore from
  %USERPROFILE%\.dsh\profiles\qa-verify-t4\node_modules\dsh-academic-review\lib\state.js
```
Real output (exit 0):

```
after attach: awaiting_panel_confirmation pending: panel_confirmation
after confirm: in_review panel_confirmed_at: 2026-10-27T11:24:57+08:00
seats: eic:dispatched,methodology:dispatched,domain:dispatched,perspective:dispatched,da:dispatched
```

> **Finding (tooling gap, non-blocking for this phase):** the four model-facing tools cannot move a review past `created` on their own — `field_analysis_attachment` and `panel_confirmation` have no tool surface, so an ordinary chat session stalls at `created` unless the user runs the exported `ReviewStore` methods out-of-band. PORT_SPEC §3 anticipated this ("may be part of create/status rather than separate tools") but T2 did not wire them. Recommend a follow-up task (e.g. an `academic_review_confirm` tool or auto-attach on first `submit`).

### 4.3 Five seat submits with evidence quotes, then report (live session)

One headless turn instructed the agent to read `sample-paper.md`, commit five seat reports through `academic_review_submit` (each finding grounded in the actual text), call `academic_review_report` without approval, then with `approve=true` plus a DA-CRITICAL adjudication. Real summary output (exit 0):

```
Panel run complete.

Seat cards committed (5/5) — every finding anchored to verbatim text in sample-paper.md:

| Seat | Verdict | Conf. | Findings |
|---|---|---|---|
| eic | major_revision | 0.72 | 3 (intro claims "three public benchmarks" but one is private; …) |
| methodology | major_revision | 0.82 | 4 (critical: single seed, no variance/CI; fixed iteration budget of 10; …) |
| domain | major_revision | 0.70 | 3 (…) |
| perspective | minor_revision | 0.58 | 3 (…) |
| da | reject | 0.66 | 4 (critical da-F1 + 3 major) |
```

`academic_review_report` (no `approve`) returned the draft with status `awaiting_synthesis_approval` — **not** `report_ready`; the tool output states approval is required. The second call with `approve: true` and `da_adjudications: [{finding_id: "da-F1", outcome: "validated", rationale: …}]` closed the review.

### 4.4 Final on-disk state (observed, not asserted)

`D:\Deepseek\.t4-e2e-workspace\.academic-review\rev-20261027-9e9ab217\`:

```
editorial_decision.md   revision_roadmap.md   state.json   seats/{eic,methodology,domain,perspective,da}.{json,md}
```

`state.json` summary:

```json
{
  "review_id": "rev-20261027-9e9ab217",
  "status": "report_ready",
  "mode": "full",
  "paper_sha256": "cc2e5cb07d0f662c94bf5922425b8516e898e44e0bbec1ca70740805f0c279ca",
  "checkpoints": { "panel_confirmed_at": "2026-10-27T11:24:57+08:00",
                   "report_approved_at": "2026-10-27T11:26:22+08:00" },
  "decision": "major_revision",
  "seats": [ {"id":"eic","status":"submitted","verdict":"major_revision","findings":3},
             {"id":"methodology","status":"submitted","verdict":"major_revision","findings":4},
             {"id":"domain","status":"submitted","verdict":"major_revision","findings":3},
             {"id":"perspective","status":"submitted","verdict":"minor_revision","findings":3},
             {"id":"da","status":"submitted","verdict":"reject","findings":4} ]
}
```

- 17 findings total; every one carries `evidence: [{quote, location}]`. All 20 evidence quotes were programmatically checked against `sample-paper.md`: 15 byte-verbatim, 5 verbatim modulo the paper's hard line-wrapping (whitespace-normalized containment: 20/20). No fabricated quotes.
- `da_critical_adjudications` holds exactly one entry — `da-F1: validated` with rationale.
- `editorial_decision.md` ends with the required footer: `Unofficial DSH port of the Academic Research Skills skill "academic-paper-reviewer" v1.11.1 by Cheng-I Wu (…, commit 1ec249df…), CC BY-NC 4.0. Not affiliated with or endorsed by the upstream author.`
- `revision_roadmap.md` groups items by severity, non-ranking, advisory-only wording.

## 5. GUI panel data surface (live HTTP, DOM-equivalent evidence)

Web profile `qa-verify-web` (same tarball + `@deepseek-ai/dsh-web-app@0.2.1-rc.2`), booted from the E2E workspace so the panel reads the same state:

```
node <dshBin> --profile qa-verify-web --host 127.0.0.1 --port 43993 --no-open
dsh web: http://127.0.0.1:43991/?token=…      # launch token
curl "http://127.0.0.1:43993/connect?token=<launch>"   # 302, sets signed session cookie
```

### GET /plugins/dsh-academic-review/reviews — 200 (authenticated)

```json
{"reviews":[
 {"review_id":"rev-20261027-9e9ab217","paper_name":"sample-paper.md","mode":"full","status":"report_ready",
  "seats":[{"seat_id":"eic","status":"submitted","findings_open":3,"findings_by_severity":{"critical":0,"major":2,"minor":1,"comment":0}},
           {"seat_id":"methodology","status":"submitted","findings_open":4,"findings_by_severity":{"critical":1,"major":2,"minor":1,"comment":0}},
           {"seat_id":"domain","status":"submitted","findings_open":3,"findings_by_severity":{"critical":0,"major":2,"minor":1,"comment":0}},
           {"seat_id":"perspective","status":"submitted","findings_open":3,"findings_by_severity":{"critical":0,"major":2,"minor":0,"comment":1}},
           {"seat_id":"da","status":"submitted","findings_open":4,"findings_by_severity":{"critical":1,"major":3,"minor":0,"comment":0}}],
  "updated_at":"2026-10-27T11:26:22+08:00","pending_checkpoint":false},
 {"review_id":"rev-20261027-daeafa86","paper_name":"sample-paper.md","mode":"full","status":"created",
  "seats":[…all pending, tallies 0…],"pending_checkpoint":true}]}
```

The list matches `state.json` exactly (both reviews, correct statuses, per-seat findings tallies, checkpoint flag).

### Auth and mutation gates (observed)

- No cookie → `GET /plugins/dsh-academic-review/reviews` → **401** `{"error":"unauthorized"}`
- Authenticated `POST` on the list route → **405**
- Authenticated `POST` on detail/report paths → 405 (from the host SPA fallback; see defect below)
- Unknown review id `rev-20260101-00000000` → 404

### DEFECT (packaging/UI, blocks the detail + report routes): prefix route never matches

`GET /plugins/dsh-academic-review/reviews/<id>` and `…/<id>/report` return **404 with an empty body** in a real DSH host, although the same handlers return 200 when invoked directly. Root cause: `src/web.ts` registers the prefix route with a **trailing slash** (`REVIEWS_ROUTE_ROOT + '/'`), but the host webServer matcher (`@deepseek-ai/dsh-host-webserver`, `match()`) only accepts a prefix when `pathname.startsWith(prefix + "/")`. For a prefix already ending in `/` the test becomes `startsWith("…reviews//")`, which never matches, so every subpath request falls through to the SPA fallback (404). The exact-route list (`/reviews`, no trailing slash) works, which is why unit tests with a fake registrar passed: the fake accepted any prefix string.

Reproduction (host matcher semantics):

```
prefixes = Map{ "/plugins/dsh-academic-review/reviews/" }
match("/plugins/dsh-academic-review/reviews/rev-20261027-9e9ab217")  // -> undefined (never matches)
match("/plugins/dsh-academic-review/reviews/")                        // -> matches itself only
```

Fix (one line in `src/web.ts`): register the prefix without the trailing slash (`path: REVIEWS_ROUTE_ROOT`) — the host then matches `…/reviews/<anything>` and the handler already dispatches on the subpath. Re-run the 4 web-route tests plus a live boot afterwards. **Impact:** the panel's per-review detail view and "Open report" (fetch of `editorial_decision.md`) cannot load in a real host until fixed; the review list view does load.

## 6. .pdf rejection

Observed in §3 step 1: `academic_review_create` on `paper.pdf` refuses with `unsupported_format: PDF manuscripts are not supported by this Phase 1 port (no PDF parsing, no OCR)…`. No PDF was ever parsed in this phase.

## 7. Tarball

`D:\Deepseek\.pack\dsh-academic-review-0.1.0.tgz` — `pnpm pack` output, 60 vendored files included (28 under `vendor/academic-paper-reviewer/`, 32 under `vendor/shared/`), plus lib, docs, assets, LICENSE, THIRD_PARTY_NOTICES.md, cordis.patch.yml, vendor-manifest.json. Install from the tarball is what §1–§5 exercised.

## 8. Example review artifacts

`examples/review-example/` in the repo now contains the sample paper and the generated artifacts of §4: `sample-paper.md`, `state.json`, `editorial_decision.md`, `revision_roadmap.md`, and `seats/{eic,methodology,domain,perspective,da}.{json,md}`.

## 9. Verdict per PORT_SPEC §6 (label mapping noted in the spec)

| Criterion | Result |
| --- | --- |
| Full-mode E2E: 5 seat cards + decision letter + roadmap, both checkpoints | **PASS** (observed; checkpoint 1 driven via exported state machine — see finding in §4.2) |
| .pdf rejected at create; .md accepted | **PASS** |
| SHA-256 pinning; `paper_changed` on byte flip | **PASS** |
| Human checkpoints enforced (submit refused pre-confirm; report refused without `approve`) | **PASS** |
| Installable DSH plugin archive incl. vendored content + notices | **PASS** (`pnpm pack` + real profile install + live session) |
| GUI panel reads the same state | **PARTIAL** — list route PASS (200, matches state.json, auth-gated, GET-only); detail/report routes **FAIL** in a real host (§5 defect, one-line fix in `src/web.ts`) |
| No PDF input in this phase | **PASS** |

Blocking finding for a T3 follow-up: the trailing-slash prefix route defect above. Everything else observed green.


---

# VERIFICATION — T9 re-verification (current)

Recorded 2026-10-27T12:10+08:00 by task `t9` (attempt `f1a0ef95`, member `qa-verifier`),
after t7 (prefix-route fix) and t8 (`academic_review_confirm` tool) landed.
Everything below ran on a FRESH tarball and FRESH profiles `t9-verify` / `t9-web`
(t4's `qa-verify-*` profiles were not reused), and — stricter than t4 — the whole
review flow was driven through tool calls only, in live chat sessions, with no
out-of-band `ReviewStore` calls and no imports of `lib/state.js`.

The t4 section above is kept verbatim as the historical baseline; its two findings are
re-examined here.

## 10. Local gates on the working tree

```
pnpm typecheck   -> exit 0
pnpm test        -> exit 0   (node --test reporter: "# tests 46 / # pass 46 / # fail 0")
pnpm build       -> exit 0
pnpm verify:vendor -> exit 0 ("verify-vendor: 60 files byte-identical to vendor-manifest.json")
```

## 11. Fresh package and install

```
pnpm pack --pack-destination D:/Deepseek/.pack
  -> package: dsh-academic-review@0.1.0 (fresh tarball; includes lib with t7/t8 fixes)
node <dshBin> plugin --profile t9-verify add D:/Deepseek/.pack/dsh-academic-review-0.1.0.tgz
  -> exit 0  "+ dsh-academic-review file:D:/Deepseek/.pack/dsh-academic-review-0.1.0.tgz"
node <dshBin> plugin --profile t9-verify add @deepseek-ai/dsh-headless@0.2.1-rc.2
  -> exit 0  "+ @deepseek-ai/dsh-headless 0.2.1-rc.2"
```

Fresh E2E workspace `D:\Deepseek\.t9-e2e-workspace` (sample-paper.md copied from
examples/, sha256 `cc2e5cb0…279ca`, 2001 bytes; fake paper.pdf). The installed
profile's `lib/state.js` and `lib/web.js` are byte-identical to the tarball copies.

## 12. Tools-only full flow (live headless chat sessions, profile t9-verify)

### 12.1 Tool surface

```
$ node <dshBin> --profile t9-verify headless --json "List every academic_review_* tool …"
{"tools":["academic_review_confirm","academic_review_create","academic_review_report",
 "academic_review_status","academic_review_submit"],
 "skills":["academic-paper-reviewer","diagnose-windows-sandbox-acl"]}
```

**Five tools now** — `academic_review_confirm` (t8) is live.

### 12.2 Stage A — create, refusal gates, checkpoint 1 THROUGH TOOLS ONLY

One live session, real output lines:

```
STEP 1 OK: academic_review_create refused the PDF — "unsupported_format: PDF manuscripts are not
  supported by this Phase 1 port (no PDF parsing, no OCR). Extract the text to .md, .tex, or .txt
  and create the review again."
STEP 2 OK: review_id=rev-20261027-317acee8, paper_sha256=cc2e5cb07d0f662c94bf5922425b8516e898e44e0bbec1ca70740805f0c279ca, bytes=2001, seats=[eic, methodology, domain, perspective, da]
STEP 3 OK: academic_review_confirm(action=confirm) refused — "state_conflict: the panel can only be
  confirmed from status panel_configured|awaiting_panel_confirmation, not created"
STEP 4 OK: field analysis attached from created -> awaiting_panel_confirmation; four cards stored
  (eic/methodology/domain/perspective), all five seats pending, pending checkpoint = panel_confirmation
STEP 5 OK: status=awaiting_panel_confirmation, pending checkpoint=panel_confirmation
STEP 6 OK: status=in_review; checkpoint 1 recorded — panel_confirmed timestamp 2026-10-27T11:59:05+08:00; all five seats dispatched
STEP 7 OK: status=in_review, all five seats dispatched, no submissions, pending checkpoint=none
STEP 8 OK: after appending one byte academic_review_status refused — "paper_changed: manuscript
  D:\Deepseek\.t9-e2e-workspace\sample-paper.md changed during the review (pinned cc2e5cb0…279ca,
  now a231322708b125791aefbb9a4b20509ac0392202f04e89e1b86542a3fd61a0df). Start a new review for the
  revised manuscript." After removing the byte, sha256 is back to cc2e5cb0…279ca (2001 bytes) and
  academic_review_status succeeds again.
SUMMARY create_md=ok, pdf_refused=yes, confirm_before_attach_refused=yes, attach=ok, confirm=ok, paper_changed=yes, restored=yes
```

### 12.3 Stage B — five submits + report, THROUGH TOOLS ONLY

Same review, next live session (agent read sample-paper.md, then committed):

- 5x `academic_review_submit` with genuine evidence quotes — 17 findings, 31 quotes,
  **31/31 byte-verbatim** against the manuscript (checked programmatically after the run;
  0 normalized-only, 0 fabricated).
- `academic_review_report` without approve — stayed a draft, status
  `awaiting_synthesis_approval`, NOT `report_ready`.
- `academic_review_report` with `approve=true` and
  `da_adjudications=[{finding_id:"da-F1", outcome:"validated", rationale:…}]` — closed.

A second tools-only probe (quick mode, rev-20261027-2ec4705f) re-confirmed the
approve gate live: report without approve → `awaiting_synthesis_approval`;
repeated without approve → idempotent, still not closed; only `approve=true` closes.
(The probe also surfaced correct by-design refusals: four cards on a quick panel →
`invalid_state`, submit for a seat outside the quick panel → `invalid_seat_id`.)

### 12.4 Resulting on-disk state (observed)

`D:\Deepseek\.t9-e2e-workspace\.academic-review\rev-20261027-317acee8\`:

```json
{ "review_id": "rev-20261027-317acee8", "status": "report_ready", "mode": "full",
  "paper_sha256": "cc2e5cb07d0f662c94bf5922425b8516e898e44e0bbec1ca70740805f0c279ca", "bytes": 2001,
  "checkpoints": { "panel_confirmed_at": "2026-10-27T11:59:05+08:00",
                   "report_approved_at": "2026-10-27T12:00:45+08:00" },
  "decision": "reject",
  "seats": [
    {"id":"eic","status":"submitted","verdict":"major_revision","conf":0.72,"findings":3},
    {"id":"methodology","status":"submitted","verdict":"reject","conf":0.83,"findings":4},
    {"id":"domain","status":"submitted","verdict":"major_revision","conf":0.68,"findings":3},
    {"id":"perspective","status":"submitted","verdict":"minor_revision","conf":0.58,"findings":3},
    {"id":"da","status":"submitted","verdict":"reject","conf":0.78,"findings":4} ] }
```

- `field_analysis`: `analyst_run_at 2026-10-27T11:59:02+08:00`, discipline/paradigm/methodology/
  tier/maturity fields, and 4 configuration cards (seat, identity, expertise, focus) for
  eic/methodology/domain/perspective — all stored **by the tool**, no out-of-band code.
- 17 findings; 31 evidence quotes, 31/31 byte-verbatim.
- `da_critical_adjudications`: exactly `da-F1: validated`.
- `editorial_decision.md` (CC BY-NC 4.0 attribution footer intact) and
  `revision_roadmap.md` written under the review directory.

(Verdict differs from the t4 example run — reject vs major_revision — because the two
panels are independent LLM runs of the same paper; both are valid panel outcomes.)

### 12.5 GUI face (live server, FRESH profile t9-web)

```
node <dshBin> --profile t9-web --host 127.0.0.1 --port 43971 --no-open   # cwd = t9 workspace
dsh web: http://127.0.0.1:43971/?token=GWQcYEHs…
GET /connect?token=<launch>  -> 302, signed cookie set
```

All with the auth cookie unless noted:

| Request | Result |
| --- | --- |
| GET /plugins/dsh-academic-review/reviews | **200** application/json; both reviews, matches state.json |
| GET /plugins/dsh-academic-review/reviews/rev-20261027-317acee8 | **200** application/json (detail summary; no longer 404) |
| GET …/reviews/rev-20261027-317acee8/report | **200** `{"markdown":"# Editorial Decision Letter\n…CC BY-NC 4.0…"}` (full letter body) |
| HEAD …/report | **200** |
| GET …/reviews (no cookie) | **401** `{"error":"unauthorized"}` |
| GET …/reviews/<id> (no cookie) | **401** `{"error":"unauthorized"}` |
| POST …/reviews | **405**, `allow: GET, HEAD` |
| POST …/reviews/<id> | **405**, `allow: GET, HEAD` (from the plugin route, not the SPA fallback) |
| GET …/reviews/<id>/ (trailing slash) | **200** (tolerated) |
| GET …/reviews/ (bare prefix) | **404** (clean miss, not a crash) |
| GET …/reviews/rev-20990101-00000000 (invalid id) | **404** `{"error":"review_not_found"}` |

**No valid-id route returned 404** — the t7 defect is fixed on the live host.

## 13. Status of the t4 findings

1. **Prefix-route trailing-slash 404 (was §5 DEFECT) — CLOSED by t7, verified live here.**
   The tarball's `lib/web.js` registers `kind:'prefix', path: REVIEWS_ROUTE_ROOT`
   (no trailing slash; the old buggy `REVIEWS_ROUTE_ROOT + '/'` string is absent) and
   guards with the host semantics (`pathname !== prefix && !pathname.startsWith(prefix + '/')`).
   Detail and report routes returned 200 with the correct payloads on a real
   `dsh --profile t9-web` host (table above). The regression suite
   (`tests/web-routes.test.mjs` 'regression (t7)' + `tests/host-prefix-matcher.mjs`)
   is part of the 46/46 green run.
2. **Missing checkpoint tool surface (was §4.2 finding) — CLOSED by t8, verified live here.**
   `academic_review_confirm` is registered (12.1), moved the review
   created → awaiting_panel_confirmation (attach, 4 cards) → in_review (confirm) with
   `panel_confirmed_at` recorded — entirely through tool calls in a live session.
   The compatibility surface is intact as well: `ReviewStore.attachFieldAnalysis(reviewId, analysis)`
   and `ReviewStore.confirmPanel(reviewId, cards)` still exist in the shipped `lib/state.js`
   (verified in the installed package; they were NOT used to drive this run).
   Ordering/refusal semantics observed live: confirm-before-attach → `state_conflict`;
   second attach → `state_conflict`; out-of-panel seat → `invalid_seat_id`;
   wrong card count for the panel → `invalid_state`.

## 14. Items not re-verified in t9

- The t4-era stage-1 probe review and its artifacts (§3) were not re-run in this
  workspace; the equivalent gates were re-verified live instead (12.2).
- Everything else in the acceptance list was re-verified and observed.

## 15. Verdict (current, per PORT_SPEC §6)

| Criterion | Result |
| --- | --- |
| Full flow through tool calls only, live session, fresh install | **PASS** (§12) |
| academic_review_confirm: attach (4 cards) + confirm; refusals | **PASS** (§12.2) |
| 5x submit with real evidence quotes | **PASS** (31/31 byte-verbatim, §12.3–12.4) |
| report approve=false refuses to close | **PASS** (`awaiting_synthesis_approval`, idempotent, §12.3) |
| approve=true + DA-CRITICAL adjudication → report_ready | **PASS** (`da-F1: validated`, §12.3) |
| GET /reviews, /reviews/<id>, /reviews/<id>/report all 200; no 404 for valid ids | **PASS** (§12.5) |
| Unauthenticated 401; POST 405 with allow header | **PASS** (§12.5) |
| .pdf refused | **PASS** (§12.2 step 1) |
| One-byte flip → paper_changed, restorable | **PASS** (§12.2 step 8) |
| Internal ops still exported for compatibility (not used to drive) | **PASS** (§13.2) |
| vendor 60/60 byte-identical | **PASS** (§10) |
| typecheck / test (46/46) / build green | **PASS** (§10) |

Both t4 findings are CLOSED. No new findings. PASS.
