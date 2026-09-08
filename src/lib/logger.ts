// Minimal structured logger: emits one JSON line per call so log
// aggregators can filter/search by `event` and any extra context fields.

type LogLevel = "debug" | "info" | "warn" | "error";

function emit(level: LogLevel, event: string, context?: Record<string, unknown>): void {
  const line = JSON.stringify({
    level,
    event,
    ts: new Date().toISOString(),
    ...context,
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (event: string, context?: Record<string, unknown>) => emit("debug", event, context),
  info: (event: string, context?: Record<string, unknown>) => emit("info", event, context),
  warn: (event: string, context?: Record<string, unknown>) => emit("warn", event, context),
  error: (event: string, context?: Record<string, unknown>) => emit("error", event, context),
};
