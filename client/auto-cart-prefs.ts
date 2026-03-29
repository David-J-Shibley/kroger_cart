import { AUTO_ADD_ENABLED_KEY, AUTO_ADD_STRATEGY_KEY } from "./config.js";
import { parseAutoCartStrategy, type AutoCartStrategy } from "./auto-cart-strategy.js";

export function getAutoAddEnabled(): boolean {
  try {
    return localStorage.getItem(AUTO_ADD_ENABLED_KEY) === "1";
  } catch {
    return false;
  }
}

export function setAutoAddEnabled(on: boolean): void {
  try {
    localStorage.setItem(AUTO_ADD_ENABLED_KEY, on ? "1" : "0");
  } catch {
    /* quota */
  }
}

export function getAutoAddStrategy(): AutoCartStrategy {
  try {
    return parseAutoCartStrategy(localStorage.getItem(AUTO_ADD_STRATEGY_KEY));
  } catch {
    return "cheapest";
  }
}

export function setAutoAddStrategy(strategy: AutoCartStrategy): void {
  try {
    localStorage.setItem(AUTO_ADD_STRATEGY_KEY, strategy);
  } catch {
    /* quota */
  }
}
