/* Release build settings for the Android app.
 * Written into android/app/ by scripts/patch-android.js (apply line at the end of app/build.gradle),
 * so regenerating the project with "npx cap add android" does not lose them.
 *
 *  - arm64-v8a only. The Node runtime carries one ~48 MB libnode per architecture; shipping
 *    arm64 + armeabi-v7a + x86_64 turned a 55 MB app into 150 MB. Every phone that runs Android 24+
 *    in practice is arm64.
 *  - Signing key: read from android/keystore.properties (kept out of git, together with the .jks).
 *    Without that file the release APK stays unsigned, which is what a plain debug build wants. */

android {
    buildTypes {
        release {
            ndk {
                abiFilters 'arm64-v8a'
            }
        }
    }
}

def keystoreProperties = file('../keystore.properties')
if (keystoreProperties.exists()) {
    def props = new Properties()
    keystoreProperties.withInputStream { props.load(it) }
    android {
        signingConfigs {
            release {
                storeFile file(props['storeFile'])
                storePassword props['storePassword']
                keyAlias props['keyAlias']
                keyPassword props['keyPassword']
            }
        }
        buildTypes {
            release {
                signingConfig signingConfigs.release
            }
        }
    }
}
