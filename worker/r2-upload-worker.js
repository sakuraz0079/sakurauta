const ALLOWED_ORIGINS = new Set([
  "https://sakuraz0079.github.io",
  "http://127.0.0.1:4173",
  "http://localhost:4173",
]);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const corsHeaders = cors(origin);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const expectedToken = env.UPLOAD_TOKEN || "";
    const actualToken = request.headers.get("X-Upload-Token") || "";
    if (!expectedToken || actualToken !== expectedToken) {
      return json({ ok: false, error: "Invalid upload token" }, 401, corsHeaders);
    }

    const action = url.searchParams.get("action") || "";
    if (action) {
      return handleMultipartRequest(request, env, action, url, corsHeaders);
    }

    if (request.method !== "POST") {
      return json({ ok: false, error: "Method not allowed" }, 405, corsHeaders);
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

async function handleMultipartRequest(request, env, action, url, corsHeaders) {
  try {
    if (action === "create" && request.method === "POST") {
      const payload = await request.json();
      const fileName = validateWavFileName(payload?.fileName);
      const upload = await env.SAKURAUTA_WAVS.createMultipartUpload(fileName, {
        httpMetadata: {
          contentType: payload?.contentType || "audio/wav",
        },
      });
      return json({
        ok: true,
        fileName,
        uploadId: upload.uploadId,
      }, 200, corsHeaders);
    }

    if (action === "part" && request.method === "PUT") {
      const fileName = validateWavFileName(url.searchParams.get("fileName"));
      const uploadId = url.searchParams.get("uploadId") || "";
      const partNumber = Number(url.searchParams.get("partNumber"));
      if (!uploadId || !Number.isInteger(partNumber) || partNumber < 1 || !request.body) {
        return json({ ok: false, error: "Invalid multipart part" }, 400, corsHeaders);
      }
      const upload = env.SAKURAUTA_WAVS.resumeMultipartUpload(fileName, uploadId);
      const part = await upload.uploadPart(partNumber, request.body);
      return json({ ok: true, partNumber: part.partNumber, etag: part.etag }, 200, corsHeaders);
    }

    if (action === "complete" && request.method === "POST") {
      const payload = await request.json();
      const fileName = validateWavFileName(payload?.fileName);
      const uploadId = String(payload?.uploadId || "");
      const parts = Array.isArray(payload?.parts) ? payload.parts : [];
      if (!uploadId || !parts.length) {
        return json({ ok: false, error: "Missing multipart completion data" }, 400, corsHeaders);
      }
      const upload = env.SAKURAUTA_WAVS.resumeMultipartUpload(fileName, uploadId);
      await upload.complete(parts);
      return json({
        ok: true,
        fileName,
        url: publicFileUrl(env, fileName),
      }, 200, corsHeaders);
    }

    if (action === "abort" && request.method === "DELETE") {
      const payload = await request.json();
      const fileName = validateWavFileName(payload?.fileName);
      const uploadId = String(payload?.uploadId || "");
      if (uploadId) {
        const upload = env.SAKURAUTA_WAVS.resumeMultipartUpload(fileName, uploadId);
        await upload.abort();
      }
      return json({ ok: true }, 200, corsHeaders);
    }

    return json({ ok: false, error: "Invalid multipart action" }, 405, corsHeaders);
  } catch (error) {
    return json({ ok: false, error: error?.message || "Multipart upload failed" }, 400, corsHeaders);
  }
}

function cors(origin) {
  const allowedOrigin = ALLOWED_ORIGINS.has(origin) ? origin : "https://sakuraz0079.github.io";
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "X-Upload-Token, Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function validateWavFileName(value) {
  const fileName = safeFileName(value);
  if (!fileName.toLowerCase().endsWith(".wav")) {
    throw new Error("WAV only");
  }
  return fileName;
}

function publicFileUrl(env, fileName) {
  const publicBaseUrl = String(env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
  if (!publicBaseUrl) {
    throw new Error("PUBLIC_BASE_URL is not set");
  }
  return `${publicBaseUrl}/${encodeURIComponent(fileName)}`;
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
