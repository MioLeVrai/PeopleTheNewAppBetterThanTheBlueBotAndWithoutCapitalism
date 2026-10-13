/* PEOPLE_STORY_TRIM_V1: optional browser-side editor for story videos over 10 seconds. */
(() => {
  "use strict";
  if (window.PeopleStoryVideoTrimmer) return;

  const MAX_CLIP = 10;
  const MAX_BYTES = 50 * 1024 * 1024;
  const fmt = n => `${Math.floor(Math.max(0,n)/60)}:${String(Math.floor(Math.max(0,n)%60)).padStart(2,"0")}.${Math.floor((Math.max(0,n)%1)*10)}`;
  const delay = ms => new Promise(r => setTimeout(r,ms));

  function readEbmlSize(bytes, p) {
    if(p>=bytes.length) throw new Error("Invalid WebM file.");
    const first=bytes[p];let len=1,mask=0x80;
    while(len<=8 && !(first & mask)) {len++;mask>>=1;}
    if(len>8 || p+len>bytes.length)throw new Error("Invalid WebM element.");
    let size=BigInt(first & (mask-1));
    for(let i=1;i<len;i++)size=(size<<8n)|BigInt(bytes[p+i]);
    return {len,size};
  }
  function writeEbmlSize(bytes, p, len, size) {
    if(BigInt(size)>=(1n<<BigInt(7*len))-1n)throw new Error("WebM header is too large to edit.");
    let n=BigInt(size);
    for(let i=len-1;i>=0;i--) {bytes[p+i]=Number(n & 255n);n>>=8n;}
    bytes[p] |= 1<<(8-len);
  }
  // Chrome's MediaRecorder writes a Duration element in WebM Info.
  // Do not insert bytes into WebM: doing so would break SeekHead offsets.
  async function verifyWebmDuration(blob) {
    const bytes=new Uint8Array(await blob.arrayBuffer());
    const signature=[0x15,0x49,0xa9,0x66];
    for(let p=0;p<Math.min(65536,bytes.length-24);p++) {
      if(!signature.every((n,i)=>bytes[p+i]===n))continue;
      try {
        const candidate=readEbmlSize(bytes,p+4);
        const start=p+4+candidate.len,finish=start+Number(candidate.size);
        if(finish>bytes.length||finish>start+1024||finish<=start)continue;
        let scale=1000000;
        for(let i=start;i<finish-6;i++) {
          if(bytes[i]===0x2a&&bytes[i+1]===0xd7&&bytes[i+2]===0xb1&&bytes[i+3]===0x83) {
            scale=(bytes[i+4]<<16)|(bytes[i+5]<<8)|bytes[i+6];
          }
        }
        for(let i=start;i<finish-6;i++) {
          if(bytes[i]!==0x44||bytes[i+1]!==0x89)continue;
          const width=bytes[i+2]&0x7f;
          if((width!==4&&width!==8)||i+3+width>finish)continue;
          const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
          const number=width===4?view.getFloat32(i+3,false):view.getFloat64(i+3,false);
          const seconds=number*scale/1e9;
          if(Number.isFinite(seconds)&&seconds>0&&seconds<=10) return blob;
        }
      } catch(_) {}
    }
    throw new Error("The browser could not export a valid 10-second WebM. Please use the latest People client.");
  }

  async function trim(file, duration) {
    if(!(duration>MAX_CLIP) || !Number.isFinite(duration)) return file;
    if(file.size>MAX_BYTES)throw new Error("The original file must be 50 MB or smaller.");
    if(typeof MediaRecorder!=="function"||typeof HTMLVideoElement.prototype.captureStream!=="function") {
      throw new Error("This browser cannot trim videos. Please use a recent Chromium-based People client.");
    }
    const mime=["video/webm;codecs=vp8,opus","video/webm;codecs=vp9,opus","video/webm"]
      .find(m=>MediaRecorder.isTypeSupported(m));
    if(!mime)throw new Error("Video recording is not available in this browser.");

    const url=URL.createObjectURL(file);
    const overlay=document.createElement("div");overlay.className="people-story-dialog people-story-trimmer";
    const panel=document.createElement("section");panel.className="people-story-dialog__panel";
    panel.setAttribute("role","dialog");panel.setAttribute("aria-modal","true");panel.setAttribute("aria-label","Trim story video");panel.tabIndex=-1;
    panel.innerHTML=`
      <header><strong>Trim video for your story</strong><button type="button" class="people-story-close" data-cancel aria-label="Cancel trimming">✕</button></header>
      <p>Choose any part of your video (up to 10 seconds). The original file won't be changed.</p>
      <video class="people-story-trimmer__video" playsinline preload="auto" controls></video>
      <div class="people-story-trimmer__ranges">
        <label>Start <output data-start-text></output><input type="range" data-start min="0" step="0.1"></label>
        <label>End <output data-end-text></output><input type="range" data-end min="0" step="0.1"></label>
        <div class="people-story-trimmer__chosen" aria-live="polite"></div>
      </div>
      <div class="people-story-trimmer__buttons"><button type="button" data-preview>Preview selection</button><button type="button" data-cancel>Cancel</button><button type="button" data-save>Trim &amp; Upload</button></div>
      <div class="people-story-trimmer__message" aria-live="polite"></div>`;
    overlay.append(panel);document.body.append(overlay);
    const video=panel.querySelector("video"),fromInput=panel.querySelector("[data-start]"),toInput=panel.querySelector("[data-end]");
    const startText=panel.querySelector("[data-start-text]"),endText=panel.querySelector("[data-end-text]");
    const chosen=panel.querySelector(".people-story-trimmer__chosen"),message=panel.querySelector(".people-story-trimmer__message");
    const preview=panel.querySelector("[data-preview]"),save=panel.querySelector("[data-save]");
    const cancels=[...panel.querySelectorAll("[data-cancel]")];
    let start=0,end=Math.min(10,duration),busy=false,settled=false;
    fromInput.max=String(Math.floor((duration-0.2)*10)/10);toInput.max=String(duration);
    fromInput.value="0";toInput.value=String(end);
    video.src=url;
    function sync() {
      startText.value=fmt(start);endText.value=fmt(end);
      chosen.textContent=`Selected: ${(end-start).toFixed(1)} seconds (max 10 seconds)`;
      fromInput.value=String(start);toInput.value=String(end);
      if(!video.paused){video.pause();}
    }
    function onStart() {
      start=Math.min(Number(fromInput.value),duration-.2);
      end=Math.min(duration,start+MAX_CLIP);
      if(end-start<.15)end=Math.min(duration,start+.2);
      video.currentTime=start;sync();
    }
    function onEnd() {
      end=Math.max(start+.2,Math.min(Number(toInput.value),start+MAX_CLIP,duration));
      video.currentTime=start;sync();
    }
    fromInput.addEventListener("input",onStart);
    toInput.addEventListener("input",onEnd);
    video.addEventListener("timeupdate",()=>{if(!busy && !video.paused && video.currentTime>=end-.03)video.pause();});
    preview.addEventListener("click",async()=>{
      if(busy)return;
      try { video.pause();video.currentTime=start;await new Promise((ok,fail)=>{if(!video.seeking)return ok();const timer=setTimeout(()=>fail(new Error("Unable to seek this video.")),5000);video.addEventListener("seeked",()=>{clearTimeout(timer);ok();},{once:true});});await video.play(); }
      catch(err){message.textContent=err.message;}
    });
    sync();panel.focus();
    return await new Promise(resolve=>{
      function finish(value){if(settled)return;settled=true;video.pause();video.removeAttribute("src");video.load();URL.revokeObjectURL(url);overlay.remove();resolve(value);}
      cancels.forEach(b=>b.addEventListener("click",()=>{if(!busy)finish(null);}));
      overlay.addEventListener("click",e=>{if(e.target===overlay&&!busy)finish(null);});
      const onKey=e=>{if(e.key==="Escape"&&!busy){e.preventDefault();e.stopImmediatePropagation();finish(null);}};
      window.addEventListener("keydown",onKey,true);
      const originalFinish=finish;
      finish=value=>{window.removeEventListener("keydown",onKey,true);originalFinish(value);};
      save.addEventListener("click",async()=>{
        if(busy||end-start<.2)return;
        busy=true;save.disabled=true;preview.disabled=true;cancels.forEach(b=>b.disabled=true);
        fromInput.disabled=true;toInput.disabled=true;message.textContent="Trimming… This takes about as long as the selected clip. Please keep People open.";
        try {
          video.pause();video.currentTime=start;
          await new Promise((resolveSeek,reject)=>{
            if(!video.seeking)return resolveSeek();
            let timer=setTimeout(()=>reject(new Error("Could not seek to the start.")),10000);
            video.addEventListener("seeked",()=>{clearTimeout(timer);resolveSeek();},{once:true});
          });
          const captured=video.captureStream();
          if(!captured.getVideoTracks().length) { captured.getTracks().forEach(t=>t.stop());throw new Error("Unable to capture the video track."); }
          const recorder=new MediaRecorder(captured,{mimeType:mime,videoBitsPerSecond:2500000});
          const chunks=[];
          recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
          const stopped=new Promise((resolveStop,reject)=>{
            recorder.addEventListener("stop",resolveStop,{once:true});
            recorder.addEventListener("error",e=>reject(e.error||new Error("Trimming failed.")),{once:true});
          });
          recorder.start();
          try {await video.play();}
          catch(err) { if(recorder.state!=="inactive")recorder.stop();await stopped;captured.getTracks().forEach(t=>t.stop());throw err; }
          const maxPlayback=Math.min(end-start,9.75);
          const target=Math.min(end,start+maxPlayback);
          let lastTime=video.currentTime;
          const deadline=Date.now()+(maxPlayback+3)*1000;
          while(video.currentTime<target-.05 && !video.ended && Date.now()<deadline) {
            await delay(30);lastTime=video.currentTime;
          }
          if(Date.now()>=deadline && video.currentTime<target-.2) {video.pause();if(recorder.state!=="inactive")recorder.stop();await stopped;captured.getTracks().forEach(t=>t.stop());throw new Error("Video playback stalled during trimming.");}
          video.pause();
          if(recorder.state!=="inactive")recorder.stop();
          await stopped;
          captured.getTracks().forEach(t=>t.stop());
          const raw=new Blob(chunks,{type:"video/webm"});
          if(!raw.size)throw new Error("The trimmed file is empty.");
          const fixed=await verifyWebmDuration(raw);
          if(fixed.size>MAX_BYTES)throw new Error("The trimmed video exceeds 50 MB.");
          message.textContent="Preparing upload…";
          finish(new File([fixed],`story-clip-${Date.now()}.webm`,{type:"video/webm"}));
        }catch(err){message.textContent=err.message||"Trimming failed.";busy=false;save.disabled=false;preview.disabled=false;cancels.forEach(b=>b.disabled=false);fromInput.disabled=false;toInput.disabled=false;}
      });
    });
  }
  window.PeopleStoryVideoTrimmer={trim};
})();
