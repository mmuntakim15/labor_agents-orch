# Billing & Approvals

Billable-expense rebilling (tag client-chargeable costs, queue them, turn them into draft invoices), per-business invoice settings, and the firm's approval machinery: bill-approval settings, approval chains with embedded steps, delegation rules, escalation paths, and task workflows. Reach for this domain when a request touches rebilling expenses to customers, invoice defaults/reminders, or who approves what and in which order.

## Billable expenses (`/api/v1/accountant/billable-expenses`)

- `GET /api/v1/accountant/billable-expenses/:businessId/settings` — Read billable-expense settings (defaults if never saved). Auth: accountant.
- `PUT /api/v1/accountant/billable-expenses/:businessId/settings` — Update settings. Params: body `accountingTreatment` (`offset_expense|billable_asset`), `billableAssetAccount`/`markupIncomeAccount` (CoA ref), `markupType` (`flat|percentage`), `defaultMarkupValue`, `defaultTerms` (`net0|net15|net30|net45|net60|net90|dueOnReceipt`). Auth: accountant.
- `POST /api/v1/accountant/billable-expenses/:businessId/tag` — Tag a source line as billable. Params: body `object_type` (`bill|bank_transaction|card_transaction|reimbursement`), `source_id`, `source_line_id` (all required), optional `customer_id`, `markup {type,value}`. Auth: accountant.
- `POST /api/v1/accountant/billable-expenses/:businessId/untag` — Remove a billable tag. Params: body `object_type`, `source_id`, `source_line_id`. Auth: accountant.
- `GET /api/v1/accountant/billable-expenses/:businessId/queue` — List the billable queue (bare array; excluded rows hidden unless `status` given). Params: query `status`, `customerId`. Auth: accountant.
- `PATCH /api/v1/accountant/billable-expenses/:businessId/queue/:id` — Edit one queued expense. Params: body `markup`, `customer_id`. Auth: accountant.
- `GET /api/v1/accountant/billable-expenses/:businessId/queue/:id/attachments` — Attachments on the expense's source record. Auth: accountant.
- `POST /api/v1/accountant/billable-expenses/:businessId/exclude` — Exclude expenses from the queue. Params: body `{ids:[...]}` non-empty. Auth: accountant.
- `POST /api/v1/accountant/billable-expenses/:businessId/reinclude` — Restore excluded expenses. Params: body `{ids:[...]}`. Auth: accountant.
- `POST /api/v1/accountant/billable-expenses/:businessId/create-invoice` — Create a DRAFT invoice from queued expenses (never finalizes or sends; due date from defaultTerms). Params: body `{expense_ids:[...]}`, all one customer. Returns 201 `{invoice, expenses}`. Auth: accountant.
- `POST /api/v1/accountant/billable-expenses/:businessId/add-to-draft` — Append expenses as lines to an existing draft invoice. Params: body `invoice_id`, `expense_ids[]`. Auth: accountant.

## Invoice settings (`/api/v1/accountant/invoice-settings`)

- `POST /api/v1/accountant/invoice-settings/process-reminders` — Cron batch: send due invoice reminders across businesses. Auth: machine (admin key).
- `POST /api/v1/accountant/invoice-settings/process-scheduled-sends` — Cron batch: send invoices whose scheduled time arrived. Auth: machine.
- `GET /api/v1/accountant/invoice-settings/:businessId` — Read the business's invoice settings. Auth: accountant.
- `POST /api/v1/accountant/invoice-settings/:businessId` — Upsert (partial; only fields present change). Params: body `depositAccountId`, `paymentDetails`, `autoSendInvoices`, `autoSendReminders`, `reminders`, `sendingDomain`, `enablePaymentLinks`, `discounts`, `shippingRates`, `taxRates`, `additionalInfo`. Auth: accountant.

## Approval settings (`/api/v1/accountant/approval-settings`)

- `POST /api/v1/accountant/approval-settings/process-reminders` — Cron: send pending-approval reminder emails. Auth: machine.
- `GET /api/v1/accountant/approval-settings/:businessId/eligible-approvers` — Users who can be chosen as approvers. Auth: accountant.
- `GET /api/v1/accountant/approval-settings/:businessId` — Read bill-approval settings. Auth: accountant.
- `PUT /api/v1/accountant/approval-settings/:businessId` — Update. Params: body `approvalsEnabled`, `mandatoryApprover {userId,name,role}`, `mandatoryApproverThreshold`, `defaultChain` (approver refs, MAX 4), `reminderThresholdDays`, `escalationThresholdDays`, `escalationContact`. Auth: accountant.

## Approval chains (`/api/v1/accountant/approval-chain`) — all firm-scoped via overwriteUserIdToBeAccountantId

- `GET /api/v1/accountant/approval-chain/firm/:firmId` — List a firm's chains. Params: query `module`, `status`, `q`, `triggerEvent`. Auth: accountant.
- `POST /api/v1/accountant/approval-chain` — Create a chain. Params: body `firmId`, `module`, `description`, `workflows[]`, `triggerEvent`, `autoApproveBelowAmount`, `steps[]`, `status` (default Active). Auth: accountant.
- `GET /api/v1/accountant/approval-chain/:id` — Read one chain. Auth: accountant.
- `PUT /api/v1/accountant/approval-chain/:id` — Update chain fields (incl. `autoApproveBelowAmount`, `steps[]`). Auth: accountant.
- `DELETE /api/v1/accountant/approval-chain/:id` — Delete a chain. Auth: accountant.
- `POST /api/v1/accountant/approval-chain/:id/workflows` — Attach a workflow ref to the chain. Auth: accountant.
- `GET /api/v1/accountant/approval-chain/:id/workflows` — List the chain's workflow refs. Auth: accountant.
- `PUT /api/v1/accountant/approval-chain/:id/workflows/:workflowRefId` — Update one workflow ref. Auth: accountant.
- `DELETE /api/v1/accountant/approval-chain/:id/workflows/:workflowRefId` — Detach a workflow ref. Auth: accountant.
- `POST /api/v1/accountant/approval-chain/:id/steps` — Add an approval step. Auth: accountant.
- `GET /api/v1/accountant/approval-chain/:id/steps` — List steps. Auth: accountant.
- `GET /api/v1/accountant/approval-chain/:id/steps/:stepId` — Read one step. Auth: accountant.
- `PUT /api/v1/accountant/approval-chain/:id/steps/:stepId` — Update one step. Auth: accountant.
- `DELETE /api/v1/accountant/approval-chain/:id/steps/:stepId` — Remove one step. Auth: accountant.

## Delegation rules (`/api/v1/accountant/delegation-rule`) — firm-scoped

- `GET /api/v1/accountant/delegation-rule/firm/:firmId` — List rules. Params: query `status`, `q`. Auth: accountant.
- `POST /api/v1/accountant/delegation-rule` — Create. Params: body `firmId`, `delegator`, `delegatee`, `modules[]`, `workflows[]`, `startDate`, `endDate`, `reason`, `notify`. Auth: accountant.
- `GET /api/v1/accountant/delegation-rule/:id` — Read one rule. Auth: accountant.
- `PUT /api/v1/accountant/delegation-rule/:id` — Update allowed fields. Auth: accountant.
- `DELETE /api/v1/accountant/delegation-rule/:id` — Delete a rule. Auth: accountant.

## Escalation paths (`/api/v1/accountant/escalation-path`) — firm-scoped

- `GET /api/v1/accountant/escalation-path/firm/:firmId` — List paths. Params: query `status`, `q`. Auth: accountant.
- `POST /api/v1/accountant/escalation-path` — Create. Params: body `firmId`, `name`, `triggerAfterHours`, `escalationTo`, `maxEscalations` (default 3), `isNotifyOriginal` (default true), `autoEscalate` (default false), `status`. Auth: accountant.
- `GET /api/v1/accountant/escalation-path/:id` — Read one path. Auth: accountant.
- `PUT /api/v1/accountant/escalation-path/:id` — Update allowed fields. Auth: accountant.
- `DELETE /api/v1/accountant/escalation-path/:id` — Delete a path. Auth: accountant.

## Workflows (`/api/v1/accountant/workflow`) — firm-scoped; tasks and roles are embedded subdocuments

- `GET /api/v1/accountant/workflow/firm/:firmId` — List firm workflows. Params: query `module`, `type`, `q`, `status`. Auth: accountant.
- `GET /api/v1/accountant/workflow/firm/:firmId/dashboard-stats` — Workflow dashboard stats. Params: same query filters. Auth: accountant.
- `GET /api/v1/accountant/workflow/firm/:firmId/sox-controls-report` — SOX controls report. Auth: accountant.
- `POST /api/v1/accountant/workflow` — Create. Params: body `firmId` + `workflowName` (required), `description`, `module`, `type`, `escalationHours`, `tasks[]`, `roles[]`. Auth: accountant.
- `GET /api/v1/accountant/workflow/:workflowId` — Read one workflow. Auth: accountant.
- `PUT /api/v1/accountant/workflow/:workflowId` — Update (allowlisted fields). Auth: accountant.
- `DELETE /api/v1/accountant/workflow/:workflowId` — Delete a workflow. Auth: accountant.
- `POST /api/v1/accountant/workflow/:workflowId/tasks` — Add a task. Params: body `taskName` (required), `assigneeRole`, `reviewerRole`, `estimatedHours`, `isSoxCritical`, `isDualApproval`, `status`. Auth: accountant.
- `GET /api/v1/accountant/workflow/:workflowId/tasks` — List tasks. Auth: accountant.
- `GET /api/v1/accountant/workflow/:workflowId/tasks/:taskId` — Read one task. Auth: accountant.
- `PUT /api/v1/accountant/workflow/:workflowId/tasks/:taskId` — Update a task. Auth: accountant.
- `DELETE /api/v1/accountant/workflow/:workflowId/tasks/:taskId` — Delete a task. Auth: accountant.
- `POST /api/v1/accountant/workflow/:workflowId/roles` — Add a role. Params: body `rolesOne`, `rolesTwo`, `controlType`, `riskLevel`. Auth: accountant.
- `GET /api/v1/accountant/workflow/:workflowId/roles` — List roles. Auth: accountant.
- `GET /api/v1/accountant/workflow/:workflowId/roles/:roleId` — Read one role. Auth: accountant.
- `PUT /api/v1/accountant/workflow/:workflowId/roles/:roleId` — Update a role. Auth: accountant.
- `DELETE /api/v1/accountant/workflow/:workflowId/roles/:roleId` — Delete a role. Auth: accountant.

## Gotchas

- `firmId` in chain/rule/path/workflow routes is the **firm owner's accountant id** — team-member calls are rewritten to the owner's id by middleware, so always pass the root accountant id, not the team member's.
- The billable queue (`GET .../queue`) returns a **bare array**, not `{data}`; without `status` it silently hides `excluded` rows.
- `exclude`/`reinclude` take `{ids:[...]}`; `create-invoice`/`add-to-draft` take `{expense_ids:[...]}` — different key names for the same kind of list.
- `create-invoice` only produces a **draft** (finalize/send are hard-coded off) and requires all selected expenses to share one customer; finalizing/sending happens on the invoice surfaces.
- The three `process-*` POSTs need machine/admin-key auth — an accountant JWT gets rejected; don't call them from a helper session.
- `approval-settings` `defaultChain` is capped at 4 approvers by validation.
- `invoice-settings` upsert is a POST (not PUT) and is partial: omitted fields keep their stored values.


## Appendix — exact parameters, extracted from the controllers

Machine-extracted from the product's controller source (every `req.query` /
`req.body` key the handler actually reads). This is the authority on filter
parameter NAMES — a name not listed here is silently ignored by that route.
Meanings and formats live in the entries above; when in doubt, pass exactly
these names and verify the returned date span and row count.

- `GET /api/v1/accountant/billable-expenses/:businessId/settings` — no query/body params read
- `PUT /api/v1/accountant/billable-expenses/:businessId/settings` — no query/body params read
- `POST /api/v1/accountant/billable-expenses/:businessId/tag` — no query/body params read
- `POST /api/v1/accountant/billable-expenses/:businessId/untag` — no query/body params read
- `GET /api/v1/accountant/billable-expenses/:businessId/queue` — query: `customerId`, `status`
- `PATCH /api/v1/accountant/billable-expenses/:businessId/queue/:id` — body: `customer_id`, `markup`
- `GET /api/v1/accountant/billable-expenses/:businessId/queue/:id/attachments` — no query/body params read
- `POST /api/v1/accountant/billable-expenses/:businessId/exclude` — body: `ids`
- `POST /api/v1/accountant/billable-expenses/:businessId/reinclude` — body: `ids`
- `POST /api/v1/accountant/billable-expenses/:businessId/create-invoice` — body: `expense_ids`
- `POST /api/v1/accountant/billable-expenses/:businessId/add-to-draft` — body: `expense_ids`, `invoice_id`
- `POST /api/v1/accountant/invoice-settings/process-reminders` — no query/body params read
- `POST /api/v1/accountant/invoice-settings/process-scheduled-sends` — no query/body params read
- `GET /api/v1/accountant/invoice-settings/:businessId` — no query/body params read
- `POST /api/v1/accountant/invoice-settings/:businessId` — body: `additionalInfo`, `autoSendInvoices`, `autoSendReminders`, `depositAccountId`, `discounts`, `enablePaymentLinks`, `paymentDetails`, `reminders`, `sendingDomain`, `shippingRates`, `taxRates`
- `GET /api/v1/accountant/approval-chain/firm/:firmId` — query: `module`, `q`, `status`, `triggerEvent`
- `POST /api/v1/accountant/approval-chain` — body: `autoApproveBelowAmount`, `steps`, `workflows`
- `GET /api/v1/accountant/approval-chain/:id` — no query/body params read
- `PUT /api/v1/accountant/approval-chain/:id` — body: `autoApproveBelowAmount`, `steps`
- `DELETE /api/v1/accountant/approval-chain/:id` — no query/body params read
- `POST /api/v1/accountant/approval-chain/:id/workflows` — no query/body params read
- `GET /api/v1/accountant/approval-chain/:id/workflows` — no query/body params read
- `PUT /api/v1/accountant/approval-chain/:id/workflows/:workflowRefId` — no query/body params read
- `DELETE /api/v1/accountant/approval-chain/:id/workflows/:workflowRefId` — no query/body params read
- `POST /api/v1/accountant/approval-chain/:id/steps` — no query/body params read
- `GET /api/v1/accountant/approval-chain/:id/steps` — no query/body params read
- `GET /api/v1/accountant/approval-chain/:id/steps/:stepId` — no query/body params read
- `PUT /api/v1/accountant/approval-chain/:id/steps/:stepId` — no query/body params read
- `DELETE /api/v1/accountant/approval-chain/:id/steps/:stepId` — no query/body params read
- `POST /api/v1/accountant/approval-settings/process-reminders` — no query/body params read
- `GET /api/v1/accountant/approval-settings/:businessId/eligible-approvers` — no query/body params read
- `GET /api/v1/accountant/approval-settings/:businessId` — no query/body params read
- `PUT /api/v1/accountant/approval-settings/:businessId` — no query/body params read
- `GET /api/v1/accountant/delegation-rule/firm/:firmId` — query: `module`, `q`, `status`, `workflowId`
- `POST /api/v1/accountant/delegation-rule` — body: `modules`, `workflows`
- `GET /api/v1/accountant/delegation-rule/:id` — no query/body params read
- `PUT /api/v1/accountant/delegation-rule/:id` — no query/body params read
- `DELETE /api/v1/accountant/delegation-rule/:id` — no query/body params read
- `GET /api/v1/accountant/escalation-path/firm/:firmId` — query: `q`, `status`
- `POST /api/v1/accountant/escalation-path` — no query/body params read
- `GET /api/v1/accountant/escalation-path/:id` — no query/body params read
- `PUT /api/v1/accountant/escalation-path/:id` — no query/body params read
- `DELETE /api/v1/accountant/escalation-path/:id` — no query/body params read
- `GET /api/v1/accountant/workflow/firm/:firmId` — query: `module`, `q`, `status`, `type`
- `GET /api/v1/accountant/workflow/firm/:firmId/dashboard-stats` — no query/body params read
- `GET /api/v1/accountant/workflow/firm/:firmId/sox-controls-report` — query: `module`, `q`, `status`, `type`
- `POST /api/v1/accountant/workflow` — body: `roles`, `tasks`
- `GET /api/v1/accountant/workflow/:workflowId` — no query/body params read
- `PUT /api/v1/accountant/workflow/:workflowId` — no query/body params read
- `DELETE /api/v1/accountant/workflow/:workflowId` — no query/body params read
- `POST /api/v1/accountant/workflow/:workflowId/tasks` — no query/body params read
- `GET /api/v1/accountant/workflow/:workflowId/tasks` — no query/body params read
- `GET /api/v1/accountant/workflow/:workflowId/tasks/:taskId` — no query/body params read
- `PUT /api/v1/accountant/workflow/:workflowId/tasks/:taskId` — no query/body params read
- `DELETE /api/v1/accountant/workflow/:workflowId/tasks/:taskId` — no query/body params read
- `POST /api/v1/accountant/workflow/:workflowId/roles` — no query/body params read
- `GET /api/v1/accountant/workflow/:workflowId/roles` — no query/body params read
- `GET /api/v1/accountant/workflow/:workflowId/roles/:roleId` — no query/body params read
- `PUT /api/v1/accountant/workflow/:workflowId/roles/:roleId` — no query/body params read
- `DELETE /api/v1/accountant/workflow/:workflowId/roles/:roleId` — no query/body params read
