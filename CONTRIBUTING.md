# Contributing

## Before a pull request

```
npm install
npm run check
```

`check` runs the type check, the tests and the permission guard. All three have to pass.

## Changing permissions

The manifest's permission set is guarded. If a change genuinely needs a new permission:

1. Change `manifest.json`.
2. Run `node tools/check-permissions.mjs --write`.
3. Say in the pull request what the permission is for and why the feature cannot work without it.

A pull request that widens the permission set without that explanation will not be merged.

## Code

- Plain ES modules. No bundler, no framework, no dependency in the shipped extension.
- Keep the pure modules pure: `rules.js`, `target.js`, `proxy-url.js` and `recovery.js` must not
  reach for a browser API. That is what makes them testable without one.
- One module owns each responsibility. `router.js` is the only place that touches rules or
  navigation; surfaces talk to it through `messaging.js`.
- Comments explain why, briefly, or they are not worth the line.

## Tests

`node:test`, no framework. A test asserts behaviour a user could notice, and it has to be able to
fail. If you cannot name the break it catches, it is not worth adding.

## UI strings

Every user-visible string lives in `_locales/en/messages.json` and is read through
`chrome.i18n.getMessage`. A string added straight into markup will fail review.
