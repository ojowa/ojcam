# Mobile CI Artifacts — Run via CI

Ojowacam's Android mobile app is built and executed entirely through GitHub Actions CI artifacts. No mobile build artifacts are produced or validated locally unless you choose to.

## CI flow

1. **`android-build`** (`ubuntu-latest`)
   - Builds the debug APK (`assembleDebug`) and, when release signing secrets are configured, the release APK and AAB.
   - Uploads artifacts:
     - `ojowacam-android-apk` → `apps/mobile/android/build/outputs/apk/debug/app-debug.apk`
     - `ojowacam-android-apk-release` → `.../release/app-release.apk`
     - `ojowacam-android-aab` → `.../release/app-release.aab`

2. **`mobile-run`** (`ubuntu-latest`, needs `android-build`)
   - Downloads the `ojowacam-android-apk` debug APK artifact produced by `android-build`.
   - Starts a headless Android emulator (Pixel 6, API 34, google_apis x86_64).
   - Installs the artifact APK with `adb install -r -g`.
   - Launches `com.ojowacam.mobile/com.ojowacam.mobile.MainActivity`.
   - Verifies the app process (`pidof com.ojowacam.mobile`) is running.
   - On success or failure, captures logcat and uploads it as artifact `ojowacam-mobile-run-logs` (`mobile-run-logcat.txt`).

The job uses `continue-on-error: true`, matching the other build jobs, so an emulator or device issue never blocks the workflow or a release.

## Required GitHub secrets

Only needed for release APK/AAB signing (debug build needs none):

| Secret | Source |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | Base64 of `apps/mobile/android/ojowacam-upload-keystore.jks` |
| `ANDROID_KEYSTORE_PASSWORD` | Keystore password |
| `ANDROID_KEY_PASSWORD` | Upload key password |

See `apps/mobile/android/RELEASE_SETUP.md` for keystore generation.

## Local reproduction

Build the debug APK and run it on an emulator or connected device:

```powershell
cd apps/mobile/android
# with ANDROID_SDK_ROOT set
gradle assembleDebug
adb install -r -g build/outputs/apk/debug/app-debug.apk
adb shell am start -n com.ojowacam.mobile/com.ojowacam.mobile.MainActivity -a android.intent.action.MAIN -c android.intent.category.LAUNCHER
```

Debug APK output: `apps/mobile/android/build/outputs/apk/debug/app-debug.apk`