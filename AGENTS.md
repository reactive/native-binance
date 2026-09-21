This is an Expo/React Native mobile application. Prioritize mobile-first patterns, performance, and cross-platform compatibility.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v58.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need; never answer from memory.

## Commands

This project uses Yarn 4. Still install Expo packages with `npx expo install`, which selects SDK-compatible versions and the repo package manager.

```bash
npx expo install <package>
npx expo start
yarn typecheck
npx expo-doctor
npx expo install --fix
npx eas-cli@latest <command>
```

Load `EXPO_TOKEN` from `.env.local` for local EAS commands. Never print the token. Cloud agents receive it as a Cursor Runtime Secret, not from this file.

## This project

- SDK 58 beta, React Native 0.88 RC, React 19.3.
- UI is `@reactive/silk-native`, vendored in `vendor/` until Silk is published. Refresh with `yarn vendor:silk` from a sibling `../silk` checkout.
- Data is Reactive Data Client. Skills live in `.agents/skills/`.
- Do not generate `ios/` or `android/` by hand.

## Checks

Routine validation is `yarn test` and `yarn web`. Jest runs the order book through Data Client with fixtures. Web checks the rendered UI. The `eas-simulator` skill is not a default.

## When to run Maestro

Maestro on EAS (`.maestro/book.yml`, `.eas/workflows/e2e-test-android.yml`) is slow and quota-limited. Do not run it for ordinary changes.

Run it only when the user asks, or when the change can be wrong on Android while still passing Jest and web:

- A native module, config plugin, or `app.json` native setting
- Navigation, gestures, keyboard, safe area, or status bar
- Silk Native layout that depends on React Native measurement rather than CSS

Skip it for data-client schemas, copy, and styling already covered by Jest or web.

## Navigation & Routing

- Use **Expo Router**. Routes live in `src/app/`. Keep non-route code outside `src/app/`.
- Docs: https://docs.expo.dev/router/introduction.md

## Building with EAS

Docs: https://docs.expo.dev/eas/index.md

## Rules

- Expo Go only includes its bundled native modules. After adding a library with native code, use a development build.
- Prefer recommended Expo modules over third-party libraries, and check installed skills before adding dependencies.
