// Real isolated Chromium-extension network check. No personal browser profile is used.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../../..');
const browserPath = process.env.JOB_CAPTURE_EXTENSION_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const pythonPath = process.env.JOB_CAPTURE_TEST_PYTHON || path.join(root, '.venv/Scripts/python.exe');

test('actual extension can pair and authorize private GETs without an Origin header', {
  skip: !fs.existsSync(browserPath) || !fs.existsSync(pythonPath), timeout: 30000
}, async t => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'job-capture-extension-'));
  let browser, child;
  t.after(async () => {
    if (browser) await browser.close();
    if (child && child.exitCode === null) {
      const exited = new Promise(resolve => child.once('exit', resolve));
      child.kill(); await exited;
    }
    // Verify the recursive cleanup target is precisely our generated temp directory.
    assert.equal(path.dirname(path.resolve(temporary)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(temporary).startsWith('job-capture-extension-'));
    fs.rmSync(temporary, { recursive: true, force: true });
  });
  const extension = path.join(temporary, 'extension');
  fs.cpSync(path.join(root, 'tools/job-capture/extension'), extension, { recursive: true });
  const serverRoot = path.join(temporary, 'server'); fs.mkdirSync(serverRoot);
  const helper = `import sys\nfrom pathlib import Path\nsys.path.insert(0,str(Path('tools/job-capture').resolve()))\nimport server\nfrom security import Pairing\nserver.PROJECT_ROOT=Path(sys.argv[1])\nserver.PAIRING=Pairing(server.PROJECT_ROOT/'connection.json')\nserver.PAIRING.config['token']='fictional-extension-test-code'\nhttp=server.ThreadingHTTPServer(('127.0.0.1',0),server.CaptureHandler)\nprint(http.server_port,flush=True)\nhttp.serve_forever()`;
  child = spawn(pythonPath, ['-u', '-c', helper, serverRoot], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  const port = await new Promise((resolve, reject) => {
    child.stdout.once('data', data => resolve(Number(data.toString().trim())));
    child.once('error', reject); child.once('exit', code => reject(new Error(`Test companion exited (${code})`)));
  });
  const manifestPath = path.join(extension, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.host_permissions.push(`http://127.0.0.1:${port}/*`);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  browser = await chromium.launchPersistentContext(path.join(temporary, 'profile'), {
    executablePath: browserPath, headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
  });
  const worker = browser.serviceWorkers()[0] || await browser.waitForEvent('serviceworker', { timeout: 10000 });
  const result = await worker.evaluate(async api => {
    const token = { 'X-Job-Capture-Token': 'fictional-extension-test-code' };
    const paired = await fetch(api + '/pair', { method: 'POST', headers: token });
    const missingIdentity = await fetch(api + '/applications', { headers: token });
    const privateRead = await fetch(api + '/applications', { headers: { ...token, 'X-Job-Capture-Extension': chrome.runtime.id } });
    return { paired: paired.status, missingIdentity: missingIdentity.status, privateRead: privateRead.status };
  }, `http://127.0.0.1:${port}`);
  assert.deepEqual(result, { paired: 200, missingIdentity: 401, privateRead: 200 });
});
