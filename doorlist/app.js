(function(){
  var $ = function(id){return document.getElementById(id)};
  var SUPABASE_URL = "";
  var SUPABASE_ANON_KEY = "";
  var ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  var guests = new Map();
  var eventName = "Untitled event";
  var db = null, downloads = null, cloud = null, localMode = true;
  var filter = "all", lastResult = null, sheetCode = null, wipeArmed = false;
  var LS = "doorlist.v1";

  function esc(s){return String(s==null?"":s).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]})}
  function fmt(ts){return new Date(ts).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}
  function toast(msg){var t=$("toast");t.textContent=msg;t.hidden=false;clearTimeout(toast.h);toast.h=setTimeout(function(){t.hidden=true},3200)}
  function newCode(){
    for(;;){
      var a=new Uint32Array(8);crypto.getRandomValues(a);var s="";
      for(var i=0;i<8;i++)s+=ALPHA[a[i]%ALPHA.length];
      if(!guests.has(s))return s;
    }
  }
  function normalize(raw){
    var s=String(raw||"").trim().toUpperCase();
    var m=s.match(/EVT:([A-Z0-9]+)/);
    if(m)s=m[1];
    return s.replace(/[\s-]/g,"");
  }

  /* ---------- storage ---------- */
  function persist(){
    try{localStorage.setItem(LS,JSON.stringify({name:eventName,guests:Array.from(guests.values())}));return true}
    catch(e){showNotice("Could not save this browser's backup. Check browser storage settings.");return false}
  }
  function loadLocal(){
    try{var d=JSON.parse(localStorage.getItem(LS)||"null");if(d){eventName=d.name||eventName;(d.guests||[]).forEach(function(g){guests.set(g.code,g)})}}
    catch(e){showNotice("Could not read this browser's saved guest list. Check browser storage settings.")}
  }
  function put(g){
    if(db){return db.collection("guests").doc(g.code).set(g).catch(function(e){toast("Could not save: "+(e&&e.message||"try again"))})}
    if(cloud){
      return cloud.from("doorlist_guests").upsert(toCloudGuest(g)).then(function(r){
        if(r.error){toast("Could not save: "+r.error.message);return false}
        guests.set(g.code,g);persist();render();return true;
      }).catch(function(e){toast("Could not save: "+(e&&e.message||"check your connection"));return false});
    }
    guests.set(g.code,g);persist();render();return Promise.resolve();
  }
  function remove(code){
    if(db){return db.collection("guests").doc(code).delete().catch(function(){toast("Could not delete")})}
    if(cloud){
      return cloud.from("doorlist_guests").delete().eq("code",code).then(function(r){
        if(r.error){toast("Could not delete: "+r.error.message);return false}
        guests.delete(code);persist();render();return true;
      }).catch(function(e){toast("Could not delete: "+(e&&e.message||"check your connection"));return false});
    }
    guests.delete(code);persist();render();return Promise.resolve();
  }
  function saveEventName(){
    if(db){db.doc("meta/event").set({name:eventName}).catch(function(e){showNotice("Could not save the shared event name: "+(e&&e.message||"try again"))})}else persist();
    if(cloud)cloud.from("doorlist_event").upsert({id:1,name:eventName}).then(function(r){
      if(r.error)showNotice("Could not save the shared event name: "+r.error.message);
    }).catch(function(e){showNotice("Could not save the shared event name: "+(e&&e.message||"check your connection"))});
  }
  function toCloudGuest(g){
    return {code:g.code,name:g.name,email:g.email||"",ticket:g.ticket||"General",
      checked_in_at:g.checkedInAt?new Date(g.checkedInAt).toISOString():null,
      created_at:new Date(g.createdAt||Date.now()).toISOString()};
  }
  function fromCloudGuest(g){
    return {code:g.code,name:g.name,email:g.email||"",ticket:g.ticket||"General",
      checkedInAt:g.checked_in_at?new Date(g.checked_in_at).getTime():null,
      createdAt:g.created_at?new Date(g.created_at).getTime():Date.now()};
  }
  async function loadSharedData(){
    var localGuests=Array.from(guests.values());
    var result=await cloud.from("doorlist_guests").select("*");
    if(result.error)throw result.error;
    var known=new Set(result.data.map(function(g){return g.code}));
    var missing=localGuests.filter(function(g){return !known.has(g.code)});
    if(missing.length){
      var saved=await cloud.from("doorlist_guests").upsert(missing.map(toCloudGuest));
      if(saved.error)throw saved.error;
      result=await cloud.from("doorlist_guests").select("*");
      if(result.error)throw result.error;
    }
    var event=await cloud.from("doorlist_event").select("name").eq("id",1).maybeSingle();
    if(event.error)throw event.error;
    if(event.data){
      eventName=event.data.name||eventName;
    }else if(r.kind==="error"){
      el.className="result none";
      el.innerHTML='<div class="big">Check-in not saved</div><div class="sub">'+esc(r.message)+'</div>';
    }else{
      var savedEvent=await cloud.from("doorlist_event").upsert({id:1,name:eventName});
      if(savedEvent.error)throw savedEvent.error;
    }
    guests=new Map(result.data.map(function(g){var local=fromCloudGuest(g);return [local.code,local]}));
    persist();render();
  }
  function subscribeSharedData(){
    cloud.channel("doorlist-live")
      .on("postgres_changes",{event:"*",schema:"public",table:"doorlist_guests"},function(change){
        if(change.eventType==="DELETE")guests.delete(change.old.code);
        else{var g=fromCloudGuest(change.new);guests.set(g.code,g)}
        persist();render();
      })
      .on("postgres_changes",{event:"*",schema:"public",table:"doorlist_event"},function(change){
        if(change.eventType!=="DELETE"&&change.new.id===1){
          eventName=change.new.name||eventName;
          if(document.activeElement!==$("evname"))$("evname").value=eventName;
        }
      })
      .subscribe(function(status){
        if(status==="CHANNEL_ERROR"||status==="TIMED_OUT")
          showNotice("Live updates are unavailable. Reload to reconnect.");
      });
  }
  var activeCloudUser=null;
  function handleCloudSession(session){
    if(!session){
      activeCloudUser=null;$("app").hidden=true;$("auth").hidden=false;
      $("authSession").hidden=true;$("authMessage").textContent="Sign in with an invited staff email to load the shared guest list.";
      return;
    }
    $("auth").hidden=false;$("authSession").hidden=false;
    $("authUser").textContent=session.user.email||"Signed in";
    $("authMessage").textContent="Connecting to the shared guest list…";
    if(activeCloudUser===session.user.id)return;
    activeCloudUser=session.user.id;
    loadSharedData().then(function(){
      $("app").hidden=false;$("auth").hidden=false;
      $("authMessage").textContent="Connected. This guest list is shared with signed-in staff.";
      showNotice("");
      subscribeSharedData();
    }).catch(function(e){
      activeCloudUser=null;$("app").hidden=true;
      $("authMessage").textContent="Could not load the shared guest list: "+(e&&e.message||"check the Supabase setup");
    });
  }
  function startSupabase(){
    $("app").hidden=true;$("auth").hidden=false;
    loadLocal();
    if(!window.supabase||!window.supabase.createClient){
      $("authMessage").textContent="Supabase could not be loaded. Check your internet connection and reload.";
      return;
    }
    try{cloud=window.supabase.createClient(SUPABASE_URL,SUPABASE_ANON_KEY)}
    catch(e){$("authMessage").textContent="Supabase configuration is invalid: "+e.message;return}
    cloud.auth.onAuthStateChange(function(event,session){
      if(event==="SIGNED_OUT"&&cloud.removeAllChannels)cloud.removeAllChannels();
      handleCloudSession(session);
    });
    $("signinForm").addEventListener("submit",function(e){
      e.preventDefault();
      $("authMessage").textContent="Sending sign-in link…";
      cloud.auth.signInWithOtp({email:$("authEmail").value.trim()}).then(function(r){
        $("authMessage").textContent=r.error?"Could not send link: "+r.error.message:"Check your email for the sign-in link.";
      }).catch(function(e){$("authMessage").textContent="Could not send link: "+(e&&e.message||"check your connection")});
    });
    $("signout").addEventListener("click",function(){
      cloud.auth.signOut().then(function(r){
        if(r.error)$("authMessage").textContent="Could not sign out: "+r.error.message;
      });
    });
    cloud.auth.getSession().then(function(r){
      if(r.error){$("authMessage").textContent="Could not check sign-in status: "+r.error.message;return}
      handleCloudSession(r.data.session);
    }).catch(function(e){$("authMessage").textContent="Could not check sign-in status: "+(e&&e.message||"check your connection")});
  }

  /* ---------- QR + ticket image ---------- */
  function qrCanvas(text,px){
    var q=qrcode(0,"M");q.addData(text);q.make();
    var n=q.getModuleCount(),quiet=4,sc=Math.max(1,Math.floor(px/(n+quiet*2))),size=(n+quiet*2)*sc;
    var c=document.createElement("canvas");c.width=c.height=size;
    var x=c.getContext("2d");x.fillStyle="#fff";x.fillRect(0,0,size,size);x.fillStyle="#000";
    for(var r=0;r<n;r++)for(var k=0;k<n;k++)if(q.isDark(r,k))x.fillRect((k+quiet)*sc,(r+quiet)*sc,sc,sc);
    return c;
  }
  function ticketCanvas(g){
    var W=720,H=980,c=document.createElement("canvas");c.width=W;c.height=H;
    var x=c.getContext("2d");
    x.fillStyle="#fff";x.fillRect(0,0,W,H);
    x.fillStyle="#131C24";x.fillRect(0,0,W,150);
    x.fillStyle="#fff";x.font="700 40px 'Space Grotesk',Arial,sans-serif";x.textBaseline="middle";
    fit(x,eventName,W-80,40,"700 ","'Space Grotesk',Arial,sans-serif");
    x.fillText(eventName,40,75);
    x.fillStyle="#5B6874";x.font="600 22px Arial,sans-serif";x.fillText("ADMIT ONE  ·  "+String(g.ticket||"General").toUpperCase(),40,200);
    x.fillStyle="#131C24";fit(x,g.name,W-80,52,"700 ","'Space Grotesk',Arial,sans-serif");x.fillText(g.name,40,262);
    var qr=qrCanvas("EVT:"+g.code,560);
    x.drawImage(qr,(W-560)/2,320,560,560);
    x.fillStyle="#131C24";x.font="500 40px 'JetBrains Mono',Courier,monospace";x.textAlign="center";
    x.fillText(g.code.slice(0,4)+" "+g.code.slice(4),W/2,925);
    x.textAlign="left";
    return c;
  }
  function fit(x,text,maxW,size,weight,fam){
    var s=size;x.font=weight+s+"px "+fam;
    while(x.measureText(text).width>maxW&&s>18){s-=2;x.font=weight+s+"px "+fam}
  }

  /* ---------- check-in ---------- */
  function checkIn(raw){
    var code=normalize(raw);
    if(!code){return}
    var g=guests.get(code);
    if(!g){lastResult={kind:"none",code:code};renderResult();toast("Wrong QR — this code doesn't match any guest on the list.");return}
    if(g.checkedInAt){lastResult={kind:"dup",g:g};renderResult();return}
    var up=Object.assign({},g,{checkedInAt:Date.now()});
    lastResult={kind:"ok",g:up};
    guests.set(code,up);render();
    renderResult();
    var saving=put(up);
    if(cloud)saving.then(function(saved){
      if(saved===false){
        guests.set(code,g);lastResult={kind:"error",message:"The guest is still on the list, but the check-in was not saved. Try again."};
        render();renderResult();
      }
    });
  }
  function renderResult(){
    var el=$("result"),r=lastResult;
    if(!r)return;
    if(r.kind==="ok"){
      el.className="result ok";
      el.innerHTML='<div class="big">Checked in</div><div class="who">'+esc(r.g.name)+'</div><div class="sub">'+esc(r.g.ticket||"General")+' · '+fmt(r.g.checkedInAt)+'</div>';
    }else if(r.kind==="dup"){
      el.className="result dup";
      el.innerHTML='<div class="big">Already checked in</div><div class="who">'+esc(r.g.name)+'</div><div class="sub">Arrived at '+fmt(r.g.checkedInAt)+'. Do not admit twice without checking.</div>';
    }else{
      el.className="result none";
      el.innerHTML='<div class="big">Wrong QR / no match</div><div class="sub mono">'+esc(r.code)+'</div><div class="sub">This code does not match a guest on the list. Check the QR code or search the Guests tab.</div>';
    }
  }
  function decodeFile(file){
    return createImageBitmap(file).then(function(bmp){
      var tryDetector=("BarcodeDetector" in window)?new BarcodeDetector({formats:["qr_code"]}).detect(bmp).then(function(r){return r.length?r[0].rawValue:null}).catch(function(){return null}):Promise.resolve(null);
      return tryDetector.then(function(v){
        if(v)return v;
        if(typeof jsQR!=="function")return null;
        var s=Math.min(1,1600/Math.max(bmp.width,bmp.height));
        var c=document.createElement("canvas");c.width=Math.round(bmp.width*s);c.height=Math.round(bmp.height*s);
        var x=c.getContext("2d");x.drawImage(bmp,0,0,c.width,c.height);
        var d=x.getImageData(0,0,c.width,c.height);
        var res=jsQR(d.data,d.width,d.height,{inversionAttempts:"attemptBoth"});
        return res?res.data:null;
      });
    });
  }

  var cameraStream=null,cameraTimer=null,cameraBusy=false;
  function stopCamera(){
    if(cameraTimer){clearInterval(cameraTimer);cameraTimer=null}
    if(cameraStream){cameraStream.getTracks().forEach(function(track){track.stop()});cameraStream=null}
    var video=$("cameraVideo");video.srcObject=null;
    $("camera").hidden=true;$("cameraStatus").hidden=true;
  }
  async function scanCameraFrame(){
    if(cameraBusy||!cameraStream)return;
    cameraBusy=true;
    var video=$("cameraVideo");
    if(video.readyState<2){cameraBusy=false;return}
    try{
      var value=null;
      if("BarcodeDetector" in window){
        var detector=new BarcodeDetector({formats:["qr_code"]});
        var found=await detector.detect(video);
        if(found.length)value=found[0].rawValue;
      }
      if(!value&&typeof jsQR==="function"){
        var s=Math.min(1,1600/Math.max(video.videoWidth,video.videoHeight));
        var canvas=document.createElement("canvas");
        canvas.width=Math.round(video.videoWidth*s);canvas.height=Math.round(video.videoHeight*s);
        var ctx=canvas.getContext("2d",{willReadFrequently:true});
        ctx.drawImage(video,0,0,canvas.width,canvas.height);
        var image=ctx.getImageData(0,0,canvas.width,canvas.height);
        var result=jsQR(image.data,image.width,image.height,{inversionAttempts:"attemptBoth"});
        if(result)value=result.data;
      }
      if(value){
        $("cameraHint").textContent="QR code read.";
        stopCamera();checkIn(value);
      }
    }catch(e){
      $("cameraHint").textContent="Camera is running, but could not read a code.";
    }
    cameraBusy=false;
  }
  async function openCamera(){
    var secure=window.isSecureContext||location.hostname==="localhost"||location.hostname==="127.0.0.1";
    if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){
      $("photohint").textContent=secure
        ?"This browser does not support live camera access. Try Chrome or Edge, or scan a QR photo."
        :"Live camera is blocked because this address is not secure. Open https:// this page on the phone, or use \"Scan QR from a photo\".";
      return;
    }
    if(!secure){
      $("photohint").textContent="Live camera is blocked on this network HTTP address. Open the app through HTTPS or localhost.";
      return;
    }
    try{
      cameraStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:"environment"}},audio:false});
      var video=$("cameraVideo");video.srcObject=cameraStream;
      await video.play();
      $("camera").hidden=false;$("cameraStatus").hidden=false;
      $("cameraHint").textContent="Point the camera at the QR code.";
      cameraTimer=setInterval(scanCameraFrame,300);
    }catch(e){
      stopCamera();
      var denied=e&&e.name==="NotAllowedError";
      $("photohint").textContent=denied?"Camera permission was denied. Allow camera access in browser settings and try again.":"Could not start the camera. Check that it is available and not used by another app.";
    }
  }

  /* ---------- rendering ---------- */
  function render(){
    var all=Array.from(guests.values()),inn=all.filter(function(g){return g.checkedInAt});
    $("nums").innerHTML=inn.length+' <small>of '+all.length+'</small>';
    $("barfill").style.width=(all.length?Math.round(inn.length/all.length*100):0)+"%";
    var rec=inn.slice().sort(function(a,b){return b.checkedInAt-a.checkedInAt}).slice(0,6);
    $("recent").innerHTML=rec.length?rec.map(function(g){return '<li><span>'+esc(g.name)+' <span class="muted">· '+esc(g.ticket||"General")+'</span></span><span class="t">'+fmt(g.checkedInAt)+'</span></li>'}).join(""):'<li class="muted">Nobody has arrived yet.</li>';
    renderGuests(all);
    if(document.activeElement!==$("evname"))$("evname").value=eventName;
  }
  function renderGuests(all){
    var q=$("q").value.trim().toLowerCase();
    var list=all.filter(function(g){
      if(filter==="in"&&!g.checkedInAt)return false;
      if(filter==="out"&&g.checkedInAt)return false;
      if(!q)return true;
      return (g.name+" "+(g.email||"")+" "+g.code).toLowerCase().indexOf(q)>-1;
    }).sort(function(a,b){return a.name.localeCompare(b.name)});
    if(!all.length){
      $("glist").innerHTML='<div class="empty"><h2>No guests yet</h2><p>Add people on the Add guests tab. Each one gets a unique ticket code and QR.</p></div>';return;
    }
    if(!list.length){$("glist").innerHTML='<div class="empty">No guests match.</div>';return}
    $("glist").innerHTML=list.map(function(g){
      return '<div class="guest"><div><div class="n">'+esc(g.name)+'</div><div class="m">'+esc(g.email||"No email")+' · '+esc(g.ticket||"General")+' · <span class="mono">'+esc(g.code)+'</span></div></div>'
        +'<span class="pill'+(g.checkedInAt?' in':'')+'">'+(g.checkedInAt?'Arrived '+fmt(g.checkedInAt):'Waiting')+'</span>'
        +'<div class="acts"><button class="small" data-act="ticket" data-code="'+g.code+'">Ticket</button>'
        +'<button class="small" data-act="toggle" data-code="'+g.code+'">'+(g.checkedInAt?'Undo check-in':'Check in')+'</button>'
        +'<button class="small danger" data-act="del" data-code="'+g.code+'">Delete</button></div></div>';
    }).join("");
  }

  /* ---------- tickets ---------- */
  function openSheet(code){
    var g=guests.get(code);if(!g)return;
    sheetCode=code;
    $("sheetname").textContent=g.name;
    $("ticketimg").src=ticketCanvas(g).toDataURL("image/png");
    var body=mailBody(g);
    $("mailto").href="mailto:"+encodeURIComponent(g.email||"")+"?subject="+encodeURIComponent("Your ticket for "+eventName)+"&body="+encodeURIComponent(body);
    $("dlticket").hidden=!downloads;
    $("sheet").hidden=false;
  }
  function mailBody(g){
    return "Hi "+g.name+",\n\nYou're registered for "+eventName+".\nTicket: "+(g.ticket||"General")+"\nTicket code: "+g.code+"\n\nShow the attached QR image at the door. If your phone can't show it, read out the code above.\n\nSee you there!";
  }
  function slug(s){return String(s).toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")||"ticket"}
  function addGuest(name,email,ticket){
    var g={name:name,email:email||"",ticket:ticket||"General",code:newCode(),checkedInAt:null,createdAt:Date.now()};
    guests.set(g.code,g);return g;
  }

  /* ---------- csv ---------- */
  function parseCSV(t){
    var rows=[],row=[],f="",q=false;
    for(var i=0;i<t.length;i++){
      var ch=t[i];
      if(q){if(ch==='"'){if(t[i+1]==='"'){f+='"';i++}else q=false}else f+=ch}
      else if(ch==='"')q=true;
      else if(ch===","||ch==="\t"){row.push(f);f=""}
      else if(ch==="\n"||ch==="\r"){if(ch==="\r"&&t[i+1]==="\n")i++;row.push(f);f="";if(row.some(function(x){return x.trim()}))rows.push(row);row=[]}
      else f+=ch;
    }
    row.push(f);if(row.some(function(x){return x.trim()}))rows.push(row);
    return rows.map(function(r){return r.map(function(x){return x.trim()})});
  }
  function csvCell(v){v=String(v==null?"":v);return /[",\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v}
  async function importText(text){
    var rows=parseCSV(text);if(!rows.length){$("importmsg").textContent="Nothing to import.";return}
    var iN=0,iE=1,iT=2,head=rows[0].map(function(s){return s.toLowerCase()});
    if(head.indexOf("name")>-1||head.indexOf("email")>-1){
      iN=head.indexOf("name");iE=head.indexOf("email");iT=Math.max(head.indexOf("ticket"),head.indexOf("ticket type"),head.indexOf("type"));rows=rows.slice(1);
      if(iN<0)iN=0;
    }
    var have={};guests.forEach(function(g){if(g.email)have[g.email.toLowerCase()]=1});
    var made=[],skipped=0;
    rows.forEach(function(r){
      var name=r[iN]||"",email=iE>=0?(r[iE]||""):"",ticket=iT>=0?(r[iT]||""):"";
      if(!name){skipped++;return}
      if(email&&have[email.toLowerCase()]){skipped++;return}
      if(email)have[email.toLowerCase()]=1;
      made.push(addGuest(name,email,ticket));
    });
    if(db||cloud){
      if(cloud)made.forEach(function(g){guests.delete(g.code)});
      for(var i=0;i<made.length;i++){
        $("importmsg").textContent="Saving "+(i+1)+" of "+made.length+"…";
        if(await put(made[i])===false){
          for(var j=i;j<made.length;j++)guests.delete(made[j].code);
          persist();render();
          $("importmsg").textContent="Could not save the full list. Check the connection and retry.";
          return;
        }
      }
    }else{persist();render()}
    $("importmsg").textContent="Added "+made.length+(skipped?", skipped "+skipped+" (blank name or duplicate email).":".");
    if(made.length){$("paste").value="";if(!db)render();toast("Added "+made.length+" guests")}
  }

  /* ---------- tabs ---------- */
  function route(){
    var h=(location.hash||"#checkin").slice(1);if(["checkin","guests","add"].indexOf(h)<0)h="checkin";
    ["checkin","guests","add"].forEach(function(n){$("v-"+n).hidden=n!==h});
    document.querySelectorAll("[data-tab]").forEach(function(a){if(a.dataset.tab===h)a.setAttribute("aria-current","page");else a.removeAttribute("aria-current")});
    if(h==="checkin")setTimeout(function(){try{$("code").focus({preventScroll:true})}catch(e){}},0);
  }

  /* ---------- events ---------- */
  $("scanform").addEventListener("submit",function(e){e.preventDefault();checkIn($("code").value);$("code").value="";$("code").focus()});
  $("opencamera").addEventListener("click",openCamera);
  $("closecamera").addEventListener("click",stopCamera);
  $("photo").addEventListener("change",function(){
    var f=this.files&&this.files[0];this.value="";if(!f)return;
    $("photohint").textContent="Reading photo…";
    decodeFile(f).then(function(v){
      if(v){$("photohint").textContent="Read a QR code.";checkIn(v)}
      else{$("photohint").textContent="No QR code found. Retake the photo closer, in better light, or type the code.";toast("No QR code found. Try scanning again.");}
    }).catch(function(){$("photohint").textContent="That image could not be opened. Try a JPEG or PNG, or type the code."});
  });
  $("evname").addEventListener("input",function(){eventName=this.value||"Untitled event";clearTimeout(this.h);this.h=setTimeout(saveEventName,600)});
  $("q").addEventListener("input",function(){renderGuests(Array.from(guests.values()))});
  document.querySelectorAll("[data-f]").forEach(function(b){b.addEventListener("click",function(){
    filter=b.dataset.f;document.querySelectorAll("[data-f]").forEach(function(x){x.setAttribute("aria-pressed",x===b?"true":"false")});renderGuests(Array.from(guests.values()))})});
  $("glist").addEventListener("click",function(e){
    var b=e.target.closest("button[data-act]");if(!b)return;
    var code=b.dataset.code,g=guests.get(code);if(!g)return;
    if(b.dataset.act==="ticket")openSheet(code);
    else if(b.dataset.act==="toggle"){
      var up=Object.assign({},g,{checkedInAt:g.checkedInAt?null:Date.now()});guests.set(code,up);render();
      put(up).then(function(saved){if(saved===false){guests.set(code,g);render()}});
    }
    else if(b.dataset.act==="del"){
      if(b.dataset.armed){
        if(cloud)remove(code);
        else{guests.delete(code);render();remove(code)}
      }
      else{b.dataset.armed="1";b.textContent="Tap again to delete";setTimeout(function(){if(b.isConnected){delete b.dataset.armed;b.textContent="Delete"}},3000)}
    }
  });
  $("addform").addEventListener("submit",function(e){
    e.preventDefault();
    var g=addGuest($("gname").value.trim(),$("gemail").value.trim(),$("gticket").value.trim());
    $("gname").value="";$("gemail").value="";
    if(db||cloud){
      guests.set(g.code,g);render();
      put(g).then(function(saved){
        if(saved===false){guests.delete(g.code);persist();render();return}
        toast("Added "+g.name);openSheet(g.code);
      });
    }else{
      persist();render();toast("Added "+g.name);openSheet(g.code);
    }
  });
  $("doimport").addEventListener("click",function(){importText($("paste").value)});
  $("csvfile").addEventListener("change",function(){
    var f=this.files&&this.files[0];this.value="";if(!f)return;
    var r=new FileReader();r.onload=function(){$("paste").value=String(r.result);$("importmsg").textContent="File loaded. Press Import list."};r.readAsText(f);
  });
  $("sample").addEventListener("click",function(){
    importText("Aarav Mehta,aarav@example.com,VIP\nIsha Verma,isha@example.com,General\nNeha Kapoor,neha@example.com,General\nKabir Singh,kabir@example.com,Speaker\nMeera Iyer,meera@example.com,General\nRohan Das,rohan@example.com,Sponsor");
  });
  $("wipe").addEventListener("click",async function(){
    var b=this;
    if(!wipeArmed){wipeArmed=true;b.textContent="Tap again to delete everyone";setTimeout(function(){wipeArmed=false;b.textContent="Delete all guests"},3500);return}
    wipeArmed=false;b.textContent="Delete all guests";
    if(cloud){
      var sharedCodes=Array.from(guests.keys()),failed=false;
      for(var j=0;j<sharedCodes.length;j++)if(await remove(sharedCodes[j])===false)failed=true;
      if(!failed){lastResult=null;render()}
      toast(failed?"Some guests could not be deleted. Check the connection and retry.":"All guests deleted");
      return;
    }
    var codes=Array.from(guests.keys());guests.clear();lastResult=null;render();
    if(db||cloud){for(var i=0;i<codes.length;i++)await remove(codes[i])}else persist();
    toast("All guests deleted");
  });
  $("export").addEventListener("click",function(){
    var rows=[["name","email","ticket","code","status","checked_in_at"]];
    Array.from(guests.values()).sort(function(a,b){return a.name.localeCompare(b.name)}).forEach(function(g){
      rows.push([g.name,g.email,g.ticket,g.code,g.checkedInAt?"arrived":"waiting",g.checkedInAt?new Date(g.checkedInAt).toISOString():""]);
    });
    var csv=rows.map(function(r){return r.map(csvCell).join(",")}).join("\n");
    if(downloads){downloads.save({filename:slug(eventName)+"-attendance.csv",data:csv}).catch(function(e){if(e&&e.code!=="declined")toast("Download unavailable here")})}
    else{
      var ok=navigator.clipboard&&navigator.clipboard.writeText?navigator.clipboard.writeText(csv):Promise.reject();
      ok.then(function(){toast("CSV copied to clipboard")},function(){toast("Export is not available in this view")});
    }
  });
  $("sheetclose").addEventListener("click",function(){$("sheet").hidden=true});
  $("sheet").addEventListener("click",function(e){if(e.target===$("sheet"))$("sheet").hidden=true});
  document.addEventListener("keydown",function(e){if(e.key==="Escape")$("sheet").hidden=true});
  $("dlticket").addEventListener("click",function(){
    var g=guests.get(sheetCode);if(!g||!downloads)return;
    ticketCanvas(g).toBlob(function(b){downloads.save({filename:slug(g.name)+"-ticket.png",data:b}).catch(function(e){if(e&&e.code!=="declined")toast("Download unavailable here")})},"image/png");
  });
  $("copymail").addEventListener("click",function(){
    var g=guests.get(sheetCode);if(!g)return;
    var txt="Subject: Your ticket for "+eventName+"\n\n"+mailBody(g);
    (navigator.clipboard&&navigator.clipboard.writeText?navigator.clipboard.writeText(txt):Promise.reject()).then(function(){toast("Email text copied")},function(){toast("Copy is blocked here. Select the text manually.")});
  });
  window.addEventListener("hashchange",route);

  /* ---------- start ---------- */
  function showNotice(msg){var n=$("notice");n.textContent=msg;n.hidden=!msg}
  function start(){
    var cl=window.claude;
    var pdb=cl&&cl.use?cl.use("db"):Promise.resolve(null);
    var pdl=cl&&cl.use?cl.use("downloads"):Promise.resolve(null);
    Promise.all([pdb.catch(function(){return null}),pdl.catch(function(){return null})]).then(function(r){
      db=r[0];downloads=r[1];
      if(db){
        localMode=false;loadLocal();render();
        var timer=setTimeout(function(){showNotice("Still connecting to the shared guest list…")},10000);
        db.collection("guests").onSnapshot(function(snap){
          clearTimeout(timer);
          if(!snap.metadata.fromCache)showNotice("");
          guests=new Map(snap.docs.map(function(d){return [d.id,d.data()]}));render();
        },function(e){clearTimeout(timer);showNotice("Shared list unavailable ("+(e&&e.code||"error")+"). Reload to retry.")});
        db.doc("meta/event").onSnapshot(function(s){if(s.exists&&document.activeElement!==$("evname")){eventName=s.data().name||eventName;$("evname").value=eventName}});
      }else if(SUPABASE_URL||SUPABASE_ANON_KEY){
        if(!SUPABASE_URL||!SUPABASE_ANON_KEY){
          $("app").hidden=true;$("auth").hidden=false;
          $("authMessage").textContent="Set both SUPABASE_URL and SUPABASE_ANON_KEY in index.html to enable shared storage.";
        }else startSupabase();
      }else{
        loadLocal();render();
        showNotice("Guests are saved in this browser only. Other staff devices will not see them.");
      }
    });
  }
  route();start();
})();
