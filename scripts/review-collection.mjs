import { writeFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { evaluateHumanReview, reviewContext, reviewError } from './human-review.mjs';
import { rawGit } from './coverage-evaluation.mjs';

/** @typedef {{id:number,user:{login:string,type:'User'|'Bot'},state:string,commit_id:string,submitted_at:string|null}} GitHubReview */
/** @param {string} path */
async function api(path) {
  if(!process.env.FACTORY_GITHUB_TOKEN) throw new Error('GitHub authentication unavailable.');
  const response=await fetch(`https://api.github.com/${path}`,{headers:{Authorization:`Bearer ${process.env.FACTORY_GITHUB_TOKEN}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2026-03-10'},signal:AbortSignal.timeout(30000),redirect:'error'});
  if(!response.ok) throw new Error('Review evidence unavailable.');
  const text=await response.text();if(text.length > 8*1024*1024) throw new Error('Response too large.');
  return JSON.parse(text);
}

/** Complete pagination; never accept a truncated review history. @param {string} path @returns {Promise<unknown[]>} */
async function list(path) {
  const result=[];
  for(let page=1;page<=100;page++) {
    const entries=await api(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
    if(!Array.isArray(entries)) throw new Error('Invalid list.');
    result.push(...entries);if(entries.length < 100) return result;
  }
  throw new Error('Pagination exceeds supported limit.');
}

/** Extract only one bounded JSON file; never write archive paths to disk. @param {Buffer} zip */
function coverageJson(zip) {
  let end=-1;
  for(let offset=zip.length-22;offset>=Math.max(0,zip.length-65557);offset--) if(zip.readUInt32LE(offset) === 0x06054b50) {end=offset;break;}
  if(end < 0 || zip.readUInt16LE(end+10) !== 1 || zip.readUInt16LE(end+8) !== 1 || zip.readUInt16LE(end+4) !== 0 || zip.readUInt16LE(end+6) !== 0) throw new Error('Unsupported evidence archive.');
  const central=zip.readUInt32LE(end+16);
  if(zip.readUInt32LE(central) !== 0x02014b50 || (zip.readUInt16LE(central+8)&1)) throw new Error('Invalid archive directory.');
  const method=zip.readUInt16LE(central+10), compressed=zip.readUInt32LE(central+20), size=zip.readUInt32LE(central+24), nameLength=zip.readUInt16LE(central+28), local=zip.readUInt32LE(central+42);
  if(size > 8*1024*1024 || zip.subarray(central+46,central+46+nameLength).toString('utf8') !== 'evidence.json' || zip.readUInt32LE(local) !== 0x04034b50) throw new Error('Invalid coverage artifact.');
  const start=local+30+zip.readUInt16LE(local+26)+zip.readUInt16LE(local+28);
  if(start+compressed > central) throw new Error('Invalid archive bounds.');
  const data=zip.subarray(start,start+compressed);
  const output=method === 0 ? data : method === 8 ? inflateRawSync(data,{maxOutputLength:8*1024*1024}) : undefined;
  if(!output || output.length !== size) throw new Error('Incomplete evidence archive.');
  return output.toString('utf8');
}

/** Find the coverage run for this PR head, never a different branch or earlier head. @param {string} repository @param {number} pull @param {string} revision */
async function coverageArtifact(repository,pull,revision) {
  const deadline=Date.now()+240000;
  while(true) {
    const response=await api(`repos/${repository}/actions/workflows/factory-coverage.yml/runs?event=pull_request&head_sha=${revision}&per_page=100`);
    if(!Array.isArray(response.workflow_runs)) throw new Error('Invalid coverage runs.');
    const run=response.workflow_runs.find(/** @param {{head_sha:string,event:string,pull_requests:Array<{number:number}>,status:string}} entry */(entry)=>entry.head_sha === revision && entry.event === 'pull_request' && entry.pull_requests.some(pr=>pr.number === pull) && entry.status === 'completed');
    if(run) {
      const envelope=await api(`repos/${repository}/actions/runs/${run.id}/artifacts?per_page=100`);
      if(!Array.isArray(envelope.artifacts) || envelope.total_count !== envelope.artifacts.length) throw new Error('Incomplete artifact inventory.');
      const artifacts=/** @type {Array<{id:number,name:string,expired:boolean}>} */(envelope.artifacts).filter(artifact=>artifact.name === `factory-coverage-${revision}` && !artifact.expired);
      if(artifacts.length !== 1) throw new Error('Missing or ambiguous coverage artifact.');
      const redirect=await fetch(`https://api.github.com/repos/${repository}/actions/artifacts/${artifacts[0].id}/zip`,{headers:{Authorization:`Bearer ${process.env.FACTORY_GITHUB_TOKEN}`,'X-GitHub-Api-Version':'2026-03-10'},redirect:'manual',signal:AbortSignal.timeout(30000)});
      if(redirect.status !== 302) throw new Error('Artifact download unavailable.');
      const destination=new URL(redirect.headers.get('location') ?? '');
      if(destination.protocol !== 'https:' || destination.username || destination.password || !destination.hostname.endsWith('.blob.core.windows.net')) throw new Error('Unsupported artifact origin.');
      // The short-lived archive URL is data. Never forward the GitHub token to blob storage.
      const downloaded=await fetch(destination,{redirect:'error',signal:AbortSignal.timeout(30000)});
      if(!downloaded.ok) throw new Error('Artifact unavailable.');
      const archive=Buffer.from(await downloaded.arrayBuffer());
      if(archive.length > 8*1024*1024) throw new Error('Artifact exceeds supported limit.');
      return coverageJson(archive);
    }
    if(Date.now() >= deadline) throw new Error('Coverage evidence unavailable for this head.');
    await new Promise(resolve=>setTimeout(resolve,10000));
  }
}

/** @param {Record<string,string>} options */
export async function collectReviews(options) {
  try {
    const context=reviewContext(options), repository=options['--repository'], pull=options['--pull-request'];
    if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? '') || !/^[1-9][0-9]*$/.test(pull ?? '')) throw new Error('Invalid PR identity.');
    const endpoint=`repos/${repository}/pulls/${pull}`, pr=await api(endpoint);
    const merged=options['--merged-revision'];
    const expectedState=merged ? 'closed' : 'open';
    const validMerge=/** @param {any} value */(value)=>!merged || /^[a-f0-9]{40}$/.test(merged) && value.merged === true && value.merge_commit_sha === merged && rawGit(context.repo,['rev-parse',`${merged}^1`]).trim() === context.base;
    if(pr.state !== expectedState || !validMerge(pr) || pr.head.sha !== context.revision || pr.base.sha !== context.base || pr.base.repo.full_name.toLowerCase() !== repository.toLowerCase()) throw new Error('PR identity changed.');
    const reviews=/** @type {GitHubReview[]} */(await list(`${endpoint}/reviews`));
    /** @type {Map<string,string>} */ const permissions=new Map();
    const normalized=[];
    for(const review of reviews) {
      if(review.state === 'PENDING') continue; // Unsubmitted drafts have no approval authority.
      const login=review.user.login;
      if(!/^[A-Za-z0-9_-]+(?:\[bot\])?$/.test(login)) throw new Error('Invalid reviewer identity.');
      if(!permissions.has(login.toLowerCase())) {
        const permission=review.user.type === 'Bot' ? 'none' : (await api(`repos/${repository}/collaborators/${encodeURIComponent(login)}/permission`)).permission;
        permissions.set(login.toLowerCase(),permission);
      }
      normalized.push({id:review.id,login,type:review.user.type,state:review.state,commit_id:review.commit_id,submitted_at:review.submitted_at ?? '',permission:permissions.get(login.toLowerCase()) ?? 'none'});
    }
    const evidence=/** @type {import('./human-review.mjs').ReviewEvidence} */({version:'1.0',repository,pull_request:Number(pull),revision:pr.head.sha,base_revision:pr.base.sha,author:pr.user.login,reviews:normalized});
    let evaluationOptions=options;
    const files=rawGit(context.repo,['diff','--no-ext-diff','--no-textconv','--no-renames','--name-only','-z',context.base,context.revision]).split('\0').filter(Boolean);
    const needsCoverage=context.policy.conditional_triggers.decrease_in_test_coverage && files.some(path=>path === context.contractRelative || !context.workload || path.startsWith(context.workload+'/'));
    if(options['--coverage-evidence'] === 'github' && needsCoverage) {
      const source=await coverageArtifact(repository,Number(pull),context.revision);
      if(!options['--output']) throw new Error('Output directory required for collected evidence.');
      const filename=options['--output']+'.coverage.json';
      writeFileSync(filename,source);evaluationOptions={...options,'--coverage-evidence':filename};
    }
    const current=await api(endpoint);
    if(current.head.sha !== context.revision || current.base.sha !== context.base || current.state !== expectedState || !validMerge(current)) throw new Error('PR changed during collection.');
    if(JSON.stringify(await list(`${endpoint}/reviews`)) !== JSON.stringify(reviews)) throw new Error('Reviews changed during collection.');
    if(options['--output']) writeFileSync(options['--output'],JSON.stringify(evidence,null,2)+'\n');
    return evaluateHumanReview(evaluationOptions,evidence);
  } catch {return reviewError('GitHub review or coverage evidence is inaccessible, incomplete, or no longer current. Inspect the PR and re-run the gate.');}
}
