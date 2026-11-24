# Payroll registers and other restricted reports

Payroll reports (gross-to-net, funding, deduction exports, registers) carry
employee pay. A recipe marked `restrictedData` runs at L3: proposals wait for
a person and the deliverable carries totals only.

## Reading the report
- Map columns by header with `compute.js column_map`, never by position; providers reorder and rename columns between runs. Save the mapping to `data/<name>-columns.json` so the `column_headers_mapped` check can read it. An ambiguous or missing required column is an exception, not a guess.
- Separate the pay period (work dates) from the pay date. The pay calendar setup answer says the lag; the register says the dates. Never infer either from today's date.
- Take totals from the report's own totals row and quote them; recompute a total only to show it agrees.

## What leaves the report
- Deliverables and summaries carry totals by account, department or contribution type. No employee name, pay, deduction, SSN or address appears in any sheet, proposal summary or work.md excerpt. Where a row must be identified, use the employee id the report carries.
- The journal entry is built from mapped totals: debits for wages, employer taxes and benefits by department; credits for each withholding payable, benefits payable and the cash or clearing credit. The cash or clearing credit must equal the funding report total; write `cashCredit`, `fundingTotal` and `cashCreditLessFunding` to `data/payroll-entry.json` and list any difference as an exception.
- A payroll line with no row in the approved mapping workbook is an exception; never pick an account for it.

## Updating a workbook in place
When the deliverable is an existing workbook (an accrual workbook, a schedule), use `compute.js xlsx_update_in_place`: it keeps every existing sheet, row and formula and writes `<name> (updated).xlsx`. Never rebuild the workbook from scratch and never delete a row. A time entry with hours but no dollars is flagged, never allocated an amount.
