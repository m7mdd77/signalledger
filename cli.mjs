import {readFile,writeFile,mkdir,rename,open,unlink} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {research,orgNumber,hash} from './agent.mjs';

export function parseInputs(text) {
  let rows;
  try { const data=JSON.parse(text); rows=Array.isArray(data)?data:Array.isArray(data?.companies)?data.companies:[data]; } catch { rows=text.trim().split(/\r?\n/).filter(Boolean).map(line=>{try{return JSON.parse(line);}catch{return line;}}); }
  if (!Array.isArray(rows) || !rows.length) throw new Error('Input must be a non-empty JSON array, companies array, or JSONL');
  return rows.map(row=>String(typeof row==='object'?row.organisation_number ?? row.organisasjonsnummer ?? row.orgnr ?? row.org_number ?? '':row));
}
export async function collect({inputs,directory,concurrency=3,websites=false,run=research}) {
  directory=resolve(directory); await mkdir(directory,{recursive:true});
  const lock=join(directory,'.collect.lock');
  const handle=await open(lock,'wx').catch(()=>{throw new Error('Output directory is locked by another collector; inspect before removing lock');});
  try {
    let old=[]; try{old=JSON.parse(await readFile(join(directory,'profiles.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
    const previous=new Map(old.map(p=>[p.organisation_number,p]));
    const id=new Date().toISOString().replace(/[:.]/g,'-');
    await mkdir(join(directory,'snapshots'),{recursive:true});
    const results=new Array(inputs.length); let next=0;
    await Promise.all(Array.from({length:Math.min(concurrency,inputs.length)},async()=>{
      while(next<inputs.length) {
        const i=next++; const input=inputs[i]; let p;
        try{p=await run(input,{previous:previous.get(input),websites});}
        catch(e){p={organisation_number:input,state:'failed',identity:null,claims:[],evidence:[],snapshots:[],sections:{},refresh:{},errors:[{source:'worker',message:e.message}],metrics:{requests:0,elapsed_ms:0}};}
        for(const s of p.snapshots ?? []) {
          if(!/^[a-f0-9]{64}$/.test(s.id))throw new Error('Unsafe snapshot ID');
          await writeFile(join(directory,'snapshots',s.id+'.json'),JSON.stringify(s));
        }
        delete p.snapshots; results[i]=p;
        process.stderr.write(`${i+1}/${inputs.length} ${input} ${p.state} ${p.claims.length} claims\n`);
      }
    }));
    const encoded=JSON.stringify(results,null,2);
    // Preserve the full preceding result, then atomically replace only the current view.
    if(old.length)await writeFile(join(directory,`profiles-before-${id}.json`),JSON.stringify(old,null,2));
    await writeFile(join(directory,`profiles-${id}.json`),encoded);
    await writeFile(join(directory,'profiles.json.tmp'),encoded); await rename(join(directory,'profiles.json.tmp'),join(directory,'profiles.json'));
    await writeFile(join(directory,'envelopes.jsonl'),results.map(p=>JSON.stringify(p)).join('\n')+'\n');
    const times=results.map(p=>p.metrics.elapsed_ms).sort((a,b)=>a-b);
    const report={run_at:new Date().toISOString(),input_count:inputs.length,output_count:results.length,input_hash:hash(inputs),terminal_counts:Object.fromEntries(['available','not_available','blocked','not_applicable','ambiguous','failed'].map(s=>[s,results.filter(p=>p.state===s).length])),claim_count:results.reduce((s,p)=>s+p.claims.length,0),request_count:results.reduce((s,p)=>s+p.metrics.requests,0),p50_company_ms:times[Math.floor(times.length*.5)],p95_company_ms:times[Math.min(times.length-1,Math.floor(times.length*.95))],external_api_cost_usd:0,official_score:null,score_note:'Smoke/completion evidence only; precision/recall and qualification require an organizer-run reference set.'};
    await writeFile(join(directory,'run-report.json'),JSON.stringify(report,null,2));
    return report;
  } finally { await handle.close(); await unlink(lock); }
}
export async function main(args=process.argv.slice(2)) {
  const get=name=>args.includes(name)?args[args.indexOf(name)+1]:undefined;
  const input=get('--input'); if(!input)throw new Error('Usage: node cli.mjs --input companies.jsonl --output out [--websites] [--concurrency 3]');
  const concurrency=Number(get('--concurrency') ?? 3); if(!Number.isInteger(concurrency)||concurrency<1||concurrency>4)throw new Error('Concurrency must be 1-4');
  const inputs=parseInputs(await readFile(input,'utf8'));
  const report=await collect({inputs,directory:get('--output')??'out',concurrency,websites:args.includes('--websites')});
  console.log(JSON.stringify(report,null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(e=>{console.error(e.message);process.exitCode=1;});
