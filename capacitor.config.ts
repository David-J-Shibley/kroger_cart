import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Point the WebView at your deployed site so `/api/*` and OAuth redirects match production.
 *
 *   CAPACITOR_SERVER_URL=https://your-app.example.com npx cap sync
 *
 * For LAN dev against Express (HTTP), use your machine IP and cleartext is enabled automatically:
 *
 *   CAPACITOR_SERVER_URL=http://192.168.1.10:8000 npx cap sync
 */
const serverUrl = process.env.CAPACITOR_SERVER_URL?.trim();

const config: CapacitorConfig = {
  appId: "com.openclaw.krogercart",
  appName: "Kroger Cart",
  webDir: "www",
  server: {
    appStartPath: "/index.html",
    ...(serverUrl
      ? {
          url: serverUrl,
          cleartext: serverUrl.startsWith("http://"),
        }
      : {}),
  },
};

export default config;
