# The lane (every agent loads this)

One lane for every request kind; the ceremony scales with the request. An
agent acts only in its own stage and writes only to the request's artifacts.

| Stage | Status | Agent | Produces | Ends when |
|---|---|---|---|---|
| Intake | `intake` | Intake | `triage.md`, `triage.json` | questions answered, or none |
| Scope | `scope` | Planner | `plan.json`, `scope.md` | **Gate 1** (size M or L, writes expected, or questions were asked) |
| Working | `execute` | the worker chosen at intake (Analyst, Investigator, Preparer, Bookkeeper) | `work.md`, `data/*`, `deliverables/*`, `proposals.json` (via the tool), `receipts.jsonl` (via the tool) | → Verify |
| Verify | `verify` | code (`checks.json`) then Verifier | `verify.json`, `verify.md` | pass → Gate 2 when proposals exist, else Deliver; fail → Working (2 loops), then blocked |
| Change approval | `awaiting_gate_2` | a named person | decisions on each proposal | **Gate 2** |
| Apply | `apply` | Applier (code) | `applied.json` | → Verify again |
| Deliver | `deliver` | Deliverer | `summary.md`, final deliverables; code writes `evidence.json/html` | `done` |

**Fast lane:** size S, kind report/export/question, no writes, no questions: Intake → Working directly, no Scope, no Gate 1.

**Parents:** a size L request gets `plan.children`; after Gate 1 each child runs its own lane; the parent delivers when every child is done.

**Send back:** a delivered request can be sent back with a note; it re-enters Working with the note in front of the worker and counts against the verify loop budget.

## Gates (humans only)
- **Gate 1, scope:** the approver accepts the definition of done, the planned calls, the expected writes and the cost. Editing a done item is normal.
- **Gate 2, changes:** each proposal is approved (tier B with the number confirmed), rejected with a note, or, for tier C, answered. The Applier sends only approved items to Dime.

## Budgets
- Model budget per request by size (S $8, M $20, L $45); exhaustion blocks the request for a person.
- Verify loops: 2. A person can allow one more or override a failing item with a recorded reason.
- Attachments and receipts are read-only. `checks.json`, `verify.json`, `applied.json`, `evidence.*` are written by code or by the Verifier only.
