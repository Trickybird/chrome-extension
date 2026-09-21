# Security

## Reporting

Email security@trickybird.com. Please do not open a public issue for a vulnerability.

Include what you did, what happened, and the extension version from `chrome://extensions`. You will
get an acknowledgement within 3 working days.

## Scope

In scope: anything in this repository, including the rule table, the permission model, and the
handling of the session response.

Out of scope: the proxy servers themselves, and reports produced by a scanner without a working
proof.

## What this extension can do

`declarativeNetRequest`, `storage` and `activeTab` at install; nothing else without a grant the
user makes by name. It runs no content scripts, loads no remote code, and its pages are restricted
to `script-src 'self'`.

No site access is ever requested. The one host in the manifest is where sessions come from, and
it can be withdrawn from `chrome://extensions`.

## Releases

A release here carries notes and no archive: stamping one needs the catalogue addresses, which this
repository deliberately does not hold. The archive comes from the store, and `npm run package` pins
timestamps, entry order and the timezone, so a build of the matching tag reproduces it byte for byte.
A mismatch is worth a report. `README.md` has the steps, including the one file you have to fill in.
