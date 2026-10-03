import { installTools } from './security-tools.mjs';

try {
  await installTools('tmp/security-tools/installed');
  console.log('Pinned Gitleaks and OSV scanner artifacts and binaries verified.');
} catch {
  console.error('Security scanner installation failed; checksum-verified scanners are required.');
  process.exitCode = 1;
}
