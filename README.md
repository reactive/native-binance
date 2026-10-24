# Binance Book

Personal Expo app for a Binance spot order book. Expo SDK 58, React Native 0.88, React 19.3.

Store builds of Expo Go do not include SDK 58 yet. Use a development build.

```bash
yarn start
```

Scan the QR code with Expo Go on Android, or press `a` if an emulator is running.

## Libraries

- [Reactive Data Client](https://dataclient.io) for the Binance REST snapshot (`/api/v3/depth`).
- [`@reactive/silk-native`](https://github.com/reactive/silk) for UI. Silk is not on npm yet; packed tarballs live in `vendor/`. Refresh them from a sibling `../silk` checkout with `yarn vendor:silk`.

## End-to-end tests

`yarn test` and `yarn web` are the routine checks. Maestro (`.maestro/book.yml`) runs on demand against an Android APK when a native module, navigation, gesture, or React Native layout needs a device: `eas workflow:run .eas/workflows/e2e-test-android.yml`.
