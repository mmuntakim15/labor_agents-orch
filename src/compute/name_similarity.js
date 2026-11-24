'use strict';
// name_similarity — possible duplicate vendors/customers by normalised name (Jaro-Winkler + token Jaccard), TIN and email domain.
const Tb = require('./_table');

const F = {
  id: ['id', '_id', 'vendorid', 'customerid', 'code', 'number'],
  name: ['name', 'vendorname', 'customername', 'displayname', 'companyname', 'legalname', 'vendor', 'customer'],
  tin: ['tin', 'taxid', 'ein', 'ssn', 'taxidentificationnumber', 'vat', 'vatnumber'],
  email: ['email', 'emailaddress', 'contactemail', 'billingemail'],
  address: ['address', 'address1', 'street', 'addressline1', 'billingaddress'],
};
const SUFFIXES = ['llc', 'l l c', 'inc', 'incorporated', 'ltd', 'limited', 'corp', 'corporation', 'co', 'company', 'plc', 'llp', 'lp', 'pllc', 'pc', 'pa', 'gmbh', 'sa', 'bv', 'pty', 'dba'];
const FREE_MAIL = new Set(['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com', 'aol.com', 'live.com', 'me.com', 'msn.com', 'protonmail.com', 'ymail.com', 'comcast.net']);

function normaliseName(s) {
  let t = String(s ?? '').toLowerCase().replace(/&/g, ' and ').replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  t = t.replace(/^the\s+/, '');
  let changed = true;
  while (changed) { changed = false; for (const suf of SUFFIXES) { const re = new RegExp(`\\s${suf.replace(/ /g, '\\s')}$`); if (re.test(t)) { t = t.replace(re, '').trim(); changed = true; } } }
  return t.replace(/\s+/g, ' ');
}
function normaliseTin(s) { const d = String(s ?? '').replace(/[^0-9a-z]/gi, '').toUpperCase(); return d.length >= 4 ? d : ''; }
function domain(email) { const m = /@([^@\s>]+)/.exec(String(email ?? '').toLowerCase()); return m ? m[1] : ''; }
function normaliseAddress(s) { return String(s ?? '').toLowerCase().replace(/\b(street|st|avenue|ave|road|rd|suite|ste|drive|dr|boulevard|blvd|unit|apt|#)\b\.?/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim(); }

function jaro(a, b) {
  if (a === b) return 1;
  const la = a.length; const lb = b.length; if (!la || !lb) return 0;
  const win = Math.max(0, Math.floor(Math.max(la, lb) / 2) - 1);
  const ma = new Array(la).fill(false); const mb = new Array(lb).fill(false); let m = 0;
  for (let i = 0; i < la; i += 1) { const lo = Math.max(0, i - win); const hi = Math.min(lb - 1, i + win); for (let j = lo; j <= hi; j += 1) if (!mb[j] && a[i] === b[j]) { ma[i] = true; mb[j] = true; m += 1; break; } }
  if (!m) return 0;
  let t = 0; let k = 0;
  for (let i = 0; i < la; i += 1) if (ma[i]) { while (!mb[k]) k += 1; if (a[i] !== b[k]) t += 1; k += 1; }
  t /= 2;
  return (m / la + m / lb + (m - t) / m) / 3;
}
function jaroWinkler(a, b) { const j = jaro(a, b); let p = 0; while (p < 4 && p < a.length && p < b.length && a[p] === b[p]) p += 1; return j + p * 0.1 * (1 - j); }
// tokens lose a plural 's' (widgets/widget) so a singular/plural pair is not punished twice
const tokens = (s) => new Set(s.split(' ').filter(Boolean).map((t) => (t.length > 3 && /s$/.test(t) && !/ss$/.test(t) ? t.slice(0, -1) : t)));
function jaccard(a, b) { const A = tokens(a); const B = tokens(b); if (!A.size && !B.size) return 1; let inter = 0; for (const x of A) if (B.has(x)) inter += 1; return inter / (A.size + B.size - inter); }
function score(a, b) { return Math.round((0.6 * jaroWinkler(a, b) + 0.4 * jaccard(a, b)) * 10000) / 10000; }

module.exports = {
  name: 'name_similarity',
  describe: 'Finds likely duplicate vendors or customers. Names are normalised (case, punctuation, "&" → "and", legal suffixes LLC/Inc/Ltd/Corp/Co/… dropped) and scored with a 60/40 blend of Jaro-Winkler and token Jaccard; a shared TIN is conclusive, a shared non-free email domain or address is supporting evidence. Pairs whose TINs are both present and differ are dropped when requireSameTinIfPresent (default). Pure.',
  inputs: [{ name: 'master', shape: 'rows or json array of vendors/customers: id, name, tin|taxId|ein?, email?, address?' }],
  args: { threshold: 0.85, requireSameTinIfPresent: true, maxPairs: 500 },
  output: "{ pairs: [{ a: { id, name }, b: { id, name }, score, why: ['same TIN' | 'name 0.91' | 'same email domain' | 'same address'], suggested: 'merge candidate' | 'review' }], scanned, comparisons, excludedDifferentTin }",
  run({ files, args = {} }) {
    const threshold = Number(args.threshold ?? 0.85);
    const requireTin = args.requireSameTinIfPresent !== false;
    const recs = Tb.records(files[0]).map((r, i) => ({
      id: Tb.str(Tb.field(r, F.id)) || `row ${i + 2}`, name: Tb.str(Tb.field(r, F.name)),
      tin: normaliseTin(Tb.field(r, F.tin)), domain: domain(Tb.field(r, F.email)), address: normaliseAddress(Tb.field(r, F.address)),
    })).filter((r) => r.name).map((r) => ({ ...r, norm: normaliseName(r.name) })).sort(Tb.by((r) => r.id, (r) => r.name));
    const pairs = []; let excludedDifferentTin = 0; let comparisons = 0;
    for (let i = 0; i < recs.length; i += 1) for (let j = i + 1; j < recs.length; j += 1) {
      const a = recs[i]; const b = recs[j]; comparisons += 1;
      const why = []; const s = score(a.norm, b.norm);
      const sameTin = a.tin && b.tin && a.tin === b.tin;
      if (a.tin && b.tin && !sameTin && requireTin) { if (s >= threshold) excludedDifferentTin += 1; continue; }
      if (sameTin) why.push('same TIN');
      if (s >= threshold) why.push(`name ${s.toFixed(2)}`);
      if (!why.length) continue;
      const sameDomain = a.domain && b.domain && a.domain === b.domain && !FREE_MAIL.has(a.domain);
      if (sameDomain) why.push('same email domain');
      const sameAddress = a.address && b.address && a.address === b.address;
      if (sameAddress) why.push('same address');
      const suggested = sameTin || (s >= threshold && (sameDomain || sameAddress || s >= 0.95)) ? 'merge candidate' : 'review';
      pairs.push({ a: { id: a.id, name: a.name }, b: { id: b.id, name: b.name }, score: sameTin ? 1 : s, nameScore: s, why, suggested });
    }
    pairs.sort(Tb.by((p) => -p.score, (p) => p.a.id, (p) => p.b.id));
    const max = Number(args.maxPairs || 500);
    return { pairs: pairs.slice(0, max), pairCount: pairs.length, scanned: recs.length, comparisons, excludedDifferentTin, threshold };
  },
  _internals: { normaliseName, jaroWinkler, jaccard, score },
};
