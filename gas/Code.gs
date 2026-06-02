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
    if (action !== "updateTrack") {
      throw new Error(`Unknown action: ${action}`);
    }

    const id = String(e.parameter.id || "").trim();
    const payload = JSON.parse(e.parameter.payload || "{}");
    const result = updateTrack_(id, payload);
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
