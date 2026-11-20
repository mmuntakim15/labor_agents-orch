# Report method

## The shape of the work
1. Resolve what to pull from the plan (or `map.js search` when the plan is thin). Read the route's parameters with `map.js show`.
2. Pull with `dime.js call … --out <name>`; one call per period or entity; name the files by what they are (`pl-2026-08`, `pl-2026-09`, `ar-aging-acme-2026-09-30`).
3. Look at the saved file with `files.js tables data/<name>.json` or the Read tool. Find the rows and the totals the route provides. Note the receipt id (R-n) the tool printed.
4. Build the deliverable's rows in a JSON file under the artifacts folder (`sheets.json`), then `export.js xlsx --name <file>.xlsx --sheets-file sheets.json --receipts R-1,R-2`.
5. Write work.md. Run `check.js run`. Fix. Finish.

## Flux (period over period)
- The realtime P&L is already a two-period variance report: `GET /api/v1/accountant/reports/profit-and-loss-realtime/<businessId>` with query `currentStart, currentEnd, priorStart, priorEnd` (all four required, YYYY-MM-DD; the catalogue's older "startDate/endDate" wording is wrong, the map's parameter list is right). Put the later month in `current` and the earlier one in `prior`. The balance-sheet variance works the same way (`balance-sheet-realtime`).
- Response shape: `periods {current, prior}`, `sections[]` (`revenue, cogs, ga, otherIncome, netIncome`, each with `label` and `rows[] {label, code, current, prior, currentTrail[], priorTrail[]}`), and `summaryCards {totalRevenue, grossProfit, operatingIncome, netIncome, …}`. The `currentTrail` arrays carry every transaction behind a row: that is where the driver of a movement is (merchant, memo, date, amount). Always save with `--out`; the file is large.
- Dime also has a saved flux object (`POST /api/v1/accountant/flux/` compares two saved trial balances); use it only when the request wants Dime's flux screen.
- One row per account as Dime names it (`label`, with `code`), in the order the sections list them, with the section subtotals kept. Columns: Account, Code, <earlier month>, <later month>, Change $, Change %. Change $ = later − earlier; Change % = Change $ ÷ |earlier| (blank when earlier is 0). Round nothing in the cells; the number format shows two decimals.
- A totals row per section that equals the sum of Dime's rows; a net income row that equals `summaryCards.netIncome` for the current period (and the prior period's figure from a second call with the periods swapped, or from the rows).
- The memo (draft `memo.md` in the artifacts folder, delivered as a pdf with `export.js pdf --name <name>.pdf --from memo.md`; a markdown file is never the deliverable): one sentence with the net movement, then the five largest movements by absolute change with the driver for each (what the detail or the GL shows), then anything that qualifies the figures (a draft period, an open reconciliation).

## Aging
`reports/ar-aging/<businessId>?asOf=YYYY-MM-DD` (and `ap-aging`). Keep the buckets as returned. For several entities: one tab per entity named by the entity, plus a Summary tab with each entity's total and a grand total. `exports=xlsx` returns Dime's own file: save it with `--out` and `export.js copy` it when the request wants Dime's format.

## Comparisons against an attachment
Parse the attachment with `files.js tables`. Match rows on the identifier the request implies (vendor name, account code, invoice number); normalise case and whitespace only. Output three tabs: Matched (both sides and the difference), Only in attachment, Only in Dime. Never force a match.

## Workbook conventions
Header row; money columns `format: "money"`; percent columns `format: "percent"` as fractions (0.073 for 7.3%); dates as ISO strings; a totals row at the bottom; one tab per entity or period; a `Sources` tab listing each receipt id, the route and the period it covered.

## What goes in work.md
- Deliverables, each with its receipts.
- Headline figures (the ones the memo quotes) with the receipt and the field they came from.
- Arithmetic for every computed figure: `Payroll change = 41,006.18 (R-2 metrics…) − 38,210.44 (R-1 …) = 2,795.74`.
- Assumptions (period boundaries, which report, which entity when the name was close).
- Could not determine: anything the routes did not give.
