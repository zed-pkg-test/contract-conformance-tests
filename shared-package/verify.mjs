import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

assert.equal(process.argv.length, 2, 'task accepts no command-line options');
const exec = promisify(execFile);
const root = resolve(import.meta.dirname, '..');
const hub = join(root, 'tmp/shared-hub');
const source = join(hub, '.deps/compat');
const validator = join(hub, '.deps/tjsv');
const evidence = join(root, 'tmp/shared-package-evidence');
const pins = JSON.parse(await readFile(join(root, 'shared-package/source-pins.json'), 'utf8'));
const run = (command, args, cwd = root) => exec(command, args,
  { cwd, timeout: 180000, maxBuffer: 8 * 1024 * 1024 });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
await mkdir(evidence, { recursive: true });
for (const [path, pin] of [[hub, pins.hub.commit], [source, pins.source.commit], [validator, pins.validator.commit]]) {
  assert.match(pin, /^[a-f0-9]{40}$/);
  assert.equal((await run('git', ['--no-replace-objects', '-C', path, 'rev-parse', 'HEAD'])).stdout.trim(), pin);
}
const { verifyCheckout, auditBuiltPackage } = await import(pathToFileURL(join(hub, 'scripts/build.mjs')).href);
const policy = JSON.parse(await readFile(join(hub, 'shared-interfaces.json'), 'utf8'));
assert.equal(policy.source.commit, pins.source.commit);
assert.equal(policy.validator.commit, pins.validator.commit);
await verifyCheckout(hub, pins.hub.commit);
await verifyCheckout(source, pins.source.commit);
await verifyCheckout(validator, pins.validator.commit);
await run('npm', ['pack', '--pack-destination', evidence], hub); // prepack invokes real TJSV admission.
await auditBuiltPackage(hub);
const archives = (await readdir(evidence)).filter(name => name.endsWith('.tgz'));
assert.equal(archives.length, 1, 'exactly one fresh package required');
const archive = join(evidence, archives[0]);
const expectedFiles = ['LICENSE', 'README.md', 'THIRD_PARTY_NOTICES.md', 'package.json',
  'shared-interfaces.json', 'generated/public/LICENSE.upstream', 'generated/public/main.tsp',
  'generated/public/schema.json', 'generated/public/provenance.json'].sort();
assert.deepEqual((await run('tar', ['-tzf', archive])).stdout.trim().split('\n').sort(),
  expectedFiles.map(name => `package/${name}`).sort());
const consumer = join(evidence, 'consumer');
const installed = join(consumer, 'node_modules/@oresoftware/ores-interfaces');
await mkdir(installed, { recursive: true });
await run('tar', ['-xzf', archive, '--strip-components=1', '-C', installed]);
await run(process.execPath, ['--input-type=module', '-e', `
  import assert from 'node:assert/strict';
  import schema from '@oresoftware/ores-interfaces/schema' with { type: 'json' };
  import provenance from '@oresoftware/ores-interfaces/provenance' with { type: 'json' };
  assert.equal(provenance.admission.status, 'passed');
  assert.equal(provenance.editableAuthority, false);
  assert.equal(Object.hasOwn(schema.$defs, 'TrustedActor'), false);
  assert.ok(import.meta.resolve('@oresoftware/ores-interfaces/typespec').endsWith('/main.tsp'));
`], consumer);

// Re-admit the *packed* independent source bytes with upstream TJSV, not a
// replacement validator or the package's self-declared provenance fields alone.
const packedRoot = join(evidence, 'packed-source');
await mkdir(join(packedRoot, 'validation/typespec'), { recursive: true });
await mkdir(join(packedRoot, 'validation/tjsv'), { recursive: true });
await cp(join(installed, 'generated/public/main.tsp'), join(packedRoot, 'validation/typespec/validation.tsp'));
await cp(join(installed, 'generated/public/schema.json'), join(packedRoot, 'validation/public-contracts.v1.json'));
await cp(join(source, 'validation/tjsv/public-corpus.json'), join(packedRoot, 'validation/tjsv/public-corpus.json'));
const { withPublicAdmission } = await import(pathToFileURL(join(source, 'validation/tjsv/admission.mjs')).href);
const admission = await withPublicAdmission({ sourceRoot: packedRoot, validatorRoot: validator });
assert.equal(admission.status, 'passed');
assert.equal(admission.recordedCases, 31);
assert.deepEqual(admission.declarations, ['Ores.Validation.PageQuery', 'Ores.Validation.ProblemDetails',
  'Ores.Validation.PublicValidationContract', 'Ores.Validation.RequestMeta']);
for (const [path, pin] of [[hub, pins.hub.commit], [source, pins.source.commit], [validator, pins.validator.commit]])
  await verifyCheckout(path, pin);
const receipt = { schema: 'ores.external-shared-package-check/v1', pins, node: process.version,
  packageSha256: hash(await readFile(archive)), admission, files: expectedFiles,
  scope: 'TJSV-approved source packaging and consumption; not registry publication or universal runtime conformance' };
await writeFile(join(evidence, 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify({ status: 'passed', declarations: admission.declarations.length,
  recordedCases: admission.recordedCases, packageSha256: receipt.packageSha256 }));
