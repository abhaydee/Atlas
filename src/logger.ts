import chalk from "chalk";
import { config } from "./config.js";

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;

function shouldLog(level: keyof typeof LEVELS): boolean {
  return LEVELS[level] >= LEVELS[config.logLevel];
}

function timestamp(): string {
  return new Date().toISOString().slice(11, 23);
}

export const log = {
  debug(...args: unknown[]) {
    if (shouldLog("debug"))
      console.log(chalk.gray(`[${timestamp()}] DEBUG`), ...args);
  },
  info(...args: unknown[]) {
    if (shouldLog("info"))
      console.log(chalk.blue(`[${timestamp()}]  INFO`), ...args);
  },
  warn(...args: unknown[]) {
    if (shouldLog("warn"))
      console.log(chalk.yellow(`[${timestamp()}]  WARN`), ...args);
  },
  error(...args: unknown[]) {
    if (shouldLog("error"))
      console.log(chalk.red(`[${timestamp()}] ERROR`), ...args);
  },
  success(...args: unknown[]) {
    if (shouldLog("info"))
      console.log(chalk.green(`[${timestamp()}]    OK`), ...args);
  },
  payment(...args: unknown[]) {
    if (shouldLog("info"))
      console.log(chalk.magenta(`[${timestamp()}]   PAY`), ...args);
  },
  agent(...args: unknown[]) {
    if (shouldLog("info"))
      console.log(chalk.cyan(`[${timestamp()}] AGENT`), ...args);
  },
};
