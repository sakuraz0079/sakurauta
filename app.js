const API_URL = "https://script.google.com/macros/s/AKfycbz2PjeyxX01bEjnGa0nkliICSxpAQhFC73qm78eAO6UTZzOAz1liBUN-26PVa7UDzrRuw/exec";
const CACHE_KEY = "utawav.tracks";
const FAVORITES_KEY = "utawav.favorites";
const RECENT_KEY = "utawav.recent";
const LAST_TRACK_KEY = "utawav.lastTrack";
const SHUFFLE_KEY = "utawav.shuffle";
const PLAYLISTS_KEY = "utawav.playlists";
const PAGE_SIZE = 20;

const state = {
  tracks: [],
  query: "",
  sort: "recent",
  view: "latest10",
  tag: "",
  currentId: "",
  detailId: "",
  isPlaying: false,
  isSeeking: false,
  playbackStatus: "idle",
  playbackMessage: "",
  shuffle: localStorage.getItem(SHUFFLE_KEY) === "true",
  waveform: [],
  page: 1,
  favorites: readSet(FAVORITES_KEY),
  recent: readArray(RECENT_KEY),
  playlists: readPlaylists(),
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
  nowMeta: document.querySelector("#nowMeta"),
  seek: document.querySelector("#seekRange"),
  waveCanvas: document.querySelector("#waveCanvas"),
  currentTime: document.querySelector("#currentTime"),
  durationTime: document.querySelector("#durationTime"),
  playerPrev: document.querySelector("#playerPrevButton"),
  playerPlay: document.querySelector("#playerPlayButton"),
  playerNext: document.querySelector("#playerNextButton"),
  shuffle: document.querySelector("#shuffleButton"),
  refresh: document.querySelector("#refreshButton"),
  newPlaylist: document.querySelector("#newPlaylistButton"),
  deletePlaylist: document.querySelector("#deletePlaylistButton"),
  playlistChips: document.querySelector("#playlistChips"),
  playlistForm: document.querySelector("#playlistForm"),
  playlistName: document.querySelector("#playlistNameInput"),
  prevPage: document.querySelector("#prevPageButton"),
  nextPage: document.querySelector("#nextPageButton"),
  page: document.querySelector("#pageLabel"),
};

init();

async function init() {
  bindEvents();
  renderPlaylistOptions();
  await loadTracks();
  restoreLastTrack();
  updatePlayerControls();
  drawWaveform();
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
    renderPlaylistOptions();
    render();
  });

  els.refresh.addEventListener("click", () => loadTracks({ force: true }));
  els.newPlaylist.addEventListener("click", showPlaylistForm);
  els.deletePlaylist.addEventListener("click", deleteCurrentPlaylist);
  els.playlistForm.addEventListener("submit", (event) => {
    event.preventDefault();
    createPlaylist(els.playlistName.value);
  });
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
  els.playerPrev.addEventListener("click", () => playAdjacent(-1));
  els.playerNext.addEventListener("click", () => playAdjacent(1));
  els.playerPlay.addEventListener("click", togglePlayback);
  els.shuffle.addEventListener("click", () => {
    state.shuffle = !state.shuffle;
    localStorage.setItem(SHUFFLE_KEY, String(state.shuffle));
    updatePlayerControls();
  });
  els.seek.addEventListener("input", () => {
    state.isSeeking = true;
    drawWaveform(Number(els.seek.value) / Number(els.seek.max || 1000));
  });
  els.seek.addEventListener("change", () => {
    const duration = els.audio.duration;
    if (Number.isFinite(duration)) {
      els.audio.currentTime = duration * (Number(els.seek.value) / Number(els.seek.max || 1000));
    }
    state.isSeeking = false;
  });
  els.audio.addEventListener("ended", () => playAdjacent(1, { autoplay: true }));
  els.audio.addEventListener("loadstart", () => setPlaybackStatus("loading", "\u8aad\u307f\u8fbc\u307f\u4e2d"));
  els.audio.addEventListener("waiting", () => setPlaybackStatus("loading", "\u8aad\u307f\u8fbc\u307f\u4e2d"));
  els.audio.addEventListener("stalled", () => setPlaybackStatus("loading", "\u901a\u4fe1\u3092\u5f85\u3063\u3066\u3044\u307e\u3059"));
  els.audio.addEventListener("canplay", () => {
    if (state.playbackStatus === "loading") setPlaybackStatus("ready", "");
  });
  els.audio.addEventListener("playing", () => setPlaybackStatus("playing", ""));
  els.audio.addEventListener("play", () => {
    state.isPlaying = true;
    updatePlayerControls();
    render();
  });
  els.audio.addEventListener("pause", () => {
    state.isPlaying = false;
    if (state.playbackStatus !== "error") setPlaybackStatus("idle", "");
    updatePlayerControls();
    render();
  });
  els.audio.addEventListener("error", () => {
    setPlaybackStatus("error", "\u518d\u751f\u3067\u304d\u307e\u305b\u3093\u3067\u3057\u305f");
    state.isPlaying = false;
    updatePlayerControls();
    render();
  });
  els.audio.addEventListener("loadedmetadata", updateProgress);
  els.audio.addEventListener("timeupdate", updateProgress);
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

function renderPlaylistOptions() {
  const current = state.view;
  const fixed = [
    ["all", "\u3059\u3079\u3066"],
    ["latest10", "\u6700\u65b010\u66f2"],
    ["favorites", "\u304a\u6c17\u306b\u5165\u308a"],
    ["recentlyPlayed", "\u6700\u8fd1\u518d\u751f"],
  ];
  els.view.replaceChildren();
  for (const [value, label] of fixed) {
    els.view.append(new Option(label, value));
  }
  if (state.playlists.length) {
    const group = document.createElement("optgroup");
    group.label = "\u81ea\u5206\u306e\u30ea\u30b9\u30c8";
    for (const playlist of state.playlists) {
      group.append(new Option(playlist.name, playlist.id));
    }
    els.view.append(group);
  }
  els.view.value = [...fixed.map(([value]) => value), ...state.playlists.map((playlist) => playlist.id)].includes(current)
    ? current
    : "latest10";
  state.view = els.view.value;
  els.deletePlaylist.hidden = !state.playlists.some((playlist) => playlist.id === state.view);
  renderPlaylistChips(fixed);
}

function renderPlaylistChips(fixed) {
  els.playlistChips.replaceChildren();
  for (const [value, label] of fixed) {
    els.playlistChips.append(makePlaylistChip(value, label));
  }
  for (const playlist of state.playlists) {
    els.playlistChips.append(makePlaylistChip(playlist.id, playlist.name));
  }
}

function makePlaylistChip(value, label) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `playlist-chip${state.view === value ? " active" : ""}`;
  button.textContent = label;
  button.addEventListener("click", () => {
    state.view = value;
    els.view.value = value;
    state.page = 1;
    renderPlaylistOptions();
    render();
  });
  return button;
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
  const isCurrent = track.id === state.currentId;
  node.classList.toggle("active", track.id === state.currentId);
  node.classList.toggle("expanded", expanded);
  node.classList.toggle("loading", isCurrent && state.playbackStatus === "loading");
  node.classList.toggle("error", isCurrent && state.playbackStatus === "error");
  node.querySelector("h2").textContent = track.title;
  node.querySelector("p").textContent = track.artist || "\u30a2\u30fc\u30c6\u30a3\u30b9\u30c8\u672a\u8a2d\u5b9a";

  const stats = node.querySelector(".track-stats");
  stats.append(makeStat(starText(track.quality), "stars"));
  stats.append(makeStat(track.displayDate || "-"));
  if (Number(track.retake) > 0) stats.append(makeStat(`Re ${track.retake}`));
  if (track.karaokeReady) stats.append(makeStat("\u6b4c\u3048\u308b", "ready"));
  if (isCurrent && state.playbackStatus === "loading") stats.append(makeStat("\u8aad\u307f\u8fbc\u307f\u4e2d", "loading"));
  if (isCurrent && state.playbackStatus === "playing") stats.append(makeStat("\u518d\u751f\u4e2d", "playing"));
  if (isCurrent && state.playbackStatus === "error") stats.append(makeStat("\u518d\u751f\u30a8\u30e9\u30fc", "error"));

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
  play.textContent = track.id === state.currentId && state.isPlaying ? "Ⅱ" : "▶";
  play.addEventListener("click", (event) => {
    event.stopPropagation();
    if (track.id === state.currentId && state.isPlaying) {
      els.audio.pause();
    } else {
      playTrack(track);
    }
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

  const factsSection = document.createElement("div");
  factsSection.className = "inline-section";
  const factsTitle = document.createElement("span");
  factsTitle.className = "inline-section-title";
  factsTitle.textContent = "\u66f2\u30c7\u30fc\u30bf";
  const facts = document.createElement("div");
  facts.className = "inline-facts";
  [
    track.highestNote,
    track.key !== "" && `key ${track.key}`,
    track.version,
    ...track.genreTags,
    track.fileName,
  ].filter(Boolean).forEach((item) => facts.append(makeFact(item)));
  factsSection.append(factsTitle, facts);
  detail.append(factsSection);

  const memberships = playlistMemberships(track.id);
  if (memberships.length) {
    const memberSection = document.createElement("div");
    memberSection.className = "inline-section";
    const memberTitle = document.createElement("span");
    memberTitle.className = "inline-section-title";
    memberTitle.textContent = "\u5165\u3063\u3066\u3044\u308b\u30ea\u30b9\u30c8";
    const memberWrap = document.createElement("div");
    memberWrap.className = "inline-memberships";
    memberships.forEach((playlist) => memberWrap.append(makeMembershipChip(track.id, playlist)));
    memberSection.append(memberTitle, memberWrap);
    detail.append(memberSection);
  }

  const actions = document.createElement("div");
  actions.className = "inline-actions";
  actions.append(makeAction(state.favorites.has(track.id) ? "★ \u304a\u6c17\u306b\u5165\u308a" : "☆ \u304a\u6c17\u306b\u5165\u308a", () => toggleFavorite(track.id)));
  if (state.playlists.length) {
    const select = document.createElement("select");
    select.setAttribute("aria-label", "\u8ffd\u52a0\u5148\u30ea\u30b9\u30c8");
    for (const playlist of state.playlists) {
      select.append(new Option(playlist.name, playlist.id));
    }
    actions.append(select);
    actions.append(makeAction("\u30ea\u30b9\u30c8\u306b\u8ffd\u52a0", () => addTrackToPlaylist(track.id, select.value)));
  } else {
    actions.append(makeAction("\u30ea\u30b9\u30c8\u3092\u4f5c\u308b", showPlaylistForm));
  }
  detail.append(actions);

  return detail;
}

function makeFact(text) {
  const item = document.createElement("span");
  item.className = "inline-fact";
  item.textContent = text;
  return item;
}

function makeMembershipChip(trackId, playlist) {
  const chip = document.createElement("span");
  chip.className = "membership-chip";
  chip.textContent = playlist.name;
  if (playlist.removable) {
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `${playlist.name}\u304b\u3089\u5916\u3059`);
    remove.addEventListener("click", () => removeTrackFromPlaylist(trackId, playlist.id));
    chip.append(remove);
  }
  return chip;
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
  if (state.view === "latest10") tracks = latestTracks(tracks, 10);
  if (state.view === "favorites") tracks = tracks.filter((track) => state.favorites.has(track.id));
  if (state.view === "recentlyPlayed") tracks = tracks.filter((track) => state.recent.includes(track.id));
  const playlist = state.playlists.find((item) => item.id === state.view);
  if (playlist) {
    const allowed = new Set(playlist.trackIds);
    tracks = tracks.filter((track) => allowed.has(track.id));
  }

  tracks.sort((a, b) => {
    if (state.sort === "title") return a.title.localeCompare(b.title, "ja");
    if (state.sort === "artist") return a.artist.localeCompare(b.artist, "ja") || a.title.localeCompare(b.title, "ja");
    if (state.sort === "favorite") return Number(state.favorites.has(b.id)) - Number(state.favorites.has(a.id));
    return dateValue(b.date) - dateValue(a.date) || a.title.localeCompare(b.title, "ja");
  });

  if (state.view === "recentlyPlayed") {
    tracks.sort((a, b) => state.recent.indexOf(a.id) - state.recent.indexOf(b.id));
  } else if (playlist) {
    tracks.sort((a, b) => playlist.trackIds.indexOf(a.id) - playlist.trackIds.indexOf(b.id));
  }

  return tracks;
}

function latestTracks(tracks, limit) {
  return [...tracks]
    .sort((a, b) => dateValue(b.date) - dateValue(a.date) || a.title.localeCompare(b.title, "ja"))
    .slice(0, limit);
}

function playTrack(track, { autoplay = true } = {}) {
  if (!track.url) return;
  state.currentId = track.id;
  setPlaybackStatus(autoplay ? "loading" : "ready", autoplay ? "\u8aad\u307f\u8fbc\u307f\u4e2d" : "");
  if (els.audio.src !== track.url) {
    els.audio.src = track.url;
    els.audio.load();
    prepareWaveform(track);
  }
  updatePlayerInfo(track);
  localStorage.setItem(LAST_TRACK_KEY, track.id);
  state.recent = [track.id, ...state.recent.filter((id) => id !== track.id)].slice(0, 50);
  localStorage.setItem(RECENT_KEY, JSON.stringify(state.recent));
  if (autoplay) {
    els.audio.play().catch(() => {
      setPlaybackStatus("error", "\u518d\u751f\u3092\u958b\u59cb\u3067\u304d\u307e\u305b\u3093\u3067\u3057\u305f");
      updatePlayerControls();
      render();
    });
  }
  render();
}

function playNext() {
  playAdjacent(1, { autoplay: true });
}

function playAdjacent(direction, { autoplay = true } = {}) {
  const list = filterTracks();
  if (!list.length) return;
  const currentIndex = list.findIndex((track) => track.id === state.currentId);
  let next;
  if (state.shuffle && list.length > 1) {
    const candidates = list.filter((track) => track.id !== state.currentId);
    next = candidates[Math.floor(Math.random() * candidates.length)];
  } else {
    const base = currentIndex === -1 ? 0 : currentIndex;
    next = list[base + direction];
  }
  if (next) playTrack(next, { autoplay });
}

function togglePlayback() {
  const current = getCurrentTrack();
  if (!current) {
    const first = filterTracks()[0];
    if (first) playTrack(first);
    return;
  }
  if (els.audio.paused) {
    setPlaybackStatus("loading", "\u8aad\u307f\u8fbc\u307f\u4e2d");
    els.audio.play().catch(() => {
      setPlaybackStatus("error", "\u518d\u751f\u3092\u958b\u59cb\u3067\u304d\u307e\u305b\u3093\u3067\u3057\u305f");
      updatePlayerControls();
      render();
    });
  } else {
    els.audio.pause();
  }
}

function getCurrentTrack() {
  return state.tracks.find((track) => track.id === state.currentId);
}

function restoreLastTrack() {
  const id = localStorage.getItem(LAST_TRACK_KEY);
  const track = state.tracks.find((item) => item.id === id);
  if (track) {
    state.currentId = track.id;
    els.audio.src = track.url;
    setPlaybackStatus("ready", "");
    updatePlayerInfo(track);
    prepareWaveform(track);
    render();
  }
}

function updatePlayerInfo(track) {
  els.nowTitle.textContent = track.title;
  els.nowArtist.textContent = [track.artist, track.version].filter(Boolean).join(" / ") || track.url;
  updatePlayerMeta(track);
}

function updatePlayerMeta(track = getCurrentTrack()) {
  if (!track) {
    els.nowMeta.textContent = state.playbackMessage;
    return;
  }
  const meta = [starText(track.quality)];
  if (Number(track.retake) > 0) meta.push(`Re ${track.retake}`);
  if (track.karaokeReady) meta.push("\u6b4c\u3048\u308b");
  if (state.playbackMessage) meta.unshift(state.playbackMessage);
  els.nowMeta.textContent = meta.filter(Boolean).join(" · ");
}

function setPlaybackStatus(status, message = "") {
  state.playbackStatus = status;
  state.playbackMessage = message;
  updatePlayerMeta();
}

function updatePlayerControls() {
  els.playerPlay.textContent = state.playbackStatus === "loading" ? "…" : state.isPlaying ? "Ⅱ" : "▶";
  els.playerPlay.setAttribute("aria-label", state.isPlaying ? "\u4e00\u6642\u505c\u6b62" : "\u518d\u751f");
  els.shuffle.classList.toggle("active", state.shuffle);
}

function updateProgress() {
  const duration = els.audio.duration;
  const current = els.audio.currentTime;
  els.currentTime.textContent = formatClock(current);
  els.durationTime.textContent = Number.isFinite(duration) ? formatClock(duration) : "0:00";
  if (!state.isSeeking && Number.isFinite(duration) && duration > 0) {
    const progress = current / duration;
    els.seek.value = Math.round(progress * Number(els.seek.max || 1000));
    drawWaveform(progress);
  }
}

function toggleFavorite(id) {
  if (state.favorites.has(id)) state.favorites.delete(id);
  else state.favorites.add(id);
  localStorage.setItem(FAVORITES_KEY, JSON.stringify([...state.favorites]));
  render();
}

function showPlaylistForm() {
  els.playlistForm.hidden = !els.playlistForm.hidden;
  if (!els.playlistForm.hidden) els.playlistName.focus();
}

function createPlaylist(name) {
  if (!name?.trim()) return;
  const previousView = state.view;
  const playlist = {
    id: `playlist-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name: name.trim(),
    trackIds: [],
  };
  state.playlists.push(playlist);
  savePlaylists();
  state.view = previousView;
  renderPlaylistOptions();
  els.playlistName.value = "";
  els.playlistForm.hidden = true;
  render();
}

function addTrackToPlaylist(trackId, playlistId) {
  const playlist = state.playlists.find((item) => item.id === playlistId);
  if (!playlist) return;
  if (!playlist.trackIds.includes(trackId)) playlist.trackIds.push(trackId);
  savePlaylists();
  renderPlaylistOptions();
  render();
}

function removeTrackFromPlaylist(trackId, playlistId) {
  const playlist = state.playlists.find((item) => item.id === playlistId);
  if (!playlist) return;
  playlist.trackIds = playlist.trackIds.filter((id) => id !== trackId);
  savePlaylists();
  renderPlaylistOptions();
  render();
}

function deleteCurrentPlaylist() {
  const playlist = state.playlists.find((item) => item.id === state.view);
  if (!playlist) return;
  state.playlists = state.playlists.filter((item) => item.id !== playlist.id);
  state.view = "all";
  savePlaylists();
  renderPlaylistOptions();
  render();
}

function playlistMemberships(trackId) {
  const memberships = [];
  if (state.favorites.has(trackId)) {
    memberships.push({ id: "favorites", name: "\u304a\u6c17\u306b\u5165\u308a", removable: false });
  }
  for (const playlist of state.playlists) {
    if (playlist.trackIds.includes(trackId)) {
      memberships.push({ id: playlist.id, name: playlist.name, removable: true });
    }
  }
  return memberships;
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

function readPlaylists() {
  const value = readJson(PLAYLISTS_KEY);
  if (!Array.isArray(value)) return [];
  return value
    .filter((playlist) => playlist?.id && playlist?.name && Array.isArray(playlist.trackIds))
    .map((playlist) => ({
      id: String(playlist.id),
      name: String(playlist.name),
      trackIds: playlist.trackIds.map(String),
    }));
}

function savePlaylists() {
  localStorage.setItem(PLAYLISTS_KEY, JSON.stringify(state.playlists));
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

function prepareWaveform(track) {
  state.waveform = makeLightweightWaveform(track);
  drawWaveform(progressRatio());
}

function makeLightweightWaveform(track) {
  const seedText = [
    track?.id,
    track?.title,
    track?.artist,
    track?.version,
    track?.fileName,
  ].filter(Boolean).join("|") || "sak_Uta";
  let seed = 0;
  for (const char of seedText) seed = (seed * 31 + char.charCodeAt(0)) >>> 0;
  return Array.from({ length: 96 }, (_, index) => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const random = seed / 4294967295;
    const swell = Math.sin(index * 0.24) ** 2;
    const pulse = Math.sin(index * 0.71 + random * 2) ** 2;
    return 0.16 + random * 0.22 + swell * 0.24 + pulse * 0.12;
  });
}

function drawWaveform(progress = progressRatio()) {
  const canvas = els.waveCanvas;
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#f1eee7";
  ctx.fillRect(0, 0, width, height);

  const bars = state.waveform.length ? state.waveform : Array.from({ length: 72 }, (_, index) => 0.18 + 0.22 * Math.sin(index * 0.65) ** 2);
  const gap = 2;
  const barWidth = Math.max(2, (width - gap * (bars.length - 1)) / bars.length);
  const activeX = width * Math.max(0, Math.min(1, progress || 0));

  bars.forEach((value, index) => {
    const x = index * (barWidth + gap);
    const barHeight = Math.max(4, value * (height - 10));
    const y = (height - barHeight) / 2;
    ctx.fillStyle = x <= activeX ? "#126b5a" : "#c9c2b6";
    ctx.fillRect(x, y, barWidth, barHeight);
  });
}

function progressRatio() {
  const duration = els.audio.duration;
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  return els.audio.currentTime / duration;
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

function formatClock(value) {
  if (!Number.isFinite(value)) return "0:00";
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
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
