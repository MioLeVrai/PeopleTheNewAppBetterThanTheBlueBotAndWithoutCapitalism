/* PEOPLE_STORIES_V1 — story playback/upload and avatar rings; no changes to presence. */
(() => {
  "use strict";
  if (window.PeopleStories) return;
  const key = value => String(value || "").trim().toLocaleLowerCase("fr-FR");
  const maxBytes = 50 * 1024 * 1024;
  const maxParts = 10;
  const active = new Map();
  const known = new Set();
  let refreshTimer = 0, refreshing = false, view = null, composer = null;
  let playbackTimer = 0;
  const ownName = () => document.getElementById("profileName")?.textContent?.trim() || "";
  const mediaUrl = id => `/api/stories/media/${encodeURIComponent(id)}`;
  function notify(message) { const text = document.getElementById("peopleStoryFeedback"); if (text) text.textContent = message; else if (message) alert(message); }
  async function request(url, options) {
    const response = await fetch(url, { credentials:"same-origin", ...options });
    let payload = null; try { payload = await response.json(); } catch (_) {}
    if (!response.ok || !payload?.ok) throw new Error(payload?.error || `Request failed (${response.status})`);
    return payload;
  }
  function excluded(element) {
    return Boolean(element.closest(".message, .dm-message, .people-message-group, .people-message-unit, .people-message-day, .people-story-dialog"));
  }
  function allAvatars() { return document.querySelectorAll("[data-people-avatar-username]"); }
  function repaint() {
    allAvatars().forEach(element => {
      const name = key(element.dataset.peopleAvatarUsername);
      const hasStory = (active.get(name) || 0) > 0 && !excluded(element);
      if (hasStory) {
        element.dataset.peopleStory = "1";
        if (!element.hasAttribute("title")) element.setAttribute("title", "View story");
      } else delete element.dataset.peopleStory;
    });
    const modalAvatar = document.getElementById("profileModalAvatar");
    if (modalAvatar) {
      const name = key(document.getElementById("profileModalName")?.textContent);
      if (active.get(name)) modalAvatar.dataset.peopleStory = "1";
      else delete modalAvatar.dataset.peopleStory;
    }
  }
  async function updateActive() {
    if (refreshing) { schedule(400); return; }
    refreshing = true;
    try {
      const names = [...new Set(Array.from(allAvatars()).filter(el=>!excluded(el)).map(el=>el.dataset.peopleAvatarUsername).filter(Boolean))];
      const self = ownName(); if (self) names.push(self);
      const pending = [...new Set(names)].filter(name => !known.has(key(name)));
      for (let i = 0; i < pending.length; i += 75) {
        const batch = pending.slice(i, i + 75);
        const response = await fetch("/api/stories/active", {method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({usernames:batch})});
        if (!response.ok) return;
        const result = await response.json();
        batch.forEach(name => { known.add(key(name)); active.delete(key(name)); });
        (result.users || []).forEach(user => active.set(key(user.username), Number(user.count)||0));
      }
      repaint();
    } catch (err) { console.warn("[People stories] Ring refresh failed",err); }
    finally { refreshing = false; }
  }
  function schedule(delay=100) { if (refreshTimer) return; refreshTimer=setTimeout(() => {refreshTimer=0;void updateActive();},delay); }
  function invalidate(username) { if (username) { known.delete(key(username)); active.delete(key(username)); } else {known.clear();active.clear();} repaint();schedule(); }
  function makeDialog(className,label) {
    const overlay=document.createElement("div");overlay.className=`people-story-dialog ${className}`;overlay.hidden=true;
    overlay.setAttribute("role","presentation");
    const panel=document.createElement("section");panel.className="people-story-dialog__panel";
    panel.setAttribute("role","dialog");panel.setAttribute("aria-modal","true");panel.setAttribute("aria-label",label);
    panel.tabIndex=-1;
    overlay.append(panel);
    overlay.addEventListener("click", event=>{if(event.target===overlay)closeOverlays();});
    document.body.append(overlay);
    return {overlay,panel};
  }
  function clearPlayback() {
    clearTimeout(playbackTimer);playbackTimer=0;
    if (!view) return;
    const video=view.panel.querySelector("video");
    if (video) {video.pause();video.removeAttribute("src");video.load();}
  }
  function closeOverlays() {
    clearPlayback();
    if(view) {view.overlay.hidden=true;view.username="";view.parts=[];}
    if(composer) composer.overlay.hidden=true;
  }
  function buildViewer() {
    if(view) return view;
    const result=makeDialog("people-story-viewer","View story");
    result.panel.innerHTML=`<header class="people-story-viewer__head"><strong class="people-story-viewer__author"></strong><span class="people-story-viewer__count"></span><button type="button" class="people-story-close" aria-label="Close story">✕</button></header><div class="people-story-viewer__progress"></div><div class="people-story-viewer__media"></div><div class="people-story-viewer__controls"><button type="button" data-move="-1" aria-label="Previous story">‹</button><button type="button" data-move="1" aria-label="Next story">›</button></div><footer class="people-story-viewer__footer"><button class="people-story-viewer__add" type="button" hidden>Add Story</button><button class="people-story-viewer__delete" type="button" hidden>Delete Part</button></footer>`;
    result.panel.querySelector(".people-story-close").addEventListener("click",closeOverlays);
    result.panel.querySelectorAll("[data-move]").forEach(btn=>btn.addEventListener("click",()=>moveStory(Number(btn.dataset.move))));
    result.panel.querySelector(".people-story-viewer__add").addEventListener("click",()=>{closeOverlays();void openComposer();});
    result.panel.querySelector(".people-story-viewer__delete").addEventListener("click",async()=>{
      if(!view?.isSelf || !view.parts[view.index] || !confirm("Delete this story part?"))return;
      try {await request(`/api/stories/${encodeURIComponent(view.parts[view.index].id)}`,{method:"DELETE"}); invalidate(view.username); await openViewer(view.username, Math.max(0,view.index-1));}
      catch(err){alert(err.message);}
    });
    view={...result,username:"",parts:[],index:0,isSelf:false};return view;
  }
  function displayStory() {
    if(!view || view.overlay.hidden)return;
    clearPlayback();
    const item=view.parts[view.index];if(!item){closeOverlays();return;}
    view.panel.querySelector(".people-story-viewer__author").textContent=view.username;
    view.panel.querySelector(".people-story-viewer__count").textContent=`${view.index+1} / ${view.parts.length}`;
    view.panel.querySelector(".people-story-viewer__add").hidden=!view.isSelf;
    view.panel.querySelector(".people-story-viewer__delete").hidden=!view.isSelf;
    const progress=view.panel.querySelector(".people-story-viewer__progress");progress.replaceChildren();
    view.parts.forEach((_,i)=>{const part=document.createElement("span");part.className=i<view.index?"complete":i===view.index?"current":"";progress.append(part);});
    const media=view.panel.querySelector(".people-story-viewer__media");media.replaceChildren();
    const token=`${view.username}|${view.index}|${item.id}`;
    if(item.mime.startsWith("video/")) {
      const video=document.createElement("video");video.src=mediaUrl(item.id);video.autoplay=true;video.playsInline=true;video.controls=true;video.preload="metadata";
      video.setAttribute("aria-label",`Story video ${view.index+1}`);
      video.addEventListener("ended",()=>{if(view && token===`${view.username}|${view.index}|${view.parts[view.index]?.id}`)moveStory(1);});
      media.append(video);
      video.play().catch(()=>{});
      playbackTimer=setTimeout(()=>{if(view && !view.overlay.hidden && token===`${view.username}|${view.index}|${view.parts[view.index]?.id}`)moveStory(1);},10500);
    } else {
      const image=document.createElement("img");image.src=mediaUrl(item.id);image.alt=`Story photo ${view.index+1}`;media.append(image);
      playbackTimer=setTimeout(()=>{if(view && !view.overlay.hidden && token===`${view.username}|${view.index}|${view.parts[view.index]?.id}`)moveStory(1);},5500);
    }
  }
  function moveStory(delta) {
    if(!view || view.overlay.hidden)return;
    const next=view.index+delta;
    if(next<0)return;
    if(next>=view.parts.length) {closeOverlays();return;}
    view.index=next;displayStory();
  }
  async function openViewer(username, start=0) {
    try {
      const data=await request(`/api/stories/${encodeURIComponent(username)}`);
      if(!data.parts.length) {invalidate(username);closeOverlays();return;}
      closeOverlays();buildViewer();
      view.username=data.username;view.parts=data.parts;view.isSelf=Boolean(data.isSelf);
      view.index=Math.min(Math.max(0,start),data.parts.length-1);
      view.overlay.hidden=false;view.panel.focus();displayStory();
    } catch(err){alert(err.message);}
  }
  async function checkVideo(file) {
    const url=URL.createObjectURL(file);
    try {
      const duration=await new Promise((resolve,reject)=>{
        const video=document.createElement("video");
        const timer=setTimeout(()=>reject(new Error("Unable to read video duration.")),10000);
        video.preload="metadata";
        video.onloadedmetadata=()=>{clearTimeout(timer);const seconds=video.duration;video.removeAttribute("src");video.load();resolve(seconds);};
        video.onerror=()=>{clearTimeout(timer);reject(new Error("Invalid video."));};
        video.src=url;
      });
      if(!Number.isFinite(duration)||duration<=0)throw new Error("Unable to read video duration.");
      return duration;
    } finally {URL.revokeObjectURL(url);}
  }
  function buildComposer() {
    if(composer)return composer;
    const result=makeDialog("people-story-composer","Manage my stories");
    result.panel.innerHTML=`<header><strong>My Stories</strong><button type="button" class="people-story-close" aria-label="Close">✕</button></header><p>Add images or videos. Maximum 50 MB each, 10 seconds per video. Stories disappear after 24 hours.</p><div class="people-story-composer__parts"></div><div class="people-story-composer__actions"><button type="button" class="people-story-upload">Add Story</button><input class="people-story-input" type="file" accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm" multiple hidden /></div><div id="peopleStoryFeedback" aria-live="polite"></div>`;
    result.panel.querySelector(".people-story-close").addEventListener("click",closeOverlays);
    const input=result.panel.querySelector(".people-story-input");
    result.panel.querySelector(".people-story-upload").addEventListener("click",()=>input.click());
    input.addEventListener("change",async()=>{
      const files=Array.from(input.files||[]);input.value="";
      if(!files.length)return;
      const username=ownName();if(!username)return notify("Sign in to add a story.");
      const status=result.panel.querySelector("#peopleStoryFeedback"),upload=result.panel.querySelector(".people-story-upload");
      upload.disabled=true;
      try {
        const existing=(await request(`/api/stories/${encodeURIComponent(username)}`)).parts;
        if(existing.length+files.length>maxParts)throw new Error("Maximum 10 story parts. Remove an existing part before adding more.");
        for(let i=0;i<files.length;i++) {
          let file=files[i];
          if(!["image/png","image/jpeg","image/webp","image/gif","video/mp4","video/webm"].includes(file.type))throw new Error("Only PNG, JPEG, WebP, GIF, MP4 and WebM files are supported.");
          if(!file.size||file.size>maxBytes)throw new Error("Each file must be 50 MB or smaller.");
          if(file.type.startsWith("video/")) {
            const originalDuration=await checkVideo(file);
            if(originalDuration>10) {
              if(!window.PeopleStoryVideoTrimmer?.trim)throw new Error("Story video editor unavailable. Please refresh People.");
              const trimmed=await window.PeopleStoryVideoTrimmer.trim(file,originalDuration);
              if(!trimmed){status.textContent="Video trimming cancelled.";await renderParts();return;}
              file=trimmed;
              if(!file.size||file.size>maxBytes)throw new Error("The trimmed video must be 50 MB or smaller.");
            }
            const selectedDuration=await checkVideo(file);
            if(selectedDuration>10)throw new Error("Videos must be 10 seconds or shorter.");
          }
          status.textContent=`Uploading ${i+1} of ${files.length}…`;
          await request("/api/stories",{method:"POST",headers:{"Content-Type":"application/octet-stream","X-People-Story-Type":file.type},body:file});
        }
        status.textContent="Story uploaded!";invalidate(username);await renderParts();
      } catch(err){status.textContent=err.message;await renderParts();}
      finally{upload.disabled=false;}
    });
    composer=result;return composer;
  }
  async function renderParts() {
    if(!composer || composer.overlay.hidden)return;
    const container=composer.panel.querySelector(".people-story-composer__parts");container.textContent="Loading…";
    try {
      const data=await request(`/api/stories/${encodeURIComponent(ownName())}`);
      container.replaceChildren();
      if(!data.parts.length)container.textContent="No active stories yet.";
      data.parts.forEach((part,i)=>{
        const row=document.createElement("div");row.className="people-story-composer__part";
        const preview=document.createElement("button");preview.type="button";preview.textContent=`${part.mime.startsWith("video/")?"🎬":"🖼️"} Part ${i+1}`;
        preview.addEventListener("click",()=>void openViewer(ownName(),i));
        const remove=document.createElement("button");remove.type="button";remove.textContent="Remove";
        remove.addEventListener("click",async()=>{if(!confirm("Remove this story part?"))return;try{await request(`/api/stories/${encodeURIComponent(part.id)}`,{method:"DELETE"});invalidate(ownName());await renderParts();}catch(err){notify(err.message);}});
        row.append(preview,remove);container.append(row);
      });
      const button=composer.panel.querySelector(".people-story-upload");button.disabled=data.parts.length>=maxParts;
      if(data.parts.length>=maxParts)container.insertAdjacentText("beforeend"," Maximum 10 parts reached.");
    } catch(err){container.textContent=err.message;}
  }
  async function openComposer() {
    closeOverlays();buildComposer();composer.overlay.hidden=false;composer.panel.focus();await renderParts();
  }
  // Profile modal: the avatar adds a story for its owner, or plays one for others.
  document.addEventListener("click",event=>{
    const modalAvatar=event.target.closest?.("#profileModalAvatar");
    if(modalAvatar && !document.getElementById("profileModal")?.classList.contains("hidden")) {
      const username=document.getElementById("profileModalName")?.textContent?.trim();
      if(username) {
        event.preventDefault();event.stopImmediatePropagation();
        if(key(username)===key(ownName()))void openComposer();
        else if(active.has(key(username)))void openViewer(username);
        return;
      }
    }
    const selfPreview=event.target.closest?.(".people-self-card__avatar");
    if(selfPreview) {
      event.preventDefault();event.stopImmediatePropagation();
      if(active.get(key(ownName())))void openViewer(ownName());else void openComposer();
      return;
    }
    const avatar=event.target.closest?.("[data-people-avatar-username]");
    if(!avatar || !avatar.dataset.peopleStory || excluded(avatar) || avatar.id==="avatar")return;
    const username=avatar.dataset.peopleAvatarUsername;
    if(!username)return;
    event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();
    void openViewer(username);
  },true);
  document.addEventListener("keydown",event=>{
    if(event.key==="Escape" && ((!view?.overlay.hidden)||(!composer?.overlay.hidden))){event.preventDefault();closeOverlays();}
    if(view && !view.overlay.hidden && ["ArrowRight","ArrowLeft"].includes(event.key)){event.preventDefault();moveStory(event.key==="ArrowRight"?1:-1);}
    if(["Enter"," "].includes(event.key)) {
      const avatar=event.target.closest?.("[data-people-avatar-username][data-people-story='1']");
      if(avatar && !excluded(avatar)){event.preventDefault();event.stopImmediatePropagation();void openViewer(avatar.dataset.peopleAvatarUsername);}
    }
  },true);
  // Separate button next to Change Photo, plus clicking own profile photo.
  const wrap=document.getElementById("profileAvatarEditWrap");
  if(wrap && !document.getElementById("peopleStoryProfileAdd")) {
    const add=document.createElement("button");add.id="peopleStoryProfileAdd";add.type="button";add.className="profile-avatar-upload-button people-story-profile-add";add.textContent="Add Story";
    add.addEventListener("click",event=>{event.stopPropagation();void openComposer();});wrap.append(add);
  }
  const modalAvatar=document.getElementById("profileModalAvatar");
  if(modalAvatar){modalAvatar.tabIndex=0;modalAvatar.setAttribute("role","button");modalAvatar.setAttribute("aria-label","View or add a story");modalAvatar.addEventListener("keydown",event=>{if(event.key==="Enter"||event.key===" "){event.preventDefault();modalAvatar.click();}});}
  const selfPreview=document.querySelector(".people-self-card__avatar");
  if(selfPreview){selfPreview.setAttribute("role","button");selfPreview.tabIndex=0;selfPreview.setAttribute("aria-label","Open my stories");selfPreview.addEventListener("keydown",event=>{if(event.key==="Enter"||event.key===" "){event.preventDefault();selfPreview.click();}});}
  window.addEventListener("people-authenticated",()=>invalidate());
  window.peopleSocket?.on("people-stories-changed",payload=>invalidate(payload?.username));
  window.peopleSocket?.on("disconnect",()=>{known.clear();active.clear();repaint();});
  new MutationObserver(()=>{repaint();schedule(250);}).observe(document.body,{childList:true,subtree:true});
  window.setInterval(()=>{known.clear();active.clear();schedule();},60*1000);
  window.PeopleStories={refresh:invalidate,open:openViewer,add:openComposer};
  schedule(300);
})();
