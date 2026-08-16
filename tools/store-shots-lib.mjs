/**
 * Pure composition helpers for store-shots.mjs, kept free of Playwright (no browser import, no
 * side effects at module load) so they can be unit-tested without launching a browser. Anything
 * that needs a real page or a real capture stays in store-shots.mjs; anything that is just
 * string/number shaping, so it can be characterized by hand, lives here.
 */

/**
 * A generic destination-page body: a kicker label, a headline, a flat token-colored media block,
 * and two short paragraphs. This is what the harness's stub gateway/target routes serve, standing
 * in for "some page TrickyBird opened" without claiming to be a real site or a specific rewrite.
 * No stock imagery and no fabricated product UI: the media block is a plain rounded rectangle,
 * never a photo, and nothing here draws TrickyBird's own chrome.
 * @param {string} title
 * @returns {{ contentType: string, body: string }}
 */
export const fixturePage = (title) => ({
  contentType: 'text/html',
  body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<style>
  *{ margin:0; box-sizing:border-box; }
  body{ font:400 16px/1.6 system-ui,-apple-system,sans-serif; color:#0c0c0d; background:#fff;
        padding:48px 56px; -webkit-font-smoothing:antialiased; }
  .kicker{ font-size:13px; font-weight:600; letter-spacing:.04em; text-transform:uppercase;
           color:#6a6a74; margin:0 0 14px; }
  h1{ font-size:30px; line-height:1.2; font-weight:600; letter-spacing:-.02em; max-width:600px;
      margin:0 0 22px; }
  .media{ width:100%; max-width:600px; height:190px; border-radius:10px; margin:0 0 22px;
          background:#eeeef1; border:1px solid #e7e7e9; }
  p{ max-width:600px; font-size:15px; line-height:1.6; color:#404047; margin:0 0 14px; }
</style></head>
<body>
  <p class="kicker">news.example</p>
  <h1>Transit board approves funding for two new rail lines</h1>
  <div class="media"></div>
  <p>The plan adds capacity on the busiest routes and funds engineering studies for two proposed
     lines, with construction on the first phase expected to begin next year.</p>
  <p>Fares stay unchanged while the board reviews financing options over the coming months.</p>
</body></html>`,
});

/**
 * Wraps the first whole-word match of `word` in a headline with an accent span, so exactly one
 * word carries the product's single accent colour. Leaves the string untouched if the word is not
 * present, rather than throwing: a caption that no longer contains its accent word should fail
 * loudly in the composed page (a plain, uncoloured headline), not here.
 * @param {string} text
 * @param {string} word
 * @returns {string}
 */
export const accentize = (text, word) =>
  text.replace(new RegExp(`\\b${word}\\b`), (m) => `<span class="accent">${m}</span>`);

/**
 * Scales (w0,h0) to fit within (maxW,maxH), preserving aspect ratio. `maxScale` caps how far past
 * the source size the result may go and defaults to 1 (no upscale at all), because most captures
 * have no budget to spare it. Captures here are taken at deviceScaleFactor 2, so a modest, explicit
 * maxScale (of at most 2) enlarges a real capture with no visible loss - callers that want that
 * pass it deliberately, rather than this function guessing at what counts as "still crisp".
 * @param {number} w0
 * @param {number} h0
 * @param {number} maxW
 * @param {number} maxH
 * @param {number} [maxScale]
 * @returns {{ w: number, h: number }}
 */
export const fitWithin = (w0, h0, maxW, maxH, maxScale = 1) => {
  const scale = Math.min(maxW / w0, maxH / h0, maxScale);
  return { w: w0 * scale, h: h0 * scale };
};

// ── shared tokens, reused verbatim by poster() and every new composer template below, so a future
// design-token change lands in this one place instead of being hand-copied into a third. ──────────

/** The full-bleed canvas background, every asset's own colours, never the logo's --chip tokens. */
export const CANVAS_BG = 'linear-gradient(150deg, #8970ff 0%, #4b36e6 100%)';

/** The one card/window elevation shadow recipe, shared by every product-UI plate across every asset. */
export const CARD_SHADOW = '0 6px 16px -8px rgba(8,4,32,.32), 0 1px 3px rgba(8,4,32,.16)';

/** Design tokens (custom properties): the brand chip gradient stops and the on-canvas surface colours. */
export const TOKENS_CSS = `:root{ --line:#e7e7e9; --canvas:#fafaf9; --surface:#fff; --accent-fg:#fff;
       --chip1:#7c5cff; --chip2:#4b36e6; }`;

/** The bird mark: exact viewBox/path. One literal copy, owner rule "never redraw it" - every lockup
 * across every asset renders this same constant rather than a re-typed copy. */
export const BIRD_SVG = '<svg viewBox="6.5 3 22 22" fill="#fafaf9" fill-rule="evenodd" aria-hidden="true"><path d="M21 5.5c-3.6 0-6.6 2.7-7 6.2-1 .4-2.6 1.3-3.6 2.3-1.8 1.8-2.4 4.6-2.4 4.6l3.3-1.3c-.4 1.6-.3 3 .3 4.5 0 0 1.3-2.4 2.4-3.2 1.1.7 2.5 1.1 3.9 1.1 3.9 0 7-3.1 7-7 0-1-.2-2-.6-2.8l2.7-1.7-3.1-.2c-1.3-1.6-3.2-2.6-5.4-2.6zm1 3.85a1.65 1.65 0 110 3.3a1.65 1.65 0 010-3.3"/></svg>';

/** The top-left lockup (.sig): identical position and size on every five-frame poster and on the
 * marquee - a literal reuse, not a resize. */
export const SIG_CSS = `.sig{ position:absolute; top:30px; left:44px; display:flex; align-items:center; gap:12px; z-index:3; }
  .sig .chip{ width:52px; height:52px; border-radius:50%; display:grid; place-items:center;
              background:linear-gradient(135deg, var(--chip1) 0%, var(--chip2) 100%); flex:none; }
  .sig .chip svg{ width:32px; height:32px; }
  .sig .name{ font-weight:600; font-size:24px; letter-spacing:-.025em; color:var(--accent-fg); }`;

/** The .sig markup itself, so poster() and marqueePoster() render one identical lockup instead of
 * two independently hand-typed copies of the same three elements. */
export const SIG_MARKUP = `<div class="sig"><div class="chip">${BIRD_SVG}</div><div class="name">TrickyBird</div></div>`;

/** The one product-UI card plate: flat white, 20px inset, 20px radius, no border, the shared shadow. */
export const CARD_CSS = `.card{ position:relative; border-radius:20px; background:#fff;
       box-shadow:${CARD_SHADOW}; }`;

/**
 * The plate holding a real product-UI capture at its resolved fit size. Pure (no Playwright), so the
 * five-frame poster and the marquee's bare-card layout share one implementation of the same markup
 * instead of two hand-typed copies.
 * @param {{ img: {uri:string}, fit: {w:number,h:number} }} spec
 */
export const productCard = ({ img, fit }) => {
  const inset = 20;
  return `
    <div class="card" style="width:${fit.w + inset * 2}px;height:${fit.h + inset * 2}px;padding:${inset}px">
      <img src="${img.uri}" style="width:${fit.w}px;height:${fit.h}px;display:block">
    </div>`;
};

/**
 * Small promo tile, 440x280 (Chrome Web Store small promotional tile). Google's own guidance for
 * this placement is minimal text and saturated colour, so this is the one deliberate departure from
 * the five-frame system: no product card at this size, and the lockup itself is the whole hero
 * graphic. Option C from the product-designer's poster-hero pass: the chip is pushed toward the top
 * edge (asymmetric, not dead centre) for a livelier poster feel, and the tagline is recast as a pill
 * badge instead of a caption line. The lockup's own components (chip gradient, bird mark) are
 * untouched; only their size and position change.
 * @param {{ font: string, fontFace: string, tagline: string }} spec
 */
export const tilePoster = ({ font, fontFace, tagline }) => `
<!doctype html><meta charset="utf-8">
<style>
  ${fontFace}
  ${TOKENS_CSS}
  *{ margin:0; box-sizing:border-box; }
  html,body{ width:440px; height:280px; }
  body{ font:400 16px/1.4 ${font};
        background:${CANVAS_BG};
        position:relative; overflow:hidden;
        -webkit-font-smoothing:antialiased; }
  /* Owner refinement passes: chip stepped down 120 -> 108 -> 98px, bird glyph tracking it at ~0.61
     (73 -> 66 -> 60px), wordmark 50 -> 46px, and the wordmark->pill gap opened 16 -> 22px. The
     content block (98+14+46+22+37 = 217px, each element's own explicit box at line-height:1 plus the
     pill's 10px+10px padding and 1px+1px border) sits under top:28px, resolving to a ~35px bottom
     margin - deliberately bottom-heavier than the 28px top, per the owner. */
  .wrap{ position:absolute; left:0; right:0; top:28px; display:flex;
         flex-direction:column; align-items:center; }
  .chip{ width:98px; height:98px; border-radius:50%; display:grid; place-items:center;
         background:linear-gradient(135deg, var(--chip1) 0%, var(--chip2) 100%); flex:none; }
  .chip svg{ width:60px; height:60px; }
  .name{ margin-top:14px; font-weight:600; font-size:46px; line-height:1; letter-spacing:-.03em;
         color:var(--accent-fg); }
  /* The tagline recast as a pill badge instead of a caption line - together with the top-pushed
     chip, a genuinely different composition from the plain centered row+caption this replaces. */
  .pill{ margin-top:22px; padding:10px 22px; border-radius:999px; background:rgba(255,255,255,.16);
         border:1px solid rgba(255,255,255,.24); font-size:15px; font-weight:600;
         letter-spacing:.06em; text-transform:uppercase; line-height:1; color:var(--accent-fg); }
</style>
<div class="wrap">
  <div class="chip">${BIRD_SVG}</div>
  <div class="name">TrickyBird</div>
  <div class="pill">${tagline}</div>
</div>`;

/**
 * CWS marquee, 1400x560: the frame-1 hero beat reflowed wide, browser-chrome window dropped so the
 * card is the direct key visual (the same move frame 4 already made). Same .sig lockup, same
 * verbatim headline/subhead, same in-memory heroPanel capture, on a bare productCard() plate.
 * @param {{ font: string, fontFace: string, heroPanel: {uri:string}, heroFit: {w:number,h:number} }} spec
 */
export const marqueePoster = ({ font, fontFace, heroPanel, heroFit }) => `
<!doctype html><meta charset="utf-8">
<style>
  ${fontFace}
  ${TOKENS_CSS}
  *{ margin:0; box-sizing:border-box; }
  html,body{ width:1400px; height:560px; }
  body{ font:400 16px/1.4 ${font};
        background:${CANVAS_BG};
        position:relative; overflow:hidden; -webkit-font-smoothing:antialiased; }
  ${SIG_CSS}
  /* Marquee-only .sig override (owner v2 pass): the shared SIG_CSS above ships the five-frame
     poster's 52px/24px lockup untouched (that constant is reused verbatim by poster() and must stay
     at its shipped size). Same selectors, appended after the include, win at equal specificity - a
     bigger lockup (64px chip, 30px name) left-aligned with the .text column's own 72px left edge
     (previously 44px, a 28px mismatch nothing sat close enough to expose before this pass). */
  .sig{ top:48px; left:72px; gap:15px; }
  .sig .chip{ width:64px; height:64px; }
  .sig .chip svg{ width:39px; height:39px; }
  .sig .name{ font-size:30px; }
  ${CARD_CSS}
  /* Owner refinement pass: right padding cut roughly in half, 168px->84px (left stays 72px, matching
     .sig - the left column is untouched). justify-content:space-between plants the card flush
     against its own padding edge, so halving the right padding halves the card's own margin from the
     canvas's right edge, moving it right - a bigger centre gutter is the deliberate, expected result
     of this pass, not a regression to fix. */
  .body-row{ position:absolute; inset:0; display:flex; align-items:center; justify-content:space-between;
             padding:0 84px 0 72px; }
  /* 640px (was 560px): the real fix for the dead middle gutter. .body-row's
     justify-content:space-between plants the card flush right regardless of how much the text
     column claims, so a narrower column just left the space in between empty - enlarging the
     column's own type is what the flex gutter measures against. */
  .text{ max-width:640px; }
  .text h1{ font-size:60px; line-height:1.1; font-weight:600; letter-spacing:-.025em;
            text-wrap:balance; color:var(--accent-fg); }
  .text p{ margin-top:18px; font-size:22px; line-height:1.4; font-weight:400; letter-spacing:-.01em;
           color:rgba(255,255,255,.85); }
</style>
${SIG_MARKUP}
<div class="body-row">
  <div class="text">
    <h1>Didn&rsquo;t load? Open it with TrickyBird.</h1>
    <p>The request goes out from our servers, not your browser.</p>
  </div>
  ${productCard({ img: heroPanel, fit: heroFit })}
</div>`;

/**
 * YouTube video thumbnail, 1280x720. It is the video's poster, so it is read twice under conditions
 * neither store screenshot faces, and both of them decide the layout.
 *
 * The store draws a round play button dead centre of this tile, and YouTube's own grid shrinks it to
 * about 210px wide. So the centre column carries nothing, the meaning sits in the two halves either
 * side of it, and the type is set at a size that survives the shrink: at 210px the question is still
 * about 15px tall, where the old 52px single line landed under 9px and read as a grey smear.
 *
 * The sentence is the approved frame-1 line, word for word, split across two sizes rather than
 * rewritten - a shorter line would be a new claim and would need its own sign-off.
 *
 * The panel is shown at the width it was captured at, never upscaled: the capture is 380 CSS px at
 * `deviceScaleFactor: 2`, the composer renders at 2x, and render() halves the result, so every pixel
 * of it lands 1:1 in the file. Its lower half is cropped away instead of shrunk, because at grid
 * size a whole panel is unreadable body text and its top is the part that says what the product does.
 * @param {{ font: string, fontFace: string, heroPanel: {uri:string, w:number} }} spec
 */
export const youtubeThumbPoster = ({ font, fontFace, heroPanel }) => `
<!doctype html><meta charset="utf-8">
<style>
  ${fontFace}
  ${TOKENS_CSS}
  *{ margin:0; box-sizing:border-box; }
  html,body{ width:1280px; height:720px; }
  body{ font:400 16px/1.4 ${font};
        background:${CANVAS_BG};
        position:relative; overflow:hidden; -webkit-font-smoothing:antialiased; }
  ${SIG_CSS}
  /* Thumbnail-only .sig override, same lever as marqueePoster's: the shared 52px/24px lockup above
     stays untouched, this just wins the cascade after it. */
  .sig{ top:36px; left:44px; gap:13px; }
  .sig .chip{ width:58px; height:58px; }
  .sig .chip svg{ width:35px; height:35px; }
  .sig .name{ font-size:26px; }
  /* Optically centred against the panel opposite it, not against the canvas: the lockup already
     owns the top-left corner, so a type block centred on the canvas reads as sitting high. */
  .cap{ position:absolute; left:76px; top:264px; width:560px; z-index:2; }
  .cap h1{ color:var(--accent-fg); font-weight:600; }
  .cap .q{ display:block; font-size:88px; line-height:1.02; letter-spacing:-.035em; }
  .cap .a{ display:block; margin-top:22px; font-size:40px; line-height:1.18; font-weight:500;
           letter-spacing:-.012em; color:rgba(255,255,255,.92); }
  .shot{ position:absolute; right:76px; top:126px; width:${heroPanel.w}px; height:468px;
         border-radius:22px; overflow:hidden; background:#fff; box-shadow:${CARD_SHADOW}; z-index:1; }
  .shot img{ display:block; width:${heroPanel.w}px; }
</style>
${SIG_MARKUP}
<div class="cap"><h1><span class="q">Didn&rsquo;t load?</span> <span class="a">Open it with TrickyBird.</span></h1></div>
<div class="shot"><img src="${heroPanel.uri}"></div>`;

/**
 * YouTube channel avatar, 800x800. YouTube crops this to a circle, so everything that matters sits
 * inside a centered ~640px (80%) safe circle - outside it is bleed only, cropped away. Centering the
 * content in the FULL 800x800 canvas already centers it in that concentric safe circle too, so the
 * only job left is keeping the content block short enough to clear 640px with margin.
 *
 * The bird glyph runs bare on the canvas, not wrapped in its own chip circle. The chip is the
 * brand's OWN violet gradient (--chip1/--chip2), which on this violet CANVAS_BG is the same
 * low-contrast-by-design pairing poster()'s own .sig already accepts at full, close-up size (see
 * its comment above); an icon meant to read at a glance - often shrunk far smaller than any store
 * screenshot - needs the contrast a bare near-white glyph on deep violet gives it instead. BIRD_SVG
 * itself is the one literal constant, unaltered; only its chip wrapper is left off here.
 * @param {{ font: string, fontFace: string }} spec
 */
export const avatarPoster = ({ font, fontFace }) => `
<!doctype html><meta charset="utf-8">
<style>
  ${fontFace}
  ${TOKENS_CSS}
  *{ margin:0; box-sizing:border-box; }
  html,body{ width:800px; height:800px; }
  body{ font:400 16px/1.4 ${font};
        background:${CANVAS_BG};
        position:relative; overflow:hidden; -webkit-font-smoothing:antialiased;
        display:flex; align-items:center; justify-content:center; }
  .wrap{ display:flex; flex-direction:column; align-items:center; }
  .wrap svg{ width:320px; height:320px; }
  .name{ margin-top:26px; font-weight:600; font-size:44px; line-height:1; letter-spacing:-.03em;
         color:var(--accent-fg); }
</style>
<div class="wrap">${BIRD_SVG}
  <div class="name">TrickyBird</div>
</div>`;

/**
 * YouTube channel banner, 2048x1152. YouTube crops hard on every side; the only guaranteed-visible
 * box is a centered 1546x423 safe area, and that box is exactly concentric with the canvas (251px
 * margin left/right, 364.5px top/bottom) - so content centered in the FULL canvas is automatically
 * centered in the safe area too, as long as it clears 423px tall. Same lockup family as tilePoster
 * (chip, wordmark, tagline pill) at banner scale, reusing the identical pill recipe rather than a
 * fourth hand-typed tagline treatment; `tagline` is a caller-supplied string for the same reason
 * tilePoster's is - read live off extName at render time, not a second hardcoded copy. The rest of
 * the 2048x1152 canvas is deliberate CANVAS_BG bleed, cropped away by whichever surface shows it.
 * @param {{ font: string, fontFace: string, tagline: string }} spec
 */
export const bannerPoster = ({ font, fontFace, tagline }) => `
<!doctype html><meta charset="utf-8">
<style>
  ${fontFace}
  ${TOKENS_CSS}
  *{ margin:0; box-sizing:border-box; }
  html,body{ width:2048px; height:1152px; }
  body{ font:400 16px/1.4 ${font};
        background:${CANVAS_BG};
        position:relative; overflow:hidden; -webkit-font-smoothing:antialiased;
        display:flex; align-items:center; justify-content:center; }
  .wrap{ display:flex; flex-direction:column; align-items:center; }
  .chip{ width:140px; height:140px; border-radius:50%; display:grid; place-items:center;
         background:linear-gradient(135deg, var(--chip1) 0%, var(--chip2) 100%); flex:none; }
  .chip svg{ width:84px; height:84px; }
  .name{ margin-top:22px; font-weight:600; font-size:64px; line-height:1; letter-spacing:-.03em;
         color:var(--accent-fg); }
  .pill{ margin-top:20px; padding:12px 28px; border-radius:999px; background:rgba(255,255,255,.16);
         border:1px solid rgba(255,255,255,.24); font-size:22px; font-weight:600;
         letter-spacing:.06em; text-transform:uppercase; line-height:1; color:var(--accent-fg); }
</style>
<div class="wrap">
  <div class="chip">${BIRD_SVG}</div>
  <div class="name">TrickyBird</div>
  <div class="pill">${tagline}</div>
</div>`;
