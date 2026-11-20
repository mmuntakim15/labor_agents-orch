# Reports & Analytics

Every financial report (aging, trial balance, balance sheet, P&L, GL, cash flow, schedules), report packages and their AI footnotes, presentation mappings, executive-summary settings, CFO analytics/KPIs, and the accountant dashboard (client list, search, FX). Reach for this file whenever the person asks for a figure, a statement, a trend, an export, or a report package.

## Financial reports (accountant JWT) — /api/v1/accountant/reports

- `GET /api/v1/accountant/reports/ar-aging/:businessId` — AR aging buckets by customer. Params: query asOf (YYYY-MM-DD), exports=xlsx. Auth: accountant.
- `GET /api/v1/accountant/reports/ap-aging/:businessId` — AP aging buckets by vendor. Params: query asOf, exports=xlsx. Auth: accountant.
- `GET /api/v1/accountant/reports/trial-balance-realtime/:businessId` — TB *variance* (period vs prior/budget) from saved TrialBalance docs. Params: query currentStart, currentEnd, priorStart, priorEnd, comparisonMode (prior|budget|both), budgetId, department, class, location, customFields, exports=xlsx. Auth: accountant.
- `GET /api/v1/accountant/reports/balance-sheet-realtime/:businessId` — Balance sheet variance. Params: same period/filter set as TB variance. Auth: accountant.
- `GET /api/v1/accountant/reports/statement-of-cash-flow-realtime/:businessId` — Cash-flow statement variance. Params: same period/filter set. Auth: accountant.
- `GET /api/v1/accountant/reports/trial-balance-asof/:businessId` — Live point-in-time TB from the ledger; refuses locked periods. Params: query asOf. Auth: accountant.
- `GET /api/v1/accountant/reports/balance-sheet-asof/:businessId` — Live point-in-time balance sheet. Params: query asOf. Auth: accountant.
- `GET /api/v1/accountant/reports/statement-of-cash-flow-asof/:businessId` — Live point-in-time cash-flow statement. Params: query asOf. Auth: accountant.
- `GET /api/v1/accountant/reports/profit-and-loss-realtime/:businessId` — Live P&L for a range. Params: query startDate, endDate, department, class, location, customFields, exports=xlsx. Auth: accountant.
- `GET /api/v1/accountant/reports/income-statement-by-field/:businessId` — Income statement pivoted by a dimension field. Params: query startDate, endDate + field selection. Auth: accountant.
- `GET /api/v1/accountant/reports/executive-income-statement/:businessId` — Executive income statement using the summary-category config. Params: query startDate, endDate. Auth: accountant.
- `GET /api/v1/accountant/reports/general-ledger-realtime/:businessId` — Full GL with debit/credit totals (the close-gating balance check). Params: query startDate, endDate, dimension filters, exports=xlsx. Auth: accountant.
- `GET /api/v1/accountant/reports/general-ledger-account-realtime/:businessId` — GL for one account. Params: query startDate, endDate, account_id. Auth: accountant.
- `GET /api/v1/accountant/reports/bank-register-realtime/:businessId` — Bank register per account. Params: query startDate, endDate, account. Auth: accountant.
- `GET /api/v1/accountant/reports/chart-of-accounts-with-balance/:businessId` — CoA annotated with balances. Params: none required. Auth: accountant.
- `GET /api/v1/accountant/reports/vendor-spend-analysis/:businessId` — Vendor spend trends. Params: query ytdStart, ytdEnd, priorStart, priorEnd, trendMonths (1-24), accounts, vendors (comma lists), exports=xlsx. Auth: accountant.
- `GET /api/v1/accountant/reports/payment-history/:businessId` — Payment history. Params: query startDate, endDate, includeNonPaid=true, exports=xlsx. Auth: accountant.
- `GET /api/v1/accountant/reports/open-bills-report/:businessId` — Open bills listing. Params: query startDate, endDate, billable, exports=xlsx. Auth: accountant.
- `GET /api/v1/accountant/reports/1099-dashboard/:businessId` — 1099 contractor payment dashboard. Params: calendar year. Auth: accountant.
- `GET /api/v1/accountant/reports/customer-revenue-analysis/:businessId` — Revenue by customer. Params: date range query. Auth: accountant.
- `GET /api/v1/accountant/reports/invoice-register/:businessId` — Invoice register. Params: date range query, exports=xlsx. Auth: accountant.
- `GET /api/v1/accountant/reports/cash-receipts-journal/:businessId` — Cash receipts journal. Params: date range query. Auth: accountant.
- `GET /api/v1/accountant/reports/credit-memo-listing/:businessId` — Credit memo listing. Params: date range query. Auth: accountant.
- `GET /api/v1/accountant/reports/revenue-by-product/:businessId` — Revenue by product/service line. Params: date range query. Auth: accountant.
- `GET /api/v1/accountant/reports/deferred-revenue-schedule/:businessId` — Deferred revenue schedule. Params: as-of/date range. Auth: accountant.
- `GET /api/v1/accountant/reports/churn-analysis/:businessId` — Customer churn analysis. Params: period query. Auth: accountant.
- `GET /api/v1/accountant/reports/cohort-analysis/:businessId` — Revenue cohort analysis. Params: period query. Auth: accountant.
- `GET /api/v1/accountant/reports/net-revenue-retention/:businessId` — NRR metrics. Params: period query. Auth: accountant.
- `GET /api/v1/accountant/reports/bank-reconciliation-report/:businessId` — Bank reconciliation summary. Params: period query. Auth: accountant.
- `GET /api/v1/accountant/reports/cash-forecast/:businessId` — Cash forecast. Params: horizon query. Auth: accountant.
- `GET /api/v1/accountant/reports/credit-card-spend-report/:businessId` — Credit card spend. Params: date range query. Auth: accountant.
- `GET /api/v1/accountant/reports/revenue-recognition-schedule/:businessId` — Rev-rec schedule. Params: period query. Auth: accountant.
- `GET /api/v1/accountant/reports/prepaid-expense-schedule/:businessId` — Prepaid amortization schedule. Params: period query. Auth: accountant.
- `GET /api/v1/accountant/reports/fixed-asset-schedule/:businessId` — Fixed asset depreciation schedule. Params: period query. Auth: accountant.

## Report settings — /api/v1/accountant/report-settings

- `GET /api/v1/accountant/report-settings/:businessId/summary-categories/status` — Is the summary-category config complete. Params: path businessId. Auth: accountant.
- `GET /api/v1/accountant/report-settings/:businessId/summary-categories` — Read driver field, categories, value mapping merged with live field values. Params: path businessId. Auth: accountant.
- `PUT /api/v1/accountant/report-settings/:businessId/summary-categories` — Replace the config. Params: body driverField {kind, fieldName, customFieldId?}, categories[], valueMapping[{driverValue, categoryId}]; 422 on validation failure. Auth: accountant.

## Report packages — /api/v1/accountant/reportPackages

- `GET /api/v1/accountant/reportPackages/business/:businessId` — List packages (rows carry aiJobStatus for in-flight footnote jobs). Params: query status, accountantId. Auth: accountant.
- `POST /api/v1/accountant/reportPackages/business/:businessId` — Create a package. Params: body name, trialBalanceIds[] (must belong to the business), sections, optional periodLabel/entityType/framework/engagement/isConsolidated. Auth: accountant.
- `GET /api/v1/accountant/reportPackages/:id` — Read one package. Params: path id. Auth: accountant.
- `PUT /api/v1/accountant/reportPackages/:id` — Update; 400 if the package is final. Params: body partial package fields. Auth: accountant.
- `DELETE /api/v1/accountant/reportPackages/:id` — Hard-delete a package. Params: path id. Auth: accountant.
- `PATCH /api/v1/accountant/reportPackages/:id/status` — Change status; setting "final" locks every footnote. Params: body {status}. Auth: accountant.
- `GET /api/v1/accountant/reportPackages/:id/preview-data` — Composed statement preview + footnotes + recommended footnote catalog. Params: path id. Auth: accountant.
- `PUT /api/v1/accountant/reportPackages/:id/footnotes` — Upsert footnotes by key; blocked on final packages. Params: body {footnotes:[{key, title, bodyHtml, order}]}. Auth: accountant.
- `DELETE /api/v1/accountant/reportPackages/:id/footnotes/:key` — Delete one footnote; blocked on final packages. Params: path id, key. Auth: accountant.
- `POST /api/v1/accountant/reportPackages/:id/generate-footnotes` — Enqueue AI footnote generation; returns 202 {jobId}. Params: body footnoteKeys, overwriteEdited. Auth: accountant.
- `GET /api/v1/accountant/reportPackages/footnote-jobs/:jobId` — Poll a footnote job (status pending/processing/completed/failed, progress.percentage). Params: path jobId. Auth: accountant.
- `POST /api/v1/accountant/reportPackages/:id/render-pdf` — Render to PDF, upload to S3, return signed {url, bytes, expiresAt}. Params: path id, no body. Auth: accountant.

## Presentation mappings — /api/v1/accountant/presentationMapping

- `GET /api/v1/accountant/presentationMapping/templates` — List SEC-style starter templates. Params: query statementType. Auth: accountant.
- `POST /api/v1/accountant/presentationMapping/templates/seed` — Seed the built-in template set. Params: none. Auth: accountant.
- `GET /api/v1/accountant/presentationMapping/business/:businessId` — List a business's mappings. Params: query statementType. Auth: accountant.
- `GET /api/v1/accountant/presentationMapping/business/:businessId/default/:statementType` — Active default mapping for a statement type. Params: path both. Auth: accountant.
- `POST /api/v1/accountant/presentationMapping/business/:businessId` — Create a mapping (businessId defaults from URL). Params: body mapping fields. Auth: accountant.
- `GET /api/v1/accountant/presentationMapping/:id` — Read one mapping. Params: path id. Auth: accountant.
- `PUT /api/v1/accountant/presentationMapping/:id` — Update a mapping. Params: body mapping fields. Auth: accountant.
- `DELETE /api/v1/accountant/presentationMapping/:id` — Delete a mapping. Params: path id. Auth: accountant.
- `POST /api/v1/accountant/presentationMapping/:id/set-default` — Make this the business default for its statement type. Params: path id. Auth: accountant.
- `POST /api/v1/accountant/presentationMapping/:id/preview` — Preview statement output under the mapping. Params: path id. Auth: accountant.
- `POST /api/v1/accountant/presentationMapping/:id/auto-organize` — AI auto-assignment of accounts to lines. Params: path id. Auth: accountant.
- `POST /api/v1/accountant/presentationMapping/:id/import-from-pdf` — Extract a layout from an uploaded PDF. Params: multipart field "file" (10 MB cap). Auth: accountant.

## Machine-auth report mirror — /api/v1/api/reports

Same controllers and query params as the accountant reports above, but authenticated with API-client credentials (`apiClientAuth`), not the accountant JWT. Auth: machine for all 28.

- `GET /api/v1/api/reports/ar-aging/:businessId` — AR aging. Params: asOf. Auth: machine.
- `GET /api/v1/api/reports/ap-aging/:businessId` — AP aging. Params: asOf. Auth: machine.
- `GET /api/v1/api/reports/trial-balance-realtime/:businessId` — TB variance. Params: currentStart/currentEnd/priorStart/priorEnd. Auth: machine.
- `GET /api/v1/api/reports/balance-sheet-realtime/:businessId` — BS variance. Auth: machine.
- `GET /api/v1/api/reports/statement-of-cash-flow-realtime/:businessId` — CF variance. Auth: machine.
- `GET /api/v1/api/reports/profit-and-loss-realtime/:businessId` — Live P&L. Params: startDate, endDate. Auth: machine.
- `GET /api/v1/api/reports/general-ledger-realtime/:businessId` — Live GL. Params: startDate, endDate. Auth: machine.
- `GET /api/v1/api/reports/general-ledger-account-realtime/:businessId` — Single-account GL. Params: startDate, endDate, account_id. Auth: machine.
- `GET /api/v1/api/reports/chart-of-accounts-with-balance/:businessId` — CoA with balances. Auth: machine.
- `GET /api/v1/api/reports/vendor-spend-analysis/:businessId` — Vendor spend. Auth: machine.
- `GET /api/v1/api/reports/payment-history/:businessId` — Payment history. Auth: machine.
- `GET /api/v1/api/reports/open-bills-report/:businessId` — Open bills. Auth: machine.
- `GET /api/v1/api/reports/1099-dashboard/:businessId` — 1099 dashboard. Auth: machine.
- `GET /api/v1/api/reports/customer-revenue-analysis/:businessId` — Customer revenue. Auth: machine.
- `GET /api/v1/api/reports/invoice-register/:businessId` — Invoice register. Auth: machine.
- `GET /api/v1/api/reports/cash-receipts-journal/:businessId` — Cash receipts journal. Auth: machine.
- `GET /api/v1/api/reports/credit-memo-listing/:businessId` — Credit memos. Auth: machine.
- `GET /api/v1/api/reports/revenue-by-product/:businessId` — Revenue by product. Auth: machine.
- `GET /api/v1/api/reports/deferred-revenue-schedule/:businessId` — Deferred revenue. Auth: machine.
- `GET /api/v1/api/reports/churn-analysis/:businessId` — Churn analysis. Auth: machine.
- `GET /api/v1/api/reports/cohort-analysis/:businessId` — Cohort analysis. Auth: machine.
- `GET /api/v1/api/reports/net-revenue-retention/:businessId` — NRR. Auth: machine.
- `GET /api/v1/api/reports/bank-reconciliation-report/:businessId` — Bank rec report. Auth: machine.
- `GET /api/v1/api/reports/cash-forecast/:businessId` — Cash forecast. Auth: machine.
- `GET /api/v1/api/reports/credit-card-spend-report/:businessId` — Credit card spend. Auth: machine.
- `GET /api/v1/api/reports/revenue-recognition-schedule/:businessId` — Rev-rec schedule. Auth: machine.
- `GET /api/v1/api/reports/prepaid-expense-schedule/:businessId` — Prepaid schedule. Auth: machine.
- `GET /api/v1/api/reports/fixed-asset-schedule/:businessId` — Fixed asset schedule. Auth: machine.

## CFO analytics — /api/v1/accountant/analytics

Trend endpoints share the period selector: query type=mom (+month YYYY-MM) | wow (+weekStartDate YYYY-MM-DD) | qoq/yoy (+year YYYY). Note the `:bussinessId` typo — it is IN the real paths but Express fills it from the same position; call with the business id.

- `GET /api/v1/accountant/analytics/revenue/:bussinessId` — Revenue trend. Params: type + month/weekStartDate/year. Auth: accountant.
- `GET /api/v1/accountant/analytics/revenue-growth-expectation/:bussinessId` — Revenue growth vs expectation. Auth: accountant.
- `GET /api/v1/accountant/analytics/revenue-breakdown/:bussinessId` — Revenue breakdown. Params: dateRange. Auth: accountant.
- `GET /api/v1/accountant/analytics/revenue-stream-ytd/:bussinessId` — YTD revenue by stream. Params: year. Auth: accountant.
- `GET /api/v1/accountant/analytics/revenue-by-customer-ytd/:bussinessId` — YTD revenue by customer. Params: year. Auth: accountant.
- `GET /api/v1/accountant/analytics/arr-ytd/:businessId` — YTD ARR. Params: year. Auth: accountant.
- `GET /api/v1/accountant/analytics/expense/:bussinessId` — Expense trend. Params: type family. Auth: accountant.
- `GET /api/v1/accountant/analytics/expense-growth-expectation/:bussinessId` — Expense growth vs expectation. Auth: accountant.
- `GET /api/v1/accountant/analytics/expense-breakdown/:businessId` — Expense breakdown. Params: dateRange. Auth: accountant.
- `GET /api/v1/accountant/analytics/ytd-expense-grouping/:businessId` — YTD expense grouping. Params: includeUnassigned=true. Auth: accountant.
- `GET /api/v1/accountant/analytics/ytd-expense-by-department/:businessId` — YTD expense by department. Auth: accountant.
- `GET /api/v1/accountant/analytics/top-vendor-spend/:businessId` — Top vendors by spend. Params: limit (default 10), minAmount. Auth: accountant.
- `GET /api/v1/accountant/analytics/top-account-spend/:businessId` — Top expense accounts. Params: limit, minAmount, includeUncategorized=true. Auth: accountant.
- `GET /api/v1/accountant/analytics/expense-tables-export/:businessId` — Export expense tables (xlsx). Auth: accountant.
- `GET /api/v1/accountant/analytics/mrr-analysis-export/:businessId` — Export MRR analysis (xlsx). Auth: accountant.
- `GET /api/v1/accountant/analytics/cash-flow/:bussinessId` — Cash flow trend. Params: period (3month|6month|9month|12month). Auth: accountant.
- `GET /api/v1/accountant/analytics/cash-flow-comparison/:bussinessId` — Cash flow period comparison. Auth: accountant.
- `GET /api/v1/accountant/analytics/cash-flow-breakdown/:bussinessId` — Cash flow breakdown. Params: dateRange. Auth: accountant.
- `GET /api/v1/accountant/analytics/cash-burn-build/:businessId` — Cash burn/build. Auth: accountant.
- `GET /api/v1/accountant/analytics/cashflow-by-activity/:businessId` — Cash flow by activity (operating/investing/financing). Auth: accountant.
- `GET /api/v1/accountant/analytics/revenue-projections/:businessId` — Revenue projections. Auth: accountant.
- `GET /api/v1/accountant/analytics/debt-projections/:businessId` — Debt projections. Auth: accountant.
- `GET /api/v1/accountant/analytics/ebitda-projections/:businessId` — EBITDA projections. Auth: accountant.
- `GET /api/v1/accountant/analytics/revenue-growth-simulation/:businessId` — Revenue growth what-if. Auth: accountant.
- `GET /api/v1/accountant/analytics/gross-margin-simulation/:businessId` — Gross margin what-if. Auth: accountant.
- `GET /api/v1/accountant/analytics/aicfo-analysis/:businessId` — Latest saved AI-CFO analysis. Auth: accountant.
- `GET /api/v1/accountant/analytics/generate-cfoai-analysis/:businessId` — GENERATES a fresh AI-CFO analysis (a GET with side effects; can be slow). Auth: accountant.
- `GET /api/v1/accountant/analytics/generate-revenue-trend-analysis/:businessId` — Generates AI revenue trend analysis (GET with side effects). Auth: accountant.
- `GET /api/v1/accountant/analytics/cash-flow-projections/:businessId` — Cash flow projections. Auth: accountant.
- `GET /api/v1/accountant/analytics/all-cfo-analysis/:businessId` — List all saved CFO analyses. Auth: accountant.
- `DELETE /api/v1/accountant/analytics/delete-cfo-analysis/:id` — Delete a saved CFO analysis by ITS id, not businessId. Auth: accountant.
- `GET /api/v1/accountant/analytics/margin/revenue-cogs/:bussinessId` — Revenue vs COGS trend. Auth: accountant.
- `GET /api/v1/accountant/analytics/margin/revenue-cogs-breakdown/:bussinessId` — Revenue/COGS breakdown. Auth: accountant.
- `GET /api/v1/accountant/analytics/margin/revenue-gross-margin/:bussinessId` — Revenue vs gross margin trend. Auth: accountant.
- `GET /api/v1/accountant/analytics/margin/revenue-gross-margin-breakdown/:bussinessId` — Revenue/gross-margin breakdown. Auth: accountant.
- `GET /api/v1/accountant/analytics/margin/revenue-cogs-merged/:businessId` — v2 merged revenue/COGS series. Auth: accountant.
- `GET /api/v1/accountant/analytics/margin/revenue-gross-margin-merged/:businessId` — v2 merged revenue/gross-margin series. Auth: accountant.
- `GET /api/v1/accountant/analytics/margin/gross-profit-ytd/:businessId` — YTD gross profit. Auth: accountant.
- `GET /api/v1/accountant/analytics/margin/net-income-ytd/:businessId` — YTD net income. Auth: accountant.
- `GET /api/v1/accountant/analytics/margin/net-profit-margin-ytd/:businessId` — YTD net profit margin. Auth: accountant.
- `GET /api/v1/accountant/analytics/margin/gross-profit-margin-ytd/:businessId` — YTD gross profit margin. Auth: accountant.
- `GET /api/v1/accountant/analytics/margin/top-cogs-spend/:businessId` — Top COGS spend items. Auth: accountant.
- `GET /api/v1/accountant/analytics/kpi-analysis/:businessId` — KPI analysis dashboard. Auth: accountant.
- `GET /api/v1/accountant/analytics/forecast-modules/:businessId` — Forecast module data (registered twice in code; one path). Auth: accountant.
- `POST /api/v1/accountant/analytics/kpi-targets/:businessId` — Create a KPI target. Params: body target fields. Auth: accountant.
- `PUT /api/v1/accountant/analytics/kpi-targets/:id` — Update a KPI target by target id. Auth: accountant.
- `GET /api/v1/accountant/analytics/kpi-targets/:id` — Read a KPI target by id. Auth: accountant.
- `DELETE /api/v1/accountant/analytics/kpi-targets/:id` — Delete a KPI target. Auth: accountant.
- `GET /api/v1/accountant/analytics/kpi-targets/business/:businessId` — List KPI targets for a business. Auth: accountant.
- `GET /api/v1/accountant/analytics/ar-revenue/open-ar-percentage/:businessId` — Open AR as % of revenue. Auth: accountant.
- `GET /api/v1/accountant/analytics/ar-revenue/ar-exception-trends/:businessId` — AR exception trends. Auth: accountant.
- `GET /api/v1/accountant/analytics/ar-revenue/ar-dashboard-tables/:businessId` — AR dashboard tables. Auth: accountant.
- `GET /api/v1/accountant/analytics/overview-dashboard-data/:businessId` — Overview dashboard data. Auth: accountant.

## Dashboard — /api/v1/accountant/dashboard

- `GET /api/v1/accountant/dashboard/businessList` — List the accountant's client businesses (archived hidden by default). Params: query includeArchived=true, businessType, startDate+endDate, status, searchKey. Auth: accountant.
- `GET /api/v1/accountant/dashboard/businessList/:businessId` — One business; 403 if outside the caller's set; ignores archive filter. Auth: accountant.
- `PATCH /api/v1/accountant/dashboard/businessList/:businessId/archive` — Archive an entity (owner/admin roles only). Auth: accountant.
- `PATCH /api/v1/accountant/dashboard/businessList/:businessId/unarchive` — Unarchive an entity (same role gate). Auth: accountant.
- `GET /api/v1/accountant/dashboard/globalSearch/:businessId` — Search within a business. Params: query searchKey. Auth: accountant.
- `GET /api/v1/accountant/dashboard/notifications/:businessId` — Notification feed. Auth: accountant.
- `GET /api/v1/accountant/dashboard/fxRates` — FX rates. Params: query from, to (required); date for a snapshot, or start+end for a daily series. Auth: accountant.

## Gotchas

- The `*-realtime` TB/BS/CF paths are VARIANCE reports over saved trial balances (need currentStart/currentEnd/priorStart/priorEnd); the live as-of versions are `*-asof` and refuse dates inside a locked Financial.
- `exports=xlsx` on most /reports endpoints returns a spreadsheet stream, not JSON — omit it when you want data.
- Footnote generation is async: POST generate-footnotes → 202 {jobId} → poll GET /reportPackages/footnote-jobs/:jobId until completed/failed.
- Finalized packages (status "final") reject every edit: PUT package, footnote upserts, footnote deletes, regeneration.
- Analytics paths genuinely contain the `:bussinessId` typo; the DELETE cfo-analysis and kpi-targets id routes take the record's own id, not businessId.
- `/generate-cfoai-analysis` and `/generate-revenue-trend-analysis` are GETs that create/regenerate analyses — treat them as writes, not idempotent reads.
- Both POST `/business/:businessId` create routes (reportPackages, presentationMapping) accept businessId from the URL; the body value wins if present.
- import-from-pdf is multipart (field `file`, 10 MB max); render-pdf returns a signed URL that expires (`expiresAt`).
- `/api/v1/api/reports/*` is the same data under machine (API-client) auth — the helper normally uses the accountant paths.


## Appendix — exact parameters, extracted from the controllers

Machine-extracted from the product's controller source (every `req.query` /
`req.body` key the handler actually reads). This is the authority on filter
parameter NAMES — a name not listed here is silently ignored by that route.
Meanings and formats live in the entries above; when in doubt, pass exactly
these names and verify the returned date span and row count.

- `GET /api/v1/accountant/reports/ar-aging/:businessId` — query: `asOf`, `exports`
- `GET /api/v1/accountant/reports/ap-aging/:businessId` — query: `asOf`, `exports`
- `GET /api/v1/accountant/reports/trial-balance-realtime/:businessId` — query: `currentLabel`, `currentTbId`, `enforceClosed`, `exports`, `priorLabel`, `priorTbId`
- `GET /api/v1/accountant/reports/balance-sheet-realtime/:businessId` — query: `currentLabel`, `currentTbId`, `enforceClosed`, `exports`, `priorLabel`, `priorTbId`
- `GET /api/v1/accountant/reports/statement-of-cash-flow-realtime/:businessId` — query: `currentLabel`, `currentTbId`, `enforceClosed`, `exports`, `priorLabel`, `priorTbId`
- `GET /api/v1/accountant/reports/trial-balance-asof/:businessId` — query: `asOf`, `fiscalYearStart`, `includeTrail`
- `GET /api/v1/accountant/reports/balance-sheet-asof/:businessId` — query: `asOf`, `fiscalYearStart`, `includeTrail`
- `GET /api/v1/accountant/reports/statement-of-cash-flow-asof/:businessId` — query: `currentEnd`, `currentStart`, `includeTrail`
- `GET /api/v1/accountant/reports/profit-and-loss-realtime/:businessId` — query: `budgetId`, `class`, `comparisonMode`, `currentEnd`, `currentStart`, `customFields`, `department`, `exports`, `location`, `priorEnd`, `priorStart`
- `GET /api/v1/accountant/reports/income-statement-by-field/:businessId` — query: `currentEnd`, `currentStart`, `exports`, `fieldName`, `fieldValues`
- `GET /api/v1/accountant/reports/executive-income-statement/:businessId` — query: `breakdown`, `currentEnd`, `currentStart`, `exports`
- `GET /api/v1/accountant/reports/general-ledger-realtime/:businessId` — query: `class`, `customFields`, `department`, `endDate`, `exports`, `location`, `startDate`
- `GET /api/v1/accountant/reports/general-ledger-account-realtime/:businessId` — query: `account`, `class`, `customFields`, `department`, `endDate`, `exports`, `location`, `startDate`
- `GET /api/v1/accountant/reports/bank-register-realtime/:businessId` — query: `accountId`, `account_id`, `endDate`, `exports`, `startDate`
- `GET /api/v1/accountant/reports/chart-of-accounts-with-balance/:businessId` — query: `exports`
- `GET /api/v1/accountant/reports/vendor-spend-analysis/:businessId` — query: `accounts`, `exports`, `priorEnd`, `priorStart`, `trendMonths`, `vendors`, `ytdEnd`, `ytdStart`
- `GET /api/v1/accountant/reports/payment-history/:businessId` — query: `endDate`, `exports`, `includeNonPaid`, `startDate`
- `GET /api/v1/accountant/reports/open-bills-report/:businessId` — query: `billable`, `endDate`, `exports`, `startDate`
- `GET /api/v1/accountant/reports/1099-dashboard/:businessId` — query: `endDate`, `exports`, `startDate`
- `GET /api/v1/accountant/reports/customer-revenue-analysis/:businessId` — query: `endDate`, `exports`, `startDate`
- `GET /api/v1/accountant/reports/invoice-register/:businessId` — query: `asOf`, `billable`, `exports`, `limit`, `q`, `starting_after`, `status`
- `GET /api/v1/accountant/reports/cash-receipts-journal/:businessId` — query: `exports`, `limit`, `method`, `q`, `starting_after`
- `GET /api/v1/accountant/reports/credit-memo-listing/:businessId` — query: `exports`, `limit`, `q`, `reason`, `starting_after`, `status`
- `GET /api/v1/accountant/reports/revenue-by-product/:businessId` — query: `category`, `compareEnd`, `compareStart`, `endDate`, `exports`, `includeDraft`, `limit`, `q`, `startDate`
- `GET /api/v1/accountant/reports/deferred-revenue-schedule/:businessId` — query: `exports`, `q`, `status`
- `GET /api/v1/accountant/reports/churn-analysis/:businessId` — query: `asOf`, `exports`, `graceMonths`, `limit`, `lookbackMonths`, `month`, `period`
- `GET /api/v1/accountant/reports/cohort-analysis/:businessId` — query: `cohortMonths`, `end`, `exports`, `start`
- `GET /api/v1/accountant/reports/net-revenue-retention/:businessId` — query: `asOf`, `date`, `exports`, `includeNonRecurring`, `month`, `period`
- `GET /api/v1/accountant/reports/bank-reconciliation-report/:businessId` — query: `account_id`, `endDate`, `exports`, `startDate`
- `GET /api/v1/accountant/reports/cash-forecast/:businessId` — query: `asOfDate`, `exports`, `historyDays`, `horizonDays`, `includeCreditCards`, `weeklyBars`
- `GET /api/v1/accountant/reports/credit-card-spend-report/:businessId` — query: `account_id`, `class`, `customFields`, `department`, `endDate`, `exports`, `location`, `startDate`
- `GET /api/v1/accountant/reports/revenue-recognition-schedule/:businessId` — query: `asOfDate`, `exports`, `q`, `status`, `year`
- `GET /api/v1/accountant/reports/prepaid-expense-schedule/:businessId` — query: `asOfDate`, `exports`, `q`, `status`, `year`
- `GET /api/v1/accountant/reports/fixed-asset-schedule/:businessId` — query: `asOfDate`, `exports`, `q`, `status`, `year`
- `GET /api/v1/accountant/report-settings/:businessId/summary-categories/status` — no query/body params read
- `GET /api/v1/accountant/report-settings/:businessId/summary-categories` — no query/body params read
- `PUT /api/v1/accountant/report-settings/:businessId/summary-categories` — no query/body params read
- `GET /api/v1/accountant/reportPackages/business/:businessId` — query: `accountantId`, `status`
- `GET /api/v1/accountant/reportPackages/:id` — no query/body params read
- `PUT /api/v1/accountant/reportPackages/:id` — no query/body params read
- `DELETE /api/v1/accountant/reportPackages/:id` — no query/body params read
- `PATCH /api/v1/accountant/reportPackages/:id/status` — no query/body params read
- `GET /api/v1/accountant/reportPackages/:id/preview-data` — no query/body params read
- `PUT /api/v1/accountant/reportPackages/:id/footnotes` — no query/body params read
- `DELETE /api/v1/accountant/reportPackages/:id/footnotes/:key` — no query/body params read
- `POST /api/v1/accountant/reportPackages/:id/generate-footnotes` — no query/body params read
- `GET /api/v1/accountant/reportPackages/footnote-jobs/:jobId` — no query/body params read
- `POST /api/v1/accountant/reportPackages/:id/render-pdf` — no query/body params read
- `GET /api/v1/accountant/presentationMapping/templates` — query: `statementType`
- `POST /api/v1/accountant/presentationMapping/templates/seed` — no query/body params read
- `GET /api/v1/accountant/presentationMapping/business/:businessId` — query: `statementType`
- `GET /api/v1/accountant/presentationMapping/business/:businessId/default/:statementType` — no query/body params read
- `GET /api/v1/accountant/presentationMapping/:id` — no query/body params read
- `PUT /api/v1/accountant/presentationMapping/:id` — no query/body params read
- `DELETE /api/v1/accountant/presentationMapping/:id` — no query/body params read
- `POST /api/v1/accountant/presentationMapping/:id/set-default` — no query/body params read
- `POST /api/v1/accountant/presentationMapping/:id/preview` — body: `sections`, `trialBalanceIds`
- `POST /api/v1/accountant/presentationMapping/:id/auto-organize` — no query/body params read
- `POST /api/v1/accountant/presentationMapping/:id/import-from-pdf` — no query/body params read
- `GET /api/v1/api/reports/ar-aging/:businessId` — query: `asOf`, `exports`
- `GET /api/v1/api/reports/ap-aging/:businessId` — query: `asOf`, `exports`
- `GET /api/v1/api/reports/trial-balance-realtime/:businessId` — query: `currentLabel`, `currentTbId`, `enforceClosed`, `exports`, `priorLabel`, `priorTbId`
- `GET /api/v1/api/reports/balance-sheet-realtime/:businessId` — query: `currentLabel`, `currentTbId`, `enforceClosed`, `exports`, `priorLabel`, `priorTbId`
- `GET /api/v1/api/reports/statement-of-cash-flow-realtime/:businessId` — query: `currentLabel`, `currentTbId`, `enforceClosed`, `exports`, `priorLabel`, `priorTbId`
- `GET /api/v1/api/reports/profit-and-loss-realtime/:businessId` — query: `budgetId`, `class`, `comparisonMode`, `currentEnd`, `currentStart`, `customFields`, `department`, `exports`, `location`, `priorEnd`, `priorStart`
- `GET /api/v1/api/reports/general-ledger-realtime/:businessId` — query: `class`, `customFields`, `department`, `endDate`, `exports`, `location`, `startDate`
- `GET /api/v1/api/reports/general-ledger-account-realtime/:businessId` — query: `account`, `class`, `customFields`, `department`, `endDate`, `exports`, `location`, `startDate`
- `GET /api/v1/api/reports/chart-of-accounts-with-balance/:businessId` — query: `exports`
- `GET /api/v1/api/reports/vendor-spend-analysis/:businessId` — query: `accounts`, `exports`, `priorEnd`, `priorStart`, `trendMonths`, `vendors`, `ytdEnd`, `ytdStart`
- `GET /api/v1/api/reports/payment-history/:businessId` — query: `endDate`, `exports`, `includeNonPaid`, `startDate`
- `GET /api/v1/api/reports/open-bills-report/:businessId` — query: `billable`, `endDate`, `exports`, `startDate`
- `GET /api/v1/api/reports/1099-dashboard/:businessId` — query: `endDate`, `exports`, `startDate`
- `GET /api/v1/api/reports/customer-revenue-analysis/:businessId` — query: `endDate`, `exports`, `startDate`
- `GET /api/v1/api/reports/invoice-register/:businessId` — query: `asOf`, `billable`, `exports`, `limit`, `q`, `starting_after`, `status`
- `GET /api/v1/api/reports/cash-receipts-journal/:businessId` — query: `exports`, `limit`, `method`, `q`, `starting_after`
- `GET /api/v1/api/reports/credit-memo-listing/:businessId` — query: `exports`, `limit`, `q`, `reason`, `starting_after`, `status`
- `GET /api/v1/api/reports/revenue-by-product/:businessId` — query: `category`, `compareEnd`, `compareStart`, `endDate`, `exports`, `includeDraft`, `limit`, `q`, `startDate`
- `GET /api/v1/api/reports/deferred-revenue-schedule/:businessId` — query: `exports`, `q`, `status`
- `GET /api/v1/api/reports/churn-analysis/:businessId` — query: `asOf`, `exports`, `graceMonths`, `limit`, `lookbackMonths`, `month`, `period`
- `GET /api/v1/api/reports/cohort-analysis/:businessId` — query: `cohortMonths`, `end`, `exports`, `start`
- `GET /api/v1/api/reports/net-revenue-retention/:businessId` — query: `asOf`, `date`, `exports`, `includeNonRecurring`, `month`, `period`
- `GET /api/v1/api/reports/bank-reconciliation-report/:businessId` — query: `account_id`, `endDate`, `exports`, `startDate`
- `GET /api/v1/api/reports/cash-forecast/:businessId` — query: `asOfDate`, `exports`, `historyDays`, `horizonDays`, `includeCreditCards`, `weeklyBars`
- `GET /api/v1/api/reports/credit-card-spend-report/:businessId` — query: `account_id`, `class`, `customFields`, `department`, `endDate`, `exports`, `location`, `startDate`
- `GET /api/v1/api/reports/revenue-recognition-schedule/:businessId` — query: `asOfDate`, `exports`, `q`, `status`, `year`
- `GET /api/v1/api/reports/prepaid-expense-schedule/:businessId` — query: `asOfDate`, `exports`, `q`, `status`, `year`
- `GET /api/v1/api/reports/fixed-asset-schedule/:businessId` — query: `asOfDate`, `exports`, `q`, `status`, `year`
- `GET /api/v1/accountant/analytics/revenue/:bussinessId` — query: `month`, `type`, `weekStartDate`, `year`
- `GET /api/v1/accountant/analytics/revenue-growth-expectation/:bussinessId` — no query/body params read
- `GET /api/v1/accountant/analytics/revenue-breakdown/:bussinessId` — query: `dateRange`
- `GET /api/v1/accountant/analytics/revenue-stream-ytd/:bussinessId` — query: `year`
- `GET /api/v1/accountant/analytics/revenue-by-customer-ytd/:bussinessId` — query: `year`
- `GET /api/v1/accountant/analytics/arr-ytd/:businessId` — query: `year`
- `GET /api/v1/accountant/analytics/expense/:bussinessId` — query: `month`, `type`, `weekStartDate`, `year`
- `GET /api/v1/accountant/analytics/expense-growth-expectation/:bussinessId` — no query/body params read
- `GET /api/v1/accountant/analytics/expense-breakdown/:businessId` — query: `dateRange`
- `GET /api/v1/accountant/analytics/ytd-expense-grouping/:businessId` — no query/body params read
- `GET /api/v1/accountant/analytics/ytd-expense-by-department/:businessId` — query: `includeUnassigned`
- `GET /api/v1/accountant/analytics/top-vendor-spend/:businessId` — query: `limit`, `minAmount`
- `GET /api/v1/accountant/analytics/top-account-spend/:businessId` — query: `includeUncategorized`, `limit`, `minAmount`
- `GET /api/v1/accountant/analytics/expense-tables-export/:businessId` — no query/body params read
- `GET /api/v1/accountant/analytics/mrr-analysis-export/:businessId` — no query/body params read
- `GET /api/v1/accountant/analytics/cash-flow/:bussinessId` — query: `period`
- `GET /api/v1/accountant/analytics/cash-flow-comparison/:bussinessId` — query: `month`, `type`, `weekStartDate`, `year`
- `GET /api/v1/accountant/analytics/cash-flow-breakdown/:bussinessId` — query: `dateRange`
- `GET /api/v1/accountant/analytics/cash-burn-build/:businessId` — no query/body params read
- `GET /api/v1/accountant/analytics/cashflow-by-activity/:businessId` — no query/body params read
- `GET /api/v1/accountant/analytics/revenue-projections/:businessId` — query: `monthsForward`
- `GET /api/v1/accountant/analytics/debt-projections/:businessId` — query: `monthsForward`
- `GET /api/v1/accountant/analytics/ebitda-projections/:businessId` — query: `endYear`, `startYear`
- `GET /api/v1/accountant/analytics/revenue-growth-simulation/:businessId` — query: `endYear`, `startYear`
- `GET /api/v1/accountant/analytics/gross-margin-simulation/:businessId` — query: `endYear`, `startYear`
- `GET /api/v1/accountant/analytics/aicfo-analysis/:businessId` — no query/body params read
- `GET /api/v1/accountant/analytics/generate-cfoai-analysis/:businessId` — no query/body params read
- `GET /api/v1/accountant/analytics/generate-revenue-trend-analysis/:businessId` — no query/body params read
- `GET /api/v1/accountant/analytics/cash-flow-projections/:businessId` — no query/body params read
- `GET /api/v1/accountant/analytics/all-cfo-analysis/:businessId` — no query/body params read
- `DELETE /api/v1/accountant/analytics/delete-cfo-analysis/:id` — no query/body params read
- `GET /api/v1/accountant/analytics/margin/revenue-cogs/:bussinessId` — query: `date`, `month`, `months`, `quarter`, `type`, `week`, `year`
- `GET /api/v1/accountant/analytics/margin/revenue-cogs-breakdown/:bussinessId` — query: `date`, `months`
- `GET /api/v1/accountant/analytics/margin/revenue-gross-margin/:bussinessId` — query: `date`, `month`, `months`, `quarter`, `type`, `week`, `year`
- `GET /api/v1/accountant/analytics/margin/revenue-gross-margin-breakdown/:bussinessId` — query: `date`, `months`
- `GET /api/v1/accountant/analytics/margin/revenue-cogs-merged/:businessId` — query: `month`, `months`
- `GET /api/v1/accountant/analytics/margin/revenue-gross-margin-merged/:businessId` — query: `month`, `months`
- `GET /api/v1/accountant/analytics/margin/gross-profit-ytd/:businessId` — query: `year`
- `GET /api/v1/accountant/analytics/margin/net-income-ytd/:businessId` — query: `year`
- `GET /api/v1/accountant/analytics/margin/net-profit-margin-ytd/:businessId` — query: `year`
- `GET /api/v1/accountant/analytics/margin/gross-profit-margin-ytd/:businessId` — query: `year`
- `GET /api/v1/accountant/analytics/margin/top-cogs-spend/:businessId` — query: `limit`, `year`
- `GET /api/v1/accountant/analytics/kpi-analysis/:businessId` — no query/body params read
- `GET /api/v1/accountant/analytics/forecast-modules/:businessId` — no query/body params read
- `GET /api/v1/accountant/analytics/forecast-modules/:businessId` — no query/body params read
- `POST /api/v1/accountant/analytics/kpi-targets/:businessId` — no query/body params read
- `PUT /api/v1/accountant/analytics/kpi-targets/:id` — no query/body params read
- `GET /api/v1/accountant/analytics/kpi-targets/:id` — no query/body params read
- `DELETE /api/v1/accountant/analytics/kpi-targets/:id` — no query/body params read
- `GET /api/v1/accountant/analytics/kpi-targets/business/:businessId` — no query/body params read
- `GET /api/v1/accountant/analytics/ar-revenue/open-ar-percentage/:businessId` — query: `asOf`
- `GET /api/v1/accountant/analytics/ar-revenue/ar-exception-trends/:businessId` — query: `asOf`, `from`, `to`, `tz`
- `GET /api/v1/accountant/analytics/ar-revenue/ar-dashboard-tables/:businessId` — query: `asOf`, `exports`, `top`, `year`
- `GET /api/v1/accountant/analytics/overview-dashboard-data/:businessId` — no query/body params read
- `GET /api/v1/accountant/dashboard/businessList` — query: `businessType`, `endDate`, `includeArchived`, `searchKey`, `startDate`, `status`
- `GET /api/v1/accountant/dashboard/businessList/:businessId` — query: `businessType`, `endDate`, `includeArchived`, `searchKey`, `startDate`, `status`
- `PATCH /api/v1/accountant/dashboard/businessList/:businessId/archive` — no query/body params read
- `PATCH /api/v1/accountant/dashboard/businessList/:businessId/unarchive` — no query/body params read
- `GET /api/v1/accountant/dashboard/globalSearch/:businessId` — query: `searchKey`
- `GET /api/v1/accountant/dashboard/notifications/:businessId` — no query/body params read
- `GET /api/v1/accountant/dashboard/fxRates` — query: `date`, `end`, `from`, `start`, `to`
