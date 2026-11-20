# The product's API, by domain — read this first

1,072 routes, twelve domains, one catalog file each. Pick the one or two your
request needs and read them before calling anything; every path in them was
copied from the product's code, mount prefix included. Do not guess endpoints.

| Domain | Routes | When to reach for it |
| --- | --- | --- |
| [transactions](transactions.md) | 159 | Transaction rows, journal entries, chart of accounts, statement extraction/import, invoices, bills, credits, contracts, Stripe/Square/HubSpot/Ramp/Salesforce/QBO integrations. |
| [accounts-banking](accounts-banking.md) | 47 | Bank accounts (manual and Plaid-linked), institution linking/repair, Plaid sync, the knowledge-base readme/wiki surfaces. |
| [business](business.md) | 19 | Business-user auth/onboarding, accountant linking, firm-owner invites, GL compliance AI. Most of it needs a business-user token — see its Gotchas. |
| [team-access](team-access.md) | 75 | Accountant auth/MFA, firm team and invites, roles/permissions/teams, client invites with CoA seeding, setup checklists. |
| [financials](financials.md) | 123 | Trial balances and financial statements, flux analysis, budgets, proforma tax reports, multi-currency, consolidation. |
| [reports-analytics](reports-analytics.md) | 150 | Aging, variance, as-of and realtime reports, report packages with footnotes/PDFs, presentation mappings, CFO analytics, the dashboard. |
| [workpapers-close](workpapers-close.md) | 210 | Bank recons, fixed assets, prepaids, accruals, debt, leases, revenue recognition, close checklists, the close-workflow engine, period locks, schedules. |
| [ai-agents](ai-agents.md) | 99 | The categorization agent, its rules and guardrails, the agent marketplace (hiring, tasks, chat, schedules), knowledge base, training. |
| [entities](entities.md) | 28 | Customers, vendors (W-9s, AP approval config), products, custom fields, the Command Center dashboard. |
| [billing-approvals](billing-approvals.md) | 60 | Billable-expense rebilling, invoice settings, approval settings/chains/steps, delegation rules, escalation paths, task workflows. |
| [tax-payroll](tax-payroll.md) | 66 | Sales-tax jurisdictions and filings, tax-software export, Form 941, payroll-to-GL posting, integration CoA mappings and connections. |
| [documents-misc](documents-misc.md) | 36 | Document vault, receipt upload with AI extraction, presigned downloads, preferences, audit logs, API-client management. |

## Cross-cutting facts

- Almost everything is under `accountantProtect` — the Bearer JWT your tools
  mint automatically. Routes marked **business** or **machine** in a catalog
  need a different identity and will 401 on yours; say what you found rather
  than retrying.
- Several heavy READS travel as `PATCH` with filters in the body — the V2
  transaction search above all. The catalogs flag each one.
- Destructive bulk endpoints demand a server-computed confirmation phrase
  (`"delete N transactions"`); always run the preview first and take N from
  its response.
- Long operations (statement extraction, report/package generation, flux,
  categorization runs) return a job id immediately — poll the paired status
  route until done; the catalogs name each pair.
- Paginated list routes cap page size (1000 on V2 search, 200 on bulk-delete
  preview, 100 on invoice/bill lists); walk pages rather than asking big.
- **Every catalog ends with an appendix of machine-extracted parameter
  names** — the exact `req.query`/`req.body` keys each controller reads.
  That appendix is the authority on names; the prose entries carry meanings.
- **Date parameter names are not uniform.** Reports use `startDate`/`endDate`;
  the invoice and bill lists use `start`/`end`; the V2 transaction search
  takes `{date: {start, end}}` in the body. An unrecognized filter name is
  ignored silently — you get the whole history back and no error — so read
  the route's own entry before assuming, and sanity-check the row count and
  date span of what comes back against what you asked for.
