# Triage standard

## Kinds
| Kind | The requester receives | Worker |
|---|---|---|
| report | figures arranged for a question: flux, aging, comparison, KPI, trend; usually a workbook plus a memo | analyst |
| export | a file Dime already produces (an aging xlsx, a GL export, a package) fetched and attached | analyst |
| question | an answer with evidence: "did X happen", "what is missing", "why does Y differ" | investigator |
| data_task | attachments turned into Dime records or a tie-out (W-9s to vendors, an old aging compared to Dime's) | preparer |
| change_request | the books change: reclass, accrual, categorisation, fix | bookkeeper |

## Size
- **S**: one entity, up to two periods, a handful of routes, no attachment or one small one, no writes. Takes the fast lane: no scope, no Gate 1.
- **M**: several periods or sources, attachments to parse, any writes, a comparison across systems, or a question that needs a cutoff decided.
- **L**: several entities, or work that naturally splits (one child per entity, per period, or per source). The Planner writes the children; you only say L.

## writes
`true` when the request asks for anything in Dime to be created, changed, categorised, imported, sent or deleted. "Set the vendors up", "import the missing ones", "reclass", "accrue", "fix" are writes. "Show", "list", "compare", "did", "why", "export" are not. When in doubt, `true`: a proposal nobody needed costs nothing; a write nobody approved is the one failure this desk must never have.

## Resolving the subject
1. `dime.js businesses --request <ID>` lists the businesses the desk can see with their ids and names. Match the request's words to one name. Two matches → one question naming both.
2. Periods: `dime.js dates --last-months 2` (the two complete months before this one), `--month 2026-09`, `--quarter 2026-Q3`, `--year 2025`. Write the resolved periods in triage.md in words ("August and September 2026").
3. Accounts (bank accounts, GL accounts, vendors) named in the request go into `subject.accounts` as the words used; the worker resolves them.
4. A request that came from a child of a parent request already has the subject; confirm and keep it.
5. A request with a "Client context" line was sent from inside that client's workspace: that business is the subject. Never ask which entity it is for. Add other entities only when the request names them.

## Definition of done
Pick from the evaluator catalogue (`check.js catalog` lists it) for what code can check, and write plain items for what a person judges. Patterns:
- report / flux: `deliverable_exists {ext: ".xlsx"}`, `ties_to_report {report: profit_and_loss, currentStart, currentEnd, priorStart, priorEnd, businessId} expect {figure: "netIncome"}` (the realtime P&L is a two-period variance report; put the later month in current), `figures_in_data`, `export_opens`, plus prose: "a memo names the five largest movements with a driver each".
- aging across entities: `all_entities_covered`, `export_opens`, `row_count {file, min 1}`.
- question / migration check: `receipts_min {min 2}`, prose: "lists every missing item with its id and amount", "states what could not be determined".
- data_task with writes: `proposals_balanced` (when entries are involved), prose: "every proposal names the attachment row it came from", "existing records are not duplicated".
- change_request: `proposals_balanced`, prose: "the balanced entry is shown with account names as Dime spells them".
Each item: `{ "id": "D-1", "text": "…", "evaluator": "ties_to_report", "args": {…}, "expect": {…} }` or `{ "id": "D-2", "text": "…" }`.

## Questions
Ask when: two entities match; no cutoff date and the answer changes materially; the requested format is impossible; the attachment is not what the request says it is. Do not ask: which period "last month" is (use the dates tool and state it), which route to use, whether to proceed.

## Recipes (the Request Library)
A request started from the Library, or one the matcher scored at 0.8 or more, arrives with a **Recipe** block. Then:
1. Confirm it is the same request in other words (a matched recipe can be wrong; a Library-started one is given). If it is not, say so in triage.md and triage from scratch.
2. Adopt the recipe's kind, worker and period rule (resolve the rule to dates with the dates tool: `last_closed_month`, `last_week`, `prior_quarter`, `prior_year`, `year_to_date`, `business_day`, `closing_month`).
3. Carry its done items as written. Fill `{{period.start}}`, `{{period.end}}`, `{{businessId}}` with the resolved values; `{{setup.key}}` tokens are already filled from the entity's answers where they exist.
4. Setup questions: use the answers in the block; never re-ask them. An unanswered key becomes a question only when the work cannot proceed without it; otherwise state the assumption (or the default) in triage.md and name the key so a person can store the answer.
5. Inputs: list them in triage.md with the source the Planner should try first; do not ask the requester for a document the Planner may find through a connection or in Dime.
6. Write `"recipeId"` and `"recipeVersion"` into triage.json and the lab-result.
