'use strict';
// HTML → PDF through the Chrome on this machine (no npm dependency). Used by the
// export tool for pdf deliverables and by the dashboard to hand a markdown
// deliverable or the summary to the requester as a PDF.
const fs = require('fs');
const path = require('path');
const { execFile, execFileSync } = require('child_process');

const chrome = () => process.env.LAB_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const available = () => fs.existsSync(chrome());
const args = (target, tmp) => ['--headless', '--disable-gpu', '--no-pdf-header-footer', `--print-to-pdf=${target}`, `file://${tmp}`];
const stage = (html, target) => { const tmp = path.join(path.dirname(target), `.${path.basename(target)}.html`); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(tmp, html); return tmp; };
const isPdf = (f) => { try { const fd = fs.openSync(f, 'r'); const b = Buffer.alloc(4); fs.readSync(fd, b, 0, 4, 0); fs.closeSync(fd); return b.toString() === '%PDF'; } catch { return false; } };
const finish = (tmp, target) => { try { fs.unlinkSync(tmp); } catch { /* already gone */ } if (!isPdf(target)) throw new Error('pdf rendering produced no file'); return target; };

function toPdfSync(html, target) {
  if (!available()) throw new Error(`no Chrome at ${chrome()} for pdf`);
  const tmp = stage(html, target);
  try { execFileSync(chrome(), args(target, tmp), { stdio: 'ignore', timeout: 120000 }); } catch { /* judged on the file below */ }
  return finish(tmp, target);
}
function toPdf(html, target) {
  return new Promise((resolve, reject) => {
    if (!available()) return reject(new Error(`no Chrome at ${chrome()} for pdf`));
    const tmp = stage(html, target);
    execFile(chrome(), args(target, tmp), { timeout: 120000 }, () => { try { resolve(finish(tmp, target)); } catch (e) { reject(e); } });
  });
}

module.exports = { toPdf, toPdfSync, available, isPdf };
