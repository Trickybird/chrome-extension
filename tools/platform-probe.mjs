/**
 * Loads the extension into a real Chromium and prints the platform facts the code assumes, so a
 * change in the browser shows up here rather than as a bug report.
 *
 *   npm install --no-save playwright && npx playwright install chromium
 *   node tools/platform-probe.mjs
 *
 * Extensions do not load in Playwright's default headless binary, hence the channel below.
 */

import { rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Not a dependency: this tool is optional and the test suite does not need a browser.
// @ts-ignore
const { chromium } = await import('playwright').catch(() => {
  console.error('playwright is not installed. See the header of this file.');
  process.exit(1);
});

const profile = mkdtempSync(join(tmpdir(), 'tb-probe-'));
const ctx = await chromium.launchPersistentContext(profile, {
  headless: true,
  channel: 'chromium',
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});

const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker', { timeout: 20000 }));
/** @param {string} k @param {unknown} v */
const say = (k, v) => console.log(`${k.padEnd(32)} ${typeof v === 'string' ? v : JSON.stringify(v)}`);

say('extension id', new URL(sw.url()).host);
say('rule limits', await sw.evaluate(() => ({
  session: chrome.declarativeNetRequest.MAX_NUMBER_OF_SESSION_RULES,
  unsafeSession: chrome.declarativeNetRequest.MAX_NUMBER_OF_UNSAFE_SESSION_RULES,
  dynamic: chrome.declarativeNetRequest.MAX_NUMBER_OF_DYNAMIC_RULES,
  regex: chrome.declarativeNetRequest.MAX_NUMBER_OF_REGEX_RULES,
})));

const granted = await sw.evaluate(() => chrome.permissions.getAll());
say('granted at install', granted.permissions);
say('host access at install', granted.origins);

say('session rule ceiling', await sw.evaluate(async () => {
  const rules = Array.from({ length: 5001 }, (_, i) => /** @type {any} */ ({
    id: i + 1,
    priority: 1,
    action: { type: 'redirect', redirect: { url: `https://example.invalid/${i}` } },
    condition: { urlFilter: `|https://h${i}.example.invalid/`, resourceTypes: ['main_frame'] },
  }));
  try {
    await chrome.declarativeNetRequest.updateSessionRules({ addRules: rules });
    return 'no ceiling below 5001';
  } catch (e) {
    return String(e).replace('Error: ', '');
  }
}));

const page = await ctx.newPage();
await page.goto('about:blank');
say('tabs.update without "tabs"', await sw.evaluate(async () => {
  const [tab] = await chrome.tabs.query({ active: true });
  try {
    await chrome.tabs.update(tab.id, { url: 'https://example.com/' });
    return 'accepted';
  } catch (e) {
    return `rejected: ${e}`;
  }
}));

await ctx.close();
rmSync(profile, { recursive: true, force: true });
