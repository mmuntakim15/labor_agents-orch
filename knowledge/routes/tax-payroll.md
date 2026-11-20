# Tax & Payroll routes

Sales-tax jurisdictions and filings, trial-balance-to-tax-software mapping/export, Form 941 payroll tax filings, payroll-report-to-GL mapping, integration CoA mapping, and integration connection status. Reach for this domain for anything about sales tax owed or filed, 941/payroll tax, turning a payroll provider report into journal entries, mapping integration events to the chart of accounts, or "is Stripe/QBO/Ramp connected?".

## Sales tax (`/api/v1/accountant/salesTax`)

- `GET /api/v1/accountant/salesTax/:businessId/settings` — sales-tax settings (sales accounts, default basis). Auth: accountant.
- `PUT /api/v1/accountant/salesTax/:businessId/settings` — update settings. Params: body salesAccounts, defaultBasis. Auth: accountant.
- `GET /api/v1/accountant/salesTax/:businessId/jurisdictions` — list jurisdictions. Auth: accountant.
- `POST /api/v1/accountant/salesTax/:businessId/jurisdictions` — create a jurisdiction. Params: body name, description, address, lineItems. Auth: accountant.
- `GET /api/v1/accountant/salesTax/:businessId/jurisdictions/:id` — read one jurisdiction. Auth: accountant.
- `PUT /api/v1/accountant/salesTax/:businessId/jurisdictions/:id` — update a jurisdiction (body = updates). Auth: accountant.
- `DELETE /api/v1/accountant/salesTax/:businessId/jurisdictions/:id` — delete a jurisdiction. Auth: accountant.
- `POST /api/v1/accountant/salesTax/:businessId/jurisdictions/:id/line-items` — add a rate line item. Params: body rate fields + source. Auth: accountant.
- `PUT /api/v1/accountant/salesTax/:businessId/jurisdictions/:id/line-items/:lineItemId` — update a line item (allowlisted keys only). Auth: accountant.
- `DELETE /api/v1/accountant/salesTax/:businessId/jurisdictions/:id/line-items/:lineItemId` — delete a line item. Auth: accountant.
- `GET /api/v1/accountant/salesTax/:businessId/address-search` — address autocomplete. Params: query q. Auth: accountant.
- `POST /api/v1/accountant/salesTax/:businessId/jurisdictions/from-address` — build a jurisdiction from an address, optionally saving it. Params: body address, save. Auth: accountant.
- `GET /api/v1/accountant/salesTax/:businessId/period-transactions` — sales transactions in a period for jurisdiction tagging. Params: query periodStart, periodEnd. Auth: accountant.
- `PUT /api/v1/accountant/salesTax/:businessId/transactions/:transactionItemId/tag` — tag/untag a transaction item with a jurisdiction. Params: body salesTaxJurisdictionId. Auth: accountant.
- `POST /api/v1/accountant/salesTax/:businessId/reports/preview` — compute a sales-tax report without saving. Params: body periodStart, periodEnd, basis. Auth: accountant.
- `POST /api/v1/accountant/salesTax/:businessId/reports/preview-pdf` — same computation streamed as a PDF. Params: body periodStart, periodEnd, basis. Auth: accountant.
- `GET /api/v1/accountant/salesTax/:businessId/filings` — list filings. Auth: accountant.
- `GET /api/v1/accountant/salesTax/:businessId/filings/:id` — read one filing. Auth: accountant.
- `POST /api/v1/accountant/salesTax/:businessId/filings` — create a draft filing. Params: body periodStart, periodEnd, basis. Auth: accountant.
- `DELETE /api/v1/accountant/salesTax/:businessId/filings/:id` — delete a filing. Auth: accountant.
- `GET /api/v1/accountant/salesTax/:businessId/filings/:id/pdf` — PDF of a saved filing. Auth: accountant.
- `GET /api/v1/accountant/salesTax/:businessId/filings/:id/complete-preview` — journals + errors that completing would produce (checks closed periods). Auth: accountant.
- `POST /api/v1/accountant/salesTax/:businessId/filings/:id/complete` — complete the filing and POST REAL JOURNAL ENTRIES to the ledger. No body. Auth: accountant.

## Tax mapping / TB export (`/api/v1/accountant/taxMapping`)

- `GET /api/v1/accountant/taxMapping/software` — supported tax software catalog. Auth: accountant.
- `GET /api/v1/accountant/taxMapping/forms` — supported forms. Params: query software. Auth: accountant.
- `GET /api/v1/accountant/taxMapping/forms/:form/rules` — mapping rules for a form. Params: query software. Auth: accountant.
- `GET /api/v1/accountant/taxMapping/business/:businessId` — list a business's tax mappings. Auth: accountant.
- `POST /api/v1/accountant/taxMapping/business/:businessId` — create a mapping (Joi-validated; path businessId auto-copied into body). Params: body form, software, etc. Auth: accountant.
- `GET /api/v1/accountant/taxMapping/:id` — read a mapping by id. Auth: accountant.
- `DELETE /api/v1/accountant/taxMapping/:id` — delete a mapping. Auth: accountant.
- `POST /api/v1/accountant/taxMapping/:id/regenerate` — regenerate a mapping. Params: body (validated). Auth: accountant.
- `PUT /api/v1/accountant/taxMapping/:id/accounts` — upsert account assignments on a mapping. Params: body (validated). Auth: accountant.
- `POST /api/v1/accountant/taxMapping/export/trial-balance/:trialBalanceId/:form` — export a TB in tax-software format. Params: query software (else resolved from the latest saved mapping). Auth: accountant.

## Form 941 (`/api/v1/accountant/form941`)

- `GET /api/v1/accountant/form941/:businessId/mapping` — read the 941 mapping header + fields. Auth: accountant.
- `PUT /api/v1/accountant/form941/:businessId/mapping` — update the mapping header. Params: body header fields (validated). Auth: accountant.
- `PUT /api/v1/accountant/form941/:businessId/mapping/fields` — upsert one field row (one 941 field → N COAs). Params: body field mapping (validated). Auth: accountant.
- `DELETE /api/v1/accountant/form941/:businessId/mapping/fields/:fieldKey` — delete a field mapping. Auth: accountant.
- `POST /api/v1/accountant/form941/:businessId/mapping/ai-suggest` — AI-suggest field mappings from the chart of accounts. Auth: accountant.
- `POST /api/v1/accountant/form941/:businessId/states/:stateCode` — add a state to the mapping. Auth: accountant.
- `DELETE /api/v1/accountant/form941/:businessId/states/:stateCode` — remove a state. Auth: accountant.
- `GET /api/v1/accountant/form941/state-templates/:stateCode` — read the shared (not business-scoped) state template. Auth: accountant.
- `POST /api/v1/accountant/form941/state-templates/:stateCode/regenerate` — regenerate a state template. Auth: accountant.
- `POST /api/v1/accountant/form941/:businessId/reports/preview` — compute a 941 filing without saving. Params: body period fields (validated). Auth: accountant.
- `POST /api/v1/accountant/form941/:businessId/reports/preview-pdf` — same computation as a PDF. Params: body period fields + style (default "tax-summary"). Auth: accountant.
- `GET /api/v1/accountant/form941/:businessId/filings` — list 941 filings. Auth: accountant.
- `POST /api/v1/accountant/form941/:businessId/filings` — create a draft filing. Params: body period fields (validated). Auth: accountant.
- `GET /api/v1/accountant/form941/:businessId/filings/:id` — read one filing. Auth: accountant.
- `GET /api/v1/accountant/form941/:businessId/filings/:id/pdf` — filing PDF. Params: query type (default "tax-summary"). Auth: accountant.
- `GET /api/v1/accountant/form941/:businessId/filings/:id/complete-preview` — journals + errors before completing. Auth: accountant.
- `POST /api/v1/accountant/form941/:businessId/filings/:id/complete` — complete the filing and post journals. Params: body skipJournal (default false) to complete without posting. Auth: accountant.
- `DELETE /api/v1/accountant/form941/:businessId/filings/:id` — delete a filing. Auth: accountant.

## Payroll mapping (`/api/v1/accountant/payrollMapping`)

- `GET /api/v1/accountant/payrollMapping/:businessId` — the payroll mapping (report columns → COA events). Auth: accountant.
- `POST /api/v1/accountant/payrollMapping/:businessId/events` — add one mapping event. Params: body `{ event: {...} }` (nested, not flat). Auth: accountant.
- `PUT /api/v1/accountant/payrollMapping/:businessId/events/:eventId` — update an event (body = updates, flat). Auth: accountant.
- `DELETE /api/v1/accountant/payrollMapping/:businessId/events/:eventId` — delete an event. Auth: accountant.
- `POST /api/v1/accountant/payrollMapping/:businessId/extract-columns` — multipart upload of a payroll report; AI-extracts its column headers. Params: file(s) + optional body chartOfAccounts. Auth: accountant.
- `POST /api/v1/accountant/payrollMapping/:businessId/events/bulk` — bulk-accept suggested events. Params: body headers, events, extractionModel. Auth: accountant.
- `POST /api/v1/accountant/payrollMapping/:businessId/sniff-report` — multipart upload; detect report shape/provider before extraction. Auth: accountant.
- `POST /api/v1/accountant/payrollMapping/:businessId/extract-report` — multipart upload; extract row data for GL building. Auth: accountant.
- `POST /api/v1/accountant/payrollMapping/:businessId/preview-gl` — build a GL preview from extracted rows + saved mapping. Params: body rows (required array), payDate (required), payPeriodStart, payPeriodEnd, journalEntryName, unmappedColumnAmounts, unmappedByDeptAndColumn. Auth: accountant.
- `POST /api/v1/accountant/payrollMapping/:businessId/create-gl` — POST REAL GL LINES to the ledger (dedup by journal_id). Params: body lines (each needs accounting_category, glType, date, amount>0), payDate, journalEntryName. Auth: accountant.

## CoA mapping (`/api/v1/accountant/coaMapping`)

- `POST /api/v1/accountant/coaMapping/:businessId/events` — add an integration CoA mapping event. Params: body connectionSource, event. Auth: accountant.
- `PUT /api/v1/accountant/coaMapping/:businessId/events/:eventId` — update an event (body = updates). Auth: accountant.
- `DELETE /api/v1/accountant/coaMapping/:businessId/events/:eventId` — delete an event. Auth: accountant.
- `GET /api/v1/accountant/coaMapping/:businessId` — list mappings. Params: query connectionSource ∈ stripe|square|hubspot|ramp|salesforce (invalid → 400). Auth: accountant.

## Connections (`/api/v1/accountant/connections`)

- `GET /api/v1/accountant/connections/:businessId` — every integration's connection status (Stripe, QBO, Ramp, HubSpot, Plaid, ...): connected, status, last_synced_at, connection ids. Auth: accountant.

## Gotchas

- **Completing a filing writes to the ledger.** Both `salesTax .../complete` and `form941 .../complete` post real journal entries through the manual-transactions path — treat as destructive; run `complete-preview` first and check its `errors` array (`PERIOD_CLOSED` means the accounting period must be reopened). Completing twice → 400 "Filing is already completed". form941 accepts `skipJournal: true` to complete without posting.
- **`payrollMapping .../create-gl` also writes real transactions** (dedup by journal_id); always `preview-gl` first. preview-gl 400s when the business has no saved payroll mapping.
- Payroll upload routes (`extract-columns`, `sniff-report`, `extract-report`) are multipart (memory storage, 10 MB cap); everything else is JSON.
- `POST payrollMapping/:businessId/events` wraps the event in `{ event: {...} }`; the PUT update takes a flat updates body. Same nested-vs-flat split on `coaMapping` events (`{ connectionSource, event }` on create, flat on update).
- `taxMapping` mixes id-keyed routes (`/:id`) with business-keyed routes (`/business/:businessId`); the export route is keyed by trialBalanceId, and `?software=` overrides the software resolved from the newest saved mapping.
- `form941 /state-templates/:stateCode` routes are shared catalog data, not scoped to any business.
- No async job + poll patterns in this group; the AI routes (ai-suggest, extract-columns, extract-report) run synchronously and can be slow — allow generous timeouts.


## Appendix — exact parameters, extracted from the controllers

Machine-extracted from the product's controller source (every `req.query` /
`req.body` key the handler actually reads). This is the authority on filter
parameter NAMES — a name not listed here is silently ignored by that route.
Meanings and formats live in the entries above; when in doubt, pass exactly
these names and verify the returned date span and row count.

- `GET /api/v1/accountant/salesTax/:businessId/settings` — no query/body params read
- `PUT /api/v1/accountant/salesTax/:businessId/settings` — body: `defaultBasis`, `salesAccounts`
- `GET /api/v1/accountant/salesTax/:businessId/jurisdictions` — no query/body params read
- `POST /api/v1/accountant/salesTax/:businessId/jurisdictions` — body: `address`, `description`, `lineItems`, `name`
- `GET /api/v1/accountant/salesTax/:businessId/jurisdictions/:id` — no query/body params read
- `PUT /api/v1/accountant/salesTax/:businessId/jurisdictions/:id` — no query/body params read
- `DELETE /api/v1/accountant/salesTax/:businessId/jurisdictions/:id` — no query/body params read
- `POST /api/v1/accountant/salesTax/:businessId/jurisdictions/:id/line-items` — body: `coaAccountCode`, `coaAccountId`, `coaAccountName`, `coaAccountSubType`, `coaAccountType`, `description`, `name`, `rate`, `source`
- `PUT /api/v1/accountant/salesTax/:businessId/jurisdictions/:id/line-items/:lineItemId` — no query/body params read
- `DELETE /api/v1/accountant/salesTax/:businessId/jurisdictions/:id/line-items/:lineItemId` — no query/body params read
- `GET /api/v1/accountant/salesTax/:businessId/address-search` — query: `q`
- `POST /api/v1/accountant/salesTax/:businessId/jurisdictions/from-address` — body: `address`, `save`
- `GET /api/v1/accountant/salesTax/:businessId/period-transactions` — query: `periodEnd`, `periodStart`
- `PUT /api/v1/accountant/salesTax/:businessId/transactions/:transactionItemId/tag` — body: `salesTaxJurisdictionId`
- `POST /api/v1/accountant/salesTax/:businessId/reports/preview` — body: `basis`, `periodEnd`, `periodStart`
- `POST /api/v1/accountant/salesTax/:businessId/reports/preview-pdf` — body: `basis`, `periodEnd`, `periodStart`
- `GET /api/v1/accountant/salesTax/:businessId/filings/:id/pdf` — no query/body params read
- `GET /api/v1/accountant/salesTax/:businessId/filings` — no query/body params read
- `GET /api/v1/accountant/salesTax/:businessId/filings/:id` — no query/body params read
- `POST /api/v1/accountant/salesTax/:businessId/filings` — body: `basis`, `periodEnd`, `periodStart`
- `DELETE /api/v1/accountant/salesTax/:businessId/filings/:id` — no query/body params read
- `GET /api/v1/accountant/salesTax/:businessId/filings/:id/complete-preview` — no query/body params read
- `POST /api/v1/accountant/salesTax/:businessId/filings/:id/complete` — no query/body params read
- `GET /api/v1/accountant/taxMapping/software` — no query/body params read
- `GET /api/v1/accountant/taxMapping/forms` — query: `software`
- `GET /api/v1/accountant/taxMapping/forms/:form/rules` — query: `software`
- `GET /api/v1/accountant/taxMapping/business/:businessId` — no query/body params read
- `GET /api/v1/accountant/taxMapping/:id` — no query/body params read
- `DELETE /api/v1/accountant/taxMapping/:id` — no query/body params read
- `POST /api/v1/accountant/taxMapping/:id/regenerate` — no query/body params read
- `PUT /api/v1/accountant/taxMapping/:id/accounts` — no query/body params read
- `POST /api/v1/accountant/taxMapping/export/trial-balance/:trialBalanceId/:form` — query: `software`
- `GET /api/v1/accountant/form941/:businessId/mapping` — no query/body params read
- `PUT /api/v1/accountant/form941/:businessId/mapping` — no query/body params read
- `PUT /api/v1/accountant/form941/:businessId/mapping/fields` — no query/body params read
- `DELETE /api/v1/accountant/form941/:businessId/mapping/fields/:fieldKey` — no query/body params read
- `POST /api/v1/accountant/form941/:businessId/mapping/ai-suggest` — no query/body params read
- `POST /api/v1/accountant/form941/:businessId/states/:stateCode` — no query/body params read
- `DELETE /api/v1/accountant/form941/:businessId/states/:stateCode` — no query/body params read
- `GET /api/v1/accountant/form941/state-templates/:stateCode` — no query/body params read
- `POST /api/v1/accountant/form941/state-templates/:stateCode/regenerate` — no query/body params read
- `POST /api/v1/accountant/form941/:businessId/reports/preview` — no query/body params read
- `POST /api/v1/accountant/form941/:businessId/reports/preview-pdf` — no query/body params read
- `GET /api/v1/accountant/form941/:businessId/filings` — no query/body params read
- `POST /api/v1/accountant/form941/:businessId/filings` — no query/body params read
- `GET /api/v1/accountant/form941/:businessId/filings/:id` — no query/body params read
- `GET /api/v1/accountant/form941/:businessId/filings/:id/pdf` — query: `type`
- `GET /api/v1/accountant/form941/:businessId/filings/:id/complete-preview` — no query/body params read
- `POST /api/v1/accountant/form941/:businessId/filings/:id/complete` — body: `skipJournal`
- `DELETE /api/v1/accountant/form941/:businessId/filings/:id` — no query/body params read
- `GET /api/v1/accountant/payrollMapping/:businessId` — no query/body params read
- `POST /api/v1/accountant/payrollMapping/:businessId/events` — no query/body params read
- `PUT /api/v1/accountant/payrollMapping/:businessId/events/:eventId` — no query/body params read
- `DELETE /api/v1/accountant/payrollMapping/:businessId/events/:eventId` — no query/body params read
- `POST /api/v1/accountant/payrollMapping/:businessId/extract-columns` — no query/body params read
- `POST /api/v1/accountant/payrollMapping/:businessId/events/bulk` — body: `events`, `extractionModel`, `headers`
- `POST /api/v1/accountant/payrollMapping/:businessId/sniff-report` — no query/body params read
- `POST /api/v1/accountant/payrollMapping/:businessId/extract-report` — no query/body params read
- `POST /api/v1/accountant/payrollMapping/:businessId/preview-gl` — body: `journalEntryName`, `payDate`, `payPeriodEnd`, `payPeriodStart`, `rows`, `unmappedByDeptAndColumn`, `unmappedColumnAmounts`
- `POST /api/v1/accountant/payrollMapping/:businessId/create-gl` — body: `lines`, `payDate`
- `POST /api/v1/accountant/coaMapping/:businessId/events` — no query/body params read
- `PUT /api/v1/accountant/coaMapping/:businessId/events/:eventId` — no query/body params read
- `DELETE /api/v1/accountant/coaMapping/:businessId/events/:eventId` — no query/body params read
- `GET /api/v1/accountant/coaMapping/:businessId` — query: `connectionSource`
- `GET /api/v1/accountant/connections/:businessId` — no query/body params read
