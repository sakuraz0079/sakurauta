import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/index.js";

class MemoryKv {
  constructor() {
    this.values = new Map();
  }

  async get(key) {
    return this.values.get(key) || null;
  }

  async put(key, value) {
    this.values.set(key, value);
  }
}

function env() {
  return {
    SHARE_ADMIN_TOKEN: "test-secret",
    SHARE_LINKS: new MemoryKv(),
  };
}

test("creates a random share and returns only public metadata", async () => {
  const bindings = env();
  const create = await worker.fetch(new Request("https://share.example/api/shares", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Origin": "http://127.0.0.1:4173",
      "X-Share-Admin-Token": "test-secret",
    },
    body: JSON.stringify({
      track: {
        id: "111",
        title: "Nights Of The Knife",
        artist: "TMN",
        version: "Mastering-1",
        fileName: "TMN_Nights Of The Knife_Mastering-1.wav",
        sourceUrl: "https://pub-example.r2.dev/TMN_Nights%20Of%20The%20Knife_Mastering-1.wav",
      },
    }),
  }), bindings);

  assert.equal(create.status, 201);
  const created = await create.json();
  assert.match(created.url, /^https:\/\/share\.example\/s\/[A-Za-z0-9_-]{20,}$/);

  const token = created.token;
  const metadata = await worker.fetch(new Request(`https://share.example/api/shares/${token}`), bindings);
  const payload = await metadata.json();
  assert.deepEqual(Object.keys(payload.data).sort(), ["artist", "audioUrl", "expiresAt", "title", "version"]);
  assert.equal(payload.data.title, "Nights Of The Knife");
  assert.equal(JSON.stringify(payload).includes("r2.dev"), false);
  assert.equal(JSON.stringify(payload).includes("fileName"), false);
});

test("rejects creation without the admin token", async () => {
  const response = await worker.fetch(new Request("https://share.example/api/shares", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Origin": "http://127.0.0.1:4173",
    },
    body: JSON.stringify({ track: { title: "Test", fileName: "test.wav" } }),
  }), env());

  assert.equal(response.status, 401);
});
