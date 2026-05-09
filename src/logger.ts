import { mkdirSync, openSync, writeSync, closeSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

export type LogLevel = "info" | "warning" | "error";

export type LoggerEnableOptions = {
  logFile: string;
  mode?: "append" | "overwrite";
};

type LoggerState = {
  fd: number;
  path: string;
};

let state: LoggerState | undefined;

function resolveLogPath(logFile: string): string {
  return isAbsolute(logFile) ? logFile : resolve(process.cwd(), logFile);
}

function normalize(data: unknown): unknown {
  if (data instanceof Error) {
    return {
      name: data.name,
      message: data.message,
      stack: data.stack,
    };
  }
  return data;
}

function write(level: LogLevel, data: unknown): void {
  if (!state) return;
  let line: string;
  try {
    line =
      JSON.stringify({
        ts: new Date().toISOString(),
        level,
        data: normalize(data),
      }) + "\n";
  } catch {
    line =
      JSON.stringify({
        ts: new Date().toISOString(),
        level,
        data: String(data),
      }) + "\n";
  }
  try {
    writeSync(state.fd, line);
  } catch {
    // swallow — logging must not break the workflow
  }
}

export const logger = {
  info(data: unknown): void {
    write("info", data);
  },
  warning(data: unknown): void {
    write("warning", data);
  },
  error(data: unknown): void {
    write("error", data);
  },
  enable(options: LoggerEnableOptions): void {
    const { logFile, mode = "append" } = options;
    const path = resolveLogPath(logFile);

    if (state) {
      try {
        closeSync(state.fd);
      } catch {
        // ignore
      }
      state = undefined;
    }

    mkdirSync(dirname(path), { recursive: true });
    const flag = mode === "overwrite" ? "w" : "a";
    const fd = openSync(path, flag);
    state = { fd, path };
  },
  disable(): void {
    if (!state) return;
    try {
      closeSync(state.fd);
    } catch {
      // ignore
    }
    state = undefined;
  },
  get enabled(): boolean {
    return state !== undefined;
  },
};

export type Logger = typeof logger;
