# Accounts & Banking

Bank accounts (manual and Plaid-linked), institution link/repair lifecycle, Plaid sync machinery, the health probe, and the collection-readme/wiki knowledge base behind the in-product assistant. Reach for this domain when a request touches bank account setup/editing, reconnecting or syncing bank feeds, pulling transactions for a date range, or the assistant's conversations/exports.

## Bank accounts — `/api/v1/accounts`

- `POST /api/v1/accounts/balance/refresh` — Refresh balance data for all users (cron). Params: none. Auth: machine.
- `GET /api/v1/accounts/business/categories/user_id/:user_id` — Business user's accounts grouped into categories with exclude/classification flags. Params: path `user_id` = business id. Auth: business.
- `POST /api/v1/accounts/business/manual` — Create a manual depository account as the business user. Params: body `accountName`, `accountType`, `institutionName` (required), `balance`, `balanceDate`, `notes`, `assignedCOA`, `currency` (optional). Auth: business.
- `POST /api/v1/accounts/accountant/manual/:businessId` — Create a manual account for a client as the accountant (same body as above). Params: path `businessId`; 409 DUPLICATE_ACCOUNT with `existingAccountId` on dupes. Auth: accountant.
- `POST /api/v1/accounts/accountant/extract-statement/:businessId` — AI-extract account fields from one uploaded PDF statement to auto-fill the add-account form. Params: multipart file (PDF only, ≤10MB, any field name). Auth: accountant.
- `GET /api/v1/accounts/accountant/manual/:businessId/:account_id/coa-impact` — Count GL lines on the account's assigned COA; returns `{ assignedCoa, glTransactionCount, locked }`. Auth: accountant.
- `PUT /api/v1/accounts/accountant/manual/:businessId/:account_id` — Update a manual account. Params: body (all optional) `accountName`, `accountType`, `institutionName`, `balance`, `balanceDate`, `notes`, `archived`, `assignedCOA`. Auth: accountant.
- `DELETE /api/v1/accounts/accountant/manual/:businessId/:account_id` — Delete a manual account; refuses non-`manual_` ids (400) and accounts with tied transactions (409 ACCOUNT_IN_USE with counts). Auth: accountant.
- `PUT /api/v1/accounts/business/manual/:account_id` — Business-user manual account update; controller expects a `businessId` param this route lacks — treat as broken, use the accountant route. Auth: business.
- `GET /api/v1/accounts/accountant/categories/user_id/:user_id` — Accountant view of a client's accounts-in-categories. Params: path `user_id` = business id. Auth: accountant.
- `GET /api/v1/accounts/accountant/categories/business/:businessId` — Same as above, param named `businessId`. Auth: accountant.

## Institutions / Plaid link — `/api/v1/institution`

- `PUT /api/v1/institution/business` — Repair/re-link an institution (fresh access token). Params: body `user_id`, `institution_id`, `public_token` (all required). Auth: business.
- `POST /api/v1/institution/business` — Legacy one-shot link: exchange token, store institution, create accounts. Params: same body. Auth: business.
- `PUT /api/v1/institution/accountant` — Accountant repair/re-link. Params: same body. Auth: accountant.
- `POST /api/v1/institution/accountant` — Accountant legacy one-shot link. Params: same body. Auth: accountant.
- `GET /api/v1/institution/accountant/expired/businessId/:businessId` — Client institutions needing reconnect; `[]` when no Institution doc, 204 no-body when doc has no institutions. Auth: accountant.
- `POST /api/v1/institution/accountant/linkPreview` — Phase 1 of two-phase link: exchange + store item, return live Plaid accounts, manual-merge candidates and CoA list; nothing saved to accounts yet. Params: body `user_id`, `institution_id`, `public_token`. Auth: accountant.
- `POST /api/v1/institution/accountant/commitAccountSetup` — Phase 2: apply per-account decisions and run initial backfill. Params: body `user_id`, `item_id`, `accounts: [{ plaid_account_id, action: 'create'|'merge', manualAccountId (iff merge), assignedCOA?, feedStartDate? (YYYY-MM-DD), notes? }]`. Auth: accountant.
- `GET /api/v1/institution/business/checkEmpty/user_id/:user_id` — `{ isEmpty }` whether any institutions are linked. Auth: business.
- `GET /api/v1/institution/business/expired/user_id/:user_id` — Business user's expired institutions; 204 when none linked. Auth: business.
- `POST /api/v1/institution/createBusinessLinkToken` — Mint a Plaid Link token for the calling accountant. Params: none (uses JWT id). Auth: accountant.
- `GET /api/v1/institution/data/:userId/:insId` — Raw institution data dump (ops/debug). Auth: machine.
- `POST /api/v1/institution/updateAllAccounts` — Fire-and-forget refresh of all accounts; 201 `{ inProgress: true }` immediately. Auth: machine.

## Plaid sync — `/api/v1/plaid`

- `POST /api/v1/plaid/webhook` — Plaid's inbound webhook (JWT-signature-verified, deduped, dispatched). Not user-callable. Auth: none (Plaid signature).
- `POST /api/v1/plaid/businessId/:businessId/sync-events` — Replay failed/unhandled webhook events; `mode: 'master_sync'` force-syncs all institutions. Params: body `event_types?`, `limit` (50), `mode?`. Auth: accountant.
- `POST /api/v1/plaid/businessId/:businessId/sync-now` — Sync all linked institutions now, then refresh balances (best-effort). Params: none; lock-guarded. Auth: accountant.
- `POST /api/v1/plaid/businessId/:businessId/custom-pull` — Pull transactions for chosen items/accounts over a date range (safe to re-pull). Params: body `itemIds` (required, min 1), `accountIds?`, `startDate`, `endDate` (YYYY-MM-DD, ≤24 months, endDate not future). Auth: accountant.
- `GET /api/v1/plaid/businessId/:businessId/event-logs` — Paged Plaid event log. Params: query `status?`, `event_type?`, `limit` (50), `page` (1). Auth: accountant.
- `POST /api/v1/plaid/businessId/:businessId/sandbox/reset-login` — QA: force sandbox items into "login required"; 403 outside Plaid sandbox. Params: body `itemIds?`. Auth: accountant.
- `POST /api/v1/plaid/fleet-sync` — Kick off fleet-wide backstop sync (daily cron). Auth: machine.
- `GET /api/v1/plaid/fleet-sync/status` — Fleet sync progress/outcome, polled by cron. Auth: machine.

## Health — `/`

- `GET /` — Cluster health `{ healthCheck, appVersion }`. Params: none, but requires `adminkey` header despite looking public. Auth: machine.

## Readmes / assistant / wiki — `/api/v1/readme`

- `GET /api/v1/readme/` — List all generated collection READMEs. Auth: machine.
- `GET /api/v1/readme/:name` — One collection README by name. Auth: machine.
- `POST /api/v1/readme/generate` — Start async README generation; returns `{ jobId }` immediately, 400 if already running. Params: body `mode` ('full'), `collections?`. Auth: machine.
- `POST /api/v1/readme/chat/:businessId` — Non-streaming assistant chat. Params: body `message` (required), `collections?`, `limit` (8), `conversationId?`. Auth: accountant.
- `POST /api/v1/readme/chat/:businessId/stream` — SSE streaming assistant chat (same body; `status`/content events, `ping` every 15s). Auth: accountant.
- `GET /api/v1/readme/conversations/:businessId` — Last 50 conversations for this business + calling user. Auth: accountant.
- `DELETE /api/v1/readme/conversations/:businessId` — Clear the calling user's conversations for this business. Auth: accountant.
- `POST /api/v1/readme/conversations/:businessId/export` — Export a table/document to a file. Params: body `type` ('xlsx'|'csv'|'docx'|'pdf'), and `blocks` OR `columns`+`rows`; `title?`. Returns file binary. Auth: accountant.
- `PUT /api/v1/readme/conversations/mark-solved/:conversationId` — Mark a conversation solved. Params: path `conversationId`; body `businessId` (no path param for it). Auth: accountant.
- `POST /api/v1/readme/quick/:businessId` — Fast intent triage; returns `{ intent, reply }`. Params: body `message` (≤2000 chars). Auth: accountant.
- `POST /api/v1/readme/support/:businessId` — Email a support request to the Dime team. Params: body `message`. Auth: accountant.
- `POST /api/v1/readme/feedback/:businessId` — Email feature feedback to the Dime team. Params: body `message`. Auth: accountant.
- `POST /api/v1/readme/wiki` — Create/upsert a wiki article. Params: body `wikiName`, `wikiContent`, `tags?`. Auth: machine.
- `PUT /api/v1/readme/wiki/:wikiId` — Update a wiki article. Auth: machine.
- `DELETE /api/v1/readme/wiki/:wikiId` — Delete a wiki article. Auth: machine.
- `GET /api/v1/readme/wikis/all` — List all wiki articles. Auth: machine.
- `GET /api/v1/readme/wiki/:wikiId` — One wiki article by id. Auth: machine.

## Gotchas

- "machine" auth means the `adminkey` header (server ADMIN_KEY), not an accountant JWT — accountant tokens get 401 on those routes, including the bare `GET /` health check.
- Sync-now and custom-pull are lock-guarded: a 200 with `started: false, alreadyRunning: true` means nothing new started — check the flag, don't trust the status code.
- `POST /api/v1/readme/generate` and `POST /api/v1/institution/updateAllAccounts` return immediately and finish in the background; there is no generic poll route for the first (job status lives in ReadmeGenerationQueue) and none at all for the second.
- Custom-pull rejects ranges over 24 months, endDate in the future, or startDate > endDate — all as 422 with a plain `message`.
- Manual-account delete only works on ids prefixed `manual_`, and 409s with transaction counts when anything is tied to the account or its COA; reclassify first.
- The two-phase link (linkPreview → commitAccountSetup) is the current accountant flow; the bare POST /business|/accountant createInstitution routes are the legacy one-shot and save accounts immediately.
- `PUT /api/v1/accounts/business/manual/:account_id` is effectively broken (controller reads a `businessId` param the route doesn't define) — use the accountant update route.
- Event-logs pagination defaults to `limit=50, page=1`; conversations list is hard-capped at 50 with no paging.
- The statement extractor accepts exactly one PDF (first multipart file wins), ≤10MB; non-PDF gives 415, unreadable PDFs 422.


## Appendix — exact parameters, extracted from the controllers

Machine-extracted from the product's controller source (every `req.query` /
`req.body` key the handler actually reads). This is the authority on filter
parameter NAMES — a name not listed here is silently ignored by that route.
Meanings and formats live in the entries above; when in doubt, pass exactly
these names and verify the returned date span and row count.

- `POST /api/v1/accounts/balance/refresh` — no query/body params read
- `GET /api/v1/accounts/business/categories/user_id/:user_id` — no query/body params read
- `POST /api/v1/accounts/business/manual` — body: `accountName`, `accountType`, `institutionName`
- `POST /api/v1/accounts/accountant/manual/:businessId` — no query/body params read
- `POST /api/v1/accounts/accountant/extract-statement/:businessId` — no query/body params read
- `GET /api/v1/accounts/accountant/manual/:businessId/:account_id/coa-impact` — no query/body params read
- `PUT /api/v1/accounts/accountant/manual/:businessId/:account_id` — body: `accountName`, `accountType`, `archived`, `assignedCOA`, `balance`, `balanceDate`, `institutionName`, `notes`
- `DELETE /api/v1/accounts/accountant/manual/:businessId/:account_id` — no query/body params read
- `PUT /api/v1/accounts/business/manual/:account_id` — body: `accountName`, `accountType`, `archived`, `assignedCOA`, `balance`, `balanceDate`, `institutionName`, `notes`
- `GET /api/v1/accounts/accountant/categories/user_id/:user_id` — no query/body params read
- `PUT /api/v1/institution/business` — body: `institution_id`, `public_token`, `user_id`
- `POST /api/v1/institution/business` — body: `institution_id`, `user_id`
- `PUT /api/v1/institution/accountant` — body: `institution_id`, `public_token`, `user_id`
- `POST /api/v1/institution/accountant` — body: `institution_id`, `user_id`
- `GET /api/v1/institution/accountant/expired/businessId/:businessId` — no query/body params read
- `POST /api/v1/institution/accountant/linkPreview` — body: `institution_id`, `public_token`, `user_id`
- `POST /api/v1/institution/accountant/commitAccountSetup` — body: `accounts`, `item_id`, `user_id`
- `GET /api/v1/institution/business/checkEmpty/user_id/:user_id` — no query/body params read
- `GET /api/v1/institution/business/expired/user_id/:user_id` — no query/body params read
- `POST /api/v1/institution/createBusinessLinkToken` — no query/body params read
- `GET /api/v1/institution/data/:userId/:insId` — no query/body params read
- `POST /api/v1/institution/updateAllAccounts` — no query/body params read
- `POST /api/v1/plaid/webhook` — body: `item_id`, `webhook_code`
- `POST /api/v1/plaid/businessId/:businessId/sync-events` — body: `event_types`, `limit`, `mode`
- `POST /api/v1/plaid/businessId/:businessId/sync-now` — no query/body params read
- `POST /api/v1/plaid/businessId/:businessId/custom-pull` — no query/body params read
- `GET /api/v1/plaid/businessId/:businessId/event-logs` — query: `event_type`, `limit`, `page`, `status`
- `POST /api/v1/plaid/businessId/:businessId/sandbox/reset-login` — body: `itemIds`
- `POST /api/v1/plaid/fleet-sync` — no query/body params read
- `GET /api/v1/plaid/fleet-sync/status` — no query/body params read
- `GET /api/v1/readme` — no query/body params read
- `GET /api/v1/readme/:name` — no query/body params read
- `POST /api/v1/readme/generate` — body: `collections`, `mode`
- `POST /api/v1/readme/chat/:businessId` — body: `businessId`, `collections`, `conversationId`, `limit`, `message`
- `POST /api/v1/readme/chat/:businessId/stream` — body: `businessId`, `collections`, `conversationId`, `limit`, `message`
- `GET /api/v1/readme/conversations/:businessId` — no query/body params read
- `DELETE /api/v1/readme/conversations/:businessId` — no query/body params read
- `POST /api/v1/readme/conversations/:businessId/export` — body: `blocks`, `columns`, `rows`, `title`, `type`
- `PUT /api/v1/readme/conversations/mark-solved/:conversationId` — body: `businessId`
- `POST /api/v1/readme/quick/:businessId` — no query/body params read
- `POST /api/v1/readme/support/:businessId` — no query/body params read
- `POST /api/v1/readme/feedback/:businessId` — no query/body params read
- `POST /api/v1/readme/wiki` — body: `tags`
- `PUT /api/v1/readme/wiki/:wikiId` — body: `tags`, `wikiContent`, `wikiName`
- `DELETE /api/v1/readme/wiki/:wikiId` — no query/body params read
- `GET /api/v1/readme/wikis/all` — no query/body params read
- `GET /api/v1/readme/wiki/:wikiId` — no query/body params read
