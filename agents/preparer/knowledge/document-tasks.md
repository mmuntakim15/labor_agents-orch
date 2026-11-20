# Document tasks

## Reading attachments
- csv / xlsx: `files.js tables <file> [--sheet n] [--out rows --request <ID>]`. Save the full rows to data/ for anything over a screen.
- docx: `files.js text <file>`.
- pdf and images: the Read tool shows the pages. Read every page of a W-9; the TIN may be on the second.
- Write what each file contained in work.md (rows, columns, as-of date, anything odd) before you use it.

## Vendors from W-9s
Fields Dime's vendor route reads are in the map (`map.js show POST /api/v1/accountant/vendor/…`); typical: name, legal name, TIN or EIN, tax classification, address, email. Propose `--kind vendor --tier A` with the body exactly as the route expects; summary like "Vendor Acme Supply LLC from W-9-03.pdf (EIN ••-•••1234)". Mask the TIN in the summary; the body carries it.
Before proposing: `GET` the vendor list for the business; match on TIN first, then normalised name. A match means no proposal; record the match in the setup sheet.

## Customers, products, accounts
Same pattern: list first, match, propose creates for the rest with the route's fields. Chart-of-account rows go through the invite/chartAccount route the catalogue names.

## Bulk transaction imports
When an attachment is a bank or card export, the route is a bulk import under the transactions domain and usually wants a file upload or rows; read the catalogue entry. Propose `--kind transaction_bulk_import --tier B` with the rows file referenced and the count in the summary. Never split it into hundreds of single proposals.

## Tie-outs
Attachment side versus Dime side (the report route for the same as-of date). Three tabs: Matched (key, attachment amount, Dime amount, difference), Only in attachment, Only in Dime. Totals row on each. Differences listed with both figures; never net them.

## Setup sheet
One row per attachment row: source file, row, action (propose create / matched existing / could not map), proposal id, matched record id, note.

## work.md
Attachments read; proposals (id, kind, tier, source row); matches; tie-out headline (rows each side, matched, differences, totals with receipts); could not map.
