const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { JSDOM } = require('jsdom');

const publicDirectory = path.join(__dirname, '../ovh-studio/public');
const html = fs.readFileSync(path.join(publicDirectory, 'studio.html'), 'utf8');
const script = fs.readFileSync(path.join(publicDirectory, 'studio.js'), 'utf8');
const reply = (body, status = 200) => ({ status, ok: status < 400, json: async () => body });
const flush = () => new Promise(resolve => setImmediate(resolve));
const messages = { ok: true, operatorName: 'Floris', role: 'admin', messages: [], claims: {}, stats: {} };

function openStudio(t, respond) {
  const dom = new JSDOM(html, { url: 'https://studio.ellevie.test/studio', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  dom.window.fetch = respond;
  dom.window.setInterval = () => 1;
  dom.window.eval(script);
  const document = dom.window.document;
  return { window: dom.window, document, get: id => document.getElementById(id) };
}

function fillAdmin(page) {
  page.get('operator-name').value = 'Floris';
  page.get('password').value = 'TestPassword123';
}

test('autofilled personal e-mail cannot block a responsible login', async t => {
  const requests = [];
  const page = openStudio(t, async (url, options) => {
    if (url === '/api/studio/login') {
      requests.push(JSON.parse(options.body));
      return reply({ ok: false, error: 'Identifiants incorrects.' }, 401);
    }
    return reply({ ok: false }, 401);
  });
  await flush();
  fillAdmin(page);
  page.get('operator-email').value = 'floris';
  assert.equal(page.get('login-form').checkValidity(), true);
  page.get('login-form').querySelector('[type=submit]').click();
  await flush();
  assert.deepEqual(requests, [{ operatorName: 'Floris', password: 'TestPassword123' }]);
});

test('personal login does not require the hidden responsible name', async t => {
  const requests = [];
  const page = openStudio(t, async (url, options) => {
    if (url === '/api/studio/login') requests.push(JSON.parse(options.body));
    return reply({ ok: false, error: 'Identifiants incorrects.' }, 401);
  });
  await flush();
  page.get('staff-login-mode').click();
  page.get('operator-email').value = 'sofia@example.org';
  page.get('password').value = 'PersonalPassword123';
  page.get('login-form').querySelector('[type=submit]').click();
  await flush();
  assert.deepEqual(requests, [{ email: 'sofia@example.org', password: 'PersonalPassword123' }]);
});

test('repeated clicks produce only one pending login request', async t => {
  let attempts = 0;
  let finishLogin;
  const page = openStudio(t, async url => {
    if (url === '/api/studio/login') {
      attempts++;
      return new Promise(resolve => { finishLogin = resolve; });
    }
    return reply({ ok: false }, 401);
  });
  await flush();
  fillAdmin(page);
  const button = page.get('login-form').querySelector('[type=submit]');
  button.click();
  button.click();
  assert.equal(attempts, 1);
  finishLogin(reply({ ok: false, error: 'Identifiants incorrects.' }, 401));
  await flush();
  assert.equal(button.disabled, false);
  assert.match(page.get('login-status').textContent, /mot de passe|identifiants/i);
});

test('an earlier session check cannot undo a successful login', async t => {
  let finishSessionCheck;
  const page = openStudio(t, async url => {
    if (url.includes('limit=1') && !url.includes('limit=200')) {
      return new Promise(resolve => { finishSessionCheck = resolve; });
    }
    if (url === '/api/studio/login') return reply({ ok: true, role: 'admin', operatorName: 'Floris' });
    return reply(messages);
  });
  fillAdmin(page);
  page.get('login-form').querySelector('[type=submit]').click();
  await flush();
  assert.equal(page.get('dashboard').hidden, false);
  finishSessionCheck(reply({ ok: false, error: 'Session expirée.' }, 401));
  await flush();
  assert.equal(page.get('dashboard').hidden, false);
  assert.equal(page.get('login-panel').hidden, true);
});
