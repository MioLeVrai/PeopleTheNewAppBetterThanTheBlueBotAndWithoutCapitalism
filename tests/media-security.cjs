"use strict";
/* PEOPLE_MEDIA_AT_REST_V1: disposable local tests for encrypted media and seen rings. */
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const net=require("node:net");
const {spawn}=require("node:child_process");
const root=path.resolve(__dirname,"..");
const dir=fs.mkdtempSync(path.join(os.tmpdir(),"people-secure-media-test-"));
const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5yQAAAAASUVORK5CYII=","base64");
const iconData="data:image/png;base64,"+png.toString("base64");
let child;
async function main(){
 for (const filename of ["server.js","people-stories-server.js","people-media-crypto.js"]) fs.copyFileSync(path.join(root,filename),path.join(dir,filename));
 const port=await new Promise(resolve=>{const server=net.createServer();server.listen(0,"127.0.0.1",()=>{const port=server.address().port;server.close(()=>resolve(port));});});
 const base=`http://127.0.0.1:${port}`;
 async function boot(migrate=false){
  let output="";
  child=spawn(process.execPath,[path.join(dir,"server.js")],{cwd:root,env:{...process.env,PORT:String(port),DATABASE_URL:"",SESSION_SECRET:"test-secret",NODE_ENV:"test",NODE_PATH:path.join(root,"node_modules"),PEOPLE_MEDIA_MIGRATE:migrate?"1":"0"},windowsHide:true});
  child.stdout.on("data",b=>{output+=b.toString();});child.stderr.on("data",b=>{output+=b.toString();});
  for(let i=0;i<200;i++){try{if((await fetch(base+"/health")).ok)return;}catch(_){}if(child.exitCode!==null)throw Error(output);await new Promise(r=>setTimeout(r,40));}
  throw Error("Server did not start: "+output);
 }
 async function stop(){if(child&&child.exitCode===null){const gone=new Promise(resolve=>child.once("exit",resolve));child.kill();await gone;}child=null;}
 const raw=async(cookie,url,opts={})=>await fetch(base+url,{...opts,headers:{Cookie:cookie,...opts.headers}});
 const api=async(cookie,url,opts={},expected=200)=>{const response=await raw(cookie,url,opts);const body=await response.json();assert.equal(response.status,expected,`${url} ${JSON.stringify(body)}`);return body;};
 const json=(method,body)=>({method,headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
 try{
  await boot();
  const login=await raw("","/api/auth/register",json("POST",{username:"SecureTester",password:"strong-pwd-123"}));assert.equal(login.status,200);const cookie=login.headers.get("set-cookie").split(";")[0];const account=(await login.json()).user;
  const accountId=String(account.id);
  const uploaded=await raw(cookie,"/api/profile/avatar",{method:"PUT",headers:{"Content-Type":"image/png"},body:png});assert.equal(uploaded.status,200,await uploaded.text());
  const avatarFile=path.join(dir,"people-avatars",accountId+".png");const avatarStored=fs.readFileSync(avatarFile);assert.equal(avatarStored.subarray(0,8).toString(),"PEOPMED1");assert.notDeepEqual(avatarStored,png);
  const readAvatar=await raw(cookie,"/api/profile/avatar/SecureTester");assert.deepEqual(Buffer.from(await readAvatar.arrayBuffer()),png);
  const server=(await api(cookie,"/api/servers",json("POST",{name:"Secure Icons"}),201)).server;
  await api(cookie,`/api/servers/${server.id}/icon`,json("PATCH",{iconData}));
  const localServersFile=path.join(dir,"people-servers.local.json");
  const serverFiles=fs.readdirSync(dir).filter(name=>name.includes('server')&&name.endsWith('.json'));
  const actualServers=serverFiles.map(n=>path.join(dir,n)).find(n=>fs.readFileSync(n,'utf8').includes('people-media:v1:'));
  assert.ok(actualServers,`Server icon must be encrypted in local JSON, found ${serverFiles.join(',')}`);
  assert.equal((await api(cookie,"/api/servers")).servers.find(s=>s.id===server.id).iconData,iconData);
  const story=await api(cookie,"/api/stories",{method:"POST",headers:{"Content-Type":"application/octet-stream","X-People-Story-Type":"image/png"},body:png},201);
  const storyFile=path.join(dir,"people-stories",story.id+".png");assert.equal(fs.readFileSync(storyFile).subarray(0,8).toString(),"PEOPMED1");
  const media=await raw(cookie,`/api/stories/media/${story.id}`);assert.deepEqual(Buffer.from(await media.arrayBuffer()),png);
  const before=await api(cookie,"/api/stories/active",json("POST",{usernames:["SecureTester"]}));assert.equal(before.users[0].unseenCount,1);
  await api(cookie,`/api/stories/${story.id}/view`,{method:"POST"});const viewed=await api(cookie,"/api/stories/active",json("POST",{usernames:["SecureTester"]}));assert.equal(viewed.users[0].unseenCount,0);
  await stop();
  // Simulate a legacy installation. The explicitly enabled migration converts it safely on restart.
  fs.writeFileSync(avatarFile,png);
  fs.writeFileSync(storyFile,png);
  const jsonData=JSON.parse(fs.readFileSync(actualServers,'utf8'));
  jsonData.servers.find(s=>String(s.id)===String(server.id)).iconData=iconData;
  fs.writeFileSync(actualServers,JSON.stringify(jsonData));
  await boot(true);
  assert.equal(fs.readFileSync(avatarFile).subarray(0,8).toString(),"PEOPMED1");
  assert.equal(fs.readFileSync(storyFile).subarray(0,8).toString(),"PEOPMED1");
  assert.ok(fs.readFileSync(actualServers,'utf8').includes('people-media:v1:'));
  assert.deepEqual(Buffer.from(await (await raw(cookie,"/api/profile/avatar/SecureTester")).arrayBuffer()),png);
  assert.deepEqual(Buffer.from(await (await raw(cookie,`/api/stories/media/${story.id}`)).arrayBuffer()),png);
  assert.equal((await api(cookie,"/api/servers")).servers.find(s=>s.id===server.id).iconData,iconData);
  assert.equal((await api(cookie,"/api/stories/active",json("POST",{usernames:["SecureTester"]}))).users[0].unseenCount,0);
  const createCrypto=require(path.join(dir,"people-media-crypto.js"));const instance=createCrypto(Buffer.alloc(32,1));
  const cipher=instance.sealBuffer(png,"avatar","account-1");
  assert.deepEqual(instance.openBuffer(cipher,"avatar","account-1"),png);
  assert.throws(()=>instance.openBuffer(cipher,"avatar","account-2"));
  const tampered=Buffer.from(cipher);tampered[tampered.length-1]^=1;
  assert.throws(()=>instance.openBuffer(tampered,"avatar","account-1"));
  console.log("PASS: story/avatars/icons AES-GCM encrypted, readback, seen state persistence, legacy migration and tamper detection.");
 } finally {await stop();fs.rmSync(dir,{recursive:true,force:true});}
}
main().catch(err=>{console.error(err);process.exitCode=1;});
