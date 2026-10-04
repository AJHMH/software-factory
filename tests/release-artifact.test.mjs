import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

const root=fileURLToPath(new URL('../',import.meta.url));
const cli=join(root,'scripts/factory-validation.mjs');
const sha=value=>createHash('sha256').update(value).digest('hex');

function fixture(t) {
 const directory=mkdtempSync(join(root,'tmp/release-artifact-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const repo=join(directory,'repo'),workload=join(repo,'examples/reference-workload');
 for(const path of ['policies','examples/reference-workload/src']) mkdirSync(join(repo,path),{recursive:true});
 writeFileSync(join(repo,'policies/dependencies.yaml'),readFileSync(join(root,'policies/dependencies.yaml')));
 const manifest={name:'factory-reference-workload',version:'1.0.0',devDependencies:{'@types/node':'24.19.1',typescript:'7.0.2'},dependencies:{yaml:'2.9.1'}};
 const packages={'':{name:manifest.name,version:manifest.version,dependencies:manifest.dependencies,devDependencies:manifest.devDependencies}};
 for(const [name,version] of Object.entries({...manifest.dependencies,...manifest.devDependencies})) packages[`node_modules/${name}`]={version,resolved:`https://registry.npmjs.org/${name}/-/${name.split('/').at(-1)}-${version}.tgz`,integrity:`sha512-${createHash('sha512').update(name).digest('base64')}`};
 const lock={name:manifest.name,version:manifest.version,lockfileVersion:3,requires:true,packages};
 const contract='version: "1.0"\ncontract:\n  workload_id: factory-reference-workload\n  profile: node-24\n  working_directory: examples/reference-workload\n  commands: {}\n';
 const source='export function greet(name) { return `Hello, ${name}!`; }\n';
 writeFileSync(join(repo,'factory-contract.yaml'),contract);writeFileSync(join(workload,'package.json'),JSON.stringify(manifest));writeFileSync(join(workload,'package-lock.json'),JSON.stringify(lock));writeFileSync(join(workload,'src/index.mjs'),source);
 const git=(...args)=>{const result=spawnSync('git',args,{cwd:repo,encoding:'utf8'});assert.equal(result.status,0,result.stderr);return result.stdout.trim();};
 git('init');git('add','.');git('-c','commit.gpgsign=false','-c','user.name=Factory Test','-c','user.email=factory-test@example.invalid','commit','-m','fixture');
 const revision=git('rev-parse','HEAD'),treeDigest=git('rev-parse',`${revision}^{tree}`),contractDigest=sha(contract);
 mkdirSync(join(workload,'dist'),{recursive:true});writeFileSync(join(workload,'dist/index.mjs'),source);
 const validation={schemaVersion:1,operation:'validate',outcome:'passed',revision,treeDigest,contractDigest,workloadId:manifest.name,profile:{id:'node-24',nodeVersion:'24'},workingTreeDirty:false,results:['install','validate','test','build'].map(capability=>({capability,required:true,status:'passed',exitCode:0}))};
 const validationPath=join(directory,'validation.json');writeFileSync(validationPath,JSON.stringify(validation));
 const bundle=join(repo,'tmp/release-artifact-output');
 const run=(mode,overrides={})=>{
  const options={'--mode':mode,'--trusted-repo':repo,'--trusted-revision':revision,...overrides},args=['release-artifact'];
  for(const [flag,value] of Object.entries(options)) args.push(flag,value);
  const result=spawnSync(process.execPath,[cli,...args],{cwd:root,encoding:'utf8'});
  return {...result,report:result.stdout?JSON.parse(result.stdout):null};
 };
 const produce=()=>run('produce',{'--validation-evidence':validationPath,'--output-dir':bundle});
 const verify=()=>run('verify',{'--artifact-directory':bundle});
 return {repo,workload,revision,treeDigest,validation,bundle,validationPath,produce,verify,run};
}

test('public Factory CLI produces one revision-bound artifact, SPDX SBOM, and dependency-source evidence',t=>{
 const f=fixture(t),created=f.produce();assert.equal(created.status,0,created.stdout+created.stderr);assert.equal(created.report.outcome,'passed');
 const verified=f.verify();assert.equal(verified.status,0,verified.stdout+verified.stderr);assert.equal(verified.report.outcome,'passed');assert.equal(verified.report.revision,f.revision);assert.equal(verified.report.dependencyCount,3);
 const evidence=JSON.parse(readFileSync(join(f.bundle,'source-evidence.json'),'utf8')),bom=JSON.parse(readFileSync(join(f.bundle,'sbom.spdx.json'),'utf8'));
 assert.equal(evidence.source.revision,f.revision);assert.equal(evidence.artifact.sha256,sha(readFileSync(join(f.bundle,'reference-workload.mjs'))));assert.equal(evidence.sbom.format,'SPDX-2.3');assert.equal(evidence.dependencySource.registry,'https://registry.npmjs.org/');assert.equal(evidence.dependencySource.includesDevelopmentDependencies,true);
 assert.ok(bom.packages.some(pkg=>pkg.name==='@types/node'&&pkg.externalRefs[0].referenceLocator==='pkg:npm/%40types/node@24.19.1'));
});

test('consumer verifies downloaded bytes and evidence without access to the old build directory',t=>{
 const f=fixture(t);assert.equal(f.produce().status,0);rmSync(join(f.workload,'dist'),{recursive:true,force:true});
 const result=f.verify();assert.equal(result.status,0,result.stdout+result.stderr);assert.match(result.report.results[0].reason,/without rebuilding/);
});

test('tampered artifact, SBOM, validation report, or additional files fail closed',t=>{
 for(const target of ['reference-workload.mjs','sbom.spdx.json','validation-evidence.json','unexpected.txt']) {
  const f=fixture(t);assert.equal(f.produce().status,0);
  if(target==='unexpected.txt') writeFileSync(join(f.bundle,target),'extra');else writeFileSync(join(f.bundle,target),readFileSync(join(f.bundle,target)).toString()+'tampered');
  const result=f.verify();assert.equal(result.status,1,target);assert.equal(result.report.outcome,'blocked',target);
 }
});

test('producer rejects incomplete validation and a build output that does not match committed source',t=>{
 const failed=fixture(t);failed.validation.results.pop();writeFileSync(failed.validationPath,JSON.stringify(failed.validation));const result=failed.produce();assert.equal(result.status,1);assert.equal(result.report.outcome,'blocked');
 const mismatch=fixture(t);writeFileSync(join(mismatch.workload,'dist/index.mjs'),'different build output');const rejected=mismatch.produce();assert.equal(rejected.status,1);assert.equal(rejected.report.outcome,'blocked');
});
