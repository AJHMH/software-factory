import { readFileSync, writeFileSync } from 'node:fs';
const filename = process.env.FACTORY_TEST_API;
const state = JSON.parse(readFileSync(filename, 'utf8'));
let reads = 0;
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(String(input)), path = url.pathname;
  if (url.hostname !== 'api.github.com') throw new Error('Unexpected fixture origin');
  const method = options.method ?? 'GET';
  if (method === 'POST') {
    state.writes ??= []; state.writes.push(path); writeFileSync(filename, JSON.stringify(state));
    return new Response(null, { status: state.writeDenied ? 403 : 201 });
  }
  let body;
  if (path.endsWith('/pulls/7')) {
    body = structuredClone(state.pr); reads++;
    if (state.stale && reads > 1) body.head.sha = 'd'.repeat(40);
    if (state.staleBase && reads > 1) body.base.sha = 'd'.repeat(40);
  } else if (path.endsWith('/permission')) body = { permission: state.permission ?? 'admin' };
  else if (path.endsWith('/reviews')) body = state.reviews;
  else if (path.endsWith('/actions/runs/900')) body = state.trigger;
  else if (path.endsWith('/actions/runs/100')) body = state.runs[0];
  else if (path.endsWith('/actions/runs/101')) body = state.runs[1];
  else if (path.endsWith('/jobs')) { const id = Number(path.split('/').at(-2)); body = { total_count: 1, jobs: [state.jobs[id]] }; }
  else if (path.endsWith('/runs')) { const id = path.includes('factory-agent-review') ? 1 : 2; const runs = state.runs.filter(run => run.workflow_id === id); body = { total_count: runs.length, workflow_runs: runs }; }
  else if (path.includes('/actions/workflows/')) {
    const name = path.split('/').at(-1);
    body = { id: name === 'factory-review-event.yml' ? 3 : name === 'factory-agent-review.yml' ? 1 : 2, path: `.github/workflows/${name}`, state: 'active' };
  } else throw new Error('Unexpected fixture request');
  return Response.json(body);
};
