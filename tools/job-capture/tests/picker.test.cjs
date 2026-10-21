// Run with node --test tools/job-capture/tests/picker.test.cjs.
// Requires Playwright and an installed Chrome, or PLAYWRIGHT_CHROMIUM_EXECUTABLE.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const extension = path.join(root, 'extension');
const source = fs.readFileSync(path.join(extension, 'popup.js'), 'utf8');
const extractor = source.slice(source.indexOf('function extractJobPage'), source.indexOf('function setStatus'));
const fixture = fs.readFileSync(path.join(__dirname, 'fixtures/picker-job.html'), 'utf8');

async function browserFor(t) {
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true
  });
  t.after(() => browser.close());
  return browser;
}

async function jobPage(t) {
  const browser = await browserFor(t);
  const page = await browser.newPage();
  await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: fixture }));
  await page.goto('https://jobs.example.test/analyst');
  await page.addScriptTag({ path: path.join(extension, 'picker.js') });
  await page.addScriptTag({ content: extractor });
  return page;
}

test('picker chooses parent block, preserves Markdown and excludes surrounding/hidden content', async t => {
  const page = await jobPage(t);
  await page.evaluate(() => { window.pickResult = rendercvPickElement(); });
  await page.locator('#intro').hover();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  const picked = await page.evaluate(() => window.pickResult);
  assert.equal(picked.cancelled, false);
  const extracted = await page.evaluate(picked => extractJobPage(picked), picked);
  assert.match(extracted.description, /## About this role/);
  assert.match(extracted.description, /- Build reliable tools/);
  assert.match(extracted.description, /\[Application instructions\]\(https:\/\/jobs.example.test\/apply\)/);
  assert.doesNotMatch(extracted.description, /distraction|Recommended|Navigation|Unrelated|Apply now/);
  assert.equal(await page.locator('[data-rendercv-picker]').count(), 0);
});

test('click is intercepted and cancellation/repeated activation clean up listeners', async t => {
  const page = await jobPage(t);
  await page.evaluate(() => { window.pickResult = rendercvPickElement(); });
  await page.locator('#apply').click();
  assert.equal((await page.evaluate(() => window.pickResult)).cancelled, false);
  assert.equal(await page.evaluate(() => window.linkActivated), undefined);
  await page.evaluate(() => { window.first = rendercvPickElement(); window.second = rendercvPickElement(); });
  assert.equal((await page.evaluate(() => window.first)).cancelled, true);
  assert.equal(await page.locator('[data-rendercv-picker]').count(), 1);
  await page.keyboard.press('Escape');
  assert.equal((await page.evaluate(() => window.second)).cancelled, true);
  assert.equal(await page.locator('[data-rendercv-picker]').count(), 0);
  await page.locator('#apply').evaluate(element => element.addEventListener('click', event => event.preventDefault()));
  await page.locator('#apply').click();
  assert.equal(await page.evaluate(() => window.linkActivated), true);
});

test('leaving the page cancels an active picker', async t => {
  const page = await jobPage(t);
  await page.evaluate(() => {
    window.pickResult = rendercvPickElement();
    window.dispatchEvent(new Event('pagehide'));
  });
  assert.equal((await page.evaluate(() => window.pickResult)).cancelled, true);
  assert.equal(await page.locator('[data-rendercv-picker]').count(), 0);
});

test('panel requires review, saves edited description and prevents capture after navigation', async t => {
  const browser = await browserFor(t);
  const page = await browser.newPage({ viewport: { width: 380, height: 850 } });
  const captures = [];
  await page.addInitScript(() => {
    window.fakeTab = { id: 7, url: 'https://jobs.example.test/analyst' };
    window.drafts = {};
    window.chrome = {
      tabs: { query: async () => [window.fakeTab] },
      permissions: { contains: async () => true, request: async () => true },
      storage: { local: { get: async () => window.drafts, set: async value => Object.assign(window.drafts, value) } },
      scripting: { executeScript: async () => [{ result: {
        url: window.fakeTab.url, title: 'Analyst', company: 'Example Company',
        description: 'Original description', source: 'page text'
      } }] }
    };
  });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/capture') {
      captures.push(route.request().postDataJSON());
      return route.fulfill({ json: { ok: true, directory: 'cv-private/jobs/example', prompt: 'Example prompt' } });
    }
    if (url.pathname === '/automation/start') return route.fulfill({ json: { task: { id: 'fake-run' } } });
    if (url.pathname === '/automation/status') return route.fulfill({ json: { task: { status: 'complete', result: 'Review emphasis' } } });
    const name = path.basename(url.pathname);
    if (!['popup.html', 'popup.js', 'popup.css'].includes(name)) return route.abort();
    return route.fulfill({
      contentType: name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html',
      body: fs.readFileSync(path.join(extension, name), 'utf8')
    });
  });
  await page.goto('http://extension.test/popup.html');
  await page.waitForFunction(() => document.querySelector('#description').value === 'Original description');
  await page.evaluate(() => {
    chrome.permissions.contains = async () => false;
    chrome.permissions.request = async () => false;
  });
  await page.locator('#pick').click();
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('access was not granted'));
  assert.equal(await page.locator('#description').inputValue(), 'Original description');
  await page.evaluate(() => {
    chrome.permissions.contains = async () => true;
    const original = chrome.scripting.executeScript;
    chrome.scripting.executeScript = async request => {
      if (request.files) return [];
      if (request.func.name !== 'extractJobPage') return [{ result: { cancelled: true } }];
      return original(request);
    };
  });
  await page.locator('#pick').click();
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('Selection cancelled'));
  assert.equal(await page.locator('#description').inputValue(), 'Original description');
  await page.locator('#capture').click();
  assert.equal(captures.length, 0);
  await page.locator('#description').fill('Reviewed and edited description');
  await page.locator('#confirm-description').check();
  await page.locator('#title').fill('Revised analyst');
  assert.equal(await page.locator('#confirm-description').isChecked(), false);
  await page.locator('#confirm-description').check();
  await page.locator('#capture').click();
  await page.waitForFunction(() => document.querySelector('#automation-output').value === 'Review emphasis');
  assert.equal(captures.length, 1);
  assert.equal(captures[0].description, 'Reviewed and edited description');
  assert.equal(captures[0].title, 'Revised analyst');
  const stored = await page.evaluate(() => window.drafts['draft:https://jobs.example.test/analyst']);
  assert.equal(stored.description, 'Reviewed and edited description');
  if (process.env.JOB_CAPTURE_SCREENSHOT) await page.screenshot({ path: process.env.JOB_CAPTURE_SCREENSHOT, fullPage: true });
  await page.evaluate(() => { window.fakeTab.url = 'https://jobs.example.test/other'; });
  await page.locator('#capture').click();
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('page changed'));
  assert.equal(captures.length, 1);
});
