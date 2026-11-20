# Entities — customers, vendors, products, custom fields, command center

Master-data records that transactions, invoices and bills reference: customers, vendors (with W-9s and AP-approval config), the product/service catalog, and custom field categories (Department/Class/Location + custom) — plus the one-call Command Center dashboard aggregate. Reach for this domain when a request names a customer/vendor/product by name, tags lines with departments/classes/locations, or wants the client-health overview.

## Customers — `/api/v1/accountant/customer`

- `GET /api/v1/accountant/customer/business/:businessId` — list all customers for a business. Params: query `exports=xlsx` returns `{location}` (Spaces URL) instead of the array. Auth: accountant.
- `POST /api/v1/accountant/customer` — create a customer. Params: body businessId, customerName, legalName, primaryEmail, contactPhone, address1/2, city, state, postalCode, country, terms (net0|net15|net30|net45|net60|net90|dueOnReceipt), taxRate, notes, status (active|inactive|prospect|lead), tags[], customFields[{fieldName,fieldValue}]. Auth: accountant.
- `POST /api/v1/accountant/customer/bulk` — bulk create customers. Params: body = bare array of customer objects or `{customers:[...]}`; returns createdCount/failedCount. Auth: accountant.
- `DELETE /api/v1/accountant/customer/bulk/:businessId` — bulk delete customers by id. Params: body = BARE array of ids; query `check=true` = dependency dry-run only; 409 + deps report when blocked. Auth: accountant.
- `PUT /api/v1/accountant/customer/:id` — update a customer (same body schema as create). Auth: accountant.
- `GET /api/v1/accountant/customer/:id` — read one customer (404 when not yours). Auth: accountant.

## Vendors — `/api/v1/accountant/vendor`

- `GET /api/v1/accountant/vendor/business/:businessId` — list all vendors. Params: query `exports=xlsx` returns `{location}`. Auth: accountant.
- `POST /api/v1/accountant/vendor` — create a vendor. Params: body businessId, vendorName, email, taxId, is1099Eligible, address1/2, city, state, postalCode, country, notes, status (active|inactive), tags[], customFields[], w9FileUrl; approval fields owner/approvalsEnabled/approvalChain[] are firm-Admin-only (403 otherwise). Auth: accountant.
- `POST /api/v1/accountant/vendor/bulk` — bulk create vendors. Params: body = bare array or `{vendors:[...]}`. Auth: accountant.
- `DELETE /api/v1/accountant/vendor/bulk/:businessId` — bulk delete vendors; CASCADES soft-delete of linked bills, their GL lines, and prepaid-schedule items. Params: body = BARE array of ids (wrapped object → 400); query `check=true` = dry-run. Auth: accountant.
- `PUT /api/v1/accountant/vendor/:id` — update a vendor (approval fields still Admin-only). Auth: accountant.
- `GET /api/v1/accountant/vendor/:id` — read one vendor. Auth: accountant.
- `POST /api/v1/accountant/vendor/:id/w9` — upload a W-9 (multipart, field name `file`); stores the file URL on the vendor. Auth: accountant.
- `DELETE /api/v1/accountant/vendor/:id/w9` — clear the vendor's W-9 URL (file itself stays in storage). Auth: accountant.

## Products — `/api/v1/accountant/product`

- `GET /api/v1/accountant/product/business/:businessId` — list all products for a business. Auth: accountant.
- `GET /api/v1/accountant/product/business/:businessId/categories` — distinct product category names (array of strings). Auth: accountant.
- `POST /api/v1/accountant/product` — create a product. Params: body businessId, productName, externalName, productId (SKU), description, category, revenueAccount, discountAccount, defaultPrice, countToARR, status (active|inactive), tags[], customFields[]. Auth: accountant.
- `PUT /api/v1/accountant/product/:id` — update a product (same schema). Auth: accountant.
- `GET /api/v1/accountant/product/:id` — read one product. Auth: accountant.
- `DELETE /api/v1/accountant/product/:id` — delete a product. Params: query `check=true` = dependency dry-run; real delete 409s with deps when blocked. Auth: accountant.

## Custom field categories — `/api/v1/accountant/field`

- `GET /api/v1/accountant/field/business/:businessId` — list field categories; seeds defaults on first call; returns `{fields, caps:{maxActive,maxCustom,activeCount,customCount}}`. Auth: accountant.
- `POST /api/v1/accountant/field` — create a category. Params: body businessId, fieldName, values[{title,description}], appliesToAccountTypes[] (empty = all), mandatory, isActive; 400 when the custom or active cap is hit. Auth: accountant.
- `GET /api/v1/accountant/field/:fieldId/value/:valueId/usage` — count of transaction lines using one value (`{count}`) — check before deleting a value. Auth: accountant.
- `GET /api/v1/accountant/field/:fieldId/usage` — count of transaction lines using any value of the category (`{count}`). Auth: accountant.
- `PUT /api/v1/accountant/field/:id` — update a category. Params: body = field payload plus optional cascadeValueUpdates[{valueId,newTitle}] and cascadeValueDeletes[valueId] which rewrite/pull the tags on all transaction lines; protected defaults cannot be renamed. Auth: accountant.
- `GET /api/v1/accountant/field/:id` — read one category. Auth: accountant.
- `DELETE /api/v1/accountant/field/:id` — delete a custom category and pull its tags off every transaction line; Department/Class/Location are protected (400). Auth: accountant.

## Command center — `/api/v1/accountant/command-center`

- `GET /api/v1/accountant/command-center/:businessId` — one aggregated dashboard payload (analytics, reports, dashboard, connections, close checklist, upcoming bills/invoices). Params: query period (default 7d), trendPeriod (default mtd), trendType (default cashflow), aiAnalysis=true for an AI insight (slower — calls OpenAI). Auth: accountant.

## Gotchas

- Bulk DELETE bodies are BARE arrays of ids (`["id1","id2"]`) — no wrapper object. Bulk CREATE accepts either a bare array or `{customers}`/`{vendors}`.
- Deletes are two-step by design: call with `?check=true` first to get the dependency report, then delete; a blocked delete answers 409 with that same report. Field categories have no `?check` — use the two `/usage` endpoints before destructive field edits.
- Vendor bulk delete is destructive beyond vendors: it soft-deletes the vendors' bills, those bills' GL lines, and prepaid-schedule items. Get explicit confirmation first.
- Access failures on `/:id` reads come back as 404 "not found", never 403 — a missing record and a foreign record look identical.
- `?exports=xlsx` on the customer/vendor list flips the response shape from an array to `{location}`.
- Field list GET has write side effects (seeds default categories); expect Department/Class/Location to appear on first read of a fresh business.
- Vendor approval config (owner, approvalsEnabled, approvalChain) 403s unless the acting user is a firm Admin, even when the rest of the body is valid.
- Joi marks nearly everything optional (even names) — the API will happily create empty-named records, so validate intent before writing.
- `aiAnalysis=true` on command-center adds an OpenAI round-trip; leave it off unless the insight text is actually wanted.


## Appendix — exact parameters, extracted from the controllers

Machine-extracted from the product's controller source (every `req.query` /
`req.body` key the handler actually reads). This is the authority on filter
parameter NAMES — a name not listed here is silently ignored by that route.
Meanings and formats live in the entries above; when in doubt, pass exactly
these names and verify the returned date span and row count.

- `GET /api/v1/accountant/customer/business/:businessId` — query: `exports`
- `POST /api/v1/accountant/customer` — no query/body params read
- `POST /api/v1/accountant/customer/bulk` — body: `customers`
- `DELETE /api/v1/accountant/customer/bulk/:businessId` — query: `check`
- `PUT /api/v1/accountant/customer/:id` — no query/body params read
- `GET /api/v1/accountant/customer/:id` — no query/body params read
- `GET /api/v1/accountant/vendor/business/:businessId` — query: `exports`
- `POST /api/v1/accountant/vendor` — no query/body params read
- `POST /api/v1/accountant/vendor/bulk` — body: `vendors`
- `DELETE /api/v1/accountant/vendor/bulk/:businessId` — query: `check`
- `PUT /api/v1/accountant/vendor/:id` — no query/body params read
- `GET /api/v1/accountant/vendor/:id` — no query/body params read
- `POST /api/v1/accountant/vendor/:id/w9` — no query/body params read
- `DELETE /api/v1/accountant/vendor/:id/w9` — no query/body params read
- `GET /api/v1/accountant/product/business/:businessId` — no query/body params read
- `GET /api/v1/accountant/product/business/:businessId/categories` — no query/body params read
- `POST /api/v1/accountant/product` — no query/body params read
- `PUT /api/v1/accountant/product/:id` — no query/body params read
- `GET /api/v1/accountant/product/:id` — no query/body params read
- `DELETE /api/v1/accountant/product/:id` — query: `check`
- `GET /api/v1/accountant/field/business/:businessId` — no query/body params read
- `POST /api/v1/accountant/field` — body: `businessId`, `isActive`
- `GET /api/v1/accountant/field/:fieldId/value/:valueId/usage` — no query/body params read
- `GET /api/v1/accountant/field/:fieldId/usage` — no query/body params read
- `PUT /api/v1/accountant/field/:id` — body: `cascadeValueDeletes`, `cascadeValueUpdates`
- `GET /api/v1/accountant/field/:id` — no query/body params read
- `DELETE /api/v1/accountant/field/:id` — no query/body params read
- `GET /api/v1/accountant/command-center/:businessId` — query: `aiAnalysis`, `period`, `trendPeriod`, `trendType`
