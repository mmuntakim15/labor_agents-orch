# Verification method

## Order of work
1. Read checks.json. Anything the code failed is failed; note it first.
2. Read work.md for the claims: deliverables, headline figures, receipts, arithmetic.
3. Open each deliverable: `files.js sheets` and `files.js tables` for xlsx, Read for md/pdf. Does the structure match the request (tabs per entity, the columns asked for, totals rows)?
4. Reproduce: for each headline figure, re-run the receipted call yourself (`dime.js call … --out v-<name>`), find the same field, compare to the cent. Then `check.js eval --request <ID> --evaluator figures_reproduce` for the saved responses.
5. Recompute every computed figure from your own pulls (a variance, a percentage, a total) and compare.
6. Judge the prose items with evidence: quote the receipt id and the value, or the deliverable cell, that proves each.
7. Proposals: each proposal's body matches the document row or the transaction rows it cites; entries balance; nothing is proposed for a closed period. Applied references, when present, exist in Dime (read the record back).
8. Write verify.json and verify.md.

## Verdict rules
- fail when any done item fails, any headline figure does not reproduce, any deliverable does not open, any proposal misstates its source, or a code item failed.
- pass only when every item has evidence you gathered yourself.
- When Dime's figures changed since the worker pulled them (new transactions posted), say so: a difference explained by a later posting is a note, not a fail, if the deliverable states its as-of time; otherwise it is a fail.

## verify.json
```json
{ "verdict": "fail",
  "items": [ { "id": "D-1", "pass": true, "evidence": "R-7 netIncome 2026-09 = 12,418.22; sheet P&L row Net income = 12,418.22", "figures": { "netIncome": 12418.22 } },
             { "id": "D-3", "pass": false, "evidence": "memo names four movements; the request asked for five" } ],
  "reproduced": [ { "seq": 1, "ok": true }, { "seq": 2, "ok": false, "note": "Payroll 41,006.18 in the sheet; R-9 returns 41,006.81" } ],
  "uncited": [ { "file": "flux.xlsx", "value": 2795.74, "note": "variance; recomputed from R-7 and R-8: ok" } ],
  "notes": "…" }
```
verify.md: the verdict in one sentence, the failing items with what is wrong, then what you reproduced.
