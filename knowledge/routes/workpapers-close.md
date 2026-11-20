# Workpapers & Close

Month-end workpaper surfaces (bank reconciliation, fixed assets, prepaids, accruals, debt, leases, revenue recognition), close checklists, the close-workflow run engine, accounting-period locks, and generic schedules with sign-offs. Reach for this domain for anything about reconciling a bank account, depreciation/amortization schedules, accrual/recognition entries, closing or reopening a period, or the status of a close run.

Auth legend: `accountant` = accountant JWT (`accountantProtect`); `machine` = CLOSE_AGENT_TOKEN (the helper cannot call these).

## Workpapers core + bank reconciliation (`/api/v1/accountant/workPapers`)

- `POST /api/v1/accountant/workPapers` — create a workpaper record. Params: body with businessId + workpaper fields. Auth: accountant.
- `PUT /api/v1/accountant/workPapers/:id` — update a workpaper. Params: id; body fields to change. Auth: accountant.
- `DELETE /api/v1/accountant/workPapers/:id` — delete a workpaper. Params: id. Auth: accountant.
- `GET /api/v1/accountant/workPapers/:businessId` — list workpapers for a business. Params: businessId. Auth: accountant.
- `PUT /api/v1/accountant/workPapers/refreshBankBalance/:businessId` — refresh cached bank balances. Params: businessId. Auth: accountant.
- `POST /api/v1/accountant/workPapers/bankRecon/v3` — create a bank reconciliation (V3 flow). Params: body businessId, accountId, period fields. Auth: accountant.
- `GET /api/v1/accountant/workPapers/bankRecon/previousBalance/:businessId/:accountId` — prior recon's ending balance for an account. Auth: accountant.
- `GET /api/v1/accountant/workPapers/bankRecon/business/:businessId` — list reconciliations for a business. Auth: accountant.
- `PUT /api/v1/accountant/workPapers/bankRecon/:id/rerun` — re-run matching on a recon. Params: id. Auth: accountant.
- `POST /api/v1/accountant/workPapers/bankRecon/:id/manualMatch` — add a manual statement-to-GL match. Params: id; match body. Auth: accountant.
- `DELETE /api/v1/accountant/workPapers/bankRecon/:id/manualMatch/:matchId` — remove a manual match. Auth: accountant.
- `PATCH /api/v1/accountant/workPapers/bankRecon/:id/pdfEndingBalanceOverride` — override the PDF-extracted ending balance. Auth: accountant.
- `PUT /api/v1/accountant/workPapers/bankRecon/:id/updateStatus` — change recon status (finalize etc. — destructive, confirm first). Auth: accountant.
- `POST /api/v1/accountant/workPapers/bankRecon/addStatementToRecon/:id` — attach a statement to a recon. Auth: accountant.
- `GET /api/v1/accountant/workPapers/bankRecon/:id/statements` — statement transactions of a recon. Auth: accountant.
- `POST /api/v1/accountant/workPapers/bankRecon/:id/statementId/:statementId` — add a transaction to a statement. Auth: accountant.
- `PUT /api/v1/accountant/workPapers/bankRecon/:id/statementId/:statementId/transactionId/:transactionId` — update a statement transaction. Auth: accountant.
- `DELETE /api/v1/accountant/workPapers/bankRecon/:id/statementId/:statementId/transactionId/:transactionId` — delete a statement transaction. Auth: accountant.
- `DELETE /api/v1/accountant/workPapers/bankRecon/:id/transactionId/:transactionId` — delete a statement transaction (recon-wide form). Auth: accountant.
- `PUT /api/v1/accountant/workPapers/bankRecon/:id` — update a reconciliation. Auth: accountant.
- `GET /api/v1/accountant/workPapers/bankRecon/:id` — read one reconciliation. Auth: accountant.
- `DELETE /api/v1/accountant/workPapers/bankRecon/:id` — delete a reconciliation. Auth: accountant.
- `POST /api/v1/accountant/workPapers/bankRecon/extract-transactions-v3/businessId/:businessId/accountId/:accountId/reconId/:reconId` — upload statement PDFs (multipart, any field name); starts an async extraction job. Auth: accountant.
- `GET /api/v1/accountant/workPapers/bankRecon/transaction-extraction/job-status/:jobId` — poll an extraction job. Auth: accountant.
- `GET /api/v1/accountant/workPapers/bankRecon/transaction-extraction/businessId/:businessId/active-jobs` — active extraction jobs for a business. Auth: accountant.
- `GET /api/v1/accountant/workPapers/bankRecon/transaction-extraction-v3/reconId/:reconId/active-jobs` — active extraction jobs for one recon. Auth: accountant.
- `GET /api/v1/accountant/workPapers/dictionary/:businessId` — dictionary/summary across all workpaper types. Auth: accountant.
- `POST /api/v1/accountant/workPapers/attachment/upload` — upload an attachment (multipart field `file`), returns presigned link. Auth: accountant.
- `GET /api/v1/accountant/workPapers/suggestions/:businessId` — AI suggestions for schedules. Auth: accountant.
- `POST /api/v1/accountant/workPapers/bills/parse/:businessId` — parse an uploaded bill PDF (multipart field `pdf`). Auth: accountant.

## Fixed assets

- `GET /api/v1/accountant/workPapers/fixedAssets/tax/:businessId/schedule` — tax-treatment depreciation schedule. Auth: accountant.
- `GET /api/v1/accountant/workPapers/fixedAssets/tax/:businessId/schedule-l` — Schedule L figures. Auth: accountant.
- `GET /api/v1/accountant/workPapers/fixedAssets/tax/:businessId/form4562` — Form 4562 figures. Auth: accountant.
- `GET /api/v1/accountant/workPapers/fixedAssets/tax/:businessId/book-to-tax` — book-to-tax differences. Auth: accountant.
- `GET /api/v1/accountant/workPapers/fixedAssets/tax/assetClasses` — MACRS asset classes (no businessId). Auth: accountant.
- `GET /api/v1/accountant/workPapers/fixedAssets/tax/:businessId/settings` — fixed-asset tax settings. Auth: accountant.
- `PUT /api/v1/accountant/workPapers/fixedAssets/tax/:businessId/settings` — update tax settings. Auth: accountant.
- `POST /api/v1/accountant/workPapers/fixedAssets/tax/:businessId/compute` — compute a tax year's depreciation. Auth: accountant.
- `POST /api/v1/accountant/workPapers/fixedAssets/tax/:businessId/backfill` — backfill tax treatment on existing assets. Auth: accountant.
- `PUT /api/v1/accountant/workPapers/fixedAssets/tax/:businessId/:assetId/treatment` — update one asset's tax treatment. Auth: accountant.
- `POST /api/v1/accountant/workPapers/fixedAssets` — create a fixed-asset workpaper. Auth: accountant.
- `PUT /api/v1/accountant/workPapers/fixedAssets/:id` — update a fixed-asset workpaper. Auth: accountant.
- `GET /api/v1/accountant/workPapers/fixedAssets/glFixedAssets/:id` — GL fixed-asset transactions for a workpaper. Auth: accountant.
- `GET /api/v1/accountant/workPapers/fixedAssets/gl/:id` — GL accounts for a fixed-asset workpaper. Auth: accountant.
- `GET /api/v1/accountant/workPapers/fixedAssets/summary/:id` — fixed-asset workpaper summary. Auth: accountant.
- `POST /api/v1/accountant/workPapers/fixedAssets/schedule/:businessId` — create the depreciation schedule. Auth: accountant.
- `GET /api/v1/accountant/workPapers/fixedAssets/schedule/:businessId` — read the depreciation schedule. Auth: accountant.
- `POST /api/v1/accountant/workPapers/fixedAssets/register/convert/:businessId` — AI-convert an uploaded legacy register (multipart, one shot). Auth: accountant.
- `POST /api/v1/accountant/workPapers/fixedAssets/register/extract/:businessId` — extract raw text + chunks from an upload (no AI). Auth: accountant.
- `POST /api/v1/accountant/workPapers/fixedAssets/register/convert-chunk/:businessId` — AI-parse one extracted chunk. Auth: accountant.
- `POST /api/v1/accountant/workPapers/fixedAssets/register/preview/:businessId` — preview one asset's forward depreciation (no writes). Auth: accountant.
- `POST /api/v1/accountant/workPapers/fixedAssets/register/import/:businessId` — persist migrated assets (seeds accumulated depreciation). Auth: accountant.
- `POST /api/v1/accountant/workPapers/fixedAssets/manual/:businessId` — manually add one asset (no GL txn) + build schedule. Auth: accountant.
- `PUT /api/v1/accountant/workPapers/fixedAssets/schedule/:businessId/:assetId` — update one scheduled asset. Auth: accountant.
- `PUT /api/v1/accountant/workPapers/fixedAssets/schedule/:businessId/:assetId/archive` — archive one scheduled asset. Auth: accountant.
- `GET /api/v1/accountant/workPapers/fixedAssets/schedule/:businessId/monthly` — monthly depreciation summary. Auth: accountant.
- `POST /api/v1/accountant/workPapers/fixedAssets/schedule/add/:businessId` — add an item to the schedule. Auth: accountant.
- `DELETE /api/v1/accountant/workPapers/fixedAssets/schedule/:businessId/:fixedAssetItemId` — delete a schedule item. Auth: accountant.
- `GET /api/v1/accountant/workPapers/fixedAssets/all/:businessId` — all fixed-asset workpapers. Auth: accountant.
- `DELETE /api/v1/accountant/workPapers/fixedAssets/:id` — delete a fixed-asset workpaper. Auth: accountant.
- `PUT /api/v1/accountant/workPapers/fixedAssets/:businessId/:id/sale` — record an asset sale/disposal. Auth: accountant.
- `GET /api/v1/accountant/workPapers/fixedAssets/schedule/range/:id` — depreciation schedule for one workpaper id. Auth: accountant.

## Prepaids

- `POST /api/v1/accountant/workPapers/prepaid/register/convert/:businessId` — AI-convert an uploaded prepaid register (multipart). Auth: accountant.
- `POST /api/v1/accountant/workPapers/prepaid/register/extract/:businessId` — extract text + chunks (multipart, no AI). Auth: accountant.
- `POST /api/v1/accountant/workPapers/prepaid/register/convert-chunk/:businessId` — AI-parse one chunk. Auth: accountant.
- `POST /api/v1/accountant/workPapers/prepaid/register/import/:businessId` — persist migrated prepaids. Auth: accountant.
- `POST /api/v1/accountant/workPapers/prepaid/manual/:businessId` — manually add one prepaid. Auth: accountant.
- `POST /api/v1/accountant/workPapers/prepaid/schedule/:businessId` — create the amortization schedule. Auth: accountant.
- `GET /api/v1/accountant/workPapers/prepaid/schedule/:businessId` — read the amortization schedule. Auth: accountant.
- `POST /api/v1/accountant/workPapers/prepaid/schedule/add/:businessId` — add a schedule item. Auth: accountant.
- `PUT /api/v1/accountant/workPapers/prepaid/schedule/:businessId/:prepaidId` — update one schedule item. Auth: accountant.
- `PUT /api/v1/accountant/workPapers/prepaid/schedule/:businessId/:prepaidId/archive` — archive one schedule item. Auth: accountant.
- `DELETE /api/v1/accountant/workPapers/prepaid/schedule/:businessId/:prepaidId` — delete one schedule item. Auth: accountant.
- `POST /api/v1/accountant/workPapers/prepaid/schedule/rule/:businessId` — add a prepaid rule. Auth: accountant.
- `PUT /api/v1/accountant/workPapers/prepaid/schedule/rule/:businessId/:ruleId` — update a rule. Auth: accountant.
- `DELETE /api/v1/accountant/workPapers/prepaid/schedule/rule/:businessId/:ruleId` — delete a rule. Auth: accountant.
- `POST /api/v1/accountant/workPapers/prepaid` — create a prepaid workpaper. Auth: accountant.
- `GET /api/v1/accountant/workPapers/prepaid/schedule/rules/:businessId` — list prepaid rules. Auth: accountant.
- `GET /api/v1/accountant/workPapers/prepaid/all/:businessId` — all prepaid workpapers. Auth: accountant.
- `GET /api/v1/accountant/workPapers/prepaid/gl/:id` — GL accounts for a prepaid workpaper. Auth: accountant.
- `GET /api/v1/accountant/workPapers/prepaid/schedule/range/:id` — amortization schedule for one workpaper id. Auth: accountant.
- `DELETE /api/v1/accountant/workPapers/prepaid/:id` — delete a prepaid workpaper. Auth: accountant.
- `PUT /api/v1/accountant/workPapers/prepaid/:id` — update a prepaid workpaper. Auth: accountant.
- `GET /api/v1/accountant/workPapers/prepaid/summary/:id` — prepaid workpaper summary. Auth: accountant.
- `GET /api/v1/accountant/workPapers/prepaid/:businessId/monthly` — monthly amortization summary. Auth: accountant.
- `PUT /api/v1/accountant/workPapers/prepaid/schedule/:businessId/:id/amendment` — amend a prepaid schedule item. Auth: accountant.
- `PUT /api/v1/accountant/workPapers/prepaid/schedule/:businessId/:prepaidId/updateSchedule` — regenerate one prepaid's schedule. Auth: accountant.

## Accruals

- `GET /api/v1/accountant/workPapers/accrual/analysis/:businessId` — accrued-expense analysis (candidates from the GL). Auth: accountant.
- `POST /api/v1/accountant/workPapers/accrual/:businessId` — create an accrued expense. Auth: accountant.
- `GET /api/v1/accountant/workPapers/accrual/:businessId` — list accrued expenses. Auth: accountant.
- `PUT /api/v1/accountant/workPapers/accrual/bulk-reverse` — bulk-reverse accruals; body carries ids. Auth: accountant.
- `PUT /api/v1/accountant/workPapers/accrual/:id` — update an accrued expense. Auth: accountant.
- `DELETE /api/v1/accountant/workPapers/accrual/:id` — delete an accrued expense. Auth: accountant.
- `POST /api/v1/accountant/workPapers/accrual/rule/:businessId` — add an accrual rule. Auth: accountant.
- `PUT /api/v1/accountant/workPapers/accrual/rule/:businessId/:ruleId` — update an accrual rule. Auth: accountant.
- `DELETE /api/v1/accountant/workPapers/accrual/rule/:businessId/:ruleId` — delete an accrual rule. Auth: accountant.
- `GET /api/v1/accountant/workPapers/accrual/rules/:businessId` — list accrual rules. Auth: accountant.

## Debt

- `POST /api/v1/accountant/workPapers/debt/register/convert/:businessId` — AI-convert an uploaded debt register (multipart). Auth: accountant.
- `POST /api/v1/accountant/workPapers/debt/register/extract/:businessId` — extract text + chunks (multipart, no AI). Auth: accountant.
- `POST /api/v1/accountant/workPapers/debt/register/convert-chunk/:businessId` — AI-parse one chunk. Auth: accountant.
- `POST /api/v1/accountant/workPapers/debt/register/import/:businessId` — persist migrated debts. Auth: accountant.
- `POST /api/v1/accountant/workPapers/debt/manual/:businessId` — manually add one debt. Auth: accountant.
- `GET /api/v1/accountant/workPapers/debt/estimate/:businessId` — generate a debt amortization estimate. Auth: accountant.
- `GET /api/v1/accountant/workPapers/debt/schedule/:businessId` — debt schedule for a business. Auth: accountant.
- `GET /api/v1/accountant/workPapers/debt/rules/:businessId` — list debt rules. Auth: accountant.
- `POST /api/v1/accountant/workPapers/debt/rule/:businessId` — add a debt rule. Auth: accountant.
- `PUT /api/v1/accountant/workPapers/debt/rule/:businessId/:ruleId` — update a debt rule. Auth: accountant.
- `DELETE /api/v1/accountant/workPapers/debt/rule/:businessId/:ruleId` — delete a debt rule. Auth: accountant.
- `POST /api/v1/accountant/workPapers/debt` — create a debt workpaper. Auth: accountant.
- `GET /api/v1/accountant/workPapers/debt/:businessId` — debt workpapers for a business. Auth: accountant.
- `PUT /api/v1/accountant/workPapers/debt/:id` — update a debt workpaper. Auth: accountant.
- `GET /api/v1/accountant/workPapers/debt/gl/:id` — GL accounts for a debt workpaper. Auth: accountant.
- `GET /api/v1/accountant/workPapers/debt/schedule/range/:id` — amortization schedule for one workpaper id. Auth: accountant.
- `GET /api/v1/accountant/workPapers/debt/summary/:id` — debt workpaper summary. Auth: accountant.
- `DELETE /api/v1/accountant/workPapers/debt/schedule/:businessId/:debtId` — delete a debt schedule item. Auth: accountant.

## Leases

- `POST /api/v1/accountant/workPapers/lease/register/convert/:businessId` — AI-convert an uploaded lease register (multipart). Auth: accountant.
- `POST /api/v1/accountant/workPapers/lease/register/extract/:businessId` — extract text + chunks (multipart, no AI). Auth: accountant.
- `POST /api/v1/accountant/workPapers/lease/register/convert-chunk/:businessId` — AI-parse one chunk. Auth: accountant.
- `POST /api/v1/accountant/workPapers/lease/register/import/:businessId` — persist migrated leases. Auth: accountant.
- `POST /api/v1/accountant/workPapers/lease/manual/:businessId` — manually add one lease. Auth: accountant.
- `POST /api/v1/accountant/workPapers/lease/estimate/:businessId` — generate an ASC 842 lease estimate. Auth: accountant.
- `GET /api/v1/accountant/workPapers/lease/schedule/:businessId` — lease schedule for a business. Auth: accountant.
- `DELETE /api/v1/accountant/workPapers/lease/schedule/:businessId/:leaseId` — delete a lease schedule item. Auth: accountant.
- `GET /api/v1/accountant/workPapers/lease/rules/:businessId` — list lease rules. Auth: accountant.
- `POST /api/v1/accountant/workPapers/lease/rule/:businessId` — add a lease rule. Auth: accountant.
- `PUT /api/v1/accountant/workPapers/lease/rule/:businessId/:ruleId` — update a lease rule. Auth: accountant.
- `DELETE /api/v1/accountant/workPapers/lease/rule/:businessId/:ruleId` — delete a lease rule. Auth: accountant.
- `POST /api/v1/accountant/workPapers/lease` — create a lease workpaper. Auth: accountant.
- `PUT /api/v1/accountant/workPapers/lease/:id` — update a lease workpaper. Auth: accountant.
- `GET /api/v1/accountant/workPapers/lease/:businessId` — lease workpapers for a business. Auth: accountant.
- `GET /api/v1/accountant/workPapers/lease/gl/:id` — GL accounts for a lease workpaper. Auth: accountant.
- `GET /api/v1/accountant/workPapers/lease/schedule/range/:id` — lease schedule for one workpaper id. Auth: accountant.
- `GET /api/v1/accountant/workPapers/lease/summary/:id` — lease workpaper summary. Auth: accountant.

## Revenue recognition

- `POST /api/v1/accountant/workPapers/revenue/register/convert/:businessId` — AI-convert an uploaded revenue register (multipart). Auth: accountant.
- `POST /api/v1/accountant/workPapers/revenue/register/extract/:businessId` — extract text + chunks (multipart, no AI). Auth: accountant.
- `POST /api/v1/accountant/workPapers/revenue/register/convert-chunk/:businessId` — AI-parse one chunk. Auth: accountant.
- `POST /api/v1/accountant/workPapers/revenue/register/import/:businessId` — persist migrated recognitions. Auth: accountant.
- `POST /api/v1/accountant/workPapers/revenue/manual/:businessId` — manually add one recognition. Auth: accountant.
- `POST /api/v1/accountant/workPapers/revenue/line-items/:businessId` — create revenue line items from a contract PDF (multipart field `pdf`). Auth: accountant.
- `POST /api/v1/accountant/workPapers/revenue/schedule/:businessId` — create the recognition schedule. Auth: accountant.
- `GET /api/v1/accountant/workPapers/revenue/schedule/:businessId` — read the recognition schedule. Auth: accountant.
- `PUT /api/v1/accountant/workPapers/revenue/schedule/:businessId/:recognitionId` — update one recognition item. Auth: accountant.
- `PUT /api/v1/accountant/workPapers/revenue/schedule/:businessId/:recognitionId/contract-name` — rename the contract only (no schedule/GL regeneration). Auth: accountant.
- `PUT /api/v1/accountant/workPapers/revenue/schedule/:businessId/:recognitionId/archive` — archive a recognition item. Auth: accountant.
- `DELETE /api/v1/accountant/workPapers/revenue/schedule/:businessId/:recognitionId` — delete a recognition item. Auth: accountant.
- `PUT /api/v1/accountant/workPapers/revenue/schedule/:businessId/:recognitionId/updateSchedule` — regenerate one recognition's schedule. Auth: accountant.
- `GET /api/v1/accountant/workPapers/revenue/schedule/summary/:businessId` — monthly recognition summary. Auth: accountant.
- `GET /api/v1/accountant/workPapers/revenue/schedule/rule/:businessId` — list recognition rules. Auth: accountant.
- `POST /api/v1/accountant/workPapers/revenue/schedule/rule/:businessId` — add a recognition rule. Auth: accountant.
- `PUT /api/v1/accountant/workPapers/revenue/schedule/rule/:businessId/:ruleId` — update a recognition rule. Auth: accountant.
- `DELETE /api/v1/accountant/workPapers/revenue/schedule/rule/:businessId/:ruleId` — delete a recognition rule. Auth: accountant.
- `POST /api/v1/accountant/workPapers/revenue` — create a recognition workpaper. Auth: accountant.
- `PUT /api/v1/accountant/workPapers/revenue/:id` — update a recognition workpaper. Auth: accountant.
- `GET /api/v1/accountant/workPapers/revenue/:businessId` — all recognition workpapers for a business. Auth: accountant.
- `GET /api/v1/accountant/workPapers/revenue/gl/:id` — GL accounts for a recognition workpaper. Auth: accountant.
- `GET /api/v1/accountant/workPapers/revenue/schedule/range/:id` — recognition schedule for one workpaper id. Auth: accountant.
- `DELETE /api/v1/accountant/workPapers/revenue/:id` — delete a recognition workpaper. Auth: accountant.
- `GET /api/v1/accountant/workPapers/revenue/glTransactions/:businessId` — GL transactions for recognition workpapers. Auth: accountant.
- `GET /api/v1/accountant/workPapers/revenue/summary/:id` — recognition workpaper summary. Auth: accountant.

## Close checklist (`/api/v1/accountant/close-checklist`)

- `GET /api/v1/accountant/close-checklist/business/:businessId` — list close checklists. Auth: accountant.
- `POST /api/v1/accountant/close-checklist/business/:businessId` — create a checklist. Params: body periodStart, periodEnd, status, description, assignee/reviewer/approver ids+names, tasks[]. Auth: accountant.
- `GET /api/v1/accountant/close-checklist/business/:businessId/:checklistId/progress` — progress rollup for a checklist. Auth: accountant.
- `GET /api/v1/accountant/close-checklist/business/:businessId/:checklistId` — read one checklist. Auth: accountant.
- `PATCH /api/v1/accountant/close-checklist/business/:businessId/:checklistId` — partial-update a checklist (only whitelisted fields are picked). Auth: accountant.
- `DELETE /api/v1/accountant/close-checklist/business/:businessId/:checklistId` — delete a checklist. Auth: accountant.
- `POST /api/v1/accountant/close-checklist/business/:businessId/:checklistId/tasks` — add an embedded task; body: title (required), description, category, status, assignee/reviewer fields. Auth: accountant.
- `PATCH /api/v1/accountant/close-checklist/business/:businessId/:checklistId/tasks/:taskId` — update a task (e.g. mark complete). Auth: accountant.
- `DELETE /api/v1/accountant/close-checklist/business/:businessId/:checklistId/tasks/:taskId` — delete a task. Auth: accountant.

## Close workflow runs (`/api/v1/accountant/close-workflow`)

- `GET /api/v1/accountant/close-workflow/workflows` — workflow catalog (steps + inputs, as published by the worker). Auth: accountant.
- `GET /api/v1/accountant/close-workflow/health` — whether a close worker is alive (heartbeat-based). Auth: accountant.
- `POST /api/v1/accountant/close-workflow/runs` — start a close run. Params: body businessId, workflowId, clientName, statements[{filename, contentBase64}] (required), replaceExisting, skipSetup. Auth: accountant.
- `POST /api/v1/accountant/close-workflow/preview` — preview statements before running; body businessId, statements[], skipSetup; flags files that were closed before. Auth: accountant.
- `GET /api/v1/accountant/close-workflow/runs` — list runs. Params: query businessId (latest 50). Auth: accountant.
- `GET /api/v1/accountant/close-workflow/runs/:runId` — one run with its full event stream. Auth: accountant.
- `GET /api/v1/accountant/close-workflow/runs/:runId/events` — incremental events. Params: query after=<seq> (up to 500, returns nextSeq). Auth: accountant.
- `POST /api/v1/accountant/close-workflow/runs/:runId/stop` — stop a run. Auth: accountant.
- `POST /api/v1/accountant/close-workflow/runs/:runId/restart` — restart a run. Auth: accountant.
- `POST /api/v1/accountant/close-workflow/runs/:runId/resume` — resume a blocked run after the blocker is cleared. Auth: accountant.
- `DELETE /api/v1/accountant/close-workflow/runs/:runId` — delete a run. Auth: accountant.

## Accounting periods (`/api/v1/accountant/accounting-period`)

Role-gated beyond the JWT: reads need `accounting_periods_read` (or write), mutations need `accounting_periods_write`.

- `GET /api/v1/accountant/accounting-period/business/:businessId` — list periods (auto-creates the current month's). Auth: accountant.
- `GET /api/v1/accountant/accounting-period/business/:businessId/settings` — period-control settings. Auth: accountant.
- `PUT /api/v1/accountant/accounting-period/business/:businessId/settings` — update settings; body: isEnabled, initialPeriodDate. Auth: accountant.
- `POST /api/v1/accountant/accounting-period/business/:businessId/initialize` — initialize periods; body: initialDate. Auth: accountant.
- `PUT /api/v1/accountant/accounting-period/business/:businessId/close` — close periods; body: periodIds[] (locks the books — confirm first). Auth: accountant.
- `PUT /api/v1/accountant/accounting-period/business/:businessId/reopen` — reopen periods; body: periodIds[]. Auth: accountant.
- `GET /api/v1/accountant/accounting-period/business/:businessId/period/:periodId/history` — close/reopen history for one period. Auth: accountant.

## Schedules with sign-offs (`/api/v1/accountant/schedules`)

- `GET /api/v1/accountant/schedules/:businessId` — list schedules. Params: query status, period, startDate, endDate, q, includeDeleted, limit, skip. Auth: accountant.
- `POST /api/v1/accountant/schedules/:businessId` — create a schedule (Joi-validated body). Auth: accountant.
- `GET /api/v1/accountant/schedules/:businessId/schedules/:scheduleId` — read one schedule. Auth: accountant.
- `PUT /api/v1/accountant/schedules/:businessId/schedules/:scheduleId` — update a schedule. Auth: accountant.
- `DELETE /api/v1/accountant/schedules/:businessId/schedules/:scheduleId` — soft-delete a schedule. Auth: accountant.
- `POST /api/v1/accountant/schedules/:businessId/:scheduleId/workpapers` — add a workpaper to a schedule (optional signOff steps). Auth: accountant.
- `PUT /api/v1/accountant/schedules/:businessId/:scheduleId/workpapers/:workpaperId` — update a nested workpaper. Auth: accountant.
- `DELETE /api/v1/accountant/schedules/:businessId/:scheduleId/workpapers/:workpaperId` — delete a nested workpaper. Auth: accountant.
- `POST /api/v1/accountant/schedules/:businessId/:scheduleId/workpapers/:workpaperId/comments` — add a comment. Auth: accountant.
- `PUT /api/v1/accountant/schedules/:businessId/:scheduleId/workpapers/:workpaperId/comments/:commentId` — edit a comment; body: comment. Auth: accountant.
- `DELETE /api/v1/accountant/schedules/:businessId/:scheduleId/workpapers/:workpaperId/comments/:commentId` — delete a comment. Auth: accountant.
- `POST /api/v1/accountant/schedules/:businessId/:scheduleId/workpapers/:workpaperId/attachments` — add an attachment record. Auth: accountant.
- `DELETE /api/v1/accountant/schedules/:businessId/:scheduleId/workpapers/:workpaperId/attachments/:attachmentId` — delete an attachment. Auth: accountant.
- `PUT /api/v1/accountant/schedules/:businessId/:scheduleId/workpapers/:workpaperId/signOff/steps/:stepId` — update a sign-off step; body: completed, note, assignedTo, completedBy. Auth: accountant.

## Internal close-agent (`/api/v1/internal/close-agent`) — machine only, the helper cannot call these

- `POST /api/v1/internal/close-agent/runs/:runId/events` — worker pushes run progress events. Auth: machine.
- `GET /api/v1/internal/close-agent/statements/:fileId` — worker fetches statement bytes. Auth: machine.
- `GET /api/v1/internal/close-agent/runs/:runId/cancelled` — worker polls whether a run was cancelled. Auth: machine.
- `POST /api/v1/internal/close-agent/jobs/claim` — worker claims a job. Auth: machine.
- `POST /api/v1/internal/close-agent/jobs/:jobId/progress` — worker reports job progress. Auth: machine.
- `POST /api/v1/internal/close-agent/jobs/:jobId/touch` — worker keeps a claim alive. Auth: machine.
- `POST /api/v1/internal/close-agent/jobs/:jobId/resolve` — worker resolves a job. Auth: machine.
- `POST /api/v1/internal/close-agent/jobs/:jobId/fail` — worker fails a job. Auth: machine.
- `POST /api/v1/internal/close-agent/workers/register` — worker registers (publishes its workflow catalog). Auth: machine.
- `POST /api/v1/internal/close-agent/workers/:workerId/heartbeat` — worker liveness heartbeat. Auth: machine.

## Gotchas

- **`POST /close-workflow/runs` duplicate guard**: submitting a statement filename that appears on a prior done/blocked/stopped run returns `409 {duplicate:true, message}` unless `replaceExisting:true` or `skipSetup:true` — ask the person, then resubmit with their answer.
- **Statement extraction is async**: `extract-transactions-v3` returns a jobId; poll `.../transaction-extraction/job-status/:jobId` until done. Same pattern for run events: poll `/runs/:runId/events?after=<nextSeq>`.
- **Accounting-period 403s are role problems**: the JWT passes but `accounting_periods_read`/`accounting_periods_write` role keys gate every route; closing/reopening periods locks or unlocks the books — always confirm with the person first.
- **Path-order shadows in workPapers**: `GET /workPapers/:businessId` is the generic list — literal segments like `dictionary`, `suggestions`, `bankRecon`, `fixedAssets` are separate routes, so never treat a returned 200 on `/workPapers/<word>` as proof `<word>` was a businessId.
- **schedules paths are asymmetric**: read/update/delete one schedule uses `/:businessId/schedules/:scheduleId`, but workpaper sub-routes drop the literal `schedules` segment: `/:businessId/:scheduleId/workpapers/...`.
- **Uploads are multipart**: register convert/extract accept any field name; `revenue/line-items` and `bills/parse` require field `pdf`; `attachment/upload` requires field `file`. `createRun` statements travel as base64 in JSON, not multipart.
- **listRuns caps at 50, run events at 500 per poll** — page with `after`.
- **Internal close-agent routes need CLOSE_AGENT_TOKEN**, not a JWT; a helper session gets 401s there by design.


## Appendix — exact parameters, extracted from the controllers

Machine-extracted from the product's controller source (every `req.query` /
`req.body` key the handler actually reads). This is the authority on filter
parameter NAMES — a name not listed here is silently ignored by that route.
Meanings and formats live in the entries above; when in doubt, pass exactly
these names and verify the returned date span and row count.

- `POST /api/v1/accountant/workPapers` — no query/body params read
- `PUT /api/v1/accountant/workPapers/:id` — no query/body params read
- `DELETE /api/v1/accountant/workPapers/:id` — no query/body params read
- `GET /api/v1/accountant/workPapers/:businessId` — query: `exports`, `history`, `type`
- `PUT /api/v1/accountant/workPapers/refreshBankBalance/:businessId` — no query/body params read
- `POST /api/v1/accountant/workPapers/bankRecon/v3` — body: `accountId`, `businessId`, `endDate`, `name`, `previousEndingBalance`, `startDate`
- `GET /api/v1/accountant/workPapers/bankRecon/previousBalance/:businessId/:accountId` — no query/body params read
- `GET /api/v1/accountant/workPapers/bankRecon/business/:businessId` — no query/body params read
- `PUT /api/v1/accountant/workPapers/bankRecon/:id/rerun` — no query/body params read
- `POST /api/v1/accountant/workPapers/bankRecon/:id/manualMatch` — body: `bankTransactionId`, `glTransactionId`, `reason`, `statementTransactionId`
- `DELETE /api/v1/accountant/workPapers/bankRecon/:id/manualMatch/:matchId` — no query/body params read
- `PATCH /api/v1/accountant/workPapers/bankRecon/:id/pdfEndingBalanceOverride` — no query/body params read
- `PUT /api/v1/accountant/workPapers/bankRecon/:id/updateStatus` — body: `acknowledgeBalanceMismatch`, `status`
- `POST /api/v1/accountant/workPapers/bankRecon/addStatementToRecon/:id` — body: `accountId`, `accountName`, `transactions`
- `GET /api/v1/accountant/workPapers/bankRecon/:id/statements` — no query/body params read
- `POST /api/v1/accountant/workPapers/bankRecon/:id/statementId/:statementId` — no query/body params read
- `PUT /api/v1/accountant/workPapers/bankRecon/:id/statementId/:statementId/transactionId/:transactionId` — no query/body params read
- `DELETE /api/v1/accountant/workPapers/bankRecon/:id/statementId/:statementId/transactionId/:transactionId` — body: `transactionIds`
- `DELETE /api/v1/accountant/workPapers/bankRecon/:id/transactionId/:transactionId` — no query/body params read
- `PUT /api/v1/accountant/workPapers/bankRecon/:id` — no query/body params read
- `GET /api/v1/accountant/workPapers/bankRecon/:id` — no query/body params read
- `DELETE /api/v1/accountant/workPapers/bankRecon/:id` — no query/body params read
- `POST /api/v1/accountant/workPapers/bankRecon/extract-transactions-v3/businessId/:businessId/accountId/:accountId/reconId/:reconId` — body: `accountName`, `reuseJobId`, `rowDecision`, `statementBeginningBalance`, `statementEndingBalance`
- `GET /api/v1/accountant/workPapers/bankRecon/transaction-extraction/job-status/:jobId` — no query/body params read
- `GET /api/v1/accountant/workPapers/bankRecon/transaction-extraction/businessId/:businessId/active-jobs` — no query/body params read
- `GET /api/v1/accountant/workPapers/bankRecon/transaction-extraction-v3/reconId/:reconId/active-jobs` — no query/body params read
- `GET /api/v1/accountant/workPapers/dictionary/:businessId` — no query/body params read
- `POST /api/v1/accountant/workPapers/attachment/upload` — no query/body params read
- `GET /api/v1/accountant/workPapers/fixedAssets/tax/:businessId/schedule` — query: `basis`, `exports`, `year`
- `GET /api/v1/accountant/workPapers/fixedAssets/tax/:businessId/schedule-l` — query: `exports`, `year`
- `GET /api/v1/accountant/workPapers/fixedAssets/tax/:businessId/form4562` — query: `exports`, `year`
- `GET /api/v1/accountant/workPapers/fixedAssets/tax/:businessId/book-to-tax` — query: `exports`, `rate`, `year`
- `GET /api/v1/accountant/workPapers/fixedAssets/tax/assetClasses` — no query/body params read
- `GET /api/v1/accountant/workPapers/fixedAssets/tax/:businessId/settings` — no query/body params read
- `PUT /api/v1/accountant/workPapers/fixedAssets/tax/:businessId/settings` — no query/body params read
- `POST /api/v1/accountant/workPapers/fixedAssets/tax/:businessId/compute` — query: `year`
- `POST /api/v1/accountant/workPapers/fixedAssets/tax/:businessId/backfill` — no query/body params read
- `PUT /api/v1/accountant/workPapers/fixedAssets/tax/:businessId/:assetId/treatment` — body: `override`
- `POST /api/v1/accountant/workPapers/fixedAssets` — no query/body params read
- `PUT /api/v1/accountant/workPapers/fixedAssets/:id` — no query/body params read
- `GET /api/v1/accountant/workPapers/fixedAssets/glFixedAssets/:id` — no query/body params read
- `GET /api/v1/accountant/workPapers/fixedAssets/gl/:id` — no query/body params read
- `GET /api/v1/accountant/workPapers/fixedAssets/summary/:id` — no query/body params read
- `POST /api/v1/accountant/workPapers/fixedAssets/schedule/:businessId` — no query/body params read
- `GET /api/v1/accountant/workPapers/fixedAssets/schedule/:businessId` — query: `exports`, `id`
- `POST /api/v1/accountant/workPapers/fixedAssets/register/convert/:businessId` — no query/body params read
- `POST /api/v1/accountant/workPapers/fixedAssets/register/extract/:businessId` — no query/body params read
- `POST /api/v1/accountant/workPapers/fixedAssets/register/convert-chunk/:businessId` — body: `body`, `chunkIndex`, `header`, `isFirst`
- `POST /api/v1/accountant/workPapers/fixedAssets/register/preview/:businessId` — body: `asset`, `cutoverDate`
- `POST /api/v1/accountant/workPapers/fixedAssets/register/import/:businessId` — body: `assets`, `cutoverDate`
- `POST /api/v1/accountant/workPapers/fixedAssets/manual/:businessId` — no query/body params read
- `POST /api/v1/accountant/workPapers/prepaid/register/convert/:businessId` — no query/body params read
- `POST /api/v1/accountant/workPapers/prepaid/register/extract/:businessId` — no query/body params read
- `POST /api/v1/accountant/workPapers/prepaid/register/convert-chunk/:businessId` — body: `body`, `chunkIndex`, `header`, `isFirst`
- `POST /api/v1/accountant/workPapers/prepaid/register/import/:businessId` — body: `cutoverDate`, `prepaids`
- `POST /api/v1/accountant/workPapers/prepaid/manual/:businessId` — no query/body params read
- `POST /api/v1/accountant/workPapers/debt/register/convert/:businessId` — no query/body params read
- `POST /api/v1/accountant/workPapers/debt/register/extract/:businessId` — no query/body params read
- `POST /api/v1/accountant/workPapers/debt/register/convert-chunk/:businessId` — body: `body`, `chunkIndex`, `header`, `isFirst`
- `POST /api/v1/accountant/workPapers/debt/register/import/:businessId` — body: `cutoverDate`, `debts`
- `POST /api/v1/accountant/workPapers/debt/manual/:businessId` — no query/body params read
- `POST /api/v1/accountant/workPapers/lease/register/convert/:businessId` — no query/body params read
- `POST /api/v1/accountant/workPapers/lease/register/extract/:businessId` — no query/body params read
- `POST /api/v1/accountant/workPapers/lease/register/convert-chunk/:businessId` — body: `body`, `chunkIndex`, `header`, `isFirst`
- `POST /api/v1/accountant/workPapers/lease/register/import/:businessId` — body: `cutoverDate`, `leases`
- `POST /api/v1/accountant/workPapers/lease/manual/:businessId` — no query/body params read
- `POST /api/v1/accountant/workPapers/revenue/register/convert/:businessId` — no query/body params read
- `POST /api/v1/accountant/workPapers/revenue/register/extract/:businessId` — no query/body params read
- `POST /api/v1/accountant/workPapers/revenue/register/convert-chunk/:businessId` — body: `body`, `chunkIndex`, `header`, `isFirst`
- `POST /api/v1/accountant/workPapers/revenue/register/import/:businessId` — body: `contracts`, `cutoverDate`
- `POST /api/v1/accountant/workPapers/revenue/manual/:businessId` — no query/body params read
- `PUT /api/v1/accountant/workPapers/fixedAssets/schedule/:businessId/:assetId` — no query/body params read
- `PUT /api/v1/accountant/workPapers/fixedAssets/schedule/:businessId/:assetId/archive` — no query/body params read
- `GET /api/v1/accountant/workPapers/fixedAssets/schedule/:businessId/monthly` — no query/body params read
- `POST /api/v1/accountant/workPapers/fixedAssets/schedule/add/:businessId` — no query/body params read
- `DELETE /api/v1/accountant/workPapers/fixedAssets/schedule/:businessId/:fixedAssetItemId` — query: `check`
- `GET /api/v1/accountant/workPapers/fixedAssets/all/:businessId` — no query/body params read
- `DELETE /api/v1/accountant/workPapers/fixedAssets/:id` — no query/body params read
- `PUT /api/v1/accountant/workPapers/fixedAssets/:businessId/:id/sale` — query: `ledgerPreview` · body: `saleDate`, `salePrice`
- `GET /api/v1/accountant/workPapers/fixedAssets/schedule/range/:id` — no query/body params read
- `POST /api/v1/accountant/workPapers/prepaid/schedule/:businessId` — no query/body params read
- `GET /api/v1/accountant/workPapers/prepaid/schedule/:businessId` — query: `id`
- `POST /api/v1/accountant/workPapers/prepaid/schedule/add/:businessId` — no query/body params read
- `PUT /api/v1/accountant/workPapers/prepaid/schedule/:businessId/:prepaidId` — no query/body params read
- `PUT /api/v1/accountant/workPapers/prepaid/schedule/:businessId/:prepaidId/archive` — no query/body params read
- `DELETE /api/v1/accountant/workPapers/prepaid/schedule/:businessId/:prepaidId` — query: `check`
- `POST /api/v1/accountant/workPapers/prepaid/schedule/rule/:businessId` — no query/body params read
- `PUT /api/v1/accountant/workPapers/prepaid/schedule/rule/:businessId/:ruleId` — no query/body params read
- `DELETE /api/v1/accountant/workPapers/prepaid/schedule/rule/:businessId/:ruleId` — no query/body params read
- `POST /api/v1/accountant/workPapers/prepaid` — no query/body params read
- `GET /api/v1/accountant/workPapers/prepaid/schedule/rules/:businessId` — no query/body params read
- `GET /api/v1/accountant/workPapers/prepaid/all/:businessId` — no query/body params read
- `GET /api/v1/accountant/workPapers/prepaid/gl/:id` — no query/body params read
- `GET /api/v1/accountant/workPapers/prepaid/schedule/range/:id` — no query/body params read
- `DELETE /api/v1/accountant/workPapers/prepaid/:id` — no query/body params read
- `PUT /api/v1/accountant/workPapers/prepaid/:id` — no query/body params read
- `GET /api/v1/accountant/workPapers/prepaid/summary/:id` — no query/body params read
- `GET /api/v1/accountant/workPapers/prepaid/:businessId/monthly` — no query/body params read
- `PUT /api/v1/accountant/workPapers/prepaid/schedule/:businessId/:id/amendment` — body: `amendmentNote`, `amendmentType`, `newStartDate`, `newTerm`, `newTotal`
- `PUT /api/v1/accountant/workPapers/prepaid/schedule/:businessId/:prepaidId/updateSchedule` — no query/body params read
- `GET /api/v1/accountant/workPapers/accrual/analysis/:businessId` — no query/body params read
- `POST /api/v1/accountant/workPapers/accrual/:businessId` — body: `account_id`, `aiReason`, `amount`, `class`, `date`, `department`, `description`, `distributionAccount`, `name`, `transactionId`, `vendor`
- `GET /api/v1/accountant/workPapers/accrual/:businessId` — no query/body params read
- `PUT /api/v1/accountant/workPapers/accrual/bulk-reverse` — body: `accrualIds`, `date`
- `PUT /api/v1/accountant/workPapers/accrual/:id` — body: `date`
- `DELETE /api/v1/accountant/workPapers/accrual/:id` — query: `check`
- `POST /api/v1/accountant/workPapers/accrual/rule/:businessId` — no query/body params read
- `PUT /api/v1/accountant/workPapers/accrual/rule/:businessId/:ruleId` — no query/body params read
- `DELETE /api/v1/accountant/workPapers/accrual/rule/:businessId/:ruleId` — no query/body params read
- `GET /api/v1/accountant/workPapers/accrual/rules/:businessId` — no query/body params read
- `GET /api/v1/accountant/workPapers/debt/estimate/:businessId` — query: `annualInterestRate`, `loanTermYears`, `originationCosts`, `paymentFrequency`, `principal`, `save`, `startDate`, `transactionId`
- `GET /api/v1/accountant/workPapers/debt/schedule/:businessId` — query: `id`
- `GET /api/v1/accountant/workPapers/debt/rules/:businessId` — no query/body params read
- `POST /api/v1/accountant/workPapers/debt/rule/:businessId` — no query/body params read
- `PUT /api/v1/accountant/workPapers/debt/rule/:businessId/:ruleId` — no query/body params read
- `DELETE /api/v1/accountant/workPapers/debt/rule/:businessId/:ruleId` — no query/body params read
- `POST /api/v1/accountant/workPapers/debt` — no query/body params read
- `GET /api/v1/accountant/workPapers/debt/:businessId` — query: `id`
- `PUT /api/v1/accountant/workPapers/debt/:id` — no query/body params read
- `GET /api/v1/accountant/workPapers/debt/gl/:id` — no query/body params read
- `GET /api/v1/accountant/workPapers/debt/schedule/range/:id` — no query/body params read
- `GET /api/v1/accountant/workPapers/debt/summary/:id` — no query/body params read
- `DELETE /api/v1/accountant/workPapers/debt/schedule/:businessId/:debtId` — query: `check`
- `POST /api/v1/accountant/workPapers/lease/estimate/:businessId` — body: `annualRate`, `assetDescription`, `classification`, `commencementDate`, `escalatorAmount`, `escalatorType`, `incrementalBorrowingRate`, `initialDirectCosts`, `leaseIncentives`, `leaseTerm`, `lessee`, `lessor`, `location`, `monthlyRent`, `paymentTiming`, `save`, `termUnits`
- `GET /api/v1/accountant/workPapers/lease/schedule/:businessId` — query: `id`
- `DELETE /api/v1/accountant/workPapers/lease/schedule/:businessId/:leaseId` — query: `check`
- `GET /api/v1/accountant/workPapers/lease/rules/:businessId` — no query/body params read
- `POST /api/v1/accountant/workPapers/lease/rule/:businessId` — no query/body params read
- `PUT /api/v1/accountant/workPapers/lease/rule/:businessId/:ruleId` — no query/body params read
- `DELETE /api/v1/accountant/workPapers/lease/rule/:businessId/:ruleId` — no query/body params read
- `POST /api/v1/accountant/workPapers/lease` — no query/body params read
- `PUT /api/v1/accountant/workPapers/lease/:id` — no query/body params read
- `GET /api/v1/accountant/workPapers/lease/:businessId` — query: `id`
- `GET /api/v1/accountant/workPapers/lease/gl/:id` — no query/body params read
- `GET /api/v1/accountant/workPapers/lease/schedule/range/:id` — no query/body params read
- `GET /api/v1/accountant/workPapers/lease/summary/:id` — no query/body params read
- `POST /api/v1/accountant/workPapers/revenue/line-items/:businessId` — no query/body params read
- `POST /api/v1/accountant/workPapers/revenue/schedule/:businessId` — no query/body params read
- `GET /api/v1/accountant/workPapers/revenue/schedule/:businessId` — query: `id`
- `PUT /api/v1/accountant/workPapers/revenue/schedule/:businessId/:recognitionId` — no query/body params read
- `PUT /api/v1/accountant/workPapers/revenue/schedule/:businessId/:recognitionId/contract-name` — body: `contractName`
- `PUT /api/v1/accountant/workPapers/revenue/schedule/:businessId/:recognitionId/archive` — no query/body params read
- `DELETE /api/v1/accountant/workPapers/revenue/schedule/:businessId/:recognitionId` — query: `check`
- `PUT /api/v1/accountant/workPapers/revenue/schedule/:businessId/:recognitionId/updateSchedule` — no query/body params read
- `GET /api/v1/accountant/workPapers/revenue/schedule/summary/:businessId` — no query/body params read
- `GET /api/v1/accountant/workPapers/revenue/schedule/rule/:businessId` — no query/body params read
- `POST /api/v1/accountant/workPapers/revenue/schedule/rule/:businessId` — no query/body params read
- `PUT /api/v1/accountant/workPapers/revenue/schedule/rule/:businessId/:ruleId` — no query/body params read
- `DELETE /api/v1/accountant/workPapers/revenue/schedule/rule/:businessId/:ruleId` — no query/body params read
- `POST /api/v1/accountant/workPapers/revenue` — no query/body params read
- `PUT /api/v1/accountant/workPapers/revenue/:id` — no query/body params read
- `GET /api/v1/accountant/workPapers/revenue/:businessId` — no query/body params read
- `GET /api/v1/accountant/workPapers/revenue/gl/:id` — no query/body params read
- `GET /api/v1/accountant/workPapers/revenue/schedule/range/:id` — no query/body params read
- `DELETE /api/v1/accountant/workPapers/revenue/:id` — query: `check`
- `GET /api/v1/accountant/workPapers/revenue/glTransactions/:businessId` — no query/body params read
- `GET /api/v1/accountant/workPapers/revenue/summary/:id` — no query/body params read
- `GET /api/v1/accountant/workPapers/suggestions/:businessId` — query: `type`
- `POST /api/v1/accountant/workPapers/bills/parse/:businessId` — no query/body params read
- `GET /api/v1/accountant/close-checklist/business/:businessId` — no query/body params read
- `POST /api/v1/accountant/close-checklist/business/:businessId` — body: `periodEnd`, `periodStart`, `tasks`
- `GET /api/v1/accountant/close-checklist/business/:businessId/:checklistId/progress` — no query/body params read
- `GET /api/v1/accountant/close-checklist/business/:businessId/:checklistId` — no query/body params read
- `PATCH /api/v1/accountant/close-checklist/business/:businessId/:checklistId` — no query/body params read
- `DELETE /api/v1/accountant/close-checklist/business/:businessId/:checklistId` — no query/body params read
- `POST /api/v1/accountant/close-checklist/business/:businessId/:checklistId/tasks` — no query/body params read
- `PATCH /api/v1/accountant/close-checklist/business/:businessId/:checklistId/tasks/:taskId` — no query/body params read
- `DELETE /api/v1/accountant/close-checklist/business/:businessId/:checklistId/tasks/:taskId` — no query/body params read
- `GET /api/v1/accountant/close-workflow/workflows` — no query/body params read
- `GET /api/v1/accountant/close-workflow/health` — no query/body params read
- `POST /api/v1/accountant/close-workflow/runs` — body: `businessId`, `clientName`, `replaceExisting`, `skipSetup`, `statements`, `workflowId`
- `POST /api/v1/accountant/close-workflow/preview` — body: `businessId`, `skipSetup`, `statements`
- `GET /api/v1/accountant/close-workflow/runs` — query: `businessId`
- `GET /api/v1/accountant/close-workflow/runs/:runId` — no query/body params read
- `GET /api/v1/accountant/close-workflow/runs/:runId/events` — query: `after`
- `POST /api/v1/accountant/close-workflow/runs/:runId/stop` — no query/body params read
- `POST /api/v1/accountant/close-workflow/runs/:runId/restart` — no query/body params read
- `POST /api/v1/accountant/close-workflow/runs/:runId/resume` — no query/body params read
- `DELETE /api/v1/accountant/close-workflow/runs/:runId` — no query/body params read
- `GET /api/v1/accountant/accounting-period/business/:businessId` — no query/body params read
- `GET /api/v1/accountant/accounting-period/business/:businessId/settings` — no query/body params read
- `PUT /api/v1/accountant/accounting-period/business/:businessId/settings` — body: `initialPeriodDate`, `isEnabled`
- `POST /api/v1/accountant/accounting-period/business/:businessId/initialize` — body: `initialDate`
- `PUT /api/v1/accountant/accounting-period/business/:businessId/close` — body: `periodIds`
- `PUT /api/v1/accountant/accounting-period/business/:businessId/reopen` — body: `periodIds`
- `GET /api/v1/accountant/accounting-period/business/:businessId/period/:periodId/history` — no query/body params read
- `GET /api/v1/accountant/schedules/:businessId` — query: `endDate`, `includeDeleted`, `limit`, `period`, `q`, `skip`, `startDate`, `status`
- `POST /api/v1/accountant/schedules/:businessId` — no query/body params read
- `GET /api/v1/accountant/schedules/:businessId/schedules/:scheduleId` — no query/body params read
- `PUT /api/v1/accountant/schedules/:businessId/schedules/:scheduleId` — no query/body params read
- `DELETE /api/v1/accountant/schedules/:businessId/schedules/:scheduleId` — no query/body params read
- `POST /api/v1/accountant/schedules/:businessId/:scheduleId/workpapers` — body: `signOff`
- `PUT /api/v1/accountant/schedules/:businessId/:scheduleId/workpapers/:workpaperId` — no query/body params read
- `DELETE /api/v1/accountant/schedules/:businessId/:scheduleId/workpapers/:workpaperId` — no query/body params read
- `POST /api/v1/accountant/schedules/:businessId/:scheduleId/workpapers/:workpaperId/comments` — no query/body params read
- `PUT /api/v1/accountant/schedules/:businessId/:scheduleId/workpapers/:workpaperId/comments/:commentId` — body: `comment`
- `DELETE /api/v1/accountant/schedules/:businessId/:scheduleId/workpapers/:workpaperId/comments/:commentId` — no query/body params read
- `POST /api/v1/accountant/schedules/:businessId/:scheduleId/workpapers/:workpaperId/attachments` — no query/body params read
- `DELETE /api/v1/accountant/schedules/:businessId/:scheduleId/workpapers/:workpaperId/attachments/:attachmentId` — no query/body params read
- `PUT /api/v1/accountant/schedules/:businessId/:scheduleId/workpapers/:workpaperId/signOff/steps/:stepId` — body: `assignedTo`, `completed`, `completedBy`, `note`
- `POST /api/v1/internal/close-agent/runs/:runId/events` — body: `events`
- `GET /api/v1/internal/close-agent/statements/:fileId` — no query/body params read
- `GET /api/v1/internal/close-agent/runs/:runId/cancelled` — no query/body params read
- `POST /api/v1/internal/close-agent/jobs/claim` — body: `agentId`, `businessId`
- `POST /api/v1/internal/close-agent/jobs/:jobId/progress` — no query/body params read
- `POST /api/v1/internal/close-agent/jobs/:jobId/touch` — no query/body params read
- `POST /api/v1/internal/close-agent/jobs/:jobId/resolve` — body: `result`, `summary`
- `POST /api/v1/internal/close-agent/jobs/:jobId/fail` — body: `error`, `summary`
- `POST /api/v1/internal/close-agent/workers/register` — body: `catalog`, `host`, `model`, `version`, `workerId`
- `POST /api/v1/internal/close-agent/workers/:workerId/heartbeat` — no query/body params read
