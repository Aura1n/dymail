'use strict';

/* Launches the app with one scripts/verify-*.js UI check injected, captures a
   screenshot + JSON dump and exits. Usage: npm run test:ui -- <name>
   Example: npm run test:ui -- demo */

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..');
const name = process.argv[2];

const available = fs
  .readdirSync(__dirname)
  .filter((file) => /^verify-.*\.js$/.test(file))
  .map((file) => file.replace(/^verify-/, '').replace(/\.js$/, ''));

if (!name || !available.includes(name)) {
  console.log('Usage: npm run test:ui -- <name>\n');
  console.log('Available checks:');
  for (const item of available) console.log(`  ${item}`);
  process.exitCode = name ? 1 : 0;
  return;
}

const scriptFile = path.join(__dirname, `verify-${name}.js`);
const outDir = path.join(root, 'tmp', 'ui-check');
const shotPath = path.join(outDir, `${name}.png`);
const dumpPath = path.join(outDir, `${name}.json`);
const userData = path.join(os.tmpdir(), 'dymail-ui-check', name);
const electron = path.join(
  root,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'electron.cmd' : 'electron'
);

fs.mkdirSync(outDir, { recursive: true });
fs.rmSync(shotPath, { force: true });
fs.rmSync(dumpPath, { force: true });
fs.rmSync(userData, { recursive: true, force: true });
fs.mkdirSync(userData, { recursive: true });

const env = {
  ...process.env,
  DYMALL_USERDATA: userData,
  DYMALL_SHOT: shotPath,
  DYMALL_SHOT_DUMP: dumpPath,
  DYMALL_SHOT_SCRIPT: fs.readFileSync(scriptFile, 'utf8'),
  DYMALL_SHOT_BOOT: '1800',
  DYMALL_SHOT_DELAY: '350'
};
if (name.startsWith('real-')) delete env.DYMALL_DEMO;
else env.DYMALL_DEMO = '1';

const result = spawnSync(electron, ['.'], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32' && /\.cmd$/i.test(electron),
  env
});

if (fs.existsSync(dumpPath)) {
  console.log(`\nResult (${dumpPath}):`);
  console.log(fs.readFileSync(dumpPath, 'utf8'));
}
console.log(`Screenshot: ${shotPath}`);

if (result.status !== 0) {
  console.error(`\nUI check failed with exit code ${result.status}`);
  process.exitCode = 1;
}
