# Changelog

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions follow
[semantic versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.3]

### Added

- A way to our site from the popup's top row, beside settings.
- The version, on the settings page, so there is something to quote when reporting a problem.

### Changed

- The popup keeps its heading, the address it draws, the action and the footer in place; only the
  explanation between them scrolls. A long locale used to push the button and the footer out of
  reach.
- The drawing is the browser's address bar and nothing else. What it reads is what changed: the
  site's address while the tab goes there itself, ours once it does not.
- "What changes in this tab" stays on every screen instead of appearing once. It is the only place
  the trade is spelled out, and after the first run it used to disappear for good.
- The popup stays open through a route and reports what happened, rather than closing on the click.

### Removed

- The address box in the popup. The site takes an address, and a second one here was a second place
  to keep working.
- The connection check and the backup-address list on the settings page.
- `optional_host_permissions`. It existed for the backup-address list, and with that gone nothing
  could ask for a host any more, so the manifest stopped advertising a reach the code cannot use.

### Fixed

- Routing a second tab no longer strips the first one's fence while it is still showing a proxied
  page.
- A routed tab whose address cannot be read is no longer reported as one that went somewhere else.
  Not being able to look is not evidence.

## [1.0.0]

First release.

### Added

- Route one tab through the proxy from the toolbar popup, and take it back out.
- Right-click entry on a page or a link.
- An address bar in the popup for pages that have nothing to route, so a browser page or a blank
  tab is a place to start from rather than a dead end.
- The popup shows the trip with its stops named, rather than describing it in a sentence: "This tab"
  to the site when nothing is in the way, and "This tab" to "TrickyBird" to the site when it is
  routed. The wording is still underneath, so nothing is carried by the picture alone.
- A mark on the toolbar icon while a route is in flight, and after one fails. Routing from the
  right-click menu opens no popup, so without it a failure there was silent.
- A list of session addresses instead of one. They are tried in order, and the one that answered is
  tried first next time.
- Connection check on the options page: how many of our addresses answer from where you are.
- Optional offer to reopen a page that failed to load. Off by default, and it never opens anything
  on its own. It reacts to a closed list of network errors and ignores the ones routing cannot fix,
  including a block set on the device.
- Stable error codes on every user-visible failure, with a one-click copy for reports.

### Permissions

No site is ever asked for. Routing a tab uses only `allow` and `block` rules, and Chrome requires
host access for `redirect` and `modifyHeaders` alone, so the fence around a routed tab works with
nothing granted. The tab reaches the proxy by ordinary navigation.

- `https://trickybird.com/*` in the manifest, because that is where sessions come from.
- `activeTab`, so the popup knows which site you are on when you open it.
- `contextMenus` for the right-click entry. It carries no permission warning.
- `webNavigation` stays optional and is requested only when the offer to help is switched on.
- Optional host access is kept for one thing: adding another session address in settings.

The redirect rule that used to rescue a link the proxy had missed is gone, and with it the dialog
that asked for access to every site. Measured before removing it: across 14 sites loaded and 6 of
them clicked through, it fired 3 times, every one of them the same donation banner on one site.

`TB-102` is retired. It meant access to a site was refused, which can no longer happen.
