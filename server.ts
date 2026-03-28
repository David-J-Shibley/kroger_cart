/**
 * HTTP entry — Express app (auth, Stripe, DynamoDB, proxies, static files).
 * Run: npm start
 */
import { createApp, logStartupWarnings } from "./server/app.js";
import { config } from "./server/config.js";
import { logger } from "./server/logger.js";

const app = createApp();
logStartupWarnings();

const host = config.host;
const port = config.port;

app.listen(port, host, () => {
  logger.info({ host, port }, "Server listening");
  console.log(`Serving at http://${host}:${port}/`);
  console.log(`Open http://localhost:${port}/index.html`);
});
