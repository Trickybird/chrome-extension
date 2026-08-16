import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fixturePage, accentize, fitWithin, BIRD_SVG, SIG_MARKUP, productCard, tilePoster, marqueePoster,
  youtubeThumbPoster, avatarPoster, bannerPoster,
} from '../tools/store-shots-lib.mjs';

test('fixturePage: a generic page, never a photo or product UI', () => {
  const { contentType, body } = fixturePage('proxied');
  assert.equal(contentType, 'text/html');
  assert.match(body, /<!doctype html>/i);
  assert.match(body, /<title>proxied<\/title>/);
  // The label is the reserved example domain already used across the set, never a real site.
  assert.match(body, /news\.example/);
  assert.match(body, /<h1>/);
  // The media block stands in for an image as a flat rectangle: no <img>, no url(), no data: URI.
  assert.doesNotMatch(body, /<img/);
  assert.doesNotMatch(body, /url\(/);
  assert.doesNotMatch(body, /data:/);
});

test('accentize: wraps exactly one whole-word match in an accent span', () => {
  const out = accentize('Did not load? Open it with TrickyBird.', 'TrickyBird');
  assert.equal(out, 'Did not load? Open it with <span class="accent">TrickyBird</span>.');
});

test('accentize: a word absent from the text is left untouched, not thrown', () => {
  const text = 'It only touches this tab.';
  assert.equal(accentize(text, 'nowhere'), text);
});

test('accentize: matches a whole word only, not a substring inside a longer word', () => {
  // "test" must not match inside "testing" - a naive .replace(word, ...) would.
  const out = accentize('Keep testing carefully.', 'test');
  assert.equal(out, 'Keep testing carefully.');
});

test('fitWithin: shrinks to the binding dimension and preserves aspect ratio', () => {
  // A 380x600 popup capture (portrait) budgeted into a 640x560 box: height is the binding
  // constraint (600 * (560/600) = 560), so width follows the same 560/600 scale factor.
  const { w, h } = fitWithin(380, 600, 640, 560);
  assert.equal(h, 560);
  assert.equal(w, 380 * (560 / 600));
});

test('fitWithin: never upscales past the source size by default', () => {
  const { w, h } = fitWithin(200, 100, 800, 800);
  assert.equal(w, 200);
  assert.equal(h, 100);
});

test('fitWithin: an explicit maxScale allows a bounded upscale', () => {
  // Captures are taken at deviceScaleFactor 2, so up to 2x is lossless; a caller may opt into a
  // smaller, explicit ceiling (here 1.2x) to enlarge a real capture without ever guessing at blur.
  const { w, h } = fitWithin(380, 400, 1000, 1000, 1.2);
  assert.equal(w, 380 * 1.2);
  assert.equal(h, 400 * 1.2);
});

test('fitWithin: maxScale still yields to a tighter box constraint', () => {
  // Even with room to upscale 1.2x, a tight maxH still wins if it binds first.
  const { w, h } = fitWithin(380, 400, 1000, 420, 1.2);
  assert.equal(h, 420);
  assert.equal(w, 380 * (420 / 400));
});

test('productCard: sizes the plate to the fit box plus the 20px inset on every side', () => {
  const html = productCard({ img: { uri: 'data:image/png;base64,AA==' }, fit: { w: 400, h: 300 } });
  assert.match(html, /class="card"/);
  assert.match(html, /width:440px;height:340px/); // 400+40, 300+40
  assert.match(html, /<img src="data:image\/png;base64,AA==" style="width:400px;height:300px/);
});

test('tilePoster: exact 440x280 canvas, no product card, no chromeWindow', () => {
  const html = tilePoster({ font: 'Geist, sans-serif', fontFace: '', tagline: 'One-Tab Web Proxy' });
  assert.match(html, /html,body\{ width:440px; height:280px; \}/);
  // No product screenshot at this size (Google's minimal-text guidance) - no card plate, no window.
  assert.doesNotMatch(html, /class="card"/);
  assert.doesNotMatch(html, /class="win"/);
});

test('tilePoster: Option C anchors the lockup near the top edge (top:28px), not dead-centre', () => {
  const html = tilePoster({ font: 'Geist, sans-serif', fontFace: '', tagline: 'One-Tab Web Proxy' });
  assert.match(html, /\.wrap\{ position:absolute; left:0; right:0; top:28px; display:flex;\s*flex-direction:column;\s*align-items:center; \}/);
  // The old dead-centre lever (body itself flex-centered on both axes) is gone - the wrap is
  // top-anchored and only centers on the horizontal axis.
  assert.doesNotMatch(html, /justify-content:center/);
  // Never the top-left-corner .sig placement the five-frame poster and the marquee both use.
  assert.doesNotMatch(html, /class="sig"/);
});

test('tilePoster: chip 98px / bird glyph 60px / wordmark 46px / pill text 15px (owner refinement)', () => {
  const html = tilePoster({ font: 'Geist, sans-serif', fontFace: '', tagline: 'One-Tab Web Proxy' });
  assert.match(html, /\.chip\{ width:98px; height:98px/);
  assert.match(html, /\.chip svg\{ width:60px; height:60px; \}/);
  assert.match(html, /\.name\{ margin-top:14px; font-weight:600; font-size:46px;/);
  assert.match(html, /\.pill\{ margin-top:22px; padding:10px 22px;.*font-size:15px; font-weight:600;/s);
});

test('tilePoster: wordmark and pill are line-height:1 (ink-tight); margins are 14px chip->wordmark, 22px wordmark->pill', () => {
  const html = tilePoster({ font: 'Geist, sans-serif', fontFace: '', tagline: 'One-Tab Web Proxy' });
  assert.match(html, /\.name\{ margin-top:14px; font-weight:600; font-size:46px; line-height:1; letter-spacing:-\.03em;/);
  assert.match(html, /\.pill\{ margin-top:22px;.*line-height:1;/s);
});

test('tilePoster: the pill badge is a rounded, translucent-white chip with uppercase tracked text', () => {
  const html = tilePoster({ font: 'Geist, sans-serif', fontFace: '', tagline: 'One-Tab Web Proxy' });
  assert.match(html, /border-radius:999px; background:rgba\(255,255,255,\.16\);/);
  assert.match(html, /border:1px solid rgba\(255,255,255,\.24\);/);
  assert.match(html, /letter-spacing:\.06em; text-transform:uppercase;/);
});

test('tilePoster: renders the exact bird mark and wordmark, and the given tagline in the pill', () => {
  const html = tilePoster({ font: 'Geist, sans-serif', fontFace: '', tagline: 'One-Tab Web Proxy' });
  assert.match(html, new RegExp(BIRD_SVG.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(html, /<div class="name">TrickyBird<\/div>/);
  assert.match(html, /<div class="pill">One-Tab Web Proxy<\/div>/);
});

test('tilePoster: a different tagline is not hardcoded away - the caller\'s string wins', () => {
  const html = tilePoster({ font: 'Geist, sans-serif', fontFace: '', tagline: 'Web Proxy' });
  assert.match(html, /<div class="pill">Web Proxy<\/div>/);
  assert.doesNotMatch(html, /One-Tab/);
});

test('marqueePoster: exact 1400x560 canvas', () => {
  const html = marqueePoster({
    font: 'Geist, sans-serif', fontFace: '', heroPanel: { uri: 'data:image/png;base64,AA==' },
    heroFit: { w: 300, h: 400 },
  });
  assert.match(html, /html,body\{ width:1400px; height:560px; \}/);
});

test('marqueePoster: the .sig lockup is the literal shared markup, not a re-typed copy', () => {
  const html = marqueePoster({
    font: 'Geist, sans-serif', fontFace: '', heroPanel: { uri: 'data:image/png;base64,AA==' },
    heroFit: { w: 300, h: 400 },
  });
  assert.ok(html.includes(SIG_MARKUP), 'expected the exact SIG_MARKUP string, byte for byte');
});

test('marqueePoster: headline and subhead are the verbatim frame-1 strings', () => {
  const html = marqueePoster({
    font: 'Geist, sans-serif', fontFace: '', heroPanel: { uri: 'data:image/png;base64,AA==' },
    heroFit: { w: 300, h: 400 },
  });
  assert.match(html, /<h1>Didn&rsquo;t load\? Open it with TrickyBird\.<\/h1>/);
  assert.match(html, /<p>The request goes out from our servers, not your browser\.<\/p>/);
});

test('marqueePoster: the right column is the given heroPanel capture on a bare card, no chromeWindow', () => {
  const html = marqueePoster({
    font: 'Geist, sans-serif', fontFace: '', heroPanel: { uri: 'data:image/png;base64,BB==' },
    heroFit: { w: 300, h: 400 },
  });
  assert.match(html, /class="card"/);
  assert.match(html, /<img src="data:image\/png;base64,BB=="/);
  // Frame 4's precedent: no drawn browser-chrome window around the card at this size either.
  assert.doesNotMatch(html, /class="win"/);
  assert.doesNotMatch(html, /class="bar"/);
});

test('marqueePoster: keeps the shared 52px/24px .sig include untouched, then overrides it to a bigger, left-aligned 64px/30px lockup', () => {
  const html = marqueePoster({
    font: 'Geist, sans-serif', fontFace: '', heroPanel: { uri: 'data:image/png;base64,AA==' },
    heroFit: { w: 300, h: 400 },
  });
  // SIG_CSS's own shipped values, still present verbatim - the shared token is never edited.
  assert.match(html, /\.sig \.chip\{ width:52px; height:52px/);
  assert.match(html, /\.sig \.name\{ font-weight:600; font-size:24px/);
  // The marquee-only override, same selectors, later in the cascade.
  assert.match(html, /\.sig\{ top:48px; left:72px; gap:15px; \}/);
  assert.match(html, /\.sig \.chip\{ width:64px; height:64px; \}/);
  assert.match(html, /\.sig \.chip svg\{ width:39px; height:39px; \}/);
  assert.match(html, /\.sig \.name\{ font-size:30px; \}/);
  const sharedIdx = html.indexOf('.sig .chip{ width:52px');
  const overrideIdx = html.indexOf('.sig{ top:48px');
  assert.ok(sharedIdx !== -1 && overrideIdx !== -1 && sharedIdx < overrideIdx,
    'override block must come after the shared include so it wins the cascade');
});

test('marqueePoster: text column widened to 640px, headline 60px/1.1, subhead 22px with 18px margin-top', () => {
  const html = marqueePoster({
    font: 'Geist, sans-serif', fontFace: '', heroPanel: { uri: 'data:image/png;base64,AA==' },
    heroFit: { w: 300, h: 400 },
  });
  assert.match(html, /\.text\{ max-width:640px; \}/);
  assert.match(html, /\.text h1\{ font-size:60px; line-height:1\.1; font-weight:600;/);
  assert.match(html, /\.text p\{ margin-top:18px; font-size:22px; line-height:1\.4;/);
});

test('marqueePoster: .body-row keeps the left 72px edge (matches .sig) but moves the card right with a halved right padding', () => {
  const html = marqueePoster({
    font: 'Geist, sans-serif', fontFace: '', heroPanel: { uri: 'data:image/png;base64,AA==' },
    heroFit: { w: 300, h: 400 },
  });
  assert.match(html, /\.body-row\{ position:absolute; inset:0; display:flex; align-items:center; justify-content:space-between;\s*padding:0 84px 0 72px; \}/);
});

// ── youtubeThumbPoster: 1280x720 YouTube thumbnail ──────────────────────────────────────────────

test('youtubeThumbPoster: exact 1280x720 canvas', () => {
  const html = youtubeThumbPoster({
    font: 'Geist, sans-serif', fontFace: '', heroPanel: { uri: 'data:image/png;base64,AA==', w: 380 },
  });
  assert.match(html, /html,body\{ width:1280px; height:720px; \}/);
});

test('youtubeThumbPoster: the .sig lockup is the literal shared markup, sized up for grid legibility', () => {
  const html = youtubeThumbPoster({
    font: 'Geist, sans-serif', fontFace: '', heroPanel: { uri: 'data:image/png;base64,AA==', w: 380 },
  });
  assert.ok(html.includes(SIG_MARKUP), 'expected the exact SIG_MARKUP string, byte for byte');
  // Shared SIG_CSS's own shipped values are still present verbatim (the token is never edited)...
  assert.match(html, /\.sig \.chip\{ width:52px; height:52px/);
  // ...followed by a thumbnail-only override, same selectors, later in the cascade - the same lever
  // marqueePoster already uses to size its own .sig up for its own canvas.
  assert.match(html, /\.sig\{ top:36px; left:44px; gap:13px; \}/);
  assert.match(html, /\.sig \.chip\{ width:58px; height:58px; \}/);
  const sharedIdx = html.indexOf('.sig .chip{ width:52px');
  const overrideIdx = html.indexOf('.sig{ top:36px');
  assert.ok(sharedIdx !== -1 && overrideIdx !== -1 && sharedIdx < overrideIdx,
    'override block must come after the shared include so it wins the cascade');
});

test('youtubeThumbPoster: the frame-1 sentence word for word, split across two sizes, no subhead', () => {
  const html = youtubeThumbPoster({
    font: 'Geist, sans-serif', fontFace: '', heroPanel: { uri: 'data:image/png;base64,AA==', w: 380 },
  });
  // Split for the shrink, never reworded: the two halves still read back as the approved sentence.
  assert.match(html, /<span class="q">Didn&rsquo;t load\?<\/span> <span class="a">Open it with TrickyBird\.<\/span>/);
  const heading = /<h1>(.*?)<\/h1>/s.exec(html)?.[1].replace(/<[^>]+>/g, '') ?? '';
  assert.equal(heading, 'Didn&rsquo;t load? Open it with TrickyBird.');
  assert.doesNotMatch(html, /<p>/);
  // The question survives the grid; anything under about 80px does not.
  assert.match(html, /\.cap \.q\{[^}]*font-size:88px/);
});

test('youtubeThumbPoster: the panel runs at its captured width, so it is never resampled', () => {
  const html = youtubeThumbPoster({
    font: 'Geist, sans-serif', fontFace: '', heroPanel: { uri: 'data:image/png;base64,CC==', w: 380 },
  });
  assert.match(html, /<img src="data:image\/png;base64,CC=="/);
  assert.match(html, /\.shot\{[^}]*width:380px/);
  assert.match(html, /\.shot img\{ display:block; width:380px; \}/);
  // A fixed-height box: what does not fit is cropped, never shrunk to fit.
  assert.match(html, /\.shot\{[^}]*height:468px[^}]*overflow:hidden/);
  assert.doesNotMatch(html, /class="win"/);
  assert.doesNotMatch(html, /class="bar"/);
  assert.doesNotMatch(html, /class="card"/);
});

// ── avatarPoster: 800x800 YouTube channel avatar ────────────────────────────────────────────────

test('avatarPoster: exact 800x800 canvas', () => {
  const html = avatarPoster({ font: 'Geist, sans-serif', fontFace: '' });
  assert.match(html, /html,body\{ width:800px; height:800px; \}/);
});

test('avatarPoster: the bare bird glyph, not wrapped in its own chip circle - contrast on the violet canvas', () => {
  const html = avatarPoster({ font: 'Geist, sans-serif', fontFace: '' });
  assert.match(html, new RegExp(BIRD_SVG.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(html, /class="chip"/);
  assert.doesNotMatch(html, /class="sig"/);
});

test('avatarPoster: glyph and wordmark are centered in the full canvas, which is concentric with the 80% safe circle', () => {
  const html = avatarPoster({ font: 'Geist, sans-serif', fontFace: '' });
  assert.match(html, /display:flex; align-items:center; justify-content:center; \}/);
  assert.match(html, /<div class="name">TrickyBird<\/div>/);
});

test('avatarPoster: glyph 320px, wordmark 44px - short enough to clear the 640px safe circle with margin', () => {
  const html = avatarPoster({ font: 'Geist, sans-serif', fontFace: '' });
  assert.match(html, /\.wrap svg\{ width:320px; height:320px; \}/);
  assert.match(html, /\.name\{ margin-top:26px; font-weight:600; font-size:44px;/);
});

// ── bannerPoster: 2048x1152 YouTube channel banner ──────────────────────────────────────────────

test('bannerPoster: exact 2048x1152 canvas', () => {
  const html = bannerPoster({ font: 'Geist, sans-serif', fontFace: '', tagline: 'One-Tab Web Proxy' });
  assert.match(html, /html,body\{ width:2048px; height:1152px; \}/);
});

test('bannerPoster: content centered in the full canvas, concentric with the 1546x423 safe area', () => {
  const html = bannerPoster({ font: 'Geist, sans-serif', fontFace: '', tagline: 'One-Tab Web Proxy' });
  assert.match(html, /display:flex; align-items:center; justify-content:center; \}/);
});

test('bannerPoster: renders the exact bird mark inside its chip, the wordmark, and the given tagline as a pill', () => {
  const html = bannerPoster({ font: 'Geist, sans-serif', fontFace: '', tagline: 'One-Tab Web Proxy' });
  assert.match(html, new RegExp(BIRD_SVG.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(html, /class="chip"/);
  assert.match(html, /<div class="name">TrickyBird<\/div>/);
  assert.match(html, /<div class="pill">One-Tab Web Proxy<\/div>/);
});

test('bannerPoster: a different tagline is not hardcoded away - the caller\'s string wins', () => {
  const html = bannerPoster({ font: 'Geist, sans-serif', fontFace: '', tagline: 'Web Proxy' });
  assert.match(html, /<div class="pill">Web Proxy<\/div>/);
  assert.doesNotMatch(html, /One-Tab/);
});

test('bannerPoster: chip 140px / bird glyph 84px / wordmark 64px / pill 22px - short enough to clear the 423px safe height', () => {
  const html = bannerPoster({ font: 'Geist, sans-serif', fontFace: '', tagline: 'One-Tab Web Proxy' });
  assert.match(html, /\.chip\{ width:140px; height:140px/);
  assert.match(html, /\.chip svg\{ width:84px; height:84px; \}/);
  assert.match(html, /\.name\{ margin-top:22px; font-weight:600; font-size:64px;/);
  assert.match(html, /\.pill\{ margin-top:20px;.*font-size:22px; font-weight:600;/s);
});
