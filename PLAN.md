# labor-agents-orch: the ad hoc accounting request desk

Architecture review and build plan. Written 2026-11-20, revised the same day after
Mo narrowed the scope. Based on a read of `dev-agents-orch`, `dev-agents-dashboard`,
the five standalone agents under `dime-agents/`, and the agent runtime in
`ms-university`.

Status: **built and dogfooded on 2026-11-20** (see "Status" at the end of this
file). Open questions for Mo follow it.

---

## 1. Scope, stated plainly

**Out of scope, deliberately.** The month-end close, year-end close, financial
review and audit review agents are large deterministic workflows. They stay as they
are. This repo does not reimplement, wrap or replace them.

**In scope.** The requests that leadership passes down to a junior accountant and
that today cost a person hours of clicking, exporting and pasting:

- "Create a flux for the last two months and produce the report."
- "Did all of the Ramp transactions migrate? Show me what's missing."
- "Here are twelve vendor W-9s and the Q3 AP aging from the old system. Set the vendors up and tell me what doesn't tie."
- "Pull AR over 60 days for every entity in the group into one sheet, with the top ten by balance."
- "Compare September payroll in the GL to the Gusto register and explain the difference."
- "Re-run the trial balance export for FY2025 with the tax mapping and send me the CCH file."

The person types the request the way they would say it, attaches whatever they have,
and an agent takes it through intake, planning, execution, verification and delivery.
The agent finds the right Dime endpoints itself, runs them, and produces the
deliverable: a report, an export, an answer with evidence, or a set of proposed
changes for a human to approve. The dashboard is the same kind of board the dev team
has: a card per request, what stage it is in, what it is waiting on, what it cost.

That is the product shift Mo wants: a customer sends work, not clicks.

## 2. What exists today and what it is worth

### 2.1 `dev-agents-orch` is the kernel

Its one-sentence architecture carries over almost unchanged: a work item is a
folder; a column is a status in a lane; an agent is a folder of knowledge plus a
`plan()` that becomes one `claude -p` run with a narrow tool list; code feeds the
agents facts; a pure `transition()` always stops at a human gate.

Lifts verbatim: `src/ticket.js` (store), `src/claude.js` (runner with budgets,
resume, wrap-up), `hooks/guard.js` (denials independent of the allow list),
`src/knowledge.js` and `src/prompting.js` (stable prompt prefix, `<untrusted>`
fencing, context hand-off), the pure `transition()/assertPreconditions()/
approve/reject/answer`, `admission()` and the worker, `blocked {stage, kind,
reason}` with the recorded human ways out, `src/events.js` and `src/eval.js`, and
the dashboard contract that `dev-agents-dashboard` consumes.

Replaced: everything about git, worktrees, the booted stack, the codebase map,
the diff checks and the publisher. The one idea from that list that comes back in
a new form is the codebase map: this repo needs an **endpoint map** of Dime so the
agent can find the right call without guessing.

### 2.2 The standalone Dime agents already solved the Dime-facing half

| Repo | Lift |
|---|---|
| `dime-agent` (Command Center AI Mode, in prod) | `tools/api.js` (JWT minted from the product's own secret, product routes only), `src/env.js` (a job is pinned to the backend it came from), the 12 route-catalogue skills with the rule "do not guess endpoints; guessing burns the budget on 404s", `presenting.md`, `data-fidelity.md`, `page-parity.md`, the wrap-up resume pass |
| `financial-review-agent` | the gate doctrine for any write: *you propose, a named human approves, the product applies*; tiers A (one click), B (human confirms the number), C (a question, never a payload); re-read the approval at apply time; never re-propose what a human declined |
| `audit-agent` | one outbound client file so "did anything else touch the network" is one grep; a redaction chokepoint; the invented-id defence (an answer may only cite records the tools returned) |
| close engines | nothing is lifted; they keep running. The request desk may *start* a close through its product endpoint like any other call. |

### 2.3 Inside `ms-university`

- The **112-tool registry** (`services/agentTools/`), the **applier** with 35 kinds
  (`services/agentActionApplier.js`) and the **permission snapshot**
  (`actorContext`, fail closed on unmapped tools) are the pieces to consume, not fork.
- The in-app marketplace already has a one-shot planner, a `team.ask_human`
  pause, and `agentAnswerVerification.js` (every cited figure checked against what
  the source tool returned). What it lacks for this job: no replayable run, no cost,
  no file deliverables, a five-step cap, plans never revised, and the junior
  accountant's actual toolbox (exports, report generators, bulk imports, integration
  sync endpoints) is mostly outside the 112 tools and only reachable as HTTP routes.
- The external agents' **internal board** (`/api/v1/internal/<agent>` claim,
  heartbeat, events) is the shape for Phase 2.
- There is no request or outcome object anywhere, and 1,351 endpoints with no
  machine-readable catalogue an agent could search.

## 3. Target architecture

### 3.1 One sentence

**A request is a folder with the ask, the attachments and a definition of done; an
agent finds the endpoints in a generated map of Dime, plans the calls, runs the
read-only ones itself, stages any write as a proposal for a named human, and a
Verifier checks that every figure in the deliverable came from a call that was
actually made; the orchestrator applies pure transitions and the deliverable plus
its evidence is what the requester gets back.**

### 3.2 Principles

1. **Read freely, write through a gate.** Reads and exports run during the lane.
   Every write to the books is a proposal in Dime, applied by the product after a
   named human approves at the tier the policy allows. The guard enforces it.
2. **Never guess an endpoint.** The endpoint map is generated from the Dime repo,
   searchable by the agent, and the agent's HTTP tool refuses a path that is not in
   it. A 404 is a bug in the map, not a thing to retry.
3. **Every figure has a receipt.** A number in a deliverable cites the call that
   produced it (route, args hash, run, time). The Verifier re-runs the cited calls
   and fails the request when a figure does not reproduce. Lifted from
   `agentAnswerVerification` and the audit agent's invented-id defence.
4. **Small requests get no ceremony.** A read-only request sized S goes intake →
   execute → verify → deliver with no human gate. Gates appear when the request is
   ambiguous, large, or proposes writes.
5. **The deliverable is a file the requester can forward.** Reports, exports and
   memos land in `artifacts/deliverables/` in the format the request asked for
   (xlsx, csv, pdf, md, html) and in Dime's own export formats where one exists
   (the agent calls the product's export endpoint rather than rebuilding it).
6. **Everything costs money and is counted.** USD budget per request by size,
   `--max-budget-usd` per run, blocked on exhaustion, cost on every run.
7. **Same kernel as the dev team.** Same store, runner, guard, transitions,
   dashboard. Different lane, agents, tools and knowledge.

### 3.3 The request record

`requests/<ID>/request.json`, with `comments.jsonl` and `artifacts/` beside it.

```jsonc
{
  "id": "REQ-31",
  "title": "Flux for Aug and Sep 2026, Acme Dental",
  "body": "…the request as written, fenced as untrusted in prompts…",
  "attachments": [{ "name": "gusto-sept.csv", "mime": "text/csv", "bytes": 48213 }],
  "subject": { "firmId": "…", "businessIds": ["…"], "periods": ["2026-08", "2026-09"] },
  "kind": "report",                 // report | export | question | data_task | change_request
  "size": "S",                      // S | M | L: fixed at intake; L becomes a parent of child requests
  "writes": false,                  // set by intake; true forces Gate 2
  "done": [                         // definition of done, drafted by intake, editable by the requester
    { "id": "D-1", "text": "An xlsx with one tab per entity: P&L accounts, Aug, Sep, $ and % change, sorted by absolute change" },
    { "id": "D-2", "text": "Every account total ties to the P&L report Dime shows for the same period", "evaluator": "check.ties_to_report", "args": { "report": "profit_and_loss" } },
    { "id": "D-3", "text": "A one-page memo naming the five largest movements with the driver for each" }
  ],
  "status": "execute",
  "gates": { "1": {…}, "2": {…} },
  "loops": { "verify": 0 },
  "budgetUsd": 15, "runs": [],
  "proposals": [],                  // refs to Dime proposals when writes is true
  "deliverables": [],               // filled by the Deliverer
  "blocked": null, "createdAt": "…", "updatedAt": "…"
}
```

The **definition of done** is the heart of it. Intake drafts it from the request;
each item is either prose a human judges or an evaluator in `tools/check.js` that
code judges (ties to a report, row count matches, export opens, every entity
covered). The Verifier runs the evaluators and lists the prose items with the
evidence it found.

### 3.4 The lane

One lane, with the ceremony scaling to the request. `config/pipeline.json`:

```
intake → (scope → [Gate 1]) → execute → verify → ([Gate 2]) → (apply) → deliver → done
```

| Stage | Who | Produces | When it runs |
|---|---|---|---|
| intake | Intake agent (small model) | `triage.md`: kind, subject resolved against Dime (entity ids, periods, accounts), size, `writes`, definition of done, ≤3 questions | always |
| scope | Planner | `plan.json`: the calls, in order, with the map entries they use; inputs to parse; expected writes with tiers; cost estimate | size M or L, or `writes: true`, or intake had questions |
| Gate 1 | requester or their lead | approve the scope and the definition of done | only when scope ran |
| execute | one specialist (Analyst, Investigator, Preparer or Bookkeeper; chosen at intake) | `work.md`, raw pulls under `artifacts/data/`, receipts in `receipts.jsonl`, draft deliverables | always |
| verify | Verifier (read-only tools, different session) | `verify.json`: each done item with pass/fail and figures; every cited figure reproduced or flagged | always; fail loops to execute (budget `loops.verify`, default 2) |
| Gate 2 | named human in Dime | approve, edit or reject each proposal | only when proposals exist |
| apply | Applier (deterministic) | calls Dime's approve endpoint per approved proposal; `applied.json` with references | only after Gate 2 |
| deliver | Deliverer (low effort) | `deliverables/*`, `summary.md` for the requester, `evidence.html` | always |
| done | | requester can **send back** with a note, which re-enters execute with the note (counts as a verify loop) | |

Size L requests become parents: the Planner emits `plan.children[]` (one child per
entity, per period, per source) and the parent delivers when every child has. Same
mechanism as epics in the dev repo.

**Fast lane:** kind `report | export | question`, size S, `writes: false`, no
questions. Intake and execution run as one combined run; still verified, still
delivered with evidence. This is the "just do it" path and should be most of the
volume.

Admission: at most one running request per `businessId` that has `writes: true`;
read-only requests run concurrently up to `concurrency.maxRuns`.

### 3.5 Agents

One folder each: `agents/<name>/{AGENT.md, REQUIREMENTS.md, knowledge/, index.js}`.
Every charter states **Unacceptable failures** and **System of record**.

| Agent | Does | Cannot |
|---|---|---|
| **Intake** | classify, resolve the subject against Dime (entity names → ids, "last two months" → periods, "Ramp" → the connection), size, decide `writes`, draft the definition of done, ask ≤3 questions only the requester can answer | start work, write anything but `triage.md` |
| **Planner** | find the calls in the endpoint map, order them, name inputs to parse, list expected writes with tiers, estimate cost, split L into children | invent an endpoint, lower a tier |
| **Analyst** | reports, comparisons, flux, aging, KPIs; pulls through the map, computes in the artifacts folder, writes xlsx/pdf/md deliverables with receipts on every figure | write to Dime |
| **Investigator** | "did X happen", "what is missing", "why does Y differ": pulls both sides, reconciles, lists exceptions with ids, states what it could not determine | guess; write to Dime |
| **Preparer** | document-driven tasks: parse the attachments (W-9s, agings, registers, statements), map to Dime records, stage writes as proposals (vendors, customers, bulk imports, journal entries) | apply |
| **Bookkeeper** | ledger changes a request asks for (reclass, accrual, fix), always as proposals, always with the balanced entry shown | apply, touch a closed period |
| **Verifier** | re-run every receipted call with read-only tools, reproduce each figure, run the done evaluators, write `verify.json` | propose, apply, edit a deliverable |
| **Deliverer** | package deliverables in the asked-for formats, write the requester summary and the evidence page | change a figure |
| **Applier** (code) | after Gate 2, apply approved proposals through Dime, record references, re-read the approval at apply time | apply a tier C item or anything without an approver name |

Phase 1 ships Intake, Planner, Analyst, Investigator, Verifier, Deliverer. Preparer,
Bookkeeper and the Applier come with writes in Phase 2.

### 3.6 The agent's tool surface

Countable with `ls tools/`, and the only things the Bash allow list admits.

- **`tools/map.js`** — the endpoint map. `lab map` generates
  `knowledge/generated/ENDPOINTS.json` from `routes/` and `controllers/` in the
  ms-university checkout (method, path, auth middleware, controller function, the
  query and body keys it reads, the response shape where the controller is explicit,
  the export formats it supports) plus a short purpose line per route taken from the
  12 route-catalogue skills. The agent queries it: `node tools/map.js search "flux"`,
  `node tools/map.js show GET /api/v1/accountant/analytics/flux/:businessId`.
  The dev repo's `codemap.js` already parses these files; this is a second output
  of the same parser.
- **`tools/dime.js`** — the only network path. `call <METHOD> <path> [--query …]
  [--body @file] [--out file]`. Refuses a path that is not in the map, refuses a
  non-GET when the request's `writes` is false, pins the backend per request
  (`src/env.js`), mints the JWT the way `dime-agent/tools/api.js` does, writes
  every call as a receipt `{seq, method, path, argsHash, status, bytes, at, outFile}`
  to `receipts.jsonl`, and saves large responses to `artifacts/data/` so the model
  reads a file instead of a 2 MB tool result. Non-GET calls go through the
  product's propose endpoints only (Phase 2) and return a proposal id.
- **`tools/files.js`** — attachments and pulled data: `tables <file>` (csv, xlsx, pdf
  tables → json rows), `text <file>` (pdf, docx → text), `head`, `stats`. Read only.
- **`tools/export.js`** — deliverables: `xlsx` (sheets from json, number formats,
  frozen headers), `csv`, `pdf` (from html), `md`. Writes only under
  `artifacts/deliverables/`. Every figure the agent places carries its receipt
  `seq` in a hidden column or footnote so the Verifier can trace it.
- **`tools/check.js`** — done evaluators: `ties_to_report`, `row_count`,
  `all_entities_covered`, `export_opens`, `figures_reproduce` (re-runs the receipts
  and compares), `no_uncited_figures`.

Guard: deny any Bash not starting with one of these five tools, deny `mongosh`,
`node -e`, `curl`, `git`, env reads, and Write outside `artifacts/`. Denials are
logged and shown on the card.

### 3.7 Three worked requests

**"Create a flux for the last two months and produce the report."**
Intake: kind `report`, size S, `writes: false`, periods 2026-08 and 2026-09 from
today's date, entity from the page the request came from, done = xlsx + memo +
ties-to-P&L. Fast lane. Analyst searches the map, finds the flux analytics route
and the P&L report route, pulls both periods, computes the variance table, writes
`flux-aug-sep.xlsx` and `flux-memo.md`, receipts on every cell. Verifier re-pulls
the P&L and confirms each account total ties, runs `no_uncited_figures`. Deliverer
packages and writes the summary. No human touched it. Cost recorded.

**"Did all of the Ramp transactions migrate?"**
Intake: kind `question`, size M (two sources, needs a cutoff), `writes: false`,
asks one question: "From which date?" Requester answers. Planner: Ramp sync status
route, Ramp event log route, bank transactions filtered by the Ramp account and
date range, the Ramp sync ledger. Investigator pulls both sides, matches on
external id, lists Ramp transactions with no Dime row and Dime rows with no Ramp
source, with ids and amounts, states the sync cursor and the last successful pull.
Verifier reproduces the counts. Deliverable: `ramp-migration-check.xlsx` (three
tabs: matched, missing in Dime, extra in Dime) and a memo that says what it could
and could not determine. If the requester replies "import the missing ones", that
is a new request with `writes: true` and the Preparer stages a bulk import proposal.

**"Here are twelve vendor W-9s and the Q3 AP aging from the old system. Set the vendors up and tell me what doesn't tie."**
Intake: kind `data_task`, size M, `writes: true`, attachments parsed to confirm
twelve W-9s and one aging. Planner: parse W-9s → vendor records, check existing
vendors by TIN and name, propose creates for the new ones (tier A), pull Dime AP
aging, compare to the attached aging. Gate 1: requester approves the scope. Preparer
stages twelve `vendor` proposals (or fewer, naming the matches) and produces the
tie-out table. Verifier confirms the proposals match the W-9 fields and the tie-out
reproduces. Gate 2: the requester approves the vendors in Dime. Applier applies and
records the new vendor ids. Deliverer: `vendor-setup.xlsx`, `ap-aging-tieout.xlsx`,
summary. The deterministic close is never involved.

### 3.8 Gates and the tier model

- **Gate 1, scope** appears only when scope ran. The dashboard shows the definition
  of done, the calls planned, the writes expected with tiers, the cost estimate and
  open questions. Editing a done item is normal and recorded.
- **Gate 2, changes** is Dime's propose → approve → apply. Tier A applies on approval
  with one click; tier B needs the human to confirm the number; tier C is a question
  and never carries a payload. A standing policy ("auto-apply vendor creates from
  W-9s for this firm") is a policy object in Dime, not a prompt instruction, and only
  arrives in Phase 3.
- **Send back** after delivery is a recorded human action that loops the request
  with the note. It counts against the verify loop budget so an unhappy requester
  cannot spend without limit.

`approve()/reject()/answer()/sendBack()` remain the only writers of gate fields. The
person's name is required.

### 3.9 Evidence

Assembled by code, per request: the request as written and its attachments; the
definition of done with each item's verdict, figures and evaluator; the receipts
(every call, args hash, status, bytes, time, run); every proposal with tier,
approver, time and applied reference; every run with agent, model, cost, turns,
guard denials and a transcript link; the deliverables. `artifacts/evidence.html`
goes with the deliverable.

### 3.10 Knowledge

- `knowledge/shared/`: house rules (the dev repo's accounting rules plus the
  standalone agents' hard rules: never fabricate a number, narrate for an accountant,
  never mention endpoints or tools in a deliverable, end with one result block),
  the request format, the lane, `learned.md`.
- `knowledge/generated/`: `ENDPOINTS.json` and `ENDPOINTS.md` from `lab map`,
  regenerated when the Dime checkout changes.
- Per agent: the route catalogue skills (one copy, split by domain), presenting
  rules, data-fidelity rules, flux and aging method notes, document parsing notes.
- Per entity standing instructions from Dime's `AgentOnboarding.assembleContext`
  through the API, so what the firm taught the in-app agents applies here.
- Lessons: `lessons.md` → `lab lessons --accept` → `learned.md`, area-scoped by
  route domain.

### 3.11 Evals and metrics

- `evals/cases/*` frozen from real requests against the QA database: intake
  classification and sizing, subject resolution ("last two months", entity names),
  endpoint selection (the planned calls must be the map entries a human would pick),
  verifier honesty (a deliverable with an invented figure must fail), refusal of an
  injected instruction in an attachment.
- Final-state evals: the xlsx opens and its totals tie; the exceptions list matches
  a known seeded gap.
- Metrics from `runs/events.jsonl`: requests delivered without a human touch,
  interventions per request, cost per request by kind and size, cycle time, send-backs,
  guard denials, 404s from the map (should be zero).

## 4. How it fits together

```
lab CLI / dev-agents-dashboard (DAO_ORCH_DIR → here)
   │
   ▼
src/orchestrator.js ──lane──▶ config/pipeline.json
   │  pure transition(), assertPreconditions(), admission(), approve/reject/answer/sendBack
   ├── src/request.js            requests/<ID>/{request.json, comments.jsonl, artifacts/}
   ├── src/plan.js               plan.json validation, children, call list against the map
   ├── src/map.js                endpoint map builder (shares the parser with dev-agents-orch codemap)
   ├── src/receipts.js           receipts.jsonl reader, figure → call tracing
   ├── src/done.js               definition-of-done catalogue, evaluator dispatch → tools/check.js
   ├── src/claude.js             claude -p runner (lifted)          hooks/guard.js (lifted)
   ├── src/knowledge.js          charters + shared + generated + area lessons   src/prompting.js (lifted)
   ├── src/evidence.js           evidence page from the stores
   ├── src/events.js             runs/events.jsonl, aggregate, metrics (lifted)
   ├── src/env.js                backend pinning + JWT minting (from dime-agent)
   └── src/board.js              Phase 2: claim/heartbeat/relay against /api/v1/internal/request-agent
```

The dashboard contract from the dev repo's ARCHITECTURE.md is kept
export-compatible, so the existing dashboard serves this orchestrator. Two
read-model adapters are needed there: the Gate 1 view renders the definition of
done, planned calls and expected writes; the Evidence tab renders `verify.json`,
receipts and deliverables with download links. Attachments already flow through
`prompting.ticketBlock`. The chat-style "New ticket" box is already the right
intake surface: type the request, drop the files, send.

## 5. Changes in `ms-university`

**Phase 1 needs none.** Reads go through product routes with a minted JWT, the way
the helper agent does in production. Deliverables are files on the worker machine,
served by the dashboard.

**Phase 2** (writes and a product surface), each its own PR:

1. `/api/v1/internal/request-agent` (`routes/internal/requestAgent.js`,
   `middleware/requestAgentAuth.js`): claim, progress, touch, resolve, fail,
   cancelled, events, workers. A copy of the financials-agent door; the third copy is
   the moment to factor `services/internalAgentBoard.js` and have the four doors use it.
2. `POST /internal/request-agent/tools/:toolId`: the financials door's tools bridge
   generalised to the whole `services/agentTools` registry with its tenancy check;
   write tools create an **`AgentProposal`** (own collection, fields from
   `FinancialsJob.Fix`: kind, tier, summary, payload, impactPreview, previousValues,
   status, reviewedBy, appliedRef, requestRef) instead of the current no-op.
3. `models/accountant/AgentRequest.js` + `/api/v1/accountant/requests`: the
   customer-facing record (title, subject, kind, status, done items with verdicts,
   proposals, deliverable file refs on Spaces, cost). The orchestrator mirrors
   `request.json` into it; the local folder stays the working copy.
4. Deliverables uploaded to Spaces through the existing temp-exports bucket helpers so
   the requester downloads from Dime, not from a Mac mini.

**Phase 3**: a Requests tab under Workforce (board, request page with done items,
proposals, deliverables, send-back), standing approval policies, `actorContext`
re-validation per stage so an offboarded requester's queued request stops.

## 6. Build plan

### Phase 0, scaffold (days 1 to 3)
- Repo, zero deps, Node 20, `node:test`, `CLAUDE.md` with the dev repo's rules
  (no deps; agents never apply or move a gate; pure transitions with tests; one agent
  one folder; artifacts are the only channel; never read env).
- Lift `src/{ticket→request,claude,knowledge,prompting,events,eval}.js`, `hooks/guard.js`,
  `bin/dao→bin/lab`, `config/agents.json`, the dashboard contract.
- Port `src/env.js` and `tools/api.js → tools/dime.js` from `dime-agent`; the route
  catalogue skills; `doctor`.
- `lab map` against the ms-university checkout; `ENDPOINTS.json` with a purpose line
  on at least the analytics, reports, transactions, integrations and exports routes.
- `lab doctor`: claude answers, QA API answers, JWT mints, map is fresh, dashboard
  contract test passes.

### Phase 1, read-only requests end to end (weeks 1 to 3)
- Agents: Intake, Planner, Analyst, Investigator, Verifier, Deliverer.
- `tools/files.js`, `tools/export.js`, `tools/check.js` with the six evaluators.
- Dogfood on a QA entity, in this order: the flux report (fast lane), the Ramp
  migration check (question with one clarification), "AR over 60 days across all
  entities into one sheet" (size L, children per entity).
- Dashboard pointed here; Gate 1 and Evidence adapters.
- Evals frozen from the three requests plus the failure cases (invented figure, injected
  instruction in a csv, endpoint not in the map).
- Exit: all three delivered, the flux with zero human touches, every figure traced to a
  receipt, cost per request known.

### Phase 2, writes and the product surface (weeks 3 to 6)
- Preparer, Bookkeeper, Applier; `writes: true` path through Gate 2.
- The internal door, the generalised tools bridge, `AgentProposal`, `AgentRequest`,
  Spaces upload (§5 items 1 to 4).
- Worker on a Mac mini claiming from the board; one worker per machine until OQ-1.
- Dogfood: the W-9 vendor setup; "reclass these twelve transactions to Meals" with the
  balanced entries shown.
- Exit: a write request completes with the human touching Gate 1 and Gate 2 only.

### Phase 3, the desk as a product (weeks 6 to 10)
- Requests tab in the website; send-back from the page; standing approval policies.
- Request templates from the ones that recur (flux, aging, integration check,
  payroll tie-out) as one-click starters that still run the same lane.
- Cost ledger → price per request kind and size.
- Extract the shared kernel into a package used by both orchestrators, once both are stable.

## 7. Risks

| Risk | Handling |
|---|---|
| One developer Claude login, one session at a time | one worker per machine in Phases 1 and 2; fleet needs an API key or per-machine logins (OQ-1); `src/claude.js` is the only file that changes |
| The agent acts as which Dime user | a per-firm service accountant user with a chosen role; `actorContext` snapshot, fail closed on unmapped tools; re-validated per stage in Phase 3 |
| Endpoint map goes stale or lists routes the agent must not call | regenerated on checkout change, `doctor` fails when older than the checkout; a deny list in `config/policy.json` (auth, billing, team, SCIM, internal, MCP, webhooks) that `tools/dime.js` refuses regardless of the map |
| Client figures in local transcripts and deliverables | `runs/` git-ignored and per machine; deliverables move to Spaces in Phase 2; redaction chokepoint for anything sent to a channel |
| A worker invents a number | receipts on every figure, Verifier reproduces each one in a separate session, `no_uncited_figures` is a done evaluator by default |
| Attachments carry instructions | all attachment text is fenced `<untrusted>`; eval case for it |
| Cost runaway on a looping verify | USD budget by size (S $8, M $20, L $45 to start), verify loop 2, blocked parks the request |
| Large responses blow the context | `tools/dime.js --out` saves to `artifacts/data/`; the house rule says read the file, never the tool result |

## 8. What success looks like in 90 days

- A controller types "flux for the last two months with a memo" on a Friday and has the
  xlsx and memo in under ten minutes without opening another screen.
- "Did all the Ramp transactions migrate" is answered with a list of ids, not an opinion.
- Twelve W-9s become twelve vendors after two clicks: approve the scope, approve the proposals.
- Every deliverable carries an evidence page a reviewer can check in two minutes.
- Cost per request kind is a known number and the price sheet is built on it.
- Adding a new kind of request is a charter folder and an evaluator or two, not a repo.

## Status, 2026-11-20 (what was built the same day)

Phases 0 to 2 are built and tested; Phase 3's in-repo parts (templates,
send-back, cost by kind and size, worker loop) are built; the website tab and
the Dime-side models are not (they change the customer product and wait for
Mo). Nothing is committed yet; the repo is initialised on `main`.

| Phase | Exit criterion | Result |
|---|---|---|
| 0 | doctor green, map built, unit tests green | `lab doctor` green on the local API (QA database); map 1,576 endpoints; 37 node:test cases green (`npm test`) |
| 1 | flux, Ramp check, multi-entity aging delivered on QA | REQ-2 flux for Widget Co: **zero human touches**, 4 runs, 6 min, $4.45, every figure reproduced. REQ-3 Ramp v3 since Oct 1: Gate 1 asked for a Ramp export, answered "cannot be confirmed from Dime alone; last sync 2026-04-17", $8.44. REQ-4 AR over 60 for three entities: Planner argued one M request over three children, approver added invoice detail at Gate 1, grand total 81,888.03, $4.56 |
| 2 | a write request applied through Gate 1 and Gate 2 only | REQ-6 two vendors from W-9s + AP aging tie-out: Preparer proposed 2 tier-A vendors (EIN masked in summaries, matched against existing vendors), Verifier passed, Gate 2 approved both, **Applier was refused by Dime's validation on the first vendor's `.example` email, stopped before the second, blocked with Dime's words**; the approver corrected both bodies, re-approved, requeued into apply; both vendors created in Dime with references; the second Verifier flagged that the corrected emails come from no document. $8.54 |
| 3 (in repo) | templates, send-back, cost by kind | `config/templates.json` + `lab new --template` + dashboard chips; send-back and override from the page; Completed & cost shows average cost by kind and size |

Deltas from the plan above: Gate 2 needs no backend change (proposals live on
the request; the Applier calls existing routes); the service user signs in
through the login route (no JWT secret, no Mongo); the realtime P&L and
balance sheet are two-period variance reports (`currentStart/currentEnd/
priorStart/priorEnd`), which the catalogue had wrong and the code-scanned map
had right; proposals can be corrected and re-approved while a request is
blocked in apply.

## 9. Open questions for Mo

- **OQ-1 Runtime identity for a fleet.** **Decided 2026-11-20 (Mo): developer
  Claude logins.** The runner stays on `claude -p`; one or two runs per machine.
- **OQ-2 System of record.** **Decided 2026-11-20 (Mo): for now, work against
  Dime's existing data from the local request store; no Dime-side models yet.
  Do not create or move fake records in Dime for testing; use the data that is
  there.** The two sample vendors created during the W-9 dogfood stay as they are.
- **OQ-3 Who can submit.** Firm users only, or business (client) users as well? Client
  requests change the permission snapshot and who approves Gate 1. Owner: Mo / product.
- **OQ-4 Deliverable formats.** xlsx, csv, pdf, md to start; is a Google Sheet or a
  Slack post a required channel in Phase 1? Owner: Mo.
- **OQ-5 Gate 1 threshold.** Proposed: no gate for size S read-only requests. Should any
  request from a client user always stop at Gate 1? Owner: Mo / accounting PO.
- **OQ-6 Pricing unit.** Per request by kind and size (needs the cost ledger), or
  included in the plan up to a monthly count? Owner: Mo.
- **OQ-7 Route deny list.** The proposed deny list (auth, billing, team, SCIM, internal,
  MCP, webhooks, integrations' connect flows). Anything to add or remove? Owner: Mo.
- **OQ-8 Transcript retention.** How long do run transcripts with client figures stay
  on the worker machine? Owner: Mo / compliance.
