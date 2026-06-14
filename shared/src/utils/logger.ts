export type LogLevel = "debug" | "info" | "warn" | "error";

function timestamp(): string {
    return new Date().toISOString();
}

function log(level: LogLevel, msg: string, meta?: Record<string, unknown>) {
    const payload = { t: timestamp(), level, msg } as Record<string, unknown>;
    if (meta) Object.assign(payload, meta);
    const line = JSON.stringify(payload);
    if (level === "warn" || level === "error") {
        console.error(line);
        return;
    }
    console.log(line);
}

export const logger = {
    debug: (msg: string, meta?: Record<string, unknown>) =>
        log("debug", msg, meta),
    info: (msg: string, meta?: Record<string, unknown>) =>
        log("info", msg, meta),
    warn: (msg: string, meta?: Record<string, unknown>) =>
        log("warn", msg, meta),
    error: (msg: string, meta?: Record<string, unknown>) =>
        log("error", msg, meta),
};
