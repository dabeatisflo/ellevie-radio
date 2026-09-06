import { assessMessage, normalizeForFilter, validateSubmission } from "./filter.js";

const encoder = new TextEncoder();
const SESSION_COOKIE = "ellevie_studio_session";
const SESSION_SECONDS = 12 * 60 * 60;

export default {
  async fetch(request, env) {
    try {
      const response = await routeRequest(request, env);
      return secureResponse(response, request, env);
    } catch (error) {
      if (error instanceof HttpError) {
        return secureResponse(json({ ok: false, error: error.message }, error.status), request, env);
      }
      console.error("Unhandled request error", error);
      return secureResponse(
        json({ ok: false, error: "Une erreur temporaire est survenue." }, 500),
        request,
        env
      );
    }
  },

  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(cleanExpiredData(env));
  }
};

async function routeRequest(request, env) {
  const url = new URL(request.url);

  if (request.method === "OPTIONS" && url.pathname.startsWith("/api/")) {
    if (!isAllowedOrigin(request, env)) return json({ ok: false }, 403);
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }

  if (url.pathname === "/api/config" && request.method === "GET") {
    return json({
      turnstileSiteKey: env.TURNSTILE_SITE_KEY,
      messageMaxLength: numberFromEnv(env.MESSAGE_MAX_LENGTH, 500)
    });
  }

  if (url.pathname === "/api/messages" && request.method === "POST") {
    requireAllowedOrigin(request, env);
    return submitMessage(request, env);
  }

  if (url.pathname === "/api/studio/login" && request.method === "POST") {
    requireAllowedOrigin(request, env);
    return studioLogin(request, env);
  }

  if (url.pathname === "/api/studio/logout" && request.method === "POST") {
    requireAllowedOrigin(request, env);
    return studioLogout(request, env);
  }

  if (url.pathname === "/api/studio/messages" && request.method === "GET") {
    await requireStudioSession(request, env);
    return listStudioMessages(request, env);
  }

  const messageRoute = url.pathname.match(/^\/api\/studio\/messages\/([a-f0-9-]{36})$/u);
  if (messageRoute && request.method === "PATCH") {
    requireAllowedOrigin(request, env);
    await requireStudioSession(request, env);
    return updateStudioMessage(request, env, messageRoute[1]);
  }

  if (url.pathname.startsWith("/api/")) {
    return json({ ok: false, error: "Introuvable." }, 404);
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const assetPath = new Map([
    ["/", "/envoyer.html"],
    ["/envoyer", "/envoyer.html"],
    ["/studio", "/studio.html"],
    ["/confidentialite", "/confidentialite.html"]
  ]).get(url.pathname);

  if (assetPath) {
    const assetUrl = new URL(request.url);
    assetUrl.pathname = assetPath;
    return env.ASSETS.fetch(new Request(assetUrl, request));
  }

  return env.ASSETS.fetch(request);
}

async function submitMessage(request, env) {
  requireJsonRequest(request);
  const input = await readJson(request);

  // Bots often fill fields hidden from human visitors. Return a neutral success
  // response so the trap cannot be easily detected.
  if (String(input?.website ?? "").trim()) {
    return json({ ok: true, message: "Votre message a bien été transmis au studio." }, 202);
  }

  const validation = validateSubmission(input, numberFromEnv(env.MESSAGE_MAX_LENGTH, 500));
  if (!validation.ok) return json({ ok: false, error: validation.error }, 400);

  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const userAgent = request.headers.get("User-Agent") || "unknown";
  const senderHash = await hmacHex(requiredSecret(env, "IP_HASH_SECRET"), `${ip}\n${userAgent}`);

  const verificationLimit = await incrementRateLimit(env.DB, senderHash, "security-check", 20, 60);
  if (!verificationLimit) {
    return json({ ok: false, error: "Trop de tentatives. Merci de patienter." }, 429);
  }

  const turnstileValid = await verifyTurnstile(input.turnstileToken, ip, env);
  if (!turnstileValid) {
    return json({ ok: false, error: "La vérification de sécurité a échoué. Veuillez réessayer." }, 400);
  }

  const shortLimit = await incrementRateLimit(env.DB, senderHash, "send-short", 1, 120);
  if (!shortLimit) {
    return json(
      { ok: false, error: "Vous avez envoyé trop de messages. Merci de patienter avant de réessayer." },
      429,
      { "Retry-After": "120" }
    );
  }
  const dailyLimit = await incrementRateLimit(env.DB, senderHash, "send-day", 10, secondsUntilUtcMidnight());
  if (!dailyLimit) {
    return json(
      { ok: false, error: "La limite quotidienne de messages est atteinte. Merci de réessayer demain." },
      429
    );
  }

  const bodyAssessment = assessMessage(validation.value.body);
  const nameAssessment = assessMessage(validation.value.displayName);
  const assessment = {
    status: bodyAssessment.status === "quarantined" || nameAssessment.status === "quarantined"
      ? "quarantined"
      : "new",
    reasons: [...new Set([...bodyAssessment.reasons, ...nameAssessment.reasons])]
  };
  const messageHash = await sha256Hex(normalizeForFilter(validation.value.body));
  const now = unixNow();

  const duplicate = await env.DB.prepare(
    `SELECT id FROM messages
     WHERE sender_hash = ? AND message_hash = ? AND created_at > ?
     LIMIT 1`
  ).bind(senderHash, messageHash, now - 3600).first();

  if (duplicate) {
    return json({ ok: true, message: "Votre message a bien été transmis au studio." }, 202);
  }

  const blocked = await env.DB.prepare(
    "SELECT sender_hash FROM blocked_senders WHERE sender_hash = ? LIMIT 1"
  ).bind(senderHash).first();

  const status = blocked ? "quarantined" : assessment.status;
  const reasons = blocked
    ? [...assessment.reasons, "expéditeur_bloqué"]
    : assessment.reasons;

  await env.DB.prepare(
    `INSERT INTO messages
      (id, display_name, body, source, status, filter_reasons, sender_hash, message_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    crypto.randomUUID(),
    validation.value.displayName,
    validation.value.body,
    validation.value.source,
    status,
    reasons.length ? JSON.stringify(reasons) : null,
    senderHash,
    messageHash,
    now
  ).run();

  return json({ ok: true, message: "Votre message a bien été transmis au studio." }, 201);
}

async function studioLogin(request, env) {
  requireJsonRequest(request);
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const loginHash = await hmacHex(requiredSecret(env, "IP_HASH_SECRET"), `login\n${ip}`);
  const allowed = await incrementRateLimit(env.DB, loginHash, "login", 8, 15 * 60);
  if (!allowed) {
    return json({ ok: false, error: "Trop de tentatives. Réessayez plus tard." }, 429);
  }

  const input = await readJson(request);
  const valid = await constantTimeEqual(String(input?.password ?? ""), requiredSecret(env, "ADMIN_PASSWORD"));
  if (!valid) {
    return json({ ok: false, error: "Identifiants incorrects." }, 401);
  }

  const token = randomToken();
  const tokenHash = await sha256Hex(token);
  const now = unixNow();
  await env.DB.prepare(
    "INSERT INTO studio_sessions (token_hash, created_at, expires_at) VALUES (?, ?, ?)"
  ).bind(tokenHash, now, now + SESSION_SECONDS).run();

  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return json(
    { ok: true },
    200,
    {
      "Set-Cookie": `${SESSION_COOKIE}=${token}; HttpOnly${secure}; SameSite=Strict; Path=/; Max-Age=${SESSION_SECONDS}`
    }
  );
}

async function studioLogout(request, env) {
  const token = cookieValue(request, SESSION_COOKIE);
  if (token) {
    await env.DB.prepare("DELETE FROM studio_sessions WHERE token_hash = ?")
      .bind(await sha256Hex(token))
      .run();
  }
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return json(
    { ok: true },
    200,
    { "Set-Cookie": `${SESSION_COOKIE}=; HttpOnly${secure}; SameSite=Strict; Path=/; Max-Age=0` }
  );
}

async function requireStudioSession(request, env) {
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token) throw new HttpError(401, "Connexion requise.");

  const tokenHash = await sha256Hex(token);
  const session = await env.DB.prepare(
    "SELECT expires_at FROM studio_sessions WHERE token_hash = ? LIMIT 1"
  ).bind(tokenHash).first();

  if (!session || Number(session.expires_at) <= unixNow()) {
    if (session) {
      await env.DB.prepare("DELETE FROM studio_sessions WHERE token_hash = ?").bind(tokenHash).run();
    }
    throw new HttpError(401, "Session expirée.");
  }
}

async function listStudioMessages(request, env) {
  const url = new URL(request.url);
  const requestedStatus = url.searchParams.get("status") || "active";
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 100, 1), 200);

  let where = "status IN ('new', 'read')";
  const bindings = [];
  const validStatuses = new Set(["new", "read", "archived", "quarantined", "blocked"]);
  if (validStatuses.has(requestedStatus)) {
    where = "status = ?";
    bindings.push(requestedStatus);
  } else if (requestedStatus === "all") {
    where = "1 = 1";
  }

  const statement = env.DB.prepare(
    `SELECT id, display_name, body, source, status, filter_reasons, created_at, reviewed_at
     FROM messages WHERE ${where}
     ORDER BY CASE status WHEN 'new' THEN 0 WHEN 'quarantined' THEN 1 ELSE 2 END,
              created_at DESC
     LIMIT ?`
  ).bind(...bindings, limit);

  const [messageResult, statsResult] = await Promise.all([
    statement.all(),
    env.DB.prepare(
      `SELECT
        SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END) AS new_count,
        SUM(CASE WHEN status = 'quarantined' THEN 1 ELSE 0 END) AS quarantined_count,
        SUM(CASE WHEN status = 'archived' THEN 1 ELSE 0 END) AS archived_count
       FROM messages`
    ).first()
  ]);

  const messages = (messageResult.results || []).map((item) => ({
    ...item,
    filter_reasons: parseReasons(item.filter_reasons)
  }));

  return json({
    ok: true,
    messages,
    stats: {
      new: Number(statsResult?.new_count || 0),
      quarantined: Number(statsResult?.quarantined_count || 0),
      archived: Number(statsResult?.archived_count || 0)
    }
  });
}

async function updateStudioMessage(request, env, messageId) {
  requireJsonRequest(request);
  const input = await readJson(request);
  const allowedStatuses = new Set(["new", "read", "archived", "blocked"]);
  if (!allowedStatuses.has(input?.status)) {
    return json({ ok: false, error: "Action non autorisée." }, 400);
  }

  const message = await env.DB.prepare(
    "SELECT id, sender_hash FROM messages WHERE id = ? LIMIT 1"
  ).bind(messageId).first();
  if (!message) return json({ ok: false, error: "Message introuvable." }, 404);

  const now = unixNow();
  const statements = [
    env.DB.prepare("UPDATE messages SET status = ?, reviewed_at = ? WHERE id = ?")
      .bind(input.status, now, messageId),
    env.DB.prepare("INSERT INTO audit_log (action, message_id, created_at) VALUES (?, ?, ?)")
      .bind(`status:${input.status}`, messageId, now)
  ];

  if (input.status === "blocked") {
    statements.push(
      env.DB.prepare(
        `INSERT INTO blocked_senders (sender_hash, created_at, reason)
         VALUES (?, ?, 'studio')
         ON CONFLICT(sender_hash) DO UPDATE SET created_at = excluded.created_at`
      ).bind(message.sender_hash, now)
    );
  }

  await env.DB.batch(statements);
  return json({ ok: true });
}

async function verifyTurnstile(token, remoteIp, env) {
  if (!token || !env.TURNSTILE_SECRET_KEY) return false;
  const body = new URLSearchParams({
    secret: env.TURNSTILE_SECRET_KEY,
    response: String(token),
    remoteip: remoteIp
  });

  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body
    });
    const result = await response.json();
    return result.success === true && (!result.action || result.action === "send-message");
  } catch (error) {
    console.error("Turnstile validation failed", error);
    return false;
  }
}

async function incrementRateLimit(db, rateKey, bucket, maximum, windowSeconds) {
  const now = unixNow();
  const current = await db.prepare(
    "SELECT request_count, reset_at FROM rate_limits WHERE rate_key = ? AND bucket = ?"
  ).bind(rateKey, bucket).first();

  if (!current || Number(current.reset_at) <= now) {
    await db.prepare(
      `INSERT INTO rate_limits (rate_key, bucket, request_count, reset_at)
       VALUES (?, ?, 1, ?)
       ON CONFLICT(rate_key, bucket)
       DO UPDATE SET request_count = 1, reset_at = excluded.reset_at`
    ).bind(rateKey, bucket, now + Math.max(windowSeconds, 1)).run();
    return true;
  }

  if (Number(current.request_count) >= maximum) return false;
  await db.prepare(
    "UPDATE rate_limits SET request_count = request_count + 1 WHERE rate_key = ? AND bucket = ?"
  ).bind(rateKey, bucket).run();
  return true;
}

async function cleanExpiredData(env) {
  const now = unixNow();
  const retentionDays = numberFromEnv(env.RETENTION_DAYS, 30);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM messages WHERE created_at < ?").bind(now - retentionDays * 86400),
    env.DB.prepare("DELETE FROM rate_limits WHERE reset_at < ?").bind(now),
    env.DB.prepare("DELETE FROM studio_sessions WHERE expires_at < ?").bind(now),
    env.DB.prepare("DELETE FROM blocked_senders WHERE created_at < ?").bind(now - 90 * 86400),
    env.DB.prepare("DELETE FROM audit_log WHERE created_at < ?").bind(now - 90 * 86400)
  ]);
}

function requireAllowedOrigin(request, env) {
  if (!isAllowedOrigin(request, env)) throw new HttpError(403, "Origine non autorisée.");
}

function requireJsonRequest(request) {
  const contentType = request.headers.get("Content-Type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new HttpError(415, "Le format de la requête n'est pas accepté.");
  }
}

function isAllowedOrigin(request, env) {
  const origin = request.headers.get("Origin");
  if (!origin) return false;
  const sameOrigin = new URL(request.url).origin;
  const configured = String(env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return origin === sameOrigin || configured.includes(origin);
}

function secureResponse(response, request, env) {
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  headers.set(
    "Content-Security-Policy",
    "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; img-src 'self' data:; style-src 'self'; script-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; connect-src 'self' https://challenges.cloudflare.com"
  );
  if (new URL(request.url).protocol === "https:") {
    headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  if (isAllowedOrigin(request, env)) {
    for (const [name, value] of Object.entries(corsHeaders(request))) headers.set(name, value);
  }
  if (new URL(request.url).pathname.startsWith("/api/") || new URL(request.url).pathname === "/studio") {
    headers.set("Cache-Control", "no-store");
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function corsHeaders(request) {
  return {
    "Access-Control-Allow-Origin": request.headers.get("Origin") || "",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Credentials": "true",
    "Vary": "Origin"
  };
}

async function readJson(request) {
  const declaredLength = Number(request.headers.get("Content-Length") || 0);
  if (declaredLength > 12_000) throw new HttpError(413, "Requête trop volumineuse.");
  const text = await request.text();
  if (text.length > 12_000) throw new HttpError(413, "Requête trop volumineuse.");
  try {
    return JSON.parse(text || "{}");
  } catch {
    throw new HttpError(400, "Requête invalide.");
  }
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...extraHeaders }
  });
}

function cookieValue(request, name) {
  const cookies = request.headers.get("Cookie") || "";
  for (const part of cookies.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return "";
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(String(value)));
  return bytesToHex(new Uint8Array(digest));
}

async function hmacHex(secret, value) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return bytesToHex(new Uint8Array(signature));
}

function bytesToHex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function constantTimeEqual(left, right) {
  const [leftHash, rightHash] = await Promise.all([sha256Hex(left), sha256Hex(right)]);
  let difference = 0;
  for (let index = 0; index < leftHash.length; index += 1) {
    difference |= leftHash.charCodeAt(index) ^ rightHash.charCodeAt(index);
  }
  return difference === 0;
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/u, "");
}

function requiredSecret(env, name) {
  const value = String(env[name] || "");
  if (!value) throw new Error(`Missing required secret: ${name}`);
  return value;
}

function parseReasons(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function numberFromEnv(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function unixNow() {
  return Math.floor(Date.now() / 1000);
}

function secondsUntilUtcMidnight() {
  const now = new Date();
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(Math.ceil((next - now.getTime()) / 1000), 1);
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
