# Binance Book

Personal Expo app for a Binance spot order book. Expo SDK 58 beta, React Native 0.88 RC, React 19.3.

Day-to-day testing uses Expo Go from the SDK 58 CLI (store builds of Expo Go still track the previous SDK until 58 is stable).

```bash
yarn start
```

Scan the QR code with Expo Go on Android, or press `a` if an emulator is running.

## Libraries

- [Reactive Data Client](https://dataclient.io) for the Binance REST snapshot (`/api/v3/depth`).
- [`@reactive/silk-native`](https://github.com/reactive/silk) for UI. Silk is not on npm yet; packed tarballs live in `vendor/`. Refresh them from a sibling `../silk` checkout with `yarn vendor:silk`.

## End-to-end tests

Expo Go is the personal dev client. Pull-request validation should use Maestro against an EAS build (`.apk` / iOS `.app`), not Expo Go. See the Expo guides for [EAS Workflows + Maestro](https://docs.expo.dev/eas/workflows/examples/e2e-tests/) and [Maestro on development builds](https://docs.expo.dev/tutorial/cicd/e2e-tests/).
