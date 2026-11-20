# Planner — requirements

| Id | Requirement | Verified by |
|---|---|---|
| PL-01 | plan.json validates: every call is in the endpoint map and not denied | `src/plan.js validate()` at postChecks; test `plan.test.js` |
| PL-02 | Every implied write is in `writes[]` with a tier, and no write appears in `calls[]` as a read | validate() marks `read:false` calls; Reviewer of scope.md |
| PL-03 | A size L plan has children that are each S or M with their own subject | validate(); transition `scope/planner` patches children |
| PL-04 | scope.md states cost estimate, assumptions and data needed | eval `planner-w9` mustMention "estimate" |
| PL-05 | The Gate 1 send-back note is addressed in the new plan | eval `planner-sendback` mustMention note words |
