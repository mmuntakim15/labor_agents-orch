#!/usr/bin/env node
// Stand-in for Chrome's --print-to-pdf in tests: writes a file that starts like a PDF.
const a = process.argv.find((x) => x.startsWith('--print-to-pdf='));
if (a) require('fs').writeFileSync(a.slice('--print-to-pdf='.length), '%PDF-1.4\n% test stand-in\n');
