import { readFileSync, writeFileSync, mkdirSync, lstatSync, realpathSync, existsSync, openSync, closeSync, unlinkSync, renameSync, readdirSync, rmSync, constants } from 'node:fs';
import { resolve, dirname, relative, isAbsolute, sep, join, delimiter } from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { parse } from 'yaml';
import Ajv from 'ajv';
import { digest } from './policy-evaluation.mjs';

/** @typedef {{max_retries:number,max_duration_ms:number,budget_microusd:number,cost_per_attempt_microusd:number,max_actions:number,max_total_bytes:number,retention_days:number,allowed_paths:string[],restricted_paths:string[]}} Policy */
/** @typedef {{tool:string,path:string,content:string}} Action */
/** @typedef {{version:string,adapter:string,actions:Action[],fixture?:{failures_before_success?:number,delay_ms?:number}}} Proposal */
/** @typedef {{scope:string,actor:string,repository:string,revision:string,trustedRevision:string,policyDigest:string,proposalDigest:string,createdAt:number,deadlineAt:number,attempts:number,spentMicrousd:number,status:string,reason:string,actions:Array<{tool:string,path:string,contentDigest:string}>,evidenceExpiresAt:number}} Ledger */
const validateProposal=new Ajv.default({strict:true}).compile(JSON.parse(readFileSync(new URL('../schemas/agent-proposal.schema.json',import.meta.url),'utf8')));
const forbidden=['.git/','.github/','policies/','scripts/','schemas/','profiles/','infrastructure/production/'];
/** Resolve only trusted host PATH entries, never the source checkout or current-directory executable search. @param {string} repository */
function gitProgram(repository) {
  for(const directory of (process.env.PATH ?? '').split(delimiter)) {
    if(!isAbsolute(directory)) continue;
    const program=join(directory,process.platform === 'win32'?'git.exe':'git');
    if(!existsSync(program)) continue;
    const canonical=realpathSync(program),within=relative(resolve(repository),canonical);
    if(!within || (!isAbsolute(within) && within !== '..' && !within.startsWith('..'+sep))) continue;
    return canonical;
  }
  throw new Error('host git');
}
/** @param {string} repository @param {string[]} args */
function git(repository,args) {
  const result=spawnSync(gitProgram(repository),args,{cwd:repository,encoding:'utf8',maxBuffer:1048576,timeout:10000,windowsHide:true});
  if(result.status !== 0) throw new Error('git');return result.stdout.trim();
}
/** @param {string} path */
function safePath(path) {
  return /^[A-Za-z0-9_./-]+$/.test(path) && !path.startsWith('/') && path.split('/').every(part=>part && part !== '.' && part !== '..' && !/[. ]$/.test(part) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part));
}
/** @param {string} path @param {string[]} prefixes */
function under(path,prefixes) {return prefixes.some(prefix=>path.toLowerCase().startsWith(prefix.toLowerCase()));}
/** @param {string} path */
function noLinks(path) {
  let current=resolve(path);
  while(true) {if(existsSync(current) && lstatSync(current).isSymbolicLink()) throw new Error('links');const parent=dirname(current);if(parent === current) break;current=parent;}
}
/** @param {string} path @param {boolean} fresh */
function privateState(path,fresh) {
  noLinks(path);
  if(process.platform === 'win32') {
    // Fixed host operation: proposal data is never inserted into PowerShell source.
    const script="$ErrorActionPreference='Stop'; $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User; $p=$env:FACTORY_AGENT_STATE; if($env:FACTORY_ACL_CREATE -eq '1') {$acl=[Security.AccessControl.DirectorySecurity]::new(); $acl.SetOwner($sid); $acl.SetAccessRuleProtection($true,$false); $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow')); Set-Acl -LiteralPath $p -AclObject $acl}; $acl=Get-Acl -LiteralPath $p; if($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value) {throw 'owner'}; foreach($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])) {if($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Value -ne $sid.Value) {throw 'access'}}";
    /** @type {NodeJS.ProcessEnv} */ const aclEnvironment={...process.env,FACTORY_AGENT_STATE:path,FACTORY_ACL_CREATE:fresh?'1':'0'}; delete aclEnvironment.PSModulePath;
    const powershell=join(process.env.SystemRoot ?? 'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
    const result=spawnSync(powershell,['-NoProfile','-NonInteractive','-Command',script],{env:aclEnvironment,encoding:'utf8',timeout:10000,windowsHide:true});
    if(result.status !== 0) throw new Error('access');
  } else {const stat=lstatSync(path);if((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.()) throw new Error('access');}
}
/** @param {string} filename @param {Ledger} value */
function save(filename,value) {
  const temporary=filename+'.'+randomUUID();writeFileSync(temporary,JSON.stringify(value),{mode:0o600,flag:'wx'});renameSync(temporary,filename);
}
/** @param {Record<string,string>} options */
function authority(options) {
  const sha=options['--trusted-revision'];
  if(!/^[a-f0-9]{40}$/.test(sha ?? '') || git(options['--trusted-repo'] ?? '.',['cat-file','-t',sha]) !== 'commit') throw new Error('policy');
  const source=git(options['--trusted-repo'] ?? '.',['show',`${sha}:policies/agents.yaml`]),document=parse(source);
  const policy=/** @type {Policy} */(document?.agents?.runner);
  const bounds={max_retries:[0,10],max_duration_ms:[1,300000],budget_microusd:[0,100000000],cost_per_attempt_microusd:[1,100000000],max_actions:[1,100],max_total_bytes:[1,1048576],retention_days:[1,365]};
  if(!['1.0',1].includes(document?.version) || !policy || Object.entries(bounds).some(([key,[min,max]])=>!Number.isSafeInteger(/** @type {any} */(policy)[key]) || /** @type {any} */(policy)[key] < min || /** @type {any} */(policy)[key] > max) || Object.keys(policy).some(key=>!Object.hasOwn(bounds,key) && !['allowed_paths','restricted_paths'].includes(key)) || [policy.allowed_paths,policy.restricted_paths].some(paths=>!Array.isArray(paths) || !paths.length || paths.some(p=>!p.endsWith('/') || !safePath(p.slice(0,-1))))) throw new Error('policy');
  return {policy,policyDigest:digest(source),sha};
}
/** @param {Record<string,string>} options */
export async function proposeChange(options) {
  /** @type {Ledger|undefined} */ let ledger;
  let ledgerFile='',workspace='',scopeDirectory='',locked=false,cancelled=false;
  const cancel=()=>{cancelled=true;};process.on('SIGINT',cancel);process.on('SIGTERM',cancel);
  let reason='Invalid request, policy, state, or private access controls; no authority is inferred from proposal context.';
  try {
    const {policy,policyDigest,sha}=authority(options),scope=options['--scope-id'],actor=options['--actor'];
    if(!/^[A-Za-z0-9_-]{1,64}$/.test(scope ?? '') || !/^[A-Za-z0-9_-]{1,64}$/.test(actor ?? '')) throw new Error('identity');
    const repository=realpathSync(options['--repository-path']),revision=git(repository,['rev-parse','HEAD']);
    const state=resolve(options['--state-dir']);noLinks(state);
    const within=relative(repository,state);if(!within || (!isAbsolute(within) && within !== '..' && !within.startsWith('..'+sep))) throw new Error('state inside source');
    const fresh=!existsSync(state);mkdirSync(state,{recursive:true,mode:0o700});privateState(state,fresh);
    scopeDirectory=join(state,digest(scope));mkdirSync(scopeDirectory,{recursive:true,mode:0o700});
    noLinks(scopeDirectory);workspace=join(scopeDirectory,'workspace');ledgerFile=join(scopeDirectory,'ledger.json');
    const lock=join(scopeDirectory,'lock');closeSync(openSync(lock,'wx',0o600));locked=true;
    noLinks(options['--proposal']);if(lstatSync(options['--proposal']).size > 1048576) throw new Error('proposal size');
    const proposalSource=readFileSync(options['--proposal'],'utf8'),proposalDigest=digest(proposalSource),proposal=/** @type {Proposal} */(JSON.parse(proposalSource));
    if(!validateProposal(proposal)) throw new Error('proposal');
    if(existsSync(ledgerFile)) {
      noLinks(ledgerFile);ledger=JSON.parse(readFileSync(ledgerFile,'utf8'));
      if(!ledger || ledger.scope !== scope || ledger.repository !== repository || ledger.revision !== revision || ledger.actor !== actor || ledger.policyDigest !== policyDigest || ledger.trustedRevision !== sha || ledger.proposalDigest !== proposalDigest || !Number.isSafeInteger(ledger.attempts) || ledger.attempts < 0 || ledger.attempts > policy.max_retries+1 || !Number.isSafeInteger(ledger.spentMicrousd) || ledger.spentMicrousd !== ledger.attempts*policy.cost_per_attempt_microusd || !Number.isFinite(ledger.deadlineAt) || !Number.isFinite(ledger.createdAt) || !Array.isArray(ledger.actions)) {ledger=undefined;throw new Error('state');}
      if(ledger.status !== 'running') return output(ledger,workspace,true);
      reason='Interrupted task requires operator recovery; its reservations are retained.';throw new Error('interrupted');
    }
    const now=Date.now();ledger={scope,actor,repository,revision,trustedRevision:sha,policyDigest,proposalDigest,createdAt:now,deadlineAt:now+policy.max_duration_ms,attempts:0,spentMicrousd:0,status:'running',reason:'Task reserved.',actions:[],evidenceExpiresAt:now+policy.retention_days*86400000};save(ledgerFile,ledger);
    if(proposal.adapter !== 'fixture') {reason='Adapter cost and isolation cannot be bounded safely; no vendor operation started.';throw new Error('adapter');}
    if(proposal.actions.length > policy.max_actions || proposal.actions.reduce((n,a)=>n+Buffer.byteLength(a.content),0) > policy.max_total_bytes) {reason='Proposal exceeds action or byte limits.';throw new Error('limits');}
    const paths=new Set();
    for(const action of proposal.actions) {
      if(action.tool !== 'write_file' || !safePath(action.path) || !under(action.path,policy.allowed_paths) || under(action.path,[...forbidden,...policy.restricted_paths]) || paths.has(action.path.toLowerCase())) {reason='Tool or path denied by the broker; proposal instructions cannot override boundaries.';throw new Error('boundary');}
      paths.add(action.path.toLowerCase());
    }
    const check=()=>{
      if(cancelled || (options['--cancel-file'] && existsSync(options['--cancel-file']))) {reason='Task cancelled; reservations are retained.';throw new Error('cancel');}
      if(!ledger || Date.now() < ledger.createdAt || Date.now() >= ledger.deadlineAt) {reason='Task time limit exceeded; reservations are retained.';throw new Error('deadline');}
    };
    check();mkdirSync(workspace,{mode:0o700});
    // Only committed regular files are input. No checkout hooks or workload commands run.
    let snapshotBytes=0,snapshotFiles=0;
    const tree=spawnSync(gitProgram(repository),['ls-tree','-r',revision],{cwd:repository,encoding:'utf8',maxBuffer:1048576,timeout:Math.max(1,Math.min(1000,ledger.deadlineAt-Date.now())),windowsHide:true});check();
    if(tree.status !== 0) throw new Error('snapshot');
    for(const entry of tree.stdout.split('\n')) {
      check();
      const match=/^(\d+) blob ([a-f0-9]{40})\t(.+)$/.exec(entry);if(!match) continue;
      const [,mode,,path]=match;
      if(!under(path,policy.allowed_paths) || under(path,[...forbidden,...policy.restricted_paths])) continue;
      if(!safePath(path) || !['100644','100755'].includes(mode) || ++snapshotFiles > 1000) {reason='Snapshot contains an unsafe file, link, or excess file count.';throw new Error('snapshot');}
      const result=spawnSync(gitProgram(repository),['show',`${revision}:${path}`],{cwd:repository,maxBuffer:1048576,timeout:Math.max(1,Math.min(1000,ledger.deadlineAt-Date.now())),windowsHide:true});check();
      if(result.status !== 0 || (snapshotBytes+=result.stdout.length) > 1048576) throw new Error('snapshot size');
      const destination=join(workspace,path);mkdirSync(dirname(destination),{recursive:true,mode:0o700});writeFileSync(destination,result.stdout,{mode:0o600,flag:'wx'});
    }
    for(let attempt=0;attempt<=policy.max_retries;attempt++) {
      check();if(ledger.spentMicrousd+policy.cost_per_attempt_microusd > policy.budget_microusd) {reason='Spending limit reached before another adapter attempt.';throw new Error('budget');}
      ledger.attempts++;ledger.spentMicrousd+=policy.cost_per_attempt_microusd;save(ledgerFile,ledger);
      const end=performance.now()+(proposal.fixture?.delay_ms ?? 0);
      while(performance.now()<end) {await new Promise(resolve=>setTimeout(resolve,10));check();}
      if(attempt < (proposal.fixture?.failures_before_success ?? 0)) continue;
      for(const action of proposal.actions) {
        check();const destination=join(workspace,action.path);noLinks(destination);mkdirSync(dirname(destination),{recursive:true,mode:0o700});
        if(existsSync(destination) && (!lstatSync(destination).isFile() || lstatSync(destination).nlink !== 1)) throw new Error('unsafe destination');
        const fd=openSync(destination,constants.O_WRONLY|constants.O_CREAT|constants.O_TRUNC|(constants.O_NOFOLLOW ?? 0),0o600);
        try{writeFileSync(fd,action.content);}finally{closeSync(fd);}
        ledger.actions.push({tool:'write_file',path:action.path,contentDigest:digest(action.content)});save(ledgerFile,ledger);
      }
      check();ledger.status='passed';ledger.reason='Bounded fixture proposal applied in a private workspace; source repository was not changed.';save(ledgerFile,ledger);return output(ledger,workspace,false);
    }
    reason='Retry limit exhausted; no further adapter attempt is authorized.';throw new Error('retries');
  } catch {
    if(ledger) {ledger.status=cancelled || reason.startsWith('Task cancelled')?'cancelled':'blocked';ledger.reason=reason;try{save(ledgerFile,ledger);}catch{}}
    return ledger?output(ledger,workspace,false):{operation:'agent-proposal',outcome:'blocked',results:[{capability:'bounded-agent-proposal',required:true,status:'error',reason}]};
  } finally {
    process.off('SIGINT',cancel);process.off('SIGTERM',cancel);
    if(locked) {try{unlinkSync(join(scopeDirectory,'lock'));}catch{ /* A retained lock fails closed on the next request. */ }}
  }
}
/** @param {Ledger} ledger @param {string} workspace @param {boolean} replay */
function output(ledger,workspace,replay) {
  return {operation:'agent-proposal',outcome:ledger.status === 'passed'?'passed':'blocked',scope:ledger.scope,actor:ledger.actor,revision:ledger.revision,trustedRevision:ledger.trustedRevision,policyDigest:ledger.policyDigest,proposalDigest:ledger.proposalDigest,workspace,attempts:ledger.attempts,replay,cost:{unit:'microusd',spentMicrousd:ledger.spentMicrousd,source:'trusted fixed fixture reservation; no vendor billing'},actions:ledger.actions,evidence:{expiresAt:ledger.evidenceExpiresAt,access:'OS owner only; budget ledger retained to prevent replay resets'},results:[{capability:'bounded-agent-proposal',required:true,status:ledger.status === 'passed'?'passed':'failed',reason:ledger.reason}]};
}

/** Owner-only evidence cleanup keeps budget/replay reservations. @param {Record<string,string>} options */
export function pruneAgentEvidence(options) {
  try {
    const {policy}=authority(options),state=realpathSync(options['--state-dir']);privateState(state,false);
    let pruned=0;
    for(const scope of readdirSync(state)) {
      if(!/^[a-f0-9]{64}$/.test(scope)) continue;
      const directory=join(state,scope);noLinks(directory);
      const lock=join(directory,'lock');
      try{closeSync(openSync(lock,'wx',0o600));}catch{continue;}
      try {
      const filename=join(directory,'ledger.json');noLinks(filename);
      const ledger=/** @type {Ledger} */(JSON.parse(readFileSync(filename,'utf8')));
      if(!Number.isFinite(ledger.createdAt) || !Number.isFinite(ledger.evidenceExpiresAt) || !Number.isSafeInteger(ledger.attempts) || !Number.isSafeInteger(ledger.spentMicrousd)) throw new Error('ledger');
      if(ledger.status === 'expired' || Date.now() < Math.min(ledger.evidenceExpiresAt,ledger.createdAt+policy.retention_days*86400000)) continue;
      const workspace=join(directory,'workspace');
      const inspect=(/** @type {string} */ path)=>{noLinks(path);if(lstatSync(path).isDirectory()) for(const child of readdirSync(path)) inspect(join(path,child));};
      if(existsSync(workspace)) {inspect(workspace);if(relative(directory,realpathSync(workspace)) !== 'workspace') throw new Error('outside state');rmSync(workspace,{recursive:true,force:true});}
      ledger.actions=[];ledger.status='expired';ledger.reason='Evidence expired; budget and replay reservations remain retained.';save(filename,ledger);pruned++;
      } finally {unlinkSync(lock);}
    }
    return {operation:'agent-evidence-retention',outcome:'passed',pruned,results:[{capability:'bounded-agent-proposal',required:true,status:'passed',reason:'Expired workspaces and action details removed; budget reservations retained.'}]};
  } catch {return {operation:'agent-evidence-retention',outcome:'blocked',results:[{capability:'bounded-agent-proposal',required:true,status:'error',reason:'Evidence cleanup requires intact private state and trusted retention policy.'}]};}
}
