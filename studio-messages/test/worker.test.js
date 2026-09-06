import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/worker.js";

const baseEnv = {
  TURNSTILE_SITE_KEY: "test-site-key",
  MESSAGE_MAX_LENGTH: "500",
  ALLOWED_ORIGINS: "https://ellevie.fr"
};

test("public config does not expose secrets", async () => {
  const response = await worker.fetch(new Request("https://messages.example/api/config"), baseEnv);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body, { turnstileSiteKey: "test-site-key", messageMaxLength: 500 });
  assert.equal(Object.hasOwn(body, "TURNSTILE_SECRET_KEY"), false);
});

test("security headers are attached to API responses", async () => {
  const response = await worker.fetch(new Request("https://messages.example/api/config"), baseEnv);

  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.match(response.headers.get("content-security-policy"), /frame-ancestors 'none'/u);
  assert.match(response.headers.get("strict-transport-security"), /max-age=31536000/u);
});

test("cross-site message submission is rejected before database access", async () => {
  const request = new Request("https://messages.example/api/messages", {
    method: "POST",
    headers: { Origin: "https://attacker.example", "Content-Type": "application/json" },
    body: JSON.stringify({ displayName: "Marie", message: "Bonjour" })
  });
  const response = await worker.fetch(request, baseEnv);
  const body = await response.json();

  assert.equal(response.status, 403);
  assert.equal(body.ok, false);
});

test("unknown API route returns JSON 404", async () => {
  const response = await worker.fetch(new Request("https://messages.example/api/unknown"), baseEnv);
  assert.equal(response.status, 404);
  assert.equal((await response.json()).ok, false);
});
