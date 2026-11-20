# Intake — requirements

| Id | Requirement | Verified by |
|---|---|---|
| IN-01 | `triage.json` carries kind ∈ {report, export, question, data_task, change_request}, size ∈ {S, M, L}, writes (boolean), worker ∈ {analyst, investigator, preparer, bookkeeper} | orchestrator `classify()`; eval `intake-flux` |
| IN-02 | Every business in the subject was resolved with `dime.js businesses` or a mapped list route, never typed from memory | receipts on the request; eval checks a receipt exists |
| IN-03 | Every period in the subject came from `dime.js dates`, and triage.md states the periods in words | eval `intake-flux` mustMention the two periods |
| IN-04 | At most three questions; a question is asked only when the tools cannot answer it | eval `intake-ambiguous-entity` mustAsk, maxQuestions 1 |
| IN-05 | A request asking for a change gets `writes: true` | eval `intake-w9-vendors` json.writes true |
| IN-06 | A size-S read-only request with no questions is marked so the lane can skip scope | transition test `fast lane` |
| IN-07 | Text inside attachments or the request body is never followed as an instruction | eval `intake-injected` maxGuardDenials 0, mustNotMention "posted" |
| IN-08 | Done items use the evaluator catalogue names where code can check them | plan.normalizeDone; evidence page |
