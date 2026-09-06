const HARD_BLOCKED_TERMS = [
  "batard",
  "bitch",
  "con",
  "conne",
  "connard",
  "connasse",
  "encule",
  "enculee",
  "enculer",
  "fdp",
  "ferme ta gueule",
  "fuck",
  "hoer",
  "nique ta mere",
  "ntm",
  "pute",
  "putain",
  "salope",
  "suicide-toi",
  "va te faire foutre",
  "va mourir"
];

const THREAT_PATTERNS = [
  /\bje\s+vais\s+(?:te|vous)\s+(?:tuer|frapper|retrouver)\b/u,
  /\btu\s+vas\s+mourir\b/u,
  /\bon\s+sait\s+ou\s+tu\s+habites\b/u
];

const SPAM_PATTERNS = [
  /\b(?:bitcoin|crypto|forex|casino|jackpot)\b/u,
  /\b(?:gagnez|gagner)\s+(?:vite|facilement|de\s+l.argent)\b/u,
  /\b(?:promo|reduction)\s*\d{2,3}\s*%/u
];

const URL_PATTERN = /(?:https?:\/\/|www\.|\b[a-z0-9-]+\.(?:com|net|org|fr|be|io|ru|cn)\b)/iu;
const EMAIL_PATTERN = /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/iu;
const PHONE_PATTERN = /(?:\+\d{1,3}[\s.-]?)?(?:\d[\s.-]?){9,}/u;
const REPEATED_CHARACTER_PATTERN = /(.)\1{11,}/u;

export function normalizeForFilter(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/0/g, "o")
    .replace(/[1|]/g, "i")
    .replace(/3/g, "e")
    .replace(/4/g, "a")
    .replace(/5/g, "s")
    .replace(/7/g, "t")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function containsTerm(normalized, term) {
  const termNormalized = normalizeForFilter(term);
  return (` ${normalized} `).includes(` ${termNormalized} `);
}

export function assessMessage(body) {
  const raw = String(body ?? "");
  const normalized = normalizeForFilter(raw);
  const reasons = [];

  if (URL_PATTERN.test(raw)) reasons.push("lien");
  if (EMAIL_PATTERN.test(raw) || PHONE_PATTERN.test(raw)) reasons.push("coordonnées");
  if (REPEATED_CHARACTER_PATTERN.test(raw)) reasons.push("répétition");
  if (HARD_BLOCKED_TERMS.some((term) => containsTerm(normalized, term))) {
    reasons.push("langage_inapproprié");
  }
  if (THREAT_PATTERNS.some((pattern) => pattern.test(normalized))) {
    reasons.push("menace");
  }
  if (SPAM_PATTERNS.some((pattern) => pattern.test(normalized))) {
    reasons.push("spam");
  }

  return {
    normalized,
    status: reasons.length > 0 ? "quarantined" : "new",
    reasons: [...new Set(reasons)]
  };
}

export function validateSubmission(input, maxLength = 500) {
  const displayName = String(input?.displayName ?? "").trim().replace(/\s+/g, " ");
  const body = String(input?.message ?? "").trim().replace(/\r\n?/g, "\n");
  const source = input?.source === "app" ? "app" : "web";

  if (displayName.length < 2 || displayName.length > 40) {
    return { ok: false, error: "Le prénom doit contenir entre 2 et 40 caractères." };
  }
  if (body.length < 2 || body.length > maxLength) {
    return { ok: false, error: `Le message doit contenir entre 2 et ${maxLength} caractères.` };
  }
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(body + displayName)) {
    return { ok: false, error: "Le message contient des caractères non autorisés." };
  }

  return { ok: true, value: { displayName, body, source } };
}
