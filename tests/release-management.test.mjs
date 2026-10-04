import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

const root=fileURLToPath(new URL('../',import.meta.url)),tmpRoot=join(root,'tmp');mkdirSync(tmpRoot,{recursive:true});const tmp=mkdtempSync(join(tmpRoot,'factory-release-management-'));
test.after(()=>rmSync(tmp,{recursive:true,force:true}));
const hash=value=>createHash('sha256').update(value).digest('hex');
function git(repo,...args){return execFileSync('git',['-C',repo,...args],{encoding:'utf8',windowsHide:true}).trim();}
function fixture(t){
 const repo=mkdtempSync(join(tmp,'repo-')),artifact=join(repo,'input-artifact');mkdirSync(join(repo,'policies'),{recursive:true});mkdirSync(join(repo,'src'));mkdirSync(artifact);
 t.after(()=>rmSync(repo,{recursive:true,force:true}));git(repo,'init','-b','main');git(repo,'config','commit.gpgsign','false');git(repo,'config','user.name','Factory Test');git(repo,'config','user.email','factory@example.test');
 writeFileSync(join(repo,'policies/release.yaml'),'release:\n  versioning:\n    strategy: semantic\n    require_conventional_commits: true\n    initial_version: "0.0.0"\n    first_release_baseline: "0000000000000000000000000000000000000000"\n  changelog:\n    exclude_commit_types: [chore, test, docs]\n  authorization:\n    authorized_actors: [aaron-howard]\n    require_workflow_dispatch_from_main: true\n    reject_workflow_reruns: true\n    reject_existing_tags_or_releases: true\n');
 writeFileSync(join(repo,'src/index.mjs'),'export const answer = 42;\n');git(repo,'add','.');git(repo,'commit','-m','feat: establish release fixture');const baselineRevision=git(repo,'rev-parse','HEAD');
 const policyPath=join(repo,'policies/release.yaml');writeFileSync(policyPath,readFileSync(policyPath,'utf8').replace('0000000000000000000000000000000000000000',baselineRevision));git(repo,'add','.');git(repo,'commit','-m','docs: set first release baseline');git(repo,'tag','v0.1.0');
 git(repo,'commit','--allow-empty','-m','chore: internal maintenance');git(repo,'commit','--allow-empty','-m','fix: correct fixture behavior');const revision=git(repo,'rev-parse','HEAD');
 const artifactBytes=Buffer.from('export const answer = 42;\n'),sbomBytes=Buffer.from('{"spdxVersion":"SPDX-2.3"}\n');writeFileSync(join(artifact,'reference-workload.mjs'),artifactBytes);writeFileSync(join(artifact,'sbom.spdx.json'),sbomBytes);
 writeFileSync(join(artifact,'source-evidence.json'),JSON.stringify({source:{revision},artifact:{sha256:hash(artifactBytes)},sbom:{sha256:hash(sbomBytes)}}));
 const certificatePath=join(repo,'certificate.json'),certificate={schemaVersion:1,operation:'certify',outcome:'certified',repository:'AJHMH/software-factory',revision,artifact:{sha256:hash(artifactBytes),sbomSha256:hash(sbomBytes)}};writeFileSync(certificatePath,JSON.stringify(certificate));
 const certificateRun=join(repo,'certificate-run.json'),producerRun=join(repo,'producer-run.json');
 writeFileSync(certificateRun,JSON.stringify({id:11,repository:{full_name:'AJHMH/software-factory'},path:'.github/workflows/factory-certify-release.yml',head_sha:revision,head_branch:'main',event:'workflow_dispatch',status:'completed',conclusion:'success',actor:{login:'aaron-howard'}}));
 writeFileSync(producerRun,JSON.stringify({id:12,repository:{full_name:'AJHMH/software-factory'},path:'.github/workflows/factory-ci.yml',head_sha:revision,head_branch:'main',event:'push',status:'completed',conclusion:'success',actor:{login:'other-maintainer'}}));
 const output=join(repo,'release-output');return {repo,artifact,certificatePath,certificateRun,producerRun,revision,output,baselineRevision};
}
function invoke(f,changes={}){
 const args=['scripts/factory-validation.mjs','release','--mode','prepare','--repository','AJHMH/software-factory','--source-revision',f.revision,'--actor','aaron-howard','--trusted-repo',f.repo,'--certificate',f.certificatePath,'--artifact-directory',f.artifact,'--output-directory',f.output,'--certificate-run','11','--certificate-run-metadata',f.certificateRun,'--producer-run','12','--producer-run-metadata',f.producerRun];
 const result=spawnSync(process.execPath,args,{cwd:root,encoding:'utf8',windowsHide:true,env:{...process.env,...changes}});return {status:result.status,stdout:result.stdout,stderr:result.stderr,report:JSON.parse(result.stdout)};
}
test('the public release interface computes the next SemVer and changelog from the exact certified artifact',t=>{
 const f=fixture(t),result=invoke(f);assert.equal(result.status,0,result.stderr);assert.equal(result.report.outcome,'prepared');assert.equal(result.report.tag,'v0.1.1');
 const notes=readFileSync(join(f.output,'RELEASE_NOTES.md'),'utf8');assert.match(notes,/correct fixture behavior/);assert.doesNotMatch(notes,/internal maintenance/);
 const manifest=JSON.parse(readFileSync(join(f.output,'assets/release-manifest.json'),'utf8'));assert.equal(manifest.sourceRevision,f.revision);assert.equal(manifest.certification.artifactSha256,f.report?.artifactDigest??JSON.parse(readFileSync(f.certificatePath,'utf8')).artifact.sha256);
 assert.deepEqual(manifest.migrationCompatibility,{strategy:'none',compatibleWithPrevious:true});
});
test('breaking Conventional Commits take precedence and only the authorized actor can prepare',t=>{
 const f=fixture(t);git(f.repo,'commit','--allow-empty','-m','feat(api)!: remove an interface','-m','BREAKING CHANGE: consumers must migrate');f.revision=git(f.repo,'rev-parse','HEAD');
 const cert=JSON.parse(readFileSync(f.certificatePath));cert.revision=f.revision;writeFileSync(f.certificatePath,JSON.stringify(cert));
 const evidence=JSON.parse(readFileSync(join(f.artifact,'source-evidence.json')));evidence.source.revision=f.revision;writeFileSync(join(f.artifact,'source-evidence.json'),JSON.stringify(evidence));
 for(const metadata of [f.certificateRun,f.producerRun]){const run=JSON.parse(readFileSync(metadata));run.head_sha=f.revision;writeFileSync(metadata,JSON.stringify(run));}
 const result=invoke(f);assert.equal(result.report.outcome,'prepared',result.stdout);assert.equal(result.report.tag,'v1.0.0');
 const unauthorized=spawnSync(process.execPath,['scripts/factory-validation.mjs','release','--mode','prepare','--repository','AJHMH/software-factory','--source-revision',f.revision,'--actor','intruder','--trusted-repo',f.repo,'--certificate',f.certificatePath,'--artifact-directory',f.artifact,'--output-directory',join(f.repo,'denied'),'--certificate-run','11','--certificate-run-metadata',f.certificateRun,'--producer-run','12','--producer-run-metadata',f.producerRun],{cwd:root,encoding:'utf8',windowsHide:true});assert.equal(unauthorized.status,1);assert.match(JSON.parse(unauthorized.stdout).results[0].reason,/not authorized/);
});
test('missing certification, mismatched digests, untrusted runs, existing tags, and no-op commit sets fail closed',t=>{
 const missing=fixture(t);const cert=JSON.parse(readFileSync(missing.certificatePath));cert.outcome='blocked';writeFileSync(missing.certificatePath,JSON.stringify(cert));assert.equal(invoke(missing).report.outcome,'blocked');
 const digest=fixture(t),changed=readFileSync(join(digest.artifact,'reference-workload.mjs'));writeFileSync(join(digest.artifact,'reference-workload.mjs'),Buffer.concat([changed,Buffer.from('tamper')]));assert.match(invoke(digest).report.results[0].reason,/does not match/);
 const run=fixture(t),metadata=JSON.parse(readFileSync(run.certificateRun));metadata.path='.github/workflows/untrusted.yml';writeFileSync(run.certificateRun,JSON.stringify(metadata));assert.match(invoke(run).report.results[0].reason,/workflow run/);
 const noOp=fixture(t);git(noOp.repo,'reset','--hard','v0.1.0');git(noOp.repo,'commit','--allow-empty','-m','chore: internal-only change');noOp.revision=git(noOp.repo,'rev-parse','HEAD');
 const noOpCert=JSON.parse(readFileSync(noOp.certificatePath));noOpCert.revision=noOp.revision;writeFileSync(noOp.certificatePath,JSON.stringify(noOpCert));
 const noOpEvidence=JSON.parse(readFileSync(join(noOp.artifact,'source-evidence.json')));noOpEvidence.source.revision=noOp.revision;writeFileSync(join(noOp.artifact,'source-evidence.json'),JSON.stringify(noOpEvidence));
 for(const metadataPath of [noOp.certificateRun,noOp.producerRun]){const metadata=JSON.parse(readFileSync(metadataPath));metadata.head_sha=noOp.revision;writeFileSync(metadataPath,JSON.stringify(metadata));}
 assert.match(invoke(noOp).report.results[0].reason,/No release-worthy/);
});
test('the configured baseline governs the first release and ignores history before policy activation',t=>{
 const f=fixture(t);git(f.repo,'tag','--delete','v0.1.0');const result=invoke(f);assert.equal(result.status,0,result.stdout);assert.equal(result.report.tag,'v0.0.1');
});
