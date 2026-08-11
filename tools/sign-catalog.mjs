/**
 * Makes the signed record that carries our addresses.
 *
 *   node tools/sign-catalog.mjs --keygen
 *   node tools/sign-catalog.mjs --key <path> --version 2 --hosts a.example,b.example
 *
 * The private key never belongs in this repository. Keep it wherever the other production secrets
 * live; anyone holding it can point every installed extension at an address of their choosing.
 *
 * The extension only ever moves forward, so a version must be higher than the one already published
 * or nobody will take it, and it must not go below `CATALOG.minVersion` in src/config.js, which is
 * the floor a fresh install starts from.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';

const { subtle } = webcrypto;
const SIGNING_CONTEXT = 'tb-fronts-v1|';
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
