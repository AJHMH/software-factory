import { readFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { performance } from 'node:perf_hooks';

/** Read only fixed numeric counters, never process arguments or environment. */
function linuxCounters() {
  /** @param {string} path @param {string[]} keys */
  function fields(path, keys) {
    try {
      return Object.fromEntries(readFileSync(path, 'utf8').trim().split('\n').flatMap((line) => {
        const [key, value] = line.trim().split(/\s+/);
        return keys.includes(key) && /^\d+$/.test(value) ? [[key, Number(value)]] : [];
      }));
    } catch { return null; }
  }
  /** @param {string} kind */
  function pressure(kind) {
    try {
      return Object.fromEntries(readFileSync('/proc/pressure/' + kind, 'utf8').trim().split('\n').flatMap((line) => {
        const [category, ...values] = line.split(/\s+/);
        return ['some', 'full'].includes(category) ? [[category, Object.fromEntries(values.flatMap((field) => {
          const [key, value] = field.split('=');
          return ['avg10', 'avg60', 'avg300', 'total'].includes(key) && /^\d+(?:\.\d+)?$/.test(value) ? [[key, Number(value)]] : [];
        }))]] : [];
      }));
    } catch { return null; }
  }
  let cpuTicks = null;
  try {
    const values = readFileSync('/proc/stat', 'utf8').split('\n')[0].trim().split(/\s+/).slice(1);
    if (values.length >= 8 && values.every((value) => /^\d+$/.test(value))) cpuTicks = values.map(Number);
  } catch { /* Unsupported counters remain explicit, never a gate exception. */ }
  return {
    cpuTicks,
    pressure: { cpu: pressure('cpu'), io: pressure('io'), memory: pressure('memory') },
    cgroupCpu: fields('/sys/fs/cgroup/cpu.stat', ['usage_usec', 'user_usec', 'system_usec', 'nr_periods', 'nr_throttled', 'throttled_usec']),
  };
}

/** Bounded in-memory observations; command supervision owns every deadline. */
export function startResourceDiagnostics() {
  const started = performance.now();
  let parallelism = null;
  try { parallelism = availableParallelism(); } catch { /* Unknown host metadata is not authority. */ }
  /** @type {{elapsedMs: number, supervisor: NodeJS.ResourceUsage, linux: ReturnType<typeof linuxCounters> | null}[]} */
  const samples = [];
  let samplingFailed = false;
  let sampleLimitReached = false;
  /** @type {ReturnType<typeof setInterval> | undefined} */
  let timer;
  function sample() {
    if (samplingFailed) return;
    if (samples.length >= 128) {
      sampleLimitReached = true;
      clearInterval(timer);
      return;
    }
    try {
      samples.push({ elapsedMs: performance.now() - started, supervisor: process.resourceUsage(), linux: process.platform === 'linux' ? linuxCounters() : null });
    } catch {
      samplingFailed = true;
      clearInterval(timer);
    }
  }
  sample();
  if (!samplingFailed) {
    timer = setInterval(sample, 2000);
    timer.unref();
  }
  return () => {
    clearInterval(timer);
    sample();
    return { schemaVersion: 1, platform: process.platform, architecture: process.arch, parallelism, samplingFailed, sampleLimitReached, samples };
  };
}
