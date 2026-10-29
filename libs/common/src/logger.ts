import './config';
import { createWriteStream, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';
type LogFields = Record<string, string | number | boolean | null | undefined>;

const priorities: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const colors: Record<LogLevel, string> = {
  debug: '\u001b[36m',
  info: '\u001b[32m',
  warn: '\u001b[38;5;208m',
  error: '\u001b[31m',
};
const configuredLevel = process.env.LOG_LEVEL ?? 'info';
if (!Object.prototype.hasOwnProperty.call(priorities, configuredLevel)) {
  throw new Error('LOG_LEVEL must be debug, info, warn, or error');
}

const logPath = resolve(process.env.LOG_FILE ?? 'logs/app.log');
mkdirSync(dirname(logPath), { recursive: true });
const logFile = createWriteStream(logPath, { flags: 'a' });
logFile.on('error', (error: Error) => {
  console.error(`Unable to write log file: ${error.message}`);
});

function write(level: LogLevel, message: string, fields: LogFields = {}): void {
  if (priorities[level] < priorities[configuredLevel as LogLevel]) return;
  const line = JSON.stringify({ ...fields, timestamp: new Date().toISOString(), level, message });
  logFile.write(`${line}\n`);
  const output = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
  const useColor = process.env.NO_COLOR === undefined &&
    (output.isTTY || process.env.FORCE_COLOR === '1');
  const consoleLine = useColor ? `${colors[level]}${line}\u001b[0m` : line;
  if (level === 'error') console.error(consoleLine);
  else if (level === 'warn') console.warn(consoleLine);
  else console.log(consoleLine);
}

export const logger = {
  debug: (message: string, fields?: LogFields) => write('debug', message, fields),
  info: (message: string, fields?: LogFields) => write('info', message, fields),
  warn: (message: string, fields?: LogFields) => write('warn', message, fields),
  error: (message: string, fields?: LogFields) => write('error', message, fields),
};
