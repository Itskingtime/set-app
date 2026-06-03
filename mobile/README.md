# SaySet — Android app (Expo + WebView)

A thin React Native (Expo) shell that runs the SaySet web app (https://sayset.fit)
as a native Android app. Builds in the cloud with **EAS Build** — no Android Studio needed.

## One-time setup
1. Install **Node.js LTS** from https://nodejs.org (restart your terminal after).
2. Create a free **Expo account** at https://expo.dev.
3. In a terminal:
   ```
   cd mobile
   npm install
   npx expo install --fix        # aligns native package versions
   npm install -g eas-cli
   eas login
   ```

## Build an installable APK (for testing on your phone)
```
eas build -p android --profile preview
```
When it finishes, EAS gives you a URL + QR code — open it on your Android phone to
download and install the `.apk`. Test voice logging (grant the mic permission prompt).

## Build the Play Store bundle (.aab) and submit
```
eas build -p android --profile production
eas submit -p android --latest      # needs a Google Play Console account ($25 one-time)
```

## Notes
- The app loads https://sayset.fit live, so any web update ships instantly — no rebuild.
- **Login:** use **email/password** in the app. Google sign-in is hidden here because
  Google blocks OAuth inside embedded WebViews (this is a platform rule, not a bug).
- **Push reminders** come from the web push service, which doesn't fire inside a plain
  WebView — wiring native notifications (expo-notifications + FCM) is a future step.
- App id: `fit.sayset.app` · icon/splash live in `./assets`.
