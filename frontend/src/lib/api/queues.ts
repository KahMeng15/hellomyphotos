import { API_BASE } from './media';

export type QueueExecutionMode = 'sequential' | 'concurrent';

export interface QueueCounts {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: number;
}

export interface ActiveJob {
  id: string;
  target: string;
}

export interface QueueStat {
  counts: QueueCounts;
  isPaused: boolean;
  activeJobs: ActiveJob[];
  progress: number;
}

export interface QueuesResponse {
  queues: Record<string, QueueStat>;
  mode: QueueExecutionMode;
}

export async function fetchQueues(): Promise<QueuesResponse> {
  const res = await fetch(`${API_BASE}/api/admin/queues`, { credentials: 'include' });
  if (!res.ok) throw new Error('Failed to fetch queue stats');
  return res.json();
}

export async function fetchQueueMode(): Promise<QueueExecutionMode> {
  const res = await fetch(`${API_BASE}/api/admin/queues/mode`, { credentials: 'include' });
  if (!res.ok) throw new Error('Failed to fetch queue mode');
  const data = await res.json();
  return data.mode;
}

export async function setQueueMode(mode: QueueExecutionMode): Promise<{ success: boolean; mode: QueueExecutionMode }> {
  const res = await fetch(`${API_BASE}/api/admin/queues/mode`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ mode })
  });
  if (!res.ok) throw new Error('Failed to set queue mode');
  return res.json();
}

export async function actionQueue(name: string, action: 'pause' | 'resume' | 'stop' | 'trigger'): Promise<void> {
  const res = await fetch(`${API_BASE}/api/admin/queues/${name}/${action}`, {
    method: 'POST',
    credentials: 'include'
  });
  if (!res.ok) throw new Error(`Failed to ${action} queue ${name}`);
}

export async function cleanQueue(name: string, type: string = 'failed'): Promise<void> {
  const res = await fetch(`${API_BASE}/api/admin/queues/${name}/clean`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ type })
  });
  if (!res.ok) throw new Error(`Failed to clean queue ${name}`);
}
