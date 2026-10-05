import { readFileSync, writeFileSync } from 'node:fs';

const run = JSON.parse(readFileSync('tmp/producer.json', 'utf8'));
if (String(run.id) !== process.env.PRODUCER_RUN_ID || run.repository?.full_name !== process.env.REPOSITORY || run.head_sha !== process.env.SOURCE_REVISION || run.head_branch !== 'main' || run.event !== 'push' || run.path !== '.github/workflows/factory-adoption.yml' || run.status !== 'completed' || run.conclusion !== 'success') throw new Error('A successful exact-revision consumer adoption push to main must produce the package.');
const input = process.env.EVIDENCE_BUNDLE ?? '';
if (Buffer.byteLength(input) > 1_048_576) throw new Error('Consumer certification evidence exceeds its size limit.');
const evidence = JSON.parse(input);
if (evidence.revision !== process.env.SOURCE_REVISION) throw new Error('Consumer evidence is for a different source revision.');
writeFileSync('tmp/evidence.json', JSON.stringify(evidence), { flag: 'wx', mode: 0o600 });
