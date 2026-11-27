'use strict';

/* Builds the signed release APK and puts it where it can be uploaded to a GitHub release.
 *   node mobile/scripts/build-apk.js            (or: cd mobile && npm run apk)
 *
 * It runs `npm run sync` first (page + core bundle + cap sync + patch), then Gradle
 * :app:assembleRelease, then copies android/app/build/outputs/apk/release/app-release.apk
 * to mobile/release/Dymail-Android-<version>.apk and prints its sha256.
 *
 * Needs a JDK 21: JAVA_HOME, or Android Studio's bundled jbr (Studio's path is found below).
 * Signing comes from android/keystore.properties (see BUILD-ANDROID.md); without it the APK is
 * unsigned and this script still names it, but says so. */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const mobile = path.join(__dirname, '..');
const android = path.join(mobile, 'android');
const version = JSON.parse(fs.readFileSync(path.join(mobile, 'version.json'), 'utf8')).version;
const apkSource = path.join(android, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
const releaseDir = path.join(mobile, 'release');
const apkTarget = path.join(releaseDir, `Dymail-Android-${version}.apk`);

const SKIP = process.argv.includes('--skip-sync');

function fail(message) {
  console.error(`\nbuild-apk failed: ${message}`);
  process.exit(1);
}

/* JAVA_HOME, or the JDK that ships inside Android Studio. */
function findJavaHome() {
  if (process.env.JAVA_HOME && fs.existsSync(process.env.JAVA_HOME)) return process.env.JAVA_HOME;
  const candidates = [
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Android Studio', 'jbr'),
    'C:\\Program Files\\Android\\Android Studio\\jbr',
    'D:\\Programs\\Utilities\\android\\jbr',
    'C:\\Program Files\\Java',
  ];
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(path.join(candidate, 'bin', 'java.exe'))) return candidate;
  }
  return '';
}

/* Node refuses to spawn .cmd/.bat directly, so on Windows everything goes through cmd.exe. */
function run(command, args, options = {}) {
  const useShell = process.platform === 'win32';
  const cmd = useShell ? process.env.ComSpec || 'cmd.exe' : command;
  const argv = useShell ? ['/d', '/s', '/c', [command, ...args].map((part) => (/\s/.test(part) ? `"${part}"` : part)).join(' ')] : args;
  const result = spawnSync(cmd, argv, { cwd: mobile, stdio: 'inherit', ...options });
  if (result.error) fail(`${command}: ${result.error.message}`);
  if (result.status !== 0) fail(`${path.basename(command)} ${args.join(' ')} exited with ${result.status}`);
  return result;
}

if (!fs.existsSync(android)) fail('android/ does not exist. Run "npx cap add android" in mobile first (BUILD-ANDROID.md).');

if (!SKIP) {
  console.log('syncing page, core and Android project…\n');
  run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'sync']);
}

const javaHome = findJavaHome();
if (!javaHome) {
  fail('no JDK 21 found. Set JAVA_HOME, or install Android Studio (its jbr folder is used automatically).');
  process.exit(1);
}
console.log(`JDK: ${javaHome}`);

const gradlew = path.join(android, process.platform === 'win32' ? 'gradlew.bat' : './gradlew');
run(gradlew, ['--no-daemon', ':app:assembleRelease'], { cwd: android, env: { ...process.env, JAVA_HOME: javaHome } });

if (!fs.existsSync(apkSource)) fail(`Gradle reported success but ${apkSource} is missing`);

fs.mkdirSync(releaseDir, { recursive: true });
fs.copyFileSync(apkSource, apkTarget);
const bytes = fs.statSync(apkTarget).size;
const sha = crypto.createHash('sha256').update(fs.readFileSync(apkTarget)).digest('hex');

/* 新签名的 APK 不一定有 META-INF/CERT.RSA（v2 起签名块在 zip 之外），认这个块标记即可。 */
const signed = fs.readFileSync(apkTarget).includes('APK Sig Block 42');
console.log(`\nAPK   ${apkTarget}`);
console.log(`size  ${(bytes / 1048576).toFixed(1)} MB`);
console.log(`sha256 ${sha}`);
console.log(signed ? 'signed with the release key' : 'UNSIGNED: android/keystore.properties is missing');
console.log(`\nUpload this file to a GitHub release tagged "android-v${version}".`);
