<p align="center">
  <img src="icons/icon-128.png" alt="" width="88" height="88">
</p>

<h1 align="center">TrickyBird Web Proxy Chrome Extension</h1>

<p align="center">
  Routes <b>one tab</b> through the TrickyBird web proxy.<br>
  Every other tab goes out the ordinary way.
</p>

<p align="center">
  <a href="https://github.com/Trickybird/chrome-extension/actions/workflows/ci.yml"><img
    src="https://github.com/Trickybird/chrome-extension/actions/workflows/ci.yml/badge.svg"
    alt="CI"></a>
  <a href="https://github.com/Trickybird/chrome-extension/releases/latest"><img
    src="https://img.shields.io/github/v/release/Trickybird/chrome-extension" alt="Latest release"></a>
  <img src="https://img.shields.io/badge/manifest-v3-blue" alt="Manifest V3">
  <a href="LICENSE"><img
    src="https://img.shields.io/github/license/Trickybird/chrome-extension" alt="MIT licence"></a>
</p>

Not a VPN. No country list, no server picker, no master switch.

## What routing a tab does

- The proxy's servers fetch the page and rewrite it before your browser sees it, so they handle the
  address, the headers, what you type into a form, and the cookies the site sets.
- That tab's address bar shows one of the proxy's addresses instead of the site's.
- Cookies from that site are held on the server rather than in your browser.

None of it applies to any other tab.

## Use it

The toolbar icon or the right-click menu, then **Open with TrickyBird**. On a browser page or a
blank tab there is nothing to route, and the popup says so.

The Chrome Web Store listing is in preparation. To run it from source: `chrome://extensions`,
Developer mode, Load unpacked, this directory.

## Permissions

```json
"permissions": ["declarativeNetRequest", "storage", "activeTab", "contextMenus"],
"optional_permissions": ["webNavigation"],
"externally_connectable": { "matches": ["https://trickybird.com/*"] }
```

**You are never asked for access to a site you route.** Not at install, not on the first site, not
on the hundredth. There is no host in the manifest at all, because nothing here makes a request:
the site opens the session, and moving a tab needs access to nothing.

That comes from how the [declarativeNetRequest][dnr] rules are built, not from cutting a corner. A
test asserts the rule table never grows an action that would need more.

Chrome shows one warning for this set, "Block content on any page".

`externally_connectable` is not a permission and raises no warning. It grants the extension nothing;
it names the pages allowed to speak to it. The pattern is one exact host, never a subdomain
wildcard, and a test holds it there.

The manifest in this repository names a second one: a console on a `.test` name, so the extension
can be loaded straight from here and pointed at a stack running on your own machine. `.test` never
resolves on the public internet, and `npm run package` strips the entry and refuses to build an
archive that still carries it.

One thing can still ask, and it is off by default: the offer to help when a page fails needs
`webNavigation` to see which page failed. Settings asks at the moment you switch it on.

`permissions.baseline.json` records the set. `npm run permissions` fails if the manifest drifts.

## Routing

The extension parks the address, sends the tab to our site, and waits. The site opens the session
the same way it does for anyone typing an address there, then hands the result back. Only then does
the extension fence the tab, read its own rules back, and move it.

The fence is session rules scoped to one tab id, plus one more scoped to the proxy's own origin: a
service worker's request belongs to no tab, so a tab-scoped rule cannot see it. Nothing leaves that
tab except through the proxy, and a device on your own network is left alone. The rules die with the browser session, closing the
tab removes them, and they are the record of which tabs are fenced.

The address you opened never reaches a request line. It is either parked in memory, with the tab
carrying a one-time code in the fragment, or carried in the fragment itself, which browsers do not
send to a server.

The extension makes two kinds of request and neither needs access to any site. It asks a public DNS
resolver over HTTPS for the list of addresses this proxy answers on, so that an address blocked
tomorrow can be replaced without a new release; the answer is signed, and one that is not is
discarded. And it asks those addresses whether they respond, one at a time, so a launch starts at one
that works. Neither request carries the site you are opening.

[dnr]: https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest

## Develop

```
npm install      # types only
npm run check    # types, tests, permission baseline
npm run package  # reproducible zip in build/, prints its sha256
```

No bundler, no build step. `src/` is plain ES modules loaded as they are, so what you read is what
runs. Types are JSDoc checked by `tsc --checkJs`.

```
src/
  background.js   registers browser events and delegates
  router.js       routes and unroutes a tab; the only module touching rules or navigation
  rules.js        builds and reads back the rule table (pure)
  target.js       what may be routed (pure)
  proxy-url.js    the proxy's address format (pure)
  endpoints.js    which session address to try, and in what order (pure)
  recovery.js     which navigation failures may be offered a retry (pure)
  bootstrap-url.js what the site is allowed to hand back (pure)
  catalog.js      the signed address list: reading it, checking it (pure + one signature check)
  doh.js          asking a public resolver for that list
  fronts.js       which addresses exist, which one answers, which one to open
  pending.js      launches waiting on the site, one per nonce
  handoff.js      the site's channel: the checks, the watchdog, the address walk
  offers.js       one pending suggestion per tab
  badge.js        the toolbar badge, with a single owner
  site-links.js   the links both surfaces carry
  config.js       settings
  errors.js       error codes
  messaging.js    the surface-to-background contract, and the site's
  popup.*         toolbar popup
  options.*       settings
```

The popup learns which site you are on from `activeTab`, granted when you invoke the extension.
Nothing reads a tab's address at any other time.

`npm test` runs against the pure modules and the manifest: no browser, no network.

Two optional tools need Playwright, which the tests do not. `tools/platform-probe.mjs` loads the
extension into a real Chromium and prints the platform limits the code assumes.
`tools/live-handoff.mjs` drives a whole launch through that browser, serving the three hosts
locally: the channel, the fragment, the rule table and the navigation are all things a unit test
cannot see.

## Contributing

Issues are welcome: a site that will not route, a screen that reads wrong, an idea. Read
[CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

A vulnerability is the one thing that does not go in an issue. See [SECURITY.md](SECURITY.md).

## License

MIT. See [LICENSE](LICENSE).
