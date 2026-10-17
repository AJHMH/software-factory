import { readFileSync, writeFileSync } from 'node:fs';

const run = JSON.parse(readFileSync('tmp/producer.json', 'utf8'));
const pull = JSON.parse(readFileSync('tmp/producer-pull.json', 'utf8'));
const number = Number(process.env.PULL_REQUEST);
if (!Number.isSafeInteger(number) || number < 1 || pull.number !== number || pull.merged !== true || pull.state !== 'closed' || pull.head?.sha !== process.env.SOURCE_REVISION || pull.head?.repo?.full_name !== process.env.REPOSITORY || pull.base?.repo?.full_name !== process.env.REPOSITORY || pull.base?.ref !== 'main' || !/^[a-f0-9]{40}$/.test(pull.merge_commit_sha ?? '')) throw new Error('The producer must belong to the exact reviewed head of the merged consumer pull request.');
if (String(run.id) !== process.env.PRODUCER_RUN_ID || run.repository?.full_name !== process.env.REPOSITORY || run.head_sha !== process.env.SOURCE_REVISION || run.event !== 'pull_request' || run.path !== '.github/workflows/factory-adoption.yml' || run.status !== 'completed' || run.conclusion !== 'success' || !Array.isArray(run.pull_requests) || !run.pull_requests.some((/** @type {Record<string, any>} */ item) => item.number === number && item.head?.sha === pull.head.sha && item.base?.sha === pull.base.sha)) throw new Error('A successful exact-head consumer adoption PR run must produce the package.');
const input = process.env.EVIDENCE_BUNDLE ?? '';
if (Buffer.byteLength(input) > 1_048_576) throw new Error('Consumer certification evidence exceeds its size limit.');
const evidence = JSON.parse(input);
if (evidence.revision !== process.env.SOURCE_REVISION || evidence.reports?.coverage?.baseRevision !== pull.base.sha) throw new Error('Consumer evidence is for a different source revision.');
writeFileSync('tmp/evidence.json', JSON.stringify(evidence), { flag: 'wx', mode: 0o600 });
