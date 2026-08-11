# TrickyBird Web Proxy

Chrome extension that routes **one tab** through the TrickyBird web proxy. Every other tab goes out
the ordinary way.

It is not a VPN. There is no country list, no server picker, and no master switch.

## What routing a tab does

- The proxy's servers fetch the page and rewrite it before your browser sees it, so they handle the
  address, the headers, what you type into a form, and the cookies the site sets.
- The address bar in that tab shows one of the proxy's own addresses instead of the site's.
- Cookies from that site are held on the server rather than in your browser.

None of that applies to any other tab.

## Ways in

- The toolbar icon, then **Open with TrickyBird**.
- Right-click a page or a link, then the same entry.

On a browser page or a blank tab there is nothing to route, and the popup says so and points at the
site, which takes an address.

Neither way shows a permission dialog. See [Permissions](#permissions) for why that is safe.

## Install from source

Not on the Chrome Web Store yet.

1. `chrome://extensions`, then Developer mode.
2. Load unpacked, then this directory.

It asks `https://trickybird.com` for a session.

## Permissions

```json
"permissions": ["declarativeNetRequest", "storage", "activeTab", "contextMenus"],
"host_permissions": ["https://trickybird.com/*"],
"optional_permissions": ["webNavigation"]
```

**You are never asked for access to a site you route.** Not at install, not on the first site, not
on the hundredth. The one host in the manifest is where sessions come from, and Chrome shows it by
name under "Automatically allow access on the following sites" with its own switch.

That is possible because of how the rules below are built rather than by cutting a corner. Chrome
requires host access for two [declarativeNetRequest][dnr] actions, `redirect` and `modifyHeaders`,
and for no others. A table made of `allow` and `block` needs nothing, and a tab reaches the proxy by
ordinary navigation instead of by redirection. A test asserts that no other action ever appears.

Chrome lists one warning for this set, "Block content on any page", and describes site access as
"This extension can read and change your data on sites. You can control which sites the extension
can access."

One thing can still ask for something, and it is off by default: the offer to help when a page fails
needs `webNavigation`, because that is what lets the extension see which page failed. The settings
page asks at the moment you switch it on, and not before.

`permissions.baseline.json` records the set; `npm run permissions` fails if the manifest drifts
from it.

## Routing

A session is minted, the tab is navigated to it, and two kinds of session rule fence the tab in,
scoped to its tab id:

| Priority | Action | Covers |
| --- | --- | --- |
| 2 | allow | loopback and private addresses |
| 1 | block | every request in that tab except the proxy |

Priority 2 above 1 keeps a device on your own network off the proxy. Priority 1 is the floor, so
nothing leaves the tab except through the proxy. The rules are session-scoped and die with the
browser session; closing the tab removes them, and they are the record of which tabs are fenced.

[dnr]: https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest

## Develop

```
npm install      # types only
npm run check    # types, tests, permission baseline
npm run package  # reproducible zip in build/, prints its sha256
```

No bundler and no build step. `src/` is plain ES modules loaded as-is, so what you read is what
runs. Types are JSDoc annotations checked by `tsc --checkJs`.

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
  site-links.js   the links both surfaces carry, addressed through the session address
  config.js       settings
  errors.js       error codes
  messaging.js    the surface-to-background contract
  popup.*         toolbar popup
  options.*       settings
```

The popup learns which site you are on from `activeTab`, which Chrome grants when you invoke the
extension. Nothing reads a tab's address at any other time.

## Test

`npm test` runs against the pure modules and the manifest. No browser, no network.

`tools/platform-probe.mjs` loads the extension into a real Chromium and prints the platform limits
the code assumes. It needs Playwright, which the test suite does not.

## License

MIT. See [LICENSE](LICENSE).
