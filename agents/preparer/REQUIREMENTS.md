# Preparer — requirements

| Id | Requirement | Verified by |
|---|---|---|
| PP-01 | Every attachment was read with files.js or the Read tool and summarised in work.md | transcript; eval `preparer-w9` mustMention each file name |
| PP-02 | Existing records were listed before any create was proposed | receipts show the list route before `propose` |
| PP-03 | Each proposal's summary names the attachment row it came from | proposals.json summaries; Verifier |
| PP-04 | Proposal bodies use the parameter names the map lists for the route | map `show`; Applier succeeds on QA |
| PP-05 | No write route is called during execution | guard; receipts show no refused writes |
| PP-06 | Tie-out lists every row from both sides in matched / only-attachment / only-Dime | Verifier; `row_count` evaluator |
