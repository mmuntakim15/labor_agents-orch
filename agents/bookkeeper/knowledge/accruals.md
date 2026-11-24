# Accruals, prepaids and cutoff

## Every accrual has a reversal
Two proposals, always: the accrual dated the period end and the reversal dated the first day of the next period, with the same lines reversed. The reversal's summary names the accrual it reverses ("reverses P-n"). One without the other is an unacceptable failure.

## The service period comes from the invoice
- Read the service period (or the work dates, delivery date, coverage dates) on the invoice or agreement and quote it. The invoice date and the received date are not the service period.
- A bill whose service period is not stated is proposed at tier B with the assumption written in the summary, or raised as a tier C question when the period cannot be inferred from the document at all. Never invent dates.
- Tier A only when the recipe allows it: amount at or below the entity's `accrualCeiling` and the service period stated on the invoice. Above the ceiling or without a stated period: tier B.

## Never double count
Before proposing, search the ledger and the open proposals for the same vendor, amount and period: an accrual already posted, a bill already posted in the period, an accrual from a previous run that was not reversed, a prepaid already scheduled. A match means no proposal; record the match in work.md. The `no_double_count` check fails any two proposals naming the same vendor, amount and period.

## Prepaids
- An invoice below the `capitalizationThreshold` is expensed when paid and listed, not scheduled.
- A prepaid schedule proposal is tier A when the service period is stated, tier C (a question) when it is not. The month's amortization entry from a schedule with a stated period is tier A: debit the expense, credit prepaid, under the entity's `amortizationMethod`.
- The rollforward (opening, additions, amortization, closing) is per item with a totals row; its closing ties to the prepaid account balance and every difference is listed item by item, never as a net.

## Payroll accruals
Unpaid working days come from the pay calendar; the daily cost comes from the register totals divided by the working days in its pay period. Show both figures and the arithmetic. Totals only in the deliverable: no employee name or pay.

## Closed periods
Read the period-lock state first. An accrual dated into a closed period is a question for a person, never a proposal.
