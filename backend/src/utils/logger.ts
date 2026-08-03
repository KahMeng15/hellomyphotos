import fs from 'fs';
import path from 'path';

const LOG_DIR = path.resolve(process.cwd(), 'logs');
const LOG_FILE = path.join(LOG_DIR, 'latest.log');

function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function getDateStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

function rotateIfNeeded() {
  if (!fs.existsSync(LOG_FILE)) return;
  try {
    const stat = fs.statSync(LOG_FILE);
    const fileDate = new Date(stat.mtime).toISOString().slice(0, 10);
    if (fileDate !== getDateStamp()) {
      const archiveName = path.join(LOG_DIR, `app-${fileDate}.log`);
      if (!fs.existsSync(archiveName)) {
        fs.renameSync(LOG_FILE, archiveName);
      } else {
        fs.rmSync(LOG_FILE);
      }
    }
  } catch {}
}

function writeLog(level: string, message: string, data?: any) {
  ensureLogDir();
  rotateIfNeeded();
  const ts = new Date().toISOString();
  const line = data
    ? `[${ts}] [${level}] ${message} ${JSON.stringify(data)}\n`
    : `[${ts}] [${level}] ${message}\n`;
  const consoleLine = data
    ? `[${level}] ${message} ${JSON.stringify(data)}`
    : `[${level}] ${message}`;
  if (level === 'ERROR') console.error(consoleLine);
  else if (level === 'WARN') console.warn(consoleLine);
  else console.log(consoleLine);
  fs.appendFileSync(LOG_FILE, line, 'utf-8');
  // Also write to system_logs table for structured audit
  try {
    import('../config/db').then(({ query }) => {
      query(
        `INSERT INTO system_logs (level, message) VALUES ($1, $2)`,
        [level.toLowerCase(), message]
      ).catch(() => {});
    }).catch(() => {});
  } catch {}
}

async function readLatestLog(lines: number = 500): Promise<string> {
  ensureLogDir();
  if (!fs.existsSync(LOG_FILE)) return '';
  const content = fs.readFileSync(LOG_FILE, 'utf-8');
  const allLines = content.split('\n').filter(Boolean);
  return allLines.slice(-lines).join('\n');
}

async function listArchives(): Promise<string[]> {
  ensureLogDir();
  const files = fs.readdirSync(LOG_DIR);
  return files
    .filter(f => f.startsWith('app-') && f.endsWith('.log'))
    .sort()
    .reverse();
}

async function readArchive(name: string): Promise<string> {
  const filePath = path.join(LOG_DIR, name);
  if (!fs.existsSync(filePath)) return '';
  return fs.readFileSync(filePath, 'utf-8');
}

export const logger = {
  info: (msg: string, data?: any) => writeLog('INFO', msg, data),
  warn: (msg: string, data?: any) => writeLog('WARN', msg, data),
  error: (msg: string, data?: any) => writeLog('ERROR', msg, data),
  security: (msg: string, data?: any) => writeLog('SECURITY', msg, data),
  readLatest: readLatestLog,
  listArchives,
  readArchive,
};
