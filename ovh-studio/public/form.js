const accountCard = document.querySelector("#account-card");
const chatCard = document.querySelector("#chat-card");
const loginTab = document.querySelector("#login-tab");
const registerTab = document.querySelector("#register-tab");
const loginForm = document.querySelector("#login-form");
const registerForm = document.querySelector("#register-form");
const loginEmail = document.querySelector("#login-email");
const loginPassword = document.querySelector("#login-password");
const loginButton = document.querySelector("#login-button");
const registerName = document.querySelector("#register-name");
const registerEmail = document.querySelector("#register-email");
const registerPassword = document.querySelector("#register-password");
const registerConfirmation = document.querySelector("#register-confirmation");
const privacyAccepted = document.querySelector("#privacy-accepted");
const registerButton = document.querySelector("#register-button");
const authStatus = document.querySelector("#auth-status");
const securityError = document.querySelector("#security-error");
const logoutButtons = [
  document.querySelector("#logout-button-listener"),
  document.querySelector("#app-logout-button")
].filter(Boolean);
const chatUserName = document.querySelector("#chat-user-name");

const messageForm = document.querySelector("#message-form");
const messageInput = document.querySelector("#message");
const websiteInput = document.querySelector("#website");
const submitButton = document.querySelector("#submit-button");
const recordButton = document.querySelector("#record-button");
const formStatus = document.querySelector("#form-status");
const characterCount = document.querySelector("#character-count");
const sentMessages = document.querySelector("#sent-messages");
const composerDefault = document.querySelector("#composer-default");
const recordingPanel = document.querySelector("#recording-panel");
const recordingTime = document.querySelector("#recording-time");
const stopRecordingButton = document.querySelector("#stop-recording-button");
const voicePreviewPanel = document.querySelector("#voice-preview-panel");
const discardRecordingButton = document.querySelector("#discard-recording-button");
const previewPlayButton = document.querySelector("#preview-play-button");
const previewProgress = document.querySelector("#preview-progress");
const previewRemaining = document.querySelector("#preview-remaining");
const sendVoiceButton = document.querySelector("#send-voice-button");

const TOKEN_STORAGE_KEY = "ellevieConversationToken";
const TOKEN_COOKIE_KEY = "ellevie_conversation";
const HISTORY_STORAGE_PREFIX = "ellevieConversationHistory:";
const HISTORY_SECONDS = 30 * 24 * 60 * 60;
const source = new URLSearchParams(window.location.search).get("source") === "app" ? "app" : "web";
const conversationToken = getConversationToken();
const nativePush = { token: "", enabled: false, platform: "android" };

let formToken = "";
let maxLength = 500;
let voiceMaxSeconds = 30;
let account = null;
let renderedConversation = null;
let conversationTimer = null;
let activeConversationAudio = null;

let mediaStream = null;
let mediaRecorder = null;
let recordingChunks = [];
let recordingStartedAt = 0;
let recordingTimer = null;
let recordedBlob = null;
let recordedUrl = "";
let recordedDuration = 0;
let previewAudio = null;
let abandonRecording = false;

if (source === "app") document.body.classList.add("is-app");

loginTab.addEventListener("click", () => switchAuthMode("login"));
registerTab.addEventListener("click", () => switchAuthMode("register"));

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!loginForm.reportValidity() || !formToken) return;
  await authenticate("/api/account/login", {
    email: loginEmail.value,
    password: loginPassword.value,
  }, loginButton);
});

registerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setAuthStatus("", false);
  if (!registerForm.reportValidity() || !formToken) return;
  if (registerPassword.value !== registerConfirmation.value) {
    setAuthStatus("Les deux mots de passe ne correspondent pas.", true);
    return;
  }
  await authenticate("/api/account/register", {
    displayName: registerName.value,
    email: registerEmail.value,
    password: registerPassword.value,
    privacyAccepted: privacyAccepted.checked,
    conversationToken,
  }, registerButton);
});

for (const button of logoutButtons) button.addEventListener("click", logout);

messageInput.addEventListener("input", () => {
  characterCount.textContent = `${messageInput.value.length}/${maxLength}`;
  updateComposerActions();
});

messageInput.addEventListener("keydown", (event) => {
  const isEnter = event.key === "Enter" || event.code === "NumpadEnter" || event.keyCode === 13;
  if (!isEnter || event.isComposing) return;
  event.preventDefault();
  if (messageInput.value.trim().length < 2 || submitButton.disabled) return;
  if (typeof messageForm.requestSubmit === "function") messageForm.requestSubmit();
  else submitButton.click();
});

messageForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = messageInput.value.trim();
  if (message.length < 2 || !formToken || !account) return;
  setFormStatus("", false);
  submitButton.disabled = true;
  try {
    const response = await fetch("/api/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ message, website: websiteInput.value, formToken, source })
    });
    const result = await response.json();
    if (response.status === 401) return handleExpiredAccount();
    if (!response.ok || !result.ok) throw new Error(result.error || "L'envoi a échoué.");
    messageInput.value = "";
    websiteInput.value = "";
    characterCount.textContent = `0/${maxLength}`;
    updateComposerActions();
    setFormStatus(result.message || "Votre message a bien été transmis au studio.", false);
    await refreshFormToken();
    await loadConversation(true);
  } catch (error) {
    setFormStatus(error.message || "Impossible d'envoyer le message.", true);
  } finally {
    updateComposerActions();
  }
});

recordButton.addEventListener("click", startRecording);
stopRecordingButton.addEventListener("click", stopRecording);
discardRecordingButton.addEventListener("click", discardRecording);
previewPlayButton.addEventListener("click", togglePreviewPlayback);
sendVoiceButton.addEventListener("click", sendVoiceMessage);
previewProgress.addEventListener("input", () => {
  if (!previewAudio || !Number.isFinite(previewAudio.duration) || previewAudio.duration <= 0) return;
  previewAudio.currentTime = (Number(previewProgress.value) / 100) * previewAudio.duration;
});

initialize();

async function initialize() {
  try {
    const config = await loadConfig();
    applyConfig(config);
    securityError.hidden = true;
    if (account) {
      showChat();
      renderConversation(readCachedConversation());
      await loadConversation(false);
      conversationTimer = setInterval(() => loadConversation(false), 10000);
    } else {
      showAccount();
    }
  } catch {
    securityError.textContent = "Les messages sont momentanément indisponibles. Réessayez plus tard.";
    securityError.hidden = false;
  }
}

async function loadConfig() {
  const response = await fetch("/api/config", { credentials: "same-origin", cache: "no-store" });
  const result = await response.json();
  if (!response.ok || !result.formToken) throw new Error("Configuration indisponible.");
  return result;
}

function applyConfig(config) {
  formToken = config.formToken;
  maxLength = Number(config.messageMaxLength) || 500;
  voiceMaxSeconds = Number(config.voiceMaxSeconds) || 30;
  account = config.account || null;
  messageInput.maxLength = maxLength;
  characterCount.textContent = `${messageInput.value.length}/${maxLength}`;
  updateComposerActions();
}

async function authenticate(path, payload, button) {
  setAuthStatus("", false);
  button.disabled = true;
  const originalLabel = button.textContent;
  button.textContent = "…";
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ ...payload, formToken })
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "Connexion impossible.");
    account = result.account;
    loginPassword.value = "";
    registerPassword.value = "";
    registerConfirmation.value = "";
    await refreshFormToken();
    showChat();
    renderConversation(readCachedConversation());
    await loadConversation(true);
    clearInterval(conversationTimer);
    conversationTimer = setInterval(() => loadConversation(false), 10000);
  } catch (error) {
    setAuthStatus(error.message || "Connexion impossible.", true);
    await refreshFormToken(false);
  } finally {
    button.disabled = false;
    button.textContent = originalLabel;
  }
}

async function logout() {
  stopAllRecording(true);
  clearInterval(conversationTimer);
  await syncListenerPushSubscription(false).catch(() => null);
  try {
    await fetch("/api/account/logout", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: "{}"
    });
  } catch {
    // The local screen still returns to the login form.
  }
  account = null;
  renderedConversation = null;
  sentMessages.replaceChildren();
  showAccount();
  postNativeMessage("listenerLoggedOut");
  await refreshFormToken(false);
}

function switchAuthMode(mode) {
  const showLogin = mode === "login";
  loginForm.hidden = !showLogin;
  registerForm.hidden = showLogin;
  loginTab.classList.toggle("is-active", showLogin);
  registerTab.classList.toggle("is-active", !showLogin);
  loginTab.setAttribute("aria-selected", String(showLogin));
  registerTab.setAttribute("aria-selected", String(!showLogin));
  setAuthStatus("", false);
  (showLogin ? loginEmail : registerName).focus();
}

function showAccount() {
  accountCard.hidden = false;
  chatCard.hidden = true;
}

function showChat() {
  accountCard.hidden = true;
  chatCard.hidden = false;
  chatUserName.textContent = account?.displayName || "";
  updateComposerActions();
  postNativeMessage("listenerReady", { accountId: account?.id || "" });
  void syncListenerPushSubscription(nativePush.enabled);
}

async function refreshFormToken(showError = true) {
  formToken = "";
  updateComposerActions();
  try {
    const config = await loadConfig();
    formToken = config.formToken;
    if (config.account) account = config.account;
    updateComposerActions();
  } catch {
    if (showError) setFormStatus("La protection anti-spam est indisponible. Réessayez dans un instant.", true);
  }
}

async function loadConversation(scrollToLatest) {
  if (!account) return;
  try {
    const response = await fetch("/api/conversation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      cache: "no-store",
      body: "{}"
    });
    const result = await response.json();
    if (response.status === 401) return handleExpiredAccount();
    if (!response.ok || !result.ok) throw new Error();
    if (result.account) account = result.account;
    const messages = Array.isArray(result.messages) ? result.messages : [];
    saveCachedConversation(messages);
    renderConversation(messages, scrollToLatest);
  } catch {
    // A temporary refresh failure must not interrupt a message being typed.
  }
}

function handleExpiredAccount() {
  account = null;
  clearInterval(conversationTimer);
  stopAllRecording(true);
  showAccount();
  setAuthStatus("Votre session a expiré. Reconnectez-vous.", true);
}

function renderConversation(messages, forceScroll = false) {
  const signature = messages.map((message) => `${message.id}:${message.created_at}:${message.content_type || "text"}`).join("|");
  const hasNewContent = signature !== renderedConversation;
  if (!hasNewContent && !forceScroll) return;
  renderedConversation = signature;
  sentMessages.replaceChildren(createSystemBubble());

  for (const message of messages) {
    const isStudio = message.message_type === "studio";
    const bubble = document.createElement("div");
    bubble.className = isStudio ? "studio-bubble" : "sent-bubble";
    if (message.content_type === "voice" && message.voice_id) {
      bubble.classList.add("voice-message-bubble");
      bubble.append(createVoicePlayer(`/api/voice/${encodeURIComponent(message.voice_id)}?complete=1`, Number(message.voice_duration) || 0));
    } else {
      const text = document.createElement("span");
      text.textContent = message.body;
      bubble.append(text);
    }
    const meta = document.createElement("small");
    meta.textContent = `${isStudio ? (message.display_name || "Studio Ellevie") : message.display_name} · ${formatTime(message.created_at)}`;
    bubble.append(meta);
    sentMessages.append(bubble);
  }

  if ((hasNewContent && messages.length > 0) || forceScroll) {
    requestAnimationFrame(() => sentMessages.scrollTo({
      top: sentMessages.scrollHeight,
      behavior: forceScroll ? "smooth" : "auto"
    }));
  }
}

function createVoicePlayer(url, expectedDuration) {
  const player = document.createElement("div");
  player.className = "voice-player";
  const play = document.createElement("button");
  play.type = "button";
  play.className = "voice-play-button";
  play.textContent = "▶";
  play.setAttribute("aria-label", "Écouter le message vocal");
  const track = document.createElement("input");
  track.type = "range";
  track.min = "0";
  track.max = "100";
  track.value = "0";
  track.className = "voice-progress bubble-progress";
  track.setAttribute("aria-label", "Position du message vocal");
  const duration = document.createElement("span");
  duration.className = "voice-duration";
  duration.textContent = formatDuration(expectedDuration);
  const audio = new Audio(url);
  audio.preload = "metadata";

  play.addEventListener("click", async () => {
    if (audio.paused) {
      if (activeConversationAudio && activeConversationAudio !== audio) activeConversationAudio.pause();
      activeConversationAudio = audio;
      try {
        await audio.play();
      } catch {
        setFormStatus("Ce message vocal ne peut pas être lu pour le moment.", true);
      }
    } else {
      audio.pause();
    }
  });
  audio.addEventListener("play", () => { play.textContent = "Ⅱ"; });
  audio.addEventListener("pause", () => { play.textContent = "▶"; });
  audio.addEventListener("loadedmetadata", update);
  audio.addEventListener("timeupdate", update);
  audio.addEventListener("ended", () => {
    play.textContent = "▶";
    track.value = "0";
  });
  track.addEventListener("input", () => {
    if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;
    audio.currentTime = (Number(track.value) / 100) * audio.duration;
  });

  function update() {
    const total = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : expectedDuration;
    if (total > 0) {
      track.value = String(Math.min(100, (audio.currentTime / total) * 100));
      duration.textContent = formatDuration(total);
    }
  }

  player.append(play, track, duration);
  return player;
}

function createSystemBubble() {
  const bubble = document.createElement("div");
  bubble.className = "system-bubble";
  const title = document.createElement("strong");
  title.textContent = `Bonjour${account?.displayName ? ` ${account.displayName}` : ""} !`;
  const text = document.createElement("span");
  text.textContent = "Une réaction, un petit mot, une dédicace ou un message vocal ? Notre équipe vous lit et vous écoute.";
  bubble.append(title, text);
  return bubble;
}

async function startRecording() {
  if (!account || mediaRecorder) return;
  setFormStatus("", false);
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    setFormStatus("L'enregistrement vocal n'est pas disponible sur cet appareil.", true);
    return;
  }
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }
    });
    abandonRecording = false;
    recordingChunks = [];
    const mimeType = preferredRecordingMimeType();
    const options = mimeType ? { mimeType, audioBitsPerSecond: 64000 } : { audioBitsPerSecond: 64000 };
    mediaRecorder = new MediaRecorder(mediaStream, options);
    mediaRecorder.addEventListener("dataavailable", (event) => {
      if (event.data?.size) recordingChunks.push(event.data);
    });
    mediaRecorder.addEventListener("stop", finalizeRecording, { once: true });
    mediaRecorder.addEventListener("error", () => {
      stopAllRecording(true);
      setFormStatus("L'enregistrement a été interrompu.", true);
    }, { once: true });
    // Eén volledige opnameblob voorkomt dat sommige Android WebViews alleen
    // het eerste MediaRecorder-fragment afspelen.
    mediaRecorder.start();
    recordingStartedAt = Date.now();
    recordingTime.textContent = "00:00";
    stopRecordingButton.disabled = false;
    showComposerPanel("recording");
    recordingTimer = setInterval(() => {
      const seconds = Math.min(voiceMaxSeconds, Math.floor((Date.now() - recordingStartedAt) / 1000));
      recordingTime.textContent = formatDuration(seconds);
      if (seconds >= voiceMaxSeconds) stopRecording();
    }, 250);
  } catch (error) {
    stopAllRecording(true);
    const denied = error?.name === "NotAllowedError" || error?.name === "SecurityError";
    setFormStatus(denied
      ? "Autorisez le microphone pour envoyer un message vocal."
      : "Le microphone ne peut pas être utilisé pour le moment.", true);
  }
}

function stopRecording() {
  if (!mediaRecorder || mediaRecorder.state === "inactive") return;
  stopRecordingButton.disabled = true;
  mediaRecorder.stop();
}

function finalizeRecording() {
  clearInterval(recordingTimer);
  recordingTimer = null;
  const discardStoppedRecording = abandonRecording;
  abandonRecording = false;
  recordedDuration = Math.max(1, Math.min(voiceMaxSeconds, Math.ceil((Date.now() - recordingStartedAt) / 1000)));
  const type = mediaRecorder?.mimeType || recordingChunks[0]?.type || "audio/webm";
  recordedBlob = new Blob(recordingChunks, { type });
  releaseMicrophone();
  mediaRecorder = null;
  recordingChunks = [];
  if (discardStoppedRecording) {
    discardRecording();
    return;
  }
  if (!recordedBlob.size) {
    discardRecording();
    setFormStatus("Aucun son n'a été enregistré. Réessayez.", true);
    return;
  }
  recordedUrl = URL.createObjectURL(recordedBlob);
  previewAudio = new Audio(recordedUrl);
  previewAudio.preload = "metadata";
  previewAudio.addEventListener("play", () => { previewPlayButton.textContent = "Ⅱ"; });
  previewAudio.addEventListener("pause", () => { previewPlayButton.textContent = "▶"; });
  previewAudio.addEventListener("timeupdate", updatePreviewProgress);
  previewAudio.addEventListener("loadedmetadata", updatePreviewProgress);
  previewAudio.addEventListener("ended", () => {
    previewPlayButton.textContent = "▶";
    previewProgress.value = "0";
    previewRemaining.textContent = `-${formatDuration(recordedDuration)}`;
  });
  previewProgress.value = "0";
  previewRemaining.textContent = `-${formatDuration(recordedDuration)}`;
  showComposerPanel("preview");
}

async function togglePreviewPlayback() {
  if (!previewAudio) return;
  if (previewAudio.paused) {
    try {
      await previewAudio.play();
    } catch {
      setFormStatus("L'enregistrement ne peut pas être lu.", true);
    }
  } else {
    previewAudio.pause();
  }
}

function updatePreviewProgress() {
  if (!previewAudio) return;
  const total = Number.isFinite(previewAudio.duration) && previewAudio.duration > 0
    ? previewAudio.duration
    : recordedDuration;
  if (total <= 0) return;
  previewProgress.value = String(Math.min(100, (previewAudio.currentTime / total) * 100));
  previewRemaining.textContent = `-${formatDuration(Math.max(0, total - previewAudio.currentTime))}`;
}

async function sendVoiceMessage() {
  if (!recordedBlob || !formToken || !account) return;
  setFormStatus("", false);
  sendVoiceButton.disabled = true;
  const formData = new FormData();
  const extension = recordedBlob.type.includes("mp4") ? "m4a"
    : recordedBlob.type.includes("ogg") ? "ogg"
      : recordedBlob.type.includes("mpeg") ? "mp3" : "webm";
  formData.append("audio", recordedBlob, `message-vocal.${extension}`);
  formData.append("duration", String(recordedDuration));
  formData.append("source", source);
  formData.append("formToken", formToken);
  try {
    const response = await fetch("/api/voice-messages", {
      method: "POST",
      credentials: "same-origin",
      body: formData
    });
    const result = await response.json();
    if (response.status === 401) return handleExpiredAccount();
    if (!response.ok || !result.ok) throw new Error(result.error || "L'envoi vocal a échoué.");
    discardRecording();
    setFormStatus(result.message || "Votre message vocal a été transmis au studio.", false);
    await refreshFormToken();
    await loadConversation(true);
  } catch (error) {
    setFormStatus(error.message || "Impossible d'envoyer le message vocal.", true);
  } finally {
    sendVoiceButton.disabled = false;
  }
}

function discardRecording() {
  if (previewAudio) previewAudio.pause();
  previewAudio = null;
  if (recordedUrl) URL.revokeObjectURL(recordedUrl);
  recordedUrl = "";
  recordedBlob = null;
  recordedDuration = 0;
  previewProgress.value = "0";
  previewPlayButton.textContent = "▶";
  showComposerPanel("default");
}

function stopAllRecording(discard) {
  clearInterval(recordingTimer);
  recordingTimer = null;
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    abandonRecording = discard;
    try { mediaRecorder.stop(); } catch { /* Already stopped. */ }
  } else {
    mediaRecorder = null;
  }
  releaseMicrophone();
  if (discard) discardRecording();
}

function releaseMicrophone() {
  if (mediaStream) {
    for (const track of mediaStream.getTracks()) track.stop();
  }
  mediaStream = null;
}

function preferredRecordingMimeType() {
  const options = [
    "audio/mp4;codecs=mp4a.40.2",
    "audio/mp4",
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus"
  ];
  return options.find((type) => MediaRecorder.isTypeSupported?.(type)) || "";
}

function showComposerPanel(panel) {
  composerDefault.hidden = panel !== "default";
  recordingPanel.hidden = panel !== "recording";
  voicePreviewPanel.hidden = panel !== "preview";
}

function updateComposerActions() {
  const hasText = messageInput.value.trim().length > 0;
  submitButton.hidden = !hasText;
  recordButton.hidden = hasText;
  submitButton.disabled = !account || !formToken || messageInput.value.trim().length < 2;
  recordButton.disabled = !account || !formToken;
}

function formatDuration(value) {
  const seconds = Math.max(0, Math.round(Number(value) || 0));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function formatTime(timestamp) {
  return new Intl.DateTimeFormat("fr-BE", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Brussels"
  }).format(new Date(Number(timestamp) * 1000));
}

function getConversationToken() {
  const storedToken = readLocalValue(TOKEN_STORAGE_KEY);
  const cookieToken = readCookieValue(TOKEN_COOKIE_KEY);
  const existing = /^[a-f0-9]{64}$/.test(storedToken)
    ? storedToken
    : (/^[a-f0-9]{64}$/.test(cookieToken) ? cookieToken : "");
  if (existing) {
    persistConversationToken(existing);
    return existing;
  }
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const token = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  persistConversationToken(token);
  return token;
}

function persistConversationToken(token) {
  saveLocalValue(TOKEN_STORAGE_KEY, token);
  document.cookie = `${TOKEN_COOKIE_KEY}=${token}; Max-Age=31536000; Path=/; SameSite=Strict; Secure`;
}

function readCookieValue(name) {
  const prefix = `${encodeURIComponent(name)}=`;
  for (const part of document.cookie.split(";")) {
    const value = part.trim();
    if (value.startsWith(prefix)) return decodeURIComponent(value.slice(prefix.length));
  }
  return "";
}

function historyStorageKey() {
  return account?.id ? `${HISTORY_STORAGE_PREFIX}${account.id}` : "";
}

function readCachedConversation() {
  const key = historyStorageKey();
  if (!key) return [];
  try {
    const parsed = JSON.parse(readLocalValue(key) || "[]");
    if (!Array.isArray(parsed)) return [];
    const cutoff = Math.floor(Date.now() / 1000) - HISTORY_SECONDS;
    return parsed.filter((message) =>
      message && typeof message.id === "string" && Number(message.created_at) >= cutoff
      && (message.message_type === "listener" || message.message_type === "studio")
    ).slice(-200);
  } catch {
    return [];
  }
}

function saveCachedConversation(messages) {
  const key = historyStorageKey();
  if (!key) return;
  const cutoff = Math.floor(Date.now() / 1000) - HISTORY_SECONDS;
  saveLocalValue(key, JSON.stringify(messages.filter((message) => Number(message.created_at) >= cutoff).slice(-200)));
}

function readLocalValue(key) {
  try { return localStorage.getItem(key) || ""; } catch { return ""; }
}

function saveLocalValue(key, value) {
  try { localStorage.setItem(key, value); } catch { /* Server history remains authoritative. */ }
}

function setAuthStatus(message, isError) {
  authStatus.textContent = message;
  authStatus.className = isError ? "form-status is-error" : "form-status is-success";
}

function setFormStatus(message, isError) {
  formStatus.textContent = message;
  formStatus.className = isError ? "form-status is-error" : "form-status is-success";
}

function receiveNativeMessage(event) {
  if (typeof event.data !== "string") return;
  let message;
  try { message = JSON.parse(event.data); } catch { return; }
  if (message?.type !== "setListenerPushToken") return;
  nativePush.token = typeof message.token === "string" ? message.token : "";
  nativePush.enabled = message.enabled === true;
  nativePush.platform = message.platform === "ios" ? "ios" : "android";
  if (account) void syncListenerPushSubscription(nativePush.enabled);
}

async function syncListenerPushSubscription(enabled) {
  if (!account || !nativePush.token) return;
  const response = await fetch("/api/listener/push-subscription", {
    method: enabled ? "POST" : "DELETE",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ token: nativePush.token, platform: nativePush.platform })
  });
  const result = await response.json().catch(() => ({ ok: false }));
  postNativeMessage("listenerPushStatus", {
    enabled: Boolean(response.ok && result.ok && enabled),
    error: response.ok && result.ok ? "" : (result.error || "Synchronisation impossible")
  });
}

function postNativeMessage(type, details = {}) {
  if (!window.ReactNativeWebView?.postMessage) return;
  window.ReactNativeWebView.postMessage(JSON.stringify({ type, ...details }));
}

window.addEventListener("message", receiveNativeMessage);
document.addEventListener("message", receiveNativeMessage);

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) loadConversation(false);
});

window.addEventListener("pagehide", () => {
  clearInterval(conversationTimer);
  stopAllRecording(true);
  if (activeConversationAudio) activeConversationAudio.pause();
});
