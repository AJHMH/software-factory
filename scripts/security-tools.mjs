import { mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';

export const versions = { gitleaks: '8.30.1', osv: '2.6.0' };
const platform = process.platform === 'win32' ? 'windows' : process.platform;
const pins = {
  windows: { gitleaks: ['https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_windows_x64.zip','d29144deff3a68aa93ced33dddf84b7fdc26070add4aa0f4513094c8332afc4e','17157e2ee8b76fc8b1d8bee607a250e34b8a8023c8bc81822d4b5ee4d78fcb7c'], osv: ['https://github.com/google/osv-scanner/releases/download/v2.6.0/osv-scanner_windows_amd64.exe','e0ed7644118b717b028c249ee9d3515024e55e8510747ca08906eb96765354d6','e0ed7644118b717b028c249ee9d3515024e55e8510747ca08906eb96765354d6'] },
  linux: { gitleaks: ['https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_linux_x64.tar.gz','551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb','88f91962aa2f93ac6ab281d553b9e125f5197bbbce38f9f2437f7299c32e5509'], osv: ['https://github.com/google/osv-scanner/releases/download/v2.6.0/osv-scanner_linux_amd64','ca69b3d3cd08f889a49dc0a383122f71cc528b83803671df5fd874d97485b108','ca69b3d3cd08f889a49dc0a383122f71cc528b83803671df5fd874d97485b108'] }
};
/** @param {Uint8Array} data */
const hash = data => createHash('sha256').update(data).digest('hex');
/** @param {string} directory */
export function verifiedTools(directory) {
  if (process.arch !== 'x64' || !Object.hasOwn(pins, platform)) throw new Error('Unsupported security scanner platform.');
  const selected = pins[/** @type {'windows'|'linux'} */ (platform)];
  const tools = { gitleaks: resolve(directory, 'gitleaks' + (platform === 'windows' ? '.exe' : '')), osv: resolve(directory, 'osv-scanner' + (platform === 'windows' ? '.exe' : '')) };
  for (const name of /** @type {const} */ (['gitleaks','osv'])) if (hash(readFileSync(tools[name])) !== selected[name][2]) throw new Error('Security scanner binary checksum mismatch.');
  return tools;
}
/** Download official, pinned artifacts; execute only after archive and binary checksum verification. @param {string} directory */
export async function installTools(directory) {
  if (process.arch !== 'x64' || !Object.hasOwn(pins, platform)) throw new Error('Unsupported security scanner platform.');
  mkdirSync(directory, { recursive: true });
  const selected = pins[/** @type {'windows'|'linux'} */ (platform)];
  for (const name of /** @type {const} */ (['gitleaks','osv'])) {
    const [url, checksum, binaryChecksum] = selected[name];
    const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw new Error('Security scanner download failed.');
    const artifact = Buffer.from(await response.arrayBuffer());
    if (hash(artifact) !== checksum) throw new Error('Security scanner artifact checksum mismatch.');
    let binary = artifact;
    const executable = name === 'osv' ? 'osv-scanner' : 'gitleaks';
    const filename = executable + (platform === 'windows' ? '.exe' : '');
    if (name === 'gitleaks') {
      const archive = join(directory, platform === 'windows' ? 'gitleaks.zip' : 'gitleaks.tar.gz');
      writeFileSync(archive, artifact);
      const extracted = spawnSync('tar', ['-xOf', archive, filename], { timeout: 30000, maxBuffer: 100 * 1024 * 1024, windowsHide: true });
      if (extracted.status !== 0) throw new Error('Security scanner extraction failed.');
      binary = extracted.stdout;
    }
    if (hash(binary) !== binaryChecksum) throw new Error('Security scanner binary checksum mismatch.');
    writeFileSync(join(directory, filename), binary); chmodSync(join(directory, filename), 0o755);
  }
  return verifiedTools(directory);
}
