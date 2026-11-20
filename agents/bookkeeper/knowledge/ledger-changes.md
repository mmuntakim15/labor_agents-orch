# Ledger changes in Dime

## Journal entries (Dime's conventions)
A journal entry is a set of `TransactionItem` lines sharing one `journal_id`. GL-only lines use `account_id: "gl_999999"`; the chart-of-accounts **name** goes in `accounting_category` and its **type** (Expense, Liability, …) in `accounting_accounts`. `glType` is `debit` or `credit`; `amountDirection` is `inflow` for a debit and `outflow` for a credit; `amount` is absolute. Debits equal credits to the cent.

The entry file you pass to `dime.js propose --entry-file` is:
```json
{ "date": "2026-09-30", "memo": "Accrue September cleaning (invoice 10-02)",
  "lines": [
    { "account": "Cleaning Expense", "type": "Expense",   "debit": 2400.00, "credit": 0 },
    { "account": "Accrued Liabilities", "type": "Liability", "debit": 0, "credit": 2400.00 }
  ] }
```
The proposal body is what the journal-entry route reads (see `map.js show POST /api/v1/transactions/…` for the exact names); build it from the same lines. The tool refuses an entry that does not balance.

## Finding the rows
- Transactions: `PATCH /api/v1/transactions/accounting/bookkeeping/V2/businessId/<id>` with `{date:{start,end}, type:'accounting'|'financial', dql?, paginated:true, page, limit}` (a READ). Cite the receipt and the row ids.
- Chart of accounts: the invite/chartAccount list route for the business; copy names and types verbatim.
- Period locks: the accounting-period routes (workpapers-close domain) say which periods are closed. Read them first.

## Reclass (moving an expense)
When the rows are bank/card transactions: propose `--kind transaction_categorization --tier A` per row (or the bulk categorisation route when it exists) with the target account as Dime names it. When no row exists (the amount sits in a journal), propose a journal entry that debits the target and credits the source.

## Accruals
Two proposals: the accrual dated the period end (tier B when the amount came from a document), and the reversal dated the first day of the next period. Summary of the second says "reverses P-n".

## Questions (tier C)
Capitalise versus expense over the firm's threshold; which period when the request does not say and the invoice date and service date differ; anything over a materiality the requester did not set. `dime.js propose --tier C --summary "<the question>"` stages it as a question for the approver.

## work.md
Rows found (receipts, ids, amounts); period state (receipt); each proposal as a table:

| Account | Debit | Credit |
|---|---:|---:|
| Cleaning Expense | 2,400.00 | |
| Accrued Liabilities | | 2,400.00 |

and the questions raised.
