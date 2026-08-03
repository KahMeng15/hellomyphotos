import os from 'os';
import fs from 'fs';

function readCgroupV2Quota(): number | null {
  try {
    const raw = fs.readFileSync('/sys/fs/cgroup/cpu.max', 'utf8').trim();
    const [quotaRaw, periodRaw] = raw.split(/\s+/).map(Number);
    if (Number.isFinite(periodRaw) && periodRaw > 0 && Number.isFinite(quotaRaw) && quotaRaw > 0) {
      return Math.ceil(quotaRaw / periodRaw);
    }
  } catch {}
  return null;
}

function readCgroupV1Quota(): number | null {
  try {
    const quota = parseInt(fs.readFileSync('/sys/fs/cgroup/cpu/cpu.cfs_quota_us', 'utf8').trim(), 10);
    const period = parseInt(fs.readFileSync('/sys/fs/cgroup/cpu/cpu.cfs_period_us', 'utf8').trim(), 10);
    if (period > 0 && quota > 0) {
      return Math.ceil(quota / period);
    }
  } catch {}
  return null;
}

function hostCpus(): number {
  return os.cpus().length;
}

function hostParallelism(): number {
  const fn = (os as any).availableParallelism;
  return typeof fn === 'function' ? fn() : hostCpus();
}

export function getContainerCpuCount(): number {
  const envOverride = Number(process.env.MAX_CPU_CORES);
  const detected = envOverride > 0
    ? envOverride
    : readCgroupV2Quota() ?? readCgroupV1Quota() ?? hostParallelism();
  return Math.max(1, Math.min(detected, hostCpus()));
}