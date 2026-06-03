const SHEET_NAME = "songs";
const EDITABLE_COLUMNS = [
  "tags",
  "karaoke_ready",
  "highest_note",
  "key",
  "quality_score",
  "retake_count",
  "memo",
];

function doGet(e) {
  const rows = readSongs_();
  const payload = { ok: true, data: rows };
  const callback = e && e.parameter && e.parameter.callback;
  if (callback) {
    return ContentService
      .createTextOutput(`${callback}(${JSON.stringify(payload)});`)
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return json_(payload);
}

function doPost(e) {
  try {
    requireEditToken_(e);
    const action = String(e.parameter.action || "");
    const payload = JSON.parse(e.parameter.payload || "{}");
    let result;
    if (action === "updateTrack") {
      const id = String(e.parameter.id || "").trim();
      result = updateTrack_(id, payload);
    } else if (action === "addTrack") {
      result = addTrack_(payload);
    } else if (action === "archiveTrack") {
      const id = String(e.parameter.id || "").trim();
      result = archiveTrack_(id);
    } else {
      throw new Error(`Unknown action: ${action}`);
    }
    return json_({ ok: true, data: result });
  } catch (error) {
    return json_({
      ok: false,
      error: error && error.message ? error.message : String(error),
    });
  }
}

function readSongs_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error(`Sheet not found: ${SHEET_NAME}`);

  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];

  const headers = values[0].map((header) => String(header).trim());
  return values.slice(1).map((row) => {
    const item = {};
    headers.forEach((header, index) => {
      item[header] = row[index] == null ? "" : row[index];
    });
    return item;
  });
}

function updateTrack_(id, payload) {
  if (!id) throw new Error("Missing id");

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error(`Sheet not found: ${SHEET_NAME}`);

  const values = sheet.getDataRange().getValues();
  if (values.length < 2) throw new Error("No rows");

  const headers = values[0].map((header) => String(header).trim());
  const idColumn = headers.indexOf("id");
  if (idColumn === -1) throw new Error("id column not found");

  const rowIndex = values.findIndex((row, index) => {
    return index > 0 && String(row[idColumn]).trim() === id;
  });
  if (rowIndex === -1) throw new Error(`Track not found: ${id}`);

  EDITABLE_COLUMNS.forEach((name) => {
    if (!(name in payload)) return;
    const columnIndex = headers.indexOf(name);
    if (columnIndex === -1) return;
    sheet.getRange(rowIndex + 1, columnIndex + 1).setValue(payload[name]);
  });

  return { id };
}

function archiveTrack_(id) {
  if (!id) throw new Error("Missing id");

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error(`Sheet not found: ${SHEET_NAME}`);

  const values = sheet.getDataRange().getValues();
  if (values.length < 2) throw new Error("No rows");

  const headers = values[0].map((header) => String(header).trim());
  const idColumn = headers.indexOf("id");
  if (idColumn === -1) throw new Error("id column not found");

  const rowIndex = values.findIndex((row, index) => {
    return index > 0 && String(row[idColumn]).trim() === id;
  });
  if (rowIndex === -1) throw new Error(`Track not found: ${id}`);

  const archivedColumn = ensureColumn_(sheet, headers, "archived");
  sheet.getRange(rowIndex + 1, archivedColumn + 1).setValue(true);

  const archivedAtColumn = ensureColumn_(sheet, headers, "archived_at");
  sheet.getRange(rowIndex + 1, archivedAtColumn + 1).setValue(new Date());

  return { id, archived: true };
}

function addTrack_(payload) {
  const title = String(payload.title || "").trim();
  const url = String(payload.url || payload.r2_url || payload.audio_url || "").trim();
  if (!title) throw new Error("Missing title");
  if (!url) throw new Error("Missing url");

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error(`Sheet not found: ${SHEET_NAME}`);

  const values = sheet.getDataRange().getValues();
  if (!values.length) throw new Error("No headers");

  const headers = values[0].map((header) => String(header).trim());
  const id = String(payload.id || "").trim() || makeTrackId_();
  const rowData = {
    id,
    title,
    song: title,
    name: title,
    artist: String(payload.artist || "").trim(),
    original_artist: String(payload.artist || "").trim(),
    url,
    r2_url: url,
    audioUrl: url,
    audio_url: url,
    URL: url,
    fileName: String(payload.fileName || payload.filename || "").trim(),
    filename: String(payload.fileName || payload.filename || "").trim(),
    file_name: String(payload.fileName || payload.filename || "").trim(),
    wav_filename: String(payload.fileName || payload.filename || "").trim(),
    WAV: String(payload.fileName || payload.filename || "").trim(),
    wav: String(payload.fileName || payload.filename || "").trim(),
    category: String(payload.category || "").trim(),
    version: String(payload.category || payload.version || "").trim(),
    mix: String(payload.category || payload.version || "").trim(),
    master: String(payload.category || payload.version || "").trim(),
    tags: String(payload.tags || "").trim(),
    tag: String(payload.tags || "").trim(),
    karaoke_ready: payload.karaoke_ready === true || payload.karaoke_ready === "true",
    karaoke: payload.karaoke_ready === true || payload.karaoke_ready === "true",
    highest_note: String(payload.highest_note || "").trim(),
    key: String(payload.key || "±0").trim() || "±0",
    quality_score: String(payload.quality_score || "").trim(),
    quality: String(payload.quality_score || "").trim(),
    score: String(payload.quality_score || "").trim(),
    retake_count: payload.retake_count || 0,
    retake: payload.retake_count || 0,
    memo: String(payload.memo || "").trim(),
    note: String(payload.memo || "").trim(),
    notes: String(payload.memo || "").trim(),
    last_updated: today_(),
    date: today_(),
    created: today_(),
    recorded: today_(),
  };

  const existingRowIndex = Number(rowData.retake_count) > 0 ? -1 : findBaseTrackRow_(values, headers, rowData);
  if (existingRowIndex >= 1) {
    updateExistingTrackRow_(sheet, existingRowIndex + 1, headers, rowData);
    const existingId = getRowValue_(values[existingRowIndex], headers, ["id", "ID", "uuid"]) || id;
    return { id: existingId, mode: "updated" };
  }

  const row = headers.map((header) => Object.prototype.hasOwnProperty.call(rowData, header) ? rowData[header] : "");
  sheet.appendRow(row);
  return { id, mode: "created" };
}

function makeTrackId_() {
  return `song-${Utilities.getUuid().slice(0, 8)}`;
}

function findBaseTrackRow_(values, headers, rowData) {
  const targetTitle = normalizeText_(rowData.title);
  const targetArtist = normalizeText_(rowData.artist);
  if (!targetTitle) return -1;

  for (let index = 1; index < values.length; index += 1) {
    const row = values[index];
    const archived = getRowValue_(row, headers, ["archived", "deleted", "hidden"]);
    if (archived === true || String(archived).toLowerCase() === "true") continue;
    const title = normalizeText_(getRowValue_(row, headers, ["title", "song", "name"]));
    const artist = normalizeText_(getRowValue_(row, headers, ["artist", "original_artist"]));
    const retake = Number(getRowValue_(row, headers, ["retake_count", "retake"]) || 0);
    if (title !== targetTitle) continue;
    if (targetArtist && artist && artist !== targetArtist) continue;
    if (retake > 0) continue;
    return index;
  }
  return -1;
}

function updateExistingTrackRow_(sheet, rowNumber, headers, rowData) {
  headers.forEach((header, index) => {
    if (header === "id" || header === "ID" || header === "uuid") return;
    if (!Object.prototype.hasOwnProperty.call(rowData, header)) return;
    sheet.getRange(rowNumber, index + 1).setValue(rowData[header]);
  });
}

function ensureColumn_(sheet, headers, name) {
  let index = headers.indexOf(name);
  if (index !== -1) return index;
  index = headers.length;
  sheet.getRange(1, index + 1).setValue(name);
  headers.push(name);
  return index;
}

function getRowValue_(row, headers, names) {
  for (const name of names) {
    const index = headers.indexOf(name);
    if (index !== -1 && row[index] !== "" && row[index] != null) return row[index];
  }
  return "";
}

function normalizeText_(value) {
  return String(value || "").trim().toLowerCase();
}

function today_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
}

function requireEditToken_(e) {
  const expected = PropertiesService.getScriptProperties().getProperty("EDIT_TOKEN");
  if (!expected) {
    throw new Error("EDIT_TOKEN is not set");
  }

  const actual = String(e.parameter.token || "");
  if (actual !== expected) {
    throw new Error("Invalid edit token");
  }
}

function json_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
