# Bookkeeper — requirements

| Id | Requirement | Verified by |
|---|---|---|
| BK-01 | Every journal-entry proposal carries an entry file that balances to the cent | `dime.js propose` refuses unbalanced; `proposals_balanced` evaluator |
| BK-02 | Account names and types in an entry are Dime's spelling (from the chart-of-accounts route) | receipts show the CoA route; Verifier |
| BK-03 | Period-lock state is read and stated before any dated proposal | receipts; eval `bookkeeper-closed-period` mustMention "closed" and json.proposals 0 |
| BK-04 | Categorisation changes use the categorisation route, not a journal entry, when rows exist | Verifier; eval `bookkeeper-reclass` |
| BK-05 | Accruals are paired with a reversal proposal | eval `bookkeeper-accrual` mustMention "reversal" |
| BK-06 | Judgment calls are tier C questions, never proposals | proposals.json tiers; eval |
| BK-07 | No write route is called during execution | guard; receipts |
