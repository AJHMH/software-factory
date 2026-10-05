import { copyFileSync, mkdirSync } from 'node:fs';

const output = new URL('../dist/', import.meta.url);
mkdirSync(output, { recursive: true });
copyFileSync(new URL('../src/index.mjs', import.meta.url), new URL('index.mjs', output));
