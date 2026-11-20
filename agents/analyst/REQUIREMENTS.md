# Analyst — requirements

| Id | Requirement | Verified by |
|---|---|---|
| AN-01 | Every response used for a figure was saved with `--out` and receipted | receipts.jsonl; `figures_in_data` evaluator |
| AN-02 | Report totals tie to Dime's own report for the same entity and period | `ties_to_report` evaluator; Verifier |
| AN-03 | Deliverables open (xlsx parses, pdf has a header, csv has rows) | `export_opens` evaluator |
| AN-04 | No figure is rounded or abbreviated in a table | Verifier reproduces figures to the cent |
| AN-05 | work.md shows the arithmetic for every computed figure with receipt ids | Verifier; eval `analyst-flux` mustMention "R-" |
| AN-06 | No write route is called; `propose` is used only on a writes request | guard forbidden pattern; receipts show no refused writes |
| AN-07 | The check tool was run before finishing | transcript shows `check.js run`; eval maxRefusedCalls 0 |
