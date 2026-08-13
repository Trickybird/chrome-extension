/**
 * Store screenshots. The panels, the options tab and the browser error page are REAL captures of
 * the running extension; only the poster around them (frame, browser-chrome mock, captions,
 * callouts) is composited. Nothing about the product's own UI is drawn or invented.
 *
 *   npm install --no-save playwright && npx playwright install chromium
 *   node tools/store-shots.mjs        writes build/shots/*.png at 1280x800
 *
 * Five beats: hook, result+scope, mechanism, trust, control. The concept and its honesty rules come
 * from the product-designer pass; the window sizes are the "bigger windows, less empty canvas"
 * tuning on top of it.
 */

import { mkdirSync, rmSync, cpSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
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
const html = (/** @type {string} */ t) =>
  ({ contentType: 'text/html', body: `<!doctype html><title>${t}</title>` });
for (const [pattern, title] of [[`${CONSOLE}/**`, 'console'], [`${TARGET}*`, 'target'], [`${GATEWAY}/**`, 'proxied']]) {
  await ctx.route(pattern, (/** @type {any} */ r) => r.fulfill(html(title)));
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
// The error page is captured on its own smaller viewport so its text stays legible once scaled into
// a window; the panels need a routable, loaded tab, so the error nav happens first and the tab is
// put back on the stubbed target afterwards.
await target.setViewportSize({ width: 780, height: 560 });
await target.goto(ERR).catch(() => {});
await target.waitForTimeout(400);
const errorShot = await grab(target.locator('body'));
await target.setViewportSize({ width: 1280, height: 800 });
await target.goto(TARGET);

// Hero + trust: the first-run idle panel (a fresh profile has never seen it), no offer set.
const heroPanel = await grabPanel({ want: 'Open this page' });
const trustPanel = await grabPanel({
  want: 'Open this page',
  after: () => popup.evaluate(() => document.getElementById('trade')?.setAttribute('open', '')),
});

// Mechanism: the right-click offer, which needs no opt-in permission.
const entryPanel = await grabPanel({
  want: 'Open this link',
  setup: () => sw.evaluate(async (/** @type {any[]} */ [t, url]) => {
    await chrome.storage.session.set({ offers: { [String(t)]: { url, reason: 'link' } } });
  }, /** @type {[number, string]} */ ([tabId, TARGET])),
});

// Result: drive the real launch so the fence is installed by the console answering, not faked.
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
const resultPanel = await grabPanel({ want: 'fetches' });

// Control: the options page, which really opens in a tab.
const opt = await ctx.newPage();
await opt.setViewportSize({ width: 1080, height: 900 });
await opt.goto(`chrome-extension://${id}/src/options.html`);
await opt.waitForTimeout(500);
const optionsShot = await grab(opt.locator('main, body').first());

// ── the poster: everything below is composited around the real captures above ──────────────────
const composer = await ctx.newPage();
await composer.setViewportSize({ width: 1280, height: 800 });

// Every frame is the SAME 1080x600 window (product-designer's one-template rule): what varies is
// only what fills its view and whether a real popup overlaps its own top-right. Trust stops being a
// naked panel, hero stops being two windows.
const shotImg = (/** @type {{uri:string}} */ s, cls = '') => `<img class="${cls}" src="${s.uri}">`;

/**
 * A drawn Chrome window (the OS chrome is not capturable, so it is a diagram, never a capture). The
 * panel is a real capture and is a child of THIS window, so its top-right anchor is the window, not
 * a shared wrapper — that was the hero-clipping bug.
 * @param {{ omnibox: string, tabs?: number, active?: number, body: string, panel?: string,
 *   glow?: 'right'|'center', fade?: boolean }} spec
 */
const chromeWindow = ({ omnibox, tabs = 0, active = 0, body, panel = '', glow, fade = true }) => {
  const strip = tabs > 0
    ? `<div class="tabs">${Array.from({ length: tabs }, (_, i) =>
        `<div class="tab ${i === active ? 'on' : ''}"><span class="fav"></span><span class="tl"></span></div>`).join('')}</div>`
    : '';
  return `
    <div class="win">
      ${glow ? `<div class="glow ${glow}"></div>` : ''}
      <div class="bar"><div class="dots"><i></i><i></i><i></i></div>${strip}</div>
      <div class="omni"><div class="pill">${omnibox}</div><div class="puzzle"></div></div>
      <div class="view ${fade ? 'fade' : ''}">${body}</div>
      ${panel}
    </div>`;
};

// A generic page: a heading, a hero-media block, a few paragraph lines. The media block gives the
// window most of its height honestly, without fabricating filler lines. Shared across 2, 3, 4.
const skeleton = `<div class="skel">
  <div class="ln head"></div>
  <div class="media"></div>
  <div class="ln"></div><div class="ln"></div><div class="ln"></div><div class="ln short"></div>
</div>`;

/** The whole poster for one frame. Caption band (always two lines) on top, one window below. */
const poster = (/** @type {{head: string, sub: string, stage: string}} */ { head, sub, stage }) => `
<!doctype html><meta charset="utf-8">
<style>
  ${geistFace}
  /* The product is light everywhere (globals.css is color-scheme:light, no dark variant); the
     poster now matches it. Ground = the launch screen's own recipe: the site canvas plus the
     tb-launch-light vignette (globals.css .tb-launch-light), no dot-field. Text uses the product's
     ink tokens. */
  :root{ --ink:#0c0c0d; --ink-2:#404047; --line:#e7e7e9;
         --canvas:#fafaf9; --surface:#fff; --accent:#5b4bf2; --chip1:#7c5cff; --chip2:#4b36e6; }
  *{ margin:0; box-sizing:border-box; }
  html,body{ width:1280px; height:800px; }
  body{ font:400 16px/1.4 ${CAPTION_FONT}; color:var(--ink);
        background:#e9e7f2;
        position:relative; overflow:hidden; -webkit-font-smoothing:antialiased; }
  /* The launch screen's own dot field, ink-on-paper on this light ground (globals.css tb-dust-plate
     recipe), edge-masked so it frames without competing with the window. */
  body::before{ content:""; position:absolute; inset:0; z-index:0;
    background-image:radial-gradient(rgba(17,17,19,.065) 1px, transparent 1.6px); background-size:18px 18px;
    -webkit-mask-image:radial-gradient(150% 130% at 50% 40%, #000 55%, transparent 100%);
            mask-image:radial-gradient(150% 130% at 50% 40%, #000 55%, transparent 100%); }
  /* The site header's Brand component, matched exactly: round chip, canvas glyph, 1.05rem semibold
     tracking-tight wordmark, gap 8px, no chip shadow. */
  .sig{ position:absolute; top:30px; left:44px; display:flex; align-items:center; gap:8px; z-index:3; }
  .sig .chip{ width:36px; height:36px; border-radius:50%; display:grid; place-items:center;
    background:linear-gradient(135deg,#7c5cff,#4b36e6); }
  .sig .chip svg{ width:22px; height:22px; }
  .sig .name{ font-weight:600; font-size:16.8px; letter-spacing:-.025em; color:var(--ink); }
  /* Fixed 132px band, always two lines, so every frame has the same caption-to-window gap. Sizes
     track the site hero: semibold, tight leading, tight tracking, ink. */
  .cap{ position:absolute; top:0; left:0; right:0; height:132px; display:flex; flex-direction:column;
        align-items:center; justify-content:center; text-align:center; padding:30px 80px 0; z-index:2; }
  .cap h1{ font-size:50px; line-height:1.05; font-weight:600; letter-spacing:-.025em;
           text-wrap:balance; max-width:1040px; color:var(--ink); }
  .cap p{ margin-top:8px; font-size:22px; line-height:1.3; color:var(--ink-2); font-weight:400; letter-spacing:-.01em; }
  .stage{ position:absolute; top:132px; left:0; right:0; bottom:0; display:flex; align-items:center;
          justify-content:center; z-index:1; }
  /* A white window on a light stage: a soft neutral elevation shadow plus a hairline, the Stripe/
     Linear convention, instead of the heavy black shadow that only worked on a dark ground. */
  .win{ position:relative; width:1080px; height:600px; background:var(--surface);
        border:1px solid rgba(46,38,90,.08); border-radius:16px; overflow:hidden;
        box-shadow:0 1px 2px rgba(46,38,90,.04), 0 3px 6px rgba(46,38,90,.04),
                   0 6px 12px rgba(46,38,90,.045), 0 11px 18px rgba(46,38,90,.05),
                   0 16px 26px -8px rgba(46,38,90,.07), inset 0 1px 0 rgba(255,255,255,.7); }
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
  .view{ position:relative; height:514px; background:#fff; overflow:hidden; }
  .view > img{ width:100%; display:block; }
  /* A page longer than the box reads as "more below the fold", never a hard mid-row cut. */
  .view.fade::after{ content:""; position:absolute; left:0; right:0; bottom:0; height:120px;
    background:linear-gradient(transparent, #fff); pointer-events:none; }
  .skel{ padding:44px 52px; display:flex; flex-direction:column; gap:16px; }
  .skel .ln{ height:14px; border-radius:6px; background:#eeeef1; }
  .skel .ln.head{ width:46%; height:26px; background:#e5e5e9; margin-bottom:6px; }
  .skel .media{ width:100%; height:160px; border-radius:10px; background:#edecf2; margin-bottom:8px; }
  .skel .ln:nth-of-type(2){ width:92%; } .skel .ln:nth-of-type(3){ width:84%; }
  .skel .ln:nth-of-type(4){ width:88%; } .skel .ln.short{ width:60%; }
  /* Same ambient indigo family as the window, one step tighter — the popup is a smaller card, so
     its shadow radius is smaller, and the two stay consistent instead of one being a black slab. */
  .pop{ position:absolute; top:16px; right:16px; width:320px; border-radius:14px; z-index:2;
        box-shadow:0 1px 2px rgba(46,38,90,.05), 0 3px 6px rgba(46,38,90,.05),
                   0 6px 12px rgba(46,38,90,.06), 0 11px 20px -4px rgba(46,38,90,.08),
                   0 0 0 1px rgba(46,38,90,.05); }
  /* One consistent light source across the set: the same soft accent glow on every frame. */
  .glow{ position:absolute; width:360px; height:360px; border-radius:50%; z-index:0;
         background:radial-gradient(circle, rgba(169,155,255,.35), transparent 65%); filter:blur(30px); }
  .glow.right{ top:-40px; right:-40px; } .glow.center{ top:-60px; left:50%; transform:translateX(-50%); }
</style>
<div class="sig"><div class="chip"><svg viewBox="6.5 3 22 22" fill="#fafaf9" fill-rule="evenodd" aria-hidden="true"><path d="M21 5.5c-3.6 0-6.6 2.7-7 6.2-1 .4-2.6 1.3-3.6 2.3-1.8 1.8-2.4 4.6-2.4 4.6l3.3-1.3c-.4 1.6-.3 3 .3 4.5 0 0 1.3-2.4 2.4-3.2 1.1.7 2.5 1.1 3.9 1.1 3.9 0 7-3.1 7-7 0-1-.2-2-.6-2.8l2.7-1.7-3.1-.2c-1.3-1.6-3.2-2.6-5.4-2.6zm1 3.85a1.65 1.65 0 110 3.3a1.65 1.65 0 010-3.3"/></svg></div><div class="name">TrickyBird</div></div>
<div class="cap"><h1>${head}</h1><p>${sub}</p></div>
<div class="stage">${stage}</div>`;

/** @param {string} name @param {string} content */
const render = async (name, content) => {
  await composer.setContent(content);
  await composer.evaluate(() => document.fonts.ready);
  await composer.waitForTimeout(200);
  const hi = join(OUT, `${name}.2x.png`);
  await composer.screenshot({ path: hi });
  execFileSync('sips', ['-Z', '1280', hi, '--out', join(OUT, `${name}.png`)], { stdio: 'ignore' });
  rmSync(hi, { force: true });
  console.log(`  ${name}.png`);
};

// One window per frame. The error page and settings are hard captures; the popup overlaps its own
// window's top-right; the skeleton stands in for a page. Hero and control fill the view with a real
// capture (no fade); 2/3/4 use the skeleton (fade).
await render('1-hero', poster({
  head: 'Didn&rsquo;t load? Open it with TrickyBird.',
  sub: 'The request goes out from our servers, not your browser.',
  stage: chromeWindow({ omnibox: 'news.example', body: shotImg(errorShot), panel: shotImg(heroPanel, 'pop'), glow: 'right', fade: false }),
}));

await render('2-result', poster({
  head: 'It only touches this tab.',
  sub: 'No VPN, no server list. Every other tab stays exactly as it was.',
  stage: chromeWindow({ omnibox: 'trickybird', tabs: 5, active: 2, body: skeleton, panel: shotImg(resultPanel, 'pop'), glow: 'right' }),
}));

await render('3-entry', poster({
  head: 'Two ways in. Zero setup.',
  sub: 'Right-click a link, or press the toolbar icon.',
  stage: chromeWindow({ omnibox: 'news.example', body: skeleton, panel: shotImg(entryPanel, 'pop'), glow: 'right' }),
}));

await render('4-trust', poster({
  head: 'See what changes, before you click.',
  sub: 'What our side handles, listed in plain words.',
  stage: chromeWindow({ omnibox: 'news.example', body: skeleton, panel: shotImg(trustPanel, 'pop'), glow: 'right' }),
}));

await render('5-control', poster({
  head: 'Turn it off whenever you want.',
  sub: 'Every tab it&rsquo;s touched, listed right here.',
  stage: chromeWindow({ omnibox: 'trickybird.com/settings', body: shotImg(optionsShot), glow: 'center' }),
}));

await ctx.close();
rmSync(profile, { recursive: true, force: true });
rmSync(extDir, { recursive: true, force: true });
console.log(`\n5 screenshots in build/shots, 1280x800`);
