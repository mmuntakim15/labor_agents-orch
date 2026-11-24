# Cash application (receipts to open invoices)

## The rule
A receipt is applied to an invoice only when something names the invoice: the remittance advice, the payout report line, or a payer and amount that match exactly one open invoice. A receipt that fits nothing is listed as unapplied, never parked on a customer account or a suspense account.

## Finding the sides
- Receipts: the bank feed's unmatched inflows for the day (and payout reports from Stripe or a marketplace, which net fees; apply the gross invoice amount and list the fee as its own line).
- Open invoices: the invoice list for the business filtered to open and partially paid, by customer, with balance due and due date.
- Remittances: `compute remittance_parse` over the pdf, csv or email text gives invoice numbers, amounts and the payer name per line; read its output before matching.

## Tiers
- Tier A: one receipt, one invoice, amount equal within the matching tolerance from setup, payer or remittance names the invoice or the customer has exactly one open invoice of that amount.
- Tier B: one receipt covering several invoices (the remittance lists them and the sum agrees) or a partial payment on one invoice; the approver confirms the split.
- Tier C (a question, no payload): a short payment that would need a write-off or a credit memo, a receipt with no candidate, a payer name that matches two customers.

## Proposal body
The apply-payment route on the invoice takes the amount, the date (the bank date, not today), the deposit account and a reference. Read its parameters with `map.js show` before building the body. Summary like "Apply 4,250.00 received 2026-11-19 to INV-1042 (Acme Supply), remittance line 3". One proposal per invoice; a receipt split over invoices is several proposals that together equal the receipt.

## Workbook
Exceptions: unapplied receipts, short pays, ambiguous payers, each with the bank transaction id and the invoice id or remittance line. Tie-out: receipts total = applied + unapplied. Detail: every receipt with its match, tier and proposal id. Sources: receipts and files read.
