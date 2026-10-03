import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { parse } from 'yaml';
import Ajv from 'ajv';

/** @typedef {{run: string, timeout_seconds: number}} Command */
/** @typedef {{version: string, contract: {workload_id: string, profile: string, working_directory: string, commands: Record<string, Command>}}} Contract */

const schema = JSON.parse(readFileSync(new URL('../schemas/factory-contract.schema.json', import.meta.url), 'utf8'));
const validator = new Ajv.default({ allErrors: true, strict: true }).compile(schema);
const profile = { id: 'node-24', language: 'node', nodeVersion: '24', runtimeVersion: '24.x' };

/** @param {string} filename */
function load(filename) {
  const contractPath = realpathSync(resolve(filename));
  const source = readFileSync(contractPath, 'utf8');
  const document = parse(source);
  if (!validator(document)) {
    throw new Error('Invalid contract: ' + validator.errors?.map((error) =>
      `${error.instancePath || '/'} ${error.message}${JSON.stringify(error.params)}`).join('; '));
  }
  const data = /** @type {Contract} */ (document);
  const base = dirname(contractPath);
  if (isAbsolute(data.contract.working_directory)) throw new Error('working_directory must be relative to the contract directory.');
  const cwd = realpathSync(resolve(base, data.contract.working_directory));
  const within = relative(base, cwd);
  if (within === '..' || within.startsWith('..' + sep) || isAbsolute(within)) {
    throw new Error('working_directory must remain inside the contract directory, including symlink targets.');
  }
  return { data, cwd, contractDigest: createHash('sha256').update(source).digest('hex') };
}

/** @param {string} cwd */
function revisionEvidence(cwd) {
  const revision = spawnSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' });
  const status = spawnSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8' });
  if (revision.status !== 0 || !/^[a-f0-9]{40,64}$/.test(revision.stdout.trim()) || status.status !== 0) {
    throw new Error('The workload must be inside a Git repository with a committed revision.');
  }
  return { revision: revision.stdout.trim(), workingTreeDirty: status.stdout.trim() !== '' };
}

/** @param {Command} command @param {string} cwd */
async function execute(command, cwd) {
  const startedAt = new Date().toISOString();
  const windows = process.platform === 'win32';
  const env = { ...process.env };
  delete env.GITHUB_OUTPUT;
  delete env.GITHUB_STEP_SUMMARY;
  let stdout = '';
  let stderr = '';
  let truncated = false;
  let timedOut = false;
  let terminationFailed = false;
  return await new Promise((done) => {
    const child = spawn(windows ? command.run : 'set -o pipefail; ' + command.run, {
      cwd, env, shell: windows ? true : '/bin/bash', detached: !windows,
      windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    const timer = setTimeout(() => {
      timedOut = true;
      if (windows && child.pid) {
        const stopped = spawnSync('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], {
          windowsHide: true, stdio: 'ignore', timeout: 5000,
        });
        terminationFailed = stopped.status !== 0;
      } else if (child.pid) {
        try { process.kill(-child.pid, 'SIGKILL'); } catch { terminationFailed = !child.kill('SIGKILL'); }
      }
      if (terminationFailed) {
        child.kill();
        child.stdout.destroy();
        child.stderr.destroy();
        child.unref();
        done({ status: 'failed', exitCode: null, signal: null, timedOut, terminationFailed, startedAt,
          finishedAt: new Date().toISOString(), stdout, stderr: 'Process-tree termination failed; operator cleanup is required.', truncated });
      }
    }, command.timeout_seconds * 1000);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      truncated ||= stdout.length + chunk.length > 65536;
      stdout = (stdout + chunk).slice(0, 65536);
    });
    child.stderr.on('data', (chunk) => {
      truncated ||= stderr.length + chunk.length > 65536;
      stderr = (stderr + chunk).slice(0, 65536);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      done({ status: 'failed', exitCode: null, signal: null, timedOut, terminationFailed, startedAt, finishedAt: new Date().toISOString(), stdout, stderr: error.message, truncated });
    });
    child.on('close', (exitCode, signal) => {
      clearTimeout(timer);
      done({ status: exitCode === 0 && !timedOut ? 'passed' : 'failed', exitCode, signal, timedOut, terminationFailed, startedAt, finishedAt: new Date().toISOString(), stdout, stderr, truncated });
    });
  });
}

/** @param {string} filename @param {boolean} inspectOnly */
export async function runContract(filename, inspectOnly = false) {
  try {
    const { data, cwd, contractDigest } = load(filename);
    const evidence = revisionEvidence(cwd);
    if (inspectOnly) return { operation: 'profile', outcome: 'passed', profile, workloadId: data.contract.workload_id, ...evidence, contractDigest, results: [] };
    if (process.versions.node.split('.')[0] !== profile.nodeVersion) {
      throw new Error(`Profile ${profile.id} requires Node ${profile.nodeVersion}; running ${process.versions.node}.`);
    }
    const results = [];
    for (const name of ['install', 'validate', 'test', 'build']) {
      const result = await execute(data.contract.commands[name], cwd);
      results.push({ capability: name, required: true, reason: result.timedOut ? 'Command timed out; later gates were not executed.' : result.status === 'passed' ? 'Command completed successfully.' : 'Command failed; later gates were not executed.', ...result });
      if (result.status !== 'passed') break;
    }
    return { operation: 'validate', outcome: results.every((gate) => gate.status === 'passed') ? 'passed' : 'blocked', profile, workloadId: data.contract.workload_id, ...evidence, contractDigest, workingDirectory: cwd, results };
  } catch (error) {
    return { operation: inspectOnly ? 'profile' : 'validate', outcome: 'blocked', results: [{ capability: 'contract-validation', required: true, status: 'failed', reason: error instanceof Error ? error.message : String(error) }] };
  }
}
