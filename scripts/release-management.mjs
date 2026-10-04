import {createHash} from 'node:crypto';
import {appendFileSync,existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {parse} from 'yaml';
import {rawGit} from './coverage-evaluation.mjs';

/** @typedef {Record<string, any>} Json */
/** @param {string|Buffer|Uint8Array} value */ const sha256=value=>createHash('sha256').update(value).digest('hex');
/** @param {unknown} value */ const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
/** @param {string} reason */ const blocked=reason=>({operation:'release',outcome:'blocked',results:[{capability:'versioned-signed-release',required:true,status:'failed',reason}]});
/** @param {string} repo @param {string[]} args */ function git(repo,args){return rawGit(repo,args).trim();}
/** @param {string} path */ function jsonFile(path){const value=JSON.parse(readFileSync(path,'utf8'));if(!object(value))throw new Error('Expected a JSON object.');return value;}
/** @param {Json} run @param {string} id @param {string} workflow @param {string} revision @param {string} repository @param {string[]|undefined} actors @param {string} [event] */
export function assertWorkflowRun(run,id,workflow,revision,repository,actors,event='workflow_dispatch'){
 if(!object(run)||String(run.id)!==id||run.repository?.full_name!==repository||run.path!==workflow||run.head_sha!==revision||run.head_branch!=='main'||run.event!==event||run.status!=='completed'||run.conclusion!=='success'||actors&&!actors.includes(run.actor?.login)) throw new Error('The source artifact or certification did not come from its successful, authorized, exact-revision GitHub workflow run.');
}
/** @param {{subject:string,body:string}} commit */ function conventional(commit){
 const match=/^([a-z][a-z0-9-]*)(?:\([^)\r\n]+\))?(!)?: (.+)$/.exec(commit.subject);
 if(!match)return undefined;
 const breaking=Boolean(match[2])||/^BREAKING CHANGE(?::|\s)/m.test(commit.body)||/^BREAKING-CHANGE(?::|\s)/m.test(commit.body);
 const type=match[1],bump=breaking?'major':type==='feat'?'minor':['fix','perf','revert'].includes(type)?'patch':undefined;
 return {type,subject:match[3],breaking,bump};
}
/** @param {string} repo @param {string} revision @param {string|undefined} lastTag */ function commits(repo,revision,lastTag){
 const range=lastTag?`${lastTag}..${revision}`:revision;
 const result=git(repo,['log',range,'--reverse','--format=%H%x1f%s%x1f%b%x1e']);
 if(!result)return [];
 return result.split('\x1e').filter(Boolean).map(record=>{const [sha,subject,...body]=record.split('\x1f');return {sha,subject,body:body.join('\x1f').trim()};});
}
/** Public release preparation interface. It never writes to GitHub. @param {Record<string,string>} options */
export function prepareRelease(options){
 try{
  const repo=resolve(options['--trusted-repo']??'.'),revision=options['--source-revision'],repository=options['--repository'],actor=options['--actor'];
  if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository??'')||!/^[a-f0-9]{40}$/.test(revision??'')||git(repo,['cat-file','-t',revision])!=='commit')throw new Error('A repository and exact source commit are required.');
  const policySource=git(repo,['show',`${revision}:policies/release.yaml`]),policy=parse(policySource)?.release;
  if(!object(policy)||policy.versioning?.strategy!=='semantic'||policy.versioning?.require_conventional_commits!==true||!/^\d+\.\d+\.\d+$/.test(policy.versioning?.initial_version??'')||!/^([a-f0-9]{40})$/.test(policy.versioning?.first_release_baseline??'')||!Array.isArray(policy.changelog?.exclude_commit_types)||!Array.isArray(policy.authorization?.authorized_actors)||!policy.authorization.authorized_actors.length)throw new Error('Trusted release policy is missing or unsupported.');
  const actors=policy.authorization.authorized_actors;
  if(!actors.includes(actor??''))throw new Error('The requesting GitHub user is not authorized by trusted release policy.');
  if(!/^\d{1,20}$/.test(options['--certificate-run']??'')||!/^\d{1,20}$/.test(options['--producer-run']??'')||!options['--certificate-run-metadata']||!options['--producer-run-metadata'])throw new Error('Successful certification and producer workflow run IDs and metadata are required.');
  assertWorkflowRun(jsonFile(options['--certificate-run-metadata']),options['--certificate-run'],'.github/workflows/factory-certify-release.yml',revision,repository,actors);
  assertWorkflowRun(jsonFile(options['--producer-run-metadata']),options['--producer-run'],'.github/workflows/factory-ci.yml',revision,repository,undefined,'push');
  const certificate=jsonFile(options['--certificate']),certificateBytes=readFileSync(options['--certificate']);
  if(certificate.operation!=='certify'||certificate.outcome!=='certified'||certificate.schemaVersion!==1||certificate.repository?.toLowerCase()!==repository.toLowerCase()||certificate.revision!==revision||!/^([a-f0-9]{64})$/.test(certificate.artifact?.sha256??'')||!/^([a-f0-9]{64})$/.test(certificate.artifact?.sbomSha256??''))throw new Error('A successful release certificate for this exact source revision and repository is required.');
  const artifactDir=resolve(options['--artifact-directory']),artifact=readFileSync(join(artifactDir,'reference-workload.mjs')),sbom=readFileSync(join(artifactDir,'sbom.spdx.json')),source=jsonFile(join(artifactDir,'source-evidence.json'));
  if(sha256(artifact)!==certificate.artifact.sha256||sha256(sbom)!==certificate.artifact.sbomSha256||source.source?.revision!==revision||source.artifact?.sha256!==certificate.artifact.sha256||source.sbom?.sha256!==certificate.artifact.sbomSha256)throw new Error('The artifact bundle does not match the certified source revision and digests.');
  const latest=git(repo,['tag','--list','v[0-9]*','--merged',revision,'--sort=-version:refname']).split(/\r?\n/).find(tag=>/^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(tag));
  const baseline=latest??policy.versioning.first_release_baseline;
  if(git(repo,['cat-file','-t',baseline])!=='commit'||git(repo,['merge-base','--is-ancestor',baseline,revision])!=='')throw new Error('The latest release tag or configured first-release baseline is missing or outside source history.');
  let version=latest?latest.slice(1).split('.').map(Number):policy.versioning.initial_version.split('.').map(Number);
  const rangeCommits=commits(repo,revision,baseline),parsed=rangeCommits.map(commit=>({...commit,conventional:conventional(commit)}));
  if(!parsed.length)throw new Error('There are no commits since the last release tag.');
  if(policy.versioning.require_conventional_commits&&parsed.some(item=>!item.conventional))throw new Error('Every commit since the latest release must follow Conventional Commit syntax.');
  let bump='none';for(const item of parsed){const next=item.conventional?.bump;if(next==='major'||next==='minor'&&bump!=='major'||next==='patch'&&bump==='none')bump=next;}
  if(bump==='none')throw new Error('No release-worthy Conventional Commit was found since the last version.');
  if(bump==='major')version=[version[0]+1,0,0];else if(bump==='minor')version=[version[0],version[1]+1,0];else version=[version[0],version[1],version[2]+1];
  const tag=`v${version.join('.')}`,existing=git(repo,['tag','--list',tag]);if(existing)throw new Error(`Release tag ${tag} already exists.`);
  const excluded=new Set(policy.changelog.exclude_commit_types),notes=parsed.filter(item=>item.conventional&&!excluded.has(item.conventional.type)).map(item=>`- ${item.conventional?.subject} (${item.sha.slice(0,7)})`);
  if(!notes.length)notes.push('- No user-facing changes; all commits matched the configured changelog exclusions.');
  const output=resolve(options['--output-directory']);if(!options['--output-directory']||existsSync(output))throw new Error('Release output must be a new directory.');
  mkdirSync(output,{recursive:true});mkdirSync(join(output,'assets'));
  writeFileSync(join(output,'assets','reference-workload.mjs'),artifact,{flag:'wx'});writeFileSync(join(output,'assets','sbom.spdx.json'),sbom,{flag:'wx'});writeFileSync(join(output,'assets','release-certificate.json'),certificateBytes,{flag:'wx'});
  const manifest={schemaVersion:1,repository,version,tag,sourceRevision:revision,certification:{sha256:sha256(certificateBytes),artifactSha256:certificate.artifact.sha256,sbomSha256:certificate.artifact.sbomSha256},createdAt:new Date().toISOString()};
  writeFileSync(join(output,'assets','release-manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
  const releaseNotes=`# ${tag}\n\nSource revision: ${revision}\nArtifact SHA-256: ${certificate.artifact.sha256}\nSBOM SHA-256: ${certificate.artifact.sbomSha256}\nCertification SHA-256: ${sha256(certificateBytes)}\n\n${notes.join('\n')}\n`;
  writeFileSync(join(output,'RELEASE_NOTES.md'),releaseNotes,{flag:'wx'});
  if(options['--github-output'])appendFileSync(options['--github-output'],`tag=${tag}\nsource_revision=${revision}\n`);
  return {operation:'release',outcome:'prepared',repository,revision,version,tag,certificateDigest:sha256(certificateBytes),artifactDigest:certificate.artifact.sha256,sbomDigest:certificate.artifact.sbomSha256,results:[{capability:'versioned-signed-release',required:true,status:'passed',reason:'A source-bound certification and matching immutable artifact were verified; semantic version and release notes are ready. Publication and signing require the dedicated trusted GitHub workflow.'}]};
 }catch(error){return blocked(error instanceof Error?error.message:'Release preparation failed closed.');}
}
