# Investigation method

## The shape of the work
1. Name the two sides. "Did all Ramp transactions migrate" = Ramp's record of transactions (Dime's stored Ramp event log, or an attachment from Ramp) versus Dime's bank transactions for the Ramp account and the window.
2. Fix the cutoff: from the request, the requester's answer, or the connection's last sync time (say which).
3. Pull each side with `--out`. Walk pages when the route paginates. Note the receipts.
4. Match on the strongest key. Keep three lists: matched, missing in Dime, extra in Dime (or in the attachment). Count them from the files.
5. Deliver: `exceptions.xlsx` with the three tabs and a Sources tab; `work.md` with the answer, the counts, the cutoff, the sync state, and what could not be determined.

## Integration checks (Ramp, QBO, Stripe, Plaid)
- Connection and sync state live in the transactions domain (`ramp-eventLogs`, `ramp-oauth-owner`, the QBO sync ledger and event log routes, Stripe sync ledger). Read the catalogue section before pulling.
- Dime dedups external records with sync ledgers keyed `(businessId, objectType, objectId)`; a row in the ledger means Dime saw it. A Dime transaction row from an integration carries the external id in its metadata; match on that first.
- Bank transactions: `PATCH /api/v1/transactions/accounting/bookkeeping/V2/businessId/<id>` is a READ with filters in the body (`{date:{start,end}, type:'financial', paginated:true, page, limit}`); filter by account where the catalogue shows how.
- A pull sync not run since the cutoff explains "missing" rows; report that as the likely cause and let the requester run it.

## Reconciling a question with an attachment
Parse with `files.js tables`. Normalise only case and whitespace; never alter an identifier. If the attachment's key is not in Dime's rows, match on date plus absolute amount and say the match is weak.

## Writing it down
One sentence first: "Of 214 Ramp transactions since 2026-10-01, 209 are in Dime; 5 are missing (listed); 2 Dime rows have no Ramp source." Then the table of exceptions with ids and amounts. Then cutoff and sync state with receipts. Then could-not-determine.
