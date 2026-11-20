# Documents & Misc API Catalog

Document vault (files/folders/document requests), transaction receipts (upload + AI extraction + transaction matching), presigned downloads, accountant preferences, firm audit logs, and machine API clients. Reach for this domain when handling client documents, receipt-to-transaction workflows, file downloads, or firm-level audit/preference/API-key admin.

## Document Vault — `/api/v1/accountant/documentVault`
- `POST /api/v1/accountant/documentVault/file` — upload a vault file (multipart). Params: body businessId, name, permission; optional folderId, tags, assignedTo, status. Auth: accountant.
- `GET /api/v1/accountant/documentVault/file/:fileId` — fetch one vault file with download info. Params: path fileId. Auth: accountant.
- `POST /api/v1/accountant/documentVault/folder` — create a folder. Params: body businessId, name; optional parentFolderId, tags, permission, assignedTo. Auth: accountant.
- `PUT /api/v1/accountant/documentVault/folder` — update a folder. Params: body folderId; optional name, tags, permission, parentFolderId, assignedTo, status. Auth: accountant.
- `DELETE /api/v1/accountant/documentVault/folder/:folderId` — delete a folder. Params: path folderId. Auth: accountant.
- `PUT /api/v1/accountant/documentVault/file` — update file metadata. Params: body fileId; optional name, tags, permission, folderId, assignedTo, status. Auth: accountant.
- `GET /api/v1/accountant/documentVault/dashboard/:businessId` — full vault tree for a business. Params: path businessId; query startDate, endDate, createdBy, tags, accessType, searchKey, folderId. Auth: accountant.
- `POST /api/v1/accountant/documentVault/request` — create a document request to a client. Params: body businessId, name, type, status, documents; optional notes, deadline. Auth: accountant.
- `GET /api/v1/accountant/documentVault/requests/:businessId` — list document requests. Params: path businessId. Auth: accountant.
- `GET /api/v1/accountant/documentVault/request/:id` — fetch one document request. Params: path id. Auth: accountant.
- `PUT /api/v1/accountant/documentVault/request/:id` — update a document request. Params: body name, type, status, documents, notes, deadline. Auth: accountant.
- `DELETE /api/v1/accountant/documentVault/request/:id` — delete a document request. Params: path id. Auth: accountant.
- `POST /api/v1/accountant/documentVault/migrateFilesGoogleDrive` — admin-only Google Drive → Spaces migration. Params: body firmId. Auth: none (admin middleware, not accountant JWT).

## Transaction Receipts — `/api/v1/accountant/transaction-receipts`
- `POST /api/v1/accountant/transaction-receipts/:businessId/upload` — upload up to 25 receipt files (multipart field `files`); triggers AI extraction + matching. Params: body optional kind (default 'receipt'). Auth: accountant.
- `GET /api/v1/accountant/transaction-receipts/:businessId` — list receipts. Params: query status, kind, search, limit (1-500, default 50), skip, sortField, sortDir. Auth: accountant.
- `GET /api/v1/accountant/transaction-receipts/:businessId/:id` — fetch one receipt with extracted metadata. Auth: accountant.
- `PUT /api/v1/accountant/transaction-receipts/:businessId/:id` — update kind/status/notes and user-correctable extractedMetadata (merchant, amount, date, currency, taxAmount, checkDetails, invoiceDetails, receiptDetails). Auth: accountant.
- `DELETE /api/v1/accountant/transaction-receipts/:businessId/:id` — delete a receipt. Auth: accountant.
- `POST /api/v1/accountant/transaction-receipts/:businessId/:id/reextract` — re-run AI metadata extraction. Auth: accountant.
- `POST /api/v1/accountant/transaction-receipts/:businessId/:id/rematch` — re-run transaction matching. Auth: accountant.
- `GET /api/v1/accountant/transaction-receipts/:businessId/:id/candidates` — list candidate transactions to link. Params: query startDate, endDate, all. Auth: accountant.
- `POST /api/v1/accountant/transaction-receipts/:businessId/:id/link` — link a receipt to a transaction. Params: body transactionItemId AND transaction_id (both required). Auth: accountant.
- `POST /api/v1/accountant/transaction-receipts/:businessId/:id/unlink` — unlink a receipt from its transaction. Auth: accountant.
- `POST /api/v1/accountant/transaction-receipts/:businessId/bulk` — bulk action. Params: body receiptIds (array, min 1), action ('delete'|'archive'|'reextract'|'rematch'|'changeKind'), kind (needed for changeKind). Auth: accountant.

## Downloads — `/api/v1/accountant/download`
- `GET /api/v1/accountant/download/presign` — mint a 15-minute presigned URL for a stored object. Params: query bucket, key (both required; bucket must be an allowed Spaces bucket). Auth: accountant.

## Preferences — `/api/v1/accountant/preferences`
- `GET /api/v1/accountant/preferences/` — read the firm accountant's preferences. Auth: accountant.
- `POST /api/v1/accountant/preferences/` — create/update (upsert) preferences. Params: body = preference fields per validation schema. Auth: accountant.
- `POST /api/v1/accountant/preferences/reset` — reset preferences to defaults. Params: none. Auth: accountant.

## Audit Logs — `/api/v1/accountant/auditLogs`
- `PATCH /api/v1/accountant/auditLogs/:firmId` — read firm audit logs with filters. Params: body searchText, status ('success'|'error'), category, startDate, endDate, page, limit (max 500); query exports=xlsx for full export. Auth: accountant.
- `GET /api/v1/accountant/auditLogs/:firmId` — same handler as PATCH, REST-proper verb; filters ride in the body so use PATCH from HTTP clients that drop GET bodies. Auth: accountant.

## API Clients — `/api/v1/accountant/api-clients`
- `POST /api/v1/accountant/api-clients/` — register a machine API client; returns id + one-time secret. Params: body label/name, description, webhookUrl, expiresInMonths (default 12). Auth: accountant.
- `GET /api/v1/accountant/api-clients/` — list the firm's API clients. Auth: accountant.
- `GET /api/v1/accountant/api-clients/:clientId` — fetch one API client. Auth: accountant.
- `PUT /api/v1/accountant/api-clients/:clientId` — update name, description, webhookUrl. Auth: accountant.
- `POST /api/v1/accountant/api-clients/:clientId/refresh` — rotate the secret; new secret returned once. Auth: accountant.
- `DELETE /api/v1/accountant/api-clients/:clientId` — revoke the API client. Auth: accountant.

## Gotchas
- Vault folder/file **updates take the id in the body** (`folderId`/`fileId`), not the path — only deletes/gets use path params.
- All documentVault routes, reads included, require VAULT.EDIT team permission.
- `migrateFilesGoogleDrive` uses the `admin` middleware — a normal accountant JWT gets rejected.
- Audit-log **filters live in the request body**, even on GET; use PATCH. Pagination default 100/page, clamped to 500. `?exports=xlsx` ignores pagination and returns everything. Every read is itself meta-audited.
- Receipt upload is async: extraction/matching runs after upload — poll the receipt (status field) or the list endpoint to see results.
- Receipt link body needs BOTH `transactionItemId` and `transaction_id`.
- Receipt list `limit` caps at 500; kind/status accept a string or an array.
- `/download/presign` 403s on any bucket outside the three allowed Spaces buckets; URLs expire in 900s.
- API-client secrets are shown only in the register/refresh response — unrecoverable afterward.
- `routes/accountant/helperFile.js` is middleware helpers, not a router — no routes mount from it.


## Appendix — exact parameters, extracted from the controllers

Machine-extracted from the product's controller source (every `req.query` /
`req.body` key the handler actually reads). This is the authority on filter
parameter NAMES — a name not listed here is silently ignored by that route.
Meanings and formats live in the entries above; when in doubt, pass exactly
these names and verify the returned date span and row count.

- `POST /api/v1/accountant/documentVault/file` — body: `accountantId`, `assignedTo`, `businessId`, `folderId`, `name`, `permission`, `status`, `tags`
- `GET /api/v1/accountant/documentVault/file/:fileId` — no query/body params read
- `POST /api/v1/accountant/documentVault/folder` — body: `accountantId`, `assignedTo`, `businessId`, `name`, `parentFolderId`, `permission`, `tags`
- `PUT /api/v1/accountant/documentVault/folder` — body: `assignedTo`, `folderId`, `name`, `parentFolderId`, `permission`, `status`, `tags`
- `DELETE /api/v1/accountant/documentVault/folder/:folderId` — no query/body params read
- `PUT /api/v1/accountant/documentVault/file` — body: `assignedTo`, `fileId`, `folderId`, `name`, `permission`, `status`, `tags`
- `GET /api/v1/accountant/documentVault/dashboard/:businessId` — query: `accessType`, `createdBy`, `endDate`, `folderId`, `searchKey`, `startDate`, `tags`
- `POST /api/v1/accountant/documentVault/request` — body: `businessId`, `deadline`, `documents`, `name`, `notes`, `status`, `type`
- `GET /api/v1/accountant/documentVault/requests/:businessId` — no query/body params read
- `GET /api/v1/accountant/documentVault/request/:id` — no query/body params read
- `PUT /api/v1/accountant/documentVault/request/:id` — body: `deadline`, `documents`, `name`, `notes`, `status`, `type`
- `DELETE /api/v1/accountant/documentVault/request/:id` — no query/body params read
- `POST /api/v1/accountant/documentVault/migrateFilesGoogleDrive` — body: `businessId`, `firmId`, `firstName`, `folderId`, `gFolderId`, `lastName`, `tags`
- `POST /api/v1/accountant/transaction-receipts/:businessId/upload` — body: `kind`
- `GET /api/v1/accountant/transaction-receipts/:businessId` — no query/body params read
- `GET /api/v1/accountant/transaction-receipts/:businessId/:id` — no query/body params read
- `PUT /api/v1/accountant/transaction-receipts/:businessId/:id` — no query/body params read
- `DELETE /api/v1/accountant/transaction-receipts/:businessId/:id` — no query/body params read
- `POST /api/v1/accountant/transaction-receipts/:businessId/:id/reextract` — no query/body params read
- `POST /api/v1/accountant/transaction-receipts/:businessId/:id/rematch` — no query/body params read
- `GET /api/v1/accountant/transaction-receipts/:businessId/:id/candidates` — query: `all`, `endDate`, `startDate`
- `POST /api/v1/accountant/transaction-receipts/:businessId/:id/link` — no query/body params read
- `POST /api/v1/accountant/transaction-receipts/:businessId/:id/unlink` — no query/body params read
- `POST /api/v1/accountant/transaction-receipts/:businessId/bulk` — no query/body params read
- `GET /api/v1/accountant/preferences` — no query/body params read
- `POST /api/v1/accountant/preferences` — no query/body params read
- `POST /api/v1/accountant/preferences/reset` — no query/body params read
- `PATCH /api/v1/accountant/auditLogs/:firmId` — query: `exports` · body: `category`, `endDate`, `limit`, `page`, `searchText`, `startDate`, `status`
- `GET /api/v1/accountant/auditLogs/:firmId` — query: `exports`
- `POST /api/v1/accountant/api-clients` — body: `description`, `expiresInMonths`, `label`, `name`, `webhookUrl`
- `GET /api/v1/accountant/api-clients` — no query/body params read
- `GET /api/v1/accountant/api-clients/:clientId` — no query/body params read
- `PUT /api/v1/accountant/api-clients/:clientId` — body: `description`, `name`, `webhookUrl`
- `POST /api/v1/accountant/api-clients/:clientId/refresh` — no query/body params read
- `DELETE /api/v1/accountant/api-clients/:clientId` — no query/body params read
