import { Logger } from "tslog";

/** tslog levels: 0 silly, 1 trace, 2 debug, 3 info, 4 warn, 5 error, 6 fatal. */
const LEVELS = ["silly", "trace", "debug", "info", "warn", "error", "fatal"];

function minLevel() {
  const configured = LEVELS.indexOf(process.env.LOG_LEVEL?.toLowerCase() ?? "");
  if (configured >= 0) return configured;
  // Production logs info and above: debug lines on every request cost CPU.
  return process.env.NODE_ENV === "production" ? 3 : 2;
}

export const logger = new Logger({ name: "buzz-board", minLevel: minLevel() });
