# High Tech mobile apps

One Expo codebase builds both store apps (plan section 5):

| Variant | Name | Bundle id | Scheme | Share links |
|---|---|---|---|---|
| `retail` (default) | High Tech | `com.hightech.retail` | `hightech://` | `https://DOMAIN/r/CODE` |
| `wholesale` | High Tech جملة | `com.hightech.wholesale` | `hightech-wholesale://` | `https://DOMAIN/w/CODE` |

Choose the variant with `EXPO_PUBLIC_APP_VARIANT` (or `APP_VARIANT`), and the API with `EXPO_PUBLIC_API_URL` (default `http://localhost:4000`).

```bash
npm install                      # from the repo root
npm run start:retail -w @hightech/mobile
npm run start:wholesale -w @hightech/mobile
npm run typecheck -w @hightech/mobile
```

Start the API with `DEV_OTP=1` during development so the login screen shows the OTP code.

- Arabic, right-to-left, High Tech navy colours. The icon in `assets/icon.png` is a placeholder until the logo arrives.
- Products, wallet, orders, network and the account are cached on the phone (AsyncStorage). The app shows the cached copy immediately and then refreshes it. The server remains the only source of truth.
- The session token is kept in SecureStore (localStorage on web).
- Push notifications register an Expo push token with the server (`PATCH /me`). This only works in a real device build with an EAS project id. It does nothing on web and on simulators.
- `metro.config.js` makes sure only one copy of React is bundled, because the dashboard workspace may hoist a different React patch version to the repo root.
