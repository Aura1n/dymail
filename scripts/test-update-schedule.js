/* Source-contract test: the boot update check must run on every launch and
   re-check periodically; the old 24h throttle hid same-day releases. */
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'app.js'), 'utf8');
const fail = (msg) => {
  console.error('FAIL', msg);
  process.exitCode = 1;
};

const start = src.indexOf('function scheduleUpdateCheck(');
if (start < 0) return fail('scheduleUpdateCheck() missing');
const end = src.indexOf('\nfunction ', start + 10);
const body = src.slice(start, end > start ? end : undefined);

if (/24\s*\*\s*60\s*\*\s*60|updateLastCheck/.test(body)) fail('scheduleUpdateCheck still throttles by updateLastCheck/24h');
if (!body.includes('setInterval')) fail('scheduleUpdateCheck does not set a re-check interval');
if (!body.includes("checkForUpdate({ silent: true })")) fail('scheduleUpdateCheck does not silent-check');

const initStart = src.indexOf('async function init(');
const initEnd = src.indexOf('\nfunction ', initStart + 10);
const initBody = src.slice(initStart, initEnd > initStart ? initEnd : undefined);
const schedAt = initBody.indexOf('scheduleUpdateCheck();');
const loadAt = initBody.indexOf('await loadBaseAccounts();');
if (schedAt < 0) fail('init() does not call scheduleUpdateCheck()');
if (schedAt >= 0 && loadAt >= 0 && schedAt > loadAt) fail('scheduleUpdateCheck() must run before loadBaseAccounts()');

if (!/UPDATE_RECHECK_MS\s*=\s*6\s*\*\s*60\s*\*\s*60\s*\*\s*1000/.test(src)) fail('UPDATE_RECHECK_MS (6h) missing');

console.log(process.exitCode ? 'update-schedule contract: FAILED' : 'update-schedule contract: 6/6 passed');
