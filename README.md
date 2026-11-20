# labor-agents-orch — the Dime Request Desk (BETA)

Type a request the way leadership would say it ("flux for the last two months
with a memo", "did all the Ramp transactions migrate", "here are twelve W-9s,
set the vendors up"), attach what you have, and a team of agents takes it
through intake, scope, execution, verification and delivery. The agents find
the right Dime endpoints in a generated map, run the reads, stage any write as
a proposal a named person approves, and hand back the deliverable with a
receipt behind every figure. The accounting counterpart of `../dev-agents-orch`,
built on the same kernel.

The deterministic workflows (month-end close, year-end close, financial review,
audit review) are out of scope and stay as they are.

```
intake → (scope → Gate 1) → working → verify → (Gate 2) → (apply) → deliver → done
fast lane (size S, read-only, no questions): intake → working → verify → deliver
```

| Agent | Does | Cannot |
|---|---|---|
| **Intake** (sonnet) | kind, size, writes, subject (entities and periods resolved against Dime), definition of done, ≤3 questions | start the work |
| **Planner** | plan.json: the calls from the endpoint map, inputs to parse, writes with tiers, cost estimate; children for size L | execute, lower a tier |
| **Analyst** | reports, flux, aging, comparisons, exports; xlsx/csv/pdf/md deliverables with receipts | write to Dime |
| **Investigator** | "did X happen / what is missing / why does Y differ" with ids, counts and cutoffs | guess a match |
| **Preparer** | attachments → proposed records (vendors, customers, imports) and tie-outs | apply |
| **Bookkeeper** | reclass, accrual, categorisation as balanced proposals; judgment calls as questions | apply, touch a closed period |
| **Verifier** | read-only, fresh session: reproduces every figure, judges each done item, verdict | edit anything |
| **Deliverer** | summary for the requester, final formats | change a figure |
| **Applier** (code) | after Gate 2: sends approved proposals through Dime's own routes, records references | apply a question or anything unapproved |

## Quick start
```bash
nvm use 20
cp config/backends.local.json.example config/backends.local.json   # service login (git-ignored)
node bin/lab stack up                 # boot the Dime API from the checkout named in config/backends.json
node bin/lab map                      # build the endpoint map from that checkout (1,500+ routes)
node bin/lab doctor [--deep]          # claude, API, login, map, Chrome, agents
node bin/lab dashboard                # http://127.0.0.1:4790 (key in config/dashboard.json)
# or from the terminal:
node bin/lab new --title "Flux for the last two months" --body "Create a flux for the last two months and produce the report"
node bin/lab run REQ-1                # → done (fast lane) or the next gate
node bin/lab approve REQ-2 --gate 1 --by "Mo"
node bin/lab proposal REQ-2 P-1 --by "Mo" --decision approve [--amount 2450]
node bin/lab approve REQ-2 --gate 2 --by "Mo" && node bin/lab run REQ-2
node bin/lab sendback REQ-1 --by "Mo" --note "add the memo"
node bin/lab worker                   # process every runnable request, with locks and admission
```

## Layout
```
bin/lab                 CLI            dashboard/           web UI (server + static page, Dime theme, BETA)
config/pipeline.json    lane, gates, loops, budgets        config/policy.json   denied routes, reads-via-POST, tiers
config/backends.json    Dime backends  (+ backends.local.json: service login, git-ignored)
src/orchestrator.js     pure transitions, run loop, gates, admission, worker, metrics
src/dime.js map.js      HTTP client · endpoint map          src/done.js          definition-of-done evaluators
src/proposals.js apply.js receipts.js evidence.js           src/xlsx.js markdown.js
tools/{map,dime,files,export,check}.js   the agents' whole tool surface (the Bash allow list)
hooks/guard.js          PreToolUse guard: only the tools; no env, mongo, curl, git; writes in roots
agents/<name>/          AGENT.md · REQUIREMENTS.md · knowledge/ · index.js
knowledge/shared/       house rules, lane, request format, learned lessons
knowledge/routes/       the 12 route catalogues (from dime-agent)    knowledge/generated/  ENDPOINTS.json|md
requests/ runs/         request store and transcripts (git-ignored)   evals/cases/          frozen eval cases
docs/TECH_SPEC.md       engineering spec · PLAN.md architecture review and build plan
```

## Safety
- Model runtime is the local Claude Code CLI (the developer's login). No API key. Zero npm dependencies.
- Agents reach Dime only through `tools/dime.js`: reads run and leave receipts; a path not in the map or denied by `config/policy.json` is refused; non-read calls become proposals. The deterministic Applier writes approved proposals through Dime's own routes (validation, period locks and `auditMiddleware` apply).
- `hooks/guard.js` denies everything but the five tools, env and credential files, the database, the network and the shell, independent of the allow list; denials are logged on the run.
- Budgets in dollars per request size; verify loops capped; every intervention is a recorded action by a named person.

## Tests
```bash
npm run check && npm test       # units, transitions, HTTP tool against a fake Dime, the whole lane with a stand-in model, the dashboard
node bin/lab eval               # replay agents on frozen cases with the real model (spends a little)
```

## Working for the Dime API

In the Dime web app the Request Desk screen talks to the Dime API, and the desk is a worker of that API: it never serves
a browser. `dashboard/apiWorker.js` claims what people did in the app (`/api/v1/internal/request-desk/commands/claim`),
acts on it through the same functions the desk's own page uses, and reports each request's client view and delivered
files back. Every call goes outward, so the desk can sit behind NAT.

The worker starts with `lab dashboard` when a token is set:

- `LAB_API_TOKEN`: the shared secret; the API has the same value as `REQUEST_DESK_TOKEN`. No token, no worker.
- `LAB_API_URL`: the API's address. Defaults to the Dime backend the desk already works against (`config/backends.json`).

What crosses to the API is the client view only (`viewOf`): no cost, run counts, agent names, routes or working files.
A markdown draft is uploaded as the PDF a person opens, never as markdown. Tests: `test/apiWorker.test.js`.

