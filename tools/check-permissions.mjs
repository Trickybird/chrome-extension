/**
 * Fails when the manifest's permission set changes without the baseline changing with it.
 *
 * A permission added quietly is how a well-behaved extension becomes a badly-behaved one between
 * two releases, and it is invisible in a diff that touches a hundred lines. Update
 * permissions.baseline.json in the same commit, and say why in the changelog.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
/** @param {string} p */
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));

const manifest = read('manifest.json');
const current = {
  permissions: [...(manifest.permissions ?? [])].sort(),
  optional_permissions: [...(manifest.optional_permissions ?? [])].sort(),
  host_permissions: [...(manifest.host_permissions ?? [])].sort(),
  optional_host_permissions: [...(manifest.optional_host_permissions ?? [])].sort(),
  // Not a permission, so it raises no install warning, but it decides which origins may move the
  // rule table. A quiet widening here is exactly what the other four fields are watched for.
  externally_connectable: [...(manifest.externally_connectable?.matches ?? [])].sort(),
};

if (process.argv.includes('--write')) {
  writeFileSync(join(ROOT, 'permissions.baseline.json'), `${JSON.stringify(current, null, 2)}\n`);
  console.log('baseline updated');
  process.exit(0);
}

const baseline = read('permissions.baseline.json');
const fields = /** @type {(keyof typeof current)[]} */ (Object.keys(current));
const diffs = fields.flatMap((field) => {
  const was = new Set(baseline[field] ?? []);
  const now = new Set(current[field]);
  return [
    ...[...now].filter((p) => !was.has(p)).map((p) => `+ ${field}: ${p}`),
    ...[...was].filter((p) => !now.has(p)).map((p) => `- ${field}: ${p}`),
  ];
});

if (diffs.length === 0) {
  console.log('permissions unchanged');
  process.exit(0);
}
console.error('permission set changed:\n' + diffs.map((d) => `  ${d}`).join('\n'));
console.error('\nIf this is intended, run: node tools/check-permissions.mjs --write');
process.exit(1);
