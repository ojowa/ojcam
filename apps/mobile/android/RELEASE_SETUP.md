# Android Release Signing Setup

## 1. Install Java (JDK 17+)
Download and install [Eclipse Temurin JDK 17](https://adoptium.net/) or any OpenJDK 17+. Ensure `keytool` is on your PATH.

## 2. Generate the release keystore
Run this command (in `apps/mobile/android/`):

```powershell
keytool -genkeypair -v -keystore ojowacam-upload-keystore.jks -keyalg RSA -keysize 2048 -validity 10000 -alias upload
```

You will be prompted for:
- Keystore password
- Key password (can be the same)
- Name/organization details

Save these passwords — you will need them for GitHub secrets.

## 3. Replace the placeholder keystore
The file `apps/mobile/android/ojowacam-upload-keystore.jks` currently exists as a 0-byte placeholder. **Replace it with the real keystore you generated in step 2.** It is already in `.gitignore` and will not be committed.

## 4. Add GitHub repository secrets
Go to your repo on GitHub → **Settings > Secrets and variables > Actions** → **New repository secret**. Add:

| Secret name | Value |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | Base64-encoded contents of `ojowacam-upload-keystore.jks` |
| `ANDROID_KEYSTORE_PASSWORD` | The keystore password you chose |
| `ANDROID_KEY_PASSWORD` | The key password you chose |

To base64-encode the keystore locally (PowerShell):

```powershell
[Convert]::ToBase64String([System.IO.File]::ReadAllBytes("apps/mobile/android/ojowacam-upload-keystore.jks"))
```

## 5. Build locally (optional test)
```powershell
cd apps/mobile/android
.\gradlew assembleRelease
```

The release APK will be at:
`apps/mobile/android/build/outputs/apk/release/app-release-unsigned.apk` (or signed if signing config resolves).
