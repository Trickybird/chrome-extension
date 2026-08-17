# Changelog

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions follow
[semantic versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.2.2]

### Fixed

- A launch whose site answered once and then went quiet was watched by nothing. The watchdog was
  disarmed the moment the site asked for the address, so a connection lost after that left the
  toolbar mark spinning and the launch aged out in silence. It is re-armed instead, and a launch that
  goes quiet after being answered says so rather than walking to another address, which would not
  answer any better.
- An expired launch lost the address it was holding whenever anything else happened: opening a
  second launch, cancelling one, or closing another tab pruned it on the way past. That address is
  the only copy left by then, and it is what turns the expiry into a retry instead of a blank panel.
- A tab closed between pressing route and the page moving left a live record bound to a dead tab id,
  and Chrome hands that id to somebody else.
- Two tabs routed in the same moment could lose one's site name or resurrect the other's, because
  the labels were written without the queue every other record here goes through.
- A page loading in a tab with nothing pending put out the toolbar mark, including the one a launch
  had just lit to say it was waiting on a press.
- An offer raised on a tab that is already going through TrickyBird lit the toolbar mark, and the
  panel for that tab never mentions it, so the mark stayed lit with nothing behind it.
- A tab that came through TrickyBird with nothing holding it there was described as though it were
  held: the panel promised that closing the tab would stop it, when there was nothing to stop.
- Chrome retires a tab id without `onRemoved` when a tab is replaced, and nothing was listening, so
  the rules and the name stayed behind on an id that would be given away.

### Changed

- The public README stops saying the store listing is in preparation, and stops promising that a
  rebuild matches byte for byte anywhere: the release archive is built on Linux, and `zip` differs
  enough between platforms that the same files packed on macOS come out to a different hash.

## [1.2.1]

### Changed

- The name goes back to "TrickyBird Web Proxy", which is what the store shows and what people who
  already installed it see. The rename never reached a published archive, so keeping it would have
  cost a release to make the tree agree with the listing rather than the other way round.

### Fixed

- A session running out left the tab with no way off the proxied page. The gateway answers an expired
  session by sending the tab back to our site, and the fence around that tab allowed the gateway and
  nothing else, so the browser blocked our own page and told the reader an extension had done it.
  Nobody had to press anything to get there. The fence now lets a whole-page navigation home through,
  and only that: a proxied page still cannot fetch, ping or beacon our site, which are the shapes
  that could carry a report about whoever is reading. The toolbar's home button and the way back from
  a branded error page were walled off by the same rule and open the same way.
- Starting a second launch from a tab that was already going through TrickyBird sent it to our own
  console while its fence was still up, and the fence lets nothing but the gateway through, so the
  browser blocked our page and told the reader an extension did it. Pressing the panel's retry on a
  routed tab hit this every time. Every way out of the proxy now takes the fence off first: the
  launch, the walk home when no address answers, and the cancel.
- An address typed into a routed tab left the person on Chrome's own blocked page, which names an
  extension as the culprit and suggests switching extensions off. The refusal itself stands, because
  a page we fetched must not reach the network directly, but the tab is now handed back to the
  console with that address already in the field, and it gives up its own fence on the way. Needs the
  optional navigation permission the recovery offer already asks for; without it, nothing changes.
- An address typed on the settings page led the list instead of replacing it. Replacing it left the
  extension with exactly one address, so a typo there took away the only console it could reach, and
  with it the move to another of our addresses that the same screen promises.

## [1.2.0]

### Fixed

- A launch that fails no longer ends on a panel with nothing on it. Whatever went wrong, the popup
  names it, keeps the address that was asked for, and offers to open it again.
- That address now survives the reload someone reaches for while stuck, as long as the tab is still
  standing on the page the launch stopped on.
- A launch nobody finished used to expire in silence and take the address with it. It comes back as
  an offer to try again, under its own code `TB-106`.
- A tab still carrying a launch the extension no longer holds says so, rather than describing the
  site already on the screen.

### Security

- The published archive names one console, the one this extension ships with. The manifest in the
  repository also names a local `.test` console so the extension can be run against a stack on your
  own machine; packaging strips that entry and refuses to build an archive still carrying it.
- A proxied page owns its own address bar, so what it puts there is parsed before anything reads it
  back as an address. A path that decodes to something that is not a web address no longer reaches
  the panel that draws it.
- Turning the failed-page offer off hands `webNavigation` back to the browser instead of holding a
  permission nothing is using.

### Changed

- Records in session storage are written one at a time. Two tabs raising an offer in the same
  moment used to keep only whichever one finished last.
- Settings asks for the permission on the click itself, with no lookup in between.

### Removed

- The builder for proxy addresses. The console builds those, and nothing here had called it since.

## [1.1.0]

### Changed

- The extension no longer opens a proxy session itself. It parks the address, sends the tab to our
  site, and the session is opened there by a press, the same way it is for anyone who arrives by
  typing an address. Whatever gates the site now gates the extension with it.
- The address to open is no longer only the one in this build. The rest arrive in a signed record
  the extension looks up over DNS, so retiring an address costs a signature rather than a release,
  and the list cannot be read out of this repository in one afternoon.

### Added

- A fence around a routed tab, built from `allow` and `block` and nothing else, which is the whole
  reason no access to any site is requested. One rule in it is scoped by who asked rather than by
  which tab: a service worker's request belongs to no tab, and without that rule a proxied page
  could reach the real site by registering one.
- A right-click entry, on a page and on a link.
- A tool that runs the whole launch in a real Chromium against three locally served hosts, because
  the channel, the fragment, the rule table and the navigation are all things a unit test cannot
  see.

### Removed

- The module that spoke to the session API, and everything with it. No request the extension makes
  needs access to anything now.

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
