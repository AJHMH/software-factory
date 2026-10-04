import {existsSync,mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {rawGit} from './coverage-evaluation.mjs';
/** @typedef {Record<string, any>} Json */
/** @param {Record<string,string>} options */
export async function updateDependencies(options) {
 /** @type {string | undefined} */ let temporary;
 try {
  const repo=resolve(options['--trusted-repo']??'.'),sha=options['--trusted-revision'];
  if(!/^[a-f0-9]{40}$/.test(sha??'') || rawGit(repo,['cat-file','-t',sha]).trim()!=='commit' || !options['--output']) throw new Error('A trusted commit and output directory are required.');
  const output=resolve(options['--output']),nodeDirectory=dirname(process.execPath),npm=[join(nodeDirectory,'node_modules/npm/bin/npm-cli.js'),resolve(nodeDirectory,'..','lib/node_modules/npm/bin/npm-cli.js')].find(existsSync);
  if(!npm) throw new Error('Selected Node installation must include npm.');
  temporary=mkdtempSync(join(tmpdir(),'factory-dependency-update-'));
  const config=join(temporary,'empty.npmrc');writeFileSync(config,'');
  const proposals=[];
  for(const prefix of ['','examples/reference-workload/']) {
   const manifestSource=rawGit(repo,['show',`${sha}:${prefix}package.json`]),lockSource=rawGit(repo,['show',`${sha}:${prefix}package-lock.json`]);
   const manifest=/** @type {Json} */(JSON.parse(manifestSource)),lock=JSON.parse(lockSource);
   if(manifest.workspaces || lock.lockfileVersion!==3) throw new Error('Unsupported workspace or lockfile.');
   const updates=[];
   for(const section of ['dependencies','devDependencies','optionalDependencies','peerDependencies']) {
    for(const [name,current] of Object.entries(manifest[section]??{})) {
     if(!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(name) || typeof current!=='string' || !/^[~^]?(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(current)) throw new Error('Unsupported dependency declaration.');
     const original=current.replace(/^[~^]/,''),major=Number(original.split('.')[0]);
     const response=await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`,{headers:{Accept:'application/vnd.npm.install-v1+json'},redirect:'error',signal:AbortSignal.timeout(15000)});
     if(!response.ok) throw new Error('npm registry is unavailable.');
     const text=await response.text();if(text.length>16*1024*1024) throw new Error('Registry response is too large.');
     const metadata=JSON.parse(text);if(metadata.name!==name || !metadata.versions || typeof metadata.versions!=='object') throw new Error('Registry identity mismatch.');
     const versions=Object.keys(metadata.versions).filter(version=>/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version) && Number(version.split('.')[0])===major && !metadata.versions[version].deprecated);
     versions.sort((a,b)=>{const x=a.split('.').map(Number),y=b.split('.').map(Number);return x[0]-y[0] || x[1]-y[1] || x[2]-y[2];});
     const newest=versions.at(-1);if(!newest) throw new Error('No supported release was found.');
     const a=original.split('.').map(Number),b=newest.split('.').map(Number);if(b[1]<a[1] || b[1]===a[1] && b[2]<=a[2]) continue;
     manifest[section][name]=(current.startsWith('^')?'^':current.startsWith('~')?'~':'')+newest;updates.push({name,before:original,after:newest});
    }
   }
   if(!updates.length) {proposals.push({directory:prefix||'.',updates,changed:false});continue;}
   const workspace=join(temporary,prefix||'factory');mkdirSync(workspace,{recursive:true});
   writeFileSync(join(workspace,'package.json'),JSON.stringify(manifest,null,2)+'\n');writeFileSync(join(workspace,'package-lock.json'),lockSource);
   /** @type {NodeJS.ProcessEnv} */ const env={};
   for(const key of ['PATH','Path','SystemRoot','SYSTEMROOT','SystemDrive','TEMP','TMP']) if(process.env[key]) env[key]=process.env[key];
   Object.assign(env,{NPM_CONFIG_USERCONFIG:config,NPM_CONFIG_GLOBALCONFIG:config,NPM_CONFIG_CACHE:join(temporary,'cache'),NPM_CONFIG_REGISTRY:'https://registry.npmjs.org/',NPM_CONFIG_IGNORE_SCRIPTS:'true'});
   const result=spawnSync(process.execPath,[npm,'install','--package-lock-only','--ignore-scripts','--no-audit','--no-fund'],{cwd:workspace,env,encoding:'utf8',timeout:120000,maxBuffer:1024*1024});
   if(result.status!==0 || result.error) throw new Error('npm failed to resolve the proposal.');
   const destination=join(output,prefix);mkdirSync(destination,{recursive:true});for(const name of ['package.json','package-lock.json']) writeFileSync(join(destination,name),readFileSync(join(workspace,name)));
   proposals.push({directory:prefix||'.',updates,changed:true});
  }
  mkdirSync(output,{recursive:true});writeFileSync(join(output,'proposal.json'),JSON.stringify({version:'1.0',revision:sha,proposals},null,2)+'\n');
  return {operation:'dependency-update',outcome:'passed',revision:sha,proposals,results:[{capability:'dependency-automation',required:true,status:'passed',reason:'npm registry versions were inspected and applicable package/lockfile proposals resolved without lifecycle scripts or write credentials. Proposals are not approval or merge evidence.'}]};
 } catch {return {operation:'dependency-update',outcome:'blocked',results:[{capability:'dependency-automation',required:true,status:'error',reason:'The updater could not produce complete npm proposals. Check the trusted revision, npm installation, supported declarations, and registry access.'}]};}
 finally {if(temporary) rmSync(temporary,{recursive:true,force:true});}
}
