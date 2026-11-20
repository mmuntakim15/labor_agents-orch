# AI Agents

Everything AI-side of the product: the transaction categorization agent (start/watch/cancel runs), its rules, guardrails and skills, the agent marketplace (hire agents, give them tasks, approve their proposed actions, chat with them, schedule them), the per-business knowledge base, and accountant training. Reach for this domain when a request mentions "the AI", categorization runs, hired agents, agent tasks/approvals, agent chat, business knowledge notes, or training/assessments.

## Categorization agent — `/api/v1/accountant/agent`

- `POST /api/v1/accountant/agent/callAgent/:businessId` — start an async categorization run. Params: body optional `{ startDate, endDate, accountIds[] }` (empty = full lookback, all accounts). Auth: accountant.
- `GET /api/v1/accountant/agent/callAgent/getStatus/:businessId` — poll the run/queue status after starting. Params: none. Auth: accountant.
- `GET /api/v1/accountant/agent/callAgent/history/:businessId` — past categorization runs. Params: none. Auth: accountant.
- `GET /api/v1/accountant/agent/callAgent/scopePreview/:businessId` — preview what a scope would hit before running. Params: query `startDate`, `endDate`, `accountIds`. Auth: accountant.
- `POST /api/v1/accountant/agent/callAgent/cancel/:businessId` — cancel an in-flight run. Params: none. Auth: accountant.
- `PATCH /api/v1/accountant/agent/callTransactionsAgent/:businessId` — categorize specific transactions. Params: body `{ transactions: [ids] }`; query `preview=true` for dry run. Auth: accountant.

## AI skills — `/api/v1/accountant/ai-skills`

- `GET /api/v1/accountant/ai-skills/business/:businessId` — list AI skills for a business. Auth: accountant.
- `POST /api/v1/accountant/ai-skills` — create a skill. Params: body includes `businessId` plus skill fields (Joi-validated). Auth: accountant.
- `PUT /api/v1/accountant/ai-skills/:id` — update a skill (protected fields stripped server-side). Auth: accountant.
- `DELETE /api/v1/accountant/ai-skills/:id` — delete a skill. Auth: accountant.

## Categorization rules — `/api/v1/accountant/categorizationRules`

- `GET /api/v1/accountant/categorizationRules/business/:businessId` — list rules. Auth: accountant.
- `POST /api/v1/accountant/categorizationRules` — create a rule. Params: body includes `businessId` + rule fields. Auth: accountant.
- `PUT /api/v1/accountant/categorizationRules/:id` — update a rule. Auth: accountant.
- `DELETE /api/v1/accountant/categorizationRules/:id` — delete a rule. Auth: accountant.
- `POST /api/v1/accountant/categorizationRules/business/:businessId/reorder` — reprioritize. Params: body `{ rules: [...] }`. Auth: accountant.
- `POST /api/v1/accountant/categorizationRules/business/:businessId/test` — dry-run one rule on one transaction. Params: body `{ transaction, rule }`. Auth: accountant.

## Guardrails — `/api/v1/accountant/guardrails`

- `GET /api/v1/accountant/guardrails/business/:businessId` — list guardrails. Auth: accountant.
- `POST /api/v1/accountant/guardrails` — create a guardrail. Params: body includes `businessId`. Auth: accountant.
- `GET /api/v1/accountant/guardrails/:id` — read one guardrail. Auth: accountant.
- `PUT /api/v1/accountant/guardrails/:id` — update a guardrail. Auth: accountant.
- `DELETE /api/v1/accountant/guardrails/:id` — delete a guardrail. Auth: accountant.
- `POST /api/v1/accountant/guardrails/business/:businessId/defaults` — seed the default guardrail set. Auth: accountant.

## Agent marketplace — `/api/v1/accountant/agents`

- `GET /api/v1/accountant/agents/catalog` — list hireable agents. Auth: accountant.
- `GET /api/v1/accountant/agents/catalog/:agentId` — one catalog agent. Auth: accountant.
- `GET /api/v1/accountant/agents/catalog/:agentId/profile` — full agent profile. Auth: accountant.
- `GET /api/v1/accountant/agents/interview/:agentId/status` — pre-hire interview status. Params: query `businessId`. Auth: accountant.
- `POST /api/v1/accountant/agents/interview/:agentId` — stateless turn-capped interview chat. Params: body `{ businessId, messages[] }`. Auth: accountant.
- `GET /api/v1/accountant/agents/roster/:businessId` — the hired team. Auth: accountant.
- `POST /api/v1/accountant/agents/roster/:businessId/hire` — hire an agent. Params: body `{ agentId }`. Auth: accountant.
- `DELETE /api/v1/accountant/agents/roster/:businessId/agents/:agentId` — fire an agent. Auth: accountant.
- `PATCH /api/v1/accountant/agents/roster/:businessId/agents/:agentId` — update a hired agent. Params: body `{ config, enabled }`. Auth: accountant.
- `POST /api/v1/accountant/agents/tasks/:businessId` — create an agent task. Params: body `{ title, description, attachments, targetAgentId, source, conversationId }`. Auth: accountant.
- `GET /api/v1/accountant/agents/tasks/:businessId` — list tasks. Params: query `status`, `limit` (default 50). Auth: accountant.
- `GET /api/v1/accountant/agents/tasks/by-id/:taskId` — one task with steps and proposed actions. Auth: accountant.
- `POST /api/v1/accountant/agents/tasks/by-id/:taskId/actions/:actionId/approve` — approve one proposed action (executes the write). Auth: accountant.
- `POST /api/v1/accountant/agents/tasks/by-id/:taskId/actions/:actionId/reject` — reject one proposed action. Auth: accountant.
- `POST /api/v1/accountant/agents/tasks/by-id/:taskId/approve-all` — approve all pending actions. Auth: accountant.
- `POST /api/v1/accountant/agents/tasks/by-id/:taskId/reject-all` — reject all pending actions. Auth: accountant.
- `POST /api/v1/accountant/agents/tasks/by-id/:taskId/reply` — post a follow-up message. Params: body `{ content }`. Auth: accountant.
- `PATCH /api/v1/accountant/agents/tasks/by-id/:taskId` — rename a task. Params: body `{ title }`. Auth: accountant.
- `DELETE /api/v1/accountant/agents/tasks/by-id/:taskId` — delete a task. Auth: accountant.
- `POST /api/v1/accountant/agents/tasks/by-id/:taskId/clarifications/:requestId/answer` — answer a clarification. Params: body `{ answer, selectedOptionIndex }`. Auth: accountant.
- `POST /api/v1/accountant/agents/tasks/by-id/:taskId/steps/:stepId/retry` — retry a failed step. Params: body `{ statementFileIds, userInstruction }`. Auth: accountant.
- `GET /api/v1/accountant/agents/tasks/stream/:businessId` — SSE stream of task events. Params: JWT in query string. Auth: none at route level (token validated in controller).
- `POST /api/v1/accountant/agents/workflows/:businessId/statement-files` — multipart statement-PDF upload (stored server-side for 3-way match). Auth: accountant.
- `POST /api/v1/accountant/agents/workflows/:businessId/transaction-files` — JSON body of client-parsed CSV/XLSX rows, stored in full; agent imports by fileId. Auth: accountant.
- `GET /api/v1/accountant/agents/onboarding/:businessId/:agentId` — read onboarding (notes, documents, skills). Auth: accountant.
- `PATCH /api/v1/accountant/agents/onboarding/:businessId/:agentId/notes` — update notes. Params: body `{ entityNotes }`. Auth: accountant.
- `POST /api/v1/accountant/agents/onboarding/:businessId/:agentId/documents` — multipart upload, field `files`, max 5. Auth: accountant.
- `DELETE /api/v1/accountant/agents/onboarding/:businessId/:agentId/documents` — remove a document, key in `?key=` (preferred). Auth: accountant.
- `DELETE /api/v1/accountant/agents/onboarding/:businessId/:agentId/documents/:key` — legacy remove, URI-encoded key in path. Auth: accountant.
- `POST /api/v1/accountant/agents/onboarding/:businessId/:agentId/skills` — add an onboarding skill. Params: body `{ title, instructions, scope='entity' }`. Auth: accountant.
- `PATCH /api/v1/accountant/agents/onboarding/:businessId/:agentId/skills/:skillId` — update an onboarding skill. Auth: accountant.
- `DELETE /api/v1/accountant/agents/onboarding/:businessId/:agentId/skills/:skillId` — remove an onboarding skill. Auth: accountant.
- `GET /api/v1/accountant/agents/scheduled/:businessId` — list recurring schedules. Auth: accountant.
- `POST /api/v1/accountant/agents/scheduled/:businessId` — create a schedule. Params: body `{ agentId, title, prompt, cronExpression }` required; `attachments`, `timezone` (default America/New_York), `enabled`. Auth: accountant.
- `PATCH /api/v1/accountant/agents/scheduled/:businessId/:scheduleId` — update a schedule. Auth: accountant.
- `DELETE /api/v1/accountant/agents/scheduled/:businessId/:scheduleId` — delete a schedule. Auth: accountant.
- `POST /api/v1/accountant/agents/scheduled/_fire/:scheduleId` — internal cron webhook fires a due schedule. Auth: machine (adminkey header).
- `POST /api/v1/accountant/agents/clarifications/_timeout-sweep` — internal daily sweep cancelling stale clarifications. Auth: machine (adminkey header).
- `GET /api/v1/accountant/agents/chat/:businessId` — read a chat conversation. Params: query `conversationId`, `scope` ('team' default), `create=1`. Auth: accountant.
- `POST /api/v1/accountant/agents/chat/:businessId` — send a message. Params: body `{ content, attachments[], conversationId }`. Auth: accountant.
- `DELETE /api/v1/accountant/agents/chat/:businessId` — clear a conversation. Params: query `conversationId`. Auth: accountant.
- `GET /api/v1/accountant/agents/chat/:businessId/threads` — list threads. Params: query `scope`. Auth: accountant.
- `POST /api/v1/accountant/agents/chat/:businessId/threads` — create a thread. Params: body `{ title }`. Auth: accountant.
- `PATCH /api/v1/accountant/agents/chat/:businessId/threads/:conversationId` — rename a thread. Params: body `{ title }`. Auth: accountant.
- `DELETE /api/v1/accountant/agents/chat/:businessId/threads/:conversationId` — delete a thread. Auth: accountant.
- `POST /api/v1/accountant/agents/chat/:businessId/upload` — multipart chat attachments, field `files`, max 5. Auth: accountant.
- `GET /api/v1/accountant/agents/conversations/:businessId` — unified task+chat list. Params: query `filter` ('all'), `limit` (server-capped), `before` (date cursor), `scope`. Auth: accountant.
- `GET /api/v1/accountant/agents/conversations/:businessId/:refKind/:refId` — read one conversation; `:refKind` is 'conversation' | 'chat' | 'task'. Auth: accountant.
- `POST /api/v1/accountant/agents/conversations/:businessId/:refKind/:refId/messages` — post a message. Params: body `{ content, targetAgentId }`. Auth: accountant.
- `POST /api/v1/accountant/agents/conversations/:businessId/:refKind/:refId/pin` — pin/unpin. Params: body `{ pinned: bool }`. Auth: accountant.
- `GET /api/v1/accountant/agents/conversations/:businessId/:refKind/:refId/files` — list attached files. Auth: accountant.
- `POST /api/v1/accountant/agents/conversations/:businessId/:refKind/:refId/files` — multipart attach, field `files`, max 5. Auth: accountant.
- `PATCH /api/v1/accountant/agents/conversations/:businessId/:refKind/:refId` — rename. Auth: accountant.
- `DELETE /api/v1/accountant/agents/conversations/:businessId/:refKind/:refId` — delete. Auth: accountant.

## Knowledge base — `/api/v1/accountant/knowledge`

- `GET /api/v1/accountant/knowledge/:businessId/subject` — active entries for one subject. Params: query `subjectKind`, `subjectId`, `includeInactive`, `limit`. Auth: accountant.
- `GET /api/v1/accountant/knowledge/:businessId/timeline` — version timeline for a subject. Params: query `subjectKind`, `subjectId`, `limit`. Auth: accountant.
- `GET /api/v1/accountant/knowledge/:businessId/search` — search entries. Params: query `q`, `subjectKinds`, `tags`, `limit`. Auth: accountant.
- `GET /api/v1/accountant/knowledge/:businessId/recent` — latest entries. Params: query `limit`. Auth: accountant.
- `POST /api/v1/accountant/knowledge/:businessId` — create an entry (auto-applies). Params: body `{ subjectKind, subjectId, kind, title, body, why, confidence, tags, sourceRefs }`. Auth: accountant.
- `PUT /api/v1/accountant/knowledge/entry/:entryId/supersede` — replace an entry with a new version. Params: body `{ body, title, why, kind, confidence, tags, sourceRefs }`. Auth: accountant.
- `DELETE /api/v1/accountant/knowledge/entry/:entryId` — archive (soft-deactivate) an entry. Auth: accountant.

## Training — `/api/v1/accountant/training` (scoped to the signed-in accountant, no businessId)

- `GET /api/v1/accountant/training` — list modules with progress. Auth: accountant.
- `POST /api/v1/accountant/training/search` — search training content. Params: Joi-validated body. Auth: accountant.
- `GET /api/v1/accountant/training/assessment/meta` — assessment metadata. Auth: accountant.
- `GET /api/v1/accountant/training/assessment/latest` — latest assessment attempt. Auth: accountant.
- `POST /api/v1/accountant/training/assessment/start` — start an assessment. Auth: accountant.
- `POST /api/v1/accountant/training/assessment/answer` — answer one question. Auth: accountant.
- `POST /api/v1/accountant/training/assessment/complete` — complete and score. Auth: accountant.
- `DELETE /api/v1/accountant/training/assessment` — reset the assessment. Auth: accountant.
- `GET /api/v1/accountant/training/plan` — personalized learning plan. Auth: accountant.
- `POST /api/v1/accountant/training/plan/regenerate` — regenerate the plan. Auth: accountant.
- `GET /api/v1/accountant/training/team-readiness` — firm-wide readiness. Auth: accountant + firm owner.
- `GET /api/v1/accountant/training/:slug` — one module by slug. Auth: accountant.
- `POST /api/v1/accountant/training/:slug/progress` — record progress. Auth: accountant.
- `DELETE /api/v1/accountant/training/:slug/progress` — reset progress. Auth: accountant.
- `POST /api/v1/accountant/training/:slug/quiz` — submit quiz answers. Auth: accountant.
- `POST /api/v1/accountant/training/:slug/ask` — ask the AI tutor. Auth: accountant.

## Gotchas

- `POST /agent/callAgent/:businessId` is async: it takes a per-business lock and returns a jobId; poll `/agent/callAgent/getStatus/:businessId` for the outcome. A second start while running returns 400 "Categorization is already in progress".
- `PATCH /agent/callTransactionsAgent/:businessId` takes its ids under body key `transactions`, and `?preview=true` makes it a dry run.
- Approving a proposed agent action is what actually executes the write — treat approve/approve-all as destructive and get the person's go-ahead.
- Marketplace uploads are multipart with field name `files`, max 5 files, 20MB each, no video; transaction-sheet upload (`/workflows/:businessId/transaction-files`) is JSON, not multipart.
- `:refKind` on conversations routes is the ID space ('conversation'/'chat'/'task'), not what the UI displays — a chat thread that spawned a task is still addressed as its conversationId.
- Onboarding document delete has two shapes; use the query-string form (`?key=`) — the path form breaks on proxies that reject %2F.
- Conversations `limit` is capped server-side; page with `before` (date cursor).
- Knowledge entries are never edited in place: `supersede` creates a new version; `DELETE` archives, it does not hard-delete.
- Training fixed paths (`/assessment/*`, `/plan`, `/team-readiness`) shadow the `/:slug` catch-alls, not the other way round.


## Appendix — exact parameters, extracted from the controllers

Machine-extracted from the product's controller source (every `req.query` /
`req.body` key the handler actually reads). This is the authority on filter
parameter NAMES — a name not listed here is silently ignored by that route.
Meanings and formats live in the entries above; when in doubt, pass exactly
these names and verify the returned date span and row count.

- `GET /api/v1/accountant/agent/callAgent/history/:businessId` — no query/body params read
- `GET /api/v1/accountant/agent/callAgent/getStatus/:businessId` — no query/body params read
- `GET /api/v1/accountant/agent/callAgent/scopePreview/:businessId` — query: `accountIds`, `endDate`, `startDate`
- `POST /api/v1/accountant/agent/callAgent/cancel/:businessId` — no query/body params read
- `POST /api/v1/accountant/agent/callAgent/:businessId` — no query/body params read
- `PATCH /api/v1/accountant/agent/callTransactionsAgent/:businessId` — query: `preview` · body: `transactions`
- `GET /api/v1/accountant/ai-skills/business/:businessId` — no query/body params read
- `POST /api/v1/accountant/ai-skills` — no query/body params read
- `PUT /api/v1/accountant/ai-skills/:id` — no query/body params read
- `DELETE /api/v1/accountant/ai-skills/:id` — no query/body params read
- `GET /api/v1/accountant/categorizationRules/business/:businessId` — no query/body params read
- `POST /api/v1/accountant/categorizationRules` — no query/body params read
- `PUT /api/v1/accountant/categorizationRules/:id` — no query/body params read
- `DELETE /api/v1/accountant/categorizationRules/:id` — no query/body params read
- `POST /api/v1/accountant/categorizationRules/business/:businessId/reorder` — body: `rules`
- `POST /api/v1/accountant/categorizationRules/business/:businessId/test` — body: `rule`, `transaction`
- `GET /api/v1/accountant/guardrails/business/:businessId` — no query/body params read
- `POST /api/v1/accountant/guardrails` — no query/body params read
- `PUT /api/v1/accountant/guardrails/:id` — no query/body params read
- `GET /api/v1/accountant/guardrails/:id` — no query/body params read
- `DELETE /api/v1/accountant/guardrails/:id` — no query/body params read
- `POST /api/v1/accountant/guardrails/business/:businessId/defaults` — no query/body params read
- `GET /api/v1/accountant/agents/tasks/stream/:businessId` — no query/body params read
- `POST /api/v1/accountant/agents/scheduled/_fire/:scheduleId` — no query/body params read
- `POST /api/v1/accountant/agents/clarifications/_timeout-sweep` — no query/body params read
- `GET /api/v1/accountant/agents/catalog` — no query/body params read
- `GET /api/v1/accountant/agents/catalog/:agentId` — no query/body params read
- `GET /api/v1/accountant/agents/catalog/:agentId/profile` — no query/body params read
- `GET /api/v1/accountant/agents/interview/:agentId/status` — query: `businessId`
- `POST /api/v1/accountant/agents/interview/:agentId` — body: `messages`
- `GET /api/v1/accountant/agents/roster/:businessId` — no query/body params read
- `POST /api/v1/accountant/agents/roster/:businessId/hire` — body: `agentId`
- `DELETE /api/v1/accountant/agents/roster/:businessId/agents/:agentId` — no query/body params read
- `PATCH /api/v1/accountant/agents/roster/:businessId/agents/:agentId` — body: `config`, `enabled`
- `POST /api/v1/accountant/agents/tasks/:businessId` — body: `attachments`, `conversationId`, `description`, `source`, `targetAgentId`, `title`
- `GET /api/v1/accountant/agents/tasks/:businessId` — query: `limit`, `status`
- `GET /api/v1/accountant/agents/tasks/by-id/:taskId` — no query/body params read
- `POST /api/v1/accountant/agents/tasks/by-id/:taskId/actions/:actionId/approve` — no query/body params read
- `POST /api/v1/accountant/agents/tasks/by-id/:taskId/actions/:actionId/reject` — no query/body params read
- `POST /api/v1/accountant/agents/tasks/by-id/:taskId/approve-all` — no query/body params read
- `POST /api/v1/accountant/agents/tasks/by-id/:taskId/reject-all` — no query/body params read
- `POST /api/v1/accountant/agents/tasks/by-id/:taskId/reply` — body: `content`
- `DELETE /api/v1/accountant/agents/tasks/by-id/:taskId` — no query/body params read
- `PATCH /api/v1/accountant/agents/tasks/by-id/:taskId` — body: `title`
- `POST /api/v1/accountant/agents/tasks/by-id/:taskId/clarifications/:requestId/answer` — body: `answer`, `selectedOptionIndex`
- `POST /api/v1/accountant/agents/tasks/by-id/:taskId/steps/:stepId/retry` — body: `statementFileIds`, `userInstruction`
- `POST /api/v1/accountant/agents/workflows/:businessId/statement-files` — no query/body params read
- `POST /api/v1/accountant/agents/workflows/:businessId/transaction-files` — body: `files`
- `GET /api/v1/accountant/agents/onboarding/:businessId/:agentId` — no query/body params read
- `PATCH /api/v1/accountant/agents/onboarding/:businessId/:agentId/notes` — body: `entityNotes`
- `POST /api/v1/accountant/agents/onboarding/:businessId/:agentId/documents` — no query/body params read
- `DELETE /api/v1/accountant/agents/onboarding/:businessId/:agentId/documents` — query: `key`
- `DELETE /api/v1/accountant/agents/onboarding/:businessId/:agentId/documents/:key` — query: `key`
- `POST /api/v1/accountant/agents/onboarding/:businessId/:agentId/skills` — body: `instructions`, `scope`, `title`
- `PATCH /api/v1/accountant/agents/onboarding/:businessId/:agentId/skills/:skillId` — body: `instructions`, `scope`, `title`
- `DELETE /api/v1/accountant/agents/onboarding/:businessId/:agentId/skills/:skillId` — no query/body params read
- `GET /api/v1/accountant/agents/scheduled/:businessId` — no query/body params read
- `POST /api/v1/accountant/agents/scheduled/:businessId` — body: `agentId`, `attachments`, `cronExpression`, `enabled`, `prompt`, `timezone`, `title`
- `PATCH /api/v1/accountant/agents/scheduled/:businessId/:scheduleId` — no query/body params read
- `DELETE /api/v1/accountant/agents/scheduled/:businessId/:scheduleId` — no query/body params read
- `GET /api/v1/accountant/agents/chat/:businessId` — query: `conversationId`, `create`
- `POST /api/v1/accountant/agents/chat/:businessId` — body: `attachments`, `content`, `conversationId`
- `DELETE /api/v1/accountant/agents/chat/:businessId` — query: `conversationId`
- `GET /api/v1/accountant/agents/chat/:businessId/threads` — no query/body params read
- `POST /api/v1/accountant/agents/chat/:businessId/threads` — no query/body params read
- `DELETE /api/v1/accountant/agents/chat/:businessId/threads/:conversationId` — no query/body params read
- `PATCH /api/v1/accountant/agents/chat/:businessId/threads/:conversationId` — body: `title`
- `POST /api/v1/accountant/agents/chat/:businessId/upload` — no query/body params read
- `GET /api/v1/accountant/agents/conversations/:businessId` — query: `before`, `filter`, `limit`
- `GET /api/v1/accountant/agents/conversations/:businessId/:refKind/:refId` — no query/body params read
- `POST /api/v1/accountant/agents/conversations/:businessId/:refKind/:refId/messages` — body: `targetAgentId`
- `POST /api/v1/accountant/agents/conversations/:businessId/:refKind/:refId/pin` — no query/body params read
- `GET /api/v1/accountant/agents/conversations/:businessId/:refKind/:refId/files` — no query/body params read
- `POST /api/v1/accountant/agents/conversations/:businessId/:refKind/:refId/files` — no query/body params read
- `PATCH /api/v1/accountant/agents/conversations/:businessId/:refKind/:refId` — no query/body params read
- `DELETE /api/v1/accountant/agents/conversations/:businessId/:refKind/:refId` — no query/body params read
- `GET /api/v1/accountant/knowledge/:businessId/subject` — query: `includeInactive`, `limit`, `subjectId`, `subjectKind`
- `GET /api/v1/accountant/knowledge/:businessId/timeline` — query: `limit`, `subjectId`, `subjectKind`
- `GET /api/v1/accountant/knowledge/:businessId/search` — query: `limit`, `q`, `subjectKinds`, `tags`
- `GET /api/v1/accountant/knowledge/:businessId/recent` — query: `limit`
- `POST /api/v1/accountant/knowledge/:businessId` — body: `body`, `confidence`, `kind`, `sourceRefs`, `subjectId`, `subjectKind`, `tags`, `title`, `why`
- `PUT /api/v1/accountant/knowledge/entry/:entryId/supersede` — body: `body`, `confidence`, `kind`, `sourceRefs`, `tags`, `title`, `why`
- `DELETE /api/v1/accountant/knowledge/entry/:entryId` — no query/body params read
- `GET /api/v1/accountant/training` — no query/body params read
- `POST /api/v1/accountant/training/search` — no query/body params read
- `GET /api/v1/accountant/training/assessment/meta` — no query/body params read
- `GET /api/v1/accountant/training/assessment/latest` — no query/body params read
- `POST /api/v1/accountant/training/assessment/start` — no query/body params read
- `POST /api/v1/accountant/training/assessment/answer` — no query/body params read
- `POST /api/v1/accountant/training/assessment/complete` — no query/body params read
- `DELETE /api/v1/accountant/training/assessment` — no query/body params read
- `GET /api/v1/accountant/training/plan` — no query/body params read
- `POST /api/v1/accountant/training/plan/regenerate` — no query/body params read
- `GET /api/v1/accountant/training/team-readiness` — no query/body params read
- `GET /api/v1/accountant/training/:slug` — no query/body params read
- `POST /api/v1/accountant/training/:slug/progress` — no query/body params read
- `DELETE /api/v1/accountant/training/:slug/progress` — no query/body params read
- `POST /api/v1/accountant/training/:slug/quiz` — no query/body params read
- `POST /api/v1/accountant/training/:slug/ask` — no query/body params read
