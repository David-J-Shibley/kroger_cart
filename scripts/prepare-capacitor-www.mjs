import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
/** Default `www` (Capacitor). Set AMPLIFY_WEB_ROOT=amplify-static in Amplify CI — `www/` is gitignored and may be omitted from deploy artifacts. */
const www = path.join(root, process.env.AMPLIFY_WEB_ROOT || "www");

const copyFromRoot = [
  "index.html",
  "icon.png",
  "kroger-cart.css",
  "api-host-bootstrap.js",
  "auth.html",
  "auth-callback.html",
  "kroger-oauth-callback.html",
  "feedback.html",
  "admin.html",
];

await fs.mkdir(www, { recursive: true });

try {
  await fs.unlink(path.join(www, "kroger-cart.html"));
} catch {
  /* stale file from before app lived at index.html */
}

for (const name of copyFromRoot) {
  const src = path.join(root, name);
  await fs.copyFile(src, path.join(www, name));
}

const distRoot = path.join(root, "dist");
let distNames = [];
try {
  distNames = await fs.readdir(distRoot);
} catch {
  console.error("Missing dist/ — run npm run build:client first.");
  process.exit(1);
}

await fs.mkdir(path.join(www, "dist"), { recursive: true });
for (const name of distNames) {
  if (name.endsWith(".js")) {
    await fs.copyFile(path.join(distRoot, name), path.join(www, "dist", name));
  }
}

const apiOrigin = (process.env.API_PUBLIC_URL || process.env.AMPLIFY_API_ORIGIN || "")
  .trim()
  .replace(/\/+$/, "");
if (apiOrigin) {
  await fs.writeFile(
    path.join(www, "deploy-config.json"),
    JSON.stringify({ apiOrigin }),
    "utf8"
  );
} else {
  try {
    await fs.unlink(path.join(www, "deploy-config.json"));
  } catch {
    /* absent */
  }
}

console.log(`Web bundle prepared in ${path.relative(root, www) || "."}/`);
