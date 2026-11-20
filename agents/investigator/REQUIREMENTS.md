# Investigator — requirements

| Id | Requirement | Verified by |
|---|---|---|
| IV-01 | Both sides of the comparison are saved under data/ with receipts | receipts.jsonl ≥ 2 ok calls; `receipts_min` evaluator |
| IV-02 | Every exception row carries an identifier and an amount from a saved response | Verifier reproduces; eval `investigator-ramp` mustMention "id" |
| IV-03 | The cutoff date and its source are stated in work.md | eval mustMention "cutoff" |
| IV-04 | Integration questions read the connection status and event log routes before concluding | receipts show the event-log route; eval |
| IV-05 | "Could not determine" is used instead of inference | eval `investigator-missing-route` mustMention "could not determine" |
| IV-06 | No sync or write is triggered | guard; receipts show no refused writes |
