# Business

Business-user account surfaces: registration/login/session, onboarding profile + checklist, linking an accountant to a business, admin firm-owner invites, and the ASC GL compliance AI check. Reach for this when the request concerns the business user's own account, onboarding state, or a compliance scan — not bookkeeping data (that lives in the accountant/transaction domains).

## /api/v1/business/auth (routes/business/auth.js)

- `POST /api/v1/business/auth/checkEmail` — does a LoginUser exist for this email. Params: body `email`. Auth: none (rate-limited).
- `POST /api/v1/business/auth/register` — register a business user, consuming an accountant invite when given. Params: body `email`, `password`, `phoneNumber`, `termAndCondition`, optional `inviteId`. Auth: none (rate-limited).
- `POST /api/v1/business/auth/login` — login; returns `loginToken` + persona `users` list (not a persona JWT). Params: body `email`, `password`. Auth: none (rate-limited).
- `GET /api/v1/business/auth/logout` — clears the token cookie. Params: none. Auth: none.
- `GET /api/v1/business/auth/me` — current business user profile with LoginUser email/name merged in. Params: none. Auth: business.
- `POST /api/v1/business/auth/exchangeLoginToken` — trade `loginToken` for a persona-scoped JWT. Params: body `userId` (from login's `users` list); Authorization header carries the loginToken. Auth: login-token (exchangeTokenProtect).
- `PUT /api/v1/business/auth/updateDetails` — partial profile update. Params: body any of `email`, `firstName`, `lastName`, `dba`, `phoneNumber`. Auth: business.
- `PUT /api/v1/business/auth/updatePassword` — change password; responds 204 no body. Params: body `currentPassword`, `newPassword`. Auth: business.
- `POST /api/v1/business/auth/forgotPassword` — email a reset link. Params: body `email`. Auth: none (rate-limited).
- `PUT /api/v1/business/auth/resetPassword/:resetToken` — set a new password with the emailed token. Params: path `resetToken`, body `password`. Auth: none (rate-limited).
- `PUT /api/v1/business/auth/setArchivedStatus` — archive/unarchive the calling business user. Params: body `isArchived` boolean. Auth: business.

## /api/v1/business/onboarding (routes/business/onboarding.js)

- `POST /api/v1/business/onboarding/businessInformation` — save business or personal profile (schema switches on `isPersonalAccount`). Params: body profile fields incl. `isPersonalAccount`, `dba`, address etc. Auth: business.
- `POST /api/v1/business/onboarding/controllerInformation` — save company controller details (server assigns a hex `id`). Params: body controller fields. Auth: business.
- `GET /api/v1/business/onboarding/checklist` — onboarding step status flags plus a `navigation` hint (`financial`|`launchpad`). Params: none. Auth: business.
- `POST /api/v1/business/onboarding/paymentFlag` — set payment-method flags. Params: body `isCreditCardEnabled`, `isACHEnabled`, `isNonePaymentMethod`. Auth: business.
- `GET /api/v1/business/onboarding/uniqueEmailCheck/:email` — does a BusinessUser exist for this email; returns `{ isEmailExists }`. Params: path `email`. Auth: none.

## /api/v1/business/accountant (routes/business/accountant.js)

- `POST /api/v1/business/accountant` — link an accountant to the calling business (both sides updated). Params: body `accountantEmail`, `permission`. Auth: business.

## /api/v1/admin/firm-invitations (routes/admin/firmOwnerInvite.js)

- `POST /api/v1/admin/firm-invitations` — send a firm-owner invite email to the self-register page; 409 if an AccountantUser already has the email, 202 on send. Params: body `email`, `firstName`, `lastName`, optional `note`. Auth: machine (`adminkey` header, not a JWT).

## /api/v1/glCompliance (routes/ai/glComplianceAI.js)

- `POST /api/v1/glCompliance/checkGLCompliance` — run ASC compliance checks (ASC730/842/805/350/740/330) over supplied GL items. Params: body `businessId` and `complianceInfo` array of `{ complianceType, ... }`. Auth: accountant.

## Gotchas

- Almost everything here needs a **business-user JWT**, not the accountant token the helper normally mints — `businessProtect` rejects accountant tokens. The exceptions: glCompliance (accountant), firm-invitations (adminkey header), and the public auth/email-check routes.
- Login is **two-step**: `/login` yields a `loginToken` + persona list; you must call `/exchangeLoginToken` with a `userId` to get the JWT the protected routes accept.
- The business user id is implicit in the token on every protected route — there is no `:businessId` path segment in this domain.
- `checkGLCompliance` wraps failures per item: an unknown `complianceType` or a failed check returns 200 with an `error` field inside that array entry — check each entry, not just the status code.
- `checklist` spells one flag `isBenficiaries` (missing "e") — match it exactly.
- `updatePassword` returns **204 with an empty body**; don't parse for JSON.
- `checkEmail` (POST, LoginUser table) and `uniqueEmailCheck/:email` (GET, BusinessUser table) answer *different* questions with different response keys (`emailExists` vs `isEmailExists`).


## Appendix — exact parameters, extracted from the controllers

Machine-extracted from the product's controller source (every `req.query` /
`req.body` key the handler actually reads). This is the authority on filter
parameter NAMES — a name not listed here is silently ignored by that route.
Meanings and formats live in the entries above; when in doubt, pass exactly
these names and verify the returned date span and row count.

- `POST /api/v1/business/auth/checkEmail` — body: `email`
- `POST /api/v1/business/auth/register` — body: `email`, `inviteId`, `password`, `phoneNumber`, `termAndCondition`
- `POST /api/v1/business/auth/login` — body: `email`, `password`
- `GET /api/v1/business/auth/logout` — no query/body params read
- `GET /api/v1/business/auth/me` — no query/body params read
- `POST /api/v1/business/auth/exchangeLoginToken` — body: `userId`
- `PUT /api/v1/business/auth/updateDetails` — body: `dba`, `email`, `firstName`, `lastName`, `phoneNumber`
- `PUT /api/v1/business/auth/updatePassword` — body: `currentPassword`, `newPassword`
- `POST /api/v1/business/auth/forgotPassword` — body: `email`
- `PUT /api/v1/business/auth/resetPassword/:resetToken` — body: `password`
- `PUT /api/v1/business/auth/setArchivedStatus` — body: `isArchived`
- `POST /api/v1/business/onboarding/businessInformation` — body: `isPersonalAccount`
- `POST /api/v1/business/onboarding/controllerInformation` — no query/body params read
- `GET /api/v1/business/onboarding/checklist` — no query/body params read
- `POST /api/v1/business/onboarding/paymentFlag` — body: `isACHEnabled`, `isCreditCardEnabled`, `isNonePaymentMethod`
- `GET /api/v1/business/onboarding/uniqueEmailCheck/:email` — no query/body params read
- `POST /api/v1/business/accountant` — body: `accountantEmail`, `permission`
- `POST /api/v1/admin/firm-invitations` — no query/body params read
- `POST /api/v1/glCompliance/checkGLCompliance` — body: `businessId`, `complianceInfo`
