import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';

const port=Number(process.env.PORT ?? 3288); const data=resolve(process.env.DATA_DIR ?? 'out');
const files=new Map([['/','public/index.html'],['/app.mjs','public/app.mjs'],['/style.css','public/style.css'],['/icons.js','node_modules/lucide/dist/umd/lucide.js']]);
const types={'.html':'text/html','.css':'text/css','.mjs':'text/javascript','.js':'text/javascript','.json':'application/json','.jsonl':'application/x-ndjson'};
const server=http.createServer(async(req,res)=>{
  const host=req.headers.host;
  if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(host)){res.writeHead(403);res.end('Host rejected');return;}
  const headers={'content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'",'x-content-type-options':'nosniff','cache-control':'no-store'};
  if(req.method!=='GET'){res.writeHead(405,headers);res.end('GET only');return;}
  try{
    const url=new URL(req.url,'http://'+host); let path=files.get(url.pathname);
    if(['/profiles.json','/run-report.json','/envelopes.jsonl'].includes(url.pathname))path=join(data,url.pathname.slice(1));
    if(url.pathname.startsWith('/snapshots/')){const name=url.pathname.slice(11);if(!/^[a-f0-9]{64}\.json$/.test(name))throw new Error('Invalid snapshot');path=join(data,'snapshots',name);}
    if(!path){res.writeHead(404,headers);res.end('Not found');return;}
    const body=await readFile(path);const ext=path.slice(path.lastIndexOf('.'));
    res.writeHead(200,{...headers,'content-type':(types[ext]??'application/octet-stream')+'; charset=utf-8'});res.end(body);
  }catch{res.writeHead(404,headers);res.end('No collected data at this path');}
});
server.listen(port,'127.0.0.1',()=>console.log(`SignalLedger http://127.0.0.1:${port}`));
