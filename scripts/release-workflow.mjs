import {appendFileSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {parse} from 'yaml';
import {assertWorkflowRun} from './release-management.mjs';

const [command,...args]=process.argv.slice(2);
/** @param {string} name */ function value(name){const i=args.indexOf(name);if(i<0||i===args.length-1)throw new Error(`Missing ${name}.`);return /** @type {string} */(args[i+1]);}
function repository(){const name=process.env.GITHUB_REPOSITORY;if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(name??''))throw new Error('A trusted GitHub repository is required.');return /** @type {string} */(name);}
/** @param {string} revision */ function policy(revision){const source=spawnSync('git',['show',`${revision}:policies/release.yaml`],{encoding:'utf8',windowsHide:true});if(source.status!==0||source.error)throw new Error('Trusted release policy is unavailable.');const result=parse(source.stdout)?.release,actors=result?.authorization?.authorized_actors;if(!Array.isArray(actors)||!actors.length||result.authorization.require_workflow_dispatch_from_main!==true||result.authorization.reject_workflow_reruns!==true||result.authorization.reject_existing_tags_or_releases!==true)throw new Error('Trusted release authorization policy is incomplete.');return actors;}
/** @param {string} executable @param {string[]} parameters */ function run(executable,parameters){const result=spawnSync(executable,parameters,{encoding:'utf8',windowsHide:true,maxBuffer:2*1024*1024,env:process.env});if(result.error||result.status!==0)throw new Error(result.stderr?.slice(-1500)||'Factory release operation failed.');return result.stdout;}
try{
 if(command==='authorize'){
  const revision=value('--source-revision'),trusted=value('--trusted-revision'),actor=value('--actor'),actors=policy(trusted);
  const checkedOut=spawnSync('git',['rev-parse','HEAD'],{encoding:'utf8',windowsHide:true});
  if(checkedOut.status!==0||revision!==checkedOut.stdout.trim()||revision!==trusted||revision!==process.env.GITHUB_SHA||process.env.GITHUB_REF!=='refs/heads/main'||!actors.includes(actor)||process.env.GITHUB_RUN_ATTEMPT!=='1')throw new Error('Release work requires an authorized first-attempt workflow dispatch from current main at the exact source revision.');
  console.log(JSON.stringify({outcome:'passed',actor,revision}));
 }else if(command==='verify-producer'){
  const revision=value('--source-revision'),id=value('--producer-run'),metadata=JSON.parse(readFileSync(value('--run-metadata'),'utf8'));
  assertWorkflowRun(metadata,id,'.github/workflows/factory-ci.yml',revision,repository(),undefined,'push');console.log(JSON.stringify({outcome:'passed',runId:id,revision}));
 }else if(command==='certify'){
  const revision=value('--source-revision'),producerRun=value('--producer-run'),pr=value('--pull-request');
  if(!/^\d{1,20}$/.test(producerRun)||!/^\d{1,8}$/.test(pr)||process.env.SOURCE_REVISION!==revision||!process.env.FACTORY_GITHUB_TOKEN)throw new Error('The release certification request is missing an exact source, pull request, producer run, or read-only operator token.');
  const raw=process.env.EVIDENCE_BUNDLE??'';if(Buffer.byteLength(raw)>65535)throw new Error('Evidence bundle exceeds the GitHub workflow-dispatch input limit.');
  const evidence=JSON.parse(raw);if(!evidence||evidence.revision!==revision)throw new Error('Evidence bundle does not name the requested source revision.');
  const evidencePath=resolve('tmp/release-evidence.json'),certificatePath=resolve('tmp/release-certificate/release-certificate.json');mkdirSync(dirname(evidencePath),{recursive:true});mkdirSync(dirname(certificatePath),{recursive:true});writeFileSync(evidencePath,JSON.stringify(evidence,null,2)+'\n',{flag:'wx'});
  run(process.execPath,['scripts/factory-validation.mjs','certify','--repository',repository(),'--pull-request',pr,'--trusted-repo','.','--trusted-revision',revision,'--evidence',evidencePath,'--artifact-directory',resolve('tmp/release-artifact'),'--output',certificatePath]);
  const certificate=JSON.parse(readFileSync(certificatePath,'utf8'));if(certificate.outcome!=='certified'||certificate.revision!==revision)throw new Error('Certification did not produce a certificate for this exact source.');
  console.log(JSON.stringify({outcome:'certified',revision,certificate:certificatePath}));
 }else if(command==='prepare'){
  const revision=value('--source-revision'),actor=value('--actor'),certificateRun=value('--certificate-run'),producerRun=value('--producer-run');
  const out=process.env.GITHUB_OUTPUT;if(!out)throw new Error('GitHub release output channel is unavailable.');
  const report=run(process.execPath,['scripts/factory-validation.mjs','release','--mode','prepare','--repository',repository(),'--source-revision',revision,'--actor',actor,'--trusted-repo','.','--certificate',resolve('tmp/certificate/release-certificate.json'),'--artifact-directory',resolve('tmp/release-artifact'),'--output-directory',resolve('tmp/release'),'--certificate-run',certificateRun,'--certificate-run-metadata',resolve('tmp/run-metadata/certification.json'),'--producer-run',producerRun,'--producer-run-metadata',resolve('tmp/run-metadata/producer.json'),'--github-output',out]);
  const result=JSON.parse(report);if(result.outcome!=='prepared')throw new Error(result.results?.[0]?.reason??'Release preparation was denied.');
  if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,`## Factory release prepared: ${result.tag}\n\nSource: ${result.revision}\nArtifact SHA-256: ${result.artifactDigest}\nSBOM SHA-256: ${result.sbomDigest}\n\nPublication requires this trusted workflow.\n`);
  console.log(JSON.stringify(result));
 }else throw new Error('Unsupported release workflow operation.');
}catch(error){console.error(JSON.stringify({operation:'release-workflow',outcome:'blocked',reason:error instanceof Error?error.message:'Release authorization failed closed.'}));process.exitCode=1;}
