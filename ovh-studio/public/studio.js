const loginPanel = document.querySelector("#login-panel");
const loginForm = document.querySelector("#login-form");
const loginStatus = document.querySelector("#login-status");
const operatorInput = document.querySelector("#operator-name");
const passwordInput = document.querySelector("#password");
const dashboard = document.querySelector("#dashboard");
const dashboardStatus = document.querySelector("#dashboard-status");
const messageList = document.querySelector("#message-list");
const emptyState = document.querySelector("#empty-state");
const refreshButton = document.querySelector("#refresh-button");
const logoutButton = document.querySelector("#logout-button");
const connectionState = document.querySelector("#connection-state");
const operatorDisplay = document.querySelector("#operator-display");
const soundToggle = document.querySelector("#sound-toggle");
const newCount = document.querySelector("#new-count");
const quarantinedCount = document.querySelector("#quarantined-count");
const archivedCount = document.querySelector("#archived-count");
const listTitle = document.querySelector("#list-title");
const filterButtons = [...document.querySelectorAll("[data-status]")];
const settingsButton = document.querySelector("#settings-button");
const settingsPanel = document.querySelector("#settings-panel");
const settingsClose = document.querySelector("#settings-close");
const passwordForm = document.querySelector("#password-form");
const currentPasswordInput = document.querySelector("#current-password");
const newPasswordInput = document.querySelector("#new-password");
const confirmPasswordInput = document.querySelector("#confirm-password");
const passwordStatus = document.querySelector("#password-status");

let currentStatus = "active";
let currentOperatorName = "";
let currentClaims = {};
let pollTimer = null;
let knownNewestId = null;
let hasLoadedOnce = false;
let renderedMessagesSignature = "";
let lastNativeMessage = "";
let lastNativeMessageAt = 0;
const replyDrafts = new Map();
const claimHeartbeatAt = new Map();
const nativePush = { token: "", enabled: false, platform: "android" };

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginStatus.textContent = "Connexion…";
  loginStatus.className = "form-status";
  try {
    const response = await apiFetch("/api/studio/login", {
      method: "POST",
      body: JSON.stringify({
        operatorName: operatorInput.value,
        password: passwordInput.value
      })
    });
    if (!response.ok) throw new Error(response.error || "Connexion impossible.");
    currentOperatorName = response.operatorName || operatorInput.value.trim();
    passwordInput.value = "";
    showDashboard();
    await loadMessages(true);
  } catch (error) {
    loginStatus.textContent = error.message;
    loginStatus.className = "form-status is-error";
  }
});

logoutButton.addEventListener("click", async () => {
  await syncStudioPushSubscription(false).catch(() => null);
  await apiFetch("/api/studio/logout", { method: "POST", body: "{}" }).catch(() => null);
  postNativeMessage("studioLoggedOut");
  showLogin();
});

settingsButton.addEventListener("click", openSettings);
settingsClose.addEventListener("click", closeSettings);
settingsPanel.addEventListener("click", (event) => {
  if (event.target === settingsPanel) closeSettings();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !settingsPanel.hidden) closeSettings();
});

passwordForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  passwordStatus.textContent = "Enregistrement…";
  passwordStatus.className = "form-status";
  if (newPasswordInput.value !== confirmPasswordInput.value) {
    passwordStatus.textContent = "Les deux nouveaux mots de passe ne correspondent pas.";
    passwordStatus.className = "form-status is-error";
    return;
  }
  const submitButton = passwordForm.querySelector("button[type='submit']");
  submitButton.disabled = true;
  try {
    const response = await apiFetch("/api/studio/password", {
      method: "POST",
      body: JSON.stringify({
        currentPassword: currentPasswordInput.value,
        newPassword: newPasswordInput.value,
        confirmation: confirmPasswordInput.value
      })
    });
    if (response.statusCode === 401 && response.error === "Session expirée.") {
      closeSettings();
      showLogin(response.error);
      return;
    }
    if (!response.ok) throw new Error(response.error || "Modification impossible.");
    passwordForm.reset();
    passwordStatus.textContent = response.message;
    passwordStatus.className = "form-status is-success";
  } catch (error) {
    passwordStatus.textContent = error.message;
    passwordStatus.className = "form-status is-error";
  } finally {
    submitButton.disabled = false;
  }
});

refreshButton.addEventListener("click", () => loadMessages(true));

for (const button of filterButtons) {
  button.addEventListener("click", async () => {
    currentStatus = button.dataset.status;
    filterButtons.forEach((item) => item.classList.toggle("is-active", item === button));
    listTitle.textContent = new Map([
      ["active", "Messages récents"],
      ["quarantined", "Messages à vérifier"],
      ["archived", "Messages archivés"],
      ["all", "Tous les messages"]
    ]).get(currentStatus) || "Messages";
    await loadMessages(true);
  });
}

messageList.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-message-id]");
  if (!button || !button.dataset.nextStatus) return;
  button.disabled = true;
  try {
    const response = await apiFetch(`/api/studio/messages/${button.dataset.messageId}`, {
      method: "PATCH",
      body: JSON.stringify({ status: button.dataset.nextStatus })
    });
    if (!response.ok) throw new Error(response.error || "Action impossible.");
    await loadMessages(true);
  } catch (error) {
    setDashboardError(error.message);
    button.disabled = false;
  }
});

messageList.addEventListener("focusin", (event) => {
  const input = event.target.closest("textarea.reply-input");
  const form = input?.closest("form.reply-form");
  if (form) void ensureConversationClaim(form, true);
});

messageList.addEventListener("submit", async (event) => {
  const form = event.target.closest("form.reply-form");
  if (!form) return;
  event.preventDefault();
  const input = form.querySelector("textarea");
  const button = form.querySelector("button[type='submit']");
  const message = input.value.trim();
  if (!message) return;

  button.disabled = true;
  if (!(await ensureConversationClaim(form, true))) {
    button.disabled = false;
    return;
  }
  dashboardStatus.textContent = "Envoi de la réponse…";
  dashboardStatus.className = "form-status";
  try {
    const response = await apiFetch(`/api/studio/messages/${form.dataset.messageId}/reply`, {
      method: "POST",
      body: JSON.stringify({ message })
    });
    if (response.statusCode === 401) {
      showLogin("Votre session a expiré.");
      return;
    }
    if (!response.ok) throw new Error(response.error || "Réponse impossible.");
    input.value = "";
    replyDrafts.delete(replyDraftKey(form));
    claimHeartbeatAt.delete(form.dataset.conversationKey);
    dashboardStatus.textContent = "Réponse envoyée à l'application.";
    dashboardStatus.className = "form-status is-success";
    await loadMessages(true);
  } catch (error) {
    setDashboardError(error.message);
    button.disabled = false;
    await loadMessages(true);
  }
});

messageList.addEventListener("input", (event) => {
  const input = event.target.closest("textarea.reply-input");
  const form = input?.closest("form.reply-form");
  if (!form) return;
  const draftKey = replyDraftKey(form);
  if (input.value) replyDrafts.set(draftKey, input.value);
  else replyDrafts.delete(draftKey);
  const lastHeartbeat = claimHeartbeatAt.get(form.dataset.conversationKey) || 0;
  if (Date.now() - lastHeartbeat > 120000) void ensureConversationClaim(form, false);
});

messageList.addEventListener("keydown", (event) => {
  const input = event.target.closest("textarea.reply-input");
  const isEnter = event.key === "Enter" || event.code === "NumpadEnter" || event.keyCode === 13;
  if (!input || !isEnter || event.isComposing) return;
  event.preventDefault();
  const form = input.closest("form.reply-form");
  const button = form?.querySelector("button[type='submit']");
  if (!form || !input.value.trim() || button?.disabled) return;
  if (typeof form.requestSubmit === "function") form.requestSubmit();
  else button.click();
});

checkExistingSession();

async function checkExistingSession() {
  const response = await apiFetch("/api/studio/messages?status=active&limit=1").catch(() => null);
  if (response?.ok) {
    currentOperatorName = response.operatorName || "Studio";
    showDashboard();
    await loadMessages();
  } else {
    showLogin();
  }
}

async function loadMessages(manual = false) {
  const focusState = captureFocusedReply();
  captureReplyDrafts();
  if (manual) refreshButton.disabled = true;
  try {
    const result = await apiFetch(`/api/studio/messages?status=${encodeURIComponent(currentStatus)}&limit=200`);
    if (result.statusCode === 401) {
      showLogin("Votre session a expiré.");
      return;
    }
    if (!result.ok) throw new Error(result.error || "Chargement impossible.");

    currentOperatorName = result.operatorName || currentOperatorName || "Studio";
    currentClaims = result.claims && typeof result.claims === "object" ? result.claims : {};
    operatorDisplay.textContent = currentOperatorName;
    connectionState.textContent = "En ligne";
    connectionState.classList.remove("is-offline");
    dashboardStatus.textContent = "";
    updateStats(result.stats);

    const nextSignature = JSON.stringify([result.messages, currentClaims]);
    if (!studioAudioIsActive() && nextSignature !== renderedMessagesSignature) {
      renderMessages(result.messages);
      renderedMessagesSignature = nextSignature;
      restoreFocusedReply(focusState);
    }

    const newest = result.messages.find((message) => message.status === "new");
    if (hasLoadedOnce && newest && knownNewestId && newest.id !== knownNewestId && soundToggle.checked) {
      playNotification();
    }
    if (newest) knownNewestId = newest.id;
    hasLoadedOnce = true;
  } catch (error) {
    connectionState.textContent = "Connexion interrompue";
    connectionState.classList.add("is-offline");
    setDashboardError("Impossible d'actualiser. Nouvelle tentative automatique…");
  } finally {
    refreshButton.disabled = false;
  }
}

function studioAudioIsActive() {
  return [...messageList.querySelectorAll("audio")].some((audio) => !audio.paused && !audio.ended);
}

function renderMessages(messages) {
  messageList.replaceChildren();
  emptyState.hidden = messages.length > 0;

  for (const conversation of groupMessagesByListener(messages)) {
    const claim = activeClaimFor(conversation.key);
    const groupStatus = conversation.newCount > 0 ? "new" : conversation.latestMessage.status;
    const card = element("article", `message-card conversation-card status-${groupStatus}`);
    if (claim && !claim.isMine) card.classList.add("is-claimed-by-other");
    const header = element("header", "message-card-header");
    const identity = element("div", "conversation-identity");
    identity.append(
      element("strong", "listener-name", conversation.displayName),
      element("span", "message-time", `Dernière activité · ${formatDate(conversation.latestAt)}`)
    );
    const summary = element("div", "conversation-summary");
    const countText = `${conversation.messages.length} message${conversation.messages.length > 1 ? "s" : ""}`
      + (conversation.replyCount ? ` · ${conversation.replyCount} réponse${conversation.replyCount > 1 ? "s" : ""}` : "");
    summary.append(element("span", "conversation-count", countText));
    if (claim) {
      summary.append(element(
        "span",
        claim.isMine ? "claim-badge is-mine" : "claim-badge is-other",
        claim.isMine ? "Réservée par vous" : `Traitée par ${claim.operatorName}`
      ));
    } else if (conversation.newCount > 0) {
      const badge = statusBadge("new");
      badge.textContent = `${conversation.newCount} nouveau${conversation.newCount > 1 ? "x" : ""}`;
      summary.append(badge);
    } else {
      summary.append(statusBadge(conversation.latestMessage.status));
    }
    header.append(identity, summary);
    card.append(header);

    const thread = element("section", "conversation-thread");
    thread.setAttribute("aria-label", `Conversation avec ${conversation.displayName}`);
    for (const timelineEvent of conversation.events) {
      thread.append(timelineEvent.type === "reply"
        ? createStudioReply(timelineEvent.reply)
        : createConversationMessage(timelineEvent.message));
    }
    card.append(thread);

    const replyTarget = conversation.messages.find(
      (message) => message.can_reply && message.status !== "blocked"
    );
    if (replyTarget) {
      card.append(createReplyForm(
        replyTarget.id,
        conversation.key,
        replyDrafts.get(conversation.key) || "",
        claim
      ));
    } else if (conversation.messages.every((message) => !message.can_reply)) {
      card.append(element("p", "reply-unavailable", "Réponse disponible pour les nouveaux messages envoyés après la mise à jour."));
    }
    messageList.append(card);
  }
}

function groupMessagesByListener(messages) {
  const grouped = new Map();
  for (const message of messages) {
    const key = String(message.conversation_key || `message:${message.id}`);
    if (!grouped.has(key)) grouped.set(key, { key, messages: [] });
    grouped.get(key).messages.push(message);
  }

  return [...grouped.values()]
    .map((conversation) => {
      conversation.messages.sort((first, second) => Number(second.created_at) - Number(first.created_at));
      conversation.latestMessage = conversation.messages[0];
      conversation.displayName = conversation.latestMessage.display_name;
      conversation.newCount = conversation.messages.filter((message) => message.status === "new").length;
      conversation.replyCount = conversation.messages.reduce(
        (total, message) => total + (Array.isArray(message.replies) ? message.replies.length : 0),
        0
      );
      conversation.events = [];
      for (const message of conversation.messages) {
        conversation.events.push({ type: "message", message, createdAt: Number(message.created_at) });
        for (const reply of message.replies || []) {
          conversation.events.push({ type: "reply", reply, createdAt: Number(reply.created_at) });
        }
      }
      conversation.events.sort((first, second) => second.createdAt - first.createdAt);
      conversation.latestAt = conversation.events[0]?.createdAt || Number(conversation.latestMessage.created_at);
      return conversation;
    })
    .sort((first, second) => second.latestAt - first.latestAt);
}

function createConversationMessage(message) {
  const entry = element("article", `conversation-message status-${message.status}`);
  const header = element("header", "conversation-message-header");
  const typeLabel = message.content_type === "voice" ? "Message vocal" : "Message texte";
  header.append(
    element("span", "conversation-message-type", typeLabel),
    element("span", "message-time", formatDate(message.created_at)),
    statusBadge(message.status)
  );
  const body = message.content_type === "voice" && message.voice_id
    ? createStudioVoicePlayer(message)
    : element("p", "message-body", message.body);
  entry.append(header, body);

  if (message.filter_reasons?.length) {
    const reasons = element("div", "filter-reasons");
    reasons.append(element("span", "filter-label", "Filtre :"));
    for (const reason of message.filter_reasons) {
      reasons.append(element("span", "reason-chip", reason.replaceAll("_", " ")));
    }
    entry.append(reasons);
  }

  const footer = element("footer", "message-actions");
  if (message.status !== "read") footer.append(actionButton(message.id, "Lu", "read", "button-read"));
  if (message.status !== "archived") footer.append(actionButton(message.id, "Archiver", "archived", "button-archive"));
  if (message.status !== "blocked") footer.append(actionButton(message.id, "Bloquer", "blocked", "button-block"));
  entry.append(footer);
  return entry;
}

function createStudioReply(reply) {
  const entry = element("article", "conversation-message studio-answer");
  const header = element("header", "conversation-message-header");
  header.append(
    element("span", "conversation-message-type", `Réponse de ${reply.operator_name || "Studio"}`),
    element("span", "message-time", formatDate(reply.created_at))
  );
  entry.append(header, element("p", "message-body", reply.body));
  return entry;
}

function createReplyForm(messageId, conversationKey, draft = "", claim = null) {
  const form = element("form", "reply-form");
  form.dataset.messageId = messageId;
  form.dataset.conversationKey = conversationKey;
  const label = element("label", "visually-hidden", "Réponse du studio");
  const input = element("textarea", "reply-input");
  const inputId = `reply-${messageId}`;
  label.htmlFor = inputId;
  input.id = inputId;
  input.rows = 2;
  input.maxLength = 500;
  input.required = true;
  input.placeholder = "Écrire une réponse à l'auditrice…";
  input.value = draft;
  const button = element("button", "reply-button", "Répondre");
  button.type = "submit";
  const note = element("span", "claim-note", "Cliquez dans le champ pour réserver la conversation pendant 10 minutes.");
  if (claim?.isMine) {
    form.dataset.claimOwned = "true";
    note.textContent = "Conversation réservée par vous pendant 10 minutes.";
  } else if (claim) {
    form.classList.add("is-locked");
    input.disabled = true;
    button.disabled = true;
    input.placeholder = `Traitée actuellement par ${claim.operatorName}`;
    note.textContent = `Réponse verrouillée : ${claim.operatorName} traite cette conversation.`;
  }
  form.append(label, input, button, note);
  return form;
}

async function ensureConversationClaim(form, showError) {
  if (form.classList.contains("is-locked")) {
    if (showError) setDashboardError(form.querySelector(".claim-note")?.textContent || "Conversation déjà traitée.");
    return false;
  }
  const conversationKey = form.dataset.conversationKey;
  if (!conversationKey || conversationKey.startsWith("message:")) return false;
  const lastHeartbeat = claimHeartbeatAt.get(conversationKey) || 0;
  if (form.dataset.claimOwned === "true" && Date.now() - lastHeartbeat < 120000) return true;
  try {
    const result = await apiFetch("/api/studio/claims", {
      method: "POST",
      body: JSON.stringify({ conversationKey })
    });
    if (result.statusCode === 401) {
      showLogin("Votre session a expiré.");
      return false;
    }
    if (!result.ok) throw new Error(result.error || "Cette conversation ne peut pas être réservée.");
    form.dataset.claimOwned = "true";
    claimHeartbeatAt.set(conversationKey, Date.now());
    const note = form.querySelector(".claim-note");
    if (note) note.textContent = "Conversation réservée par vous pendant 10 minutes.";
    return true;
  } catch (error) {
    if (showError) setDashboardError(error.message);
    await loadMessages(true);
    return false;
  }
}

function activeClaimFor(conversationKey) {
  const claim = currentClaims[conversationKey];
  return claim && Number(claim.expiresAt) * 1000 > Date.now() ? claim : null;
}

function createStudioVoicePlayer(message) {
  const wrap = element("section", "studio-voice");
  const label = element("strong", "studio-voice-label", "Message vocal");
  const audio = document.createElement("audio");
  audio.className = "studio-voice-audio";
  audio.controls = true;
  audio.preload = "auto";
  audio.src = `/api/voice/${encodeURIComponent(message.voice_id)}?complete=1`;
  const duration = element("span", "studio-voice-duration", `Durée ${formatDuration(Number(message.voice_duration) || 0)}`);
  wrap.append(label, audio, duration);
  return wrap;
}

function captureReplyDrafts() {
  for (const input of messageList.querySelectorAll("textarea.reply-input")) {
    const form = input.closest("form.reply-form");
    if (!form) continue;
    const draftKey = replyDraftKey(form);
    if (input.value) replyDrafts.set(draftKey, input.value);
    else replyDrafts.delete(draftKey);
  }
}

function captureFocusedReply() {
  const input = document.activeElement?.closest?.("textarea.reply-input");
  const form = input?.closest("form.reply-form");
  if (!input || !form) return null;
  return {
    conversationKey: form.dataset.conversationKey,
    start: input.selectionStart,
    end: input.selectionEnd
  };
}

function restoreFocusedReply(state) {
  if (!state) return;
  const form = [...messageList.querySelectorAll("form.reply-form")]
    .find((item) => item.dataset.conversationKey === state.conversationKey);
  const input = form?.querySelector("textarea.reply-input:not(:disabled)");
  if (!input) return;
  input.focus({ preventScroll: true });
  input.setSelectionRange(state.start, state.end);
}

function replyDraftKey(form) {
  return form.dataset.conversationKey || form.dataset.messageId;
}

function updateStats(stats) {
  newCount.textContent = String(stats?.new || 0);
  quarantinedCount.textContent = String(stats?.quarantined || 0);
  archivedCount.textContent = String(stats?.archived || 0);
}

function statusBadge(status) {
  const label = new Map([
    ["new", "Nouveau"],
    ["read", "Lu"],
    ["archived", "Archivé"],
    ["quarantined", "À vérifier"],
    ["blocked", "Bloqué"]
  ]).get(status) || status;
  return element("span", `status-badge status-${status}`, label);
}

function actionButton(id, label, nextStatus, className) {
  const button = element("button", `message-action ${className}`, label);
  button.type = "button";
  button.dataset.messageId = id;
  button.dataset.nextStatus = nextStatus;
  return button;
}

function element(tag, className = "", text = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function formatDate(timestamp) {
  return new Intl.DateTimeFormat("fr-BE", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Brussels"
  }).format(new Date(Number(timestamp) * 1000));
}

function formatDuration(value) {
  const seconds = Math.max(0, Math.round(Number(value) || 0));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function showDashboard() {
  loginPanel.hidden = true;
  dashboard.hidden = false;
  loginStatus.textContent = "";
  operatorDisplay.textContent = currentOperatorName || "Studio";
  clearInterval(pollTimer);
  pollTimer = setInterval(loadMessages, 3000);
  postNativeMessage("studioReady", { operatorName: currentOperatorName });
  void syncStudioPushSubscription(nativePush.enabled);
}

function showLogin(message = "") {
  clearInterval(pollTimer);
  pollTimer = null;
  dashboard.hidden = true;
  loginPanel.hidden = false;
  loginStatus.textContent = message;
  loginStatus.className = message ? "form-status is-error" : "form-status";
  (operatorInput.value.trim() ? passwordInput : operatorInput).focus();
}

function openSettings() {
  settingsPanel.hidden = false;
  passwordStatus.textContent = "";
  document.body.classList.add("has-dialog");
  currentPasswordInput.focus();
}

function closeSettings() {
  settingsPanel.hidden = true;
  passwordForm.reset();
  passwordStatus.textContent = "";
  document.body.classList.remove("has-dialog");
  settingsButton.focus();
}

function setDashboardError(message) {
  dashboardStatus.textContent = message;
  dashboardStatus.className = "form-status is-error";
}

async function apiFetch(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const result = await response.json().catch(() => ({ ok: false, error: "Réponse invalide." }));
  return { ...result, statusCode: response.status };
}

function receiveNativeMessage(event) {
  if (typeof event.data !== "string") return;
  const receivedAt = Date.now();
  if (event.data === lastNativeMessage && receivedAt - lastNativeMessageAt < 250) return;
  lastNativeMessage = event.data;
  lastNativeMessageAt = receivedAt;
  let message;
  try { message = JSON.parse(event.data); } catch { return; }
  if (message?.type !== "setStudioPushToken") return;
  nativePush.token = typeof message.token === "string" ? message.token : "";
  nativePush.enabled = message.enabled === true;
  nativePush.platform = message.platform === "ios" ? "ios" : "android";
  if (!dashboard.hidden) void syncStudioPushSubscription(nativePush.enabled);
}

async function syncStudioPushSubscription(enabled) {
  if (!nativePush.token || dashboard.hidden) return;
  const result = await apiFetch("/api/studio/push-subscription", {
    method: enabled ? "POST" : "DELETE",
    body: JSON.stringify({ token: nativePush.token, platform: nativePush.platform })
  });
  postNativeMessage("studioPushStatus", {
    enabled: Boolean(result.ok && enabled),
    error: result.ok ? "" : (result.error || "Synchronisation impossible")
  });
}

function postNativeMessage(type, details = {}) {
  if (!window.ReactNativeWebView?.postMessage) return;
  window.ReactNativeWebView.postMessage(JSON.stringify({ type, ...details }));
}

window.addEventListener("message", receiveNativeMessage);
document.addEventListener("message", receiveNativeMessage);

function playNotification() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.setValueAtTime(740, context.currentTime);
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.12, context.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.24);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.25);
  } catch {
    // Certains navigateurs bloquent les sons avant la première interaction.
  }
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && !dashboard.hidden) loadMessages(false);
});
