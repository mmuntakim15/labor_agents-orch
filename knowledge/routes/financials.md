# Financials routes

Trial balances and the statements built from them, flux (period-over-period) analysis, budgets, proforma tax reports, multi-currency FX/translation, and multi-entity consolidation with its checklist. Reach for this domain for any question about a TB, balance sheet/P&L/cash-flow figures, budget vs actual, FX revaluation, or consolidated group numbers.

## Trial balance (`/api/v1/accountant/trialBalance`)

- `POST /api/v1/accountant/trialBalance/create` — create a trial balance. Params: body businessId, companyName, tbDate. Auth: accountant.
- `GET /api/v1/accountant/trialBalance/business/:id` — list TBs for a business (`:id` = businessId); returns a BARE ARRAY of summaries. Auth: accountant.
- `GET /api/v1/accountant/trialBalance/:id` — full TB document. Params: path id. Auth: accountant.
- `GET /api/v1/accountant/trialBalance/` — all TBs visible to the caller. Auth: accountant.
- `DELETE /api/v1/accountant/trialBalance/:id` — delete a TB. Auth: accountant.
- `POST /api/v1/accountant/trialBalance/assign` — assign an accountant to a TB. Params: body. Auth: accountant.
- `POST /api/v1/accountant/trialBalance/accountant` — add an accountant to a TB. Params: body. Auth: accountant.
- `DELETE /api/v1/accountant/trialBalance/accountant` — remove an accountant from a TB. Params: body. Auth: accountant.
- `POST /api/v1/accountant/trialBalance/entry` — add a TB entry row. Params: body (trialBalanceId, entry fields). Auth: accountant.
- `PUT /api/v1/accountant/trialBalance/entry` — update a TB entry. Params: body. Auth: accountant.
- `DELETE /api/v1/accountant/trialBalance/entry` — delete a TB entry. Params: body. Auth: accountant.
- `PUT /api/v1/accountant/trialBalance/update-trial-sheet-stage` — move a trial sheet through workflow stages. Params: body. Auth: accountant.
- `PUT /api/v1/accountant/trialBalance/update-profile` — update TB profile metadata. Params: body. Auth: accountant.
- `GET /api/v1/accountant/trialBalance/:id/account-trail/:entryName` — transaction drill-down for one account on a TB. Auth: accountant.
- `GET /api/v1/accountant/trialBalance/:id/imbalance-diagnostics` — transactions causing a TB imbalance. Auth: accountant.
- `GET /api/v1/accountant/trialBalance/balance-sheet/:id` — balance sheet from TB `:id`. Auth: accountant.
- `GET /api/v1/accountant/trialBalance/profit-and-loss/:id` — P&L from TB `:id`. Auth: accountant.
- `GET /api/v1/accountant/trialBalance/statement-of-cash-flow/:id` — cash-flow statement from TB `:id`. Auth: accountant.
- `POST /api/v1/accountant/trialBalance/cash-flow` — add a cash-flow row. Params: body. Auth: accountant.
- `PUT /api/v1/accountant/trialBalance/cash-flow` — update a cash-flow row. Params: body. Auth: accountant.
- `PUT /api/v1/accountant/trialBalance/cash-flow/delete` — delete a cash-flow row (yes, a PUT). Params: body. Auth: accountant.
- `POST /api/v1/accountant/trialBalance/upload-trial-balance-sheet` — multipart TB spreadsheet upload. Params: multipart file(s). Auth: accountant.
- `POST /api/v1/accountant/trialBalance/upload-general-ledger-sheet` — multipart GL spreadsheet upload. Params: multipart file(s). Auth: accountant.
- `POST /api/v1/accountant/trialBalance/bulk-upload-quickbooks` — bulk multipart QuickBooks export upload. Auth: accountant.
- `POST /api/v1/accountant/trialBalance/analyzeTrialBalance/:id` — AI analysis of a TB (synchronous flavor). Auth: accountant.
- `POST /api/v1/accountant/trialBalance/financial-analysis/:id` — start async AI financial analysis for TB `:id`. Auth: accountant.
- `GET /api/v1/accountant/trialBalance/financial-analysis/status/:businessId` — poll the analysis job for a business. Auth: accountant.
- `GET /api/v1/accountant/trialBalance/financial-analysis/result/:id` — fetch the finished analysis for TB `:id`. Auth: accountant.
- `POST /api/v1/accountant/trialBalance/buildAccountingStrategy` — AI accounting strategy. Params: body. Auth: accountant.
- `POST /api/v1/accountant/trialBalance/buildAccountingExplanation` — AI accounting explanation. Params: body. Auth: accountant.
- `PUT /api/v1/accountant/trialBalance/base-trial-balance` — update the base (starting) TB. Params: body. Auth: accountant.
- `GET /api/v1/accountant/trialBalance/get-trial-balance/company-name` — look up a TB by company name. Params: query companyName. Auth: accountant.
- `PUT /api/v1/accountant/trialBalance/lock-trial-balance/:id` — lock a TB against edits (destructive-adjacent; confirm first). Auth: accountant.
- `GET /api/v1/accountant/trialBalance/historical-pl-budget-varience/analysis` — historical P&L vs budget variance (misspelled "varience" is the real path). Params: query. Auth: accountant.
- `GET /api/v1/accountant/trialBalance/categorize/:id` — auto-categorize entries on TB `:id`. Auth: accountant.

## Flux (`/api/v1/accountant/flux`)

- `POST /api/v1/accountant/flux/` — create a flux. Params: body businessId, type "bs"|"pl", periodType "month"|"quarter"|"year", comparedFromId, comparedToId (all required). Auth: accountant.
- `GET /api/v1/accountant/flux/business/:businessId` — list fluxes for a business. Auth: accountant.
- `GET /api/v1/accountant/flux/:id` — read one flux; query `exports=xlsx` streams a spreadsheet. Auth: accountant.
- `DELETE /api/v1/accountant/flux/:id` — delete a flux. Auth: accountant.
- `POST /api/v1/accountant/flux/compare/BalanceSheets` — compare two TBs' balance sheets. Params: body flux/TB ids. Auth: accountant.
- `POST /api/v1/accountant/flux/compare/ProfitAndLoss` — compare two TBs' P&Ls. Params: body flux/TB ids. Auth: accountant.
- `PUT /api/v1/accountant/flux/:fluxId/entry/:entryId` — update one flux line's status or explanation. Params: body update fields. Auth: accountant.
- `GET /api/v1/accountant/flux/trialBalance/business/:businessId` — TB list for the flux picker. Auth: accountant.
- `POST /api/v1/accountant/flux/attachment/upload` — multipart attachment upload (field name `file`); returns presigned link. Auth: accountant.
- `GET /api/v1/accountant/flux/flux-analysis/:fluxId` — START an async AI flux analysis (a GET that enqueues a job); returns a jobId. Auth: accountant.
- `GET /api/v1/accountant/flux/flux-analysis/status/:jobId` — poll the analysis job. Auth: accountant.
- `GET /api/v1/accountant/flux/flux-analysis/latest-job/:fluxId` — latest analysis job for a flux. Auth: accountant.
- `PUT /api/v1/accountant/flux/:id/status` — set flux status. Params: body status ∈ pending|inReview|completed|rejected|draft. Auth: accountant.
- `GET /api/v1/accountant/flux/tax-diagnostics/:id` — tax diagnostics for a flux. Auth: accountant.

## Budget (`/api/v1/accountant/budget`)

- `POST /api/v1/accountant/budget/` — create a budget. Params: body year "YYYY", businessId, entriesByCategory[] {category, accountType "PL"|"BS", months (exactly 12 {month, amount})}, optional dimension split. Auth: accountant.
- `PUT /api/v1/accountant/budget/:id` — update a budget (same body schema). Auth: accountant.
- `DELETE /api/v1/accountant/budget/:id` — delete a budget. Auth: accountant.
- `GET /api/v1/accountant/budget/business/:businessId` — list budgets for a business. Auth: accountant.
- `GET /api/v1/accountant/budget/:id` — budget vs actual. Params: query view (default account), currentStart/currentEnd/priorStart/priorEnd (YYYY-MM-DD), department/class/location. Auth: accountant.
- `GET /api/v1/accountant/budget/:id/trail` — transaction trail behind one category. Params: query category, month, dimensionField/dimensionValue. Auth: accountant.
- `POST /api/v1/accountant/budget/variance-explanation` — AI variance explanation. Params: body businessId, budgetId, accountName, currentStart, currentEnd. Auth: accountant.

## Proforma (`/api/v1/accountant/proforma`)

- `GET /api/v1/accountant/proforma/parameters/:taxYear` — tax parameter catalog for a year (read-only). Auth: accountant.
- `GET /api/v1/accountant/proforma/business/:businessId` — list proforma reports for a business. Auth: accountant.
- `POST /api/v1/accountant/proforma/business/:businessId` — create a report. Params: body actualsStart, actualsEnd (1–12 months, end after start), name, taxYear; businessId defaulted from path. Auth: accountant.
- `GET /api/v1/accountant/proforma/:id` — read one report. Auth: accountant.
- `DELETE /api/v1/accountant/proforma/:id` — delete a report. Auth: accountant.
- `PUT /api/v1/accountant/proforma/:id/rows` — upsert report rows. Params: body rows. Auth: accountant.
- `POST /api/v1/accountant/proforma/:id/regenerate` — rebuild the report from current actuals. Auth: accountant.
- `PUT /api/v1/accountant/proforma/:id/book-to-tax` — update book-to-tax adjustments. Auth: accountant.
- `POST /api/v1/accountant/proforma/:id/book-to-tax/suggest` — AI-suggest book-to-tax adjustments. Auth: accountant.
- `PUT /api/v1/accountant/proforma/:id/owners` — update owner allocations. Auth: accountant.
- `POST /api/v1/accountant/proforma/:id/owners/suggest-qbi` — AI-suggest QBI treatment. Auth: accountant.
- `POST /api/v1/accountant/proforma/:id/owners/extract-1040` — multipart 1040 PDF extraction (field `file`, 15MB cap; held in memory only, never stored — it carries SSNs). Auth: accountant.
- `PUT /api/v1/accountant/proforma/:id/status` — set report status. Auth: accountant.
- `POST /api/v1/accountant/proforma/:id/scenario` — fork a what-if scenario. Auth: accountant.
- `GET /api/v1/accountant/proforma/:id/export` — export the report (file download). Auth: accountant.
- `POST /api/v1/accountant/proforma/:id/strategies` — generate tax strategies. Auth: accountant.
- `POST /api/v1/accountant/proforma/:id/strategies/export` — export strategies as PDF. Auth: accountant.

## Multi-currency (`/api/v1/accountant/multiCurrency`)

All routes also require accountant JWT; most additionally require role-registry perms: reads need `multi_currency_read` OR `multi_currency_write`, writes need `multi_currency_write` (by default only firm owner / super admins hold these). Routes marked "accountant only" skip the perm gate.

- `GET /api/v1/accountant/multiCurrency/business/:businessId/settings` — read MC settings. Auth: accountant only.
- `PUT /api/v1/accountant/multiCurrency/business/:businessId/settings` — update MC settings. Auth: accountant + mc write.
- `GET /api/v1/accountant/multiCurrency/rate` — exchange-rate lookup. Params: query currency pair/date. Auth: accountant only.
- `POST /api/v1/accountant/multiCurrency/business/:businessId/revaluation/preview` — preview period-end revaluation (read-only POST). Auth: accountant + mc read.
- `POST /api/v1/accountant/multiCurrency/business/:businessId/revaluation/run` — post revaluation to GL. Auth: accountant + mc write.
- `GET /api/v1/accountant/multiCurrency/business/:businessId/revaluation/runs` — list revaluation runs. Auth: accountant + mc read.
- `POST /api/v1/accountant/multiCurrency/business/:businessId/revaluation/:runId/reverse` — reverse a revaluation run. Auth: accountant + mc write.
- `POST /api/v1/accountant/multiCurrency/business/:businessId/settlement/match` — FX settlement on a bank match. Auth: accountant only.
- `POST /api/v1/accountant/multiCurrency/business/:businessId/settlement/transfer` — FX settlement on a transfer match. Auth: accountant only.
- `GET /api/v1/accountant/multiCurrency/relationships` — list intercompany relationships. Auth: accountant + mc read.
- `POST /api/v1/accountant/multiCurrency/relationships` — create a relationship. Auth: accountant + mc write.
- `PUT /api/v1/accountant/multiCurrency/relationships/:relationshipId` — update a relationship. Auth: accountant + mc write.
- `DELETE /api/v1/accountant/multiCurrency/relationships/:relationshipId` — delete a relationship. Auth: accountant + mc write.
- `GET /api/v1/accountant/multiCurrency/business/:businessId/equity-events` — list equity events. Auth: accountant + mc read.
- `POST /api/v1/accountant/multiCurrency/business/:businessId/equity-events` — create an equity event. Auth: accountant + mc write.
- `DELETE /api/v1/accountant/multiCurrency/business/:businessId/equity-events/:eventId` — delete an equity event. Auth: accountant + mc write.
- `POST /api/v1/accountant/multiCurrency/business/:businessId/translation/run` — run currency translation (persists carry-forwards + CTA). Auth: accountant + mc write.
- `POST /api/v1/accountant/multiCurrency/business/:businessId/translation/preview` — preview translation. Auth: accountant + mc read.
- `GET /api/v1/accountant/multiCurrency/business/:businessId/translation/runs` — list translation runs. Auth: accountant + mc read.
- `POST /api/v1/accountant/multiCurrency/business/:businessId/consolidation/run` — run group consolidation (`:businessId` = parent entity). Auth: accountant + mc write.
- `GET /api/v1/accountant/multiCurrency/business/:businessId/consolidation/view` — consolidated reporting view. Auth: accountant + mc read.
- `GET /api/v1/accountant/multiCurrency/business/:businessId/consolidation/runs` — list group consolidation runs. Auth: accountant + mc read.
- `GET /api/v1/accountant/multiCurrency/business/:businessId/intercompany/matrix` — IC balances matrix. Auth: accountant + mc read.
- `GET /api/v1/accountant/multiCurrency/business/:businessId/intercompany/reconciliation` — IC reconciliation. Auth: accountant + mc read.
- `POST /api/v1/accountant/multiCurrency/business/:businessId/intercompany/netting/propose` — propose an IC netting run (a read despite POST). Auth: accountant + mc read.
- `POST /api/v1/accountant/multiCurrency/business/:businessId/intercompany/netting/:runId/post` — post a netting run, books real journals. Auth: accountant + mc write.
- `POST /api/v1/accountant/multiCurrency/business/:businessId/intercompany/netting/:runId/reverse` — reverse a netting run. Auth: accountant + mc write.
- `GET /api/v1/accountant/multiCurrency/business/:businessId/intercompany/netting/runs` — list netting runs. Auth: accountant + mc read.
- `GET /api/v1/accountant/multiCurrency/business/:businessId/fx-reports/gains-losses` — FX gains/losses report. Auth: accountant + mc read.
- `GET /api/v1/accountant/multiCurrency/business/:businessId/fx-reports/exposure` — FX exposure report. Auth: accountant + mc read.
- `GET /api/v1/accountant/multiCurrency/business/:businessId/consolidation-reports/workpaper` — consolidation workpaper. Auth: accountant + mc read.
- `GET /api/v1/accountant/multiCurrency/business/:businessId/fx-reports/constant-currency` — constant-currency report. Auth: accountant + mc read.

## Consolidation (`/api/v1/accountant/consolidation`)

- `POST /api/v1/accountant/consolidation/` — create a consolidation. Params: body name, startDate, endDate (ISO), businesses[] {id, name, isParent?, currency?} min 2, optional notes, previousConsolidationId. Auth: accountant.
- `GET /api/v1/accountant/consolidation/` — list consolidations. Auth: accountant.
- `GET /api/v1/accountant/consolidation/:id` — read one; query `exports=xlsx` (+ `tab`, `view` default consolidated) streams a spreadsheet. Auth: accountant.
- `POST /api/v1/accountant/consolidation/:id/refresh` — rebuild from current entity data. Auth: accountant.
- `DELETE /api/v1/accountant/consolidation/:id` — delete a consolidation. Auth: accountant.
- `PATCH /api/v1/accountant/consolidation/:id` — partial update of allowed fields. Auth: accountant.
- `PATCH /api/v1/accountant/consolidation/:id/elimination-cards/:cardId` — set an elimination card's status. Params: body status. Auth: accountant.
- `GET /api/v1/accountant/consolidation/:id/alerts` — alerts on a consolidation. Auth: accountant.
- `POST /api/v1/accountant/consolidation/:id/analysis` — start async AI analysis. Auth: accountant.
- `GET /api/v1/accountant/consolidation/:id/analysis/status` — poll the analysis. Auth: accountant.
- `GET /api/v1/accountant/consolidation/:id/analysis/result` — fetch the finished analysis. Auth: accountant.

## Consolidation checklist (same `/api/v1/accountant/consolidation` prefix, separate router)

- `POST /api/v1/accountant/consolidation/:consolidationId/checklist` — create the checklist. Auth: accountant.
- `GET /api/v1/accountant/consolidation/:consolidationId/checklist` — read the checklist. Auth: accountant.
- `PATCH /api/v1/accountant/consolidation/:consolidationId/checklist` — update the checklist. Auth: accountant.
- `DELETE /api/v1/accountant/consolidation/:consolidationId/checklist` — delete the checklist. Auth: accountant.
- `POST /api/v1/accountant/consolidation/:consolidationId/checklist/tasks` — add a task. Auth: accountant.
- `PATCH /api/v1/accountant/consolidation/:consolidationId/checklist/tasks/:taskId` — update a task. Auth: accountant.
- `DELETE /api/v1/accountant/consolidation/:consolidationId/checklist/tasks/:taskId` — delete a task. Auth: accountant.

## Gotchas

- `GET /trialBalance/business/:id` returns a **bare array**, not `{data: [...]}`. Empty means `[]`, not 404.
- Async job + poll patterns: TB financial-analysis (`POST .../financial-analysis/:id` then poll `status/:businessId`, result at `result/:id`), flux analysis (`GET /flux/flux-analysis/:fluxId` **starts** the job — a GET with side effects — then poll `status/:jobId`), consolidation analysis (`POST /:id/analysis` then `analysis/status` / `analysis/result`).
- Delete-by-PUT: cash-flow rows are deleted with `PUT /trialBalance/cash-flow/delete`, and TB entries/accountants are deleted with the target identified in the request **body**, not the path.
- The misspelled path `/trialBalance/historical-pl-budget-varience/analysis` is correct — do not "fix" it to variance.
- Budget create/update requires `entriesByCategory` with **exactly 12 months** per category; `dimensionField` and `dimensionValue` must be set together or both omitted.
- Flux create is strictly validated: type must be `bs` or `pl`, periodType `month|quarter|year`; `comparedFromId`/`comparedToId` are trial-balance ids.
- Consolidation create requires **at least 2 businesses** in the `businesses` array, each with `id` and `name`.
- Spreadsheet exports: `GET /flux/:id?exports=xlsx` and `GET /consolidation/:id?exports=xlsx&tab=...&view=...` return binary files, not JSON.
- Multi-currency mutations need the `multi_currency_write` role permission — a plain accountant JWT gets 403 on them even as ADMIN; the helper's minted owner token passes only if the role registry grants it (firm owner does by default).
- `netting/propose` and `revaluation/preview` / `translation/preview` are POSTs that write nothing; `run`, `post`, and `reverse` book real GL entries — treat those as confirm-first actions.
- Proforma 1040 upload accepts one file (field `file`) max 15MB, processed in memory and discarded — never re-upload elsewhere; it contains SSNs.


## Appendix — exact parameters, extracted from the controllers

Machine-extracted from the product's controller source (every `req.query` /
`req.body` key the handler actually reads). This is the authority on filter
parameter NAMES — a name not listed here is silently ignored by that route.
Meanings and formats live in the entries above; when in doubt, pass exactly
these names and verify the returned date span and row count.

- `POST /api/v1/accountant/trialBalance/financial-analysis/:id` — no query/body params read
- `GET /api/v1/accountant/trialBalance/financial-analysis/status/:businessId` — no query/body params read
- `GET /api/v1/accountant/trialBalance/financial-analysis/result/:id` — no query/body params read
- `GET /api/v1/accountant/trialBalance/:id/imbalance-diagnostics` — no query/body params read
- `POST /api/v1/accountant/trialBalance/create` — query: `dime`, `refresh`, `trialBalanceId` · body: `businessId`, `companyName`, `endDate`, `previousTrialBalanceId`, `startDate`, `tbDate`, `year`
- `GET /api/v1/accountant/trialBalance/business/:id` — no query/body params read
- `POST /api/v1/accountant/trialBalance/assign` — body: `accountantId`, `trialBalanceId`
- `POST /api/v1/accountant/trialBalance/accountant` — body: `data`, `trialBalanceId`
- `DELETE /api/v1/accountant/trialBalance/accountant` — body: `accountantId`, `trialBalanceId`
- `POST /api/v1/accountant/trialBalance/entry` — no query/body params read
- `PUT /api/v1/accountant/trialBalance/entry` — body: `data`, `entryId`, `trialBalanceId`
- `DELETE /api/v1/accountant/trialBalance/entry` — body: `entryId`, `trialBalanceId`
- `PUT /api/v1/accountant/trialBalance/update-trial-sheet-stage` — body: `reason`, `status`, `trialBalanceId`
- `GET /api/v1/accountant/trialBalance/:id/account-trail/:entryName` — no query/body params read
- `GET /api/v1/accountant/trialBalance/:id` — query: `exports`, `summary`
- `DELETE /api/v1/accountant/trialBalance/:id` — no query/body params read
- `PUT /api/v1/accountant/trialBalance/update-profile` — body: `data`, `trialBalanceId`
- `GET /api/v1/accountant/trialBalance` — query: `accountantName`, `businessName`, `endDate`, `stage`, `startDate`
- `GET /api/v1/accountant/trialBalance/balance-sheet/:id` — query: `exports`, `summary`
- `GET /api/v1/accountant/trialBalance/profit-and-loss/:id` — query: `class`, `customFields`, `department`, `exports`, `location`, `summary`
- `GET /api/v1/accountant/trialBalance/statement-of-cash-flow/:id` — query: `businessId`, `exports`, `summary`
- `POST /api/v1/accountant/trialBalance/cash-flow` — body: `amount`, `name`, `source`, `trialBalanceId`, `type`
- `PUT /api/v1/accountant/trialBalance/cash-flow` — body: `cashFlowId`, `data`, `trialBalanceId`
- `PUT /api/v1/accountant/trialBalance/cash-flow/delete` — body: `cashFlowId`, `trialBalanceId`
- `POST /api/v1/accountant/trialBalance/upload-trial-balance-sheet` — body: `businessId`, `companyName`, `endDate`, `startDate`, `tbDate`, `year`
- `POST /api/v1/accountant/trialBalance/upload-general-ledger-sheet` — body: `trialBalanceId`
- `POST /api/v1/accountant/trialBalance/analyzeTrialBalance/:id` — no query/body params read
- `POST /api/v1/accountant/trialBalance/buildAccountingStrategy` — no query/body params read
- `POST /api/v1/accountant/trialBalance/buildAccountingExplanation` — body: `baseTrialBalanceId`, `comparedBalanceSheet`, `trialBalanceId`
- `PUT /api/v1/accountant/trialBalance/base-trial-balance` — body: `baseTrialBalanceId`, `date`, `trialBalanceId`
- `GET /api/v1/accountant/trialBalance/get-trial-balance/company-name` — no query/body params read
- `PUT /api/v1/accountant/trialBalance/lock-trial-balance/:id` — no query/body params read
- `GET /api/v1/accountant/trialBalance/historical-pl-budget-varience/analysis` — query: `businessId`
- `POST /api/v1/accountant/trialBalance/bulk-upload-quickbooks` — no query/body params read
- `GET /api/v1/accountant/trialBalance/categorize/:id` — no query/body params read
- `POST /api/v1/accountant/flux` — no query/body params read
- `GET /api/v1/accountant/flux/business/:businessId` — no query/body params read
- `GET /api/v1/accountant/flux/:id` — query: `exports`
- `DELETE /api/v1/accountant/flux/:id` — no query/body params read
- `POST /api/v1/accountant/flux/compare/BalanceSheets` — body: `comparedFromId`, `comparedToId`, `id`
- `POST /api/v1/accountant/flux/compare/ProfitAndLoss` — body: `comparedFromId`, `comparedToId`, `id`
- `PUT /api/v1/accountant/flux/:fluxId/entry/:entryId` — no query/body params read
- `GET /api/v1/accountant/flux/trialBalance/business/:businessId` — no query/body params read
- `POST /api/v1/accountant/flux/attachment/upload` — no query/body params read
- `GET /api/v1/accountant/flux/flux-analysis/:fluxId` — no query/body params read
- `GET /api/v1/accountant/flux/flux-analysis/status/:jobId` — no query/body params read
- `GET /api/v1/accountant/flux/flux-analysis/latest-job/:fluxId` — no query/body params read
- `PUT /api/v1/accountant/flux/:id/status` — body: `status`
- `GET /api/v1/accountant/flux/tax-diagnostics/:id` — no query/body params read
- `POST /api/v1/accountant/budget` — no query/body params read
- `PUT /api/v1/accountant/budget/:id` — no query/body params read
- `DELETE /api/v1/accountant/budget/:id` — no query/body params read
- `GET /api/v1/accountant/budget/business/:businessId` — no query/body params read
- `POST /api/v1/accountant/budget/variance-explanation` — body: `accountName`, `budgetId`, `businessId`, `currentEnd`, `currentStart`
- `GET /api/v1/accountant/budget/:id/trail` — query: `businessId`, `category`, `dimensionField`, `dimensionValue`, `month`
- `GET /api/v1/accountant/budget/:id` — query: `businessId`, `class`, `currentEnd`, `currentStart`, `department`, `location`, `priorEnd`, `priorStart`, `view`
- `GET /api/v1/accountant/proforma/parameters/:taxYear` — no query/body params read
- `GET /api/v1/accountant/proforma/business/:businessId` — no query/body params read
- `GET /api/v1/accountant/proforma/:id` — no query/body params read
- `DELETE /api/v1/accountant/proforma/:id` — no query/body params read
- `PUT /api/v1/accountant/proforma/:id/rows` — no query/body params read
- `POST /api/v1/accountant/proforma/:id/regenerate` — no query/body params read
- `PUT /api/v1/accountant/proforma/:id/book-to-tax` — no query/body params read
- `POST /api/v1/accountant/proforma/:id/book-to-tax/suggest` — no query/body params read
- `PUT /api/v1/accountant/proforma/:id/owners` — no query/body params read
- `POST /api/v1/accountant/proforma/:id/owners/suggest-qbi` — no query/body params read
- `POST /api/v1/accountant/proforma/:id/owners/extract-1040` — no query/body params read
- `PUT /api/v1/accountant/proforma/:id/status` — no query/body params read
- `POST /api/v1/accountant/proforma/:id/scenario` — no query/body params read
- `GET /api/v1/accountant/proforma/:id/export` — no query/body params read
- `POST /api/v1/accountant/proforma/:id/strategies` — no query/body params read
- `POST /api/v1/accountant/proforma/:id/strategies/export` — no query/body params read
- `GET /api/v1/accountant/multiCurrency/business/:businessId/settings` — no query/body params read
- `PUT /api/v1/accountant/multiCurrency/business/:businessId/settings` — no query/body params read
- `GET /api/v1/accountant/multiCurrency/rate` — query: `date`, `from`, `to`
- `POST /api/v1/accountant/multiCurrency/business/:businessId/revaluation/preview` — no query/body params read
- `POST /api/v1/accountant/multiCurrency/business/:businessId/revaluation/run` — no query/body params read
- `GET /api/v1/accountant/multiCurrency/business/:businessId/revaluation/runs` — no query/body params read
- `POST /api/v1/accountant/multiCurrency/business/:businessId/revaluation/:runId/reverse` — no query/body params read
- `POST /api/v1/accountant/multiCurrency/business/:businessId/settlement/match` — body: `bankTransactionId`, `matches`
- `POST /api/v1/accountant/multiCurrency/business/:businessId/settlement/transfer` — body: `inTransactionId`, `outTransactionId`
- `GET /api/v1/accountant/multiCurrency/relationships` — no query/body params read
- `POST /api/v1/accountant/multiCurrency/relationships` — no query/body params read
- `PUT /api/v1/accountant/multiCurrency/relationships/:relationshipId` — no query/body params read
- `DELETE /api/v1/accountant/multiCurrency/relationships/:relationshipId` — no query/body params read
- `GET /api/v1/accountant/multiCurrency/business/:businessId/equity-events` — no query/body params read
- `POST /api/v1/accountant/multiCurrency/business/:businessId/equity-events` — body: `date`, `fcAmount`, `notes`, `source`, `translatedAmount`, `type`
- `DELETE /api/v1/accountant/multiCurrency/business/:businessId/equity-events/:eventId` — no query/body params read
- `POST /api/v1/accountant/multiCurrency/business/:businessId/translation/run` — body: `period`, `reportingCurrency`
- `POST /api/v1/accountant/multiCurrency/business/:businessId/translation/preview` — body: `asOf`, `reportingCurrency`
- `GET /api/v1/accountant/multiCurrency/business/:businessId/translation/runs` — no query/body params read
- `POST /api/v1/accountant/multiCurrency/business/:businessId/consolidation/run` — body: `period`
- `GET /api/v1/accountant/multiCurrency/business/:businessId/consolidation/view` — query: `entityId`, `period`, `view`
- `GET /api/v1/accountant/multiCurrency/business/:businessId/consolidation/runs` — no query/body params read
- `GET /api/v1/accountant/multiCurrency/business/:businessId/intercompany/matrix` — query: `asOf`
- `GET /api/v1/accountant/multiCurrency/business/:businessId/intercompany/reconciliation` — query: `asOf`
- `POST /api/v1/accountant/multiCurrency/business/:businessId/intercompany/netting/propose` — body: `period`
- `POST /api/v1/accountant/multiCurrency/business/:businessId/intercompany/netting/:runId/post` — no query/body params read
- `POST /api/v1/accountant/multiCurrency/business/:businessId/intercompany/netting/:runId/reverse` — no query/body params read
- `GET /api/v1/accountant/multiCurrency/business/:businessId/intercompany/netting/runs` — no query/body params read
- `GET /api/v1/accountant/multiCurrency/business/:businessId/fx-reports/gains-losses` — query: `from`, `to`
- `GET /api/v1/accountant/multiCurrency/business/:businessId/fx-reports/exposure` — query: `asOf`
- `GET /api/v1/accountant/multiCurrency/business/:businessId/consolidation-reports/workpaper` — query: `period`
- `GET /api/v1/accountant/multiCurrency/business/:businessId/fx-reports/constant-currency` — query: `baseline`, `period`
- `POST /api/v1/accountant/consolidation` — body: `businesses`, `endDate`, `name`, `notes`, `previousConsolidationId`, `startDate`
- `POST /api/v1/accountant/consolidation/:id/refresh` — no query/body params read
- `POST /api/v1/accountant/consolidation/:id/analysis` — no query/body params read
- `GET /api/v1/accountant/consolidation/:id/analysis/status` — no query/body params read
- `GET /api/v1/accountant/consolidation/:id/analysis/result` — no query/body params read
- `GET /api/v1/accountant/consolidation/:id/alerts` — no query/body params read
- `GET /api/v1/accountant/consolidation/:id` — query: `exports`, `tab`, `view`
- `GET /api/v1/accountant/consolidation` — no query/body params read
- `DELETE /api/v1/accountant/consolidation/:id` — no query/body params read
- `PATCH /api/v1/accountant/consolidation/:id/elimination-cards/:cardId` — no query/body params read
- `PATCH /api/v1/accountant/consolidation/:id` — no query/body params read
- `POST /api/v1/accountant/consolidation/:consolidationId/checklist` — body: `tasks`
- `GET /api/v1/accountant/consolidation/:consolidationId/checklist` — no query/body params read
- `PATCH /api/v1/accountant/consolidation/:consolidationId/checklist` — no query/body params read
- `DELETE /api/v1/accountant/consolidation/:consolidationId/checklist` — no query/body params read
- `POST /api/v1/accountant/consolidation/:consolidationId/checklist/tasks` — no query/body params read
- `PATCH /api/v1/accountant/consolidation/:consolidationId/checklist/tasks/:taskId` — no query/body params read
- `DELETE /api/v1/accountant/consolidation/:consolidationId/checklist/tasks/:taskId` — no query/body params read
