# Request Desk — Tech Spec (RD-1)

Parent documents: BRD-RD-1 and PRD-RD-1 (PDFs in `~/Downloads`). This is the
engineering "how" for `labor_agents-orch`. Audience: engineers extending it.

## 1. Approach summary

A request is a folder; a status is a column in one lane; an agent is a folder of
knowledge plus a `plan()` that becomes one `claude -p` run with a narrow tool
surface; code feeds the agents facts (an endpoint map of Dime, parsed
attachments, deterministic done-item checks) and applies pure transitions; a
person moves the two gates; a deterministic Applier writes approved proposals
through Dime's own routes.

**Chosen design**
- Standalone Node 20 orchestrator with zero dependencies, lifted from
  `dev-agents-orch` (store, runner, guard, prompting, events, evals) and from
  `dime-agent` (HTTP client conventions, route catalogues).
- Dime is reached only over HTTP as a service accountant user signed in through
  `POST /api/v1/accountant/auth/login`. No Mongo, no in-process controller calls.
- Proposals live on the request (`artifacts/proposals.json`) in Phases 1 and 2;
  Dime needs no change. Phase 3 mirrors them into Dime.
- The dashboard is in the same repo (`dashboard/`), a thin HTTP layer over
  orchestrator functions, in Dime's theme, marked BETA.

**Rejected**
- Running the agents inside ms-university's marketplace runtime (OpenAI,
  in-memory queue, no cost ledger, no file deliverables, five-step cap): the
  work needs files, receipts and a replayable transcript; the standalone
  runner has them.
- Minting JWTs with the product's secret (the helper agent's approach): needs
  the secret and a Mongo read; the login route needs neither.
- A separate dashboard repo (the dev team's layout): one repo is simpler for an
  operator; the server still calls only orchestrator exports.
- Reimplementing xlsx with a package: the zero-dependency stance holds; a
  200-line writer/reader on `zlib` covers what deliverables need.

## 2. Data models (files, not Mongo)

### `requests/<ID>/request.json`
| Field | Type | Notes |
|---|---|---|
| id | `REQ-n` | counter in `requests/.counter` |
| title, body, reporter, backend | string | `backend` pins the request to one Dime backend for life |
| status | enum | `intake, scope, awaiting_gate_1, execute, verify, awaiting_gate_2, apply, deliver, children, done, cancelled, blocked` |
| kind | enum | `report, export, question, data_task, change_request` |
| size | enum | `S, M, L` |
| writes | bool | forces scope and Gate 2 |
| worker | enum | `analyst, investigator, preparer, bookkeeper` |
| scoped | bool | true when Scope ran; execute then requires Gate 1 |
| subject | `{businessIds[], businessNames[], periods[], accounts[]}` | resolved at intake |
| done[] | `{id, text, evaluator?, args?, expect?}` | definition of done |
| gates | `{1: {approved, by, at, note, approvals[], rejectedAt}, 2: {...}}` | written only by `approve/reject` |
| loops | `{verify}` | budget in `config/pipeline.json` plus `loopGrants` |
| pendingQuestions[], answers, sendBackNote | | |
| proposals[] | mirror of statuses | source of truth is `artifacts/proposals.json` |
| children[] | `{title, body, kind, subject, done, requestId}` | size L |
| runs[] | `{n, stage, agent, startedAt, endedAt, costUsd, numTurns, subtype, sessionId, status, verdict, durationMs, guardDenials, permissionDenials, wrappedUp, costEstimated}` | |
| budgetUsd, estimateUsd, overrides[], blocked, queued, runError, cancelled, lessonsNoted, proposalsApplied | | |

### Artifacts (`requests/<ID>/artifacts/`)
`triage.md/json` (Intake), `plan.json`, `scope.md` (Planner), `work.md`, `data/*`
(worker and HTTP tool), `deliverables/*` + `manifest.json` (export tool),
`receipts.jsonl` (HTTP tool, append-only), `proposals.json` (propose tool and
gate decisions), `checks.json` (orchestrator), `verify.json/md` (Verifier),
`applied.json` (Applier), `summary.md` (Deliverer), `evidence.json/html`
(orchestrator), `attachments/*` (requester, read-only), `lessons.md`.

### Receipts (`receipts.jsonl`)
`{seq, at, method, path, url, status|"refused", refused?, bytes, ms, argsHash, run, purpose, outFile?, proposal?}`.

### Proposals (`proposals.json`)
`{items: [{id: P-n, kind, tier: A|B|C, tierReason, summary, question?, method, path, body, amount, entry?, status, reviewedBy, reviewedAt, note, amountApproved, bodyOriginal, appliedRef {id, route, status, at, by}, error, run, at}]}`.
Status machine: `proposed → approved|rejected`, `question → answered`, `approved → applied|failed`.

### Runs (`runs/<ID>/NN-<stage>-<agent>.{prompt.md, events.jsonl, final.md, guard.jsonl}`), `runs/events.jsonl`, `runs/.sessions/<backend>.json` (token cache, never in a prompt), `runs/.stack/`.

### Endpoint map (`knowledge/generated/ENDPOINTS.json`)
`{builtAt, checkout, checkoutStamp, count, domains, endpoints: [{method, path, key, domain, purpose, auth, middleware, handler, controller, params {query[], body[], path[]}, read, denied, catalogOnly?}]}`. Built by `src/map.js` from the Dime checkout's `app.js` mounts, `routes/*`, `controllers/*` and the route catalogues; `read` = GET or in `policy.readsViaNonGet`; `denied` from `policy.deniedPrefixes|deniedPatterns|neverProposeMethods`.

Hard-delete rule: nothing here deletes; `cancel` keeps everything.

## 3. Endpoints (dashboard, `127.0.0.1:4790`)
All under sign-in (cookie session; shared key or named accounts; roles requester/approver/operator). Writes refuse cross-origin and non-JSON.

| Method | Path | Does |
|---|---|---|
| GET | `/api/session`, `/api/board`, `/api/trends`, `/api/health[?refresh=1]` | read models (ETag 304) |
| GET | `/api/requests/:id` | detail: request, summary, lane, comments, files, activity, evidence rows, scope review, proposals review, deliverables, summary.md |
| GET | `/api/requests/:id/runs/:n[?part=prompt|final]` | transcript |
| GET | `/api/requests/:id/files/<path>[?download=1]` | artifact (html served only for `evidence.html`; xlsx/docx as attachments; no path escape, no dotfiles) |
| POST | `/api/login`, `/api/logout` | |
| POST | `/api/requests` | `{body, title?, kind?, attachments?[{name,data}], start?}` → 201 detail |
| POST | `/api/requests/:id/{run,stop,approve,reject,proposal,resume,retry,budget,loop,override,sendback,cancel,amend,lessons,evidence,message}` | one orchestrator function each; the person's name from the session |

Dime side: no endpoint changes in Phases 0 to 2. Writes go through existing product routes, so `auditMiddleware` logs them under the service user.

## 4. Jobs, queues, workers
- `lab worker [--once]`: polls the store every 30 s, admits runs with `admission()` (run limit; a writing request never runs beside another on the same business), locks with a pid file in `requests/.locks/`, reconciles `running` records of dead runs as `aborted`.
- The dashboard's pump does the same every 2 s for queued requests and spawns a detached `lab run <ID>`; parents whose children are all done are re-queued automatically.
- Idempotency: a request folder is the unit; runs append; receipts and proposals append; `approve/reject/decideProposal` are guarded by status checks.
- Retries: 401 → one re-login; 429 → backoff (Retry-After honoured); connection refusal → 3 retries; a run that hits its turn or time limit gets one wrap-up resume in the same session; a run without a result block is judged on its artifacts when they are complete.

## 5. Migrations & backfills
None. The store is files; `LAB_REQUESTS_DIR`/`LAB_RUNS_DIR` move it. Phase 3 (Dime models) will be additive: `AgentRequest`, `AgentProposal` collections mirrored from the folders, with the folder staying the working copy.

## 6. Performance budget
- Endpoint map build: scans ~1,600 files; under 5 s on the dev checkout; cached until `routes/`/`app.js` change.
- Dashboard board: O(requests) file reads every 2 s; fine to a few hundred requests. Beyond that, an index file is the next step.
- A fast-lane report request: 3 model runs (intake on sonnet, analyst, verifier) plus the deliverer; target under 15 minutes wall-clock and under $8.
- Large responses are written to `data/` by the HTTP tool and read as files; prompts never carry more than the clipped excerpts in `prompting.js`.

## 7. Test plan
`npm test` (node:test, no model, no network beyond loopback):
- `test/units.test.js`: store, guard (AC-02 refusals, AC-05 no env), xlsx round trip, map scan and match and policy denial, proposals tiers and balancing (AC-09), plan validation, receipts and done evaluators, result parsing, evals, knowledge assembly (every charter has the two required sections).
- `test/transition.test.js`: every transition rule, fast lane (AC-01 shape), gates as the only writers, Gate 2 requires every proposal decided, send back and loop budget, override, budget (AC-06), admission, classification.
- `test/dime.test.js`: login cache, 401 re-login, 429 backoff; the HTTP tool end to end against a fake Dime: reads run with receipts and `--out`, unmapped/denied/write paths refused with nothing called (AC-02, AC-03), propose only on a writes request, businesses, dates.
- `test/orchestrator.e2e.test.js`: the stand-in model through the whole lane: fast lane zero-touch with evidence (AC-01), verify loop and code-over-model override (AC-04), writes through Gate 1, Gate 2 decisions (edited tier-B amount), Applier through the fake Dime with references and receipts, nothing written before Gate 2 (AC-03), apply failure blocks with the product's words, parent/children (AC-07), questions and budget, dry run.
- `test/dashboard.test.js`: page with the Dime shell and BETA (AC-08), sign-in, request creation with xlsx attachments and queueing, board/detail/ETag, scope review and Gate 1, Gate 2 proposals with tiers and entries, delivered view with downloads and send-back, budget unblock, questions answered from the conversation, cancel, system, CORS refusal.
- Evals (`lab eval`, real model, spend money): `evals/cases/*`.
- Dogfood (real model, local API on the QA database): the three Phase 1 requests and the W-9 request; results recorded in the request folders and in `PLAN.md`'s status section.

## 8. Build order & ownership
Built in this order, each verified before the next: kernel (store, runner, guard, knowledge, prompting, events) → Dime client and endpoint map → tools (map, dime, files, export, check) → orchestrator (transition, run, gates, admission, worker, metrics) → agents (8 charters + Applier) → dashboard → tests → docs. Shared files that every later change touches: `config/pipeline.json` (stages), `src/orchestrator.js` (`transition`, `agents` table), `dashboard/ui/app.js` (`COLS`, `STEP`).

## 9. Deltas discovered while building
- **Gate 2 needs no backend change.** The PRD's Phase 2 listed an internal door, a tools bridge and an `AgentProposal` collection in ms-university. Proposals on the request plus an Applier that calls existing product routes give the same propose → approve → apply with audit coverage; the Dime-side models move to Phase 3 (product surface) and are not required for writes.
- **Login beats JWT minting.** The helper agent mints tokens with the product's secret; the desk signs in through the login route with a service account and needs neither the secret nor Mongo.
- **`auth/me` is denied by policy but is the only profile route**, so the `businesses` verb of the HTTP tool calls it directly (not through the map) for subject resolution; agents cannot call `/auth/*` themselves.
- **Handler parameter extraction is a heuristic.** The route catalogues' appendices are authoritative; code-scanned names fill gaps and may include neighbours' parameters when controllers put several handlers in one file.
- **Tests must spawn the tools asynchronously**: a synchronous spawn blocks the event loop that serves the fake Dime in the same process.
