# Capacitor (iOS & Android)

This project uses [Capacitor](https://capacitorjs.com/) as a native shell around the same HTML/JS as the web app. The **Express API is not bundled**; the app is meant to load your **deployed** site (or a dev server on your LAN) so `/api/*`, Cognito, Kroger OAuth, and Stripe behave like the browser.

## One-time / after changing web assets

```bash
npm run cap:sync
```

This runs `build:client`, copies HTML/CSS and `dist/*.js` into `www/`, and syncs into `ios/` and `android/`. The `www/` folder is gitignored.

## Point the WebView at your hosted app

Set `CAPACITOR_SERVER_URL` when syncing so the native app loads that origin (required for API + OAuth in normal setups):

```bash
export CAPACITOR_SERVER_URL=https://your-app.example.com
npm run cap:sync
```

For **HTTP** on your LAN (e.g. Express on port 8000), use your machine’s IP (not `localhost` from the device’s point of view). The config sets `cleartext: true` automatically for `http://` URLs.

```bash
export CAPACITOR_SERVER_URL=http://192.168.1.10:8000
npm run cap:sync
```

**iOS:** plain HTTP may still require App Transport Security exceptions in Xcode if something fails to load; prefer HTTPS for anything you ship.

## Open native IDEs

```bash
npm run cap:open:ios
npm run cap:open:android
```

## OAuth and redirects

Configure **Cognito** and **Kroger** redirect/callback URLs in their consoles to match the **same HTTPS URLs** you use for the deployed web app (e.g. `https://your-app.example.com/kroger-oauth-callback.html`). No separate “Capacitor URL” is needed if the WebView loads that host via `CAPACITOR_SERVER_URL`.

If you later load **local** files only (no `server.url`), relative `/api/` calls will not reach your server; you would need a different approach (e.g. absolute API base URL in the client).

## Optional: allow extra hosts in the WebView

If a flow opens a domain that Capacitor treats as external, you may need `server.allowNavigation` in `capacitor.config.ts` (see [Capacitor config](https://capacitorjs.com/docs/config)). Add origins only as needed.
