# Team & Access

Accountant auth/MFA, firm team roster and invites, RBAC (roles, permissions, teams, per-user entity access), business-client invites and entity creation, chart-of-accounts seeding, onboarding, and firm/entity setup checklists. Reach for this when a request touches "who can do what", team membership, inviting a client, or setup/onboarding progress.

## Auth & MFA — `/api/v1/accountant/auth`

- `POST /api/v1/accountant/auth/register` — Create an accountant account. Params: body registration fields (email, password, name). Auth: none (rate-limited).
- `POST /api/v1/accountant/auth/login` — Log in; returns a JWT or an MFA-pending token. Params: body email, password. Auth: none (rate-limited).
- `GET /api/v1/accountant/auth/logout` — End the session. Auth: none.
- `GET /api/v1/accountant/auth/me` — Current accountant profile. Auth: accountant.
- `PUT /api/v1/accountant/auth/updateDetails` — Update own profile details. Params: body profile fields. Auth: accountant.
- `PUT /api/v1/accountant/auth/businessProfile` — Update the firm's business profile. Auth: accountant.
- `POST /api/v1/accountant/auth/beneficialOwners` — Add a beneficial owner to the firm profile. Auth: accountant.
- `PUT /api/v1/accountant/auth/beneficialOwners/:ownerId` — Update a beneficial owner. Auth: accountant.
- `DELETE /api/v1/accountant/auth/beneficialOwners/:ownerId` — Remove a beneficial owner. Auth: accountant.
- `PUT /api/v1/accountant/auth/updatePassword` — Change password. Params: body currentPassword, newPassword. Auth: accountant.
- `POST /api/v1/accountant/auth/forgotPassword` — Email a reset token. Params: body email. Auth: none (rate-limited).
- `PUT /api/v1/accountant/auth/resetPassword/:resetToken` — Reset password via emailed token. Auth: none.
- `PUT /api/v1/accountant/auth/setArchivedStatus` — Archive/unarchive the account. Auth: accountant.
- `PUT /api/v1/accountant/auth/updateTeamMemberDetails/:teamMemberId` — Edit a team member's profile details. Auth: accountant.
- `POST /api/v1/accountant/auth/mfa/verify` — Complete an MFA login challenge. Params: body code. Auth: mfa-pending token.
- `POST /api/v1/accountant/auth/mfa/resend` — Resend the MFA login code. Auth: mfa-pending token.
- `POST /api/v1/accountant/auth/mfa/setup` — Begin MFA enrollment. Auth: accountant.
- `POST /api/v1/accountant/auth/mfa/setup/confirm` — Confirm MFA enrollment with a code. Auth: accountant.
- `DELETE /api/v1/accountant/auth/mfa/disable` — Disable MFA. Auth: accountant.
- `GET /api/v1/accountant/auth/mfa/status` — MFA enrollment/enforcement status. Auth: accountant.
- `GET /api/v1/accountant/auth/mfa/devices` — List trusted devices. Auth: accountant.
- `DELETE /api/v1/accountant/auth/mfa/devices/:deviceId` — Revoke a trusted device. Auth: accountant.
- `PUT /api/v1/accountant/auth/mfa/enforce` — Toggle firm-wide MFA enforcement. Auth: accountant.

## Firm team — `/api/v1/accountant/team`

- `POST /api/v1/accountant/team/invite` — Invite a team member. Params: body email, expiration, role, roles, entities. Auth: accountant.
- `GET /api/v1/accountant/team/roster` — Legacy flat roster. Auth: accountant.
- `GET /api/v1/accountant/team/roster/v2` — Paginated roster + header cards. Params: query search, sortBy=name, sortDir=asc, page=1, pageSize=15. Auth: accountant.
- `GET /api/v1/accountant/team/member/:id` — One member's detail. Auth: accountant.
- `PUT /api/v1/accountant/team/invite/:id/resend` — Resend a pending invite. Auth: accountant.
- `PUT /api/v1/accountant/team/invite/:id/revoke` — Revoke a pending invite. Auth: accountant.
- `PUT /api/v1/accountant/team/member/:id/archive` — Deactivate a member. Auth: accountant.
- `PUT /api/v1/accountant/team/member/:id/reinstate` — Reactivate an archived member. Auth: accountant.

## Business invites & entities — `/api/v1/accountant/invite`

- `POST /api/v1/accountant/invite/addBusiness` — Create a client business entity directly. Params: body business fields, businessInfo.yearEndType/fiscalYearEnd; functionalCurrency/isParent/subsidiaryIds are stripped server-side. Auth: accountant.
- `POST /api/v1/accountant/invite/addBusinessUsersBulkViaFile` — Bulk-import businesses from an uploaded file. Params: multipart `file`, body firmId, firstName, lastName. Auth: machine (adminkey header).
- `POST /api/v1/accountant/invite/addBusinessUsersBulkViaJSON` — Bulk-import businesses via JSON. Params: body firmId, firstName, lastName, data[]. Auth: machine (adminkey header).
- `PUT /api/v1/accountant/invite/updateBusiness/:id` — Update a client business entity. Auth: accountant.
- `POST /api/v1/accountant/invite/business` — Send a business-client email invite. Params: body invite fields (email, business name...). Auth: accountant.
- `GET /api/v1/accountant/invite/business/:id` — Public invite-info lookup (accept-invite page). Auth: none.
- `PUT /api/v1/accountant/invite/business/:id/revoke` — Revoke a business invite. Auth: accountant.
- `PUT /api/v1/accountant/invite/business/:id/resend` — Resend a business invite. Auth: accountant.
- `POST /api/v1/accountant/invite/:id/chartAccount` — Add one CoA row to business `:id`. Params: body name, code, type... Auth: accountant.
- `POST /api/v1/accountant/invite/:id/chartAccountsBulk` — Bulk add CoA rows to business `:id`. Params: query import=true for import mode; body array of accounts or matrix shape. Auth: accountant.
- `PUT /api/v1/accountant/invite/:id/chartAccount/:chartId` — Update one CoA row (name, code, isActive). Auth: accountant.
- `GET /api/v1/accountant/invite/:id/chartAccount/:chartId/coa-impact` — Preview impact of a CoA change/deactivation before saving. Auth: accountant.
- `GET /api/v1/accountant/invite/defaultChartOfAccounts` — Default CoA template list. Auth: none.

## RBAC — `/api/v1/accountant/rolesAndPermissions`

- `GET /api/v1/accountant/rolesAndPermissions/roles/:firmId` — List the firm's roles. Auth: accountant (must belong to firm).
- `GET /api/v1/accountant/rolesAndPermissions/roles/:firmId/:roleId` — One role's detail. Auth: accountant (firm member).
- `GET /api/v1/accountant/rolesAndPermissions/availableRoles` — Assignable-role catalog. Auth: accountant.
- `POST /api/v1/accountant/rolesAndPermissions/availableRoles` — Create a custom role. Params: body displayName, description, key. Auth: accountant (firm owner).
- `GET /api/v1/accountant/rolesAndPermissions/availablePermissions` — Full permission catalog. Auth: accountant.
- `POST /api/v1/accountant/rolesAndPermissions/roles/:firmId` — Add roles to the firm. Params: body roles[]. Auth: accountant (firm owner).
- `PUT /api/v1/accountant/rolesAndPermissions/roles/:firmId/:roleKey/permissions` — Replace a role's permissions. Params: body permissions[]. Auth: accountant (firm owner).
- `PATCH /api/v1/accountant/rolesAndPermissions/roles/:firmId/:roleKey/permissions/add` — Merge permissions into a role. Params: body permissions[]. Auth: accountant (firm owner).
- `PATCH /api/v1/accountant/rolesAndPermissions/roles/:firmId/:roleKey/permissions/remove` — Remove permissions from a role. Params: body permissions[]. Auth: accountant (firm owner).
- `PATCH /api/v1/accountant/rolesAndPermissions/roles/:firmId/:roleKey/active` — Activate/deactivate a role. Params: body isActive. Auth: accountant (firm owner).
- `PATCH /api/v1/accountant/rolesAndPermissions/users/:userId/addRoles` — Grant roles to a user. Params: body roles[], firmId. Auth: accountant (firm owner).
- `PATCH /api/v1/accountant/rolesAndPermissions/users/:userId/removeRoles` — Remove roles from a user. Params: body roles[], firmId. Auth: accountant (firm owner).
- `PATCH /api/v1/accountant/rolesAndPermissions/users/:userId/addEntities` — Grant entity access to a user. Params: body entities[], firmId. Auth: accountant (firm owner).
- `PATCH /api/v1/accountant/rolesAndPermissions/users/:userId/removeEntities` — Remove entity access from a user. Params: body entities[], firmId. Auth: accountant (firm owner).
- `GET /api/v1/accountant/rolesAndPermissions/teams/:firmId` — List teams. Auth: accountant (firm member).
- `POST /api/v1/accountant/rolesAndPermissions/teams/:firmId` — Create teams. Params: body teams[]. Auth: accountant (firm owner).
- `PATCH /api/v1/accountant/rolesAndPermissions/teams/:firmId/:teamId/meta` — Rename/redescribe a team. Params: body name, description. Auth: accountant (firm owner).
- `POST /api/v1/accountant/rolesAndPermissions/teams/:firmId/:teamId/members` — Bulk add members. Params: body members[]. Auth: accountant (firm owner).
- `DELETE /api/v1/accountant/rolesAndPermissions/teams/:firmId/:teamId/members` — Bulk remove members. Params: body emails[] (not members). Auth: accountant (firm owner).
- `PATCH /api/v1/accountant/rolesAndPermissions/teams/:firmId/:teamId/status` — Activate/deactivate a team. Params: body isActive. Auth: accountant (firm owner).
- `PUT /api/v1/accountant/rolesAndPermissions/teams/:firmId/:teamId/members/roles` — Replace all roles for one member. Params: body email, roles[]. Auth: accountant (firm owner).
- `PATCH /api/v1/accountant/rolesAndPermissions/teams/:firmId/:teamId/members/roles/add` — Merge roles onto one member. Params: body email, rolesToAdd[]. Auth: accountant (firm owner).

## Onboarding — `/api/v1/accountant/onboarding`

- `POST /api/v1/accountant/onboarding/businessInformation` — Save onboarding business info. Params: body profile fields; isPersonalAccount switches schema. Auth: accountant.
- `POST /api/v1/accountant/onboarding/controllerInformation` — Save controller (responsible person) details. Auth: accountant.
- `GET /api/v1/accountant/onboarding/checklist` — Onboarding checklist state. Auth: accountant.
- `POST /api/v1/accountant/onboarding/paymentFlag` — Set payment flags. Params: body isCreditCardEnabled, isACHEnabled, isNonePaymentMethod. Auth: accountant.

## Firm setup — `/api/v1/accountant/setup`

- `GET /api/v1/accountant/setup/progress` — Firm-level setup progress. Auth: accountant.
- `POST /api/v1/accountant/setup/dismiss` — Dismiss (or undo-dismiss) a setup item. Params: body key (whitelisted), undo. Returns recomputed progress. Auth: accountant.
- `POST /api/v1/accountant/setup/skip` — Skip onboarding entirely. Auth: accountant.

## Entity setup — `/api/v1/accountant/entity-setup`

- `GET /api/v1/accountant/entity-setup/:businessId` — Per-entity setup checklist with auto statuses. Auth: accountant (must own the entity).
- `POST /api/v1/accountant/entity-setup/:businessId` — Update one checklist item. Params: body key, status ∈ pending|in_progress|done|not_applicable. Auth: accountant.

## Gotchas

- In `/invite/:id/chartAccount...` routes, `:id` is the BUSINESS id; in `/invite/business/:id/...` it is the INVITE id; in `/team/...` the `:id` is a member or invite id per path. Do not mix them up.
- RBAC mutations pass firmId in the URL for role/team routes but in the BODY for `/users/:userId/*` routes — firmScopeProtect validates whichever is present, and only the firm owner passes.
- Team-member removal takes `emails[]` while addition takes `members[]`; member-role replace takes `roles[]` but merge takes `rolesToAdd[]` / `rolesToRemove[]`.
- `roster/v2` returns a dashboard shape: `table.rows` + `table.pagination` (default pageSize 15), plus `headerCards` counts and `headerCardItems` arrays — the member list is NOT at the top level.
- `POST /invite/chartAccountsBulk` accepts either a bare array of accounts or a matrix shape, and `?import=true` flips import semantics.
- The two bulk business-import routes need the `adminkey` header (machine key), not a JWT — the helper normally cannot call them.
- Auth/login/forgot-password routes are rate-limited; hammering them returns 429s.
- Onboarding routes silently rewrite the acting user to the firm owner for team members (`overwriteUserIdToBeAccountantId`) — writes land on the owner's record.
- `POST /setup/dismiss` and `POST /entity-setup/:businessId` reject unknown `key` values with 422; entity-setup statuses are a fixed enum.


## Appendix — exact parameters, extracted from the controllers

Machine-extracted from the product's controller source (every `req.query` /
`req.body` key the handler actually reads). This is the authority on filter
parameter NAMES — a name not listed here is silently ignored by that route.
Meanings and formats live in the entries above; when in doubt, pass exactly
these names and verify the returned date span and row count.

- `POST /api/v1/accountant/auth/register` — body: `email`, `roles`
- `POST /api/v1/accountant/auth/login` — body: `deviceToken`, `email`, `password`, `rememberDevice`
- `GET /api/v1/accountant/auth/logout` — no query/body params read
- `GET /api/v1/accountant/auth/me` — no query/body params read
- `PUT /api/v1/accountant/auth/updateDetails` — body: `dba`, `defaultEntity`, `email`, `firstName`, `lastName`
- `PUT /api/v1/accountant/auth/businessProfile` — body: `businessInfo`, `controller`
- `POST /api/v1/accountant/auth/beneficialOwners` — no query/body params read
- `PUT /api/v1/accountant/auth/beneficialOwners/:ownerId` — no query/body params read
- `DELETE /api/v1/accountant/auth/beneficialOwners/:ownerId` — no query/body params read
- `PUT /api/v1/accountant/auth/updatePassword` — body: `currentPassword`, `newPassword`
- `POST /api/v1/accountant/auth/forgotPassword` — body: `email`
- `PUT /api/v1/accountant/auth/resetPassword/:resetToken` — body: `password`
- `PUT /api/v1/accountant/auth/setArchivedStatus` — body: `businessId`, `isArchived`
- `PUT /api/v1/accountant/auth/updateTeamMemberDetails/:teamMemberId` — body: `rate`
- `POST /api/v1/accountant/auth/mfa/verify` — body: `otp`, `trustDevice`
- `POST /api/v1/accountant/auth/mfa/resend` — no query/body params read
- `POST /api/v1/accountant/auth/mfa/setup` — no query/body params read
- `POST /api/v1/accountant/auth/mfa/setup/confirm` — body: `otp`
- `DELETE /api/v1/accountant/auth/mfa/disable` — body: `password`
- `GET /api/v1/accountant/auth/mfa/status` — no query/body params read
- `GET /api/v1/accountant/auth/mfa/devices` — no query/body params read
- `DELETE /api/v1/accountant/auth/mfa/devices/:deviceId` — no query/body params read
- `PUT /api/v1/accountant/auth/mfa/enforce` — body: `enforce`
- `POST /api/v1/accountant/team/invite` — body: `email`, `entities`, `expiration`, `role`, `roles`
- `GET /api/v1/accountant/team/roster` — no query/body params read
- `GET /api/v1/accountant/team/roster/v2` — query: `page`, `pageSize`, `search`, `sortBy`, `sortDir`
- `GET /api/v1/accountant/team/member/:id` — no query/body params read
- `PUT /api/v1/accountant/team/invite/:id/resend` — no query/body params read
- `PUT /api/v1/accountant/team/invite/:id/revoke` — no query/body params read
- `PUT /api/v1/accountant/team/member/:id/archive` — no query/body params read
- `PUT /api/v1/accountant/team/member/:id/reinstate` — no query/body params read
- `POST /api/v1/accountant/invite/addBusiness` — body: `businessInfo`, `functionalCurrency`, `isParent`, `loginUser`, `subsidiaryIds`
- `POST /api/v1/accountant/invite/addBusinessUsersBulkViaFile` — body: `firmId`, `firstName`, `lastName`
- `POST /api/v1/accountant/invite/addBusinessUsersBulkViaJSON` — body: `data`, `firmId`, `firstName`, `lastName`
- `PUT /api/v1/accountant/invite/updateBusiness/:id` — body: `businessInfo`, `functionalCurrency`, `isParent`, `subsidiaryIds`
- `POST /api/v1/accountant/invite/business` — no query/body params read
- `GET /api/v1/accountant/invite/business/:id` — no query/body params read
- `PUT /api/v1/accountant/invite/business/:id/revoke` — no query/body params read
- `PUT /api/v1/accountant/invite/business/:id/resend` — no query/body params read
- `POST /api/v1/accountant/invite/:id/chartAccount` — no query/body params read
- `POST /api/v1/accountant/invite/:id/chartAccountsBulk` — query: `import`
- `PUT /api/v1/accountant/invite/:id/chartAccount/:chartId` — body: `code`, `isActive`, `name`
- `GET /api/v1/accountant/invite/:id/chartAccount/:chartId/coa-impact` — no query/body params read
- `GET /api/v1/accountant/invite/defaultChartOfAccounts` — no query/body params read
- `GET /api/v1/accountant/rolesAndPermissions/roles/:firmId` — no query/body params read
- `GET /api/v1/accountant/rolesAndPermissions/roles/:firmId/:roleId` — no query/body params read
- `GET /api/v1/accountant/rolesAndPermissions/availableRoles` — no query/body params read
- `POST /api/v1/accountant/rolesAndPermissions/availableRoles` — no query/body params read
- `GET /api/v1/accountant/rolesAndPermissions/availablePermissions` — no query/body params read
- `POST /api/v1/accountant/rolesAndPermissions/roles/:firmId` — body: `roles`
- `PUT /api/v1/accountant/rolesAndPermissions/roles/:firmId/:roleKey/permissions` — body: `permissions`
- `PATCH /api/v1/accountant/rolesAndPermissions/roles/:firmId/:roleKey/permissions/add` — body: `permissions`
- `PATCH /api/v1/accountant/rolesAndPermissions/roles/:firmId/:roleKey/permissions/remove` — body: `permissions`
- `PATCH /api/v1/accountant/rolesAndPermissions/roles/:firmId/:roleKey/active` — body: `isActive`
- `PATCH /api/v1/accountant/rolesAndPermissions/users/:userId/addRoles` — body: `firmId`, `roles`
- `PATCH /api/v1/accountant/rolesAndPermissions/users/:userId/removeRoles` — body: `firmId`, `roles`
- `PATCH /api/v1/accountant/rolesAndPermissions/users/:userId/addEntities` — body: `entities`, `firmId`
- `PATCH /api/v1/accountant/rolesAndPermissions/users/:userId/removeEntities` — body: `entities`, `firmId`
- `GET /api/v1/accountant/rolesAndPermissions/teams/:firmId` — no query/body params read
- `POST /api/v1/accountant/rolesAndPermissions/teams/:firmId` — body: `teams`
- `PATCH /api/v1/accountant/rolesAndPermissions/teams/:firmId/:teamId/meta` — body: `description`, `name`
- `POST /api/v1/accountant/rolesAndPermissions/teams/:firmId/:teamId/members` — body: `members`
- `DELETE /api/v1/accountant/rolesAndPermissions/teams/:firmId/:teamId/members` — body: `emails`
- `PATCH /api/v1/accountant/rolesAndPermissions/teams/:firmId/:teamId/status` — body: `isActive`
- `PUT /api/v1/accountant/rolesAndPermissions/teams/:firmId/:teamId/members/roles` — body: `email`, `roles`
- `PATCH /api/v1/accountant/rolesAndPermissions/teams/:firmId/:teamId/members/roles/add` — body: `email`, `rolesToAdd`
- `POST /api/v1/accountant/onboarding/businessInformation` — body: `isPersonalAccount`
- `POST /api/v1/accountant/onboarding/controllerInformation` — no query/body params read
- `GET /api/v1/accountant/onboarding/checklist` — no query/body params read
- `POST /api/v1/accountant/onboarding/paymentFlag` — body: `isACHEnabled`, `isCreditCardEnabled`, `isNonePaymentMethod`
- `GET /api/v1/accountant/setup/progress` — no query/body params read
- `POST /api/v1/accountant/setup/dismiss` — body: `key`, `undo`
- `POST /api/v1/accountant/setup/skip` — no query/body params read
- `GET /api/v1/accountant/entity-setup/:businessId` — no query/body params read
- `POST /api/v1/accountant/entity-setup/:businessId` — body: `key`, `status`
