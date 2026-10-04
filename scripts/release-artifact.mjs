import {createHash} from 'node:crypto';
import {existsSync,lstatSync,mkdirSync,readdirSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname,join,relative,resolve,isAbsolute} from 'node:path';
import {spawnSync} from 'node:child_process';
import {parse} from 'yaml';
import {rawGit} from './coverage-evaluation.mjs';

const format='SPDX-2.3';
const artifactName='reference-workload.mjs';
const sbomName='sbom.spdx.json';
const sourceEvidenceName='source-evidence.json';
const validationEvidenceName='validation-evidence.json';
const maxFileSize=16*1024*1024;
/** @typedef {Record<string, any>} Json */
/** @param {string} reason @returns {never} */
function deny(reason) {throw new Error(reason);}
/** @param {unknown} value @returns {value is Json} */
function object(value) {return value!==null && typeof value==='object' && !Array.isArray(value);}
/** @param {string|Buffer|Uint8Array} value */
function sha256(value) {return createHash('sha256').update(value).digest('hex');}
/** @param {string} repo @param {string[]} args */
function git(repo,args) {return rawGit(repo,args).trim();}
/** @param {unknown} value */
function json(value) {return JSON.stringify(value);}
/** @param {string} path */
function regularFile(path) {
 const stats=lstatSync(path);if(!stats.isFile() || stats.isSymbolicLink() || stats.nlink!==1 || stats.size>maxFileSize) deny('A required artifact file is missing, linked, or too large.');
 return readFileSync(path);
}
/** @param {string} source */
function parseJson(source) {const value=JSON.parse(source);if(!object(value)) deny('Artifact evidence must be a JSON object.');return value;}
/** @param {string} name @param {string} version */
function npmPurl(name,version) {
 const parts=name.startsWith('@')?name.slice(1).split('/'):undefined;
 if(parts && parts.length!==2) deny('Invalid scoped npm package name.');
 const encoded=parts?`%40${encodeURIComponent(parts[0])}/${encodeURIComponent(parts[1])}`:encodeURIComponent(name);
 return `pkg:npm/${encoded}@${encodeURIComponent(version)}`;
}
/** @param {string} path */
function packageName(path) {
 const index=path.lastIndexOf('node_modules/');if(index<0) deny('Unsupported npm package path.');
 const name=path.slice(index+'node_modules/'.length);
 if(!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(name)) deny('Unsupported npm package name.');
 return name;
}
/** @param {Json} lock @param {string} parent @param {string} name */
function resolvePackage(lock,parent,name) {
 let current=parent;
 while(current) {
  const candidate=`${current}/node_modules/${name}`;if(Object.hasOwn(lock.packages,candidate)) return candidate;
  const marker=current.lastIndexOf('/node_modules/');current=marker<0?'':current.slice(0,marker);
 }
 const root=`node_modules/${name}`;return Object.hasOwn(lock.packages,root)?root:undefined;
}
/** @param {string} repo @param {string} revision */
function context(repo,revision) {
 if(!/^[a-f0-9]{40}$/.test(revision??'') || git(repo,['cat-file','-t',revision])!=='commit') deny('A trusted source commit is required.');
 const contractSource=rawGit(repo,['show',`${revision}:factory-contract.yaml`]),contract=parse(contractSource)?.contract;
 if(!object(contract) || contract.workload_id!=='factory-reference-workload' || contract.profile!=='node-24' || typeof contract.working_directory!=='string') deny('The committed reference workload contract is unsupported.');
 const workloadDirectory=contract.working_directory.replace(/\\/g,'/').replace(/\/$/,''),prefix=workloadDirectory+'/',manifestPath=prefix+'package.json',lockPath=prefix+'package-lock.json',sourcePath=prefix+'src/index.mjs';
 if(workloadDirectory.startsWith('/') || workloadDirectory.split('/').some(part=>!part || part==='.' || part==='..')) deny('The committed workload path is unsafe.');
 const manifest=parseJson(rawGit(repo,['show',`${revision}:${manifestPath}`])),lock=parseJson(rawGit(repo,['show',`${revision}:${lockPath}`]));
 const dependencyPolicy=parse(rawGit(repo,['show',`${revision}:policies/dependencies.yaml`]))?.dependencies;
 const sourcePolicy=dependencyPolicy?.artifact;
 if(!object(sourcePolicy) || sourcePolicy.sbom_format!==format || sourcePolicy.dependency_registry!=='https://registry.npmjs.org/' || sourcePolicy.lockfile_version!==3 || sourcePolicy.source_lockfile!==lockPath || sourcePolicy.include_development_dependencies!==true) deny('Trusted dependency-source metadata is missing or unsupported.');
 if(lock.lockfileVersion!==sourcePolicy.lockfile_version || !object(lock.packages) || !object(lock.packages['']) || manifest.workspaces || lock.packages[''].workspaces || lock.packages[''].name!==manifest.name || lock.packages[''].version!==manifest.version) deny('Only a matching npm lockfile v3 reference workload is supported.');
 for(const field of ['dependencies','devDependencies','optionalDependencies','peerDependencies']) {
  if(json(Object.entries(manifest[field]??{}).sort())!==json(Object.entries(lock.packages[''][field]??{}).sort())) deny('Committed manifest and lockfile dependency declarations differ.');
  if(field==='devDependencies' && sourcePolicy.include_development_dependencies!==true) deny('Development dependencies must be represented in the SBOM.');
 }
 const entries=Object.entries(lock.packages).filter(([path])=>path).sort(([a],[b])=>a.localeCompare(b));
 if(!entries.length || typeof manifest.devDependencies?.typescript!=='string') deny('The committed workload lockfile or TypeScript build tool is missing.');
 for(const [path,pkg] of entries) {
  if(!object(pkg)) deny('The committed lockfile contains an invalid package entry.');
  if(!/^node_modules\/(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+(?:\/node_modules\/(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+)*$/i.test(path)) deny('The committed lockfile contains an unsafe package path.');
  const name=packageName(path),registry=new URL(pkg.resolved??'');
  if(pkg.link || typeof pkg.version!=='string' || !/^[0-9A-Za-z.+-]+$/.test(pkg.version) || (pkg.name!==undefined && pkg.name!==name) || registry.protocol!=='https:' || registry.host!=='registry.npmjs.org' || registry.username || registry.password || registry.port || registry.search || registry.hash || !/^sha512-[A-Za-z0-9+/]{86}==$/.test(pkg.integrity??'')) deny(`Locked dependency metadata is unsupported for ${name}.`);
 }
 const treeDigest=git(repo,['rev-parse',`${revision}^{tree}`]);
 return {repo,revision,contract,contractSource,contractDigest:sha256(contractSource),prefix,sourcePath,manifestPath,lockPath,manifest,lock,treeDigest,dependencyPolicy,sourcePolicy,entries};
}
/** @param {ReturnType<typeof context>} ctx @param {string} artifactDigest @param {string} created */
function sbom(ctx,artifactDigest,created) {
 const dependencyIds=new Map(ctx.entries.map(([path])=>[path,`SPDXRef-Dependency-${sha256(path).slice(0,24)}`]));
 const packages=[{
  name:ctx.manifest.name,SPDXID:'SPDXRef-Artifact',versionInfo:ctx.manifest.version,downloadLocation:'NOASSERTION',filesAnalyzed:false,
  checksums:[{algorithm:'SHA256',checksumValue:artifactDigest}],licenseConcluded:'NOASSERTION',licenseDeclared:'NOASSERTION',copyrightText:'NOASSERTION',
  externalRefs:[{referenceCategory:'PACKAGE-MANAGER',referenceType:'purl',referenceLocator:npmPurl(ctx.manifest.name,ctx.manifest.version)}],
 },...ctx.entries.map(([path,pkg])=>{
  const name=packageName(path),integrity=Buffer.from(pkg.integrity.slice('sha512-'.length),'base64');
  return {name,SPDXID:dependencyIds.get(path),versionInfo:pkg.version,downloadLocation:pkg.resolved,filesAnalyzed:false,
   checksums:[{algorithm:'SHA512',checksumValue:integrity.toString('hex')}],licenseConcluded:'NOASSERTION',licenseDeclared:'NOASSERTION',copyrightText:'NOASSERTION',
   externalRefs:[{referenceCategory:'PACKAGE-MANAGER',referenceType:'purl',referenceLocator:npmPurl(name,pkg.version)}]};
 })];
 const relationships=[{spdxElementId:'SPDXRef-DOCUMENT',relationshipType:'DESCRIBES',relatedSpdxElement:'SPDXRef-Artifact'}];
 for(const [parent,pkg] of [['',ctx.lock.packages['']],...ctx.entries]) {
 const owner=parent?(dependencyIds.get(parent)??'SPDXRef-Artifact'):'SPDXRef-Artifact';
  for(const name of new Set([...Object.keys(pkg.dependencies??{}),...Object.keys(pkg.devDependencies??{}),...Object.keys(pkg.optionalDependencies??{}),...Object.keys(pkg.peerDependencies??{})])) {
   const target=resolvePackage(ctx.lock,parent,name);if(target) relationships.push({spdxElementId:owner,relationshipType:'DEPENDS_ON',relatedSpdxElement:dependencyIds.get(target)??'SPDXRef-Artifact'});
  }
 }
 return {spdxVersion:format,dataLicense:'CC0-1.0',SPDXID:'SPDXRef-DOCUMENT',name:`${ctx.manifest.name}-${ctx.manifest.version}`,documentNamespace:`https://spdx.org/spdxdocs/${ctx.manifest.name}-${ctx.revision}-${artifactDigest}`,creationInfo:{creators:['Tool: factory-release-artifact/1.0.0'],created,comment:`Source revision ${ctx.revision}; built artifact SHA-256 ${artifactDigest}.`},documentDescribes:['SPDXRef-Artifact'],packages,relationships};
}
/** @param {Json} report @param {ReturnType<typeof context>} ctx */
function validateReport(report,ctx) {
 const capabilities=['install','validate','test','build'];
 if(report.operation!=='validate' || report.outcome!=='passed' || report.revision!==ctx.revision || report.contractDigest!==ctx.contractDigest || report.workloadId!==ctx.contract.workload_id || report.profile?.id!==ctx.contract.profile || report.profile?.nodeVersion!=='24' || report.workingTreeDirty!==false || !Array.isArray(report.results) || report.results.length!==capabilities.length || report.results.some((gate,index)=>gate.capability!==capabilities[index] || gate.required!==true || gate.status!=='passed' || gate.exitCode!==0)) deny('A complete clean validation report for the exact source commit is required.');
}
/** @param {string} executableDirectory */
function npmVersion(executableDirectory) {
 const candidates=[join(executableDirectory,'node_modules/npm/bin/npm-cli.js'),resolve(executableDirectory,'..','lib/node_modules/npm/bin/npm-cli.js')],candidate=candidates.find(existsSync);
 if(!candidate) return deny('The selected Node installation has no supported npm CLI.');
 const cli=candidate;
 const result=spawnSync(process.execPath,[cli,'--version'],{encoding:'utf8',timeout:10000,windowsHide:true,maxBuffer:4096});
 if(result.status!==0 || result.error || !/^\d+\.\d+\.\d+$/.test(result.stdout.trim())) deny('The selected npm version could not be verified.');
 return result.stdout.trim();
}
/** @param {string} output @param {ReturnType<typeof context>} ctx @param {Json} validation */
function produce(output,ctx,validation) {
 validateReport(validation,ctx);
 const outputPath=resolve(output),within=relative(ctx.repo,outputPath);
 if(within==='..' || within.startsWith(`..${process.platform==='win32'?'\\':'/'}`) || isAbsolute(within)) deny('Artifact output must be a new directory inside the repository.');
 if(existsSync(outputPath)) {const stats=lstatSync(outputPath);if(!stats.isDirectory() || stats.isSymbolicLink() || readdirSync(outputPath).length) deny('Artifact output directory must be new or empty.');}
 const builtPath=resolve(ctx.repo,ctx.prefix,'dist/index.mjs'),built=regularFile(builtPath),source=Buffer.from(rawGit(ctx.repo,['show',`${ctx.revision}:${ctx.sourcePath}`]));
 if(!built.length || !built.equals(source)) deny('The single built artifact does not match its committed source file.');
 const created=new Date().toISOString(),artifactDigest=sha256(built),bom=sbom(ctx,artifactDigest,created),bomSource=JSON.stringify(bom,null,2)+'\n',bomDigest=sha256(bomSource);
 const validationSource=JSON.stringify(validation,null,2)+'\n',validationDigest=sha256(validationSource);
 const evidence={schemaVersion:1,outcome:'passed',createdAt:created,source:{revision:ctx.revision,treeDigest:ctx.treeDigest,workloadId:ctx.contract.workload_id,profile:ctx.contract.profile,contractDigest:ctx.contractDigest,files:{workloadSource:{path:ctx.sourcePath,sha256:sha256(source)},manifest:{path:ctx.manifestPath,sha256:sha256(rawGit(ctx.repo,['show',`${ctx.revision}:${ctx.manifestPath}`]))},lockfile:{path:ctx.lockPath,sha256:sha256(rawGit(ctx.repo,['show',`${ctx.revision}:${ctx.lockPath}`]))}}},artifact:{filename:artifactName,sha256:artifactDigest,size:built.length},sbom:{filename:sbomName,format,sha256:bomDigest,dependencyCount:ctx.entries.length},validation:{filename:validationEvidenceName,sha256:validationDigest,capabilities:['install','validate','test','build']},dependencySource:{ecosystem:'npm',registry:ctx.sourcePolicy.dependency_registry,lockfile:ctx.lockPath,lockfileVersion:ctx.sourcePolicy.lockfile_version,includesDevelopmentDependencies:ctx.sourcePolicy.include_development_dependencies,packageCount:ctx.entries.length},tools:{factoryArtifact:'1.0.0',node:process.version,npm:npmVersion(dirname(process.execPath)),typescript:ctx.manifest.devDependencies?.typescript??null}};
 mkdirSync(outputPath,{recursive:true});
 writeFileSync(join(outputPath,artifactName),built,{flag:'wx'});writeFileSync(join(outputPath,sbomName),bomSource,{flag:'wx'});writeFileSync(join(outputPath,validationEvidenceName),validationSource,{flag:'wx'});writeFileSync(join(outputPath,sourceEvidenceName),JSON.stringify(evidence,null,2)+'\n',{flag:'wx'});
 return {operation:'release-artifact',outcome:'passed',revision:ctx.revision,artifactDigest,sbomDigest:bomDigest,dependencyCount:ctx.entries.length,results:[{capability:'traceable-build-artifacts',required:true,status:'passed',reason:'One committed build output, its SPDX SBOM, validation report, and source evidence are associated by SHA-256. No publication or rebuild was authorized.'}]};
}
/** @param {string} directory @param {ReturnType<typeof context>} ctx @param {string} expectedRevision */
function verify(directory,ctx,expectedRevision) {
 if(expectedRevision!==ctx.revision) deny('The requested source revision does not match the trusted source commit.');
 const path=resolve(directory),names=[artifactName,sbomName,sourceEvidenceName,validationEvidenceName].sort();
 if(!lstatSync(path).isDirectory() || lstatSync(path).isSymbolicLink() || json(readdirSync(path).sort())!==json(names)) deny('The downloaded artifact bundle is incomplete or contains unexpected files.');
 const artifact=regularFile(join(path,artifactName)),bomBytes=regularFile(join(path,sbomName)),evidenceBytes=regularFile(join(path,sourceEvidenceName)),validationBytes=regularFile(join(path,validationEvidenceName));
 const evidence=parseJson(evidenceBytes.toString('utf8')),validation=parseJson(validationBytes.toString('utf8')),artifactDigest=sha256(artifact),bomDigest=sha256(bomBytes.toString('utf8'));
 validateReport(validation,ctx);
 if(evidence.schemaVersion!==1 || evidence.outcome!=='passed' || evidence.source?.revision!==ctx.revision || evidence.source?.treeDigest!==ctx.treeDigest || evidence.source?.workloadId!==ctx.contract.workload_id || evidence.source?.profile!==ctx.contract.profile || evidence.source?.contractDigest!==ctx.contractDigest || !Number.isFinite(Date.parse(evidence.createdAt)) || evidence.artifact?.filename!==artifactName || evidence.artifact?.sha256!==artifactDigest || evidence.artifact?.size!==artifact.length || evidence.sbom?.filename!==sbomName || evidence.sbom?.format!==format || evidence.sbom?.sha256!==bomDigest || evidence.sbom?.dependencyCount!==ctx.entries.length || evidence.validation?.filename!==validationEvidenceName || evidence.validation?.sha256!==sha256(validationBytes.toString('utf8')) || json(evidence.validation?.capabilities)!==json(['install','validate','test','build']) || evidence.dependencySource?.ecosystem!=='npm' || evidence.dependencySource?.registry!==ctx.sourcePolicy.dependency_registry || evidence.dependencySource?.lockfile!==ctx.lockPath || evidence.dependencySource?.lockfileVersion!==ctx.sourcePolicy.lockfile_version || evidence.dependencySource?.includesDevelopmentDependencies!==true || evidence.dependencySource?.packageCount!==ctx.entries.length || evidence.tools?.factoryArtifact!=='1.0.0' || typeof evidence.tools?.node!=='string' || !/^v24\.\d+\.\d+$/.test(evidence.tools.node) || typeof evidence.tools?.npm!=='string' || evidence.tools?.typescript!==ctx.manifest.devDependencies?.typescript) deny('Source, tool, validation, or digest evidence does not match the trusted release artifact.');
 const sourceEvidence=evidence.source.files;
 if(sourceEvidence?.workloadSource?.path!==ctx.sourcePath || sourceEvidence?.workloadSource?.sha256!==sha256(rawGit(ctx.repo,['show',`${ctx.revision}:${ctx.sourcePath}`])) || sourceEvidence?.manifest?.path!==ctx.manifestPath || sourceEvidence?.manifest?.sha256!==sha256(rawGit(ctx.repo,['show',`${ctx.revision}:${ctx.manifestPath}`])) || sourceEvidence?.lockfile?.path!==ctx.lockPath || sourceEvidence?.lockfile?.sha256!==sha256(rawGit(ctx.repo,['show',`${ctx.revision}:${ctx.lockPath}`])) || !artifact.equals(Buffer.from(rawGit(ctx.repo,['show',`${ctx.revision}:${ctx.sourcePath}`])))) deny('Artifact bytes or committed source digests do not match the requested revision.');
 const bom=parseJson(bomBytes.toString('utf8'));
 if(json(bom)!==json(sbom(ctx,artifactDigest,evidence.createdAt))) deny('The SBOM packages, sources, or artifact association do not match the committed lockfile.');
 return {operation:'release-artifact',outcome:'passed',revision:ctx.revision,artifactDigest,sbomDigest:bomDigest,validationEvidenceDigest:sha256(JSON.stringify(validation)),dependencyCount:ctx.entries.length,dependencySource:{ecosystem:evidence.dependencySource.ecosystem,registry:evidence.dependencySource.registry,lockfile:evidence.dependencySource.lockfile,lockfileVersion:evidence.dependencySource.lockfileVersion,includesDevelopmentDependencies:evidence.dependencySource.includesDevelopmentDependencies,packageCount:evidence.dependencySource.packageCount},results:[{capability:'traceable-build-artifacts',required:true,status:'passed',reason:'Downloaded bytes, SBOM, validation evidence, and source metadata match the recorded immutable source revision; verification performed without rebuilding.'}]};
}
/** @param {Record<string,string>} options */
export async function releaseArtifact(options) {
 try {
  const repo=resolve(options['--trusted-repo']??'.'),ctx=context(repo,options['--trusted-revision']);
  if(options['--mode']==='produce' && options['--validation-evidence'] && options['--output-dir']) {
   const report=parseJson(regularFile(resolve(options['--validation-evidence'])).toString('utf8'));
   return produce(options['--output-dir'],ctx,report);
  }
  if(options['--mode']==='verify' && options['--artifact-directory']) return verify(options['--artifact-directory'],ctx,options['--trusted-revision']);
  deny('Use produce with validation evidence and output directory, or verify with an artifact directory.');
 } catch(error) {
  return {operation:'release-artifact',outcome:'blocked',results:[{capability:'traceable-build-artifacts',required:true,status:'error',reason:error instanceof Error?error.message:'Artifact evidence is incomplete or unavailable.'}]};
 }
}
