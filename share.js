const API_URL = "https://script.google.com/macros/s/AKfycbxNHOf1ueQvlaOSZSgxSt8_Nq5CDwQVxUWLlT64dpSy3ha8NBFZH4JX_2pEEdB1wefQdw/exec";
const trackId = new URLSearchParams(location.search).get("track");

const title = document.querySelector("#shareTitle");
const artist = document.querySelector("#shareArtist");
const meta = document.querySelector("#shareMeta");
const memo = document.querySelector("#shareMemo");
const audio = document.querySelector("#shareAudio");
const status = document.querySelector("#shareStatus");

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
    quality: Number(pick(raw, ["quality_score", "quality", "score"])) || 0,
    retake: Number(pick(raw, ["retake_count", "retake"])) || 0,
    karaokeReady: parseBoolean(raw.karaoke_ready ?? raw.karaoke),
    highestNote: pick(raw, ["highest_note"]),
    key: pick(raw, ["key"]),
    tags: normalizeTags(pick(raw, ["tags", "tag"])),
    memo: pick(raw, ["memo", "note", "notes"]),
  };
}

function renderTrack(track) {
  document.title = `${track.title} | sak_Uta`;
  title.textContent = track.title;
  artist.textContent = track.artist || "sak_Uta";

  const items = [];
  if (track.version) items.push(track.version);
  if (track.quality) items.push(`${"★".repeat(track.quality)}${"☆".repeat(Math.max(0, 5 - track.quality))}`);
  if (track.retake > 0) items.push(`Re ${track.retake}`);
  if (track.karaokeReady) items.push("歌える");
  if (track.highestNote) items.push(`最高音 ${track.highestNote}`);
  if (track.key) items.push(`キー ${track.key}`);
  items.push(...track.tags);
  meta.replaceChildren(...items.map(makeMeta));

  memo.hidden = !track.memo;
  memo.textContent = track.memo;
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

function makeMeta(text) {
  const item = document.createElement("span");
  item.textContent = text;
  return item;
}

function showError(message) {
  title.textContent = "再生できません";
  artist.textContent = "";
  status.textContent = message;
  status.classList.add("error");
  audio.hidden = true;
}

function pick(source, keys) {
  for (const key of keys) {
    if (source?.[key] !== undefined && source[key] !== null && String(source[key]).trim()) {
      return String(source[key]).trim();
    }
  }
  return "";
}

function parseBoolean(value) {
  return ["true", "1", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function normalizeTags(value) {
  return [...new Set(String(value || "").split(/[,、/|]/).map((tag) => tag.trim()).filter(Boolean))];
}

function versionFromFileName(fileName) {
  const match = String(fileName || "").match(/(?:^|[_\s-])(Mastering-\d+)(?=[_.\s-]|$)/i);
  return match?.[1] || "";
}
