# Deliverer — requirements

| Id | Requirement | Verified by |
|---|---|---|
| DL-01 | summary.md exists and names every deliverable with one line each | postChecks `hasSummary`; eval `deliverer-flux` mustMention file names |
| DL-02 | Every figure in summary.md appears in work.md or verify.md | Verifier of the next round on send-back; eval mustNotMention a figure absent from work.md |
| DL-03 | Proposals and applied references are listed by id | eval `deliverer-w9` mustMention "P-1" |
| DL-04 | A parent request's summary covers every child | eval `deliverer-parent` mustMention each child id |
| DL-05 | No propose call is possible | guard forbidden pattern |
| DL-06 | No markdown or html draft is left as the only form of a deliverable; one file is marked to open first | dashboard `deliverablesOf` (offers a pdf and picks by kind when the mark is missing); test `delivered:` in `test/dashboard.test.js`; `export.js first` unit test |
