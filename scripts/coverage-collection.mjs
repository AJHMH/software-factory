import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, realpathSync, rmSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execute } from './contract-execution.mjs';
import { digest, evaluatePolicy } from './policy-evaluation.mjs';
import { coverageContext, sourceFiles, rawGit, evaluateCoverage } from './coverage-evaluation.mjs';

const adapter = fileURLToPath(new URL('../node_modules/c8/bin/c8.js', import.meta.url));
/** Shell-safe literals for commands assembled only from adapter-owned paths. @param {string} value */
function quote(value) {
  if (process.platform === 'win32') {
    if (/["%\r\n]/.test(value)) throw new Error('Unsupported Windows adapter path.');
    return '"' + value + '"';
  }
  return "'" + value.replaceAll("'", "'\\''") + "'";
}
/** @param {string} repo @param {string} revision @param {string} prefix @param {string} destination */
function snapshot(repo, revision, prefix, destination) {
  const entries = rawGit(repo, ['ls-tree', '-r', '-z', revision, '--', prefix || '.']).split('\0').filter(Boolean);
  for (const entry of entries) {
    const [metadata, path] = entry.split('\t');
    if (!/^100(644|755) blob /.test(metadata)) throw new Error('Snapshot contains an unsupported file mode.');
    const within = prefix ? path.slice(prefix.length + 1) : path;
    const target = resolve(destination, within), guard = relative(destination, target);
    if (!guard || guard === '..' || guard.startsWith('..' + sep) || isAbsolute(guard)) throw new Error('Unsafe snapshot path.');
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, rawGit(repo, ['show', `${revision}:${path}`]), { mode: metadata.startsWith('100755') ? 0o755 : 0o644 });
  }
}
/** @param {string} cwd @param {string} directory */
function testFiles(cwd, directory) {
  try { return readdirSync(join(cwd, directory)).filter(name => name.endsWith('.test.mjs')).sort().map(name => join(directory, name)); }
  catch { return []; }
}
/** @typedef {{statementMap: Record<string,{start: {line: number},end: {line: number,column: number}}>, s: Record<string,number>, branchMap: Record<string,{line: number, loc: {end: {line: number}}}>, b: Record<string,number[]>}} IstanbulFile */
/** @param {ReturnType<typeof coverageContext>} context @param {string} revision @param {string} cwd @param {string} reportDirectory */
function evidenceFiles(context, revision, cwd, reportDirectory) {
  const report = /** @type {Record<string,IstanbulFile>} */ (JSON.parse(readFileSync(join(reportDirectory, 'coverage-final.json'), 'utf8')));
  return sourceFiles(context.repo, revision, context.sourcePath).map(path => {
    const localPath = resolve(cwd, path.slice(context.workloadPath ? context.workloadPath.length + 1 : 0));
    const entry = report[localPath];
    if (!entry) throw new Error('Coverage adapter omitted a tracked source file.');
    const source = rawGit(context.repo, ['show', `${revision}:${path}`]);
    /** @type {Record<string,number>} */
    const lines = Object.fromEntries(source.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n').map((_, index) => [index + 1, 0]));
    for (const [id, location] of Object.entries(entry.statementMap)) {
      const end = location.end.line - (location.end.column === 0 && location.end.line > location.start.line ? 1 : 0);
      for (let line = location.start.line; line <= end; line++) lines[line] = Math.max(lines[line] ?? 0, entry.s[id]);
    }
    const branches = Object.entries(entry.branchMap).flatMap(([id, branch]) => entry.b[id].map((hits, index) => ({ id: `${id}:${index}`, line: branch.line, end_line: branch.loc.end.line, hits })));
    return { path, source_digest: digest(source), lines, branches };
  });
}
/** @param {Record<string,string>} options */
export async function collectCoverage(options) {
  /** @type {string | undefined} */
  let directory;
  /** @type {string | undefined} */
  let scratch;
  /** @type {Array<Omit<Awaited<ReturnType<typeof execute>>, 'stdout' | 'stderr'> & {phase:string,durationMs:number,stdout?:string,stderr?:string}>} */
  const stages = [];
  // Diagnostic data never participates in policy evaluation or test authority.
  const secrets = Object.entries(process.env).flatMap(([key, value]) => /secret|token|password|credential|authorization|private.?key/i.test(key) && value && value.length >= 8 ? [value] : []).sort((a, b) => b.length - a.length);
  /** @param {string} text */
  const redact = text => secrets.reduce((value, secret) => value.replaceAll(secret, '<REDACTED>'), text).replace(/(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)/g, '<REDACTED>').slice(0, 65536);
  /** @param {string} phase @param {import('./contract-execution.mjs').Command} command @param {string} cwd */
  async function runStage(phase, command, cwd) {
    const result = await execute(command, cwd);
    stages.push({ phase, status: result.status, startedAt: result.startedAt, finishedAt: result.finishedAt,
      durationMs: Date.parse(result.finishedAt) - Date.parse(result.startedAt), exitCode: result.exitCode,
      signal: result.signal, timedOut: result.timedOut, terminationFailed: result.terminationFailed,
      truncated: result.truncated, ...(result.status === 'passed' ? {} : { stdout: redact(result.stdout), stderr: redact(result.stderr) }) });
    return result;
  }
  try {
    const context = coverageContext(options);
    const executionPolicy = evaluatePolicy({ ...options, '--trusted-repo': context.trustedRepo, '--trusted-revision': context.trusted });
    if (executionPolicy.outcome !== 'passed') throw new Error('Coverage test budget is not authorized by trusted execution policy.');
    if (executionPolicy.contractDigest !== context.contractDigest || executionPolicy.revision !== context.revision || executionPolicy.trustedRevision !== context.trusted) throw new Error('Coverage execution policy does not match the captured contract and revision.');
    const testTimeoutSeconds = context.contract.commands.test.timeout_seconds;
    if (process.versions.node.split('.')[0] !== '24') throw new Error('Coverage adapter requires Node 24.');
    scratch = resolve(context.repo, 'tmp');
    mkdirSync(scratch, { recursive: true });
    scratch = realpathSync(scratch);
    const guard = relative(realpathSync(context.repo), scratch);
    if (guard === '..' || guard.startsWith('..' + sep) || isAbsolute(guard)) throw new Error('Coverage scratch directory escapes the repository.');
    directory = mkdtempSync(join(scratch, 'coverage-adapter-'));
    const config = join(directory, 'c8.json');
    writeFileSync(config, JSON.stringify({ exclude: [] })); // Never load candidate .c8rc/package.json coverage configuration.
    const snapshots = { head: join(directory, 'head'), base: join(directory, 'base') };
    for (const [name, revision] of [['head', context.revision], ['base', context.base]]) {
      const cwd = snapshots[/** @type {'head'|'base'} */ (name)];
      mkdirSync(cwd);
      snapshot(context.repo, revision, context.workloadPath, cwd);
      // Built-in-only reference tests need no dependencies. Packages declaring dependencies must install them safely.
      try {
        const manifest = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'));
        if (Object.keys(manifest.dependencies ?? {}).length || context.contract.profile === 'node-24-typescript-cli') {
          const install = await runStage(`${name}-install`, { run: 'npm ci --ignore-scripts', timeout_seconds: 120 }, cwd);
          if (install.status !== 'passed') throw new Error('Snapshot dependency installation failed or timed out.');
          if (context.contract.profile === 'node-24-typescript-cli') {
            const build = await runStage(`${name}-build`, { run: 'node node_modules/typescript/bin/tsc', timeout_seconds: 120 }, cwd);
            if (build.status !== 'passed') throw new Error('Snapshot TypeScript compilation failed.');
          }
        }
      } catch (error) { if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') throw error; }
    }
    const node = quote(process.execPath);
    /** @type {{unit: import('./coverage-evaluation.mjs').TestResult, integration: import('./coverage-evaluation.mjs').TestResult}} */
    const tests = { unit: { revision: context.revision, status: 'not-run', exit_code: null }, integration: { revision: context.revision, status: 'not-run', exit_code: null } };
    for (const [name, path] of [['unit', 'tests'], ['integration', 'tests/integration']]) {
      const files = context.contract.profile === 'node-24-typescript-cli'
        ? (name === 'unit' ? testFiles(snapshots.head, 'tests').filter(file => !file.endsWith('delivery.test.mjs')) : testFiles(snapshots.head, 'tests').filter(file => file.endsWith('delivery.test.mjs')))
        : testFiles(snapshots.head, path);
      if (files.length) {
        const result = await runStage(`${name}-tests`, { run: `${node} --test --test-concurrency=4 ${files.map(quote).join(' ')}`, timeout_seconds: testTimeoutSeconds }, snapshots.head);
        tests[/** @type {'unit'|'integration'} */ (name)] = { revision: context.revision, status: result.status, exit_code: result.exitCode };
      }
    }
    const measured = [];
    for (const [name, revision] of [['head', context.revision], ['base', context.base]]) {
      const cwd = snapshots[/** @type {'head'|'base'} */ (name)];
      const files = [...testFiles(cwd, 'tests'), ...testFiles(cwd, 'tests/integration')];
      if (!files.length) throw new Error('Coverage baseline or candidate has no runnable tests.');
      const reports = join(directory, name + '-report');
      const run = `${node} ${quote(adapter)} --config ${quote(config)} --all --src src --include ${quote(context.contract.profile === 'node-24-typescript-cli' ? 'src/**/*.ts' : 'src/**/*.mjs')} --extension .mjs --extension .ts ${context.contract.profile === 'node-24-typescript-cli' ? '--extension .js --exclude-after-remap' : ''} --reporter json --reports-dir ${quote(reports)} --temp-directory ${quote(join(directory, name + '-v8'))} ${node} --test --test-concurrency=4 ${files.map(quote).join(' ')}`;
      const result = await runStage(`${name}-instrumentation`, { run, timeout_seconds: testTimeoutSeconds }, cwd);
      if (result.status !== 'passed') throw new Error(`${name} coverage instrumentation failed or timed out; evidence cannot pass.`);
      measured.push(evidenceFiles(context, revision, cwd, reports));
    }
    const evidence = { version: '1.0', revision: context.revision, base_revision: context.base, workload_id: context.contract.workload_id, profile: context.contract.profile, contract_digest: context.contractDigest, files: measured[0], baseline: { revision: context.base, files: measured[1] }, tests };
    if (options['--output']) writeFileSync(options['--output'], JSON.stringify(evidence, null, 2) + '\n');
    return { ...evaluateCoverage(options, evidence), diagnostics: { stages } };
  } catch (error) {
    return { operation: 'coverage', outcome: 'blocked', diagnostics: { stages }, results: [{ capability: 'coverage', required: true, status: 'failed', reason: error instanceof Error ? error.message : String(error) }] };
  } finally {
    if (directory && scratch) {
      const target = realpathSync(directory), within = relative(scratch, target);
      if (within && within !== '..' && !within.startsWith('..' + sep) && !isAbsolute(within)) rmSync(target, { recursive: true, force: true });
    }
  }
}
