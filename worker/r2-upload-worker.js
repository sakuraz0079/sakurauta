const ALLOWED_ORIGINS = new Set([
  "https://sakuraz0079.github.io",
  "http://127.0.0.1:4173",
  "http://localhost:4173",
]);

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const corsHeaders = cors(origin);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method !== "POST") {
      return json({ ok: false, error: "Method not allowed" }, 405, corsHeaders);
    }

    const expectedToken = env.UPLOAD_TOKEN || "";
    const actualToken = request.headers.get("X-Upload-Token") || "";
    if (!expectedToken || actualToken !== expectedToken) {
      return json({ ok: false, error: "Invalid upload token" }, 401, corsHeaders);
    }

    const form = await request.formData();
    const file = form.get("file");
    if (!file || typeof file === "string") {
      return json({ ok: false, error: "Missing file" }, 400, corsHeaders);
    }

    const fileName = safeFileName(form.get("fileName") || file.name);
    if (!fileName.toLowerCase().endsWith(".wav")) {
      return json({ ok: false, error: "WAV only" }, 400, corsHeaders);
    }

    await env.SAKURAUTA_WAVS.put(fileName, file.stream(), {
      httpMetadata: {
        contentType: file.type || "audio/wav",
      },
    });

    const publicBaseUrl = String(env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
    if (!publicBaseUrl) {
      return json({ ok: false, error: "PUBLIC_BASE_URL is not set" }, 500, corsHeaders);
    }

    return json({
      ok: true,
      fileName,
      url: `${publicBaseUrl}/${encodeURIComponent(fileName)}`,
    }, 200, corsHeaders);
  },
};

function cors(origin) {
  const allowedOrigin = ALLOWED_ORIGINS.has(origin) ? origin : "https://sakuraz0079.github.io";
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "X-Upload-Token, Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function json(payload, status, headers) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...headers,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function safeFileName(value) {
  return String(value || "")
    .split(/[\\/]/)
    .pop()
    .replace(/[^\p{Letter}\p{Number}._-]+/gu, "_");
}
