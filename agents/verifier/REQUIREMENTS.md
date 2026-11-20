# Verifier — requirements

| Id | Requirement | Verified by |
|---|---|---|
| VF-01 | verify.json has verdict pass|fail and one item per done item | postChecks; test `transition.test.js` |
| VF-02 | A code-failed item cannot be passed (the orchestrator overrides a contradicting pass) | `postChecks` settles with checks.json; test |
| VF-03 | Every headline figure was re-pulled with the Verifier's own receipt | receipts in the verify run; eval `verifier-invented-figure` json.verdict fail |
| VF-04 | The Verifier writes nothing but verify.json and verify.md | guard LAB_WRITE_DENY; test `guard.test.js` |
| VF-05 | The Verifier cannot propose or export | guard forbidden patterns; test |
| VF-06 | A fail lists the failing item ids | transition reason; eval |
