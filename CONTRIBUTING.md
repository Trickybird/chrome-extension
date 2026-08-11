# Contributing

## Before you open a pull request

```
npm install
npm run check
```

`check` runs the type check, the tests and the permission guard. All three have to pass. CI runs the
same three and will not merge without them.

Security problems do not go here. See [SECURITY.md](SECURITY.md).

## What a pull request has to carry

Every one of these, or it will be sent back:

1. **One change.** A pull request that fixes a bug and renames three files is two pull requests.
2. **The reason, not the diff.** The description says what was wrong and why this fixes it. What
   changed is already visible.
3. **A test that can fail.** If you cannot name the break it catches, it is not a test. Watch it fail
   against the unfixed code before you fix anything.
4. **The command output.** Claiming it passes is not the same as showing it. Paste what you ran.
5. **No new dependency.** The shipped extension has none, and that is a feature. A pull request that
   adds one needs to argue why the alternative is worse.

## Permissions

The manifest's permission set is guarded by `permissions.baseline.json`.

A change that genuinely needs a new permission:

1. Change `manifest.json`.
2. Run `node tools/check-permissions.mjs --write`.
3. In the description, name the permission, what it is for, and why the feature cannot work without
   it.

A pull request that widens the set without that argument will not be merged. Widening the set is the
one change that costs every existing user a dialog, so it needs more than a paragraph of good
intentions.

## Code

- Plain ES modules. No bundler, no framework, no dependency in the shipped extension.
- Keep the pure modules pure. `rules.js`, `target.js`, `proxy-url.js` and `recovery.js` must not
  reach for a browser API; that is what makes them testable without one.
- One module owns each responsibility. `router.js` is the only place that touches rules or
  navigation, and surfaces talk to it through `messaging.js`.
- Comments explain why, briefly, or they are not worth the line. A comment restating the code is a
  defect.

## Tests

`node:test`, no framework. A test asserts behaviour a user could notice.

Derive the expected value by hand rather than from the code under test, and do not let a mock call
count stand in for the behaviour it is meant to prove.

## Strings

Every user-visible string lives in `_locales/en/messages.json` and is read through
`chrome.i18n.getMessage`. A string written straight into markup will fail review.

## Review

One maintainer approval, and CI green. Maintainers merge; nobody pushes to `main`.

If a review finding is unclear, ask about that part before implementing any of it. Findings are
usually related, and answering half of one is worse than answering none.
