/**
 * Store screenshots, taken from the extension as it actually runs rather than drawn.
 *
 *   npm install --no-save playwright && npx playwright install chromium
 *   node tools/store-shots.mjs        writes build/shots/*.png at 1280x800
 *
 * The panel is the real popup. Only the frame around it is added here, because the store wants
 * 1280x800 and a 360px panel alone on that canvas reads as a mistake.
 */

import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// @ts-ignore -- optional, and the test suite needs no browser.
const { chromium } = await import('playwright').catch(() => {
  console.error('playwright is not installed. See the header of this file.');
  process.exit(1);
});

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'build', 'shots');
const CONSOLE = 'https://trickybird.com';
const TARGET = 'https://news.example/article';
const GATEWAY = 'https://gw-1.example';

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const profile = join(tmpdir(), `tb-shots-${process.pid}`);
const ctx = await chromium.launchPersistentContext(profile, {
  headless: process.env.HEADED !== '1',
  channel: 'chromium',
  viewport: { width: 1280, height: 800 },
  // The store takes 1280x800 or 640x400 and nothing else, so this stays at 1: a 2x render is a
  // 2560x1600 file and is rejected on upload.
  deviceScaleFactor: 1,
  args: [`--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`],
});
const html = (/** @type {string} */ t) =>
  ({ contentType: 'text/html', body: `<!doctype html><title>${t}</title>` });
for (const [pattern, title] of [[`${CONSOLE}/**`, 'console'], [`${TARGET}*`, 'target'], [`${GATEWAY}/**`, 'proxied']]) {
  await ctx.route(pattern, (/** @type {any} */ r) => r.fulfill(html(title)));
}

const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker', { timeout: 20000 }));
const id = new URL(sw.url()).host;

/** The panel, framed. Nothing inside it is touched. */
const frame = `
  html { min-height: 100%; display: grid; place-items: center;
         background: radial-gradient(120% 120% at 50% 0%, #241b52 0%, #120e2b 60%, #0b0819 100%); }
  /* The panel is 360px wide and the store shows these small, so it is scaled rather than left to
     float in the middle of the canvas. Nothing inside it is re-laid-out. */
  body { width: 360px; zoom: 1.55; border-radius: 16px; overflow: hidden;
         box-shadow: 0 32px 80px rgb(0 0 0 / 0.55), 0 0 0 1px rgb(255 255 255 / 0.06); }
`;

/** @param {any} page @param {string} name */
async function shoot(page, name, framed = true) {
  if (framed) await page.addStyleTag({ content: frame });
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  console.log(`  ${name}.png`);
}

const target = await ctx.newPage();
await target.goto(TARGET);
const tabId = await sw.evaluate(async () => (await chrome.tabs.query({ active: true }))[0].id);

// The popup asks the browser which tab is in front, so the tab under test has to be the one in
// front and the panel has to be read after that.
const popup = await ctx.newPage();
const open = async () => {
  await popup.goto(`chrome-extension://${id}/src/popup.html`);
  await target.bringToFront();
  await popup.reload();
  await popup.waitForFunction(() => document.getElementById('heading')?.textContent !== '');
};

// A page the browser could not load is the state the extension exists for.
await sw.evaluate(async ([t, url]) => {
  await chrome.storage.session.set({ offers: { [String(t)]: { url, reason: 'failed' } } });
}, /** @type {[number, string]} */ ([tabId, TARGET]));
await open();
await shoot(popup, '1-offer');

// And the same tab once it is going through the proxy. The launch is driven the way a person
// drives it, because the fence is installed by the console answering back and by nothing else.
const helper = await ctx.newPage();
await helper.goto(`chrome-extension://${id}/src/options.html`);
await helper.evaluate((/** @type {any[]} */ [t, url]) =>
  chrome.runtime.sendMessage({ type: 'launch', tabId: t, url }), [tabId, TARGET]);
await target.waitForURL(/trickybird\.com/, { timeout: 10000 });
const nonce = new URL(target.url()).hash.slice('#ticket='.length);
const proxyUrl = `${GATEWAY}/_session?sId=shot&d=${Buffer.from(TARGET).toString('base64url')}`;
await target.evaluate((/** @type {any[]} */ [extId, msg]) => new Promise((res) => {
  /** @type {any} */ (globalThis).chrome.runtime.sendMessage(extId, msg, () => {
    void /** @type {any} */ (globalThis).chrome.runtime.lastError;
    res(null);
  });
}), [id, { v: 1, op: 'handoff', nonce, proxyUrl }]).catch(() => {});
await target.waitForURL(/gw-1\.example/, { timeout: 10000 }).catch(() => {});
await open();
await shoot(popup, '2-routed');

const options = await ctx.newPage();
await options.goto(`chrome-extension://${id}/src/options.html`);
await options.waitForTimeout(600);
await shoot(options, '3-settings', false);

await ctx.close();
rmSync(profile, { recursive: true, force: true });
console.log(`\n${3} screenshots in build/shots, 1280x800`);
