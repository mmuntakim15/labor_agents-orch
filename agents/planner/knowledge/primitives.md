# Primitives — planning a request no recipe covers (the general lane)

A request that matched no Library recipe is still planned, never improvised.
Every step of the plan is one of five primitives; a request that cannot be
expressed in them is blocked with a named gap, not padded with guesses.

## The five primitives
| Primitive | What it is | How the worker does it | Leaves |
|---|---|---|---|
| **pull** | read a fact or a set of rows from Dime (or an attachment) | `dime.js call … --out <name>`; `files.js tables` for an attachment | `data/<name>.json` + a receipt |
| **compute** | derive figures from pulled data by deterministic arithmetic | `compute.js run <verb>`; else `sandbox.js run --program` | `data/<out>.json` with a trace |
| **compare** | set two things side by side and list the differences | a compute verb (`duplicate_pairs`, `schedule_vs_actual`, `coverage_crosswalk`, …) or a sandbox program over two inputs | an Exceptions list and a tie-out line |
| **propose** | stage a change to the books for a named person | `dime.js propose --kind … --tier A|B|C` | `proposals.json` |
| **prove** | show that the result is true | receipts on every figure, `check.js run`, the Verifier's re-pull and `sandbox.js rerun` | `checks.json`, `verify.json` |

Order is almost always pull → compute → compare → (propose) → prove. A report is
pull + compute + prove; an investigation is pull + compare + prove; a change
request adds propose before prove.

## Expressing an unmatched request as steps
Write `plan.json.steps[]` as one line per primitive, in order, naming the input
and the output of each step so the worker and the Verifier can follow the data:
```
"steps": [
  "pull: GL for 2026-09 for business 6650… → data/gl-sep.json",
  "pull: vendor bills open at 2026-09-30 → data/bills-open.json",
  "compute: open_item_age over data/bills-open.json as of 2026-09-30 → data/bills-aged.json",
  "compare: sandbox program bills-vs-gl.js over data/bills-aged.json, data/gl-sep.json → data/bills-vs-gl.json (bills with no GL posting in the month)",
  "prove: Exceptions sheet rows cite the bill id and the GL line; tie-out Difference 0.00; D-1 ties_to_report"
]
```
Each **pull** is also a `calls[]` entry (method, path, purpose) found in the map.
Each **compute** or **compare** names its verb or says `sandbox program <name>.js`.
Each **propose** is also a `writes[]` entry with its tier. **prove** names the
done items it satisfies.

## Compute verb or sandbox program
1. `compute.js list` first. A verb that covers the calculation wins every time: it is tested, named, and the Verifier knows it.
2. A sandbox program only when no verb covers the arithmetic (a bespoke join, a threshold the request defines, a rollup across two pulls in a shape no verb takes). The program is pure: inputs and args in, a JSON result out; no dates from the clock (pass `asOf` in args), no randomness, no rounding the request did not ask for.
3. Say in the plan which it is: `compute: <verb>` or `compare: sandbox program <file>.js`. The Verifier reruns every sandbox program by sha and fails the work if the output differs by a byte, so a program must be deterministic.
4. A program the desk keeps writing is a verb waiting to be built; name that in `risks[]` so it is noticed.

## Naming an input
An input is anything the work needs that is not a Dime read: an attachment, a
standing file on the entity, a document the requester must still send. Name it
as `plan.json.inputs[]`: `"<file-or-source>: <what it is>, <the columns or fields the work reads>"`,
for example `"gusto-sept.csv: payroll register, columns employee, gross, taxes, net"`.
Resolve in this order and plan the first source that exists: connection → Dime
route → standing file → document from the requester. A document the requester
has not sent goes into `inputsNeeded: [{ name, period, why, acceptedTypes, standing }]`;
the request parks in awaiting_input instead of the worker guessing.

## Gaps: when a primitive cannot be satisfied
Do not plan around a hole. When a primitive has no way to be done, the plan
names the gap, the lab-result is `blocked`, and a person decides.

| gap | Meaning |
|---|---|
| `read` | a fact the work needs has no route in the map (or the route is denied by policy) and no attachment carries it |
| `compute` | the arithmetic has no verb and cannot be a pure program (needs a clock, a lookup outside the request, or data Dime does not hold) |
| `change` | the request implies a write that no proposal kind covers, or one the policy keeps for humans only |
| `prove` | the result cannot be reproduced from receipts: no route returns the figure to compare against, or the source is a screen, an email, a phone call |
| `input` | a document or standing file the work needs does not exist and the requester must be asked for it (this is `inputsNeeded`; the request parks, it is not blocked) |

The lab-result for a blocked plan:
```lab-result
{"status":"blocked","gap":"read","detail":"the request asks for Stripe payout fees by day; the map has no Stripe route and the entity has no Stripe connection","summary":"…","artifacts":["plan.json","scope.md"]}
```
and `plan.json` carries every gap found, even when the plan can proceed
around some of them:
```
"gaps": [ { "primitive": "compute", "gap": "compute", "detail": "FX gain by invoice needs daily rates Dime does not store", "blocking": true } ]
```
A plan with a blocking gap still writes `scope.md` so the approver sees what
was asked, what can be done, and exactly what is missing. `input` gaps are
`inputsNeeded`, not `gaps`; they park the request rather than block it.
