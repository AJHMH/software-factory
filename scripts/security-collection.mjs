import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { dirname, join, resolve, relative, sep, isAbsolute } from 'node:path';
import { spawnSync } from 'node:child_process';
import { securityContext, evaluateSecurity, securityError, UnsupportedSecurityCapability } from './security-evaluation.mjs';
import { verifiedTools, versions } from './security-tools.mjs';
import { digest } from './policy-evaluation.mjs';
import { rawGit } from './coverage-evaluation.mjs';

/** Capture output without logging scanner data or inheriting API credentials/configuration. @param {string} executable @param {string[]} args @param {string} cwd */
function scan(executable,args,cwd) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key])=>['PATH','SYSTEMROOT','WINDIR','TEMP','TMP','HOME','USERPROFILE'].includes(key.toUpperCase())));
  return spawnSync(executable,args,{cwd,env,encoding:'utf8',timeout:120000,maxBuffer:16*1024*1024,windowsHide:true});
}

/** @param {Record<string,string>} options */
export async function collectSecurity(options) {
  /** @type {string | undefined} */ let directory;
  /** @type {string | undefined} */ let scratch;
  try {
    const context = securityContext(options);
    if (process.arch !== 'x64' || !['win32','linux'].includes(process.platform)) throw new UnsupportedSecurityCapability('Unsupported scanner platform.');
    const tools = verifiedTools(options['--tools-dir'] ?? resolve(context.repo,'tmp/security-tools/installed'));
    if (scan(tools.gitleaks,['version'],context.repo).stdout.trim() !== versions.gitleaks || !scan(tools.osv,['--version'],context.repo).stdout.includes(`osv-scanner version: ${versions.osv}`)) throw new Error('Scanner version mismatch.');
    scratch = resolve(context.repo,'tmp'); mkdirSync(scratch,{recursive:true}); scratch=realpathSync(scratch);
    const guard=relative(realpathSync(context.repo),scratch);
    if (guard === '..' || guard.startsWith('..'+sep) || isAbsolute(guard)) throw new Error('Scratch path escapes repository.');
    directory=mkdtempSync(join(scratch,'security-scan-'));
    const snapshot=join(directory,'snapshot'); mkdirSync(snapshot);
    const entries=rawGit(context.repo,['ls-tree','-r','-z',context.revision]).split('\0').filter(Boolean);
    for (const entry of entries) {
      const [metadata,path]=entry.split('\t');
      const target=resolve(snapshot,path), within=relative(snapshot,target);
      if (!/^100(644|755) blob /.test(metadata) || !within || within === '..' || within.startsWith('..'+sep) || isAbsolute(within) || path.includes('\\') || /[\r\n]/.test(path)) throw new Error('Unsupported snapshot file.');
      const blob=spawnSync('git',['show',`${context.revision}:${path}`],{cwd:context.repo,timeout:10000,maxBuffer:16*1024*1024,windowsHide:true});
      if (blob.status !== 0) throw new Error('Snapshot source unavailable.');
      mkdirSync(dirname(target),{recursive:true}); writeFileSync(target,blob.stdout);
    }
    const secretConfig=join(directory,'gitleaks.toml'), ignore=join(directory,'ignore'), secretReport=join(directory,'secrets.json');
    writeFileSync(secretConfig,'[extend]\nuseDefault = true\n'); writeFileSync(ignore,'');
    const secretRun=scan(tools.gitleaks,['dir',snapshot,'--config',secretConfig,'--gitleaks-ignore-path',ignore,'--ignore-gitleaks-allow','--redact=100','--exit-code=10','--report-format=json','--report-path',secretReport,'--no-banner','--log-level=error','--max-archive-depth=2','--max-decode-depth=2'],directory);
    const secrets=JSON.parse(readFileSync(secretReport,'utf8'));
    if (![0,10].includes(secretRun.status ?? -1) || !Array.isArray(secrets)) throw new Error('Secret scanner failed.');
    const secretFindings=secrets.map(finding=>{
      const path=relative(snapshot,resolve(snapshot,finding.File)).split(sep).join('/');
      return {path,rule:finding.RuleID,line:finding.StartLine,source_digest:digest(rawGit(context.repo,['show',`${context.revision}:${path}`]))};
    });
    const workload=join(snapshot,context.prefix), lockPath=join(workload,'package-lock.json');
    const lock=JSON.parse(readFileSync(lockPath,'utf8'));
    if (lock.lockfileVersion !== 3 || !lock.packages || Array.isArray(lock.packages)) throw new UnsupportedSecurityCapability('Unsupported dependency lockfile.');
    const manifest=JSON.parse(readFileSync(join(workload,'package.json'),'utf8'));
    if (!lock.packages[''] || manifest.workspaces || lock.packages[''].workspaces) throw new UnsupportedSecurityCapability('Workspaces are unsupported.');
    for (const key of ['dependencies','devDependencies','optionalDependencies','peerDependencies']) {
      const expected=Object.entries(manifest[key] ?? {}).sort(), actual=Object.entries(lock.packages[''][key] ?? {}).sort();
      if (JSON.stringify(expected) !== JSON.stringify(actual)) throw new Error('Lockfile dependency declarations do not match the committed manifest.');
    }
    // Registry safety applies before any external query; local/git dependencies cannot silently disappear from the scan.
    for (const [path,pkg] of Object.entries(lock.packages)) {
      if (!path) continue;
      const item=/** @type {{version?:string,resolved?:string,link?:boolean}} */(pkg);
      if (!item.version || item.link || !item.resolved?.startsWith('https://registry.npmjs.org/')) throw new Error('Unsupported dependency registry or package.');
    }
    const osvConfig=join(directory,'osv.toml'), dependencyReport=join(directory,'dependencies.json');
    writeFileSync(osvConfig,'');
    const dependencyRun=scan(tools.osv,['scan','source','--lockfile',lockPath,'--config',osvConfig,'--format=json','--all-packages','--all-vulns','--no-call-analysis','all','--no-resolve','--output-file',dependencyReport],directory);
    const report=JSON.parse(readFileSync(dependencyReport,'utf8'));
    if (![0,1].includes(dependencyRun.status ?? -1) || !Array.isArray(report.results)) throw new Error('Dependency scanner failed.');
    /** @type {import('./security-evaluation.mjs').DependencyFinding[]} */ const findings=[];
    for (const result of report.results) for (const pkg of result.packages ?? []) for (const vuln of pkg.vulnerabilities ?? []) {
      const raw=String(vuln.database_specific?.severity ?? vuln.ecosystem_specific?.severity ?? 'critical').toLowerCase();
      const severity=raw === 'moderate' ? 'medium' : ['info','low','medium','high','critical'].includes(raw) ? raw : 'critical'; // Unknown severity denies conservatively.
      findings.push({package:pkg.package.name,severity:/** @type {import('./security-evaluation.mjs').DependencyFinding['severity']} */(severity),advisory:vuln.id});
    }
    const expected=Object.entries(lock.packages).filter(([path])=>path).map(([path,pkg])=>`${path.split('node_modules/').at(-1)}@${/** @type {{version:string}} */(pkg).version}`).sort();
    const actual=report.results.flatMap((/** @type {{packages:Array<{package:{name:string,version:string,ecosystem:string}}>}} */ result)=>(result.packages ?? []).map(pkg=>{
      if (pkg.package.ecosystem !== 'npm') throw new Error('Unexpected dependency ecosystem.');
      return `${pkg.package.name}@${pkg.package.version}`;
    })).sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('Scanner omitted or changed lockfile packages.');
    const evidence=/** @type {import('./security-evaluation.mjs').Evidence} */ ({version:'1.0',revision:context.revision,tree_digest:context.treeDigest,workload_id:context.contract.workload_id,profile:context.contract.profile,contract_digest:context.contractDigest,tools:versions,secrets:{status:secretFindings.length ? 'findings' : 'clean',exit_code:secretRun.status,findings:secretFindings},dependencies:{status:findings.length ? 'findings' : 'clean',exit_code:dependencyRun.status,findings}});
    if (options['--output']) writeFileSync(options['--output'],JSON.stringify(evidence,null,2)+'\n');
    return evaluateSecurity(options,evidence);
  } catch (error) { return securityError(error instanceof UnsupportedSecurityCapability ? 'unsupported' : 'error'); }
  finally {
    if (directory && scratch) {
      const target=realpathSync(directory), within=relative(scratch,target);
      if (within && within !== '..' && !within.startsWith('..'+sep) && !isAbsolute(within)) rmSync(target,{recursive:true,force:true});
    }
  }
}
