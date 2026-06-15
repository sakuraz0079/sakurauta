const ALLOWED_ORIGINS = new Set([
  "https://sakuraz0079.github.io",
  "http://127.0.0.1:4173",
  "http://localhost:4173",
]);

const DEFAULT_EXPIRY_DAYS = 30;
const MAX_EXPIRY_DAYS = 365;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (request.method === "OPTIONS") {
      return handleOptions(request);
    }

    if (request.method === "POST" && path === "/api/shares") {
      return createShare(request, env);
    }

    const apiMatch = path.match(/^\/api\/shares\/([A-Za-z0-9_-]{16,80})$/);
    if (apiMatch && request.method === "GET") {
      return getShare(apiMatch[1], env);
    }
    if (apiMatch && request.method === "DELETE") {
      return revokeShare(request, apiMatch[1], env);
    }

    const audioMatch = path.match(/^\/audio\/([A-Za-z0-9_-]{16,80})$/);
    if (audioMatch && (request.method === "GET" || request.method === "HEAD")) {
      return streamAudio(request, audioMatch[1], env);
    }

    const pageMatch = path.match(/^\/s\/([A-Za-z0-9_-]{16,80})$/);
    if (pageMatch && request.method === "GET") {
      return sharePage();
    }

    if (path === "/icon" && request.method === "GET") {
      const icon = await fetch("https://sakuraz0079.github.io/sakurauta/icon-512.png");
      if (!icon.ok) return new Response("Icon not found", { status: 404 });
      return new Response(icon.body, {
        headers: securityHeaders({
          "Content-Type": icon.headers.get("Content-Type") || "image/png",
          "Cache-Control": "public, max-age=86400",
        }),
      });
    }

    if (path === "/" && request.method === "GET") {
      return new Response("sak_Uta share service", {
        headers: securityHeaders({ "Content-Type": "text/plain; charset=utf-8" }),
      });
    }

    return json({ ok: false, error: "Not found" }, 404);
  },
};

async function createShare(request, env) {
  const corsHeaders = cors(request);
  if (!corsHeaders) return json({ ok: false, error: "Origin not allowed" }, 403);
  if (!(await hasAdminAccess(request, env))) {
    return json({ ok: false, error: "Invalid share token" }, 401, corsHeaders);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON" }, 400, corsHeaders);
  }

  const track = normalizeTrack(body?.track);
  if (!track.title || (!track.fileName && !track.sourceUrl)) {
    return json({ ok: false, error: "Missing track data" }, 400, corsHeaders);
  }

  const requestedDays = Number(body?.expiresInDays || DEFAULT_EXPIRY_DAYS);
  const expiryDays = Math.min(Math.max(Math.round(requestedDays), 1), MAX_EXPIRY_DAYS);
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + expiryDays * 86400000);
  const token = randomToken();
  const record = {
    version: 1,
    createdAt: createdAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    revoked: false,
    track,
  };

  await env.SHARE_LINKS.put(shareKey(token), JSON.stringify(record), {
    expiration: Math.floor(expiresAt.getTime() / 1000),
  });

  const workerUrl = new URL(request.url);
  workerUrl.pathname = `/s/${token}`;
  workerUrl.search = "";

  return json({
    ok: true,
    token,
    url: workerUrl.href,
    expiresAt: record.expiresAt,
  }, 201, corsHeaders);
}

async function getShare(token, env) {
  const record = await readShare(token, env);
  if (!record) return json({ ok: false, error: "Share link not found" }, 404);

  return json({
    ok: true,
    data: {
      title: record.track.title,
      artist: record.track.artist,
      version: record.track.version,
      audioUrl: `/audio/${token}`,
      expiresAt: record.expiresAt,
    },
  }, 200, {
    "Cache-Control": "no-store",
  });
}

async function revokeShare(request, token, env) {
  const corsHeaders = cors(request);
  if (!corsHeaders) return json({ ok: false, error: "Origin not allowed" }, 403);
  if (!(await hasAdminAccess(request, env))) {
    return json({ ok: false, error: "Invalid share token" }, 401, corsHeaders);
  }

  const record = await readShare(token, env, { includeRevoked: true });
  if (!record) return json({ ok: false, error: "Share link not found" }, 404, corsHeaders);
  record.revoked = true;
  record.revokedAt = new Date().toISOString();
  await env.SHARE_LINKS.put(shareKey(token), JSON.stringify(record), {
    expiration: Math.floor(new Date(record.expiresAt).getTime() / 1000),
  });
  return json({ ok: true }, 200, corsHeaders);
}

async function streamAudio(request, token, env) {
  const record = await readShare(token, env);
  if (!record) return new Response("Share link not found", { status: 404 });

  const objectKey = record.track.fileName;
  if (objectKey && env.SAKURAUTA_WAVS?.get) {
    const object = await env.SAKURAUTA_WAVS.get(objectKey, {
      onlyIf: request.headers,
      range: request.headers,
    });
    if (object) return r2Response(request, object);
  }

  if (!record.track.sourceUrl) {
    return new Response("Audio not found", { status: 404 });
  }

  const upstreamHeaders = new Headers();
  const range = request.headers.get("Range");
  if (range) upstreamHeaders.set("Range", range);
  const upstream = await fetch(record.track.sourceUrl, {
    method: request.method,
    headers: upstreamHeaders,
    redirect: "follow",
  });
  const headers = new Headers(upstream.headers);
  headers.set("Cache-Control", "private, no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.delete("Access-Control-Allow-Origin");
  return new Response(request.method === "HEAD" ? null : upstream.body, {
    status: upstream.status,
    headers,
  });
}

function r2Response(request, object) {
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("ETag", object.httpEtag);
  headers.set("Accept-Ranges", "bytes");
  headers.set("Cache-Control", "private, no-store");
  headers.set("X-Content-Type-Options", "nosniff");

  let status = 200;
  if (object.range) {
    const offset = object.range.offset || 0;
    const length = object.range.length || object.size;
    headers.set("Content-Range", `bytes ${offset}-${offset + length - 1}/${object.size}`);
    headers.set("Content-Length", String(length));
    status = 206;
  } else {
    headers.set("Content-Length", String(object.size));
  }

  return new Response(request.method === "HEAD" ? null : object.body, {
    status,
    headers,
  });
}

async function readShare(token, env, options = {}) {
  const raw = await env.SHARE_LINKS.get(shareKey(token));
  if (!raw) return null;

  let record;
  try {
    record = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!options.includeRevoked && record.revoked) return null;
  if (new Date(record.expiresAt).getTime() <= Date.now()) return null;
  return record;
}

async function hasAdminAccess(request, env) {
  const expected = String(env.SHARE_ADMIN_TOKEN || "");
  const actual = String(request.headers.get("X-Share-Admin-Token") || "");
  if (!expected || !actual) return false;

  const encoder = new TextEncoder();
  const [expectedHash, actualHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
    crypto.subtle.digest("SHA-256", encoder.encode(actual)),
  ]);
  const left = new Uint8Array(expectedHash);
  const right = new Uint8Array(actualHash);
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

function normalizeTrack(value) {
  const sourceUrl = safeSourceUrl(value?.sourceUrl || value?.url);
  return {
    id: cleanText(value?.id, 120),
    title: cleanText(value?.title, 240),
    artist: cleanText(value?.artist, 240),
    version: cleanText(value?.version, 100),
    fileName: safeFileName(value?.fileName || fileNameFromUrl(sourceUrl)),
    sourceUrl,
  };
}

function safeSourceUrl(value) {
  if (!value) return "";
  try {
    const url = new URL(String(value));
    if (url.protocol !== "https:") return "";
    if (!url.hostname.endsWith(".r2.dev")) return "";
    return url.href;
  } catch {
    return "";
  }
}

function fileNameFromUrl(value) {
  if (!value) return "";
  try {
    return decodeURIComponent(new URL(value).pathname.split("/").pop() || "");
  } catch {
    return "";
  }
}

function safeFileName(value) {
  const name = String(value || "").split(/[\\/]/).pop().trim();
  if (!name || name.length > 500 || !name.toLowerCase().endsWith(".wav")) return "";
  return name;
}

function cleanText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function shareKey(token) {
  return `share:${token}`;
}

function handleOptions(request) {
  const headers = cors(request);
  if (!headers) return new Response(null, { status: 403 });
  return new Response(null, {
    status: 204,
    headers: {
      ...headers,
      "Access-Control-Allow-Methods": "POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Share-Admin-Token",
      "Access-Control-Max-Age": "86400",
    },
  });
}

function cors(request) {
  const origin = request.headers.get("Origin") || "";
  if (!ALLOWED_ORIGINS.has(origin)) return null;
  return {
    "Access-Control-Allow-Origin": origin,
    "Vary": "Origin",
  };
}

function json(payload, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: securityHeaders({
      ...extraHeaders,
      "Content-Type": "application/json; charset=utf-8",
    }),
  });
}

function securityHeaders(headers = {}) {
  return {
    ...headers,
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  };
}

function sharePage() {
  return new Response(SHARE_PAGE, {
    headers: securityHeaders({
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy": [
        "default-src 'none'",
        "script-src 'unsafe-inline'",
        "style-src 'unsafe-inline'",
        "img-src 'self' data:",
        "media-src 'self'",
        "connect-src 'self'",
        "manifest-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
      ].join("; "),
    }),
  });
}

const SHARE_PAGE = `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="theme-color" content="#050506">
  <title>sak_Uta</title>
  <style>
    :root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    *{box-sizing:border-box}
    body{min-height:100vh;margin:0;background:radial-gradient(circle at 50% -80px,rgba(239,23,68,.3),transparent 360px),linear-gradient(180deg,#111113,#050506 58%);color:#f8f7f4}
    main{display:grid;align-content:center;width:min(100%,560px);min-height:100vh;margin:auto;padding:max(22px,env(safe-area-inset-top)) 18px max(26px,env(safe-area-inset-bottom))}
    article{display:grid;gap:20px;padding:18px;border:1px solid rgba(255,255,255,.14);border-radius:8px;background:rgba(17,17,19,.94);box-shadow:0 24px 62px rgba(0,0,0,.52)}
    .art{position:relative;display:grid;place-items:center;width:min(96%,360px);aspect-ratio:1;margin:auto;isolation:isolate;perspective:900px}
    .art img{z-index:2;width:96%;height:96%;border-radius:8px;object-fit:cover;animation:drift 9s ease-in-out infinite;box-shadow:0 18px 44px rgba(239,23,68,.2)}
    .wave{position:absolute;inset:4%;z-index:1;border:3px solid rgba(239,23,68,.58);border-radius:50%;opacity:0;filter:drop-shadow(0 0 12px rgba(239,23,68,.8));pointer-events:none}
    .wave.gold{inset:9%;border-color:rgba(255,174,0,.58);filter:drop-shadow(0 0 12px rgba(255,174,0,.72))}
    .playing .art img{animation:ambient 6.8s ease-in-out infinite}
    .playing .wave.red{animation:waveRed 3.2s ease-out infinite}
    .playing .wave.gold{animation:waveGold 4.1s ease-out .75s infinite}
    h1{margin:0 0 6px;overflow-wrap:anywhere;font-size:clamp(1.45rem,7vw,2.2rem);line-height:1.12;text-align:center}
    .artist{margin:0;color:#aaa5a3;text-align:center}
    .player{display:grid;gap:8px;padding:14px;border:1px solid rgba(255,255,255,.1);border-radius:8px;background:linear-gradient(135deg,rgba(239,23,68,.13),rgba(255,174,0,.07)),rgba(5,5,6,.72)}
    input{width:100%;height:22px;margin:0;accent-color:#ef1744}
    .time{display:flex;justify-content:space-between;color:#aaa5a3;font-size:.7rem;font-variant-numeric:tabular-nums}
    .controls{display:grid;grid-template-columns:46px 66px 46px;align-items:center;justify-content:center;gap:14px}
    button{display:grid;place-items:center;width:46px;height:46px;border:1px solid rgba(255,255,255,.14);border-radius:50%;background:rgba(255,255,255,.07);color:#fff;font-size:.76rem;font-weight:800}
    #play{position:relative;width:66px;height:66px;border-color:#ef1744;background:#ef1744;box-shadow:0 12px 30px rgba(239,23,68,.34)}
    #play:before{content:"";position:absolute;top:50%;left:50%;border-top:10px solid transparent;border-bottom:10px solid transparent;border-left:15px solid #fff;transform:translate(-38%,-50%)}
    #play.pause:before,#play.pause:after{content:"";position:absolute;top:50%;width:7px;height:22px;border:0;border-radius:2px;background:#fff;transform:translate(-50%,-50%)}
    #play.pause:before{left:calc(50% - 6px)}
    #play.pause:after{left:calc(50% + 6px)}
    .status{min-height:1em;margin:0;color:rgba(248,247,244,.48);font-size:.72rem;text-align:center}
    @keyframes drift{0%,100%{transform:translate3d(-3px,3px,0) rotate(-1deg) scale(.985)}25%{transform:translate3d(5px,-5px,0) rotate(.8deg) scale(1.005)}52%{transform:translate3d(1px,5px,0) rotate(1.4deg) scale(.99)}78%{transform:translate3d(-6px,-3px,0) rotate(-.6deg) scale(1.01)}}
    @keyframes ambient{0%,100%{transform:translate3d(-8px,5px,0) rotate(-1.8deg) scale(.98);filter:saturate(1.05)}18%{transform:translate3d(7px,-10px,0) rotate(1.7deg) scale(1.055);filter:saturate(1.3) brightness(1.1)}38%{transform:translate3d(11px,4px,0) rotate(2.2deg) scale(1.015)}61%{transform:translate3d(-5px,9px,0) rotate(-1.3deg) scale(1.04)}82%{transform:translate3d(-12px,-6px,0) rotate(-2.4deg) scale(1.025);filter:saturate(1.34) brightness(1.11)}}
    @keyframes waveRed{0%{opacity:0;transform:rotate(-8deg) scale(.82)}18%{opacity:.92}100%{opacity:0;transform:rotate(24deg) scale(1.32)}}
    @keyframes waveGold{0%{opacity:0;transform:rotate(14deg) scale(.78)}20%{opacity:.82}100%{opacity:0;transform:rotate(-30deg) scale(1.38)}}
    @media(prefers-reduced-motion:reduce){.art img,.playing .art img,.playing .wave{animation:none}}
  </style>
</head>
<body>
  <main>
    <article id="card">
      <div class="art">
        <span class="wave red"></span><span class="wave gold"></span>
        <img src="/icon" alt="">
      </div>
      <div><h1 id="title">読み込み中</h1><p class="artist" id="artist">sak_Uta</p></div>
      <div class="player" id="player">
        <input id="seek" type="range" min="0" max="1000" value="0" aria-label="再生位置">
        <div class="time"><span id="current">0:00</span><span id="duration">0:00</span></div>
        <div class="controls">
          <button id="back" aria-label="10秒戻る">−10</button>
          <button id="play" aria-label="再生"></button>
          <button id="forward" aria-label="10秒進む">+10</button>
        </div>
      </div>
      <audio id="audio" playsinline preload="metadata"></audio>
      <p class="status" id="status"></p>
    </article>
  </main>
  <script>
    const token=location.pathname.split("/").pop();
    const q=(value)=>document.querySelector(value);
    const audio=q("#audio"),play=q("#play"),seek=q("#seek"),card=q("#card"),status=q("#status");
    let seeking=false;
    fetch("/api/shares/"+encodeURIComponent(token),{cache:"no-store"}).then(async response=>{
      const payload=await response.json();
      if(!response.ok||!payload.ok)throw new Error("この共有リンクは利用できません");
      const track=payload.data;
      q("#title").textContent=track.title;
      q("#artist").textContent=track.artist||"sak_Uta";
      document.title=track.title+" | sak_Uta";
      audio.src=track.audioUrl;
      if("mediaSession"in navigator&&"MediaMetadata"in window){
        navigator.mediaSession.metadata=new MediaMetadata({title:track.title,artist:track.artist||"sak_Uta",album:"sak_Uta"});
      }
    }).catch(error=>{q("#title").textContent="再生できません";q("#artist").textContent="";q("#player").hidden=true;status.textContent=error.message});
    play.onclick=()=>audio.paused?audio.play().catch(()=>status.textContent="再生を開始できませんでした"):audio.pause();
    q("#back").onclick=()=>jump(-10);q("#forward").onclick=()=>jump(10);
    seek.oninput=()=>{seeking=true;q("#current").textContent=clock(Number(seek.value)/1000*(audio.duration||0))};
    seek.onchange=()=>{if(Number.isFinite(audio.duration))audio.currentTime=Number(seek.value)/1000*audio.duration;seeking=false};
    ["play","playing","pause","ended"].forEach(name=>audio.addEventListener(name,state));
    ["loadedmetadata","timeupdate"].forEach(name=>audio.addEventListener(name,progress));
    function state(){const active=!audio.paused&&!audio.ended;card.classList.toggle("playing",active);play.classList.toggle("pause",active);play.setAttribute("aria-label",active?"一時停止":"再生")}
    function progress(){if(!seeking&&audio.duration){seek.value=Math.round(audio.currentTime/audio.duration*1000);q("#current").textContent=clock(audio.currentTime)}q("#duration").textContent=clock(audio.duration)}
    function jump(value){if(Number.isFinite(audio.duration))audio.currentTime=Math.min(Math.max(audio.currentTime+value,0),audio.duration)}
    function clock(value){if(!Number.isFinite(value))return"0:00";return Math.floor(value/60)+":"+String(Math.floor(value%60)).padStart(2,"0")}
  </script>
</body>
</html>`;
