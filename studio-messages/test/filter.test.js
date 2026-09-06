import test from "node:test";
import assert from "node:assert/strict";
import { assessMessage, normalizeForFilter, validateSubmission } from "../src/filter.js";

test("normalise accents and simple leetspeak", () => {
  assert.equal(normalizeForFilter("ÉLLÈVIE  R4DIO!"), "ellevie radio");
});

test("accepts a normal studio message", () => {
  const result = assessMessage("Bonjour Nora, merci pour cette belle matinée !");
  assert.equal(result.status, "new");
  assert.deepEqual(result.reasons, []);
});

test("quarantines links and spam", () => {
  const result = assessMessage("Promo crypto sur https://example.com");
  assert.equal(result.status, "quarantined");
  assert.ok(result.reasons.includes("lien"));
  assert.ok(result.reasons.includes("spam"));
});

test("quarantines obfuscated offensive language", () => {
  const result = assessMessage("Quelle s4l0pe");
  assert.equal(result.status, "quarantined");
  assert.ok(result.reasons.includes("langage_inapproprié"));
});

test("quarantines contact details", () => {
  const result = assessMessage("Écris-moi à test@example.com ou au +32 470 12 34 56");
  assert.equal(result.status, "quarantined");
  assert.ok(result.reasons.includes("coordonnées"));
});

test("validates and cleans listener input", () => {
  const result = validateSubmission({
    displayName: "  Marie   Claire ",
    message: " Bonjour\r\nEllevie ",
    source: "app"
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, {
    displayName: "Marie Claire",
    body: "Bonjour\nEllevie",
    source: "app"
  });
});

test("rejects oversized messages", () => {
  const result = validateSubmission({ displayName: "Marie", message: "a".repeat(501) }, 500);
  assert.equal(result.ok, false);
});
