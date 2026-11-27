'use strict';

/* Runs patch-android.js against a throw-away copy of the project Capacitor generates, twice.
 *   node mobile/scripts/test-patch-android.js
 * It checks the manifest edits, the generated Java files and that a second run changes nothing. It does not
 * compile the Java: that happens when you build in Android Studio. */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const patch = path.join(__dirname, 'patch-android.js');
let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`  FAIL ${name} — ${err.message}`);
  }
}

/* What `npx cap add android` writes (Capacitor's template), reduced to what matters here. */
const MANIFEST = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">

    <application
        android:allowBackup="true"
        android:icon="@mipmap/ic_launcher"
        android:label="@string/app_name"
        android:roundIcon="@mipmap/ic_launcher_round"
        android:supportsRtl="true"
        android:theme="@style/AppTheme">

        <activity
            android:configChanges="orientation|keyboardHidden|keyboard|screenSize|locale|smallestScreenSize|screenLayout|uiMode|navigation|density"
            android:name=".MainActivity"
            android:label="@string/title_activity_main"
            android:theme="@style/AppTheme.NoActionBarLaunch"
            android:launchMode="singleTask"
            android:exported="true">

            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>

        </activity>

        <provider
            android:name="androidx.core.content.FileProvider"
            android:authorities="\${applicationId}.fileprovider"
            android:exported="false"
            android:grantUriPermissions="true">
            <meta-data
                android:name="android.support.FILE_PROVIDER_PATHS"
                android:resource="@xml/file_paths"></meta-data>
        </provider>
    </application>

    <!-- Permissions -->

    <uses-permission android:name="android.permission.INTERNET" />
</manifest>
`;

const ACTIVITY = `package com.dymail.mobile;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {}
`;

/* The parts of app/build.gradle the patch touches. */
const APP_GRADLE = `apply plugin: 'com.android.application'

android {
    namespace = "com.dymail.mobile"
    compileSdk = rootProject.ext.compileSdkVersion
    defaultConfig {
        applicationId "com.dymail.mobile"
        minSdkVersion rootProject.ext.minSdkVersion
        targetSdkVersion rootProject.ext.targetSdkVersion
        versionCode 1
        versionName "1.0"
    }
    buildTypes {
        release {
            minifyEnabled false
        }
    }
}
`;

function makeProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dymail-android-'));
  const main = path.join(root, 'app', 'src', 'main');
  fs.mkdirSync(path.join(main, 'java', 'com', 'dymail', 'mobile'), { recursive: true });
  fs.writeFileSync(path.join(main, 'AndroidManifest.xml'), MANIFEST);
  fs.writeFileSync(path.join(main, 'java', 'com', 'dymail', 'mobile', 'MainActivity.java'), ACTIVITY);
  fs.writeFileSync(path.join(root, 'app', 'build.gradle'), APP_GRADLE);
  return {
    root,
    main,
    java: path.join(main, 'java', 'com', 'dymail', 'mobile'),
    manifest: path.join(main, 'AndroidManifest.xml'),
    gradle: path.join(root, 'app', 'build.gradle')
  };
}

function run(project) {
  return spawnSync(process.execPath, [patch], { encoding: 'utf8', env: { ...process.env, DYMAIL_ANDROID_DIR: project.root } });
}

const count = (text, needle) => text.split(needle).length - 1;

const project = makeProject();
const first = run(project);
const manifestAfterFirst = fs.existsSync(project.manifest) ? fs.readFileSync(project.manifest, 'utf8') : '';

test('the first run succeeds', () => assert.equal(first.status, 0, `${first.stdout}${first.stderr}`));

test('manifest: permissions are present exactly once', () => {
  for (const name of [
    'android.permission.INTERNET',
    'android.permission.FOREGROUND_SERVICE',
    'android.permission.FOREGROUND_SERVICE_SPECIAL_USE',
    'android.permission.POST_NOTIFICATIONS',
    'android.permission.WAKE_LOCK',
    'android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS'
  ]) {
    assert.equal(count(manifestAfterFirst, `android:name="${name}"`), 1, name);
  }
});

test('manifest: foreground service of type specialUse with its declared purpose', () => {
  assert.equal(count(manifestAfterFirst, 'com.dymail.mobile.MailSyncService'), 1);
  assert.match(manifestAfterFirst, /android:foregroundServiceType="specialUse"/);
  assert.match(manifestAfterFirst, /PROPERTY_SPECIAL_USE_FGS_SUBTYPE/);
  assert.match(manifestAfterFirst, /android:exported="false"[\s\S]*specialUse/);
});

test('manifest: the service sits inside <application>', () => {
  const service = manifestAfterFirst.indexOf('MailSyncService');
  assert.ok(service > manifestAfterFirst.indexOf('<application'));
  assert.ok(service < manifestAfterFirst.indexOf('</application>'));
});

test('manifest: loopback cleartext allowed, backup off, still well-formed', () => {
  assert.match(manifestAfterFirst, /android:networkSecurityConfig="@xml\/network_security_config"/);
  assert.match(manifestAfterFirst, /android:allowBackup="false"/);
  assert.ok(!/android:allowBackup="true"/.test(manifestAfterFirst));
  assert.equal(count(manifestAfterFirst, '<application'), 1);
  assert.equal(count(manifestAfterFirst, '</application>'), 1);
  assert.equal(count(manifestAfterFirst, '<manifest'), 1);
  assert.equal(count(manifestAfterFirst, '</manifest>'), 1);
  assert.equal(count(manifestAfterFirst, '<service'), count(manifestAfterFirst, '</service>'));
});

test('the network security config allows 127.0.0.1 and nothing else', () => {
  const xml = fs.readFileSync(path.join(project.main, 'res', 'xml', 'network_security_config.xml'), 'utf8');
  assert.match(xml, /cleartextTrafficPermitted="true"/);
  assert.match(xml, />127\.0\.0\.1</);
  assert.ok(!/base-config/.test(xml), 'must not relax the default for other hosts');
});

test('Java: sources are written into the app package with the placeholder filled in', () => {
  for (const name of ['DymailBackgroundPlugin.java', 'MailSyncService.java', 'MainActivity.java']) {
    const content = fs.readFileSync(path.join(project.java, name), 'utf8');
    assert.match(content, /^package com\.dymail\.mobile;/m, name);
    assert.ok(!content.includes('__PACKAGE__'), `${name} still has the placeholder`);
  }
});

test('Java: MainActivity registers the plugin before super.onCreate', () => {
  const content = fs
    .readFileSync(path.join(project.java, 'MainActivity.java'), 'utf8')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const register = content.indexOf('registerPlugin(DymailBackgroundPlugin.class)');
  const sup = content.indexOf('super.onCreate(savedInstanceState)');
  assert.ok(register > 0 && sup > register, 'registerPlugin must come first');
});

test('Java: braces are balanced in every generated file', () => {
  for (const name of ['DymailBackgroundPlugin.java', 'MailSyncService.java', 'MainActivity.java']) {
    const content = fs.readFileSync(path.join(project.java, name), 'utf8').replace(/"(?:[^"\\\n]|\\.)*"/g, '""').replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const [open, close] of [['{', '}'], ['(', ')']]) {
      assert.equal(count(content, open), count(content, close), `${name}: ${open}${close}`);
    }
  }
});

test('Gradle: versionName follows mobile/version.json', () => {
  const expected = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'version.json'), 'utf8')).version;
  assert.ok(fs.readFileSync(project.gradle, 'utf8').includes(`versionName "${expected}"`), expected);
});

test('Gradle: dymail.gradle is copied in and applied exactly once', () => {
  assert.ok(fs.existsSync(path.join(project.root, 'app', 'dymail.gradle')), 'dymail.gradle missing');
  assert.equal(count(fs.readFileSync(project.gradle, 'utf8'), "apply from: 'dymail.gradle'"), 1);
});

const manifestBefore = manifestAfterFirst;
const javaBefore = fs.readdirSync(project.java).map((f) => [f, fs.readFileSync(path.join(project.java, f), 'utf8')]);
const gradleBefore = fs.readFileSync(project.gradle, 'utf8');
const second = run(project);

test('a second run succeeds and reports nothing to do', () => {
  assert.equal(second.status, 0, `${second.stdout}${second.stderr}`);
  assert.match(second.stdout, /already patched/);
});

test('a second run changes no file', () => {
  assert.equal(fs.readFileSync(project.manifest, 'utf8'), manifestBefore);
  assert.equal(fs.readFileSync(project.gradle, 'utf8'), gradleBefore);
  for (const [file, content] of javaBefore) assert.equal(fs.readFileSync(path.join(project.java, file), 'utf8'), content, file);
});

test('without an android/ folder it explains what to do instead of crashing', () => {
  const missing = spawnSync(process.execPath, [patch], { encoding: 'utf8', env: { ...process.env, DYMAIL_ANDROID_DIR: path.join(os.tmpdir(), 'dymail-no-such-android') } });
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /cap add android/);
});

console.log(failed ? `\n${failed} test(s) failed` : '\nall patch tests passed');
process.exit(failed ? 1 : 0);
