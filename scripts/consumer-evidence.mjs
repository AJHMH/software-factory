import { readFileSync, writeFileSync, lstatSync } from 'node:fs';
import { resolve, join } from 'node:path';
import Ajv from 'ajv';

const schema = JSON.parse(readFileSync(new URL('../schemas/release-certification.schema.json', import.meta.url), 'utf8'));
const validate = new Ajv.default({allErrors:true,strict:true}).compile(schema);
const operations = {validation:'validate',policy:'policy',coverage:'coverage',security:'security',sast:'sast',human_review:'human-review'};
/** Assemble supplied gate reports; live certification must independently revalidate them.
 * @param {Record<string,string>} options
 */
export function assembleConsumerEvidence(options) {
  try {
    const revision = options['--source-revision'], trusted = options['--trusted-revision'], base = options['--base-revision'], head = options['--review-head'];
    if ([revision,trusted,base,head].some(value => !/^[a-f0-9]{40}$/.test(value ?? ''))) throw new Error('Full source, Factory, baseline and reviewed-head revisions are required.');
    const directory = resolve(options['--reports-directory']);
    /** @type {Record<string,any>} */ const reports = {};
    for (const [name,operation] of Object.entries(operations)) {
      const filename = join(directory, `${name}.json`), stat = lstatSync(filename);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 262144) throw new Error('Unsupported report file.');
      const report = JSON.parse(readFileSync(filename,'utf8'));
      if (report.operation !== operation || report.outcome !== 'passed' || report.revision !== (name === 'human_review' ? head : revision) || name !== 'validation' && report.trustedRevision !== trusted || ['coverage','human_review'].includes(name) && report.baseRevision !== base || !Array.isArray(report.results) || !report.results.length || report.results.some((/** @type {any} */ gate) => gate.required !== false && gate.status !== 'passed')) throw new Error('Missing, failed, stale or mismatched gate report.');
      const evidenceDigest=name === 'validation' ? report.contractDigest : report.evidenceDigest;
      const policyDigest=name === 'coverage' ? report.qualityDigest : report.policyDigest;
      if (!/^[a-f0-9]{64}$/.test(evidenceDigest ?? '') || name !== 'validation' && !/^[a-f0-9]{64}$/.test(policyDigest ?? '')) throw new Error('Missing gate digest.');
      reports[name] = report;
    }
    const bundle = {version:'1.0',revision,reports};
    if (!validate(bundle) || Buffer.byteLength(JSON.stringify(bundle)) > 1048576) throw new Error('Invalid or oversized evidence bundle.');
    writeFileSync(resolve(options['--output']),JSON.stringify(bundle,null,2)+'\n',{flag:'wx',mode:0o600});
    return {operation:'consumer-evidence',outcome:'passed',certification:'not-run',bundle,results:[{capability:'consumer-evidence-assembly',required:true,status:'passed',reason:'Supplied reports assembled with separate source, Factory, baseline and reviewed-head identities. Live certification has not run.'}]};
  } catch {
    return {operation:'consumer-evidence',outcome:'blocked',certification:'not-run',results:[{capability:'consumer-evidence-assembly',required:true,status:'failed',reason:'Evidence assembly requires six complete passing reports bound to the selected source, Factory, baseline and reviewed head, and a new output file.'}]};
  }
}
