const loginPanel = document.querySelector("#login-panel");
const loginForm = document.querySelector("#login-form");
const loginStatus = document.querySelector("#login-status");
const passwordInput = document.querySelector("#password");
const dashboard = document.querySelector("#dashboard");
const dashboardStatus = document.querySelector("#dashboard-status");
const messageList = document.querySelector("#message-list");
const emptyState = document.querySelector("#empty-state");
const refreshButton = document.querySelector("#refresh-button");
const logoutButton = document.querySelector("#logout-button");
const connectionState = document.querySelector("#connection-state");
const soundToggle = document.querySelector("#sound-toggle");
const newCount = document.querySelector("#new-count");
const quarantinedCount = document.querySelector("#quarantined-count");
const archivedCount = document.querySelector("#archived-count");
const listTitle = document.querySelector("#list-title");
const filterButtons = [...document.querySelectorAll("[data-status]")];

let currentStatus = "active";
let pollTimer = null;
let knownNewestId = null;
let hasLoadedOnce = false;

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginStatus.textContent = "Connexion…";
  try {
    const response = await apiFetch("/api/studio/login", {
      method: "POST",
      body: JSON.stringify({ password: passwordInput.value })
    });
    if (!response.ok) throw new Error(response.error || "Connexion impossible.");
    passwordInput.value = "";
    showDashboard();
    await loadMessages();
  } catch (error) {
    loginStatus.textContent = error.message;
    loginStatus.className = "form-status is-error";
  }
});

logoutButton.addEventListener("click", async () => {
  await apiFetch("/api/studio/logout", { method: "POST", body: "{}" }).catch(() => null);
  showLogin();
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
  if (!button) return;
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

checkExistingSession();

async function checkExistingSession() {
  const response = await apiFetch("/api/studio/messages?status=active&limit=1").catch(() => null);
  if (response?.ok) {
    showDashboard();
    await loadMessages();
  } else {
    showLogin();
  }
}

async function loadMessages(manual = false) {
  if (manual) refreshButton.disabled = true;
  try {
    const result = await apiFetch(`/api/studio/messages?status=${encodeURIComponent(currentStatus)}&limit=200`);
    if (result.statusCode === 401) {
      showLogin("Votre session a expiré.");
      return;
    }
    if (!result.ok) throw new Error(result.error || "Chargement impossible.");

    connectionState.textContent = "En ligne";
    connectionState.classList.remove("is-offline");
    dashboardStatus.textContent = "";
    updateStats(result.stats);
    renderMessages(result.messages);

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

function renderMessages(messages) {
  messageList.replaceChildren();
  emptyState.hidden = messages.length > 0;

  for (const message of messages) {
    const card = element("article", `message-card status-${message.status}`);
    const header = element("header", "message-card-header");
    const identity = element("div");
    identity.append(
      element("strong", "listener-name", message.display_name),
      element("span", "message-time", formatDate(message.created_at))
    );
    header.append(identity, statusBadge(message.status));

    const body = element("p", "message-body", message.body);
    const footer = element("footer", "message-actions");
    if (message.filter_reasons?.length) {
      const reasons = element("div", "filter-reasons");
      reasons.append(element("span", "filter-label", "Filtre :"));
      for (const reason of message.filter_reasons) {
        reasons.append(element("span", "reason-chip", reason.replaceAll("_", " ")));
      }
      card.append(header, body, reasons);
    } else {
      card.append(header, body);
    }

    if (message.status !== "read") footer.append(actionButton(message.id, "Lu", "read", "button-read"));
    if (message.status !== "archived") footer.append(actionButton(message.id, "Archiver", "archived", "button-archive"));
    if (message.status !== "blocked") footer.append(actionButton(message.id, "Bloquer", "blocked", "button-block"));
    card.append(footer);
    messageList.append(card);
  }
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

function showDashboard() {
  loginPanel.hidden = true;
  dashboard.hidden = false;
  loginStatus.textContent = "";
  clearInterval(pollTimer);
  pollTimer = setInterval(loadMessages, 5000);
}

function showLogin(message = "") {
  clearInterval(pollTimer);
  pollTimer = null;
  dashboard.hidden = true;
  loginPanel.hidden = false;
  loginStatus.textContent = message;
  loginStatus.className = message ? "form-status is-error" : "form-status";
  passwordInput.focus();
}

function setDashboardError(message) {
  dashboardStatus.textContent = message;
  dashboardStatus.className = "form-status is-error";
}

async function apiFetch(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const result = await response.json().catch(() => ({ ok: false, error: "Réponse invalide." }));
  return { ...result, statusCode: response.status };
}

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
    // Audio notifications are optional; some browsers block them until interaction.
  }
}
