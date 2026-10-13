"use strict";
/* PEOPLE_STORIES_V1 integration regression test: isolated storage and auth. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { spawn, execFileSync } = require("node:child_process");
async function main() {
  const root = path.resolve(__dirname,"..");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),"people-stories-test-"));
  fs.copyFileSync(path.join(root,"server.js"),path.join(dir,"server.js"));
  fs.copyFileSync(path.join(root,"people-stories-server.js"),path.join(dir,"people-stories-server.js"));
  const port = await new Promise(resolve=>{const listener=net.createServer();listener.listen(0,"127.0.0.1",()=>{const p=listener.address().port;listener.close(()=>resolve(p));});});
  const base=`http://127.0.0.1:${port}`;
  let child, log="";
  const launch=async()=>{
    child=spawn(process.execPath,[path.join(dir,"server.js")],{cwd:root,env:{...process.env,PORT:String(port),DATABASE_URL:"",NODE_ENV:"test",SESSION_SECRET:"stories-test-secret",NODE_PATH:path.join(root,"node_modules")},windowsHide:true});
    child.stdout.on("data",x=>{log+=x;});child.stderr.on("data",x=>{log+=x;});
    for(let i=0;i<200;i++){try{if((await fetch(base+"/health")).ok)return;}catch(_){}if(child.exitCode!==null)throw Error(log);await new Promise(r=>setTimeout(r,50));}
    throw Error("Start timeout: "+log);
  };
  const stop=async()=>{if(child&&child.exitCode===null){const end=new Promise(r=>child.once("exit",r));child.kill();await end;}};
  const api=async(cookie,route,opts={},status=200)=>{
    const response=await fetch(base+route,{...opts,headers:{Cookie:cookie||"",...(opts.headers||{})}});
    assert.equal(response.status,status,`${opts.method||"GET"} ${route}: ${await response.clone().text()}`);
    const json=await response.json();return json;
  };
  const register=async username=>{
    const response=await fetch(base+"/api/auth/register",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username,password:"test-password-123"})});
    assert.equal(response.status,200,await response.text());
    return response.headers.get("set-cookie").split(";")[0];
  };
  const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5yQAAAAASUVORK5CYII=","base64");
  try {
    await launch();
    const owner=await register("StoryOwner"),friend=await register("StoryViewer");
    await api("","/api/stories/StoryOwner",{},401);
    await api(owner,"/api/stories/active",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({usernames:["StoryOwner"]})});
    const bad=await api(owner,"/api/stories",{method:"POST",headers:{"Content-Type":"application/octet-stream","X-People-Story-Type":"image/png"},body:Buffer.from("fake")},400);
    assert.match(bad.error,/Unsupported/);
    let ids=[];
    for(let i=0;i<10;i++) {
      const result=await api(owner,"/api/stories",{method:"POST",headers:{"Content-Type":"application/octet-stream","X-People-Story-Type":"image/png"},body:png},201);
      ids.push(result.id);
    }
    assert.equal((await api(friend,"/api/stories/StoryOwner")).parts.length,10,"Other users view all parts");
    assert.equal((await api(friend,"/api/stories/active",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({usernames:["StoryOwner","StoryViewer"]})})).users[0].count,10);
    await api(owner,"/api/stories",{method:"POST",headers:{"Content-Type":"application/octet-stream","X-People-Story-Type":"image/png"},body:png},409);
    await api(friend,`/api/stories/${ids[0]}`,{method:"DELETE"},403);
    const response=await fetch(base+`/api/stories/media/${ids[0]}`,{headers:{Cookie:friend,Range:"bytes=0-7"}});
    assert.equal(response.status,206);assert.equal((await response.arrayBuffer()).byteLength,8);
    assert.match(response.headers.get("content-type"),/image\/png/);
    assert.equal((await fetch(base+`/api/stories/media/${ids[0]}`)).status,401);
    await api(owner,`/api/stories/${ids[0]}`,{method:"DELETE"});
    assert.equal((await api(friend,"/api/stories/StoryOwner")).parts.length,9);
    const emptyUser=await api(friend,"/api/stories/StoryViewer");assert.equal(emptyUser.parts.length,0);
    let videoTest="skipped (ffmpeg not installed)";
    try {
      const shortFile=path.join(dir,"short.mp4"),longFile=path.join(dir,"long.mp4");
      execFileSync("ffmpeg",["-loglevel","error","-f","lavfi","-i","color=black:s=64x64:r=1:d=1","-t","1","-pix_fmt","yuv420p","-y",shortFile],{timeout:12000,windowsHide:true});
      execFileSync("ffmpeg",["-loglevel","error","-f","lavfi","-i","color=black:s=64x64:r=1:d=11","-t","11","-pix_fmt","yuv420p","-y",longFile],{timeout:12000,windowsHide:true});
      await api(owner,"/api/stories",{method:"POST",headers:{"Content-Type":"application/octet-stream","X-People-Story-Type":"video/mp4"},body:fs.readFileSync(longFile)},400);
      await api(owner,"/api/stories",{method:"POST",headers:{"Content-Type":"application/octet-stream","X-People-Story-Type":"video/mp4"},body:fs.readFileSync(shortFile)},201);
      videoTest="passed (1s accepted, 11s rejected)";
    } catch(err) { if(err.code!=="ENOENT")throw err; }
    await stop();await launch();
    assert.equal((await api(owner,"/api/stories/StoryOwner")).parts.length,10,"Stories persisted across restarts");
    console.log("PASS: story auth, upload, 10-part limit, cross-client lists, range playback, deletion, restart persistence; video: "+videoTest);
  } finally {await stop();fs.rmSync(dir,{recursive:true,force:true});}
}
main().catch(err=>{console.error(err);process.exitCode=1;});
