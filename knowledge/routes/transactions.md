# Transactions

Bookkeeping transactions and journals, recurring schedules, bank statement extraction/import, bank and Stripe reconciliation, AR (invoices, credit memos, payment links), AP (bills, approvals, bill credits), contracts, and the Stripe/Square/HubSpot/Ramp/Salesforce/QBO integration plumbing. Reach for this domain whenever a request touches transaction rows, journal entries, the chart of accounts, invoices/bills, or an integration sync.

## Core transaction CRUD (routes/transaction.js @ /api/v1/transactions)

- `POST /api/v1/transactions/accounting/businessId/:businessId/transaction` — Create one accounting transaction (validated, mandatory-field + open-period enforced). Params: body = one transaction (date, amount, glType, accounting_category, ...). Auth: accountant.
- `POST /api/v1/transactions/accounting/businessId/:businessId/transactions` — Bulk create; the journal-entry create surface. Params: body = BARE ARRAY of transaction lines (or `{journalType:'intercompany',...}`); query `glJournal=true` enforces debit=credit balance. Auth: accountant.
- `PUT /api/v1/transactions/accounting/businessId/:businessId/transactionId/:transactionId` — Update/categorize one transaction (runs the categorization service, books the GL side). Params: body = fields to change. Auth: accountant.
- `PUT /api/v1/transactions/accounting/businessId/:businessId/transactions/bulk` — Bulk update. Params: body = BARE non-empty ARRAY of updates; query `isGl=true` for GL rows. Auth: accountant.
- `PUT /api/v1/transactions/accounting/businessId/:businessId/transactions/:transactionId/status` — Set status only. Params: body `{status}` ∈ `Uncategorized|AI Reviewed|Categorized`; `Uncategorized` reverses the whole booking. Auth: accountant.
- `POST /api/v1/transactions/accounting/businessId/:businessId/transactions/gl-import` — Store bulk transactions from a GL import. Params: body = imported rows. Auth: accountant.
- `GET /api/v1/transactions/accounting/bookkeeping/businessId/:businessId` — V1 transaction list. Params: query startDate, endDate, type, accountingType, accountingCategory, accountId, merchantName, transactionCategory, status, journalId, exports. Auth: accountant.
- `PATCH /api/v1/transactions/accounting/bookkeeping/V2/businessId/:businessId` — V2 transaction search (a READ; filters in body). Params: body `{date:{start,end}, type:'financial'|'accounting', dql?, glType?, status?, page?, limit?, paginated?}`. Auth: accountant.
- `PATCH /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/merchantName` — Read transactions by merchant (a READ). Params: body carries the merchant name. Auth: accountant.
- `PATCH /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/journalId` — Read all lines of one journal (a READ). Params: body `{journalId}` or query `transactionId`. Auth: accountant.
- `GET /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/transactionId/:transactionId/details` — Full details of one transaction. Auth: accountant.
- `GET /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/transactionId/:transactionId` — Read one bookkeeping transaction. Auth: accountant.
- `DELETE /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/transactionId/:transactionId` — Delete one transaction. Auth: accountant.
- `DELETE /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/journalId` — Delete every line of a journal. Params: body `{journalId}`. Auth: accountant.
- `PATCH /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/journalId/sync-dates` — Set all lines of a journal to one date. Params: body journalId + date. Auth: accountant.
- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/bulk-delete/preview` — Preview a bulk delete. Params: body filter | `dql` prompt | `transactionIds[]`; `freeText` + page/pageSize for cached pagination. Auth: accountant.
- `DELETE /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/bulk-delete` — Execute bulk delete. Params: body same selection + `confirmation: "delete N transactions"` (N = resolved count); cap 10000. Auth: accountant.
- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/transactionId/:transactionId/unlink-document` — Unlink an attached document and reset the booking. Auth: accountant.
- `GET /api/v1/transactions/accounting/businessId/:businessId/intercompany-journal/:intercompanyGroupId` — Read an intercompany journal group. Auth: accountant.
- `DELETE /api/v1/transactions/accounting/businessId/:businessId/intercompany-journal/:intercompanyGroupId` — Delete an intercompany journal group. Auth: accountant.
- `GET /api/v1/transactions/accounting/chartOfAccount/businessId/:businessId` — Chart of accounts (returns a BARE ARRAY). Params: query `exports=excel` for a spreadsheet. Auth: accountant.
- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/generateAccounts` — AI-generate CoA rows from account names. Params: body = names. Auth: accountant.
- `GET /api/v1/transactions/accounting/bookkeeping/getMetadata/businessId/:businessId` — Bookkeeping page metadata (accounts, categories, merchants, date bounds). Auth: accountant.
- `POST /api/v1/transactions/accounting/quickbook/createTransactions/businessId/:businessId` — Create transactions from a QuickBooks-shaped payload. Auth: accountant.
- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/createFromMatrix` — Create journal entries from a matrix (spreadsheet) layout. Auth: accountant.
- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/createPayrollFromMatrix` — Create payroll journal entries from a matrix layout. Auth: accountant.

## Recurring journals

- `POST /api/v1/transactions/recurring/tick` — Cron tick: post due recurring journals. Auth: machine (admin).
- `POST /api/v1/transactions/accounting/businessId/:businessId/transactions/recurring` — Create a recurring schedule. Params: body = template lines + frequency/dates. Auth: accountant.
- `GET /api/v1/transactions/accounting/businessId/:businessId/transactions/recurring` — List recurring schedules. Auth: accountant.
- `GET /api/v1/transactions/accounting/businessId/:businessId/transactions/recurring/:scheduleId` — Read one schedule. Auth: accountant.
- `PATCH /api/v1/transactions/accounting/businessId/:businessId/transactions/recurring/:scheduleId` — Update a schedule. Auth: accountant.
- `DELETE /api/v1/transactions/accounting/businessId/:businessId/transactions/recurring/:scheduleId` — Delete a schedule. Auth: accountant.
- `POST /api/v1/transactions/accounting/businessId/:businessId/transactions/recurring/:scheduleId/pause` — Pause. Auth: accountant.
- `POST /api/v1/transactions/accounting/businessId/:businessId/transactions/recurring/:scheduleId/resume` — Resume. Auth: accountant.
- `POST /api/v1/transactions/accounting/businessId/:businessId/transactions/recurring/:scheduleId/cancel` — Cancel. Auth: accountant.
- `POST /api/v1/transactions/accounting/businessId/:businessId/transactions/reversal` — Schedule an auto-reversal of a journal. Params: body journal + reversal date. Auth: accountant.

## Receipts, chat, review items

- `PUT /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/jounralFile` — Attach a receipt (multipart field `file`; yes, the path typo is real). Auth: accountant.
- `DELETE /api/v1/transactions/accounting/bookkeeping/receipt/businessId/:businessId/transactionId/:transactionId` — Remove a receipt. Auth: accountant.
- `POST /api/v1/transactions/accounting/bookkeeping/createChat` — Create a bookkeeping chat entry. Params: body incl. businessId. Auth: accountant.
- `GET /api/v1/transactions/accounting/bookkeeping/getChat/businessId/:businessId` — Read the bookkeeping chat. Auth: accountant.
- `DELETE /api/v1/transactions/accounting/bookkeeping/deleteChat/documentId/:documentId` — Delete a chat document. Auth: accountant.
- `PUT /api/v1/transactions/accounting/bookkeeping/renameMessage/documentId/:documentId` — Rename a chat message. Auth: accountant.
- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/itemsToReview` — Create/flag review items. Auth: accountant.
- `GET /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/itemsToReview` — List review items. Auth: accountant.
- `PUT /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/itemsToReview` — Update a review item's status. Auth: accountant.
- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/ai-review` — Kick off an AI review of transactions. Auth: accountant.
- `GET /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/ai-review` — Read AI-review results. Auth: accountant.

## Bank statements & reconciliation

- `POST /api/v1/transactions/accounting/bookkeeping/extract-transactions/businessId/:businessId` — Upload statement(s) (multipart); starts an ASYNC job, returns jobId. Auth: accountant.
- `GET /api/v1/transactions/accounting/bookkeeping/extract-transactions/job-status/:jobId` — Poll extraction job status. Auth: accountant.
- `GET /api/v1/transactions/accounting/bookkeeping/extract-transactions/businessId/:businessId/job-notification` — Pending extraction-job notifications. Auth: accountant.
- `GET /api/v1/transactions/accounting/bookkeeping/extract-transactions/results/:jobId` — Fetch finished extraction results. Auth: accountant.
- `POST /api/v1/transactions/accounting/bank-reconciliation/extract-transactions/businessId/:businessId/accountId/:accountId` — Extract statement rows for one account (multipart, synchronous legacy path). Auth: accountant.
- `POST /api/v1/transactions/accounting/bank-reconciliation/import-transactions` — Import extracted statement transactions (multipart, legacy). Auth: accountant.
- `POST /api/v1/transactions/accounting/bookkeeping/import-bank-statement` — Import a bank statement (multipart, new path). Auth: accountant.
- `POST /api/v1/transactions/accounting/bank-reconciliation/export-transactions` — Export statement transactions to Excel. Auth: accountant.
- `POST /api/v1/transactions/accounting/bank-reconciliation/create/businessId/:businessId/accountId/:accountId` — Create a bank reconciliation. Params: body period, statement balances, matches. Auth: accountant.
- `GET /api/v1/transactions/accounting/bank-reconciliation/businessId/:businessId` — List bank reconciliations. Auth: accountant.

## File converters

- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/extractCoaAccountNames` — Extract account names from an uploaded CoA file (multipart). Auth: accountant.
- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/convertTrialBalance` — Convert an uploaded TB file to importable rows (multipart). Auth: accountant.
- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/convertGeneralLedger` — Convert an uploaded GL file to importable rows (multipart). Auth: accountant.

## Invoices (AR) & credit memos

- `GET /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/invoices` — List invoices, filterable by date. Params: query `start`, `end` (**named `start`/`end`, NOT startDate/endDate — the wrong names are ignored silently and you get everything**), `status` (comma-separated), `q` (text search), `customer_id`, `invoiceId` (detail mode), `limit` (default 50, capped 100), `starting_after` (cursor = last `_id` of the previous page), `expandLines=true`, `type=stripe` (Stripe invoices instead of native). Auth: accountant.
- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/createInvoice` — Create an invoice. Params: body customer, line items, dates, tax. Auth: accountant.
- `GET /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/parseInvoice/:contractId` — AI-parse a draft invoice from a contract. Auth: accountant.
- `PUT /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/updateInvoice/bulk` — Bulk update invoices. Auth: accountant.
- `PUT /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/updateInvoice/:invoiceId` — Update one invoice. Auth: accountant.
- `DELETE /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/deleteInvoice/:invoiceId` — Delete a DRAFT invoice only. Auth: accountant.
- `GET /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/invoice-metadata` — Invoice-form metadata (customers, items, taxes). Auth: accountant.
- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/calculateSalesTax` — Calculate sales tax for invoice lines. Auth: accountant.
- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/invoice/:invoiceId/sendReminder` — Email a payment reminder (SENDS EXTERNAL MAIL — needs explicit go-ahead). Auth: accountant.
- `GET /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/invoice/:invoiceId/pdf` — Render the invoice PDF. Auth: accountant.
- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/invoice/:invoiceId/payment-link` — Create a Stripe payment link. Auth: accountant.
- `DELETE /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/invoice/:invoiceId/payment-link` — Remove the payment link. Auth: accountant.
- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/invoice/:invoiceId/credit-memo` — Issue a credit memo against an invoice. Auth: accountant.
- `GET /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/invoice/:invoiceId/credit-memos` — Credit memos on one invoice. Auth: accountant.
- `GET /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/invoice-credit-memos` — List all invoice credit memos. Auth: accountant.
- `GET /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/invoice-credit-memo/:creditMemoId` — Read one credit memo. Auth: accountant.
- `DELETE /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/invoice-credit-memo/:creditMemoId` — VOID a credit memo (not a hard delete). Auth: accountant.

## Bills (AP), approvals & bill credits

- `GET /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/bills` — List bills, filterable by date. Params: query `start`, `end` (**named `start`/`end`, NOT startDate/endDate**), `status` (comma-separated), `q`, `vendor` (contains match), `billId` (detail mode), `limit` (default 50, capped 100), `starting_after` (cursor = last `_id`). Auth: accountant.
- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/bill` — Create a bill. Params: body vendor, line items, dates. Auth: accountant.
- `PUT /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/bill/:billId` — Update a bill. Auth: accountant.
- `DELETE /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/bill/:billId` — Delete a bill. Auth: accountant.
- `GET /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/bill-metadata` — Bill-form metadata (vendors, accounts). Auth: accountant.
- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/bill/:billId/auto-payops` — Run automated pay-ops for a bill. Auth: accountant.
- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/bill-duplicate-check` — Duplicate-bill check before save. Params: body candidate bill fields. Auth: accountant.
- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/bills/approval-preview` — Preview which approval chain a bill would enter. Auth: accountant.
- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/bill/:billId/submit` — Submit a bill for approval. Auth: accountant.
- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/bill/:billId/approve` — Approve at the current step. Auth: accountant.
- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/bill/:billId/reject` — Reject a bill. Auth: accountant.
- `GET /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/bill/:billId/approval` — Approval state/history. Auth: accountant.
- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/bill/:billId/credit` — Issue a bill credit. Auth: accountant.
- `GET /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/bill/:billId/credits` — Credits on one bill. Auth: accountant.
- `GET /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/bill-credits` — List all bill credits. Auth: accountant.
- `GET /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/bill-credit/:creditId` — Read one bill credit. Auth: accountant.
- `DELETE /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/bill-credit/:creditId` — VOID a bill credit (not a hard delete). Auth: accountant.

## Contracts

- `GET /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/contracts` — List contracts with revenue summary. Auth: accountant.
- `GET /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/contract/:contractId` — Read one contract. Auth: accountant.
- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/contract` — Create a contract. Auth: accountant.
- `PUT /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/contract/:contractId` — Update a contract. Auth: accountant.
- `DELETE /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/contract/:contractId` — Delete a contract. Auth: accountant.
- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/contract/:contractId/auto-revops` — Run automated revenue-ops for a contract. Auth: accountant.

## Stripe integration

- `GET /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/stripe-oauthUrl` — Build Stripe OAuth URL. Auth: accountant.
- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/stripe-exchangeCode` — Exchange OAuth code, store connection. Params: body code. Auth: accountant.
- `GET /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/stripe-debugAccount` — Debug the connected account. Auth: accountant.
- `POST /api/v1/transactions/accounting/bookkeeping/stripe-createTestCharge` — Create a test charge. Auth: accountant.
- `POST /api/v1/transactions/accounting/bookkeeping/stripe-createTestInvoice` — Create a test invoice. Auth: accountant.
- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/stripe-syncEvents` — Replay stored Stripe webhook events. Auth: accountant.
- `GET /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/stripe-eventLogs` — Stripe event logs. Auth: accountant.
- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/stripe-pullSync` — Pull-sync Stripe events for this business. Auth: accountant.
- `POST /api/v1/transactions/accounting/bookkeeping/stripe-pullSyncAll` — Pull-sync Stripe for all businesses. Auth: accountant.
- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/stripe-retryFailed` — Retry failed Stripe events. Auth: accountant.
- `GET /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/stripe-reconciliation` — Stripe vs ledger reconciliation. Auth: accountant.
- `GET /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/stripe-balanceTransactions` — Stripe balance transactions. Auth: accountant.
- `GET /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/oauth-owner` — Stripe connection owner details. Auth: accountant.
- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/stripe-deauthorize` — Disconnect Stripe. Auth: accountant.

## Square integration

- `GET /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/square-oauthUrl` — Build Square OAuth URL. Auth: accountant.
- `GET /api/v1/transactions/accounting/redirect/squareup` — Square OAuth redirect landing. Auth: none.
- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/square-exchangeCode` — Exchange Square OAuth code. Auth: accountant.
- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/square-createTestPayment` — Create a test Square payment. Auth: accountant.
- `POST /api/v1/transactions/accounting/bookkeeping/square-syncTransactions` — Sync Square transactions (all connected businesses). Auth: accountant.
- `POST /api/v1/transactions/accounting/bookkeeping/square-syncInvoices` — Sync Square invoices. Auth: accountant.

## HubSpot integration

- `GET /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/hubspot-oauthUrl` — Build HubSpot OAuth URL. Auth: accountant.
- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/hubspot-exchangeCode` — Exchange HubSpot OAuth code. Auth: accountant.
- `GET /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/hubspot-oauth-owner` — HubSpot connection owner. Auth: accountant.
- `POST /api/v1/transactions/accounting/bookkeeping/hubspot-syncTransactions` — Sync HubSpot deals/transactions (all businesses). Auth: accountant.
- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/hubspot-syncEvents` — Replay stored HubSpot webhook events. Auth: accountant.
- `GET /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/hubspot-eventLogs` — HubSpot event logs. Auth: accountant.

## Ramp integration

- `GET /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/ramp-oauthUrl` — Build Ramp OAuth URL. Auth: accountant.
- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/ramp-exchangeCode` — Exchange Ramp OAuth code. Auth: accountant.
- `GET /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/ramp-oauth-owner` — Ramp connection owner. Auth: accountant.
- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/ramp-deauthorize` — Disconnect Ramp. Auth: accountant.
- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/ramp-syncEvents` — Replay stored Ramp webhook events. Auth: accountant.
- `GET /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/ramp-eventLogs` — Ramp event logs. Auth: accountant.
- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/ramp-pullSync` — Pull-sync Ramp events for this business. Auth: accountant.
- `POST /api/v1/transactions/accounting/bookkeeping/ramp-pullSyncAll` — Pull-sync Ramp for all businesses. Auth: machine (admin).
- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/ramp-setupAccounting` — Set up Ramp accounting-push connection. Auth: accountant.
- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/ramp-syncCoA` — Push CoA to Ramp. Auth: accountant.
- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/ramp-syncFields` — Push custom fields to Ramp. Auth: accountant.
- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/ramp-syncVendors` — Push vendors to Ramp. Auth: accountant.
- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/ramp-fullSync` — Full Ramp accounting sync. Auth: accountant.

## Salesforce integration

- `GET /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/salesforce-oauthUrl` — Build Salesforce OAuth URL. Auth: accountant.
- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/salesforce-exchangeCode` — Exchange Salesforce OAuth code. Auth: accountant.
- `GET /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/salesforce-oauth-owner` — Salesforce connection owner. Auth: accountant.
- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/salesforce-deauthorize` — Disconnect Salesforce. Auth: accountant.
- `POST /api/v1/transactions/accounting/bookkeeping/salesforce-syncTransactions` — Sync Salesforce transactions (all businesses). Auth: accountant.
- `POST /api/v1/transactions/accounting/bookkeeping/salesforce-syncCustomers` — Sync Salesforce customers. Auth: accountant.
- `GET /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/salesforce-eventLogs` — Salesforce event logs. Auth: accountant.

## QuickBooks Online integration

- `GET /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/qbo-oauthUrl` — Build QBO OAuth URL. Auth: accountant.
- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/qbo-exchangeCode` — Exchange QBO OAuth code. Auth: accountant.
- `GET /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/qbo-oauth-owner` — QBO connection owner. Auth: accountant.
- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/qbo-deauthorize` — Disconnect QBO. Auth: accountant.
- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/qbo-sync-coa` — Sync CoA with QBO (pull + push). Auth: accountant.
- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/qbo-sync-gl` — Sync GL from QBO. Auth: accountant.
- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/qbo-sync-tb` — Sync TB from QBO. Auth: accountant.
- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/qbo-sync-changes` — Incremental QBO change sync (shared last_sync_at cursor). Auth: accountant.
- `GET /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/qbo-eventLogs` — QBO event logs. Auth: accountant.

## Admin / Plaid refresh

- `POST /api/v1/transactions/refresh` — Refresh Plaid transactions for all users. Auth: machine (admin).
- `POST /api/v1/transactions/refresh/user` — Refresh Plaid transactions for one user. Params: body user id. Auth: machine (admin).
- `POST /api/v1/transactions/v2/refresh` — V2 Plaid sync for all users. Auth: machine (admin).

## API-client surface (routes/api/transactions.js @ /api/v1/api/transactions)

- `PATCH /api/v1/api/transactions/bookkeeping/:businessId` — Machine-key mirror of the V2 transaction search; same body filters. Auth: machine (apiClientAuth).

## Gotchas

- The V2 search, merchant search, and journal-line fetch are READS that use PATCH with filters in the request BODY — a GET with query params returns nothing useful.
- Bulk create (`.../transactions`) and bulk update (`.../transactions/bulk`) take a BARE JSON ARRAY as the body, not a wrapper object. Bulk create only balance-checks when `?glJournal=true`.
- Bulk delete is preview → confirm: the DELETE body must include the exact phrase `confirmation: "delete N transactions"` with N equal to the resolved row count; the call refuses above 10,000 rows.
- Bank statement extraction is async: POST returns a `jobId`; poll `job-status/:jobId` until done, then GET `results/:jobId`.
- The receipt-upload path is genuinely spelled `jounralFile` (typo baked into the product).
- DELETE on a bill credit or invoice credit memo VOIDS it; nothing is hard-deleted.
- `GET .../chartOfAccount/businessId/:businessId` returns a bare array (not `{data: ...}`); `?exports=excel` switches to a file response.
- Setting a transaction's status to `Uncategorized` reverses the whole booking (GL counterpart removed), not just the label.
- Creates enforce mandatory fields and closed periods — a 422 with a period message means the period is locked, not that the payload is wrong.


## Appendix — exact parameters, extracted from the controllers

Machine-extracted from the product's controller source (every `req.query` /
`req.body` key the handler actually reads). This is the authority on filter
parameter NAMES — a name not listed here is silently ignored by that route.
Meanings and formats live in the entries above; when in doubt, pass exactly
these names and verify the returned date span and row count.

- `GET /api/v1/transactions/accounting/bookkeeping/extract-transactions/job-status/:jobId` — no query/body params read
- `GET /api/v1/transactions/accounting/bookkeeping/extract-transactions/businessId/:businessId/job-notification` — no query/body params read
- `GET /api/v1/transactions/accounting/bookkeeping/extract-transactions/results/:jobId` — no query/body params read
- `POST /api/v1/transactions/refresh` — no query/body params read
- `POST /api/v1/transactions/refresh/user` — no query/body params read
- `POST /api/v1/transactions/v2/refresh` — no query/body params read
- `POST /api/v1/transactions/accounting/businessId/:businessId/transaction` — no query/body params read
- `POST /api/v1/transactions/accounting/businessId/:businessId/transactions` — query: `glJournal`
- `PUT /api/v1/transactions/accounting/businessId/:businessId/transactionId/:transactionId` — no query/body params read
- `PUT /api/v1/transactions/accounting/businessId/:businessId/transactions/bulk` — query: `isGl`
- `PUT /api/v1/transactions/accounting/businessId/:businessId/transactions/:transactionId/status` — no query/body params read
- `POST /api/v1/transactions/accounting/businessId/:businessId/transactions/gl-import` — query: `account_id`
- `POST /api/v1/transactions/recurring/tick` — no query/body params read
- `POST /api/v1/transactions/accounting/businessId/:businessId/transactions/recurring` — body: `createFirstOccurrenceNow`, `journalIdPrefix`, `journalType`, `name`, `recurrence`, `seedJournalId`, `template`, `transactionMemo`
- `GET /api/v1/transactions/accounting/businessId/:businessId/transactions/recurring` — query: `frequency`, `limit`, `search`, `skip`, `status`
- `GET /api/v1/transactions/accounting/businessId/:businessId/transactions/recurring/:scheduleId` — no query/body params read
- `PATCH /api/v1/transactions/accounting/businessId/:businessId/transactions/recurring/:scheduleId` — body: `nextRunDate`, `template`
- `DELETE /api/v1/transactions/accounting/businessId/:businessId/transactions/recurring/:scheduleId` — no query/body params read
- `POST /api/v1/transactions/accounting/businessId/:businessId/transactions/recurring/:scheduleId/pause` — no query/body params read
- `POST /api/v1/transactions/accounting/businessId/:businessId/transactions/recurring/:scheduleId/resume` — no query/body params read
- `POST /api/v1/transactions/accounting/businessId/:businessId/transactions/recurring/:scheduleId/cancel` — no query/body params read
- `POST /api/v1/transactions/accounting/businessId/:businessId/transactions/reversal` — body: `journalId`, `reversalDate`
- `GET /api/v1/transactions/accounting/bookkeeping/businessId/:businessId` — query: `accountId`, `accountingCategory`, `accountingType`, `endDate`, `exports`, `journalId`, `merchantName`, `startDate`, `status`, `transactionCategory`, `type`
- `PATCH /api/v1/transactions/accounting/bookkeeping/V2/businessId/:businessId` — no query/body params read
- `PATCH /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/merchantName` — body: `merchantName`
- `PATCH /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/journalId` — query: `transactionId` · body: `journalId`
- `GET /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/transactionId/:transactionId/details` — no query/body params read
- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/generateAccounts` — body: `names`
- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/extractCoaAccountNames` — params not auto-extracted (handler `multer` not resolved; read the controller before calling).
- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/convertTrialBalance` — params not auto-extracted (handler `multer` not resolved; read the controller before calling).
- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/convertGeneralLedger` — params not auto-extracted (handler `multer` not resolved; read the controller before calling).
- `GET /api/v1/transactions/accounting/chartOfAccount/businessId/:businessId` — query: `exports`
- `GET /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/transactionId/:transactionId` — no query/body params read
- `DELETE /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/transactionId/:transactionId` — no query/body params read
- `DELETE /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/journalId` — body: `journalId`
- `PATCH /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/journalId/sync-dates` — body: `journalId`, `targetDate`
- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/bulk-delete/preview` — no query/body params read
- `DELETE /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/bulk-delete` — body: `confirmation`
- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/transactionId/:transactionId/unlink-document` — body: `documentId`, `documentType`
- `GET /api/v1/transactions/accounting/businessId/:businessId/intercompany-journal/:intercompanyGroupId` — no query/body params read
- `DELETE /api/v1/transactions/accounting/businessId/:businessId/intercompany-journal/:intercompanyGroupId` — no query/body params read
- `PUT /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/jounralFile` — no query/body params read
- `DELETE /api/v1/transactions/accounting/bookkeeping/receipt/businessId/:businessId/transactionId/:transactionId` — no query/body params read
- `POST /api/v1/transactions/accounting/bookkeeping/createChat` — body: `business_id`, `document_id`, `new_message`
- `GET /api/v1/transactions/accounting/bookkeeping/getChat/businessId/:businessId` — no query/body params read
- `GET /api/v1/transactions/accounting/bookkeeping/getMetadata/businessId/:businessId` — no query/body params read
- `DELETE /api/v1/transactions/accounting/bookkeeping/deleteChat/documentId/:documentId` — no query/body params read
- `PUT /api/v1/transactions/accounting/bookkeeping/renameMessage/documentId/:documentId` — body: `newName`
- `POST /api/v1/transactions/accounting/quickbook/createTransactions/businessId/:businessId` — no query/body params read
- `POST /api/v1/transactions/accounting/bank-reconciliation/extract-transactions/businessId/:businessId/accountId/:accountId` — params not auto-extracted (handler `multer` not resolved; read the controller before calling).
- `POST /api/v1/transactions/accounting/bookkeeping/extract-transactions/businessId/:businessId` — params not auto-extracted (handler `multer` not resolved; read the controller before calling).
- `POST /api/v1/transactions/accounting/bank-reconciliation/import-transactions` — params not auto-extracted (handler `multer` not resolved; read the controller before calling).
- `POST /api/v1/transactions/accounting/bookkeeping/import-bank-statement` — params not auto-extracted (handler `multer` not resolved; read the controller before calling).
- `POST /api/v1/transactions/accounting/bank-reconciliation/export-transactions` — body: `data`
- `POST /api/v1/transactions/accounting/bank-reconciliation/create/businessId/:businessId/accountId/:accountId` — body: `endDate`, `startDate`, `status`, `transactions`
- `GET /api/v1/transactions/accounting/bank-reconciliation/businessId/:businessId` — no query/body params read
- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/ai-review` — no query/body params read
- `GET /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/ai-review` — no query/body params read
- `GET /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/stripe-oauthUrl` — no query/body params read
- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/stripe-exchangeCode` — body: `code`
- `GET /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/stripe-debugAccount` — no query/body params read
- `POST /api/v1/transactions/accounting/bookkeeping/stripe-createTestCharge` — body: `amount`, `businessId`
- `POST /api/v1/transactions/accounting/bookkeeping/stripe-createTestInvoice` — body: `amount`, `businessId`, `customerId`, `status`
- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/stripe-syncEvents` — body: `retry_failed`
- `GET /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/stripe-eventLogs` — query: `event_type`, `limit`, `page`, `status`
- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/stripe-pullSync` — no query/body params read
- `POST /api/v1/transactions/accounting/bookkeeping/stripe-pullSyncAll` — no query/body params read
- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/stripe-retryFailed` — no query/body params read
- `GET /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/stripe-reconciliation` — no query/body params read
- `GET /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/stripe-balanceTransactions` — query: `created_gte`, `created_lte`, `limit`, `starting_after`, `type`
- `GET /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/oauth-owner` — no query/body params read
- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/stripe-deauthorize` — no query/body params read
- `GET /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/invoices` — query: `customer_id`, `end`, `expandLines`, `invoiceId`, `limit`, `q`, `start`, `starting_after`, `status`, `type`
- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/createInvoice` — query: `type` · body: `automatic_tax`, `collection_method`, `currency`, `customer_email`, `customer_id`, `days_until_due`, `default_tax_rates`, `discounts`, `due_date`, `expand_lines`, `finalize`, `invoice_date`, `line_items`, `memo`, `metadata`, `send`, `shipping_cost`
- `GET /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/parseInvoice/:contractId` — no query/body params read
- `PUT /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/updateInvoice/bulk` — body: `invoices`
- `PUT /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/updateInvoice/:invoiceId` — query: `type` · body: `automatic_tax`, `collection_method`, `days_until_due`, `default_tax_rates`, `discounts`, `due_date`, `expand_lines`, `invoice_date`, `line_items`, `link_journal_id`, `memo`, `metadata`, `replace_line_items`, `shipping_cost`, `status`
- `DELETE /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/deleteInvoice/:invoiceId` — query: `check`, `type`
- `GET /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/invoice-metadata` — query: `limit`, `q`, `type`
- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/calculateSalesTax` — no query/body params read
- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/invoice/:invoiceId/sendReminder` — no query/body params read
- `GET /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/invoice/:invoiceId/pdf` — no query/body params read
- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/invoice/:invoiceId/payment-link` — no query/body params read
- `DELETE /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/invoice/:invoiceId/payment-link` — no query/body params read
- `GET /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/square-oauthUrl` — no query/body params read
- `GET /api/v1/transactions/accounting/redirect/squareup` — no query/body params read
- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/square-exchangeCode` — body: `code`
- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/square-createTestPayment` — body: `amount`, `businessId`
- `POST /api/v1/transactions/accounting/bookkeeping/square-syncTransactions` — body: `businessIds`, `end`, `force`, `start`
- `POST /api/v1/transactions/accounting/bookkeeping/square-syncInvoices` — body: `businessIds`, `end`, `force`, `start`
- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/itemsToReview` — no query/body params read
- `GET /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/itemsToReview` — no query/body params read
- `PUT /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/itemsToReview` — body: `groupType`, `newStatus`, `recordId`
- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/createFromMatrix` — body: `data`, `keys`
- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/createPayrollFromMatrix` — body: `data`, `date`, `keys`
- `GET /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/hubspot-oauthUrl` — query: `redirect_uri`
- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/hubspot-exchangeCode` — body: `code`
- `GET /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/hubspot-oauth-owner` — no query/body params read
- `GET /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/contracts` — query: `end`, `exclude_fully_invoiced`, `limit`, `pipeline`, `q`, `start`, `starting_after`, `status`
- `GET /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/contract/:contractId` — no query/body params read
- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/contract` — no query/body params read
- `PUT /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/contract/:contractId` — query: `check`
- `DELETE /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/contract/:contractId` — query: `check`
- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/contract/:contractId/auto-revops` — body: `gl`, `invoices`, `mode`, `schedule`
- `POST /api/v1/transactions/accounting/bookkeeping/hubspot-syncTransactions` — body: `businessIds`, `end`, `force`, `start`
- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/hubspot-syncEvents` — no query/body params read
- `GET /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/hubspot-eventLogs` — query: `event_type`, `limit`, `page`, `status`
- `GET /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/ramp-oauthUrl` — no query/body params read
- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/ramp-exchangeCode` — body: `code`, `state`
- `GET /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/ramp-oauth-owner` — no query/body params read
- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/ramp-deauthorize` — no query/body params read
- `GET /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/bills` — query: `billId`, `end`, `limit`, `q`, `start`, `starting_after`, `status`, `vendor`
- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/bill` — body: `approval_chain`, `attachments`, `currency`, `due_date`, `invoice_number`, `issue_date`, `line_items`, `memo`, `metadata`, `status`, `vendor_id`, `vendor_name`
- `PUT /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/bill/:billId` — query: `check`, `confirm`, `type` · body: `approval_chain`, `attachments`, `currency`, `due_date`, `invoice_number`, `issue_date`, `line_items`, `memo`, `metadata`, `replace_line_items`, `status`, `vendor_id`, `vendor_name`
- `DELETE /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/bill/:billId` — query: `check`, `type`
- `GET /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/bill-metadata` — query: `limit`, `q`, `type`
- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/bill/:billId/auto-payops` — body: `fixedAssetItems`, `mode`, `prepaidItems`, `standardItems`
- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/bill-duplicate-check` — body: `exclude_bill_id`, `invoice_number`, `issue_date`, `total_amount`, `vendor_id`
- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/bills/approval-preview` — body: `approval_chain`, `line_items`, `total_amount`, `vendor_id`
- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/bill/:billId/submit` — body: `approval_chain`
- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/bill/:billId/approve` — no query/body params read
- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/bill/:billId/reject` — body: `reason`
- `GET /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/bill/:billId/approval` — no query/body params read
- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/bill/:billId/credit` — body: `credit_date`, `line_items`, `memo`
- `GET /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/bill/:billId/credits` — no query/body params read
- `GET /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/bill-credits` — query: `end`, `limit`, `q`, `start`, `starting_after`, `status`
- `GET /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/bill-credit/:creditId` — no query/body params read
- `DELETE /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/bill-credit/:creditId` — no query/body params read
- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/invoice/:invoiceId/credit-memo` — body: `credit_date`, `line_items`, `memo`
- `GET /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/invoice/:invoiceId/credit-memos` — no query/body params read
- `GET /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/invoice-credit-memos` — query: `end`, `limit`, `q`, `start`, `starting_after`, `status`
- `GET /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/invoice-credit-memo/:creditMemoId` — no query/body params read
- `DELETE /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/invoice-credit-memo/:creditMemoId` — no query/body params read
- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/ramp-syncEvents` — body: `retry_failed`
- `GET /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/ramp-eventLogs` — query: `event_type`, `limit`, `page`, `status`
- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/ramp-pullSync` — no query/body params read
- `POST /api/v1/transactions/accounting/bookkeeping/ramp-pullSyncAll` — no query/body params read
- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/ramp-setupAccounting` — no query/body params read
- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/ramp-syncCoA` — no query/body params read
- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/ramp-syncFields` — no query/body params read
- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/ramp-syncVendors` — no query/body params read
- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/ramp-fullSync` — no query/body params read
- `GET /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/salesforce-oauthUrl` — no query/body params read
- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/salesforce-exchangeCode` — body: `code`
- `GET /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/salesforce-oauth-owner` — no query/body params read
- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/salesforce-deauthorize` — no query/body params read
- `POST /api/v1/transactions/accounting/bookkeeping/salesforce-syncTransactions` — body: `businessId`, `businessIds`
- `POST /api/v1/transactions/accounting/bookkeeping/salesforce-syncCustomers` — body: `businessId`, `businessIds`
- `GET /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/salesforce-eventLogs` — query: `event_type`, `limit`, `page`, `status`
- `GET /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/qbo-oauthUrl` — no query/body params read
- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/qbo-exchangeCode` — body: `code`, `realmId`
- `GET /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/qbo-oauth-owner` — no query/body params read
- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/qbo-deauthorize` — no query/body params read
- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/qbo-sync-coa` — no query/body params read
- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/qbo-sync-gl` — body: `endDate`, `startDate`
- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/qbo-sync-tb` — body: `endDate`, `startDate`
- `POST /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/qbo-sync-changes` — no query/body params read
- `GET /api/v1/transactions/accounting/bookkeeping/businessId/:businessId/qbo-eventLogs` — no query/body params read
- `PATCH /api/v1/api/transactions/bookkeeping/:businessId` — no query/body params read
