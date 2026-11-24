'use strict';
// The endpoint-map scanner reads chained declarations (router.route('/x').put(...).post(...)) as well as
// router.put('/x', ...): Dime's bill/invoice apply-payment and remove-payment routes are written that way.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const M = require('../src/map');

test('map scan: chained router.route(...).verb(...) declarations become endpoints', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-map-chained-'));
  fs.mkdirSync(path.join(root, 'routes'), { recursive: true });
  fs.mkdirSync(path.join(root, 'controllers'), { recursive: true });
  fs.writeFileSync(path.join(root, 'app.js'), "const express = require('express'); const app = express();\napp.use('/api/v1/transactions', require('./routes/transaction'));\n");
  fs.writeFileSync(path.join(root, 'routes/transaction.js'), [
    "const express = require('express'); const router = express.Router();",
    "const { applyBillPayment, removeBillPayment, listBills } = require('../controllers/bills');",
    "router.get('/bills/:businessId', accountantProtect, listBills);",
    'router',
    "  .route('/accounting/bookkeeping/businessId/:businessId/bill/:billId/apply-payment')",
    "  .put(accountantProtect, rolePermProtect('bills_write'), applyBillPayment);",
    'router',
    "  .route('/accounting/bookkeeping/businessId/:businessId/bill/:billId/remove-payment')",
    "  .put(accountantProtect, rolePermProtect('bills_write'), removeBillPayment)",
    "  .post(accountantProtect, removeBillPayment);",
    'module.exports = router;',
  ].join('\n'));
  fs.writeFileSync(path.join(root, 'controllers/bills.js'), "exports.listBills = async (req, res) => { const { businessId } = req.params; res.json({}); };\nexports.applyBillPayment = async (req, res) => { const { transactionId, amount } = req.body; res.json({}); };\nexports.removeBillPayment = async (req, res) => { res.json({}); };\n");
  const eps = M.scanCheckout(root).endpoints;
  const find = (method, suffix) => eps.find((e) => e.method === method && e.path.endsWith(suffix));
  const apply = find('PUT', '/bill/:billId/apply-payment');
  assert.ok(apply, 'PUT apply-payment should be in the map');
  assert.equal(apply.handler, 'applyBillPayment');
  assert.ok(apply.middleware.includes('accountantProtect'));
  assert.ok(find('PUT', '/bill/:billId/remove-payment'), 'PUT remove-payment should be in the map');
  assert.ok(find('POST', '/bill/:billId/remove-payment'), 'a second verb on the same chain should be in the map');
  assert.ok(find('GET', '/bills/:businessId'), 'plain router.get declarations still scan');
});
