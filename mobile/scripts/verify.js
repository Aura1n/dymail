'use strict';

/* One-shot verification of the mobile code on a desktop machine.
 *   node mobile/scripts/verify.js
 * Runs: real syntax checks of every file, relative-import resolution, and the offline tests (update logic,
 * new-mail decisions, Android patch, core smoke test).
 * Writes the full result to mobile/tmp/verify-report.txt so it can be shared as-is. Needs Node 18+.
 * It does not need Android Studio and does not compile the Java; the bundle and the app are built by
 * the steps in BUILD-ANDROID.md. */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const lines = [];
let failures = 0;

function log(text = '') {
  lines.push(text);
  console.log(text);
}
function result(ok, name, detail) {
  if (!ok) failures += 1;
  log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n        ${String(detail).split('\n').slice(0, 12).join('\n        ')}` : ''}`);
}
function node(args, options = {}) {
  return spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 90000, ...options });
}
function listJs(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : listJs(full);
    return entry.name.endsWith('.js') ? [full] : [];
  });
}

log(`Dymail mobile verification — ${new Date().toISOString()}`);
log(`node ${process.version} on ${process.platform} ${os.arch()}`);
const major = Number(process.versions.node.split('.')[0]);
result(major >= 18, 'Node 18 or newer (core needs global fetch)', `found ${process.version}`);
log();

/* 1. syntax: the page and the glue are ES modules, so check them as .mjs copies */
log('-- syntax');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dymail-syntax-'));
for (const dir of ['www', 'glue']) {
  for (const file of listJs(path.join(root, dir))) {
    const copy = path.join(tmp, `${path.relative(root, file).replace(/[\\/]/g, '__')}.mjs`);
    fs.copyFileSync(file, copy);
    const run = node(['--check', copy]);
    result(run.status === 0, path.relative(root, file), run.stderr && run.stderr.replace(copy, file));
  }
}
for (const dir of ['core', 'scripts', 'nodejs']) {
  for (const file of listJs(path.join(root, dir))) {
    const run = node(['--check', file]);
    result(run.status === 0, path.relative(root, file), run.stderr);
  }
}
log();

/* 2. every relative import in the page must point at a file that exists */
log('-- imports');
let checked = 0;
for (const file of listJs(path.join(root, 'www'))) {
  const text = fs.readFileSync(file, 'utf8');
  for (const match of text.matchAll(/(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
    checked += 1;
    const target = path.resolve(path.dirname(file), match[1]);
    if (!fs.existsSync(target)) result(false, `${path.relative(root, file)} imports ${match[1]}`, 'file not found');
  }
}
result(true, `${checked} relative imports resolve`);

/* 3. the Java templates the patch step copies in must all be there */
for (const name of ['MainActivity.java.tpl', 'DymailBackgroundPlugin.java.tpl', 'MailSyncService.java.tpl']) {
  result(fs.existsSync(path.join(root, 'native', name)), `native/${name} present`);
}
log();

/* 4. behaviour */
for (const script of ['test-update.js', 'test-notifier.js', 'test-patch-android.js', 'smoke.js']) {
  log(`-- ${script}`);
  const run = node([path.join(__dirname, script)], { cwd: path.join(root, '..') });
  const out = `${run.stdout || ''}${run.stderr || ''}`.trim();
  result(run.status === 0, script, run.status === 0 ? '' : out.slice(-1800) || (run.error && run.error.message));
  if (run.status === 0) out.split('\n').forEach((l) => log(`        ${l}`));
  log();
}

log(failures ? `${failures} check(s) FAILED` : 'ALL CHECKS PASSED');
try {
  fs.mkdirSync(path.join(root, 'tmp'), { recursive: true });
  fs.writeFileSync(path.join(root, 'tmp', 'verify-report.txt'), lines.join('\n'));
  console.log('\nreport saved to mobile/tmp/verify-report.txt');
} catch (err) {
  console.log(`\n(could not save the report: ${err.message})`);
}
process.exit(failures ? 1 : 0);
