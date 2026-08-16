/**
 * Store screenshots. The panels, the options tab and the browser error page are REAL captures of
 * the running extension; only the poster around them (frame, browser-chrome mock, captions) is
 * composited. Nothing about the product's own UI is drawn or invented. The one exception is the
 * payoff frame's "after" page: a generic, clearly-fictional article (`fixturePage` in
 * store-shots-lib.mjs) served by the harness's own stubbed gateway route, never a real site and
 * never claimed as one.
 *
 *   npm install --no-save playwright && npx playwright install chromium
 *   node tools/store-shots.mjs        writes build/shots/*.png
 *
 * Five beats at 1280x800: hook, result+scope, payoff, trust, control. The concept and its honesty
 * rules come from the product-designer pass; the visual treatment (BRIGHT lane: full-bleed
 * brand-violet canvas, one popup/card plate recipe, no drawn annotations) is the v2 revision on top
 * of it. Two CWS store-listing promo assets follow the same five, reusing the same tokens, the same
 * in-memory hero popup capture and the same render pipeline: a 440x280 small tile (brand mark only,
 * per Google's minimal-text guidance for that placement) and a 1400x560 marquee (the frame-1 hero
 * beat reflowed wide, bare card, no browser-chrome window). Three off-store brand assets follow the
 * same system again: a 1280x720 YouTube thumbnail (frame 4's bare-card stage under one short
 * headline), an 800x800 channel avatar (the bare bird glyph, centered inside the circular crop's
 * safe zone) and a 2048x1152 channel banner (the tile's chip+wordmark+tagline lockup, centered
 * inside the crop's safe zone). None of the five gallery frames, the tile or the marquee change.
 */

import { mkdirSync, rmSync, cpSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  fixturePage, accentize, fitWithin, productCard, tilePoster, marqueePoster,
  youtubeThumbPoster, avatarPoster, bannerPoster,
  TOKENS_CSS, SIG_CSS, SIG_MARKUP, CARD_CSS, CANVAS_BG,
} from './store-shots-lib.mjs';

// @ts-ignore -- optional, and the test suite needs no browser.
const { chromium } = await import('playwright').catch(() => {
  console.error('playwright is not installed. See the header of this file.');
  process.exit(1);
});

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'build', 'shots');
const CONSOLE = 'https://trickybird.com';
const TARGET = 'https://news.example/article';
const ERR = 'https://news.example/'; // outside the stub prefix, so Chrome renders its own error page
const GATEWAY = 'https://gw-1.example';

// The captions use the site's own face, Geist, embedded so the poster reads as one product with the
// site rather than a generic system-font ad. Read from the frontend's package at render time and
// inlined as a data URI; if it is not present, the captions fall back to system-ui.
const geistFace = (() => {
  try {
    const pnpm = join(ROOT, '..', '..', 'frontend', 'node_modules', '.pnpm');
    const pkg = readdirSync(pnpm).find((d) => d.startsWith('geist@'));
    if (!pkg) return '';
    const dir = join(pnpm, pkg, 'node_modules/geist/dist/fonts/geist-sans');
    const b64 = (/** @type {string} */ f) => readFileSync(join(dir, f)).toString('base64');
    return `
      @font-face{ font-family:Geist; font-weight:400; font-display:block;
        src:url(data:font/woff2;base64,${b64('Geist-Regular.woff2')}) format('woff2'); }
      @font-face{ font-family:Geist; font-weight:600; font-display:block;
        src:url(data:font/woff2;base64,${b64('Geist-SemiBold.woff2')}) format('woff2'); }`;
  } catch {
    return '';
  }
})();
const CAPTION_FONT = geistFace ? 'Geist, system-ui, sans-serif' : 'system-ui, -apple-system, sans-serif';

// The tile's short line is the store title's own tail, past the "TrickyBird" wordmark the lockup
// above it already draws (e.g. "TrickyBird Web Proxy" -> "Web Proxy"). Read live off extName - the
// single source of truth for the store title - instead of a second hardcoded copy that can drift the
// next time the title changes (it already has twice).
const extName = JSON.parse(readFileSync(join(ROOT, '_locales', 'en', 'messages.json'), 'utf8')).extName.message;
const tileTagline = extName.replace(/^TrickyBird\s+/, '');

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// A real user clicks the toolbar icon, which grants activeTab, and the popup then reads the tab's
// URL. Playwright cannot click the OS toolbar, so a popup opened as a page never gets that grant and
// every panel falls back to the launcher. This copy adds `tabs` so the popup reads the URL the same
// way an activeTab grant lets it: the rendered panel is byte-identical to the shipped one, the
// permission only stands in for the click the harness cannot perform. Never packaged, never shipped.
const extDir = join(tmpdir(), `tb-shots-ext-${process.pid}`);
cpSync(ROOT, extDir, {
  recursive: true,
  filter: (/** @type {string} */ src) =>
    !/(?:^|\/)(?:node_modules|build|\.git)(?:\/|$)/.test(src.slice(ROOT.length)),
});
const manifest = JSON.parse(readFileSync(join(extDir, 'manifest.json'), 'utf8'));
manifest.permissions = [...new Set([...(manifest.permissions ?? []), 'tabs'])];
writeFileSync(join(extDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

const profile = join(tmpdir(), `tb-shots-${process.pid}`);
const ctx = await chromium.launchPersistentContext(profile, {
  headless: process.env.HEADED !== '1',
  channel: 'chromium',
  viewport: { width: 1280, height: 800 },
  // Render at 2x so the captured popup and the composited text are retina-crisp; the final image is
  // downsampled to 1280x800 below, which the store requires. A 1x render left the panel soft.
  deviceScaleFactor: 2,
  args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
});
// CONSOLE is a hop the harness drives the tab through but never shows as content, so it stays a
// bare title. TARGET and GATEWAY are what the payoff frame's "after" and the ordinary background
// tab render, so both get the same honest generic article instead of a blank page.
const html = (/** @type {string} */ t) =>
  ({ contentType: 'text/html', body: `<!doctype html><title>${t}</title>` });
for (const [pattern, fulfill] of /** @type {const} */ ([
  [`${CONSOLE}/**`, html('console')],
  [`${TARGET}*`, fixturePage('target')],
  [`${GATEWAY}/**`, fixturePage('proxied')],
])) {
  await ctx.route(pattern, (/** @type {any} */ r) => r.fulfill(fulfill));
}

const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker', { timeout: 20000 }));
const id = new URL(sw.url()).host;

const target = await ctx.newPage();
await target.goto(TARGET);
const tabId = await sw.evaluate(async () => (await chrome.tabs.query({ active: true }))[0].id);

/** A data: URI of an element's own pixels, plus its box, so the composer can size it. */
const grab = async (/** @type {any} */ locator) => {
  const box = await locator.boundingBox();
  const buf = await locator.screenshot();
  return { uri: `data:image/png;base64,${buf.toString('base64')}`, w: box.width, h: box.height };
};

/**
 * A data: URI of the page's own viewport pixels at a fixed, known size (never the page's intrinsic
 * content height). Used for the payoff frame's before/after pair: a short error page and a taller
 * fixture article otherwise land at two different heights and produce the "small low BEFORE, large
 * high AFTER, offset diagonally" defect that a shared `.pair{align-items:center}` cannot fix on its
 * own - equalizing the source capture is what actually equalizes the two panes.
 * @param {any} page @param {{width:number,height:number}} vp
 */
const grabViewport = async (page, vp) => {
  const buf = await page.screenshot();
  return { uri: `data:image/png;base64,${buf.toString('base64')}`, w: vp.width, h: vp.height };
};

const popup = await ctx.newPage();
await popup.setViewportSize({ width: 400, height: 640 });
const heading = () => popup.locator('#heading').textContent();
const settled = () => popup.waitForFunction(() => document.getElementById('heading')?.textContent !== '');

/**
 * The popup reads the active tab, so the tab is brought to front before the panel is read. The
 * `goto` runs main() once while the popup is the active tab; we wait for THAT run to finish before
 * `setup` writes an offer, so it cannot consume the offer meant for the reload. The reload then runs
 * main() with the target active and the offer present, and is the only reader of it. `want` is a
 * heading substring the open retries until it matches, since the write can still lose the first race.
 *
 * @param {{ setup?: () => Promise<void>, after?: () => Promise<void>, want?: string }} [hooks]
 */
const grabPanel = async ({ setup, after, want } = {}) => {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await popup.goto(`chrome-extension://${id}/src/popup.html`);
    await settled();
    await target.bringToFront();
    if (setup) await setup();
    await popup.reload();
    await settled();
    if (!want || (await heading() ?? '').includes(want)) {
      if (after) await after();
      await popup.waitForTimeout(150);
      return grab(popup.locator('body'));
    }
    await popup.waitForTimeout(150);
  }
  throw new Error(`panel never showed "${want}"`);
};

// ── real captures, in an order that respects the state each one needs ──────────────────────────
// The error page is captured as a fixed 780x560 viewport screenshot (not an element screenshot), so
// its displayed size never depends on the page's own intrinsic content height - the payoff frame's
// "after" pane uses the same fixed box below, which is what actually equalizes the two panes. The
// panels need a routable, loaded tab, so the error nav happens first and the tab is put back on the
// stubbed target afterwards.
const PANE_VIEWPORT = { width: 780, height: 560 };
await target.setViewportSize(PANE_VIEWPORT);
await target.goto(ERR).catch(() => {});
await target.waitForTimeout(400);
const errorShot = await grabViewport(target, PANE_VIEWPORT);
await target.setViewportSize({ width: 1280, height: 800 });
await target.goto(TARGET);

// Hero + trust: the first-run idle panel (a fresh profile has never seen it), no offer set. Trust
// also expands its disclosure details before the capture, so the popup's own real content shows the
// address/cookie facts the frame is about - the panel is the whole point of this frame now, with no
// annotation pointing at any part of it.
const heroPanel = await grabPanel({ want: 'Open this page' });
// Trust sizing fix (logo-on-violet spec §3): the popup's disclosure is 4 bullets tall, which at the
// 568px stage the popup now shares with every other frame (no dedicated window budget any more)
// overflows before fitWithin's maxScale ever gets to bind - the card comes out smaller than the
// other frames', when it is supposed to read as the largest. Trimming to the 2 most concrete,
// trust-relevant facts (server fetch + cookie handling) before THIS capture only shortens the
// content enough for maxScale to bind instead of the height ceiling; the shipped popup is untouched.
const trustPanel = await grabPanel({
  want: 'Open this page',
  after: () => popup.evaluate(() => {
    document.getElementById('trade')?.setAttribute('open', '');
    const keep = new Set(['tradeServers', 'tradeCookies']);
    document.querySelectorAll('#trade li').forEach((li) => {
      if (!keep.has(li.id)) /** @type {HTMLElement} */ (li).style.display = 'none';
    });
  }),
});

// Result + payoff: drive the real launch so the fence is installed by the console answering, not
// faked. The tab that lands on the gateway URL is real for both frames: the popup panel (result)
// and the rendered body itself (payoff's "after"), captured at the same fixed 780x560 viewport as
// errorShot's "before" so both panes land at one identical displayed size with no per-page cropping.
const helper = await ctx.newPage();
await helper.goto(`chrome-extension://${id}/src/options.html`);
await helper.evaluate((/** @type {any[]} */ [t, url]) =>
  chrome.runtime.sendMessage({ type: 'launch', tabId: t, url }), [tabId, TARGET]);
await target.waitForURL(/trickybird\.com/, { timeout: 10000 }).catch(() => {});
const nonce = new URL(target.url()).hash.slice('#ticket='.length);
const proxyUrl = `${GATEWAY}/_session?sId=shot&d=${Buffer.from(TARGET).toString('base64url')}`;
await target.evaluate((/** @type {any[]} */ [extId, msg]) => new Promise((res) => {
  /** @type {any} */ (globalThis).chrome.runtime.sendMessage(extId, msg, () => {
    void /** @type {any} */ (globalThis).chrome.runtime.lastError;
    res(null);
  });
}), [id, { v: 1, op: 'handoff', nonce, proxyUrl }]).catch(() => {});
await target.waitForURL(/gw-1\.example/, { timeout: 10000 }).catch(() => {});
// The real gateway 302s the /_session bootstrap to the /_o/ form; the stub does not, so put the tab
// on that form by hand. The panel reads the URL back and reports a proven route, not a stale one.
await target.goto(`${GATEWAY}/_o/${Buffer.from('https://news.example').toString('base64url')}/`);
await target.setViewportSize(PANE_VIEWPORT);
await target.waitForTimeout(150);
const afterShot = await grabViewport(target, PANE_VIEWPORT);
await target.setViewportSize({ width: 1280, height: 800 });
const resultPanel = await grabPanel({ want: 'fetches' });

// Control: the options page, which really opens in a tab. The settings-form card is hidden before
// the capture so the frame ends cleanly after the two real cards (routed tabs, the trust facts)
// instead of fading out mid-checkbox.
const opt = await ctx.newPage();
await opt.setViewportSize({ width: 1080, height: 900 });
await opt.goto(`chrome-extension://${id}/src/options.html`);
await opt.waitForTimeout(500);
await opt.evaluate(() => {
  const form = document.getElementById('form');
  if (form) form.style.display = 'none';
});
const optionsShot = await grab(opt.locator('main'));

// ── the poster: everything below is composited around the real captures above ──────────────────
const composer = await ctx.newPage();
await composer.setViewportSize({ width: 1280, height: 800 });

/** @param {{uri:string}} s */
const shotImg = (s) => `<img src="${s.uri}">`;

/**
 * A drawn Chrome window (the OS chrome is not capturable, so it is a diagram, never a capture). The
 * panel is a real capture and is a child of THIS window, so its top-right anchor is the window, not
 * a shared wrapper — that was the hero-clipping bug. `viewH` lets the content area's height track a
 * real measured crop instead of the shared 482px slot every other frame uses unchanged. The 482/568
 * defaults sum with the 86px bar+omni strip to exactly winH, so the window has no dead slack below
 * its content and stays flush with the stage's own height (owner refinement: cap band grew 32px for
 * more breathing room under the subhead, so the shared window budget shrank by the same 32px to keep
 * sitting flush against the canvas bottom edge rather than overflowing it).
 * @param {{ omnibox?: string, tabs?: number, active?: number, body?: string, panel?: string,
 *   fade?: boolean, viewH?: number, winH?: number }} spec
 */
const chromeWindow = ({ omnibox = '', tabs = 0, active = 0, body = '', panel = '',
  fade = true, viewH = 482, winH = 568 }) => {
  const strip = tabs > 0
    ? `<div class="tabs">${Array.from({ length: tabs }, (_, i) =>
        `<div class="tab ${i === active ? 'on' : ''}"><span class="fav"></span><span class="tl"></span></div>`).join('')}</div>`
    : '';
  return `
    <div class="win" style="height:${winH}px">
      <div class="bar"><div class="dots"><i></i><i></i><i></i></div>${strip}</div>
      <div class="omni"><div class="pill">${omnibox}</div><div class="puzzle"></div></div>
      <div class="view ${fade ? 'fade' : ''}" style="height:${viewH}px">${body}</div>
      ${panel}
    </div>`;
};

// A generic page: a kicker, a heading, a hero-media block, a few paragraph lines, toned down to a
// soft, low-opacity wash so it reads as backgrounded real content rather than a loading skeleton.
// Only 2-result still needs one: the payoff frame uses the real fixture capture instead, and trust
// drops the page context entirely.
const pageMock = `<div class="skel">
  <div class="ln head"></div>
  <div class="media"></div>
  <div class="ln"></div><div class="ln short2"></div><div class="ln"></div><div class="ln short"></div>
</div>`;

/**
 * The before/after payoff: two real captures, both taken at the same fixed viewport (see
 * PANE_VIEWPORT), so they land at one identical displayed size with no distortion and no separate
 * cropping logic. Modeled on Pie's own before/after slide (refs/pie/pie-slide-1.png): two windows,
 * two labels, no connecting arrow.
 * @param {{ before: {uri:string}, after: {uri:string}, beforeLabel: string, afterLabel: string }} spec
 */
const beforeAfter = ({ before, after, beforeLabel, afterLabel }) => `
  <div class="pair">
    <div class="pane">
      <p class="panelabel">${beforeLabel}</p>
      <div class="paneframe"><div class="panebar"><i></i><i></i><i></i></div><img src="${before.uri}"></div>
    </div>
    <div class="pane">
      <p class="panelabel">${afterLabel}</p>
      <div class="paneframe"><div class="panebar"><i></i><i></i><i></i></div><img src="${after.uri}"></div>
    </div>
  </div>`;

/** The whole poster for one frame. Caption band on top, one stage below. */
const poster = (/** @type {{head: string, sub: string, stage: string}} */ { head, sub, stage }) => `
<!doctype html><meta charset="utf-8">
<style>
  ${geistFace}
  /* BRIGHT lane (product-designer v2 spec): a full-bleed brand-violet canvas, reusing the same
     --chip1/--chip2 tokens the logo's own gradient used before its badge dropped (see the reversed
     lockup below), instead of the pale #e9e7f2 field plus a dot-texture plus an ambient glow - once
     the canvas itself is saturated, those extra layers were
     fighting the canvas for the same "give this frame a silhouette" job. --accent-fg is the one text
     colour on that canvas (white); the old --accent/--accent-subtle tokens and the per-word accent
     highlight retire with them, since accent-on-accent would be invisible.
     Tokens, .sig and .card pulled from store-shots-lib.mjs (shared with tilePoster()/marqueePoster())
     rather than re-declared here, so a future token change lands in one place, not three. */
  ${TOKENS_CSS}
  *{ margin:0; box-sizing:border-box; }
  html,body{ width:1280px; height:800px; }
  body{ font:400 16px/1.4 ${CAPTION_FONT};
        /* Canvas gradient uses its OWN colours, NOT the logo's --chip tokens, so the mark is never
           altered to serve the background. Lighter toward the top/header, deep at the bottom. */
        background:${CANVAS_BG};
        position:relative; overflow:hidden; -webkit-font-smoothing:antialiased; }
  /* Original brand lockup restored (owner rule: never alter the brand logo). The chip is the brand's
     own violet gradient, so on this violet canvas it is low-contrast by design; contrast, if wanted,
     is handled on the background side, never by altering the mark. Sized up from the 36px original so
     it sits larger per the owner's earlier request; wordmark stays white to read on the violet. */
  ${SIG_CSS}
  /* 232px band (v2 spec §5: was 132px, with padding starting inside the old logo's own span -
     headline and lockup read as one crowded band, not two). justify-content:flex-start plus a 98px
     top padding makes the padding value BE the gap below the larger logo (82px logo bottom, 98px
     headline top, 16px clear gap) instead of center only nudging a midpoint. The band then grew a
     further 32px (owner refinement, post-v2) with padding-top left untouched, so the extra room
     lands entirely below the subhead - more breathing room before the stage, not more logo gap. */
  .cap{ position:absolute; top:0; left:0; right:0; height:232px; display:flex; flex-direction:column;
        align-items:center; justify-content:flex-start; text-align:center; padding:98px 80px 0; z-index:2; }
  .cap h1{ font-size:50px; line-height:1.05; font-weight:600; letter-spacing:-.025em;
           text-wrap:balance; max-width:1040px; color:var(--accent-fg); }
  /* No per-word accent highlight in BRIGHT: accent-on-accent is invisible, so accentize() still runs
     (one code path for both lanes) but its span is neutralized here to the headline's own colour. */
  .cap h1 .accent{ color:inherit; }
  .cap p{ margin-top:8px; font-size:22px; line-height:1.3; color:rgba(255,255,255,.85); font-weight:400; letter-spacing:-.01em; }
  .stage{ position:absolute; top:232px; left:0; right:0; bottom:0; display:flex; align-items:center;
          justify-content:center; z-index:1; }
  /* A white window on the saturated canvas: the shared dark elevation shadow (v2 spec §1) replaces
     the old indigo-tinted shadow, which nearly disappeared against a saturated violet ground because
     its hue matched it - a near-black, value-based shadow is what actually reads here. Geometry
     retuned tighter (logo-on-violet spec §2): the prior 48px blur / -16px spread fanned out into a
     soft cloud past the card's own edge, which read as blurry rather than a defined cast shadow;
     offset and blur both cut ~65-70% at the same 1:2 ratio, spread tightened to match, and both
     layers' opacity raised so the smaller blur area stays legible on violet instead of just fading. */
  .win{ position:relative; width:1080px; height:568px; background:var(--surface);
        border:1px solid rgba(46,38,90,.08); border-radius:16px; overflow:hidden;
        box-shadow:0 6px 16px -8px rgba(8,4,32,.32), 0 1px 3px rgba(8,4,32,.16); }
  .bar{ height:40px; background:var(--canvas); border-bottom:1px solid var(--line);
        display:flex; align-items:center; gap:16px; padding:0 16px; position:relative; z-index:1; }
  .dots{ display:flex; gap:8px; } .dots i{ width:12px; height:12px; border-radius:50%; background:#d6d6d9; }
  .tabs{ display:flex; gap:6px; align-items:center; }
  /* A real-looking tab: favicon dot + a truncated-title placeholder. Never indigo — that would
     claim TrickyBird touches every tab, which frame 2's own headline denies. */
  .tab{ width:132px; height:30px; border-radius:9px 9px 0 0; background:#e4e4e8;
        display:flex; align-items:center; gap:7px; padding:0 12px; }
  .tab .fav{ width:8px; height:8px; border-radius:50%; background:#b6b6bc; flex:none; }
  .tab .tl{ width:46px; height:6px; border-radius:4px; background:#c7c7cc; }
  .tab.on{ background:#fff; border:1px solid var(--line); box-shadow:0 2px 8px rgba(0,0,0,.06); }
  .tab.on .fav{ background:#8a8a90; } .tab.on .tl{ background:#9a9aa0; }
  .omni{ height:46px; background:var(--surface); border-bottom:1px solid var(--line);
         display:flex; align-items:center; gap:12px; padding:0 16px; position:relative; z-index:1; }
  .omni .pill{ flex:1; height:30px; background:var(--canvas); border:1px solid var(--line); border-radius:999px;
    display:flex; align-items:center; padding:0 16px; font-size:14px; color:#5b5b60; }
  .omni .puzzle{ width:22px; height:22px; border-radius:6px; background:#ededf0; }
  .view{ position:relative; background:#fff; overflow:hidden; }
  .view > img{ width:100%; display:block; }
  /* A page longer than the box reads as "more below the fold", never a hard mid-row cut. Only used
     where content is genuinely still cropped; the control frame turns this off once its own crop
     ends cleanly at a real element boundary instead. */
  .view.fade::after{ content:""; position:absolute; left:0; right:0; bottom:0; height:120px;
    background:linear-gradient(transparent, #fff); pointer-events:none; }
  .skel{ padding:44px 52px; display:flex; flex-direction:column; gap:14px; opacity:.55; }
  .skel .ln{ height:11px; border-radius:5px; background:#e2e2e7; }
  .skel .ln.head{ width:44%; height:22px; background:#d8d8de; margin-bottom:4px; }
  .skel .media{ width:100%; height:150px; border-radius:10px; background:#e6e5ec; margin-bottom:6px; }
  .skel .ln:nth-of-type(2){ width:88%; } .skel .ln.short2{ width:70%; }
  .skel .ln:nth-of-type(4){ width:82%; } .skel .ln.short{ width:52%; }
  /* The one product-UI card plate (v2 spec §3): flat white, 20px inset, 20px radius, no border, the
     same dark shadow recipe as .win, so a popup card and a browser window read as one material
     family, just two sizes of it. .pop only adds the top-right overlay position frames 1/2 use;
     frame 4 places this same div straight in .stage, frame 5 straight in .optcenter. */
  ${CARD_CSS}
  .pop{ position:absolute; top:16px; right:16px; z-index:2; }
  /* Control: the options capture shown at its own native width, centred rather than stretched. */
  .optcenter{ height:100%; display:flex; align-items:flex-start; justify-content:center; padding-top:24px; }
  /* Payoff: two real captures, side by side, at one shared scale - no connecting arrow (v2 spec §2,
     §6): Pie's own before/after reference uses none either, and an equal-size pair no longer needs
     a pointer to read correctly. */
  .pair{ display:flex; align-items:center; gap:32px; }
  .pane{ width:540px; }
  .pane .panelabel{ font-size:14px; font-weight:600; letter-spacing:.03em; text-transform:uppercase;
        color:rgba(255,255,255,.85); text-align:center; margin-bottom:12px; }
  .paneframe{ border:1px solid var(--line); border-radius:16px; overflow:hidden; background:#fff;
        box-shadow:0 6px 16px -8px rgba(8,4,32,.32), 0 1px 3px rgba(8,4,32,.16); }
  .panebar{ height:28px; background:var(--canvas); border-bottom:1px solid var(--line);
        display:flex; align-items:center; gap:6px; padding:0 12px; }
  .panebar i{ width:8px; height:8px; border-radius:50%; background:#d6d6d9; }
  .paneframe img{ width:100%; display:block; }
</style>
${SIG_MARKUP}
<div class="cap"><h1>${head}</h1><p>${sub}</p></div>
<div class="stage">${stage}</div>`;

/**
 * `size` defaults to the five-frame canvas; the tile and marquee pass their own so one render
 * pipeline downsamples all seven outputs the same way - `sips -Z <width>` against the larger
 * dimension, which is always the width here, so it never needs a separate height argument.
 * @param {string} name @param {string} content @param {{width:number,height:number}} [size]
 */
const render = async (name, content, size = { width: 1280, height: 800 }) => {
  await composer.setViewportSize(size);
  await composer.setContent(content);
  await composer.evaluate(() => document.fonts.ready);
  await composer.waitForTimeout(200);
  const hi = join(OUT, `${name}.2x.png`);
  await composer.screenshot({ path: hi });
  execFileSync('sips', ['-Z', String(size.width), hi, '--out', join(OUT, `${name}.png`)], { stdio: 'ignore' });
  rmSync(hi, { force: true });
  console.log(`  ${name}.png`);
};

// Popup budgets: a width ceiling per frame (the target proportions from the design pass) and a
// height ceiling, resolved by fitWithin so the real captured aspect ratio - whatever it turns out
// to be - never overflows its budget. All three popup captures are a fixed 380px CSS-pixel-wide
// document (popup.css `body{width:380px}`), taken at deviceScaleFactor 2, so a small explicit
// upscale (maxScale below) stays lossless; hero and trust use one to reach the design pass's target
// proportions instead of settling for whatever height each panel's own content happens to need.
const heroFit = fitWithin(heroPanel.w, heroPanel.h, 432, 566, 1.2);
const resultFit = fitWithin(resultPanel.w, resultPanel.h, 380, 566);
// Trust drops chromeWindow() entirely (v2 spec §7) - the popup floats straight in .stage on its own
// card, so its budget is a ceiling against the whole 1280x800 canvas, not a window's inner room.
// Sizing fix (logo-on-violet spec §3): the old 760x520 ceiling let maxH bind before maxScale ever
// got a chance to, because the un-trimmed 4-bullet capture was too tall for the 568px stage at any
// safe height ceiling - the card came out the smallest of the set instead of the largest. The height
// ceiling is bumped to 524 (568 stage - 40 card padding - 4px breathing, just under the true 528px
// physical max), and the disclosure trim above (2 bullets, not 4) shortens the capture enough that
// this now resolves at or near the 1.25 maxScale ceiling instead of the height cap.
const trustFit = fitWithin(trustPanel.w, trustPanel.h, 520, 524, 1.25);
console.log(`  popup sizes: hero ${heroFit.w.toFixed(0)}x${heroFit.h.toFixed(0)} (${(heroFit.w / 1080 * 100).toFixed(0)}% of window width), ` +
  `result ${resultFit.w.toFixed(0)}x${resultFit.h.toFixed(0)}, trust ${trustFit.w.toFixed(0)}x${trustFit.h.toFixed(0)} ` +
  `(${(trustFit.w / 1280 * 100).toFixed(0)}% of frame width)`);

// One window per frame. The error page and settings are hard captures; the popup overlaps its own
// window's top-right (hero, result) or IS the stage's whole content (trust); the page mock stands in
// for a page only where one is still needed (result). Hero and control fill the view with a real
// capture (no fade); result uses the mock (fade, content continues below the fold).
await render('1-hero', poster({
  head: accentize('Didn&rsquo;t load? Open it with TrickyBird.', 'TrickyBird'),
  sub: 'The request goes out from our servers, not your browser.',
  stage: chromeWindow({
    omnibox: 'news.example', body: shotImg(errorShot), fade: false,
    panel: `<div class="pop">${productCard({ img: heroPanel, fit: heroFit })}</div>`,
  }),
}));

await render('2-result', poster({
  head: accentize('It only touches this tab.', 'only'),
  sub: 'No VPN, no server list. Every other tab stays exactly as it was.',
  stage: chromeWindow({
    omnibox: 'trickybird', tabs: 5, active: 2, body: pageMock,
    panel: `<div class="pop">${productCard({ img: resultPanel, fit: resultFit })}</div>`,
  }),
}));

await render('3-payoff', poster({
  // A generic, illustrative before/after: the harness's stub gateway serves a stand-in article
  // (fixturePage in store-shots-lib.mjs), not a real site fetched-and-rewritten by the live
  // gateway, so the copy names a generic outcome and stops there. New claim text - flagged for
  // review-marketing-claim, not finalized here.
  head: accentize('Same page. This time it opens.', 'opens'),
  sub: 'A generic example of what comes back once TrickyBird opens it.',
  stage: beforeAfter({ before: errorShot, after: afterShot, beforeLabel: 'Before', afterLabel: 'After' }),
}));

// Frame 4 stops calling chromeWindow() (v2 spec §7): no browser-chrome box, no window shadow -
// nothing surrounding the popup but its own card, floating directly in .stage.
await render('4-trust', poster({
  head: accentize('See what changes, before you click.', 'changes'),
  sub: 'What our side handles, listed in plain words.',
  stage: productCard({ img: trustPanel, fit: trustFit }),
}));

// options.css caps `main` at 480px and centers it (`main{max-width:480px;margin:0 auto}`), so the
// capture itself is only 480px wide even at a 1080px viewport. Displaying it at its own native
// width - centered, not stretched to fill the window - keeps it crisp (no upscale) and matches how
// the real options page actually looks: a narrow centred column, not a full-bleed page. viewH adds
// 88 (was 48): the card's own 20px inset on top and bottom (40 total) now sits inside the same
// 24/24 breathing room that used to surround the bare image directly. winH is passed explicitly
// (bar + omni + viewH, the same exact-fit relationship the shared 568px default keeps for the other
// frames) rather than left at that shared default, since this frame's viewH is already its own
// dynamic, content-driven number and letting it diverge from a fixed winH risks either dead slack
// or the settings card's bottom edge getting clipped by `.win`'s own overflow:hidden.
const controlViewH = optionsShot.h + 88;
await render('5-control', poster({
  head: accentize('Turn it off whenever you want.', 'off'),
  sub: 'Every tab it&rsquo;s touched, listed right here.',
  stage: chromeWindow({
    omnibox: 'trickybird.com/settings', fade: false, viewH: controlViewH, winH: controlViewH + 86,
    body: `<div class="optcenter">${productCard({ img: optionsShot, fit: { w: optionsShot.w, h: optionsShot.h } })}</div>`,
  }),
}));

// ── CWS store-listing promo assets: the tile (brand mark only) and the marquee (frame-1's hero beat
// reflowed wide). Both reuse heroPanel in-memory - no second grabPanel() call, no second navigation.
await render('tile-440x280', tilePoster({ font: CAPTION_FONT, fontFace: geistFace, tagline: tileTagline }),
  { width: 440, height: 280 });

// Owner pass: bigger still, and pulled toward centre (not the browser-chrome "gutterfix" weighed
// and rejected for this asset - still the bare popup card, just larger). maxH raised 475->490 is the
// binding constraint at the real capture's aspect ratio (maxW and maxScale both raised past what
// they'd need to bind, so this stays governed by canvas height, not by an arbitrary width or scale
// ceiling); maxScale raised 1.2->1.3 for headroom, real captures at deviceScaleFactor 2 stay crisp
// well past this. Leaves ~19px top/bottom margin on the 560-tall canvas - checked clear of the
// card's own shadow bleed by the rendered PNG, not just the arithmetic.
const marqueeFit = fitWithin(heroPanel.w, heroPanel.h, 540, 490, 1.3);
console.log(`  marquee card size: ${marqueeFit.w.toFixed(0)}x${marqueeFit.h.toFixed(0)} ` +
  `(card box ${(marqueeFit.w + 40).toFixed(0)}x${(marqueeFit.h + 40).toFixed(0)} on a 560-tall canvas)`);
await render('marquee-1400x560', marqueePoster({
  font: CAPTION_FONT, fontFace: geistFace, heroPanel, heroFit: marqueeFit,
}), { width: 1400, height: 560 });
// The composer page still holds the just-rendered marquee content (nothing overwrites it before
// ctx.close() below), so the actual flex layout can be measured directly instead of hand-computed -
// .text's rendered width is content-driven (shrink-to-fit up to its max-width), so this is the only
// reliable way to know the real gutter between the text column and the card.
const marqueeGutter = await composer.evaluate(() => {
  const t = /** @type {Element} */ (document.querySelector('.text')).getBoundingClientRect();
  const c = /** @type {Element} */ (document.querySelector('.card')).getBoundingClientRect();
  return c.left - t.right;
});
console.log(`  marquee centre gutter: ${marqueeGutter.toFixed(1)}px`);

// ── off-store brand assets: a YouTube thumbnail, channel avatar and channel banner. Same tokens,
// same lockup, same in-memory heroPanel capture, same render() pipeline as the five frames and the
// two CWS assets above - nothing here is a second design system, just this one applied to three more
// canvases. The tile/marquee gallery above stays untouched.
// No fit budget here: the thumbnail shows the panel at its captured width, so it is never resampled.
await render('youtube-thumb-1280x720', youtubeThumbPoster({
  font: CAPTION_FONT, fontFace: geistFace, heroPanel,
}), { width: 1280, height: 720 });

await render('channel-avatar-800x800', avatarPoster({ font: CAPTION_FONT, fontFace: geistFace }),
  { width: 800, height: 800 });

await render('channel-banner-2048x1152', bannerPoster({
  font: CAPTION_FONT, fontFace: geistFace, tagline: tileTagline,
}), { width: 2048, height: 1152 });

await ctx.close();
rmSync(profile, { recursive: true, force: true });
rmSync(extDir, { recursive: true, force: true });
console.log(`\n5 screenshots in build/shots at 1280x800, plus tile-440x280.png, marquee-1400x560.png, ` +
  `youtube-thumb-1280x720.png, channel-avatar-800x800.png and channel-banner-2048x1152.png`);
