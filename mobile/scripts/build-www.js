'use strict';

/* Builds mobile/dist, the folder Capacitor packages into the app:
 *   dist/            the UI (a copy of www/, with the shared files refreshed first)
 *   dist/glue.js     the one browser bundle: the Capacitor packages the page needs (see glue/glue.js)
 *   dist/nodejs/     the Node.js project: the headless core and the unchanged desktop main process,
 *                    bundled into one file together with imapflow, mailparser and nodemailer.
 *
 * Bundling (esbuild) rather than shipping node_modules: Android's asset packer silently drops
 * directories whose names start with "_", which some npm packages have, and one file loads much
 * faster than thousands on a phone. Two build-time substitutions make that work:
 *   - `electron` is aliased to core/electron-shim.js, so main.js needs no runtime patching;
 *   - DYMAIL_BUNDLED is defined as "1", which selects the static require paths in core/index.js.
 * `bridge` stays external: the runtime provides it.
 *
 *   node mobile/scripts/build-www.js            */

const fs = require('node:fs');
const path = require('node:path');

const mobile = path.join(__dirname, '..');
const dist = path.join(mobile, 'dist');

function fail(message) {
  console.error(`\nbuild failed: ${message}`);
  process.exit(1);
}

let esbuild;
try {
  esbuild = require('esbuild');
} catch {
  fail('esbuild is not installed. Run "npm install" inside the mobile folder first (see BUILD-ANDROID.md).');
}

/* Needs the desktop dependencies at the repo root (they are bundled from there). */
for (const name of ['imapflow', 'mailparser', 'nodemailer']) {
  if (!fs.existsSync(path.join(mobile, '..', 'node_modules', name))) {
    fail(`"${name}" not found in ${path.join(mobile, '..', 'node_modules')}. Run "npm install" in the project root first.`);
  }
}

/* The page's glue imports these two packages. They are installed once at the repo root
 * (see BUILD-ANDROID.md, step 1), so resolve them the way Node does: up from here. */
for (const name of ['@capacitor/core', 'capacitor-nodejs']) {
  let found = null;
  try {
    found = require.resolve(`${name}/package.json`);
  } catch {
    found = null;
  }
  if (!found) {
    fail(`"${name}" is not installed (looked in ${mobile} and ${path.join(mobile, '..')}). Run the install commands in BUILD-ANDROID.md, step 1.`);
  }
}

require('./sync-shared.js');

fs.rmSync(dist, { recursive: true, force: true });
fs.cpSync(path.join(mobile, 'www'), dist, { recursive: true });

/* ---- the page's glue (browser) ---- */
esbuild.buildSync({
  entryPoints: [path.join(mobile, 'glue', 'glue.js')],
  outfile: path.join(dist, 'glue.js'),
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'chrome90',
  legalComments: 'none',
  logLevel: 'warning'
});
const glue = fs.readFileSync(path.join(dist, 'glue.js'), 'utf8');
if (!glue.includes('DymailBackground') || !glue.includes('__dymail')) fail('dist/glue.js does not look right (the plugin hand-over is missing).');

/* ---- the Node.js project (core) ---- */
const result = esbuild.buildSync({
  entryPoints: [path.join(mobile, 'nodejs', 'entry.js')],
  outfile: path.join(dist, 'nodejs', 'index.js'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  external: ['bridge'],
  alias: { electron: path.join(mobile, 'core', 'electron-shim.js') },
  define: { 'process.env.DYMAIL_BUNDLED': '"1"' },
  legalComments: 'none',
  logLevel: 'warning',
  metafile: true
});

const bytes = fs.statSync(path.join(dist, 'nodejs', 'index.js')).size;
const inputs = Object.keys(result.metafile.inputs);
const mustHave = ['src/main/main.js', 'src/main/mail.js', 'src/main/store.js', 'src/main/filters.js', 'core/index.js', 'core/electron-shim.js', 'core/notifier.js'];
const missing = mustHave.filter((name) => !inputs.some((input) => input.replace(/\\/g, '/').endsWith(name)));
if (missing.length) fail(`bundle is missing: ${missing.join(', ')}`);
if (inputs.some((input) => /node_modules[\\/]electron[\\/]/.test(input))) fail('the real electron package was bundled — the alias did not apply');

console.log(`dist ready: ${path.relative(process.cwd(), dist) || dist}`);
console.log(`  ui files      ${fs.readdirSync(dist).filter((f) => f !== 'nodejs').length} entries (incl. glue.js, ${(Buffer.byteLength(glue) / 1024).toFixed(0)} KB)`);
console.log(`  nodejs bundle ${(bytes / 1048576).toFixed(2)} MB from ${inputs.length} source files`);
