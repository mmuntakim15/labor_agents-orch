# Plan standard

## plan.json
```json
{
  "size": "M",
  "writes": true,
  "worker": "preparer",
  "done": [
    { "id": "D-1", "text": "Twelve vendors proposed, one per W-9, none duplicating an existing vendor", "evaluator": "proposals_balanced" },
    { "id": "D-2", "text": "AP aging tie-out: every vendor balance in the attached aging compared with Dime's AP aging as of 2026-09-30, differences listed" }
  ],
  "calls": [
    { "method": "GET", "path": "/api/v1/accountant/vendor/business/<businessId>", "purpose": "existing vendors, to avoid duplicates", "domain": "entities" },
    { "method": "GET", "path": "/api/v1/accountant/reports/ap-aging/<businessId>", "purpose": "Dime's AP aging as of 2026-09-30", "domain": "reports-analytics", "query": { "asOf": "2026-09-30" } }
  ],
  "inputs": [ "W-9-*.pdf: twelve vendor W-9s; read name, TIN, address", "ap-aging-q3.xlsx: vendor, current, 30, 60, 90, total" ],
  "writes": [ { "kind": "vendor", "tier": "A", "summary": "create vendor from W-9", "count": 12 } ],
  "steps": [ "parse the W-9s", "list existing vendors", "propose one vendor per new W-9", "pull Dime's AP aging", "compare and list differences", "write vendor-setup.xlsx and ap-aging-tieout.xlsx", "write work.md" ],
  "estimateUsd": 9,
  "children": [],
  "questions": [],
  "risks": [ "the attached aging may be as of a different date than quarter end" ],
  "context": [ { "file": "knowledge/routes/entities.md", "why": "vendor routes and the W-9 fields Dime stores" } ]
}
```
Put real ids in paths (`<businessId>` above is illustrative; use the id from the subject). `calls[].query`/`body` are optional hints for the worker. The orchestrator fills `read` and `domain` from the map.

## Finding calls
1. `map.js search <words>` with the words a product manager would use (aging, flux, profit and loss, ramp event logs, vendor).
2. `map.js show METHOD path` for the parameters the route reads. The appendix names are authoritative; a wrong parameter name is ignored silently and returns everything.
3. Read the domain catalogue when the surrounding routes matter (a list route plus its detail route; a job route plus its status route).
4. Prefer a route with `exports=xlsx` when the deliverable is that report; the worker attaches Dime's own file.
5. Long operations return a job id; plan the status route too.

## Writes and tiers
Every create/update/categorise/import/send the request implies is a `writes[]` entry. Tier A: one correct answer (a vendor from a W-9, a categorisation the rule already implies). Tier B: an amount the agent estimates (an accrual from an invoice, a bill amount). Tier C: a judgment (capitalise or expense, which period). The policy may raise a tier; it never lowers one.

## Size L: children
Split by entity, period or source so each child is S or M and self-contained. Give each a title, a one-paragraph body, kind, subject and done items. Do not plan calls for the parent; the Deliverer combines the children's deliverables.

## Estimating cost
Roughly $0.15 per call made and read, $1 to $3 for a workbook with a memo, $2 to $5 for parsing a stack of documents, plus $1 for verification. Say the number and what drives it.

## scope.md
One page: what will be done, which Dime reads, what will be proposed (count and tier), what the deliverables are, the cost estimate, the assumptions the approver can veto, the data that is missing.
