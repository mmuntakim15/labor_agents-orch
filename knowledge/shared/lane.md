# The lane (every agent loads this)

One lane for every request kind; the ceremony scales with the request. An
agent acts only in its own stage and writes only to the request's artifacts.

| Stage | Status | Agent | Produces | Ends when |
|---|---|---|---|---|
| Intake | `intake` | Intake | `triage.md`, `triage.json` | questions answered, or none |
| Scope | `scope` | Planner | `plan.json`, `scope.md` | **Gate 1** (size M or L, writes expected, or questions were asked) |
| Waiting for a document | `awaiting_input` | a person | — | the named inputs arrive (or time out after 5 days and are marked missing); the stage that asked resumes |
| Working | `execute` | the worker chosen at intake (Analyst, Investigator, Preparer, Bookkeeper) | `work.md`, `data/*`, `deliverables/*`, `proposals.json` (via the tool), `receipts.jsonl` (via the tool) | → Verify |
| Verify | `verify` | code (`checks.json`) then Verifier | `verify.json`, `verify.md` | pass → Apply for tier-A proposals under policy, else Gate 2 when proposals wait, else Deliver; fail → Working (2 loops), then blocked |
| Change approval | `awaiting_gate_2` | a named person | decisions on each proposal | **Gate 2** |
| Apply | `apply` | Applier (code) | `applied.json` | → Verify again |
| Deliver | `deliver` | Deliverer | `summary.md`, final deliverables; code writes `evidence.json/html` | `done` |

**Fast lane:** size S, no questions, and either kind report/export/question with no writes, or every write the request plans decides to **tier A under the entity policy** (`config/policy/<businessId>.json` over `config/policy.json`): Intake → Working directly, no Scope, no Gate 1.

**Tier A applies before Gate 2:** when the Verifier passes, proposals the policy decides to tier A (and the worker staged as A) are approved as `policy@v<n>`, never under a person's name, and the Applier posts them at once; the Applier decides each one again at apply time, so a kind demoted or an entity switched to read-only since verify leaves the item pending with a note. Verify runs again, and only then does the request go to Gate 2 for what remains (tier B, questions), or to Deliver. Every policy apply is listed in the day's digest and reversible for 30 days through Dime's own routes (never a delete).

**Waiting for a document:** a Planner or worker result `{ "status": "needs_input", "inputs": [{ "name", "period", "why", "acceptedTypes" }] }` (distinct from `questions`) parks the request in `awaiting_input`. A person's message naming the input (`inputFor`) clears it; when none is left the stage that asked runs again with the file among the attachments. After the timeout the stage resumes with the inputs marked missing: say so in the work rather than stopping.

**Blocked reasons:** a capability gap is reported as `{ "status": "blocked", "gap": "read"|"compute"|"change"|"prove"|"input", "detail": "…" }`; the reason starts with that word and the desk counts them.

**Parents:** a size L request gets `plan.children`; after Gate 1 each child runs its own lane; the parent delivers when every child is done.

**Send back:** a delivered request can be sent back with a note; it re-enters Working with the note in front of the worker and counts against the verify loop budget.

## Gates (humans only; policy for tier A)
- **Gate 1, scope:** the approver accepts the definition of done, the planned calls, the expected writes and the cost. Editing a done item is normal. The gate is needed when intake confidence is low, size L, an input comes from a client, or any planned write is tier B/C.
- **Gate 2, changes:** each proposal is approved (tier B with the number confirmed), rejected with a note, or, for tier C, answered. The Applier sends only approved items to Dime. Tier-A items already applied under policy are not decided again.
- **Policy** is the only non-human writer of a proposal decision; its approvals are labelled `policy@v<n>` and an entity's `writesEnabled: false` turns them off without changing a tier.

## Budgets
- Model budget per request by size (S $8, M $20, L $45); exhaustion blocks the request for a person.
- Verify loops: 2. A person can allow one more or override a failing item with a recorded reason.
- Attachments and receipts are read-only. `checks.json`, `verify.json`, `applied.json`, `evidence.*` are written by code or by the Verifier only.
