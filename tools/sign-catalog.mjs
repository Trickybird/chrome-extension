/**
 * Makes the signed record that carries our addresses.
 *
 *   node tools/sign-catalog.mjs --keygen
 *   node tools/sign-catalog.mjs --key <path> --version 2 --hosts a.example,b.example
 *   node tools/sign-catalog.mjs --key <path> --revoke
 *   node tools/sign-catalog.mjs --verify "<record>" [--key <path>]
 *
 * The private key never belongs in git. It lives with the other production secrets, at
 * `IaC/secrets/signing/front-catalog/catalog-key.json`, which the `secrets/**` rule in
 * `IaC/.gitignore` keeps out of every commit; the README beside it says what it costs to lose.
 * Anyone holding it can point every installed extension at an address of their choosing.
 *
 * The extension only ever moves forward, so a version must be higher than the one already published
 * or nobody will take it, and it must not go below `CATALOG.minVersion` in src/config.js, which is
 * the floor a fresh install starts from.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { parseCatalog, parseRevocation, verifyCatalog, verifyRevocation } from '../src/catalog.js';
import { CATALOG } from '../src/config.js';

const { subtle } = webcrypto;
const SIGNING_CONTEXT = 'tb-fronts-v1|';
const REVOKE_CONTEXT = 'tb-fronts-revoke-v1|';
const CURVE = { name: 'ECDSA', namedCurve: 'P-256' };

const b64url = (/** @type {ArrayBuffer} */ buf) =>
  Buffer.from(buf).toString('base64url');

/** @param {string[]} argv @param {string} flag */
const arg = (argv, flag) => {
  const i = argv.indexOf(flag);
  return i === -1 ? undefined : argv[i + 1];
};

const argv = process.argv.slice(2);

if (argv.includes('--keygen')) {
  const pair = await subtle.generateKey(CURVE, true, ['sign', 'verify']);
  const priv = await subtle.exportKey('pkcs8', pair.privateKey);
  const pub = await subtle.exportKey('raw', pair.publicKey);
  // Named so the ignore rule catches it, and said out loud below: a signing key that reaches this
  // repository reaches everybody who ever clones it.
  const out = arg(argv, '--out') ?? 'catalog-key.json';
  writeFileSync(out, `${JSON.stringify({ privateKey: b64url(priv) }, null, 2)}\n`, { mode: 0o600 });
  console.log(`private key -> ${out}   (keep it out of this repository)`);
  console.log(`public key  -> ${b64url(pub)}`);
  console.log('\nPut the public key in CATALOG.publicKey, src/config.js.');
  process.exit(0);
}

const keyPath = arg(argv, '--key');

/** The raw public point of a private key, which is the form `verifyCatalog` takes. */
async function publicHalf(/** @type {string} */ path) {
  const { privateKey } = JSON.parse(readFileSync(path, 'utf8'));
  const priv = await subtle.importKey('pkcs8', Buffer.from(privateKey, 'base64url'), CURVE, true, ['sign']);
  const { x, y } = await subtle.exportKey('jwk', priv);
  const pub = await subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x, y }, CURVE, true, ['verify']);
  return b64url(await subtle.exportKey('raw', pub));
}

if (argv.includes('--verify')) {
  const text = arg(argv, '--verify');
  if (!text || text.startsWith('--')) {
    console.error('usage: --verify "<record>" [--key <path>]');
    process.exit(1);
  }
  // Without --key this answers the only question that matters before publishing: would the copies
  // already in the field take it. With one it answers the rotation question instead, where the key
  // that will judge the record is not the key the store build carries yet.
  const publicKey = keyPath ? await publicHalf(keyPath) : CATALOG.publicKey;
  const source = keyPath ? `private key at ${keyPath}` : 'CATALOG.publicKey in src/config.js';

  // A revocation is checked here too, because the string a client will judge is the string that has
  // to be checked, and the one thing worse than having no revocation is holding one that is invalid.
  const revocation = parseRevocation(text, publicKey);
  if (revocation) {
    if (!(await verifyRevocation(revocation, publicKey))) {
      console.error(`revocation does not verify against the ${source}`);
      process.exit(1);
    }
    console.log(`ok: revocation, verified against the ${source}`);
    console.log('Publishing this takes the key out of trust for every client that reads it, for good.');
    process.exit(0);
  }

  const catalog = parseCatalog(text);
  if (!catalog) {
    console.error('could not parse the record: expected `tb1 <version> <hosts> <signature>` or `tbrev1 <signature>`');
    process.exit(1);
  }
  if (!(await verifyCatalog(catalog, publicKey))) {
    console.error(`signature does not verify against the ${source}`);
    process.exit(1);
  }
  console.log(`ok: version ${catalog.version}, ${catalog.hosts.length} host(s) — ${catalog.hosts.join(', ')}`);
  console.log(`verified against the ${source}`);
  if (catalog.version < CATALOG.minVersion) {
    console.log(`note: version ${catalog.version} is below CATALOG.minVersion ${CATALOG.minVersion}; a fresh install will refuse it`);
  }
  process.exit(0);
}

// Signed ahead of time, and kept beside the key. The one scenario where a reserve key would have
// earned its place is losing the private half before ever needing to revoke, and a pre-signed
// string closes it: the leak of this string is nearly harmless, because publishing it needs our DNS
// zone and its effect is to send every client back to the address in its own build.
if (argv.includes('--revoke')) {
  if (!keyPath) {
    console.error('usage: --key <path> --revoke');
    process.exit(1);
  }
  const pub = await publicHalf(keyPath);
  if (pub !== CATALOG.publicKey) {
    console.error('refusing: this key is not the one pinned in CATALOG.publicKey, so a revocation');
    console.error('signed with it would be inert in every published build.');
    process.exit(1);
  }
  const { privateKey: raw } = JSON.parse(readFileSync(keyPath, 'utf8'));
  const priv = await subtle.importKey('pkcs8', Buffer.from(raw, 'base64url'), CURVE, false, ['sign']);
  const bytes = new TextEncoder().encode(`${REVOKE_CONTEXT}${pub}`);
  const record = `tbrev1 ${b64url(await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, priv, bytes))}`;
  console.log('\nTXT record value, on the same name as the catalog:\n');
  console.log(record);
  console.log(`\n${record.length} bytes. Keep it beside the key and publish it only to burn that key.`);
  console.log('It is terminal: no later record lifts it, and a client comes back only through a');
  console.log('build that pins a different key.');
  process.exit(0);
}

const version = Number(arg(argv, '--version'));
const hosts = (arg(argv, '--hosts') ?? '').split(',').map((h) => h.trim()).filter(Boolean);

if (!keyPath || !Number.isSafeInteger(version) || version < 1 || hosts.length === 0) {
  console.error('usage: --key <path> --version <n> --hosts <a.example,b.example>');
  console.error('       --keygen [--out <path>]');
  process.exit(1);
}

const { privateKey } = JSON.parse(readFileSync(keyPath, 'utf8'));
const key = await subtle.importKey('pkcs8', Buffer.from(privateKey, 'base64url'), CURVE, false, ['sign']);
const signed = new TextEncoder().encode(`${SIGNING_CONTEXT}${version}|${hosts.join(',')}`);
const signature = await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, signed);

const record = `tb1 ${version} ${hosts.join(',')} ${b64url(signature)}`;
console.log('\nTXT record value:\n');
console.log(record);
console.log(`\n${record.length} bytes. DNS splits at 255; every provider does that for you.`);
