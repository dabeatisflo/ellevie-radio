const form = document.querySelector("#message-form");
const nameInput = document.querySelector("#display-name");
const messageInput = document.querySelector("#message");
const websiteInput = document.querySelector("#website");
const submitButton = document.querySelector("#submit-button");
const formStatus = document.querySelector("#form-status");
const securityError = document.querySelector("#security-error");
const characterCount = document.querySelector("#character-count");
const sentMessages = document.querySelector("#sent-messages");

let turnstileWidgetId = null;
let turnstileToken = "";
let maxLength = 500;

messageInput.addEventListener("input", () => {
  characterCount.textContent = `${messageInput.value.length}/${maxLength}`;
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  formStatus.textContent = "";
  formStatus.className = "form-status";

  if (!form.reportValidity()) return;
  if (!turnstileToken) {
    setStatus("Veuillez terminer la vérification de sécurité.", true);
    return;
  }

  submitButton.disabled = true;
  submitButton.textContent = "…";

  try {
    const submittedName = nameInput.value.trim();
    const submittedMessage = messageInput.value.trim();
    const source = new URLSearchParams(window.location.search).get("source") === "app" ? "app" : "web";
    const response = await fetch("/api/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        displayName: nameInput.value,
        message: messageInput.value,
        website: websiteInput.value,
        turnstileToken,
        source
      })
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "L'envoi a échoué.");

    appendSentMessage(submittedName, submittedMessage);
    messageInput.value = "";
    websiteInput.value = "";
    characterCount.textContent = `0/${maxLength}`;
    setStatus(result.message || "Votre message a bien été transmis au studio.", false);
  } catch (error) {
    setStatus(error.message || "Impossible d'envoyer le message.", true);
  } finally {
    resetTurnstile();
    submitButton.textContent = "➤";
  }
});

initialize();

async function initialize() {
  try {
    const response = await fetch("/api/config", { credentials: "same-origin" });
    const config = await response.json();
    if (!response.ok || !config.turnstileSiteKey) throw new Error("Configuration indisponible.");

    maxLength = Number(config.messageMaxLength) || 500;
    messageInput.maxLength = maxLength;
    characterCount.textContent = `0/${maxLength}`;
    await loadTurnstile();

    turnstileWidgetId = window.turnstile.render("#turnstile", {
      sitekey: config.turnstileSiteKey,
      action: "send-message",
      theme: "light",
      language: "fr",
      callback(token) {
        turnstileToken = token;
        submitButton.disabled = false;
        securityError.hidden = true;
      },
      "expired-callback"() {
        turnstileToken = "";
        submitButton.disabled = true;
      },
      "error-callback"() {
        turnstileToken = "";
        submitButton.disabled = true;
        securityError.textContent = "La vérification n'a pas pu démarrer. Vérifiez votre connexion.";
        securityError.hidden = false;
      }
    });
  } catch (error) {
    securityError.textContent = "Le formulaire est momentanément indisponible. Veuillez réessayer plus tard.";
    securityError.hidden = false;
  }
}

function loadTurnstile() {
  return new Promise((resolve, reject) => {
    if (window.turnstile) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    script.addEventListener("load", resolve, { once: true });
    script.addEventListener("error", reject, { once: true });
    document.head.append(script);
  });
}

function resetTurnstile() {
  turnstileToken = "";
  submitButton.disabled = true;
  if (window.turnstile && turnstileWidgetId !== null) window.turnstile.reset(turnstileWidgetId);
}

function setStatus(message, isError) {
  formStatus.textContent = message;
  formStatus.className = isError ? "form-status is-error" : "form-status is-success";
}

function appendSentMessage(name, message) {
  const bubble = document.createElement("div");
  bubble.className = "sent-bubble";

  const text = document.createElement("span");
  text.textContent = message;
  const meta = document.createElement("small");
  meta.textContent = `${name} · ${new Intl.DateTimeFormat("fr-BE", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Brussels"
  }).format(new Date())}`;

  bubble.append(text, meta);
  sentMessages.append(bubble);
  bubble.scrollIntoView({ behavior: "smooth", block: "nearest" });
}
