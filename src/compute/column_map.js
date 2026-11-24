'use strict';
// column_map — map the header row of a CSV/XLSX register to a canonical
// schema by header text (exact → normalised → synonym → token containment),
// never by position. Ambiguity on a required column is refused. Pure.
const F = require('./_fields');

const SCHEMAS = {
  payroll_gross_to_net: {
    required: ['employee', 'payDate', 'grossWages', 'netPay'],
    synonyms: {
      employee: ['employee', 'employee name', 'name', 'worker', 'team member', 'staff', 'emp name', 'employee id'],
      payDate: ['pay date', 'check date', 'payment date', 'paid on', 'date paid', 'payday'],
      payPeriodStart: ['pay period start', 'period start', 'period begin', 'pay period begin', 'start date', 'period from'],
      payPeriodEnd: ['pay period end', 'period end', 'end date', 'period to', 'pay period ending'],
      grossWages: ['gross wages', 'gross pay', 'gross', 'total gross', 'gross earnings', 'earnings', 'total earnings'],
      employeeTaxes: ['employee taxes', 'ee taxes', 'employee tax', 'taxes withheld', 'tax withholding', 'withholding', 'employee withholding', 'total employee taxes'],
      employee401k: ['401k', '401(k)', 'employee 401k', '401k employee', 'retirement deduction', 'ee 401k', '403b', 'simple ira employee'],
      healthDeduction: ['health', 'health deduction', 'medical', 'health insurance', 'medical deduction', 'benefits deduction', 'health premium'],
      otherDeductions: ['other deductions', 'deductions', 'misc deductions', 'post tax deductions', 'garnishments', 'other'],
      netPay: ['net pay', 'net', 'take home', 'net amount', 'net wages', 'check amount', 'total net pay'],
      employerTaxes: ['employer taxes', 'er taxes', 'company taxes', 'employer tax', 'payroll taxes employer', 'employer payroll taxes', 'company tax'],
      employerMatch: ['employer match', 'er match', 'company match', '401k match', 'employer contribution', 'company contribution', 'er 401k'],
      providerFee: ['provider fee', 'payroll fee', 'service fee', 'processing fee', 'gusto fee', 'adp fee', 'fee'],
    },
  },
  card_export: {
    required: ['date', 'merchant', 'amount'],
    synonyms: {
      date: ['date', 'transaction date', 'posted date', 'post date', 'txn date', 'trans date'],
      merchant: ['merchant', 'merchant name', 'vendor', 'payee', 'description', 'name', 'supplier'],
      amount: ['amount', 'total', 'transaction amount', 'charge', 'amount usd', 'value'],
      category: ['category', 'mcc', 'expense category', 'gl account', 'account', 'type'],
      cardholder: ['cardholder', 'card holder', 'employee', 'user', 'card member', 'cardholder name', 'owner'],
      memo: ['memo', 'note', 'notes', 'comment', 'comments', 'receipt memo', 'business purpose'],
    },
  },
  legacy_tb: {
    required: ['accountName', 'debit+credit|balance'],
    synonyms: {
      accountCode: ['account code', 'account number', 'account no', 'acct no', 'acct', 'code', 'number', 'gl code', 'account id', 'acct #', 'account #'],
      accountName: ['account name', 'account', 'description', 'name', 'acct name', 'gl account', 'account description', 'title'],
      debit: ['debit', 'dr', 'debits', 'debit balance', 'debit amount'],
      credit: ['credit', 'cr', 'credits', 'credit balance', 'credit amount'],
      balance: ['balance', 'ending balance', 'net', 'amount', 'closing balance', 'net balance', 'ytd balance', 'end balance'],
    },
  },
  bank_statement: {
    required: ['date', 'description', 'amount|debit+credit'],
    synonyms: {
      date: ['date', 'posting date', 'posted date', 'transaction date', 'post date', 'value date', 'trans date'],
      description: ['description', 'memo', 'details', 'payee', 'narrative', 'transaction', 'transaction description', 'name'],
      amount: ['amount', 'transaction amount', 'value', 'net'],
      debit: ['debit', 'withdrawal', 'withdrawals', 'money out', 'paid out', 'debits', 'dr', 'outflow'],
      credit: ['credit', 'deposit', 'deposits', 'money in', 'paid in', 'credits', 'cr', 'inflow'],
      balance: ['balance', 'running balance', 'ending balance', 'closing balance', 'available balance'],
    },
  },
  custom: { required: [], synonyms: {} },
};

const canonTokens = (c) => String(c).replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const tokens = (s) => canonTokens(s).split(' ').filter(Boolean);

/** Candidate header indexes for one canonical, by stage. Returns { how, candidates:[idx] } for the first stage with a hit. */
function matchCanonical(canonical, syns, headers) {
  const stages = [
    ['exact', (h) => h === canonical],
    ['normalised', (h) => F.normKey(h) === F.normKey(canonical) || F.normKey(h) === F.normKey(canonTokens(canonical))],
    ['synonym', (h) => syns.some((s) => F.normKey(s) === F.normKey(h))],
    ['tokens', (h) => { const ht = tokens(h); if (!ht.length) return false; return syns.some((s) => { const st = tokens(s); return st.length && (st.every((t) => ht.includes(t)) || (ht.length > 1 && ht.every((t) => st.includes(t)))); }); }],
  ];
  for (const [how, pred] of stages) {
    const c = []; headers.forEach((h, i) => { if (h && pred(h)) c.push(i); });
    if (c.length) return { how, candidates: c };
  }
  return { how: null, candidates: [] };
}

/** 'a|b+c' → [['a'], ['b','c']]: alternatives of conjunctions. */
const parseRequired = (r) => String(r).split('|').map((alt) => alt.split('+').map((s) => s.trim()).filter(Boolean));

module.exports = {
  name: 'column_map',
  describe: 'Maps the header row of a CSV/XLSX register to canonical column names for a schema (payroll_gross_to_net | card_export | legacy_tb | bank_statement | custom) by header text only: exact, then normalised, then synonym, then token containment. Refuses when a required canonical matches more than one header.',
  inputs: [{ name: 'register', shape: 'CSV or XLSX (first sheet) whose first non-empty row is the header; or a JSON array of row objects (keys are the headers). A {headers:[...], rows:[...]} JSON object also works.' }],
  args: { schema: "'payroll_gross_to_net' | 'card_export' | 'legacy_tb' | 'bank_statement' | 'custom'", required: "optional override, e.g. ['date','description','amount|debit+credit'] ('|' = either, '+' = both)", synonyms: 'optional {canonical: [header words]}; a canonical given here replaces its built-in synonym list (pin one header to resolve an ambiguity); custom: the whole table', headerRow: 'optional 1-based header row index when the header is not the first non-empty row' },
  output: '{ schema, mapping:{canonical:{header, column, how}}, ambiguous:[{canonical, candidates:[{header, column}]}], missing:[canonical], unmapped:[header], headers:[...], rowCount }',
  run({ files, args = {} }) {
    const schema = String(args.schema || 'custom'); const base = SCHEMAS[schema]; if (!base) throw new Error(`unknown schema ${schema} (${Object.keys(SCHEMAS).sort().join(' | ')})`);
    // a canonical listed in args.synonyms REPLACES the built-in list for that canonical (so one header can be pinned); others keep the built-ins
    const syns = { ...base.synonyms }; for (const [k, v] of Object.entries(args.synonyms || {})) syns[k] = (Array.isArray(v) ? v : [v]).map(String);
    const required = (Array.isArray(args.required) ? args.required : base.required).map(parseRequired);
    if (schema === 'custom' && !Object.keys(syns).length) throw new Error('schema custom needs args.synonyms {canonical: [header words]}');
    // headers and row count
    let headers; let rowCount;
    const f = files[0];
    if (f.rows || f.sheets) {
      const all = (f.rows || []).filter((r) => Array.isArray(r) && r.some((c) => F.str(c) !== ''));
      const hi = args.headerRow ? Math.max(0, Number(args.headerRow) - 1) : 0;
      if (!all[hi]) throw new Error('register has no header row');
      headers = all[hi].map((h) => F.str(h)); rowCount = all.length - hi - 1;
    } else if (f.json && !Array.isArray(f.json) && Array.isArray(f.json.headers)) { headers = f.json.headers.map((h) => F.str(h)); rowCount = Array.isArray(f.json.rows) ? f.json.rows.length : 0; }
    else { const rows = F.rowsFrom(f); if (!rows.length) throw new Error('register is empty: no header row to map'); const seen = new Set(); headers = []; for (const r of rows) for (const k of Object.keys(r)) if (!seen.has(k)) { seen.add(k); headers.push(k); } rowCount = rows.length; }
    const mapping = {}; const ambiguous = []; const used = new Set();
    for (const canonical of Object.keys(syns).sort()) {
      const { how, candidates } = matchCanonical(canonical, syns[canonical], headers);
      if (!candidates.length) continue;
      if (candidates.length > 1) { ambiguous.push({ canonical, candidates: candidates.map((i) => ({ header: headers[i], column: i })), how }); continue; }
      mapping[canonical] = { header: headers[candidates[0]], column: candidates[0], how }; used.add(candidates[0]);
    }
    const have = (c) => Boolean(mapping[c]);
    const missing = []; const ambiguousRequired = [];
    for (const alts of required) {
      if (alts.some((conj) => conj.every(have))) continue;
      const amb = alts.flat().filter((c) => ambiguous.some((a) => a.canonical === c));
      if (amb.length) ambiguousRequired.push(...amb); else missing.push(alts.map((c) => c.join('+')).join('|'));
    }
    if (ambiguousRequired.length) {
      const detail = [...new Set(ambiguousRequired)].sort().map((c) => { const a = ambiguous.find((x) => x.canonical === c); return `${c} → ${a.candidates.map((k) => `"${k.header}" (col ${k.column})`).join(' | ')}`; }).join('; ');
      throw new Error(`ambiguous required column(s) for schema ${schema}: ${detail}. Pass args.synonyms to pin one header per canonical.`);
    }
    const unmapped = headers.filter((h, i) => h && !used.has(i) && !ambiguous.some((a) => a.candidates.some((k) => k.column === i)));
    return { schema, mapping, ambiguous, missing: missing.sort(), unmapped, headers, rowCount };
  },
  SCHEMAS,
};
