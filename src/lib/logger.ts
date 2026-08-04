/**
 * v7.32: Structured logger — ISO timestamp + level + route + message.
 */
type LogLevel = 'error' | 'warn' | 'info' | 'debug';

function format(level: LogLevel, route: string, message: string, meta?: unknown): string {
  const ts = new Date().toISOString();
  const metaStr = meta instanceof Error ? `${meta.message}\n${meta.stack ?? ''}` : (meta !== undefined ? JSON.stringify(meta) : '');
  return `[${ts}] [${level.toUpperCase()}] [${route}] ${message}${metaStr ? ' ' + metaStr : ''}`;
}

export const logger = {
  error: (route: string, message: string, meta?: unknown) => console.error(format('error', route, message, meta)),
  warn: (route: string, message: string, meta?: unknown) => console.warn(format('warn', route, message, meta)),
  info: (route: string, message: string, meta?: unknown) => console.info(format('info', route, message, meta)),
  debug: (route: string, message: string, meta?: unknown) => { if (process.env.NODE_ENV !== 'production') console.debug(format('debug', route, message, meta)); },
};
