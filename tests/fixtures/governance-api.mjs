import { readFileSync, writeFileSync } from 'node:fs';
const filename=process.env.GOVERNANCE_API_FIXTURE,state=JSON.parse(readFileSync(filename,'utf8'));
globalThis.fetch=async(url,options={})=>{
  const parsed=new URL(url);if(parsed.origin !== 'https://api.github.com') throw new Error('Unexpected API destination.');
  if(state.denied) return new Response('{}',{status:state.denied});
  const path=parsed.pathname;
  if(options.method && options.method !== 'GET') {
    if(!path.includes('/rulesets')) throw new Error('Unexpected mutation.');
    const body=JSON.parse(options.body);
    if(options.method === 'POST') state.rulesets.push({...body,id:99,source_type:'Repository'});
    else state.rulesets[state.rulesets.findIndex(r=>r.id === Number(path.split('/').at(-1)))]= {...body,id:Number(path.split('/').at(-1)),source_type:'Repository'};
    writeFileSync(filename,JSON.stringify(state));return Response.json(body);
  }
  if(path.endsWith('/rulesets')) return Response.json(state.rulesets.map(r=>({id:r.id,source_type:r.source_type})));
  if(path.includes('/rulesets/')) return Response.json(state.rulesets.find(r=>r.id === Number(path.split('/').at(-1))));
  return Response.json({full_name:state.repository,default_branch:state.default_branch});
};
