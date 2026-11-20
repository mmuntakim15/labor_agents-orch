# labor-agents-orch — working rules for anyone (human or model) editing this repo

Read `README.md` for what this is, `PLAN.md` for the architecture review and
build plan, and `docs/TECH_SPEC.md` for how it fits together.

## Hard rules
1. **Zero npm dependencies.** The Claude Code CLI on this machine is the model runtime. Tests use `node:test`. If you think you need a package, you do not.
2. **Agents never write to Dime, never move a gate, never read env files.** Writes to the books are proposals; the deterministic Applier (`src/apply.js`) writes them through Dime's own routes after a named person approved them at Gate 2. `hooks/guard.js` enforces the rest for every run; `src/orchestrator.js` enforces the gates. Do not add an allow-list entry or a code path that weakens either.
3. **Never guess an endpoint.** `tools/dime.js` refuses a path that is not in `knowledge/generated/ENDPOINTS.json` or that `config/policy.json` denies. Fix the map or the policy, never the refusal.
4. **Transitions are pure functions with tests.** Any change to `transition()`, `agentsForStage()`, `assertPreconditions()` or the gate writers comes with a case in `test/transition.test.js`.
5. **One agent, one folder.** `agents/<name>/{AGENT.md, REQUIREMENTS.md, knowledge/, index.js}`. Every charter states **Unacceptable failures** and **System of record**.
6. **Artifacts are the only cross-agent channel.** An agent reads earlier artifacts and writes its own; it never edits another agent's artifact. Names are fixed in `knowledge/shared/lane.md`.
7. **Every figure has a receipt.** A number in a deliverable must come from a call in `receipts.jsonl` or from arithmetic over such numbers that the Verifier reproduces. A tool result the agent did not receipt does not exist.
8. **Never read `.env` / `config.env` files** in this repo or in the Dime checkout; the guard blocks agents, and the same rule applies to you. Backend credentials live in `config/backends.local.json` (git-ignored); only `src/dime.js` reads it.

## Layout reminders
- `config/pipeline.json` — the lane, stages, gates, loop budgets, USD budgets, concurrency.
- `config/policy.json` — denied route prefixes, read-via-non-GET allow list, writes switch.
- `config/backends.json` + `config/backends.local.json` — Dime backends (API base, checkout path) and the service login.
- `requests/<ID>/` — request store (git-ignored). `runs/<ID>/` — transcripts, receipts of runs (git-ignored).
- `knowledge/generated/ENDPOINTS.json|.md` — the endpoint map built by `lab map` from the Dime checkout.
- `dashboard/` — the web UI (server + static page); it calls orchestrator functions and never runs an agent in-process.
- Tests and trial runs use `LAB_REQUESTS_DIR`, `LAB_RUNS_DIR`, `LAB_EVENTS_FILE` and `LAB_CLAUDE_BIN` so they never write into `requests/`, `runs/` or spend money.

## Verify before you say done
```bash
nvm use 20
npm run check && npm test && node bin/lab doctor
```
A change to an agent's prompt is verified with `lab run <ID> --dry-run` (prints the assembled prompt path and tool configuration) before a paid run.
