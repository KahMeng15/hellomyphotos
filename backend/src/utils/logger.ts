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

function tailFile(filePath: string, maxLines: number): string {
  if (!fs.existsSync(filePath)) return '';
  const CHUNK_SIZE = 64 * 1024;
  const stat = fs.statSync(filePath);
  if (stat.size === 0) return '';
  const fd = fs.openSync(filePath, 'r');
  let position = stat.size;
  let linesFound = 0;
  const buffers: Buffer[] = [];

  const lastByteBuf = Buffer.alloc(1);
  fs.readSync(fd, lastByteBuf, 0, 1, stat.size - 1);
  const endsWithNewline = lastByteBuf[0] === 10;
  const targetNewlines = maxLines + (endsWithNewline ? 1 : 0);

  while (position > 0) {
    const toRead = Math.min(CHUNK_SIZE, position);
    position -= toRead;
    const buffer = Buffer.alloc(toRead);
    fs.readSync(fd, buffer, 0, toRead, position);
    
    let breakOuter = false;
    for (let i = buffer.length - 1; i >= 0; i--) {
      if (buffer[i] === 10) {
        linesFound++;
        if (linesFound === targetNewlines) {
          buffers.unshift(buffer.subarray(i + 1));
          breakOuter = true;
          break;
        }
      }
    }
    if (!breakOuter) {
      buffers.unshift(buffer);
    } else {
      break;
    }
  }
  fs.closeSync(fd);
  return Buffer.concat(buffers).toString('utf-8');
}

async function readLatestLog(lines: number = 500): Promise<string> {
  ensureLogDir();
  if (!fs.existsSync(LOG_FILE)) return '';
  return tailFile(LOG_FILE, lines);
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
  // Archives can also be huge, so we only return the tail 5000 lines
  return tailFile(filePath, 5000);
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
