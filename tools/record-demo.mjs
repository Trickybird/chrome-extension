/**
 * The store's promo video, built from real captures instead of a screen recording.
 *
 *   npm install --no-save playwright && npx playwright install chromium
 *   node tools/record-demo.mjs
 *   HEADED=1 node tools/record-demo.mjs        watch the capture pass
 *
 * Why it is composed rather than recorded: a screen recording of a real Chrome window is the one
 * thing this repo cannot reproduce with a command, and the first one was taken at 1x, which is what
 * made the published video soft. Here every pixel that carries text comes from a capture taken at
 * `deviceScaleFactor: 2` and is never scaled up: the pages are real pages, the panels are the real
 * panels, and only the window around them is drawn, the same way the store screenshots draw it.
 *
 * The story is the one the product is for: a page that will not open, the extension, the same page
 * open. Nothing in it is staged twice over — the failure is a real refused request rendered by
 * Chrome's own error page, and the page that comes back is really fetched through the proxy.
 *
 * Two capture passes, because one browser cannot be in both states at once. The first runs against
 * the local stack with nothing stubbed and takes the three pages the story moves through. The second
 * stubs every host and drives the whole launch, which is the only way to reach a fenced tab and
 * photograph the panel that says so.
 *
 * The address bar is drawn, so it is told what to say. By default it says what the run actually
 * produced, which locally means `tb-p1.test`; pass `DEMO_GATEWAY_HOST` to render the address a
 * person would see in production. The path, the encoding and the page are the run's own either way.
 */

import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEV_ENDPOINT } from '../src/config.js';
import { BIRD_SVG, CARD_SHADOW, TOKENS_CSS } from './store-shots-lib.mjs';

// @ts-ignore -- optional, and the unit suite needs no browser.
const { chromium } = await import('playwright').catch(() => {
  console.error('playwright is not installed. See the header of this file.');
  process.exit(1);
});

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'docs');
// The console the pages pass photographs, and the one the launch pass stubs. `DEV_ENDPOINT` is the
// only local address the extension will open at all: an address the install is not configured for is
// refused, and the manifest names this one.
const CONSOLE = process.env.CONSOLE_URL ?? DEV_ENDPOINT;
const TARGET = process.env.DEMO_TARGET ?? 'https://en.wikipedia.org/wiki/Lighthouse';
const FAKE_GATEWAY = 'https://gw-1.example';

/** 16:9 at the size the frame is drawn; every capture is taken at 2x and shown 1:1. */
const W = 1280;
const H = 720;
const BAR = 40;
const OMNI = 44;
const VIEW = H - BAR - OMNI;
const FPS = 30;
const SECONDS = 10;

const b64url = (/** @type {string} */ s) => Buffer.from(s).toString('base64url');
const uri = (/** @type {Buffer} */ buf) => `data:image/png;base64,${buf.toString('base64')}`;

/**
 * A capture plus the point the cursor should travel to, in the stage's own coordinates. Read from
 * the live element rather than measured off the picture afterwards: a button that moves when the
 * copy changes would otherwise leave the cursor pointing at nothing.
 * @typedef {{ uri: string, w: number, h: number, hot?: { x: number, y: number } }} Shot
 */

/** @param {any} locator @returns {Promise<{x:number,y:number}|undefined>} */
const centreOf = async (locator) => {
  const box = await locator.boundingBox().catch(() => null);
  return box ? { x: box.x + box.width / 2, y: box.y + box.height / 2 } : undefined;
};

/** The three pages the story moves through, taken against the running stack. */
async function capturePages() {
  const browser = await chromium.launch({
    headless: process.env.HEADED !== '1',
    channel: 'chromium',
    args: ['--ignore-certificate-errors'],
  });
  const page = await browser.newPage({
    viewport: { width: W, height: VIEW },
    deviceScaleFactor: 2,
    ignoreHTTPSErrors: true,
  });

  // The story opens on a page that will not load, because that is the moment the extension is for.
  // The failure is produced by refusing the request, not by naming a site as blocked: what a person
  // on a filtered network sees is Chrome's own error page, still carrying the address they typed.
  await page.route('**/*', (/** @type {any} */ r) => r.abort('connectionfailed'));
  await page.goto(TARGET, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForTimeout(1200);
  const blocked = { uri: uri(await page.screenshot()), w: W, h: VIEW };
  await page.unroute('**/*');

  // The console seeds its own field from the fragment: this is the shape the extension uses for an
  // address that arrived in the signed record, and it needs no extension id to match a build.
  await page.goto(`${CONSOLE}/#u=${b64url(TARGET)}`, { waitUntil: 'load' });
  // A local console runs in dev mode and paints Next's own indicator over its bottom-left corner.
  // It is not part of the product and has no business in a store asset.
  await page.addStyleTag({ content: 'nextjs-portal, [data-nextjs-toast] { display: none !important }' });
  await page.waitForFunction(
    (/** @type {any} */ want) => Boolean(document.querySelector(`input[value*="${want}"]`)),
    'wikipedia.org', { timeout: 15000 },
  ).catch(() => {});
  await page.waitForTimeout(1200);
  const open = page.getByRole('button', { name: /open/i }).first();
  const consoleShot = { uri: uri(await page.screenshot()), w: W, h: VIEW, hot: await centreOf(open) };

  await open.click();
  await page.waitForURL((/** @type {URL} */ u) => !u.href.startsWith(CONSOLE), { timeout: 60000 });
  await page.waitForLoadState('load').catch(() => {});
  await page.waitForTimeout(4000);
  const landed = new URL(page.url());
  const proxied = { uri: uri(await page.screenshot()), w: W, h: VIEW };

  await browser.close();
  return { blocked, console: consoleShot, proxied, landed };
}

/**
 * Both panel states, with every host stubbed so nothing here reaches the network. The routed panel
 * exists only for a tab the extension has actually fenced, and a fence is the end of a real launch,
 * so the launch is run rather than faked: the worker is asked to launch, the console's answer is
 * supplied by this harness because an unpacked copy carries an id no local build has in its
 * allowlist, and the fence that follows is the extension's own.
 */
async function capturePanels() {
  // A real user clicks the toolbar icon, which grants activeTab, and the panel then reads the tab's
  // URL. Playwright cannot click that icon, so a panel opened as a page falls back to "nothing on
  // this page to open". The copy adds `tabs` in place of the click the harness cannot perform; the
  // rendered panel is the shipped one, and this copy is never packaged.
  const extDir = mkdtempSync(join(tmpdir(), 'tb-demo-ext-'));
  cpSync(ROOT, extDir, {
    recursive: true,
    filter: (/** @type {string} */ src) =>
      !/(?:^|\/)(?:node_modules|build|docs|\.git)(?:\/|$)/.test(src.slice(ROOT.length)),
  });
  const manifest = JSON.parse(readFileSync(join(extDir, 'manifest.json'), 'utf8'));
  manifest.permissions = [...new Set([...(manifest.permissions ?? []), 'tabs'])];
  writeFileSync(join(extDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  const profile = mkdtempSync(join(tmpdir(), 'tb-demo-'));
  const ctx = await chromium.launchPersistentContext(profile, {
    headless: process.env.HEADED !== '1',
    channel: 'chromium',
    viewport: { width: W, height: VIEW },
    deviceScaleFactor: 2,
    args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
  });
  const page = (/** @type {string} */ title) =>
    ({ contentType: 'text/html', body: `<!doctype html><title>${title}</title>` });
  const proxiedPath = `/_o/${b64url(new URL(TARGET).origin)}${new URL(TARGET).pathname}`;
  await ctx.route(`${CONSOLE}/**`, (/** @type {any} */ r) => r.fulfill(page('console')));
  await ctx.route(`${FAKE_GATEWAY}/**`, (/** @type {any} */ r) => r.fulfill(page('proxied')));
  // Registered after the catch-all on purpose: routes are matched most-recent-first. The bootstrap
  // answers the way the gateway answers it, with a redirect onto the zero-leak path, because the
  // panel calls a tab proven only when the address it shows is that path on the endpoint its own
  // fence names. A stub that stops at `_session` photographs the panel that says the opposite.
  await ctx.route(`${FAKE_GATEWAY}/_session*`, (/** @type {any} */ r) =>
    r.fulfill({ status: 302, headers: { location: `${FAKE_GATEWAY}${proxiedPath}` } }));
  await ctx.route(`${new URL(TARGET).origin}/**`, (/** @type {any} */ r) => r.fulfill(page('target')));

  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker', { timeout: 20000 }));
  const id = new URL(sw.url()).host;
  await sw.evaluate((/** @type {string} */ endpoint) =>
    chrome.storage.local.set({ settings: { endpoints: [endpoint], autoRecover: false } }), CONSOLE);

  const tab = await ctx.newPage();
  await tab.goto(TARGET);
  const tabId = await sw.evaluate(async () => (await chrome.tabs.query({ active: true }))[0].id);

  const popup = await ctx.newPage();
  const settled = () => popup.waitForFunction(
    () => document.getElementById('heading')?.textContent !== '');
  /**
   * The panel reads whichever tab is active, and opening the panel as a page makes IT the active
   * one, which is how a capture ends up showing "nothing on this page to open". So the first run is
   * spent, the real tab is brought forward, and the reload after that is the run worth reading.
   * @param {string} want @returns {Promise<Shot>}
   */
  const panel = async (want) => {
    let seen = '';
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await popup.goto(`chrome-extension://${id}/src/popup.html`);
      await settled();
      await tab.bringToFront();
      await popup.reload();
      await settled();
      const heading = (await popup.locator('#heading').textContent()) ?? '';
      seen = heading;
      if (heading.includes(want)) {
        await popup.waitForTimeout(200);
        const body = popup.locator('body');
        const box = await body.boundingBox();
        if (!box) throw new Error('the panel rendered with no box to measure');
        const button = popup.locator('button').first();
        const hot = await centreOf(button);
        return { uri: uri(await body.screenshot()), w: box.width, h: box.height, hot };
      }
      await popup.waitForTimeout(200);
    }
    throw new Error(`the panel never said "${want}"; last heading was "${seen}"`);
  };

  const ready = await panel('Open this page');

  // The launch, started the way the popup starts it, then answered the way the console answers it.
  const helper = await ctx.newPage();
  await helper.goto(`chrome-extension://${id}/src/options.html`);
  await helper.evaluate((/** @type {any[]} */ [t, url]) =>
    chrome.runtime.sendMessage({ type: 'launch', tabId: t, url }), [tabId, TARGET]);
  await tab.waitForURL(new RegExp(CONSOLE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), { timeout: 15000 });
  const nonce = new URL(tab.url()).hash.slice('#ticket='.length);
  await tab.evaluate((/** @type {any[]} */ [extId, msg]) => new Promise((res) => {
    /** @type {any} */ (globalThis).chrome.runtime.sendMessage(extId, msg, (/** @type {any} */ r) => {
      void /** @type {any} */ (globalThis).chrome.runtime.lastError;
      res(r);
    });
  }), [id, { v: 1, op: 'handoff', nonce, proxyUrl: `${FAKE_GATEWAY}/_session?sId=demo&d=${b64url(TARGET)}` }])
    .catch(() => {});
  await tab.waitForURL(new RegExp('gw-1\\.example/_o/'), { timeout: 15000 }).catch(() => {});
  await tab.bringToFront();
  const routed = await panel('fetches');

  await ctx.close();
  rmSync(profile, { recursive: true, force: true });
  rmSync(extDir, { recursive: true, force: true });
  return { ready, routed };
}

/**
 * The stage. Everything animated is a CSS animation on a fixed 10s timeline, which is what lets the
 * renderer seek: paused animations answer to `currentTime`, so a frame is exact rather than whatever
 * the compositor happened to emit.
 *
 * @param {{ blocked: Shot, console: Shot, proxied: Shot, ready: Shot, routed: Shot,
 *   omniBlocked: string, omniConsole: string, omniProxied: string }} s
 */
function stage(s) {
  const at = (/** @type {number} */ sec) => `${((sec / SECONDS) * 100).toFixed(3)}%`;
  const panelRight = 18;
  const panelTop = BAR + OMNI + 6;
  // Where the cursor is at each beat. The two page hotspots come from the live elements; the icon
  // and the panel button are placed against the drawn window, which is why they are literals here.
  const icon = { x: W - 34, y: BAR + OMNI / 2 };
  const readyButton = {
    x: W - panelRight - s.ready.w + (s.ready.hot?.x ?? s.ready.w / 2),
    y: panelTop + (s.ready.hot?.y ?? s.ready.h - 60),
  };
  const openButton = { x: s.console.hot?.x ?? W * 0.78, y: BAR + OMNI + (s.console.hot?.y ?? VIEW / 2) };

  return `<!doctype html><meta charset="utf-8"><style>
${TOKENS_CSS}
*{ margin:0; padding:0; box-sizing:border-box; }
html,body{ width:${W}px; height:${H}px; overflow:hidden; background:#0b0718; }
.win{ position:relative; width:${W}px; height:${H}px; background:#fff; overflow:hidden; }
.bar{ height:${BAR}px; background:#dee1e6; display:flex; align-items:flex-end; gap:6px; padding:0 10px; }
.tab{ width:230px; height:32px; border-radius:9px 9px 0 0; background:#f1f3f4;
  display:flex; align-items:center; gap:8px; padding:0 12px; font:500 12px/1 system-ui; color:#3c4043; }
.tab.on{ background:#fff; }
.tab .fav{ width:14px; height:14px; border-radius:4px; background:#5b3df5; flex:none;
  display:grid; place-items:center; }
.tab .fav svg{ width:11px; height:11px; }
.omni{ height:${OMNI}px; background:#fff; display:flex; align-items:center; gap:10px; padding:0 12px;
  border-bottom:1px solid #e6e6e8; }
.nav{ display:flex; gap:14px; color:#5f6368; font:400 15px/1 system-ui; }
.pill{ flex:1; height:28px; border-radius:14px; background:#f1f3f4; display:flex; align-items:center;
  padding:0 14px; font:400 12.5px/1 system-ui; color:#202124; position:relative; overflow:hidden; }
.pill span{ position:absolute; left:14px; white-space:nowrap; }
.puzzle{ width:20px; height:20px; border-radius:6px; background:#e8eaed; flex:none; }
.me{ width:20px; height:20px; border-radius:50%; background:#5b3df5; flex:none; }
.view{ position:relative; height:${VIEW}px; background:#fff; }
.view img{ position:absolute; inset:0; width:${W}px; height:${VIEW}px; }
.panel{ position:absolute; right:${panelRight}px; top:${panelTop}px; border-radius:14px;
  box-shadow:${CARD_SHADOW}; overflow:hidden; transform-origin:100% 0; opacity:0; }
.cursor{ position:absolute; left:0; top:0; width:22px; height:22px; z-index:9; filter:drop-shadow(0 1px 2px rgba(0,0,0,.35)); }
.tapped{ position:absolute; width:34px; height:34px; margin:-17px 0 0 -17px; border-radius:50%;
  border:2px solid rgba(91,61,245,.85); opacity:0; z-index:8; }
.seek *{ animation-play-state:paused !important; }

@keyframes showBlocked{ 0%,43.5%{opacity:1} 46.5%,100%{opacity:0} }
@keyframes showConsole{ 0%,43.5%{opacity:0} 46.5%,63.5%{opacity:1} 66.5%,100%{opacity:0} }
@keyframes showProxied{ 0%,63.5%{opacity:0} 66.5%,100%{opacity:1} }
@keyframes omniBlocked{ 0%,43.5%{opacity:1} 46.5%,100%{opacity:0} }
@keyframes omniConsole{ 0%,43.5%{opacity:0} 46.5%,63.5%{opacity:1} 66.5%,100%{opacity:0} }
@keyframes omniProxied{ 0%,63.5%{opacity:0} 66.5%,100%{opacity:1} }
@keyframes panelReady{
  0%,20.5%{ opacity:0; transform:scale(.94) translateY(-6px) }
  23%,42%{ opacity:1; transform:none }
  44%,100%{ opacity:0; transform:scale(.98) translateY(-4px) }
}
@keyframes panelRouted{
  0%,69%{ opacity:0; transform:scale(.94) translateY(-6px) }
  72%,100%{ opacity:1; transform:none }
}
@keyframes walk{
  0%,10%{ transform:translate(${(W * 0.48).toFixed(0)}px, ${(BAR + OMNI + VIEW * 0.55).toFixed(0)}px) }
  19%{ transform:translate(${icon.x}px, ${icon.y}px) }
  35%{ transform:translate(${icon.x}px, ${icon.y}px) }
  41%{ transform:translate(${readyButton.x.toFixed(0)}px, ${readyButton.y.toFixed(0)}px) }
  46%{ transform:translate(${readyButton.x.toFixed(0)}px, ${readyButton.y.toFixed(0)}px) }
  58%{ transform:translate(${openButton.x.toFixed(0)}px, ${openButton.y.toFixed(0)}px) }
  63%{ transform:translate(${openButton.x.toFixed(0)}px, ${openButton.y.toFixed(0)}px) }
  74%,100%{ transform:translate(${(W * 0.62).toFixed(0)}px, ${(BAR + OMNI + VIEW * 0.35).toFixed(0)}px) }
}
@keyframes tapIcon{ 19%{opacity:.9; transform:scale(.5)} 24%{opacity:0; transform:scale(1.15)} 0%,18.9%,24.1%,100%{opacity:0} }
@keyframes tapPanel{ 42%{opacity:.9; transform:scale(.5)} 47%{opacity:0; transform:scale(1.15)} 0%,41.9%,47.1%,100%{opacity:0} }
@keyframes tapOpen{ 63%{opacity:.9; transform:scale(.5)} 68%{opacity:0; transform:scale(1.15)} 0%,62.9%,68.1%,100%{opacity:0} }
.anim{ animation-duration:${SECONDS}s; animation-timing-function:cubic-bezier(.4,0,.2,1);
  animation-fill-mode:both; animation-iteration-count:1; }
</style>
<div class="win seek">
  <div class="bar">
    <div class="tab on"><span class="fav">${BIRD_SVG}</span><span class="tl">TrickyBird</span></div>
    <div class="tab"><span class="tl">New Tab</span></div>
  </div>
  <div class="omni">
    <div class="nav">&#8592; &#8594; &#10227;</div>
    <div class="pill">
      <span class="anim" style="animation-name:omniBlocked">${s.omniBlocked}</span>
      <span class="anim" style="animation-name:omniConsole">${s.omniConsole}</span>
      <span class="anim" style="animation-name:omniProxied">${s.omniProxied}</span>
    </div>
    <div class="puzzle"></div><div class="me"></div>
  </div>
  <div class="view">
    <img class="anim" style="animation-name:showBlocked" src="${s.blocked.uri}">
    <img class="anim" style="animation-name:showConsole" src="${s.console.uri}">
    <img class="anim" style="animation-name:showProxied" src="${s.proxied.uri}">
  </div>
  <div class="panel anim" style="animation-name:panelReady; width:${s.ready.w}px">
    <img src="${s.ready.uri}" style="width:${s.ready.w}px; display:block">
  </div>
  <div class="panel anim" style="animation-name:panelRouted; width:${s.routed.w}px">
    <img src="${s.routed.uri}" style="width:${s.routed.w}px; display:block">
  </div>
  <div class="tapped anim" style="animation-name:tapIcon; left:${icon.x}px; top:${icon.y}px"></div>
  <div class="tapped anim" style="animation-name:tapPanel; left:${readyButton.x.toFixed(0)}px; top:${readyButton.y.toFixed(0)}px"></div>
  <div class="tapped anim" style="animation-name:tapOpen; left:${openButton.x.toFixed(0)}px; top:${openButton.y.toFixed(0)}px"></div>
  <svg class="cursor anim" style="animation-name:walk" viewBox="0 0 22 22" fill="#fff" stroke="#1a1a1f" stroke-width="1.2">
    <path d="M4 2l13 8.2-6.1.9 3.2 6.4-2.6 1.3-3.2-6.4-4.3 4z"/>
  </svg>
</div>`;
}

/** Seeks the paused timeline frame by frame and photographs each one. */
async function render(/** @type {string} */ html, /** @type {string} */ dir) {
  const browser = await chromium.launch({ headless: process.env.HEADED !== '1', channel: 'chromium' });
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
  await page.setContent(html, { waitUntil: 'load' });
  await page.waitForTimeout(600);
  const frames = FPS * SECONDS;
  for (let i = 0; i < frames; i += 1) {
    await page.evaluate((/** @type {number} */ ms) => {
      for (const a of document.getAnimations()) {
        a.pause();
        a.currentTime = ms;
      }
    }, (i / FPS) * 1000);
    await page.screenshot({ path: join(dir, `f${String(i).padStart(4, '0')}.png`) });
  }
  await browser.close();
  return frames;
}

const ff = (/** @type {string[]} */ args) => execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args]);

const pages = await capturePages();
const panels = await capturePanels();
const gatewayHost = process.env.DEMO_GATEWAY_HOST ?? pages.landed.host;
const consoleHost = process.env.DEMO_CONSOLE_HOST ?? new URL(CONSOLE).host;

const frameDir = mkdtempSync(join(tmpdir(), 'tb-demo-frames-'));
mkdirSync(OUT, { recursive: true });
const html = stage({
  blocked: pages.blocked,
  console: pages.console,
  proxied: pages.proxied,
  ready: panels.ready,
  routed: panels.routed,
  omniBlocked: new URL(TARGET).host + new URL(TARGET).pathname,
  omniConsole: consoleHost,
  omniProxied: gatewayHost + pages.landed.pathname,
});
writeFileSync(join(frameDir, 'stage.html'), html);
const frames = await render(html, frameDir);

const input = ['-framerate', String(FPS), '-i', join(frameDir, 'f%04d.png')];
const h264 = ['-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p',
  '-movflags', '+faststart'];
ff([...input, ...h264, join(OUT, 'demo-2560x1440.mp4')]);
ff([...input, '-vf', 'scale=1920:1080:flags=lanczos', ...h264, join(OUT, 'demo-1920x1080.mp4')]);
ff([...input, '-vf', `fps=15,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse`,
  join(OUT, 'demo.gif')]);

rmSync(frameDir, { recursive: true, force: true });
console.log(`${frames} frames at ${FPS}fps -> docs/demo-2560x1440.mp4, docs/demo-1920x1080.mp4, docs/demo.gif`);
console.log(`address bar: ${consoleHost} and ${gatewayHost}${pages.landed.pathname}`);
