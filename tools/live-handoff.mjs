/**
 * The whole launch, in a real Chromium: park the address, send the tab to the console, answer as
 * the console, and check the tab ends up fenced on the proxy. Unit tests cannot see any of this --
 * the channel, the fragment, the rule table and the navigation are all the browser's.
 *
 *   npm install --no-save playwright && npx playwright install chromium
 *   node tools/live-handoff.mjs
 *   HEADED=1 SLOWMO=700 node tools/live-handoff.mjs    watch the tab make the trip
 *
 * The three hosts are served locally, so nothing here reaches the network.
 */

import { readFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// @ts-ignore -- optional, and the test suite needs no browser.
const { chromium } = await import('playwright').catch(() => {
  console.error('playwright is not installed. See the header of this file.');
  process.exit(1);
});

const EXT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONSOLE = 'https://trickybird.com';
const TARGET = 'https://news.example/article';
const GATEWAY = 'https://gw-1.example';
const headed = process.env.HEADED === '1';
const profile = mkdtempSync(join(tmpdir(), 'tb-live-'));
const ctx = await chromium.launchPersistentContext(profile, {
  headless: !headed,
  slowMo: Number(process.env.SLOWMO ?? 0),
  channel: 'chromium',
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});
/** Headed, the trip is the point, so each leg gets long enough to read. */
const dwell = () => (headed ? new Promise((r) => setTimeout(r, 1200)) : Promise.resolve());
const html = (/** @type {string} */ t) =>
  ({ contentType: 'text/html', body: `<!doctype html><title>${t}</title>` });
const serve = (/** @type {string} */ pattern, /** @type {string} */ title) =>
  ctx.route(pattern, (/** @type {any} */ route) => route.fulfill(html(title)));
await serve(`${CONSOLE}/**`, 'console');
await serve(`${TARGET}*`, 'target');
await serve(`${GATEWAY}/**`, 'proxied');

const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker', { timeout: 20000 }));
const id = new URL(sw.url()).host;
/** @type {string[]} */
const ok = [];
/** @type {string[]} */
const fail = [];
const check = (/** @type {string} */ name, /** @type {unknown} */ got, /** @type {unknown} */ want) => {
  const good = String(got) === String(want);
  (good ? ok : fail).push(name);
  console.log(`  ${good ? 'PASS' : 'FAIL'}  ${name}${good ? '' : `  got ${got}, wanted ${want}`}`);
};

const page = await ctx.newPage();
await page.goto(TARGET);
const tabId = await sw.evaluate(async () => (await chrome.tabs.query({ active: true }))[0].id);

// The launch is started the way the popup starts it: an extension page messaging the worker. A
// worker cannot import at runtime, and reaching in would test a path no user takes.
const helper = await ctx.newPage();
await helper.goto(`chrome-extension://${id}/src/options.html`);
check('the launch was accepted', JSON.stringify(await helper.evaluate(
  (/** @type {any[]} */ [t, url]) =>
    chrome.runtime.sendMessage({ type: 'launch', tabId: t, url }), [tabId, TARGET])),
  '{"ok":true}');
await page.waitForURL(/trickybird\.com/, { timeout: 10000 });
await dwell();

const fragment = new URL(page.url()).hash;
check('tab is on the console', page.url().startsWith(CONSOLE), true);
check('fragment carries a nonce', /^#ticket=[A-Za-z0-9_-]{22}$/.test(fragment), true);
check('address is not in the URL', page.url().includes('news.example'), false);
check('no fence yet', await sw.evaluate(async () =>
  (await chrome.declarativeNetRequest.getSessionRules()).length), 0);

const nonce = fragment.slice('#ticket='.length);
/**
 * The reply is best-effort by construction: a taken handoff replaces this document, so the page can
 * die before its callback runs. That is why the console never navigates on the answer, and why the
 * fence below, not the reply, is what says the launch worked.
 */
const asker = (/** @type {any} */ p) => (/** @type {object} */ msg) => p.evaluate(
  (/** @type {any[]} */ [extId, m]) => new Promise((res) => {
    // The page's own chrome, not the worker's: the callback overload is the one a page gets.
    /** @type {any} */ (globalThis).chrome.runtime.sendMessage(extId, m, (/** @type {any} */ r) => {
      void /** @type {any} */ (globalThis).chrome.runtime.lastError;
      res(r);
    });
  }),
  /** @type {[string, object]} */ ([id, msg]),
).catch(() => 'the page was replaced first');
const ask = asker(page);

check('chrome.runtime reached the page', await page.evaluate(() => Boolean(globalThis.chrome?.runtime)), true);
const pending = /** @type {{ url?: string }} */ (await ask({ v: 1, op: 'pending', nonce }));
check('the console is told the address', pending?.url, TARGET);
check('a stranger origin is refused', JSON.stringify(await ask({ v: 2, op: 'pending', nonce })), '{"ok":false}');

const d = Buffer.from(TARGET).toString('base64url');
check('a bootstrap for another site is refused', JSON.stringify(await ask({
  v: 1, op: 'handoff', nonce,
  proxyUrl: `${GATEWAY}/_session?sId=t&d=${Buffer.from('https://attacker.example/').toString('base64url')}`,
})), '{"ok":false}');
check('still no fence after a refusal', await sw.evaluate(async () =>
  (await chrome.declarativeNetRequest.getSessionRules()).length), 0);

await ask({ v: 1, op: 'handoff', nonce, proxyUrl: `${GATEWAY}/_session?sId=t&d=${d}` });
await page.waitForURL(/gw-1\.example/, { timeout: 10000 }).catch(() => {});
await dwell();
check('the tab is on the proxy', page.url().startsWith(GATEWAY), true);
const rules = await sw.evaluate(async () => await chrome.declarativeNetRequest.getSessionRules());
// One rule in every fence is deliberately not tab-scoped: a service worker's request belongs to no
// tab, so that one is scoped by who asked instead.
check('the tab is fenced', rules.length > 0
  && rules.filter((/** @type {any} */ r) => r.condition.tabIds)
    .every((/** @type {any} */ r) => r.condition.tabIds?.[0] === tabId), true);
check('a worker on the proxy origin is fenced too',
  rules.filter((/** @type {any} */ r) => r.condition.initiatorDomains).length, 1);
check('the fence lets only the gateway through',
  rules.find((/** @type {any} */ r) => r.action.type === 'block')
    ?.condition.excludedRequestDomains?.[0], 'gw-1.example');

/*
 * Act two: the launch that does not make it. The console says so and stops, which leaves the tab
 * parked on our own site with the address nowhere but in the extension's own record. What the popup
 * does with that is the whole question, and only a real one can be asked it.
 */
const copy = JSON.parse(readFileSync(join(EXT, '_locales/en/messages.json'), 'utf8'));
const second = await ctx.newPage();
await second.goto(TARGET);
const secondTab = await sw.evaluate(async () => (await chrome.tabs.query({ active: true }))[0].id);
await helper.evaluate((/** @type {any[]} */ [t, url]) =>
  chrome.runtime.sendMessage({ type: 'launch', tabId: t, url }), [secondTab, TARGET]);
await second.waitForURL(/trickybird\.com/, { timeout: 10000 });
const failedNonce = new URL(second.url()).hash.slice('#ticket='.length);
await asker(second)({ v: 1, op: 'failed', nonce: failedNonce, reason: 'rate_limited' });
check('a failed mint leaves the address behind', await sw.evaluate(async () => {
  const { offers } = await chrome.storage.session.get('offers');
  return Object.values(/** @type {Record<string, { url: string }>} */ (offers ?? {}))[0]?.url;
}), TARGET);

// Opened before the tab it reports on is brought forward, then read again: the panel asks the
// browser which tab is in front, and that has to be the one holding the failure, not this one.
const popup = await ctx.newPage();
await popup.goto(`chrome-extension://${id}/src/popup.html`);
await second.bringToFront();
await popup.reload();
await popup.waitForFunction(() => document.getElementById('heading')?.textContent !== '');
await dwell();
check('the popup names the failure, not the site the tab landed on',
  await popup.locator('#heading').textContent(), copy.popupFailedHeading.message);
check('and it offers to try the address again',
  await popup.locator('#primary').textContent(), copy.popupFailedAction.message);
check('the button is on screen to be pressed', await popup.locator('#primary').isVisible(), true);

/*
 * Act three: the launch nobody finished. Its record dies of old age with nothing to announce it, so
 * the address it was holding has to come back as something the panel can act on.
 */
const third = await ctx.newPage();
await third.goto(TARGET);
const thirdTab = await sw.evaluate(async () => (await chrome.tabs.query({ active: true }))[0].id);
await helper.evaluate((/** @type {any[]} */ [t, url]) =>
  chrome.runtime.sendMessage({ type: 'launch', tabId: t, url }), [thirdTab, TARGET]);
await third.waitForURL(/trickybird\.com/, { timeout: 10000 });
await sw.evaluate(async () => {
  const { pending } = await chrome.storage.session.get('pending');
  const parked = /** @type {Record<string, { createdAt: number }>} */ (pending ?? {});
  await chrome.storage.session.set({
    pending: Object.fromEntries(Object.entries(parked)
      .map(([n, r]) => [n, { ...r, createdAt: r.createdAt - 6 * 60 * 1000 }])),
  });
});
await third.bringToFront();
await popup.reload();
await popup.waitForFunction(() => document.getElementById('heading')?.textContent !== '');
await dwell();
check('an expired launch comes back as its own code',
  await popup.locator('#failure').textContent(), 'Code TB-106');
check('with the address it was holding still on offer',
  await popup.locator('#primary').textContent(), copy.popupFailedAction.message);

await ctx.close();
rmSync(profile, { recursive: true, force: true });
if (fail.length) process.exit(1);
console.log(`\n${ok.length} checks, all green`);
