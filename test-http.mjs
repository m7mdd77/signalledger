import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import http from 'node:http';
const child=spawn(process.execPath,['server.mjs'],{stdio:['ignore','pipe','pipe'],windowsHide:true});
const checks=[];
try{
  await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw new Error('Server exited before listening');}),new Promise((_,reject)=>setTimeout(()=>reject(new Error('Startup timeout')),5000).unref())]);
  for(const path of ['/','/app.mjs','/style.css','/icons.js','/profiles.json','/run-report.json']){
    const response=await fetch('http://127.0.0.1:3288'+path);assert.equal(response.status,200,path);
    assert.ok((await response.text()).length>20,path);assert.ok(response.headers.get('content-security-policy'));checks.push(path);
  }
  assert.equal((await fetch('http://127.0.0.1:3288/',{method:'POST'})).status,405);checks.push('POST rejected');
  const badHost=await new Promise((resolve,reject)=>{http.get('http://127.0.0.1:3288/',{headers:{host:'unexpected.example'}},response=>{response.resume();response.on('end',()=>resolve(response.statusCode));}).on('error',reject);});
  assert.equal(badHost,403);checks.push('Host rejected');
  const report={checked_at:new Date().toISOString(),passed:checks.length,checks,browser_ui_verified:false};
  await writeFile('out/http-verification.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{const ended=once(child,'exit');child.kill();await ended;}
