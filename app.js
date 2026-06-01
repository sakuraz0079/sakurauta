const API_URL = "https://script.google.com/macros/s/AKfycbz2PjeyxX01bEjnGa0nkliICSxpAQhFC73qm78eAO6UTZzOAz1liBUN-26PVa7UDzrRuw/exec";
const CACHE_KEY = "utawav.tracks";
const FAVORITES_KEY = "utawav.favorites";
const RECENT_KEY = "utawav.recent";
const PAGE_SIZE = 20;

const state = {
  tracks: [],
  query: "",
  sort: "recent",
  view: "all",
  tag: "",
  currentId: "",
  detailId: "",
  page: 1,
  favorites: readSet(FAVORITES_KEY),
  recent: readArray(RECENT_KEY),
};

const els = {
  search: document.querySelector("#searchInput"),
  sort: document.querySelector("#sortSelect"),
  view: document.querySelector("#viewSelect"),
  tags: document.querySelector("#tagChips"),
  count: document.querySelector("#countLabel"),
  sync: document.querySelector("#syncLabel"),
  list: document.querySelector("#trackList"),
  template: document.querySelector("#trackTemplate"),
  audio: document.querySelector("#audio"),
  nowTitle: document.querySelector("#nowTitle"),
  nowArtist: document.querySelector("#nowArtist"),
  refresh: document.querySelector("#refreshButton"),
  prevPage: document.querySelector("#prevPageButton"),
  nextPage: document.querySelector("#nextPageButton"),
  page: document.querySelector("#pageLabel"),
};

init();

async function init() {
  bindEvents();
  await loadTracks();
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}

function bindEvents() {
  els.search.addEventListener("input", () => {
    state.query = els.search.value.trim().toLowerCase();
    state.page = 1;
    render();
  });

  els.sort.addEventListener("change", () => {
    state.sort = els.sort.value;
    state.page = 1;
    render();
  });

  els.view.addEventListener("change", () => {
    state.view = els.view.value;
    state.page = 1;
    render();
  });

  els.refresh.addEventListener("click", () => loadTracks({ force: true }));
  els.prevPage.addEventListener("click", () => {
    state.page = Math.max(1, state.page - 1);
    render();
    scrollToTop();
  });
  els.nextPage.addEventListener("click", () => {
    state.page += 1;
    render();
    scrollToTop();
  });
  els.audio.addEventListener("ended", playNext);
}

async function loadTracks({ force = false } = {}) {
  if (new URLSearchParams(location.search).has("demo")) {
    state.tracks = demoTracks();
    els.sync.textContent = "\u30c7\u30e2";
    render();
    return;
  }

  const cached = readJson(CACHE_KEY);
  if (cached?.length && !force) {
    state.tracks = cached.map(normalizeTrack).filter(Boolean);
    els.sync.textContent = "\u4fdd\u5b58\u6e08\u307f";
    render();
  }

  els.sync.textContent = "\u66f4\u65b0\u4e2d";
  try {
    const payload = await fetchApiPayload();
    const rows = extractRows(payload);
    state.tracks = rows.map(normalizeTrack).filter(Boolean);
    localStorage.setItem(CACHE_KEY, JSON.stringify(state.tracks));
    els.sync.textContent = `\u66f4\u65b0 ${formatTime(new Date())}`;
    render();
  } catch (error) {
    if (!state.tracks.length && cached?.length) {
      state.tracks = cached.map(normalizeTrack).filter(Boolean);
    }
    const reason = error?.message ? `: ${error.message}` : "";
    els.sync.textContent = state.tracks.length ? `API\u672a\u63a5\u7d9a\u30fb\u4fdd\u5b58\u6e08\u307f${reason}` : `API\u672a\u63a5\u7d9a${reason}`;
    render();
  }
}

async function fetchApiPayload() {
  try {
    const response = await fetch(`${API_URL}?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`API error ${response.status}`);
    return await response.json();
  } catch {
    return fetchJsonp(API_URL);
  }
}

function fetchJsonp(url) {
  return new Promise((resolve, reject) => {
    const callbackName = `__utawav_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const script = document.createElement("script");
    const cleanup = () => {
      clearTimeout(timer);
      delete window[callbackName];
      script.remove();
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("JSONP timeout"));
    }, 12000);

    window[callbackName] = (payload) => {
      cleanup();
      resolve(payload);
    };

    script.onerror = () => {
      cleanup();
      reject(new Error("JSONP API error"));
    };

    const separator = url.includes("?") ? "&" : "?";
    script.src = `${url}${separator}callback=${encodeURIComponent(callbackName)}&t=${Date.now()}`;
    document.head.append(script);
  });
}

function extractRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.tracks)) return payload.tracks;
  if (Array.isArray(payload?.songs)) return payload.songs;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.records)) return payload.records;
  if (Array.isArray(payload?.values)) return rowsFromValues(payload.values);
  return [];
}

function rowsFromValues(values) {
  const [headers, ...rows] = values;
  if (!Array.isArray(headers)) return [];
  return rows.map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])));
}

function normalizeTrack(raw, index = 0) {
  if (!raw || typeof raw !== "object") return null;
  const title = pick(raw, ["title", "song", "name"]);
  const artist = pick(raw, ["artist", "original_artist"]);
  const category = pick(raw, ["category", "version", "mix", "master", "mastering"]);
  const fileName = pick(raw, ["fileName", "filename", "file", "wav_filename", "WAV", "wav"]);
  const url = pick(raw, ["url", "r2_url", "audioUrl", "audio_url", "URL"]);
  const resolvedFileName = fileName || fileNameFromUrl(url);
  const fileVersion = versionFromFileName(resolvedFileName);
  if (!title && !fileName && !url) return null;

  const genreTags = normalizeTags(pick(raw, ["tags", "tag"]));
  const date = pick(raw, ["last_updated", "date", "created", "recorded"]);
  const memo = pick(raw, ["memo", "note", "notes"]);
  const id = pick(raw, ["id", "ID", "uuid"]) || slug(`${artist}-${title}-${category}-${fileName}-${index}`);
  const quality = pick(raw, ["quality_score", "quality", "score"]);
  const retake = pick(raw, ["retake_count", "retake"]);
  const karaokeReady = parseBoolean(raw.karaoke_ready ?? pick(raw, ["karaoke"]));
  const highestNote = pick(raw, ["highest_note"]);
  const key = pick(raw, ["key"]);

  return {
    id,
    title: title || stripExtension(fileName) || "Untitled",
    artist: artist || "",
    category: category || "",
    version: fileVersion || category || "",
    tags: [category, ...genreTags].filter(Boolean),
    genreTags,
    date: date || "",
    displayDate: formatDate(date),
    memo: memo || "",
    url,
    fileName: resolvedFileName,
    quality,
    retake,
    karaokeReady,
    highestNote,
    key,
    searchText: [title, artist, category, fileVersion, genreTags.join(" "), date, memo, fileName, highestNote, key].join(" ").toLowerCase(),
  };
}

function render() {
  renderTags();
  const tracks = filterTracks();
  const pageCount = Math.max(1, Math.ceil(tracks.length / PAGE_SIZE));
  state.page = Math.min(Math.max(1, state.page), pageCount);
  const start = (state.page - 1) * PAGE_SIZE;
  const pageTracks = tracks.slice(start, start + PAGE_SIZE);

  els.count.textContent = `${tracks.length} / ${state.tracks.length} \u66f2`;
  els.page.textContent = `${state.page} / ${pageCount}`;
  els.prevPage.disabled = state.page <= 1;
  els.nextPage.disabled = state.page >= pageCount;
  els.prevPage.parentElement.hidden = tracks.length <= PAGE_SIZE;
  els.list.replaceChildren();

  if (!pageTracks.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "\u8a72\u5f53\u3059\u308b\u66f2\u304c\u3042\u308a\u307e\u305b\u3093";
    els.list.append(empty);
    return;
  }

  for (const track of pageTracks) {
    els.list.append(renderTrack(track));
  }
}

function renderTags() {
  const tags = [...new Set(state.tracks.flatMap((track) => track.tags))].slice(0, 30);
  els.tags.replaceChildren(makeChip("\u3059\u3079\u3066", ""));
  for (const tag of tags) {
    els.tags.append(makeChip(tag, tag));
  }
}

function makeChip(label, value) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `chip${state.tag === value ? " active" : ""}`;
  button.textContent = label;
  button.addEventListener("click", () => {
    state.tag = state.tag === value ? "" : value;
    state.page = 1;
    render();
  });
  return button;
}

function renderTrack(track) {
  const node = els.template.content.firstElementChild.cloneNode(true);
  const expanded = track.id === state.detailId;
  node.classList.toggle("active", track.id === state.currentId);
  node.classList.toggle("expanded", expanded);
  node.querySelector("h2").textContent = track.title;
  node.querySelector("p").textContent = track.artist || "\u30a2\u30fc\u30c6\u30a3\u30b9\u30c8\u672a\u8a2d\u5b9a";

  const stats = node.querySelector(".track-stats");
  stats.append(makeStat(starText(track.quality), "stars"));
  stats.append(makeStat(track.displayDate || "-"));
  if (Number(track.retake) > 0) stats.append(makeStat(`Re ${track.retake}`));
  if (track.karaokeReady) stats.append(makeStat("\u6b4c\u3048\u308b", "ready"));

  const meta = node.querySelector(".track-meta");
  const metaItems = [track.version, ...track.genreTags].filter(Boolean);
  for (const item of metaItems.slice(0, 4)) {
    const pill = document.createElement("span");
    pill.className = "meta-pill";
    pill.textContent = item;
    meta.append(pill);
  }

  const play = node.querySelector(".play-button");
  const favorite = node.querySelector(".favorite-button");
  play.addEventListener("click", (event) => {
    event.stopPropagation();
    playTrack(track);
  });
  favorite.classList.toggle("active", state.favorites.has(track.id));
  favorite.textContent = state.favorites.has(track.id) ? "★" : "☆";
  favorite.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleFavorite(track.id);
  });
  node.addEventListener("click", () => toggleDetail(track.id));
  if (expanded) node.append(renderInlineDetail(track));
  return node;
}

function renderInlineDetail(track) {
  const detail = document.createElement("div");
  detail.className = "inline-detail";
  detail.addEventListener("click", (event) => event.stopPropagation());

  const memo = document.createElement("p");
  memo.className = "inline-memo";
  memo.textContent = track.memo || "\u30e1\u30e2\u306a\u3057";
  detail.append(memo);

  const facts = document.createElement("div");
  facts.className = "inline-facts";
  [
    track.highestNote,
    track.key !== "" && `key ${track.key}`,
    track.version,
    ...track.genreTags,
    track.fileName,
  ].filter(Boolean).forEach((item) => facts.append(makeFact(item)));
  detail.append(facts);

  const actions = document.createElement("div");
  actions.className = "inline-actions";
  actions.append(makeAction(state.favorites.has(track.id) ? "★ \u304a\u6c17\u306b\u5165\u308a" : "☆ \u304a\u6c17\u306b\u5165\u308a", () => toggleFavorite(track.id)));
  detail.append(actions);

  return detail;
}

function makeFact(text) {
  const item = document.createElement("span");
  item.className = "inline-fact";
  item.textContent = text;
  return item;
}

function makeAction(label, action, primary = false) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.className = primary ? "primary-action" : "";
  button.addEventListener("click", action);
  return button;
}

function makeStat(text, className = "") {
  const pill = document.createElement("span");
  pill.className = `stat-pill${className ? ` ${className}` : ""}`;
  pill.textContent = text;
  return pill;
}

function filterTracks() {
  let tracks = [...state.tracks];
  if (state.query) tracks = tracks.filter((track) => track.searchText.includes(state.query));
  if (state.tag) tracks = tracks.filter((track) => track.tags.includes(state.tag));
  if (state.view === "favorites") tracks = tracks.filter((track) => state.favorites.has(track.id));
  if (state.view === "recentlyPlayed") tracks = tracks.filter((track) => state.recent.includes(track.id));

  tracks.sort((a, b) => {
    if (state.sort === "title") return a.title.localeCompare(b.title, "ja");
    if (state.sort === "artist") return a.artist.localeCompare(b.artist, "ja") || a.title.localeCompare(b.title, "ja");
    if (state.sort === "favorite") return Number(state.favorites.has(b.id)) - Number(state.favorites.has(a.id));
    return dateValue(b.date) - dateValue(a.date) || a.title.localeCompare(b.title, "ja");
  });

  if (state.view === "recentlyPlayed") {
    tracks.sort((a, b) => state.recent.indexOf(a.id) - state.recent.indexOf(b.id));
  }

  return tracks;
}

function playTrack(track) {
  if (!track.url) return;
  state.currentId = track.id;
  els.audio.src = track.url;
  els.audio.play().catch(() => {});
  els.nowTitle.textContent = track.title;
  els.nowArtist.textContent = [track.artist, track.category].filter(Boolean).join(" / ") || track.url;
  state.recent = [track.id, ...state.recent.filter((id) => id !== track.id)].slice(0, 50);
  localStorage.setItem(RECENT_KEY, JSON.stringify(state.recent));
  render();
}

function playNext() {
  const tracks = filterTracks();
  const index = tracks.findIndex((track) => track.id === state.currentId);
  const next = tracks[index + 1];
  if (next) playTrack(next);
}

function toggleFavorite(id) {
  if (state.favorites.has(id)) state.favorites.delete(id);
  else state.favorites.add(id);
  localStorage.setItem(FAVORITES_KEY, JSON.stringify([...state.favorites]));
  render();
}

function toggleDetail(id) {
  state.detailId = state.detailId === id ? "" : id;
  render();
}

function moveDetail(direction) {
  const list = filterTracks();
  const index = list.findIndex((track) => track.id === state.detailId);
  const next = list[index + direction];
  if (next) {
    state.detailId = next.id;
    render();
  }
}

function pick(source, keys) {
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null && String(source[key]).trim() !== "") {
      return String(source[key]).trim();
    }
  }
  return "";
}

function normalizeTags(value) {
  if (Array.isArray(value)) return value.map(String).map((tag) => tag.trim()).filter(Boolean);
  return String(value || "")
    .split(/[,\s/]+/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function readSet(key) {
  return new Set(readArray(key));
}

function readArray(key) {
  const value = readJson(key);
  return Array.isArray(value) ? value : [];
}

function readJson(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || "null");
  } catch {
    return null;
  }
}

function slug(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-|-$/g, "");
}

function stripExtension(value) {
  return String(value || "").replace(/\.[^.]+$/, "");
}

function fileNameFromUrl(value) {
  try {
    return decodeURIComponent(new URL(value).pathname.split("/").pop() || "");
  } catch {
    return "";
  }
}

function versionFromFileName(value) {
  const name = stripExtension(fileNameFromUrl(value) || value);
  const match = name.match(/(?:^|_)(Re_)?(Mastering-\d+|Master-\d+|Mix-\d+)$/i);
  if (!match) return "";
  return `${match[1] || ""}${match[2]}`;
}

function dateValue(value) {
  const time = Date.parse(value);
  return Number.isNaN(time) ? 0 : time;
}

function formatTime(date) {
  return date.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "";
  return date.toLocaleDateString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function starText(value) {
  const score = Math.max(0, Math.min(5, Number(value) || 0));
  return score ? "★".repeat(score) + "☆".repeat(5 - score) : "\u672a\u8a55\u4fa1";
}

function parseBoolean(value) {
  if (value === true) return true;
  const text = String(value || "").toLowerCase().trim();
  return ["true", "yes", "1", "ok"].includes(text);
}

function scrollToTop() {
  document.querySelector(".status-row")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function demoTracks() {
  return [
    normalizeTrack({
      id: "demo-1",
      title: "Get Along Together",
      artist: "Yasuhiro Yamane",
      category: "Mastering",
      quality_score: 4,
      karaoke_ready: true,
      retake_count: 0,
      highest_note: "mid2G#",
      last_updated: "2026-05-31",
      memo: "Good take. The chorus gets high for a moment.",
      url: "https://pub-3b279d63cf3f4efdb626192fa8e22ef2.r2.dev/demo.wav",
    }),
  ];
}
