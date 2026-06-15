const API_URL = "https://script.google.com/macros/s/AKfycbxNHOf1ueQvlaOSZSgxSt8_Nq5CDwQVxUWLlT64dpSy3ha8NBFZH4JX_2pEEdB1wefQdw/exec";
const WAV_UPLOAD_URL = "https://sakurauta-wav-upload.sakuraz0079.workers.dev";
const CACHE_KEY = "utawav.tracks";
const FAVORITES_KEY = "utawav.favorites";
const RECENT_KEY = "utawav.recent";
const LAST_TRACK_KEY = "utawav.lastTrack";
const DAILY_PICK_HISTORY_KEY = "utawav.dailyPickHistory";
const SEARCH_HISTORY_KEY = "utawav.searchHistory";
const EDIT_TOKEN_KEY = "utawav.editToken";
const UPLOAD_TOKEN_KEY = "utawav.uploadToken";
const SHUFFLE_KEY = "utawav.shuffle";
const REPEAT_KEY = "utawav.repeat";
const PLAYLISTS_KEY = "utawav.playlists";
const KARAOKE_FILTER = "__karaoke_ready";
const PAGE_SIZE = 20;
const EXCLUDED_GENRE_TAGS = new Set(["mastering"]);
const PARAMS = new URLSearchParams(location.search);
const UPDATE_CHECK_INTERVAL = 60 * 60 * 1000;

let waitingServiceWorker = null;
let isApplyingUpdate = false;

const state = {
  tracks: [],
  query: "",
  sort: "recent",
  view: "all",
  tag: "",
  currentId: "",
  detailId: "",
  dailyPickId: "",
  dailyLineNonce: 0,
  editId: "",
  savingEditId: "",
  editError: "",
  editStatus: null,
  addOpen: PARAMS.has("add"),
  addStatus: null,
  addError: "",
  addingTrack: false,
  isPlaying: false,
  isSeeking: false,
  playbackStatus: "idle",
  playbackMessage: "",
  shuffle: localStorage.getItem(SHUFFLE_KEY) === "true",
  repeat: localStorage.getItem(REPEAT_KEY) === "true",
  compactPlayer: true,
  playerManualCompact: false,
  waveform: [],
  page: 1,
  favorites: readSet(FAVORITES_KEY),
  recent: readArray(RECENT_KEY),
  searchHistory: readArray(SEARCH_HISTORY_KEY),
  playlists: readPlaylists(),
};

const els = {
  appShell: document.querySelector(".app-shell"),
  player: document.querySelector("#player"),
  search: document.querySelector("#searchInput"),
  clearSearch: document.querySelector("#clearSearchButton"),
  searchHistory: document.querySelector("#searchHistoryChips"),
  sort: document.querySelector("#sortSelect"),
  view: document.querySelector("#viewSelect"),
  tags: document.querySelector("#tagChips"),
  count: document.querySelector("#countLabel"),
  sync: document.querySelector("#syncLabel"),
  dailyPick: document.querySelector("#dailyPick"),
  list: document.querySelector("#trackList"),
  template: document.querySelector("#trackTemplate"),
  audio: document.querySelector("#audio"),
  nowTitle: document.querySelector("#nowTitle"),
  nowArtist: document.querySelector("#nowArtist"),
  nowMeta: document.querySelector("#nowMeta"),
  playbackStatus: document.querySelector("#playbackStatus"),
  seek: document.querySelector("#seekRange"),
  waveCanvas: document.querySelector("#waveCanvas"),
  currentTime: document.querySelector("#currentTime"),
  durationTime: document.querySelector("#durationTime"),
  playerPrev: document.querySelector("#playerPrevButton"),
  playerPlay: document.querySelector("#playerPlayButton"),
  playerNext: document.querySelector("#playerNextButton"),
  compactPlayer: document.querySelector("#compactPlayerButton"),
  repeat: document.querySelector("#repeatButton"),
  shuffle: document.querySelector("#shuffleButton"),
  refresh: document.querySelector("#refreshButton"),
  addTrack: document.querySelector("#addTrackButton"),
  addTrackPanel: document.querySelector("#addTrackPanel"),
  newPlaylist: document.querySelector("#newPlaylistButton"),
  deletePlaylist: document.querySelector("#deletePlaylistButton"),
  playlistChips: document.querySelector("#playlistChips"),
  playlistForm: document.querySelector("#playlistForm"),
  playlistName: document.querySelector("#playlistNameInput"),
  prevPage: document.querySelector("#prevPageButton"),
  nextPage: document.querySelector("#nextPageButton"),
  page: document.querySelector("#pageLabel"),
  updateNotice: document.querySelector("#updateNotice"),
  applyUpdate: document.querySelector("#applyUpdateButton"),
  dismissUpdate: document.querySelector("#dismissUpdateButton"),
};

init();

async function init() {
  bindEvents();
  setupMediaSession();
  updateClearSearchButton();
  renderSearchHistory();
  renderPlaylistOptions();
  await loadTracks();
  restoreLastTrack();
  state.compactPlayer = true;
  state.playerManualCompact = false;
  updatePlayerCompact();
  updatePlayerControls();
  drawWaveform();
  setupServiceWorkerUpdates();
}

function bindEvents() {
  els.applyUpdate.addEventListener("click", applyServiceWorkerUpdate);
  els.dismissUpdate.addEventListener("click", () => {
    els.updateNotice.hidden = true;
  });
  els.search.addEventListener("input", () => {
    state.query = els.search.value.trim().toLowerCase();
    state.page = 1;
    updateClearSearchButton();
    render();
  });
  els.search.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commitSearchQuery();
      els.search.blur();
    }
  });
  els.search.addEventListener("blur", commitSearchQuery);
  els.clearSearch.addEventListener("click", () => {
    els.search.value = "";
    state.query = "";
    state.page = 1;
    updateClearSearchButton();
    render();
    els.search.focus();
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

  els.refresh.addEventListener("click", () => {
    loadTracks({ force: true });
  });
  els.addTrack.addEventListener("click", () => {
    state.addOpen = !state.addOpen;
    state.addError = "";
    state.addStatus = null;
    render();
  });
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
  els.compactPlayer.addEventListener("click", () => {
    state.compactPlayer = !state.compactPlayer;
    state.playerManualCompact = true;
    updatePlayerCompact();
  });
  els.repeat.addEventListener("click", () => {
    state.repeat = !state.repeat;
    localStorage.setItem(REPEAT_KEY, String(state.repeat));
    updatePlayerControls();
  });
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
  els.audio.addEventListener("ended", () => {
    if (state.repeat) {
      els.audio.currentTime = 0;
      els.audio.play().catch(() => {});
    } else {
      playAdjacent(1, { autoplay: true });
    }
  });
  els.audio.addEventListener("loadstart", () => setPlaybackStatus("loading", "\u8aad\u307f\u8fbc\u307f\u4e2d"));
  els.audio.addEventListener("waiting", () => setPlaybackStatus("loading", "\u8aad\u307f\u8fbc\u307f\u4e2d"));
  els.audio.addEventListener("stalled", () => setPlaybackStatus("loading", "\u901a\u4fe1\u3092\u5f85\u3063\u3066\u3044\u307e\u3059"));
  els.audio.addEventListener("canplay", () => {
    if (state.playbackStatus === "loading") setPlaybackStatus("ready", "");
  });
  els.audio.addEventListener("playing", () => setPlaybackStatus("playing", ""));
  els.audio.addEventListener("play", () => {
    state.isPlaying = true;
    updateMediaSessionPlaybackState("playing");
    expandPlayerForPlayback();
    updatePlayerControls();
    render();
  });
  els.audio.addEventListener("pause", () => {
    state.isPlaying = false;
    updateMediaSessionPlaybackState("paused");
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
  if (PARAMS.has("demo")) {
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
    await reloadTracksFromApi({ status: "\u66f4\u65b0\u4e2d", successPrefix: "\u66f4\u65b0" });
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

async function submitMetadataEdit(track, form) {
  document.activeElement?.blur?.();
  const fields = metadataFieldsFromForm(form);
  state.savingEditId = track.id;
  state.editError = "";
  setEditStatus(track.id, "saving", "保存中");
  render();

  try {
    const result = await saveTrackMetadata(track.id, fields);
    applyMetadataUpdate(track.id, fields);
    state.editId = "";
    state.savingEditId = "";
    state.editError = "";
    setEditStatus(track.id, "syncing", result?.opaque ? "保存リクエスト送信・同期確認中" : "保存・同期確認中");
    state.detailId = track.id;
    keepTrackInView(track.id);
    render();
    try {
      const tracks = await reloadTracksFromApi({ status: "同期確認中", successPrefix: "保存・同期" });
      if (!tracks.some((item) => item.id === track.id)) {
        setEditStatus(track.id, "warning", `保存済み・曲が見つかりません ${formatTime(new Date())}`);
        render();
      } else {
        setEditStatus(track.id, "success", `保存・同期完了 ${formatTime(new Date())}`);
        state.detailId = track.id;
        keepTrackInView(track.id);
        render();
        scrollTrackIntoView(track.id);
      }
    } catch (syncError) {
      const reason = syncError?.message ? `: ${syncError.message}` : "";
      setEditStatus(track.id, "warning", `保存済み・同期未確認${reason}`);
      state.detailId = track.id;
      keepTrackInView(track.id);
      render();
      scrollTrackIntoView(track.id);
    }
  } catch (error) {
    state.savingEditId = "";
    state.editError = error?.message ? `保存できませんでした: ${error.message}` : "保存できませんでした";
    setEditStatus(track.id, "error", state.editError);
    state.detailId = track.id;
    render();
    scrollTrackIntoView(track.id);
  }
}

async function submitTrackAdd(form) {
  document.activeElement?.blur?.();
  const fields = addTrackFieldsFromForm(form);
  if (!fields.title) {
    setAddFormFeedback(form, "error", "曲名を入力してください");
    return;
  }
  if (!fields.url) {
    setAddFormFeedback(form, "error", "WAV URLを入力してください");
    return;
  }

  state.addingTrack = true;
  state.addError = "";
  state.addStatus = { type: "saving", text: "曲を追加中" };
  els.sync.textContent = "曲を追加中";
  setAddFormSaving(form, true);
  setAddFormFeedback(form, "saving", "曲を追加中");

  try {
    const result = await saveNewTrack(fields);
    state.addStatus = { type: "syncing", text: result?.opaque ? "追加リクエスト送信・同期確認中" : "追加・同期確認中" };
    els.sync.textContent = state.addStatus.text;
    setAddFormFeedback(form, "syncing", state.addStatus.text);

    const tracks = await reloadTracksFromApi({ status: "追加の同期確認中", successPrefix: "追加・同期" });
    const addedId = result?.data?.id || result?.id;
    const added = tracks.find((track) => track.id === addedId)
      || tracks.find((track) => track.url === fields.url)
      || tracks.find((track) => track.title === fields.title && track.artist === fields.artist);

    const mode = result?.data?.mode || result?.mode;
    const doneLabel = mode === "updated" ? "更新" : "追加";
    state.addingTrack = false;
    state.addOpen = false;
    state.addStatus = { type: "success", text: `${doneLabel}完了 ${formatTime(new Date())}` };
    if (added) {
      setEditStatus(added.id, "success", `${doneLabel}完了・内容を確認できます ${formatTime(new Date())}`);
      state.detailId = added.id;
      state.page = pageForTrack(added.id, filterTracks());
      keepTrackInView(added.id);
    } else {
      els.sync.textContent = state.addStatus.text;
    }
    render();
    if (added) scrollTrackIntoView(added.id);
  } catch (error) {
    state.addingTrack = false;
    state.addError = error?.message ? `追加できませんでした: ${error.message}` : "追加できませんでした";
    state.addStatus = { type: "error", text: state.addError };
    els.sync.textContent = state.addError;
    setAddFormSaving(form, false);
    setAddFormFeedback(form, "error", state.addError);
  }
}

async function reloadTracksFromApi({ status = "\u540c\u671f\u78ba\u8a8d\u4e2d", successPrefix = "\u540c\u671f" } = {}) {
  els.sync.textContent = status;
  const payload = await fetchApiPayload();
  const rows = extractRows(payload);
  state.tracks = rows.map(normalizeTrack).filter(Boolean);
  localStorage.setItem(CACHE_KEY, JSON.stringify(state.tracks));

  const current = getCurrentTrack();
  if (current) updatePlayerInfo(current);

  els.sync.textContent = `${successPrefix} ${formatTime(new Date())}`;
  render();
  return state.tracks;
}

function setEditStatus(id, type, text) {
  state.editStatus = { id, type, text };
  els.sync.textContent = text;
}

function metadataFieldsFromForm(form) {
  const data = new FormData(form);
  const retake = Math.max(0, Number.parseInt(data.get("retake_count") || "0", 10) || 0);
  return {
    tags: String(data.get("tags") || "").trim(),
    karaoke_ready: data.has("karaoke_ready"),
    highest_note: String(data.get("highest_note") || "").trim(),
    key: String(data.get("key") || "").trim() || "±0",
    quality_score: String(data.get("quality_score") || "").trim(),
    retake_count: retake,
    memo: String(data.get("memo") || "").trim(),
  };
}

function addTrackFieldsFromForm(form) {
  const data = new FormData(form);
  const retake = Math.max(0, Number.parseInt(data.get("retake_count") || "0", 10) || 0);
  const url = String(data.get("url") || "").trim();
  const category = String(data.get("category") || "").trim();
  return {
    title: String(data.get("title") || "").trim(),
    artist: String(data.get("artist") || "").trim(),
    url,
    fileName: String(data.get("fileName") || "").trim() || fileNameFromUrl(url),
    category,
    version: category,
    tags: String(data.get("tags") || "").trim(),
    karaoke_ready: data.has("karaoke_ready"),
    highest_note: String(data.get("highest_note") || "").trim(),
    key: String(data.get("key") || "").trim() || "±0",
    quality_score: String(data.get("quality_score") || "").trim(),
    retake_count: retake,
    memo: String(data.get("memo") || "").trim(),
  };
}

async function saveTrackMetadata(id, fields) {
  if (PARAMS.has("demo")) {
    return { ok: true, demo: true };
  }

  const body = new URLSearchParams({
    action: "updateTrack",
    id: String(id),
    payload: JSON.stringify(fields),
  });
  const editToken = await getEditToken();
  if (!editToken) throw new Error("編集パスコードが必要です");
  if (editToken) body.set("token", editToken);

  try {
    const response = await fetch(API_URL, { method: "POST", body });
    if (!response.ok) throw new Error(`API error ${response.status}`);
    const text = await response.text();
    const payload = text ? JSON.parse(text) : {};
    if (payload?.ok === false) throw new Error(payload.error || "API save error");
    return payload;
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    await fetch(API_URL, { method: "POST", mode: "no-cors", body });
    return { ok: true, opaque: true };
  }
}

async function saveNewTrack(fields) {
  if (PARAMS.has("demo")) {
    return { ok: true, demo: true, data: { id: `demo-${Date.now()}` } };
  }

  const body = new URLSearchParams({
    action: "addTrack",
    payload: JSON.stringify(fields),
  });
  const editToken = await getEditToken();
  if (!editToken) throw new Error("編集パスコードが必要です");
  if (editToken) body.set("token", editToken);

  try {
    const response = await fetch(API_URL, { method: "POST", body });
    if (!response.ok) throw new Error(`API error ${response.status}`);
    const text = await response.text();
    const payload = text ? JSON.parse(text) : {};
    if (payload?.ok === false) throw new Error(payload.error || "API add error");
    return payload;
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    await fetch(API_URL, { method: "POST", mode: "no-cors", body });
    return { ok: true, opaque: true };
  }
}

async function archiveTrack(track) {
  if (!track?.id) return;
  const confirmed = window.confirm(`${track.title} を一覧から非表示にしますか？\nスプレッドシート上では archived として残ります。`);
  if (!confirmed) return;

  state.savingEditId = track.id;
  state.editError = "";
  setEditStatus(track.id, "saving", "アーカイブ中");
  render();

  try {
    await requestArchiveTrack(track.id);
    state.tracks = state.tracks.filter((item) => item.id !== track.id);
    localStorage.setItem(CACHE_KEY, JSON.stringify(state.tracks));
    if (state.currentId === track.id) {
      els.audio.pause();
      els.audio.removeAttribute("src");
      state.currentId = "";
      state.isPlaying = false;
      updatePlayerInfo({ title: "曲を選択", artist: "一覧から再生できます", version: "", quality: "", retake: "", karaokeReady: false });
    }
    state.detailId = "";
    state.editId = "";
    state.savingEditId = "";
    setEditStatus(track.id, "success", `アーカイブ完了 ${formatTime(new Date())}`);
    await reloadTracksFromApi({ status: "アーカイブの同期確認中", successPrefix: "アーカイブ・同期" });
  } catch (error) {
    state.savingEditId = "";
    state.editError = error?.message ? `アーカイブできませんでした: ${error.message}` : "アーカイブできませんでした";
    setEditStatus(track.id, "error", state.editError);
    state.detailId = track.id;
    render();
    scrollTrackIntoView(track.id);
  }
}

async function requestArchiveTrack(id) {
  if (PARAMS.has("demo")) {
    return { ok: true, demo: true };
  }

  const body = new URLSearchParams({
    action: "archiveTrack",
    id: String(id),
    payload: "{}",
  });
  const editToken = await getEditToken();
  if (!editToken) throw new Error("編集パスコードが必要です");
  if (editToken) body.set("token", editToken);

  try {
    const response = await fetch(API_URL, { method: "POST", body });
    if (!response.ok) throw new Error(`API error ${response.status}`);
    const text = await response.text();
    const payload = text ? JSON.parse(text) : {};
    if (payload?.ok === false) throw new Error(payload.error || "API archive error");
    return payload;
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    await fetch(API_URL, { method: "POST", mode: "no-cors", body });
    return { ok: true, opaque: true };
  }
}

async function getEditToken() {
  let token = localStorage.getItem(EDIT_TOKEN_KEY) || "";
  if (!token) {
    token = await requestSecretInput("編集パスコード", "スプレッドシートを更新するためのパスコードを入力してください");
    if (token) localStorage.setItem(EDIT_TOKEN_KEY, token);
  }
  return token;
}

async function getUploadToken() {
  let token = localStorage.getItem(UPLOAD_TOKEN_KEY) || "";
  if (!token) {
    token = await requestSecretInput("R2アップロード用トークン", "Cloudflare Workerに設定したUPLOAD_TOKENを入力してください");
    if (token) localStorage.setItem(UPLOAD_TOKEN_KEY, token);
  }
  return token;
}

function requestSecretInput(title, message) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "secret-dialog-backdrop";

    const dialog = document.createElement("form");
    dialog.className = "secret-dialog";

    const heading = document.createElement("strong");
    heading.textContent = title;

    const text = document.createElement("p");
    text.textContent = message;

    const input = document.createElement("input");
    input.type = "password";
    input.autocomplete = "off";
    input.inputMode = "text";

    const actions = document.createElement("div");
    actions.className = "secret-dialog-actions";

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "キャンセル";

    const ok = document.createElement("button");
    ok.type = "submit";
    ok.textContent = "OK";

    const close = (value) => {
      overlay.remove();
      resolve(value);
    };

    cancel.addEventListener("click", () => close(""));
    dialog.addEventListener("submit", (event) => {
      event.preventDefault();
      close(input.value.trim());
    });

    actions.append(cancel, ok);
    dialog.append(heading, text, input, actions);
    overlay.append(dialog);
    document.body.append(overlay);
    input.focus();
  });
}

function applyMetadataUpdate(id, fields) {
  const track = state.tracks.find((item) => item.id === id);
  if (!track) return;

  const genreTags = normalizeTags(fields.tags);
  track.genreTags = genreTags;
  track.tags = [track.category, ...genreTags].filter(Boolean);
  track.karaokeReady = Boolean(fields.karaoke_ready);
  track.highestNote = fields.highest_note || "";
  track.key = fields.key || "±0";
  track.quality = fields.quality_score || "";
  track.retake = fields.retake_count ? String(fields.retake_count) : "";
  track.memo = fields.memo || "";
  track.searchText = buildTrackSearchText(track);
  localStorage.setItem(CACHE_KEY, JSON.stringify(state.tracks));

  if (state.currentId === track.id) {
    updatePlayerInfo(track);
  }
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
  if (parseBoolean(raw.archived ?? raw.deleted ?? raw.hidden)) return null;
  const title = pick(raw, ["title", "song", "name"]);
  const artist = pick(raw, ["artist", "original_artist"]);
  const category = normalizeCategory(pick(raw, ["category", "version", "mix", "master", "mastering"]));
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

  const track = {
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
  };
  track.searchText = buildTrackSearchText(track);
  return track;
}

function render() {
  renderTags();
  renderDailyPick();
  renderAddTrackPanel();
  const tracks = filterTracks();
  const pageCount = Math.max(1, Math.ceil(tracks.length / PAGE_SIZE));
  state.page = Math.min(Math.max(1, state.page), pageCount);
  const start = (state.page - 1) * PAGE_SIZE;
  const pageTracks = tracks.slice(start, start + PAGE_SIZE);

  els.count.textContent = [`${tracks.length} / ${state.tracks.length} \u66f2`, ...activeFilterLabels()].join(" \u00b7 ");
  els.page.textContent = `${state.page} / ${pageCount}`;
  els.prevPage.disabled = state.page <= 1;
  els.nextPage.disabled = state.page >= pageCount;
  els.prevPage.parentElement.hidden = tracks.length <= PAGE_SIZE;
  els.list.replaceChildren();

  if (!pageTracks.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    const message = document.createElement("p");
    message.textContent = "\u8a72\u5f53\u3059\u308b\u66f2\u304c\u3042\u308a\u307e\u305b\u3093";
    empty.append(message);
    if (state.query || state.tag) {
      const clear = document.createElement("button");
      clear.type = "button";
      clear.textContent = "\u691c\u7d22\u30fb\u7d5e\u308a\u8fbc\u307f\u3092\u30af\u30ea\u30a2";
      clear.addEventListener("click", clearSearchAndTagFilters);
      empty.append(clear);
    }
    els.list.append(empty);
    return;
  }

  for (const track of pageTracks) {
    els.list.append(renderTrack(track));
  }
}

function renderAddTrackPanel() {
  if (!els.addTrackPanel) return;
  els.addTrack.classList.toggle("active", state.addOpen);
  els.addTrackPanel.hidden = !state.addOpen;
  if (!state.addOpen) {
    els.addTrackPanel.replaceChildren();
    return;
  }

  const form = document.createElement("form");
  form.className = "add-track-form";

  const heading = document.createElement("div");
  heading.className = "add-track-heading";
  const title = document.createElement("strong");
  title.textContent = "新しい曲";
  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "閉じる";
  close.addEventListener("click", () => {
    state.addOpen = false;
    state.addError = "";
    state.addStatus = null;
    render();
  });
  heading.append(title, close);
  form.append(heading);

  form.append(makeWavFileInput());
  form.append(makeEditInput("title", "曲名", "", "曲名"));
  form.append(makeEditInput("artist", "アーティスト", "", "アーティスト"));
  const urlField = makeEditInput("url", "WAV URL", "", "https://.../song.wav", "url");
  urlField.classList.add("edit-field-wide");
  form.append(urlField);
  const fileNameField = makeEditInput("fileName", "ファイル名", "", "song.wav");
  fileNameField.classList.add("edit-field-wide");
  form.append(fileNameField);
  form.append(makeEditInput("category", "バージョン", "", "Mastering-2"));
  form.append(makeEditInput("retake_count", "歌い直し回数", "0", "0", "number"));
  form.append(makeAddTrackDiagnosis());

  form.append(makeEditHeading("歌う情報"));
  form.append(makeRatingInput(""));
  form.append(makeEditCheckbox("karaoke_ready", "🎤 歌える", false));
  form.append(makeEditInput("highest_note", "最高音", "", "mid2G#"));
  form.append(makeKeySelect("±0"));

  form.append(makeEditHeading("分類・メモ"));
  form.append(makeGenreInput([]));
  const memoLabel = document.createElement("label");
  memoLabel.className = "edit-field edit-field-wide";
  memoLabel.textContent = "メモ";
  const memo = document.createElement("textarea");
  memo.name = "memo";
  memo.rows = 3;
  memoLabel.append(memo);
  form.append(memoLabel);

  if (state.addStatus?.text) {
    const status = document.createElement("p");
    status.className = `add-form-feedback edit-sync-status ${state.addStatus.type || "info"}`;
    status.textContent = state.addStatus.text;
    form.append(status);
  }
  if (state.addError) {
    const error = document.createElement("p");
    error.className = "edit-error";
    error.textContent = state.addError;
    form.append(error);
  }

  const actions = document.createElement("div");
  actions.className = "edit-actions";
  const save = document.createElement("button");
  save.type = "submit";
  save.textContent = state.addingTrack ? "追加中" : "追加";
  save.disabled = state.addingTrack;
  actions.append(save);
  form.append(actions);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    submitTrackAdd(form);
  });
  form.addEventListener("input", () => updateAddTrackDiagnosis(form));
  updateAddTrackDiagnosis(form);

  els.addTrackPanel.replaceChildren(form);
}

function makeWavFileInput() {
  const field = document.createElement("label");
  field.className = "edit-field edit-field-wide wav-file-field";
  field.textContent = "WAVを選択";
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".wav,audio/wav,audio/wave,audio/x-wav";
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (!file) return;
    applyParsedFileName(field.closest("form"), file.name);
  });
  const upload = document.createElement("button");
  upload.type = "button";
  upload.className = "wav-upload-button";
  upload.textContent = "R2へアップロード";
  upload.addEventListener("click", () => uploadSelectedWav(field.closest("form"), input, upload));
  const hint = document.createElement("small");
  hint.className = "wav-file-message";
  hint.textContent = "ファイル名から曲名・Re・バージョンを自動入力し、R2へ保存できます";
  field.append(input, upload, hint);
  return field;
}

async function uploadSelectedWav(form, input, button) {
  const file = input?.files?.[0];
  if (!file) {
    setAddFormFeedback(form, "error", "先にWAVを選択してください");
    return;
  }

  const token = await getUploadToken();
  if (!token) {
    setAddFormFeedback(form, "error", "アップロード用トークンが必要です");
    return;
  }

  const fileName = form?.elements?.fileName?.value || file.name;
  setUploadButtonState(button, true);
  setAddFormFeedback(form, "saving", "R2へアップロード中");

  try {
    const body = new FormData();
    body.set("file", file);
    body.set("fileName", fileName);
    const response = await fetch(WAV_UPLOAD_URL, {
      method: "POST",
      headers: { "X-Upload-Token": token },
      body,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok === false) {
      if (response.status === 401 || payload?.error === "Invalid upload token") {
        localStorage.removeItem(UPLOAD_TOKEN_KEY);
        throw new Error("アップロード用トークンが違います。次回もう一度入力してください");
      }
      throw new Error(payload?.error || `Upload error ${response.status}`);
    }
    setFormValue(form, "url", payload.url || "");
    setFormValue(form, "fileName", payload.fileName || fileName);
    setAddFormFeedback(form, "success", "R2アップロード完了・WAV URLを入力しました");
  } catch (error) {
    setAddFormFeedback(form, "error", error?.message ? `アップロードできませんでした: ${error.message}` : "アップロードできませんでした");
  } finally {
    setUploadButtonState(button, false);
  }
}

function setUploadButtonState(button, uploading) {
  if (!button) return;
  button.disabled = Boolean(uploading);
  button.textContent = uploading ? "アップロード中" : "R2へアップロード";
}

function applyParsedFileName(form, fileName) {
  const parsed = parseSongFileName(fileName);
  setFormValue(form, "fileName", fileName);
  if (parsed.artist) setFormValue(form, "artist", parsed.artist);
  if (parsed.title) setFormValue(form, "title", parsed.title);
  if (parsed.version) setFormValue(form, "category", parsed.version);
  setFormValue(form, "retake_count", parsed.retake ? String(parsed.retake) : "0");
  const message = form.querySelector(".wav-file-message");
  if (message) {
    message.textContent = parsed.artist && parsed.title
      ? `${parsed.artist} / ${parsed.title} を読み取りました`
      : "ファイル名を読み取りました";
  }
  state.addError = "";
  updateAddTrackDiagnosis(form);
}

function setFormValue(form, name, value) {
  const field = form?.elements?.[name];
  if (field) field.value = value;
}

function setAddFormSaving(form, saving) {
  const save = form?.querySelector("button[type='submit']");
  if (!save) return;
  save.disabled = Boolean(saving);
  save.textContent = saving ? "追加中" : "追加";
}

function setAddFormFeedback(form, type, text) {
  state.addError = type === "error" ? text : "";
  state.addStatus = text ? { type, text } : null;
  if (text) els.sync.textContent = text;

  let status = form?.querySelector(".add-form-feedback");
  if (!status) {
    status = document.createElement("p");
    status.className = "add-form-feedback edit-sync-status";
    const actions = form?.querySelector(".edit-actions");
    if (actions) form.insertBefore(status, actions);
    else form?.append(status);
  }

  status.className = `add-form-feedback edit-sync-status ${type || "info"}`;
  status.textContent = text || "";
  status.hidden = !text;
}

function makeAddTrackDiagnosis() {
  const panel = document.createElement("div");
  panel.className = "add-track-diagnosis edit-field-wide";

  const retake = document.createElement("span");
  retake.dataset.addDiagnosis = "retake";

  const mode = document.createElement("strong");
  mode.dataset.addDiagnosis = "mode";

  const target = document.createElement("small");
  target.dataset.addDiagnosis = "target";

  panel.append(retake, mode, target);
  return panel;
}

function updateAddTrackDiagnosis(form) {
  const panel = form?.querySelector(".add-track-diagnosis");
  if (!panel) return;

  const fields = addTrackFieldsFromForm(form);
  const retake = Number(fields.retake_count) || 0;
  const existing = findBaseTrackForAdd(fields);
  const isOverwrite = retake === 0 && Boolean(existing);

  panel.querySelector("[data-add-diagnosis='retake']").textContent = retake > 0
    ? `歌い直し: Re${retake}`
    : "歌い直し: なし";
  panel.querySelector("[data-add-diagnosis='mode']").textContent = isOverwrite
    ? "保存時: 既存曲を上書き"
    : "保存時: 新規追加";
  panel.querySelector("[data-add-diagnosis='mode']").className = isOverwrite ? "overwrite" : "create";
  panel.querySelector("[data-add-diagnosis='target']").textContent = isOverwrite
    ? `対象: ${existing.artist || "アーティスト未設定"} / ${existing.title}`
    : "Re付き、または同じ曲が見つからない場合は新規登録します";

  if (isOverwrite) {
    applyExistingTrackFields(form, existing);
  } else if (form.dataset.loadedExistingId) {
    clearExistingTrackFields(form);
  }
}

function findBaseTrackForAdd(fields) {
  const title = comparableText(fields.title);
  const artist = comparableText(fields.artist);
  if (!title) return null;
  return state.tracks.find((track) => {
    if (Number(track.retake) > 0) return false;
    if (comparableText(track.title) !== title) return false;
    const trackArtist = comparableText(track.artist);
    return !artist || !trackArtist || trackArtist === artist;
  }) || null;
}

function comparableText(value) {
  return String(value || "").trim().toLowerCase();
}

function applyExistingTrackFields(form, track) {
  if (!track?.id || form.dataset.loadedExistingId === track.id) return;
  form.dataset.loadedExistingId = track.id;
  setRatingFormValue(form, track.quality);
  setCheckboxValue(form, "karaoke_ready", track.karaokeReady);
  setFormValue(form, "highest_note", track.highestNote || "");
  setFormValue(form, "key", track.key || "±0");
  setFormValue(form, "tags", track.genreTags?.join(", ") || "");
  setFormValue(form, "memo", track.memo || "");
  syncGenreSuggestionState(form);
}

function clearExistingTrackFields(form) {
  delete form.dataset.loadedExistingId;
  setRatingFormValue(form, "");
  setCheckboxValue(form, "karaoke_ready", false);
  setFormValue(form, "highest_note", "");
  setFormValue(form, "key", "±0");
  setFormValue(form, "tags", "");
  setFormValue(form, "memo", "");
  syncGenreSuggestionState(form);
}

function setCheckboxValue(form, name, checked) {
  const field = form?.elements?.[name];
  if (field) field.checked = Boolean(checked);
}

function setRatingFormValue(form, value) {
  const score = Math.max(0, Math.min(5, Number(value) || 0));
  const input = form?.elements?.quality_score;
  if (input) input.value = score ? String(score) : "";
  const buttons = form?.querySelectorAll(".edit-rating button") || [];
  buttons.forEach((button, index) => {
    button.textContent = index < score ? "★" : "☆";
    button.classList.toggle("active", index < score);
  });
}

function syncGenreSuggestionState(form) {
  const tags = normalizeTags(form?.elements?.tags?.value || "");
  for (const chip of form?.querySelectorAll(".edit-tag-suggestions button") || []) {
    chip.classList.toggle("active", tags.includes(chip.textContent));
  }
}

function renderDailyPick() {
  if (!els.dailyPick) return;
  const track = getDailyPick();
  if (!track) {
    els.dailyPick.hidden = true;
    els.dailyPick.replaceChildren();
    return;
  }

  els.dailyPick.hidden = false;
  const avatar = document.createElement("img");
  avatar.className = "daily-pick-avatar";
  avatar.src = "./icon/sak-chan-face.png";
  avatar.alt = "sakちゃん";

  const label = document.createElement("span");
  label.className = "daily-pick-label";
  label.textContent = "sakちゃんおすすめ";

  const title = document.createElement("strong");
  title.textContent = track.title;

  const line = document.createElement("em");
  line.textContent = sakChanLineV2(track, state.dailyLineNonce);

  const meta = document.createElement("small");
  const reasons = [];
  if (track.karaokeReady) reasons.push("歌える");
  if (Number(track.quality) > 0) reasons.push(starText(track.quality));
  if (track.genreTags[0]) reasons.push(track.genreTags[0]);
  meta.textContent = [track.artist, ...reasons].filter(Boolean).join(" · ");

  const play = document.createElement("button");
  play.type = "button";
  play.textContent = track.id === state.currentId && state.isPlaying ? "再生中" : "聴く";
  play.addEventListener("click", () => playDailyPick(track));

  const change = document.createElement("button");
  change.type = "button";
  change.className = "ghost";
  change.textContent = "別の曲";
  change.addEventListener("click", () => {
    state.dailyLineNonce += 1;
    state.dailyPickId = chooseDailyPick({ rotate: true })?.id || "";
    rememberDailyPick(state.dailyPickId);
    render();
  });

  const text = document.createElement("div");
  text.className = "daily-pick-text";
  text.append(label, title, line, meta);

  const actions = document.createElement("div");
  actions.className = "daily-pick-actions";
  actions.append(play, change);

  els.dailyPick.replaceChildren(avatar, text, actions);
}

function renderTags() {
  const tagCounts = new Map();
  for (const track of state.tracks) {
    for (const tag of track.genreTags) tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
  }
  const tags = [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ja"))
    .slice(0, 30);
  els.tags.replaceChildren(makeChip("\u3059\u3079\u3066", ""));
  els.tags.append(makeChip("\ud83c\udfa4 \u6b4c\u3048\u308b", KARAOKE_FILTER));
  for (const [tag, count] of tags) {
    els.tags.append(makeChip(`${tag} ${count}`, tag));
  }
}

function commitSearchQuery() {
  const query = els.search.value.trim();
  if (!query) return;
  state.searchHistory = [query, ...state.searchHistory.filter((item) => item.toLowerCase() !== query.toLowerCase())].slice(0, 8);
  localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(state.searchHistory));
  renderSearchHistory();
}

function renderSearchHistory() {
  if (!els.searchHistory) return;
  els.searchHistory.replaceChildren();
  els.searchHistory.hidden = state.searchHistory.length === 0;
  for (const query of state.searchHistory) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = query;
    button.addEventListener("click", () => {
      els.search.value = query;
      state.query = query.toLowerCase();
      state.page = 1;
      updateClearSearchButton();
      commitSearchQuery();
      render();
    });
    els.searchHistory.append(button);
  }
}

function getDailyPick() {
  if (!state.tracks.length) return null;
  const existing = state.tracks.find((track) => track.id === state.dailyPickId);
  if (existing) return existing;
  const pick = chooseDailyPick();
  state.dailyPickId = pick?.id || "";
  rememberDailyPick(state.dailyPickId);
  return pick;
}

function chooseDailyPick({ rotate = false } = {}) {
  const candidates = state.tracks.filter((track) => track.url);
  if (!candidates.length) return null;
  const recentPickIds = new Set(readArray(DAILY_PICK_HISTORY_KEY));
  const freshCandidates = candidates.filter((track) => !recentPickIds.has(track.id));
  const pool = freshCandidates.length ? freshCandidates : candidates;
  const weighted = [];
  for (const track of pool) {
    const weight = 1 + (track.karaokeReady ? 2 : 0) + Math.min(2, Number(track.quality) || 0);
    for (let index = 0; index < weight; index += 1) weighted.push(track);
  }
  const seed = randomSeed(`${rotate ? "rotate" : "open"}:${Date.now()}:${state.tracks.length}`);
  return weighted[seed % weighted.length];
}

function rememberDailyPick(id) {
  if (!id) return;
  const history = [id, ...readArray(DAILY_PICK_HISTORY_KEY).filter((item) => item !== id)].slice(0, 12);
  localStorage.setItem(DAILY_PICK_HISTORY_KEY, JSON.stringify(history));
}

function randomSeed(salt = "") {
  if (crypto?.getRandomValues) {
    const values = new Uint32Array(1);
    crypto.getRandomValues(values);
    return values[0];
  }
  return hashString(`${salt}:${Math.random()}`);
}

function playDailyPick(track) {
  keepTrackInView(track.id);
  state.detailId = track.id;
  playTrack(track);
  scrollTrackIntoView(track.id);
}

function sakChanLine(track) {
  if (track.karaokeReady && track.highestNote) {
    return `今日はこの曲、${track.highestNote}まで気持ちよくいこ。`;
  }
  if (track.karaokeReady) {
    return "歌える曲だよ。声出しにも本番にもよさそう。";
  }
  if (Number(track.quality) >= 4) {
    return "仕上がりよさげ。もう一回聴いてにやっとしよ。";
  }
  if (Number(track.retake) > 0) {
    return "歌い直しの跡がある曲、伸びしろの匂いがする。";
  }
  if (track.genreTags.includes("ロック") || track.genreTags.includes("V系") || track.genreTags.includes("メタル")) {
    return "今日はちょっと強めでいこう。";
  }
  if (track.memo) {
    return "メモあり。思い出しながら聴くとよさそう。";
  }
  return "今日はこの曲から始めてみよ。";
}

function hashString(value) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function sakChanLineV2(track, nonce = 0) {
  const groups = [];
  const hour = new Date().getHours();
  const day = new Date().getDay();
  const isWeekend = day === 0 || day === 6;

  if (track.karaokeReady && track.highestNote) {
    groups.push([
      `今日はこの曲、${track.highestNote}まで気持ちよくいこ。`,
      `${track.highestNote}まで見えてる曲。焦らず声を乗せよ。`,
      `高音ポイントあり。ここ、決まったらかなり気持ちいいやつ。`,
    ]);
  } else if (track.karaokeReady) {
    groups.push([
      "歌える曲だよ。声出しにも本番にもよさそう。",
      "これは歌う準備できてる曲。ちょっと気持ち入れてこ。",
      "マイク持ったら似合いそう。今日はこれもあり。",
    ]);
  }

  if (Number(track.quality) >= 4) {
    groups.push([
      "仕上がりよさげ。もう一回聴いてにやっとしよ。",
      "このテイク、けっこういい匂いがする。",
      "いい感じに育ってる曲。今日は褒めていいと思う。",
    ]);
  }

  if (Number(track.retake) > 0) {
    groups.push([
      "歌い直しの跡がある曲、伸びしろの匂いがする。",
      "磨いた曲って、あとから効いてくるんだよね。",
      "もう一度向き合った曲。そういうの、ちゃんと残ってる。",
    ]);
  }

  if (track.genreTags.includes("ロック") || track.genreTags.includes("V系") || track.genreTags.includes("メタル")) {
    groups.push([
      "今日はちょっと強めでいこう。",
      "温度高めの曲、今なら刺さるかも。",
      "勢いを借りたい日には、こういう曲だよね。",
    ]);
  }

  if (track.memo) {
    groups.push([
      "メモあり。思い出しながら聴くとよさそう。",
      "メモを残した曲って、その時の自分がちょっといる。",
      "ここは記録つき。聴く前に一回だけ思い出そ。",
    ]);
  }

  if (isWeekend) {
    groups.push([
      "週末だし、少しだけ好きな音に甘やかされよ。",
      "今日は時間を味方につけて聴けそう。",
      "週末の一曲、ちょっと大事にいこ。",
    ]);
  }

  if (hour < 5) {
    groups.push([
      "深い時間の曲選び、そういうのも悪くない。",
      "夜更けには、音が少し近く感じるね。",
    ]);
  } else if (hour < 11) {
    groups.push([
      "朝の一曲、声と気分をゆっくり起こそ。",
      "今日はここから始めてみよ。",
    ]);
  } else if (hour < 17) {
    groups.push([
      "昼のテンションにちょうどよさそう。",
      "今の時間なら、軽く聴いてもちゃんと残りそう。",
    ]);
  } else if (hour < 22) {
    groups.push([
      "夜に似合う曲かも。少しだけ浸ろ。",
      "今日の終わりに、これを置いてみるのもいいね。",
    ]);
  } else {
    groups.push([
      "寝る前なら、気持ちだけ強めにしすぎないでいこ。",
      "夜の余韻に合いそう。音量はやさしめで。",
    ]);
  }

  groups.push([
    "今日はこの曲から始めてみよ。",
    "なんとなく、今これが呼んでる気がする。",
    "迷ったらこれ。sakちゃんセンサー的にはあり。",
  ]);

  const lines = groups.flat();
  const dayKey = new Date().toLocaleDateString("ja-JP");
  const seed = hashString(`${track.id}:${dayKey}:${nonce}:${track.title}`);
  return lines[seed % lines.length];
}

function updateClearSearchButton() {
  if (!els.clearSearch) return;
  els.clearSearch.hidden = els.search.value.trim() === "";
}

function activeFilterLabels() {
  const labels = [];
  if (state.query) labels.push(`\u691c\u7d22: ${els.search.value.trim()}`);
  if (state.tag === KARAOKE_FILTER) labels.push("\u7d5e\u308a\u8fbc\u307f: \ud83c\udfa4 \u6b4c\u3048\u308b");
  else if (state.tag) labels.push(`\u7d5e\u308a\u8fbc\u307f: ${state.tag}`);
  return labels;
}

function clearSearchAndTagFilters() {
  els.search.value = "";
  state.query = "";
  state.tag = "";
  state.page = 1;
  updateClearSearchButton();
  render();
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
    : "all";
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
  if (value === KARAOKE_FILTER) button.classList.add("karaoke-filter");
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
  node.dataset.trackId = track.id;
  node.classList.toggle("active", track.id === state.currentId);
  node.classList.toggle("is-playing", track.id === state.currentId && state.isPlaying);
  node.classList.toggle("expanded", expanded);
  const title = node.querySelector("h2");
  const titleText = document.createElement("span");
  titleText.className = "title-text";
  titleText.textContent = track.title;
  title.replaceChildren(titleText);
  if (track.id === state.currentId) {
    const now = document.createElement("span");
    now.className = "now-indicator";
    now.setAttribute("aria-label", state.isPlaying ? "再生中" : "選択中");
    now.title = state.isPlaying ? "再生中" : "選択中";
    for (let index = 0; index < 3; index += 1) {
      now.append(document.createElement("i"));
    }
    title.prepend(now);
  }
  if (track.karaokeReady) {
    const karaokeIcon = document.createElement("span");
    karaokeIcon.className = "karaoke-icon";
    karaokeIcon.setAttribute("aria-label", "\u6b4c\u3048\u308b");
    karaokeIcon.setAttribute("role", "img");
    karaokeIcon.title = "\u6b4c\u3048\u308b";
    karaokeIcon.textContent = "\ud83c\udfa4";
    title.append(karaokeIcon);
  }
  node.querySelector("p").textContent = track.artist || "\u30a2\u30fc\u30c6\u30a3\u30b9\u30c8\u672a\u8a2d\u5b9a";

  const stats = node.querySelector(".track-stats");
  stats.append(makeStat(starText(track.quality), "stars"));
  if (Number(track.retake) > 0) stats.append(makeStat(`Re ${track.retake}`, "retake"));

  const meta = node.querySelector(".track-meta");
  meta.textContent = [track.version, track.displayDate].filter(Boolean).join(" · ");

  if (state.editStatus?.id === track.id && !expanded) {
    const status = renderEditStatus();
    status.classList.add("card-edit-status");
    node.append(status);
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

  if (state.editStatus?.id === track.id) {
    detail.append(renderEditStatus());
  }

  const singFacts = [
    ["\u6700\u9ad8\u97f3", track.highestNote],
    ["\u30ad\u30fc", track.key !== "" ? track.key : "\u00b10"],
  ].filter(([, value]) => value);
  const categoryItems = [track.category, ...track.genreTags].filter(Boolean);
  if (singFacts.length || categoryItems.length) {
    const summary = document.createElement("div");
    summary.className = "inline-summary";
    singFacts.forEach(([label, value]) => summary.append(makeInfoCell(label, value)));
    categoryItems.forEach((item) => summary.append(makeFact(item)));
    detail.append(summary);
  }

  const memoSection = makeInlineSection("\u30e1\u30e2");
  const memo = document.createElement("p");
  memo.className = "inline-memo";
  memo.textContent = track.memo || "\u30e1\u30e2\u306a\u3057";
  memoSection.append(memo);
  detail.append(memoSection);

  const memberships = playlistMemberships(track.id);
  if (memberships.length) {
    const memberWrap = document.createElement("div");
    memberWrap.className = "inline-memberships";
    memberships.forEach((playlist) => memberWrap.append(makeMembershipChip(track.id, playlist)));
    detail.append(memberWrap);
  }

  if (state.editId === track.id) {
    detail.append(renderMetadataEditor(track));
  }

  const actions = document.createElement("div");
  actions.className = "inline-actions";
  actions.append(makeAction(state.editId === track.id ? "\u7de8\u96c6\u3092\u9589\u3058\u308b" : "\u7de8\u96c6", () => {
    state.editId = state.editId === track.id ? "" : track.id;
    state.editError = "";
    render();
  }));
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

function makeInlineSection(title) {
  const section = document.createElement("div");
  section.className = "inline-section";
  const heading = document.createElement("span");
  heading.className = "inline-section-title";
  heading.textContent = title;
  section.append(heading);
  return section;
}

function renderEditStatus() {
  const status = document.createElement("p");
  status.className = `edit-sync-status ${state.editStatus?.type || "info"}`;
  status.textContent = state.editStatus?.text || "";
  return status;
}

function renderMetadataEditor(track) {
  const form = document.createElement("form");
  form.className = "inline-edit-form";

  form.append(makeEditHeading("\u3088\u304f\u4f7f\u3046\u9805\u76ee"));
  form.append(makeRatingInput(track.quality));
  form.append(makeEditCheckbox("karaoke_ready", "\ud83c\udfa4 \u6b4c\u3048\u308b", track.karaokeReady));

  form.append(makeEditHeading("\u6b4c\u3046\u5224\u65ad"));
  form.append(makeEditInput("highest_note", "\u6700\u9ad8\u97f3", track.highestNote, "mid2G#"));
  form.append(makeKeySelect(track.key));
  form.append(makeEditInput("retake_count", "\u6b4c\u3044\u76f4\u3057\u6570", String(Number(track.retake) || 0), "0", "number"));

  form.append(makeEditHeading("\u5206\u985e\u30fb\u30e1\u30e2"));
  form.append(makeGenreInput(track.genreTags));

  const memoLabel = document.createElement("label");
  memoLabel.className = "edit-field edit-field-wide";
  memoLabel.textContent = "\u30e1\u30e2";
  const memo = document.createElement("textarea");
  memo.name = "memo";
  memo.rows = 3;
  memo.value = track.memo || "";
  memoLabel.append(memo);
  form.append(memoLabel);

  if (state.editError) {
    const error = document.createElement("p");
    error.className = "edit-error";
    error.textContent = state.editError;
    form.append(error);
  }

  const actions = document.createElement("div");
  actions.className = "edit-actions";
  const save = document.createElement("button");
  save.type = "submit";
  save.textContent = state.savingEditId === track.id ? "\u4fdd\u5b58\u4e2d" : "\u4fdd\u5b58";
  save.disabled = state.savingEditId === track.id;
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "\u30ad\u30e3\u30f3\u30bb\u30eb";
  cancel.addEventListener("click", () => {
    state.editId = "";
    state.editError = "";
    render();
  });
  const archive = document.createElement("button");
  archive.type = "button";
  archive.className = "danger-action";
  archive.textContent = "アーカイブ";
  archive.addEventListener("click", () => archiveTrack(track));
  actions.append(archive, cancel, save);
  form.append(actions);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    submitMetadataEdit(track, form);
  });

  return form;
}

function makeEditHeading(text) {
  const heading = document.createElement("span");
  heading.className = "edit-group-heading";
  heading.textContent = text;
  return heading;
}

function makeEditInput(name, label, value, placeholder = "", type = "text") {
  const field = document.createElement("label");
  field.className = "edit-field";
  field.textContent = label;
  const input = document.createElement("input");
  input.name = name;
  input.type = type;
  input.value = value || "";
  input.placeholder = placeholder;
  if (type === "number") input.min = "0";
  field.append(input);
  return field;
}

function makeGenreInput(selectedTags) {
  const field = document.createElement("label");
  field.className = "edit-field edit-field-wide";
  field.textContent = "\u30b8\u30e3\u30f3\u30eb";

  const input = document.createElement("input");
  input.name = "tags";
  input.value = selectedTags.join(", ");
  input.placeholder = "\u30ed\u30c3\u30af, V\u7cfb, \u30e1\u30bf\u30eb";
  field.append(input);

  const suggestions = genreSuggestions();
  if (suggestions.length) {
    const chips = document.createElement("div");
    chips.className = "edit-tag-suggestions";
    for (const tag of suggestions) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.textContent = tag;
      chip.className = selectedTags.includes(tag) ? "active" : "";
      chip.addEventListener("click", () => {
        const current = normalizeTags(input.value);
        const next = current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag];
        input.value = next.join(", ");
        chip.classList.toggle("active", next.includes(tag));
      });
      chips.append(chip);
    }
    field.append(chips);
  }

  return field;
}

function makeEditCheckbox(name, label, checked) {
  const field = document.createElement("label");
  field.className = "edit-field";
  field.textContent = label;
  const box = document.createElement("span");
  box.className = "edit-check";
  const input = document.createElement("input");
  input.name = name;
  input.type = "checkbox";
  input.checked = checked;
  box.append(input, document.createTextNode("\u5bfe\u8c61"));
  field.append(box);
  return field;
}

function makeKeySelect(value) {
  const field = document.createElement("label");
  field.className = "edit-field";
  field.textContent = "\u30ad\u30fc";
  const select = document.createElement("select");
  select.name = "key";
  for (let key = 6; key >= -6; key -= 1) {
    const label = key === 0 ? "\u00b10" : key > 0 ? `+${key}` : String(key);
    select.append(new Option(label, label));
  }
  select.value = value || "\u00b10";
  field.append(select);
  return field;
}

function makeRatingInput(value) {
  const score = Math.max(0, Math.min(5, Number(value) || 0));
  const field = document.createElement("div");
  field.className = "edit-field edit-rating-field";
  const label = document.createElement("span");
  label.textContent = "\u8a55\u4fa1";
  const input = document.createElement("input");
  input.type = "hidden";
  input.name = "quality_score";
  input.value = score ? String(score) : "";
  const stars = document.createElement("div");
  stars.className = "edit-rating";
  const buttons = [];

  const paint = (nextScore) => {
    input.value = nextScore ? String(nextScore) : "";
    buttons.forEach((button, index) => {
      button.textContent = index < nextScore ? "\u2605" : "\u2606";
      button.classList.toggle("active", index < nextScore);
    });
  };

  for (let index = 1; index <= 5; index += 1) {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("aria-label", `\u8a55\u4fa1 ${index}`);
    button.addEventListener("click", () => {
      paint(Number(input.value) === index ? 0 : index);
    });
    buttons.push(button);
    stars.append(button);
  }

  field.append(label, input, stars);
  paint(score);
  return field;
}

function genreSuggestions() {
  const counts = new Map();
  for (const track of state.tracks) {
    for (const tag of track.genreTags) counts.set(tag, (counts.get(tag) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ja"))
    .slice(0, 12)
    .map(([tag]) => tag);
}

function makeInfoCell(label, value) {
  const cell = document.createElement("span");
  cell.className = "inline-info-cell";
  const labelNode = document.createElement("span");
  labelNode.className = "inline-info-label";
  labelNode.textContent = label;
  const valueNode = document.createElement("strong");
  valueNode.className = "inline-info-value";
  valueNode.textContent = value;
  cell.append(labelNode, valueNode);
  return cell;
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
  if (state.tag === KARAOKE_FILTER) tracks = tracks.filter((track) => track.karaokeReady);
  else if (state.tag) tracks = tracks.filter((track) => track.genreTags.includes(state.tag));
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

function playTrack(track, { autoplay = true, revealDetail = false } = {}) {
  if (!track.url) return;
  if (autoplay) triggerStageTransfer(track.id);
  if (revealDetail) keepTrackInView(track.id);
  state.currentId = track.id;
  if (autoplay) expandPlayerForPlayback();
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
  if (revealDetail) scrollTrackIntoView(track.id);
}

async function setupServiceWorkerUpdates() {
  if (!("serviceWorker" in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.register("./sw.js");
    if (registration.waiting && navigator.serviceWorker.controller) {
      showUpdateNotice(registration.waiting);
    }

    registration.addEventListener("updatefound", () => {
      const installing = registration.installing;
      if (!installing) return;
      installing.addEventListener("statechange", () => {
        if (installing.state === "installed" && navigator.serviceWorker.controller) {
          showUpdateNotice(registration.waiting || installing);
        }
      });
    });

    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!isApplyingUpdate) return;
      location.reload();
    });

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") registration.update().catch(() => {});
    });
    window.setInterval(() => registration.update().catch(() => {}), UPDATE_CHECK_INTERVAL);
    registration.update().catch(() => {});
  } catch {
    // The app remains usable when service workers are unavailable.
  }
}

function showUpdateNotice(worker) {
  waitingServiceWorker = worker;
  els.updateNotice.hidden = false;
}

function applyServiceWorkerUpdate() {
  if (!waitingServiceWorker) return;
  isApplyingUpdate = true;
  els.applyUpdate.disabled = true;
  els.applyUpdate.textContent = "更新中";
  waitingServiceWorker.postMessage({ type: "SKIP_WAITING" });
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
  if (next) playTrack(next, { autoplay, revealDetail: true });
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
  updateMediaSessionMetadata(track);
}

function setupMediaSession() {
  if (!("mediaSession" in navigator)) return;

  setMediaSessionAction("play", () => {
    els.audio.play().catch(() => {});
  });
  setMediaSessionAction("pause", () => {
    els.audio.pause();
  });
  setMediaSessionAction("previoustrack", () => {
    playAdjacent(-1, { autoplay: true });
  });
  setMediaSessionAction("nexttrack", () => {
    playAdjacent(1, { autoplay: true });
  });
  setMediaSessionAction("seekbackward", (details) => {
    seekAudioBy(-(details?.seekOffset || 10));
  });
  setMediaSessionAction("seekforward", (details) => {
    seekAudioBy(details?.seekOffset || 10);
  });
  setMediaSessionAction("seekto", (details) => {
    if (Number.isFinite(details?.seekTime)) {
      els.audio.currentTime = details.seekTime;
      updateProgress();
    }
  });
  setMediaSessionAction("stop", () => {
    els.audio.pause();
    els.audio.currentTime = 0;
    updateProgress();
  });
}

function setMediaSessionAction(action, handler) {
  try {
    navigator.mediaSession.setActionHandler(action, handler);
  } catch {
    // Some browsers expose Media Session but support only part of its actions.
  }
}

function updateMediaSessionMetadata(track) {
  if (!("mediaSession" in navigator) || !("MediaMetadata" in window)) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: track.title,
    artist: track.artist || "sak_Uta",
    album: [track.version, "sak_Uta"].filter(Boolean).join(" · "),
    artwork: [
      { src: new URL("./icon-192.png", location.href).href, sizes: "192x192", type: "image/png" },
      { src: new URL("./icon-512.png", location.href).href, sizes: "512x512", type: "image/png" },
    ],
  });
}

function updateMediaSessionPlaybackState(playbackState) {
  if (!("mediaSession" in navigator)) return;
  try {
    navigator.mediaSession.playbackState = playbackState;
  } catch {
    // Older WebKit versions may not expose playbackState.
  }
}

function updateMediaSessionPosition() {
  if (!("mediaSession" in navigator) || !navigator.mediaSession.setPositionState) return;
  const duration = els.audio.duration;
  if (!Number.isFinite(duration) || duration <= 0) return;
  try {
    navigator.mediaSession.setPositionState({
      duration,
      playbackRate: els.audio.playbackRate || 1,
      position: Math.min(Math.max(els.audio.currentTime, 0), duration),
    });
  } catch {
    // Position controls are optional across browsers.
  }
}

function seekAudioBy(seconds) {
  const duration = els.audio.duration;
  if (!Number.isFinite(duration)) return;
  els.audio.currentTime = Math.min(Math.max(els.audio.currentTime + seconds, 0), duration);
  updateProgress();
}

function updatePlayerMeta(track = getCurrentTrack()) {
  if (!track) {
    els.nowMeta.textContent = state.playbackMessage;
    return;
  }
  const meta = [starText(track.quality)];
  if (Number(track.retake) > 0) meta.push(`Re ${track.retake}`);
  if (track.karaokeReady) meta.push("\u6b4c\u3048\u308b");
  els.nowMeta.textContent = meta.filter(Boolean).join(" · ");
}

function setPlaybackStatus(status, message = "") {
  state.playbackStatus = status;
  state.playbackMessage = message;
  updatePlayerMeta();
  updatePlaybackStatusDisplay();
}

function updatePlaybackStatusDisplay() {
  if (!els.playbackStatus) return;
  const labels = {
    loading: state.playbackMessage || "\u8aad\u307f\u8fbc\u307f\u4e2d",
    playing: "\u518d\u751f\u4e2d",
    error: state.playbackMessage || "\u518d\u751f\u30a8\u30e9\u30fc",
  };
  const label = labels[state.playbackStatus] || "";
  els.playbackStatus.textContent = label || "\u00a0";
  els.playbackStatus.classList.toggle("is-empty", !label);
  els.playbackStatus.setAttribute("aria-hidden", label ? "false" : "true");
  els.playbackStatus.dataset.status = state.playbackStatus;
}

function updatePlayerControls() {
  const isPaused = els.audio.paused || !state.isPlaying;
  els.player.classList.toggle("is-playing", !isPaused);
  els.playerPlay.textContent = "";
  els.playerPlay.classList.toggle("is-playing", !isPaused);
  els.playerPlay.setAttribute("aria-label", isPaused ? "\u518d\u751f" : "\u4e00\u6642\u505c\u6b62");
  els.repeat.classList.toggle("active", state.repeat);
  els.shuffle.classList.toggle("active", state.shuffle);
}

function updatePlayerCompact() {
  els.player.classList.toggle("compact", state.compactPlayer);
  els.appShell.classList.toggle("player-compact", state.compactPlayer);
  els.compactPlayer.setAttribute("aria-pressed", String(state.compactPlayer));
  els.compactPlayer.setAttribute("aria-label", state.compactPlayer ? "\u518d\u751f\u30a8\u30ea\u30a2\u3092\u5927\u304d\u304f\u3059\u308b" : "\u518d\u751f\u30a8\u30ea\u30a2\u3092\u5c0f\u3055\u304f\u3059\u308b");
  els.compactPlayer.setAttribute("title", state.compactPlayer ? "\u518d\u751f\u30a8\u30ea\u30a2\u3092\u5927\u304d\u304f\u3059\u308b" : "\u518d\u751f\u30a8\u30ea\u30a2\u3092\u5c0f\u3055\u304f\u3059\u308b");
}

function expandPlayerForPlayback() {
  if (state.playerManualCompact || !state.compactPlayer) return;
  state.compactPlayer = false;
  updatePlayerCompact();
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
  updateMediaSessionPosition();
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

function keepTrackInView(id) {
  if (!id) return;
  state.detailId = id;

  let tracks = filterTracks();
  if (!tracks.some((track) => track.id === id)) {
    els.search.value = "";
    state.query = "";
    state.tag = "";
    if (!playlistContainsTrack(state.view, id)) {
      state.view = "all";
      els.view.value = "all";
    }
    updateClearSearchButton();
    renderPlaylistOptions();
    tracks = filterTracks();
  }

  const index = tracks.findIndex((track) => track.id === id);
  if (index >= 0) {
    state.page = Math.floor(index / PAGE_SIZE) + 1;
  }
}

function pageForTrack(id, tracks) {
  const index = tracks.findIndex((track) => track.id === id);
  return index === -1 ? state.page : Math.floor(index / PAGE_SIZE) + 1;
}

function playlistContainsTrack(view, trackId) {
  if (["all", "latest10", "favorites", "recentlyPlayed"].includes(view)) {
    if (view === "favorites") return state.favorites.has(trackId);
    if (view === "recentlyPlayed") return state.recent.includes(trackId);
    return true;
  }
  const playlist = state.playlists.find((item) => item.id === view);
  return Boolean(playlist?.trackIds.includes(trackId));
}

function scrollTrackIntoView(id) {
  window.setTimeout(() => {
    document.querySelector(`[data-track-id="${CSS.escape(id)}"]`)?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }, 50);
}

function triggerStageTransfer(id) {
  const card = document.querySelector(`[data-track-id="${CSS.escape(id)}"]`);
  if (!card || !els.player || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const cardRect = card.getBoundingClientRect();
  const playerRect = els.player.getBoundingClientRect();
  if (cardRect.bottom < 0 || cardRect.top > window.innerHeight) return;

  card.classList.add("stage-launch");
  window.setTimeout(() => card.classList.remove("stage-launch"), 900);
  els.player.classList.add("stage-receive");
  window.setTimeout(() => els.player.classList.remove("stage-receive"), 900);

  const light = document.createElement("span");
  light.className = "stage-transfer-light";
  light.style.setProperty("--from-x", `${cardRect.left + cardRect.width * 0.5}px`);
  light.style.setProperty("--from-y", `${cardRect.top + cardRect.height * 0.5}px`);
  light.style.setProperty("--to-x", `${playerRect.left + playerRect.width * 0.5}px`);
  light.style.setProperty("--to-y", `${playerRect.top + 18}px`);
  document.body.append(light);
  light.addEventListener("animationend", () => light.remove(), { once: true });
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
  const values = Array.isArray(value) ? value : String(value || "").split(/[,\s/、，]+/);
  return values
    .map(String)
    .map((tag) => tag.trim())
    .filter((tag) => !EXCLUDED_GENRE_TAGS.has(tag.toLowerCase()))
    .filter(Boolean);
}

function normalizeCategory(value) {
  const category = String(value || "").trim();
  return EXCLUDED_GENRE_TAGS.has(category.toLowerCase()) ? "" : category;
}

function buildTrackSearchText(track) {
  return [
    track.title,
    track.artist,
    track.category,
    track.version,
    track.genreTags?.join(" "),
    track.date,
    track.memo,
    track.fileName,
    track.highestNote,
    track.key,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
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

function parseSongFileName(fileName) {
  const base = stripExtension(fileNameFromUrl(fileName) || fileName);
  const parts = base.split("_").map((part) => part.trim()).filter(Boolean);
  if (parts.length < 3) return { artist: "", title: stripExtension(fileName), retake: 0, version: "" };

  const artist = parts.shift() || "";
  const version = normalizeFileVersion(parts.pop() || "");
  let retake = 0;
  const retakeMatch = parts.at(-1)?.match(/^Re(\d+)$/i);
  if (retakeMatch) {
    retake = Number(retakeMatch[1]) || 0;
    parts.pop();
  }

  return {
    artist,
    title: parts.join("_"),
    retake,
    version,
  };
}

function normalizeFileVersion(value) {
  const version = String(value || "").trim();
  return version.replace(/^Matering-/i, "Mastering-");
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
  const playing = state.isPlaying && state.playbackStatus !== "error";
  ctx.fillStyle = playing ? "#fff7df" : "#f1eee7";
  ctx.fillRect(0, 0, width, height);

  const bars = state.waveform.length ? state.waveform : Array.from({ length: 72 }, (_, index) => 0.18 + 0.22 * Math.sin(index * 0.65) ** 2);
  const gap = 2;
  const barWidth = Math.max(2, (width - gap * (bars.length - 1)) / bars.length);
  const activeX = width * Math.max(0, Math.min(1, progress || 0));

  bars.forEach((value, index) => {
    const x = index * (barWidth + gap);
    const barHeight = Math.max(4, value * (height - 10));
    const y = (height - barHeight) / 2;
    const isActive = x <= activeX;
    if (playing && isActive) {
      const warm = ctx.createLinearGradient(0, y, 0, y + barHeight);
      warm.addColorStop(0, "#ffd166");
      warm.addColorStop(0.48, "#ef1744");
      warm.addColorStop(1, "#126b5a");
      ctx.fillStyle = warm;
      ctx.shadowColor = "rgba(239, 23, 68, 0.24)";
      ctx.shadowBlur = 5;
    } else {
      ctx.fillStyle = isActive ? "#126b5a" : "#c9c2b6";
      ctx.shadowBlur = 0;
    }
    ctx.fillRect(x, y, barWidth, barHeight);
  });
  ctx.shadowBlur = 0;
}

function progressRatio() {
  const duration = els.audio.duration;
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  return els.audio.currentTime / duration;
}

function versionFromFileName(value) {
  return parseSongFileName(value).version;
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


