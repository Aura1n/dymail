'use strict';

/* Adjusts the Android project that `npx cap add android` generates. Safe to run repeatedly.
 *   node mobile/scripts/patch-android.js
 *
 *  - lets the WebView and the background service reach the core on 127.0.0.1 over plain HTTP
 *    (Android blocks cleartext by default; this allows it for the loopback address only);
 *  - turns off Auto Backup, so the credential store and its key are not copied into cloud backups;
 *  - adds background mail: the permissions, the foreground service, and the plugin the page uses to control it
 *    (sources are the templates in mobile/native, copied in with the app's package name filled in).
 *
 * DYMAIL_ANDROID_DIR points the script at another android/ folder (the tests use this). */

const fs = require('node:fs');
const path = require('node:path');

const mobile = path.join(__dirname, '..');
const androidDir = path.resolve(process.env.DYMAIL_ANDROID_DIR || path.join(mobile, 'android'));
const nativeDir = path.join(mobile, 'native');
const mainDir = path.join(androidDir, 'app', 'src', 'main');
const manifestPath = path.join(mainDir, 'AndroidManifest.xml');

const PERMISSIONS = [
  'android.permission.INTERNET',
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_SPECIAL_USE',
  'android.permission.POST_NOTIFICATIONS',
  'android.permission.WAKE_LOCK',
  'android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS'
];

function fail(message) {
  console.error(`patch failed: ${message}`);
  process.exit(1);
}

if (!fs.existsSync(manifestPath)) fail('android/ not found. Run "npx cap add android" in the mobile folder first.');

function findFile(dir, names) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findFile(full, names);
      if (found) return found;
    } else if (names.includes(entry.name)) {
      return full;
    }
  }
  return null;
}

const javaRoot = path.join(mainDir, 'java');
if (!fs.existsSync(javaRoot)) fail('app/src/main/java not found in the Android project.');
const mainActivity = findFile(javaRoot, ['MainActivity.java', 'MainActivity.kt']);
if (!mainActivity) fail('MainActivity not found in the Android project.');
if (mainActivity.endsWith('.kt')) fail('MainActivity is Kotlin; this script only supports the Java template Capacitor generates.');

const packageMatch = /^\s*package\s+([\w.]+)\s*;/m.exec(fs.readFileSync(mainActivity, 'utf8'));
if (!packageMatch) fail('could not read the package name from MainActivity.java.');
const pkg = packageMatch[1];
const javaDir = path.dirname(mainActivity);

const changes = [];

/* ---- network security config ---- */
const xmlDir = path.join(mainDir, 'res', 'xml');
fs.mkdirSync(xmlDir, { recursive: true });
fs.writeFileSync(
  path.join(xmlDir, 'network_security_config.xml'),
  `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <!-- Dymail's local mail core. Cleartext is allowed for the loopback address only. -->
    <domain-config cleartextTrafficPermitted="true">
        <domain includeSubdomains="false">127.0.0.1</domain>
        <domain includeSubdomains="false">localhost</domain>
    </domain-config>
</network-security-config>
`
);

/* ---- manifest ---- */
let text = fs.readFileSync(manifestPath, 'utf8');
const original = text;

function insertAtLineStart(source, marker, lines) {
  const index = source.indexOf(marker);
  if (index < 0) return null;
  const lineStart = source.lastIndexOf('\n', index) + 1;
  return source.slice(0, lineStart) + lines + source.slice(lineStart);
}

if (!/android:networkSecurityConfig=/.test(text)) {
  text = text.replace(/<application\b/, '<application\n        android:networkSecurityConfig="@xml/network_security_config"');
  changes.push('network security config');
}

if (/android:allowBackup="true"/.test(text)) {
  text = text.replace('android:allowBackup="true"', 'android:allowBackup="false"');
  changes.push('Auto Backup off');
} else if (!/android:allowBackup=/.test(text)) {
  text = text.replace(/<application\b/, '<application\n        android:allowBackup="false"');
  changes.push('Auto Backup off');
}

const missingPermissions = PERMISSIONS.filter((name) => !text.includes(`android:name="${name}"`));
if (missingPermissions.length) {
  const lines = missingPermissions.map((name) => `    <uses-permission android:name="${name}" />\n`).join('');
  const next = insertAtLineStart(text, '<application', lines);
  if (!next) fail('no <application> element in AndroidManifest.xml.');
  text = next;
  changes.push(`${missingPermissions.length} permission(s)`);
}

if (!text.includes(`${pkg}.MailSyncService`)) {
  const service = `        <service
            android:name="${pkg}.MailSyncService"
            android:exported="false"
            android:foregroundServiceType="specialUse">
            <property
                android:name="android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE"
                android:value="Keeps a persistent IMAP connection open so new mail can be announced while the app is closed" />
        </service>

`;
  const next = insertAtLineStart(text, '</application>', service);
  if (!next) fail('no </application> in AndroidManifest.xml.');
  text = next;
  changes.push('background service');
}

if (text !== original) fs.writeFileSync(manifestPath, text);

/* ---- Java sources ---- */
function fill(templateName) {
  const file = path.join(nativeDir, `${templateName}.tpl`);
  if (!fs.existsSync(file)) fail(`template missing: ${file}`);
  return fs.readFileSync(file, 'utf8').replace(/__PACKAGE__/g, pkg);
}

for (const name of ['DymailBackgroundPlugin.java', 'MailSyncService.java']) {
  const target = path.join(javaDir, name);
  const content = fill(name);
  if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== content) {
    fs.writeFileSync(target, content);
    changes.push(name);
  }
}

const activitySource = fs.readFileSync(mainActivity, 'utf8');
if (!activitySource.includes('DymailBackgroundPlugin')) {
  fs.writeFileSync(mainActivity, fill('MainActivity.java'));
  changes.push('MainActivity registers the plugin');
}

/* ---- version, release build settings ---- */
/* mobile/version.json is the one place the phone version is written down: the bundled core reads it,
   and the APK's versionName has to match or the update check compares the wrong numbers. */
const versionFile = path.join(mobile, 'version.json');
let version = '';
if (fs.existsSync(versionFile)) {
  const parsed = JSON.parse(fs.readFileSync(versionFile, 'utf8'));
  version = String(parsed.version || '').trim();
}
const appGradle = path.join(androidDir, 'app', 'build.gradle');
if (!fs.existsSync(appGradle)) fail('app/build.gradle not found in the Android project.');
if (version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) fail(`version.json has an unexpected version: ${version}`);
  const code = version
    .split('.')
    .map(Number)
    .reduce((acc, part, index) => acc + part * [10000, 100, 1][index], 0);
  let gradle = fs.readFileSync(appGradle, 'utf8');
  const next = gradle
    .replace(/versionCode\s+\d+/, `versionCode ${code}`)
    .replace(/versionName\s+"[^"]*"/, `versionName "${version}"`);
  if (next !== gradle) {
    fs.writeFileSync(appGradle, next);
    changes.push(`version ${version} (${code})`);
  }
} else {
  fail('mobile/version.json is missing or has no version.');
}

/* The release build settings (signing key, arm64 only) live in their own file so a regenerated
   android/ only needs one line back. */
const buildExtras = path.join(androidDir, 'app', 'dymail.gradle');
const buildExtrasTemplate = path.join(nativeDir, 'DymailBuild.gradle.tpl');
if (fs.existsSync(buildExtrasTemplate)) {
  const content = fs.readFileSync(buildExtrasTemplate, 'utf8');
  if (!fs.existsSync(buildExtras) || fs.readFileSync(buildExtras, 'utf8') !== content) {
    fs.writeFileSync(buildExtras, content);
    changes.push('release build settings');
  }
  const gradle = fs.readFileSync(appGradle, 'utf8');
  if (!gradle.includes("apply from: 'dymail.gradle'")) {
    fs.writeFileSync(appGradle, `${gradle.replace(/\s*$/, '')}\n\napply from: 'dymail.gradle'\n`);
    changes.push('apply dymail.gradle');
  }
}

/* ---- check the result ---- */
const final = fs.readFileSync(manifestPath, 'utf8');
const problems = [];
if (!/android:networkSecurityConfig="@xml\/network_security_config"/.test(final)) problems.push('network security config missing');
if (!/android:allowBackup="false"/.test(final)) problems.push('allowBackup is not false');
for (const name of PERMISSIONS) if (!final.includes(`android:name="${name}"`)) problems.push(`permission ${name} missing`);
if (!final.includes(`${pkg}.MailSyncService`)) problems.push('service missing');
if (!/foregroundServiceType="specialUse"/.test(final)) problems.push('service type missing');
if (!fs.readFileSync(mainActivity, 'utf8').includes('registerPlugin(DymailBackgroundPlugin.class)')) problems.push('plugin not registered');
for (const name of ['DymailBackgroundPlugin.java', 'MailSyncService.java']) {
  const content = fs.readFileSync(path.join(javaDir, name), 'utf8');
  if (content.includes('__PACKAGE__')) problems.push(`${name} still has the placeholder`);
}
if (version) {
  const gradle = fs.readFileSync(appGradle, 'utf8');
  if (!gradle.includes(`versionName "${version}"`)) problems.push(`versionName is not ${version}`);
}
if (fs.existsSync(buildExtrasTemplate) && !fs.readFileSync(appGradle, 'utf8').includes("apply from: 'dymail.gradle'")) {
  problems.push('dymail.gradle is not applied');
}

console.log(changes.length ? `patched: ${changes.join(', ')}` : 'already patched');
console.log(`package ${pkg}`);
if (problems.length) {
  console.error(`the project does not look as expected after patching:\n  - ${problems.join('\n  - ')}`);
  process.exit(1);
}
