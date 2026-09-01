import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import pc from "picocolors";

export type LogLevel = "debug" | "info" | "warn" | "error" | "critical" | "silent";
export type LogFormat = "text" | "json";

const levelRank: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  critical: 50,
  silent: 99,
};

type EmittedLogLevel = Exclude<LogLevel, "silent">;

export interface Logger {
  level: LogLevel;
  json: boolean;
  format: LogFormat;
  sessionId: string;
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
  critical(message: string, fields?: Record<string, unknown>): void;
}

export interface LoggerOptions {
  level: LogLevel;
  format?: LogFormat;
  stream?: NodeJS.WritableStream;
  requestId?: string | undefined;
  sessionId?: string;
  projectRoot?: string | undefined;
  logFile?: string | undefined;
  maxFileBytes?: number | undefined;
  retention?: number | undefined;
  maxFieldLength?: number;
  now?: () => Date;
}

interface NormalizedLoggerOptions {
  level: LogLevel;
  format: LogFormat;
  stream: NodeJS.WritableStream;
  requestId: string | undefined;
  sessionId: string;
  projectRoot: string | undefined;
  logFile: string | undefined;
  maxFileBytes: number;
  retention: number;
  maxFieldLength: number;
  now: () => Date;
}

const defaultMaxFileBytes = 5 * 1024 * 1024;
const defaultRetention = 5;
const defaultMaxFieldLength = 4096;

export function createLogger(level: LogLevel, json?: boolean, stream?: NodeJS.WritableStream): Logger;
export function createLogger(options: LoggerOptions): Logger;
export function createLogger(
  input: LogLevel | LoggerOptions,
  json = false,
  stream: NodeJS.WritableStream = process.stderr,
): Logger {
  const options = normalizeLoggerOptions(input, json, stream);
  const log = (entryLevel: EmittedLogLevel, message: string, fields: Record<string, unknown> = {}) => {
    if (levelRank[entryLevel] < levelRank[options.level]) {
      return;
    }
    const entry = structuredEntry(entryLevel, message, fields, options);
    const line = options.format === "json" ? `${JSON.stringify(entry)}\n` : `${formatText(entry)}\n`;
    options.stream.write(line);
    if (options.logFile) {
      writeRotatingLine(options.logFile, line, options.maxFileBytes, options.retention);
    }
  };
  return {
    level: options.level,
    json: options.format === "json",
    format: options.format,
    sessionId: options.sessionId,
    debug: (message, fields) => log("debug", message, fields),
    info: (message, fields) => log("info", message, fields),
    warn: (message, fields) => log("warn", message, fields),
    error: (message, fields) => log("error", message, fields),
    critical: (message, fields) => log("critical", message, fields),
  };
}

export function parseLogLevel(value: string, source = "log-level"): LogLevel {
  if (
    value === "debug" ||
    value === "info" ||
    value === "warn" ||
    value === "error" ||
    value === "critical" ||
    value === "silent"
  ) {
    return value;
  }
  throw new Error(`Input ${source} must be debug, info, warn, error, critical, or silent.`);
}

export function parseLogFormat(value: string, source = "log-format"): LogFormat {
  if (value === "text" || value === "json") {
    return value;
  }
  throw new Error(`Input ${source} must be text or json.`);
}

function normalizeLoggerOptions(
  input: LogLevel | LoggerOptions,
  json: boolean,
  stream: NodeJS.WritableStream,
): NormalizedLoggerOptions {
  if (typeof input === "string") {
    return {
      level: input,
      format: json ? "json" : "text",
      stream,
      requestId: undefined,
      sessionId: randomUUID(),
      projectRoot: undefined,
      logFile: undefined,
      maxFileBytes: defaultMaxFileBytes,
      retention: defaultRetention,
      maxFieldLength: defaultMaxFieldLength,
      now: () => new Date(),
    };
  }
  return {
    level: input.level,
    format: input.format ?? "text",
    stream: input.stream ?? process.stderr,
    requestId: input.requestId,
    sessionId: input.sessionId ?? randomUUID(),
    projectRoot: input.projectRoot ? normalizePath(input.projectRoot) : undefined,
    logFile: input.logFile,
    maxFileBytes: input.maxFileBytes ?? defaultMaxFileBytes,
    retention: input.retention ?? defaultRetention,
    maxFieldLength: input.maxFieldLength ?? defaultMaxFieldLength,
    now: input.now ?? (() => new Date()),
  };
}

function structuredEntry(
  level: EmittedLogLevel,
  message: string,
  fields: Record<string, unknown>,
  options: NormalizedLoggerOptions,
): Record<string, unknown> {
  const event = typeof fields.event === "string" ? fields.event : message;
  const base: Record<string, unknown> = {
    ts: options.now().toISOString(),
    level,
    event,
    message,
    request_id: options.requestId,
    session_id: options.sessionId,
  };
  for (const [key, value] of Object.entries(fields)) {
    base[key] = normalizeLogValue(value, {
      key,
      includeStack: options.level === "debug",
      projectRoot: options.projectRoot,
      maxFieldLength: options.maxFieldLength,
    });
  }
  return Object.fromEntries(Object.entries(base).filter(([, value]) => value !== undefined));
}

function formatText(entry: Record<string, unknown>): string {
  const level = String(entry.level);
  const prefix =
    level === "critical" || level === "error" ? pc.red(level) : level === "warn" ? pc.yellow(level) : level;
  const fields = { ...entry };
  delete fields.ts;
  delete fields.level;
  delete fields.event;
  delete fields.message;
  const suffix = Object.keys(fields).length > 0 ? ` ${JSON.stringify(fields)}` : "";
  return `[${prefix}] ${String(entry.message)}${suffix}`;
}

function normalizeLogValue(
  value: unknown,
  options: {
    key: string;
    includeStack: boolean;
    projectRoot: string | undefined;
    maxFieldLength: number;
  },
): unknown {
  if (isSecretKey(options.key)) {
    return "[REDACTED]";
  }
  if (value instanceof Error) {
    return normalizeError(value, options.includeStack);
  }
  if (typeof value === "string") {
    return redactString(value, options.projectRoot, options.maxFieldLength, options.key);
  }
  if (Array.isArray(value)) {
    return value.map((entry) =>
      normalizeLogValue(entry, {
        ...options,
        key: options.key,
      }),
    );
  }
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      output[key] = normalizeLogValue(nestedValue, {
        ...options,
        key,
      });
    }
    return output;
  }
  return value;
}

function normalizeError(error: Error, includeStack: boolean): Record<string, string> {
  return {
    type: error.name || "Error",
    message: error.message,
    ...(includeStack && error.stack ? { stack: error.stack } : {}),
  };
}

function isSecretKey(key: string): boolean {
  return /(?:api[-_]?key|token|secret|password|authorization|credential|cookie)/i.test(key);
}

function redactString(value: string, projectRoot: string | undefined, maxFieldLength: number, key: string): string {
  let output = value
    .replace(/Authorization:\s*Bearer\s+\S+/gi, "Authorization: Bearer [REDACTED]")
    .replace(/\b(?:api[_-]?key|token|access_token|refresh_token|client_secret|password)=([^&\s]+)/gi, (match) => {
      const [name] = match.split("=");
      return `${name}=[REDACTED]`;
    })
    .replace(/\b(?:ghp|github_pat|npm)_[A-Za-z0-9_]{20,}\b/g, "[REDACTED]");
  if (projectRoot) {
    for (const root of new Set([projectRoot, projectRoot.replaceAll("/", "\\")])) {
      output = output.replaceAll(root, "<project>");
    }
    if (output.includes("<project>")) {
      output = output.replaceAll("\\", "/");
    }
  }
  if (key !== "path" && key !== "project" && output.length > maxFieldLength) {
    return `${output.slice(0, maxFieldLength)}...[truncated]`;
  }
  return output;
}

function normalizePath(value: string): string {
  return path.resolve(value).replaceAll("\\", "/");
}

function writeRotatingLine(file: string, line: string, maxFileBytes: number, retention: number): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (shouldRotate(file, Buffer.byteLength(line), maxFileBytes)) {
    rotate(file, retention);
  }
  fs.appendFileSync(file, line, "utf8");
}

function shouldRotate(file: string, nextBytes: number, maxFileBytes: number): boolean {
  if (maxFileBytes <= 0) {
    return false;
  }
  try {
    return fs.statSync(file).size + nextBytes > maxFileBytes;
  } catch (error) {
    if (isNoEntry(error)) {
      return false;
    }
    throw error;
  }
}

function rotate(file: string, retention: number): void {
  if (retention <= 0) {
    fs.rmSync(file, { force: true });
    return;
  }
  fs.rmSync(`${file}.${retention}`, { force: true });
  for (let index = retention - 1; index >= 1; index -= 1) {
    const from = `${file}.${index}`;
    const to = `${file}.${index + 1}`;
    if (fs.existsSync(from)) {
      fs.renameSync(from, to);
    }
  }
  if (fs.existsSync(file)) {
    fs.renameSync(file, `${file}.1`);
  }
}

function isNoEntry(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
