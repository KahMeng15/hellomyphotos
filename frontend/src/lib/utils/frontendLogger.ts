import { API_BASE } from '$lib/api/media';

type LogLevel = 'info' | 'warn' | 'error';

function sendLog(level: LogLevel, message: string, route?: string) {
  const body: any = { level, message };
  if (route) body.route = route;
  fetch(`${API_BASE}/api/log`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  }).catch(() => {});
}

export const frontendLogger = {
  info: (msg: string, route?: string) => sendLog('info', msg, route),
  warn: (msg: string, route?: string) => sendLog('warn', msg, route),
  error: (msg: string, route?: string) => sendLog('error', msg, route),
};
