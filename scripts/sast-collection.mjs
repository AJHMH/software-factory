import { writeFileSync } from 'node:fs';
import { sastContext, evaluateSast, sastError } from './sast-evaluation.mjs';
import { UnsupportedSecurityCapability } from './security-evaluation.mjs';

/** @typedef {{id:number,commit_sha:string,ref:string,category:string,analysis_key:string,tool:{name:string,version:string},error:string,warning:string,rules_count:number,results_count:number}} Metadata */
/** @typedef {{id:string,helpUri?:string,properties?:{'security-severity'?:string,queryURI?:string}}} Rule */
/** @typedef {{ruleId:string,locations?:Array<{physicalLocation:{artifactLocation:{uri:string},region:{startLine:number}}}>}} Result */
/** @typedef {{tool:{driver:{name:string,semanticVersion:string,rules?:Rule[]},extensions?:Array<{rules?:Rule[]}>},results:Result[],versionControlProvenance?:Array<{revisionId:string,repositoryUri:string}>}} Run */

/** Read-only, fixed-origin GitHub API. Never log credentials, raw findings, snippets, or response bodies. @param {string} path @param {string} accept */
async function api(path,accept='application/vnd.github+json') {
  const token=process.env.FACTORY_GITHUB_TOKEN;
  if (!token) throw new Error('GitHub authentication unavailable.');
  const response=await fetch(`https://api.github.com/${path}`,{headers:{Authorization:`Bearer ${token}`,Accept:accept,'X-GitHub-Api-Version':'2026-03-10'},signal:AbortSignal.timeout(30000),redirect:'error'});
  if (!response.ok) throw new Error('GitHub analysis evidence unavailable.');
  const text=await response.text();
  if (text.length > 16*1024*1024) throw new Error('Analysis response exceeds supported size.');
  return JSON.parse(text);
}

/** @param {Record<string,string>} options */
export async function collectSast(options) {
  try {
    const context=sastContext(options), repository=options['--repository'], ref=options['--ref'];
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? '') || !/^refs\/(pull\/[0-9]+\/head|heads\/[A-Za-z0-9._/-]+)$/.test(ref ?? '')) throw new Error('Repository and exact source ref required.');
    /** @type {Metadata | undefined} */ let selected;
    const analysisKey=options['--analysis-key'];
    if (analysisKey && !context.codeql.analysis_keys.includes(analysisKey)) throw new Error('Unapproved analysis identity.');
    const deadline=Date.now()+240000;
    while (!selected) {
      const analyses=/** @type {Metadata[]} */(await api(`repos/${repository}/code-scanning/analyses?ref=${encodeURIComponent(ref)}&tool_name=CodeQL&per_page=100`));
      if (!Array.isArray(analyses)) throw new Error('Malformed analysis list.');
      selected=analyses.find(analysis=>analysis.commit_sha === context.revision && analysis.ref === ref && analysis.category === context.codeql.category && (analysisKey ? analysis.analysis_key === analysisKey : context.codeql.analysis_keys.includes(analysis.analysis_key)) && analysis.tool.name === 'CodeQL');
      if (!selected) {
        if (Date.now() >= deadline) throw new Error('No completed analysis for the exact revision.');
        await new Promise(resolve=>setTimeout(resolve,10000));
      }
    }
    if (selected.error !== '' || selected.warning !== '' || selected.rules_count < 1) return sastError('error','GitHub CodeQL reports an analysis/build error, warning, or empty query set. Inspect its workflow logs; rerun the exact revision.');
    const sarif=/** @type {{version:string,runs:Run[]}} */(await api(`repos/${repository}/code-scanning/analyses/${selected.id}`,'application/sarif+json'));
    if (sarif.version !== '2.1.0' || !Array.isArray(sarif.runs) || sarif.runs.length !== 1) throw new Error('Incomplete SARIF.');
    const run=sarif.runs[0];
    if (run.tool.driver.name !== 'CodeQL' || run.tool.driver.semanticVersion !== selected.tool.version || !run.versionControlProvenance?.some(source=>source.revisionId === context.revision && source.repositoryUri.toLowerCase() === `https://github.com/${repository}`.toLowerCase()) || !Array.isArray(run.results) || run.results.length !== selected.results_count) throw new Error('SARIF identity or result count mismatch.');
    const rules=[...(run.tool.driver.rules ?? []),...(run.tool.extensions ?? []).flatMap(extension=>extension.rules ?? [])];
    if (rules.length !== selected.rules_count) throw new Error('SARIF query inventory incomplete.');
    const findings=run.results.map(result=>{
      const matching=rules.filter(rule=>rule.id === result.ruleId);
      if (matching.length !== 1) throw new Error('Missing or ambiguous rule.');
      const rule=matching[0], raw=rule.properties?.['security-severity'];
      if (typeof raw !== 'string' || !/^(?:[0-9](?:\.[0-9]+)?|10(?:\.0+)?)$/.test(raw)) throw new Error('Unknown security severity.');
      const score=Number(raw);
      const severity=score >= 9 ? 'critical' : score >= 7 ? 'high' : score >= 4 ? 'medium' : score > 0 ? 'low' : 'none';
      const location=result.locations?.[0]?.physicalLocation;
      if (!location) throw new Error('Finding lacks actionable location.');
      return {rule:rule.id,severity:/** @type {import('./sast-evaluation.mjs').Finding['severity']} */(severity),path:decodeURIComponent(location.artifactLocation.uri),line:location.region.startLine,help_url:rule.helpUri ?? rule.properties?.queryURI ?? ''};
    });
    const evidence=/** @type {import('./sast-evaluation.mjs').Evidence} */({version:'1.0',revision:context.revision,tree_digest:context.treeDigest,contract_digest:context.contractDigest,workload_id:context.contract.workload_id,profile:context.contract.profile,analyses:[{id:selected.id,revision:selected.commit_sha,ref:selected.ref,language:context.codeql.language,build_mode:context.codeql.build_mode,tool_version:selected.tool.version,rules_count:selected.rules_count,status:'success',findings}]});
    if (options['--output']) writeFileSync(options['--output'],JSON.stringify(evidence,null,2)+'\n');
    return evaluateSast(options,evidence);
  } catch(error) { return sastError(error instanceof UnsupportedSecurityCapability ? 'unsupported' : 'error'); }
}
