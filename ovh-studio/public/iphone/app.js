const STREAM_URL = 'https://stream.zeno.fm/5ct6gd3f0rhvv';
const VALID_TABS = new Set(['direct', 'messages', 'programmes', 'animatrices']);

const programmeGroups = [
  {
    id: 'semaine',
    shortLabel: 'Semaine',
    title: '📅 Du Lundi au Vendredi',
    programmes: [
      ['06:00 - 09:00', 'Ellevie Matin'],
      ['09:00 - 12:00', 'Vos Mélodies au Boulot'],
      ['12:00 - 13:00', 'Le Lunch Pop-Classic'],
      ['13:00 - 17:00', 'L’Après-Midi Chic'],
      ['17:00 - 19:00', 'Le Drive Énergie'],
      ['19:00 - 22:00', 'Ellevie Lounge & Chill'],
      ['22:00 - 07:00', 'La Nuit Douce']
    ]
  },
  {
    id: 'samedi',
    shortLabel: 'Samedi',
    title: '🏖️ Le Samedi',
    programmes: [
      ['07:00 - 10:00', 'La Douceur du Matin'],
      ['10:00 - 14:00', 'Chic & Shopping'],
      ['14:00 - 18:00', 'Génération Ellevie'],
      ['18:00 - 21:00', 'L’Apéro Ambiance'],
      ['21:00 - 00:00', 'Ellevie Club Pop'],
      ['00:00 - 07:00', 'La Nuit Douce']
    ]
  },
  {
    id: 'dimanche',
    shortLabel: 'Dimanche',
    title: '🧸 Le Dimanche',
    programmes: [
      ['07:00 - 11:00', 'Le Grand Petit-Déjeuner'],
      ['11:00 - 14:00', 'Table En Famille'],
      ['14:00 - 17:00', 'Balade & Détente'],
      ['17:00 - 20:00', 'Nostalgie Douce'],
      ['20:00 - 23:00', 'Sereine avant la Semaine'],
      ['23:00 - 06:00', 'La Nuit Douce']
    ]
  }
].map((group) => ({
  ...group,
  programmes: group.programmes.map(([time, title]) => {
    const [start, end] = time.split(' - ');
    return { time, title, start, end };
  })
}));

const screens = [...document.querySelectorAll('[data-screen]')];
const tabButtons = [...document.querySelectorAll('[data-tab]')];
const audioButtons = [...document.querySelectorAll('[data-audio-toggle]')];
const audio = document.querySelector('#stream-audio');
const playerStatus = document.querySelector('#player-status');
const currentTime = document.querySelector('#current-time');
const currentProgramme = document.querySelector('#current-programme');
const programmeTabs = document.querySelector('#programme-tabs');
const programmeDay = document.querySelector('#programme-day');
const programmeList = document.querySelector('#programme-list');
const installButton = document.querySelector('#install-button');
const installSheet = document.querySelector('#install-sheet');
const installClose = document.querySelector('#install-close');

let activeTab = 'direct';
let selectedProgrammeGroup = getCurrentGroup().id;
let deferredInstallPrompt = null;
let playbackRequested = false;

function setActiveTab(tab, updateHash = true) {
  const nextTab = VALID_TABS.has(tab) ? tab : 'direct';
  activeTab = nextTab;

  for (const screen of screens) {
    const active = screen.dataset.screen === nextTab;
    screen.hidden = !active;
    screen.classList.toggle('is-active', active);
    if (active && nextTab !== 'messages') screen.scrollTop = 0;
  }

  for (const button of tabButtons) {
    const active = button.dataset.tab === nextTab;
    button.classList.toggle('is-active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }

  if (updateHash) history.replaceState(null, '', `#${nextTab}`);
  if (nextTab === 'programmes') renderProgrammes(selectedProgrammeGroup);
}

for (const button of tabButtons) {
  button.addEventListener('click', () => setActiveTab(button.dataset.tab));
}

window.addEventListener('hashchange', () => {
  setActiveTab(location.hash.slice(1), false);
});

function brusselsClock(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Brussels',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    weekday: values.weekday,
    minutes: Number(values.hour) * 60 + Number(values.minute)
  };
}

function getCurrentGroup(date = new Date()) {
  const { weekday } = brusselsClock(date);
  if (weekday === 'Sat') return programmeGroups[1];
  if (weekday === 'Sun') return programmeGroups[2];
  return programmeGroups[0];
}

function toMinutes(value) {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

function isProgrammeActive(programme, date = new Date()) {
  const now = brusselsClock(date).minutes;
  const start = toMinutes(programme.start);
  const end = toMinutes(programme.end);
  if (start === end) return true;
  if (end < start) return now >= start || now < end;
  return now >= start && now < end;
}

function getCurrentProgramme(date = new Date()) {
  const group = getCurrentGroup(date);
  return group.programmes.find((programme) => isProgrammeActive(programme, date)) || {
    time: 'En direct',
    title: 'ellevie Radio'
  };
}

function updateCurrentProgramme() {
  const programme = getCurrentProgramme();
  currentTime.textContent = programme.time;
  currentProgramme.textContent = programme.title;

  if ('mediaSession' in navigator && 'MediaMetadata' in window) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: programme.title,
      artist: 'ellevie Radio',
      album: 'Lady’s First',
      artwork: [
        { src: new URL('./assets/icon-192.png', location.href).href, sizes: '192x192', type: 'image/png' },
        { src: new URL('./assets/icon-512.png', location.href).href, sizes: '512x512', type: 'image/png' }
      ]
    });
  }
}

function renderProgrammeTabs() {
  const fragment = document.createDocumentFragment();
  for (const group of programmeGroups) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'programme-tab';
    button.dataset.programmeGroup = group.id;
    button.setAttribute('role', 'tab');
    button.textContent = group.shortLabel;
    button.addEventListener('click', () => {
      selectedProgrammeGroup = group.id;
      renderProgrammes(group.id);
    });
    fragment.append(button);
  }
  programmeTabs.replaceChildren(fragment);
}

function renderProgrammes(groupId) {
  const group = programmeGroups.find((item) => item.id === groupId) || getCurrentGroup();
  const liveGroup = getCurrentGroup();
  selectedProgrammeGroup = group.id;
  programmeDay.textContent = group.title;

  for (const button of programmeTabs.querySelectorAll('[data-programme-group]')) {
    const active = button.dataset.programmeGroup === group.id;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-selected', String(active));
  }

  const fragment = document.createDocumentFragment();
  for (const programme of group.programmes) {
    const live = group.id === liveGroup.id && isProgrammeActive(programme);
    const article = document.createElement('article');
    article.className = live ? 'programme-slot is-live' : 'programme-slot';
    const copy = document.createElement('div');
    const time = document.createElement('span');
    const title = document.createElement('h3');
    time.textContent = programme.time;
    title.textContent = programme.title;
    copy.append(time, title);
    if (live) {
      const badge = document.createElement('small');
      badge.textContent = '● EN DIRECT';
      copy.append(badge);
    }
    article.append(copy);
    fragment.append(article);
  }
  programmeList.replaceChildren(fragment);
}

function setPlaybackUi(isPlaying, status) {
  playerStatus.textContent = status;
  document.body.classList.toggle('is-playing', isPlaying);
  for (const button of audioButtons) {
    button.setAttribute('aria-label', isPlaying ? 'Mettre ellevie en pause' : 'Écouter ellevie en direct');
    button.setAttribute('aria-pressed', String(isPlaying));
    const symbol = button.querySelector('.play-symbol');
    if (symbol) symbol.textContent = isPlaying ? 'Ⅱ' : '▶';
    const label = button.querySelector('[data-play-label]');
    if (label) label.textContent = isPlaying ? 'Mettre en pause' : 'Écouter en direct';
  }
  if ('mediaSession' in navigator) {
    navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
  }
}

async function startStream() {
  playbackRequested = true;
  setPlaybackUi(false, 'Connexion…');
  try {
    if (!audio.src) audio.src = STREAM_URL;
    await audio.play();
  } catch {
    playbackRequested = false;
    setPlaybackUi(false, 'Direct indisponible');
  }
}

function toggleStream() {
  if (audio.paused) void startStream();
  else {
    playbackRequested = false;
    audio.pause();
  }
}

for (const button of audioButtons) button.addEventListener('click', toggleStream);

audio.addEventListener('playing', () => {
  playbackRequested = true;
  setPlaybackUi(true, 'Vous écoutez le direct');
});
audio.addEventListener('pause', () => {
  setPlaybackUi(false, playbackRequested ? 'En pause' : 'Prête à écouter');
});
audio.addEventListener('waiting', () => setPlaybackUi(false, 'Connexion…'));
audio.addEventListener('stalled', () => setPlaybackUi(false, 'Reconnexion…'));
audio.addEventListener('error', () => {
  playbackRequested = false;
  setPlaybackUi(false, 'Direct indisponible');
});

if ('mediaSession' in navigator) {
  try {
    navigator.mediaSession.setActionHandler('play', startStream);
    navigator.mediaSession.setActionHandler('pause', () => {
      playbackRequested = false;
      audio.pause();
    });
    navigator.mediaSession.setActionHandler('stop', () => {
      playbackRequested = false;
      audio.pause();
    });
  } catch {
    // The visible player remains available when a media-key handler is unsupported.
  }
}

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function closeInstallSheet() {
  installSheet.hidden = true;
  installButton.focus();
}

installButton.addEventListener('click', async () => {
  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    return;
  }
  installSheet.hidden = false;
  installClose.focus();
});

installClose.addEventListener('click', closeInstallSheet);
installSheet.addEventListener('click', (event) => {
  if (event.target === installSheet) closeInstallSheet();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !installSheet.hidden) closeInstallSheet();
});

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
});
window.addEventListener('appinstalled', () => {
  installButton.hidden = true;
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => null);
  });
}

renderProgrammeTabs();
renderProgrammes(selectedProgrammeGroup);
updateCurrentProgramme();
setPlaybackUi(false, 'Prête à écouter');
setActiveTab(location.hash.slice(1) || activeTab, false);
if (isStandalone()) installButton.hidden = true;

setInterval(() => {
  updateCurrentProgramme();
  if (activeTab === 'programmes') renderProgrammes(selectedProgrammeGroup);
}, 60_000);

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) updateCurrentProgramme();
});
