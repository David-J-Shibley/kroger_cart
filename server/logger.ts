import pino from "pino";
import { config } from "./config.js";

/** Write JSON logs to stderr so stdout stays clean for process managers / redirects. */
export const logger = pino(
  {
    level: config.logLevel,
    formatters: {
      level(label) {
        return { level: label };
      },
    },
    base: { service: "grocery-cart-server" },
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  pino.destination(2)
);
