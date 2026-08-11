<img src="icons/icon-128.png" alt="" width="72" align="right">

# TrickyBird Web Proxy for Chrome

Chrome extension that routes **one tab** through the TrickyBird web proxy. Every other tab goes out
the ordinary way.

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

Not on the Chrome Web Store yet. To run it from source: `chrome://extensions`, Developer mode, Load
unpacked, this directory. It asks `https://trickybird.com` for a session.

## Permissions

```json
"permissions": ["declarativeNetRequest", "storage", "activeTab", "contextMenus"],
"host_permissions": ["https://trickybird.com/*"],
"optional_permissions": ["webNavigation"]
```

**You are never asked for access to a site you route.** Not at install, not on the first site, not
on the hundredth.

That comes from how the [declarativeNetRequest][dnr] rules are built, not from cutting a corner. A
test asserts the rule table never grows an action that would need more.

Chrome shows one warning for this set, "Block content on any page". The single host in the manifest
is where sessions come from, and it appears by name with its own switch.

One thing can still ask, and it is off by default: the offer to help when a page fails needs
`webNavigation` to see which page failed. Settings asks at the moment you switch it on.

`permissions.baseline.json` records the set. `npm run permissions` fails if the manifest drifts.

## Routing

A session is minted, the tab is navigated to it, and session rules fence that tab in, scoped to its
tab id. Nothing leaves the tab except through the proxy, and a device on your own network is left
alone. The rules die with the browser session, closing the tab removes them, and they are the record
of which tabs are fenced.

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
  session.js      opens a session, walking the addresses until one answers
  offers.js       one pending suggestion per tab
  badge.js        the toolbar badge, with a single owner
  site-links.js   the links both surfaces carry
  config.js       settings
  errors.js       error codes
  messaging.js    the surface-to-background contract
  popup.*         toolbar popup
  options.*       settings
```

The popup learns which site you are on from `activeTab`, granted when you invoke the extension.
Nothing reads a tab's address at any other time.

`npm test` runs against the pure modules and the manifest: no browser, no network.
`tools/platform-probe.mjs` loads the extension into a real Chromium and prints the platform limits
the code assumes; it needs Playwright, which the tests do not.

## Contributing

Issues are welcome: a site that will not route, a screen that reads wrong, an idea. Read
[CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

A vulnerability is the one thing that does not go in an issue. See [SECURITY.md](SECURITY.md).

## License

MIT. See [LICENSE](LICENSE).
