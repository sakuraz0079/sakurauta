const API_URL = "https://script.google.com/macros/s/AKfycbxNHOf1ueQvlaOSZSgxSt8_Nq5CDwQVxUWLlT64dpSy3ha8NBFZH4JX_2pEEdB1wefQdw/exec";
const trackId = new URLSearchParams(location.search).get("track");

const title = document.querySelector("#shareTitle");
const artist = document.querySelector("#shareArtist");
const audio = document.querySelector("#shareAudio");
const status = document.querySelector("#shareStatus");
const artworkStage = document.querySelector("#artworkStage");
const seek = document.querySelector("#shareSeek");
const currentTime = document.querySelector("#shareCurrentTime");
const duration = document.querySelector("#shareDuration");
const play = document.querySelector("#sharePlay");
const back = document.querySelector("#shareBack");
const forward = document.querySelector("#shareForward");

let isSeeking = false;

play.addEventListener("click", togglePlayback);
back.addEventListener("click", () => seekBy(-10));
forward.addEventListener("click", () => seekBy(10));
seek.addEventListener("input", () => {
  isSeeking = true;
  currentTime.textContent = formatClock((Number(seek.value) / 1000) * (audio.duration || 0));
});
seek.addEventListener("change", () => {
  if (Number.isFinite(audio.duration)) audio.currentTime = (Number(seek.value) / 1000) * audio.duration;
  isSeeking = false;
});
audio.addEventListener("loadedmetadata", updateProgress);
audio.addEventListener("timeupdate", updateProgress);
audio.addEventListener("play", updatePlaybackState);
audio.addEventListener("playing", updatePlaybackState);
audio.addEventListener("pause", updatePlaybackState);
audio.addEventListener("ended", updatePlaybackState);

loadSharedTrack();

async function loadSharedTrack() {
  if (!trackId) {
    showError("共有する曲が指定されていません");
    return;
  }

  try {
    const payload = await fetchPayload();
    const rows = extractRows(payload);
    const raw = rows.find((row) => String(pick(row, ["id", "ID", "uuid"])) === trackId);
    if (!raw) throw new Error("曲が見つかりませんでした");

    const track = normalizeTrack(raw);
    if (!track.url) throw new Error("この曲には再生できる音源がありません");
    renderTrack(track);
  } catch (error) {
    showError(error?.message || "曲を読み込めませんでした");
  }
}

async function fetchPayload() {
  try {
    const response = await fetch(`${API_URL}?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`API error ${response.status}`);
    return response.json();
  } catch {
    return fetchJsonp(API_URL);
  }
}

function fetchJsonp(url) {
  return new Promise((resolve, reject) => {
    const callbackName = `__sakuta_share_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const script = document.createElement("script");
    const cleanup = () => {
      clearTimeout(timer);
      delete window[callbackName];
      script.remove();
    };
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error("曲を読み込めませんでした"));
    }, 12000);

    window[callbackName] = (payload) => {
      cleanup();
      resolve(payload);
    };
    script.onerror = () => {
      cleanup();
      reject(new Error("曲を読み込めませんでした"));
    };
    script.src = `${url}?callback=${encodeURIComponent(callbackName)}&t=${Date.now()}`;
    document.head.append(script);
  });
}

function extractRows(payload) {
  if (Array.isArray(payload)) return payload;
  for (const key of ["data", "tracks", "songs", "items", "records"]) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }
  if (Array.isArray(payload?.values)) {
    const [headers, ...rows] = payload.values;
    return rows.map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])));
  }
  return [];
}

function normalizeTrack(raw) {
  const fileName = pick(raw, ["fileName", "filename", "file", "wav_filename", "WAV", "wav"]);
  return {
    title: pick(raw, ["title", "song", "name"]) || "Untitled",
    artist: pick(raw, ["artist", "original_artist"]),
    version: versionFromFileName(fileName) || pick(raw, ["category", "version", "mix", "master", "mastering"]),
    url: pick(raw, ["url", "r2_url", "audioUrl", "audio_url", "URL"]),
  };
}

function renderTrack(track) {
  document.title = `${track.title} | sak_Uta`;
  title.textContent = track.title;
  artist.textContent = track.artist || "sak_Uta";
  audio.src = track.url;
  status.textContent = "";

  if ("mediaSession" in navigator && "MediaMetadata" in window) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist || "sak_Uta",
      album: [track.version, "sak_Uta"].filter(Boolean).join(" · "),
      artwork: [
        { src: new URL("./icon-192.png?v=20260615-6", location.href).href, sizes: "192x192", type: "image/png" },
        { src: new URL("./icon-512.png?v=20260615-6", location.href).href, sizes: "512x512", type: "image/png" },
      ],
    });
  }
}

function togglePlayback() {
  if (audio.paused) {
    audio.play().catch(() => {
      status.textContent = "再生を開始できませんでした";
      status.classList.add("error");
    });
  } else {
    audio.pause();
  }
}

function seekBy(seconds) {
  if (!Number.isFinite(audio.duration)) return;
  audio.currentTime = Math.min(Math.max(audio.currentTime + seconds, 0), audio.duration);
  updateProgress();
}

function updatePlaybackState() {
  const playing = !audio.paused && !audio.ended;
  artworkStage.classList.toggle("is-playing", playing);
  play.classList.toggle("is-playing", playing);
  play.setAttribute("aria-label", playing ? "一時停止" : "再生");
  play.setAttribute("title", playing ? "一時停止" : "再生");
}

function updateProgress() {
  const total = audio.duration;
  const position = audio.currentTime;
  if (!isSeeking && Number.isFinite(total) && total > 0) {
    seek.value = Math.round((position / total) * 1000);
    currentTime.textContent = formatClock(position);
  }
  duration.textContent = Number.isFinite(total) ? formatClock(total) : "0:00";
}

function formatClock(seconds) {
  if (!Number.isFinite(seconds)) return "0:00";
  const minutes = Math.floor(seconds / 60);
  const rest = Math.floor(seconds % 60);
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function showError(message) {
  title.textContent = "再生できません";
  artist.textContent = "";
  status.textContent = message;
  status.classList.add("error");
  document.querySelector(".share-player").hidden = true;
}

function pick(source, keys) {
  for (const key of keys) {
    if (source?.[key] !== undefined && source[key] !== null && String(source[key]).trim()) {
      return String(source[key]).trim();
    }
  }
  return "";
}

function versionFromFileName(fileName) {
  const match = String(fileName || "").match(/(?:^|[_\s-])(Mastering-\d+)(?=[_.\s-]|$)/i);
  return match?.[1] || "";
}
