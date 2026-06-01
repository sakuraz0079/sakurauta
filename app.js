const API_URL = "https://script.google.com/macros/s/AKfycbz2PjeyxX01bEjnGa0nkliICSxpAQhFC73qm78eAO6UTZzOAz1liBUN-26PVa7UDzrRuw/exec";
const R2_BASE_URL = "https://pub-3b279d63cf3f4efdb626192fa8e22ef2.r2.dev/";
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
  detailBackdrop: document.querySelector("#detailBackdrop"),
  detailSheet: document.querySelector("#detailSheet"),
  detailTitle: document.querySelector("#detailTitle"),
  detailArtist: document.querySelector("#detailArtist"),
  detailBasic: document.querySelector("#detailBasic"),
  detailVocal: document.querySelector("#detailVocal"),
  detailMemo: document.querySelector("#detailMemo"),
  detailPlay: document.querySelector("#detailPlayButton"),
  detailFavorite: document.querySelector("#detailFavoriteButton"),
  detailPrev: document.querySelector("#detailPrevButton"),
  detailNext: document.querySelector("#detailNextButton"),
  detailOpen: document.querySelector("#detailOpenButton"),
  detailClose: document.querySelector("#closeDetailButton"),
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

  els.detailBackdrop.addEventListener("click", closeDetail);
  els.detailClose.addEventListener("click", closeDetail);
  els.detailPlay.addEventListener("click", () => {
    const track = getDetailTrack();
    if (track) playTrack(track);
  });
  els.detailFavorite.addEventListener("click", () => {
    const track = getDetailTrack();
    if (track) toggleFavorite(track.id);
  });
  els.detailPrev.addEventListener("click", () => moveDetail(-1));
  els.detailNext.addEventListener("click", () => moveDetail(1));
  els.audio.addEventListener("ended", playNext);
}

async function loadTracks({ force = false } = {}) {
  if (new URLSearchParams(location.search).has("demo")) {
    state.tracks = demoTracks();
    els.sync.textContent = "デモ表示";
    render();
    return;
  }

  const cached = readJson(CACHE_KEY);
  if (cached?.length && !force) {
    state.tracks = cached.map(normalizeTrack).filter(Boolean);
    els.sync.textContent = "保存済み一覧";
    render();
  }

  els.sync.textContent = "API更新中";
  try {
    const payload = await fetchApiPayload();
    const rows = extractRows(payload);
    state.tracks = rows.map(normalizeTrack).filter(Boolean);
    localStorage.setItem(CACHE_KEY, JSON.stringify(state.tracks));
    els.sync.textContent = `更新 ${formatTime(new Date())}`;
    render();
  } catch (error) {
    if (!state.tracks.length && cached?.length) {
      state.tracks = cached.map(normalizeTrack).filter(Boolean);
    }
    const reason = error?.message ? `: ${error.message}` : "";
    els.sync.textContent = state.tracks.length ? `API未接続・保存済み表示${reason}` : `API未接続${reason}`;
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
  const title = pick(raw, ["title", "曲名", "song", "name", "楽曲名"]);
  const artist = pick(raw, ["artist", "アーティスト", "original_artist", "原曲アーティスト", "歌手"]);
  const version = pick(raw, ["category", "version", "バージョン", "mix", "master", "mastering"]);
  const fileName = pick(raw, ["fileName", "filename", "file", "ファイル名", "wav_filename", "WAV", "wav"]);
  const url = pick(raw, ["url", "r2_url", "audioUrl", "audio_url", "音源URL", "URL"]) || buildAudioUrl({ artist, title, version, fileName });
  if (!title && !fileName && !url) return null;

  const tags = normalizeTags(pick(raw, ["tags", "tag", "タグ"]));
  const date = pick(raw, ["last_updated", "date", "created", "recorded", "追加日", "録音日", "更新日"]);
  const memo = pick(raw, ["memo", "note", "notes", "メモ", "備考"]);
  const id = pick(raw, ["id", "ID", "uuid"]) || slug(`${artist}-${title}-${version}-${fileName}-${index}`);
  const quality = pick(raw, ["quality_score", "quality", "score", "評価"]);
  const retake = pick(raw, ["retake_count", "retake", "歌いなおし回数"]);
  const karaokeReady = parseBoolean(raw.karaoke_ready ?? pick(raw, ["karaoke", "カラオケ可", "カラオケ"]));
  const highestNote = pick(raw, ["highest_note", "最高音"]);
  const key = pick(raw, ["key", "キー"]);

  return {
    id,
    title: title || stripExtension(fileName) || "Untitled",
    artist: artist || "",
    version: version || "",
    tags: [version, ...tags].filter(Boolean),
    date: date || "",
    displayDate: formatDate(date),
    memo: memo || "",
    url,
    fileName: fileName || fileNameFromUrl(url),
    quality,
    retake,
    karaokeReady,
    highestNote,
    key,
    searchText: [title, artist, version, tags.join(" "), date, memo, fileName, highestNote, key].join(" ").toLowerCase(),
  };
}

function render() {
  renderTags();
  const tracks = filterTracks();
  const pageCount = Math.max(1, Math.ceil(tracks.length / PAGE_SIZE));
  state.page = Math.min(Math.max(1, state.page), pageCount);
  const start = (state.page - 1) * PAGE_SIZE;
  const pageTracks = tracks.slice(start, start + PAGE_SIZE);

  els.count.textContent = `${tracks.length} / ${state.tracks.length} 曲`;
  els.page.textContent = `${state.page} / ${pageCount}`;
  els.prevPage.disabled = state.page <= 1;
  els.nextPage.disabled = state.page >= pageCount;
  els.prevPage.parentElement.hidden = tracks.length <= PAGE_SIZE;
  els.list.replaceChildren();

  if (!pageTracks.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "該当する曲がありません";
    els.list.append(empty);
    return;
  }

  for (const track of pageTracks) {
    els.list.append(renderTrack(track));
  }
}

function renderTags() {
  const tags = [...new Set(state.tracks.flatMap((track) => track.tags))].slice(0, 30);
  els.tags.replaceChildren(makeChip("すべて", ""));
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
  node.classList.toggle("active", track.id === state.currentId);
  node.querySelector("h2").textContent = track.title;
  node.querySelector("p").textContent = track.artist || "アーティスト未設定";

  const stats = node.querySelector(".track-stats");
  stats.append(makeStat(starText(track.quality), "stars"));
  stats.append(makeStat(`生成 ${track.displayDate || "-"}`));
  stats.append(makeStat(`Re ${track.retake || 0}回`));
  stats.append(makeStat(track.karaokeReady ? "カラオケ可" : "カラオケ未確認", track.karaokeReady ? "ready" : "not-ready"));

  const meta = node.querySelector(".track-meta");
  const metaItems = [track.highestNote && `最高音 ${track.highestNote}`, track.key !== "" && `キー ${track.key}`, track.version].filter(Boolean);
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
  node.addEventListener("click", () => openDetail(track.id));
  return node;
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
  els.nowArtist.textContent = [track.artist, track.version].filter(Boolean).join(" / ") || track.url;
  state.recent = [track.id, ...state.recent.filter((id) => id !== track.id)].slice(0, 50);
  localStorage.setItem(RECENT_KEY, JSON.stringify(state.recent));
  render();
  if (state.detailId) renderDetail();
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
  if (state.detailId) renderDetail();
}

function openDetail(id) {
  state.detailId = id;
  renderDetail();
  els.detailBackdrop.hidden = false;
  els.detailSheet.hidden = false;
}

function closeDetail() {
  state.detailId = "";
  els.detailBackdrop.hidden = true;
  els.detailSheet.hidden = true;
}

function renderDetail() {
  const track = getDetailTrack();
  if (!track) return;
  els.detailTitle.textContent = track.title;
  els.detailArtist.textContent = track.artist || "アーティスト未設定";
  els.detailBasic.replaceChildren(
    ...detailRows([
      ["曲名", track.title],
      ["アーティスト", track.artist],
      ["生成日", track.displayDate],
      ["カテゴリ", track.version],
      ["ファイル名", track.fileName],
    ])
  );
  els.detailVocal.replaceChildren(
    ...detailRows([
      ["memo", track.memo],
      ["highest_note", track.highestNote],
      ["key", track.key === "" ? "" : track.key],
      ["karaoke_ready", track.karaokeReady ? "歌える" : "未確認"],
      ["quality_score", starText(track.quality)],
      ["retake_count", `${track.retake || 0}回`],
    ])
  );
  els.detailMemo.textContent = track.memo || "メモはありません";
  els.detailFavorite.textContent = state.favorites.has(track.id) ? "★ お気に入り" : "☆ お気に入り";
  els.detailOpen.href = track.url || "#";
  els.detailOpen.setAttribute("aria-disabled", track.url ? "false" : "true");

  const list = filterTracks();
  const index = list.findIndex((item) => item.id === track.id);
  els.detailPrev.disabled = index <= 0;
  els.detailNext.disabled = index === -1 || index >= list.length - 1;
}

function detailRows(rows) {
  return rows.flatMap(([label, value]) => {
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = label;
    dd.textContent = value === undefined || value === null || value === "" ? "-" : value;
    return [dt, dd];
  });
}

function moveDetail(direction) {
  const list = filterTracks();
  const index = list.findIndex((track) => track.id === state.detailId);
  const next = list[index + direction];
  if (next) openDetail(next.id);
}

function getDetailTrack() {
  return state.tracks.find((track) => track.id === state.detailId);
}

function pick(source, keys) {
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null && String(source[key]).trim() !== "") {
      return String(source[key]).trim();
    }
  }
  return "";
}

function buildAudioUrl({ artist, title, version, fileName }) {
  const name = fileName || [artist, title, version].filter(Boolean).join("_") + ".wav";
  return name ? R2_BASE_URL + encodeURIComponent(name).replaceAll("%2F", "/") : "";
}

function normalizeTags(value) {
  if (Array.isArray(value)) return value.map(String).map((tag) => tag.trim()).filter(Boolean);
  return String(value || "")
    .split(/[,\s、/]+/)
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
  return score ? "★".repeat(score) + "☆".repeat(5 - score) : "未評価";
}

function parseBoolean(value) {
  if (value === true) return true;
  const text = String(value || "").toLowerCase().trim();
  return ["true", "yes", "1", "ok", "可", "歌える"].includes(text);
}

function scrollToTop() {
  document.querySelector(".status-row")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function demoTracks() {
  return [
    normalizeTrack({
      id: "demo-1",
      title: "Get Along Together",
      artist: "山根康広",
      category: "Mastering",
      quality_score: 4,
      karaoke_ready: true,
      retake_count: 0,
      highest_note: "mid2G#",
      last_updated: "2026-05-31",
      memo: "いい感じに歌えたが、サビが一瞬高いので要注意",
      url: "https://pub-3b279d63cf3f4efdb626192fa8e22ef2.r2.dev/山根康広_Get Along Together_Mastering-2.wav",
    }),
    normalizeTrack({
      id: "demo-2",
      title: "POP STAR",
      artist: "平井堅",
      category: "Mastering",
      quality_score: 3,
      retake_count: 1,
      key: -2,
      highest_note: "mid2G",
      last_updated: "2026-05-27",
      url: "https://pub-3b279d63cf3f4efdb626192fa8e22ef2.r2.dev/平井堅_POP STAR_Re_Mastering-5.wav",
    }),
  ];
}
