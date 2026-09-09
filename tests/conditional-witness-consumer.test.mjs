import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const exec = promisify(execFile);
const root = resolve(import.meta.dirname, '..');
const clients = join(root, '.deps/zed-clients');
const validator = join(clients, '.deps/typespec-json-schema-validator');
const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));

test('external Zed consumer retains deep conditional witness paths under current TJSV', async () => {
  const pins = await readJson(join(root, 'fixtures/contract-ir-pins.json'));
  assert.equal((await exec('git', ['-C', clients, 'rev-parse', 'HEAD'])).stdout.trim(), pins.clients);
  assert.equal((await exec('git', ['-C', validator, 'rev-parse', 'HEAD'])).stdout.trim(), pins.validator);
  const { VALIDATOR_REVISION } = await import('../.deps/zed-clients/contract-admission/contract-ir-admission.mjs');
  assert.equal(VALIDATOR_REVISION, pins.validator);

  const [{ SchemaResolver, validateInstance }, { buildProbes, synthesizeInstance }] = await Promise.all([
    import('../.deps/zed-clients/.deps/typespec-json-schema-validator/src/instance-validator.mjs'),
    import('../.deps/zed-clients/.deps/typespec-json-schema-validator/src/witness.mjs'),
  ]);

  const schema = {
    allOf: [
      {
        if: { properties: { phase: { const: 'publish' } }, required: ['phase'] },
        then: {
          properties: {
            actions: {
              contains: {
                type: 'object',
                properties: { mode: { const: 'push' } },
                required: ['mode'],
              },
            },
          },
        },
      },
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          phase: { type: 'string', enum: ['publish', 'verify'] },
          actions: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: { mode: { type: 'string', enum: ['push', 'dry-run'] } },
              required: ['mode'],
            },
          },
        },
        required: ['phase', 'actions'],
      },
    ],
  };

  const resolver = new SchemaResolver();
  const record = resolver.addDocument(schema, 'zed-external-conditional.json');
  const synthesized = synthesizeInstance({ schema, base: record.base, resolver });
  assert.deepEqual(synthesized.instance, { phase: 'publish', actions: [{ mode: 'push' }] });
  const result = validateInstance({ schema, instance: synthesized.instance, resolver, base: record.base });
  assert.equal(result.valid, true, JSON.stringify(result.errors));

  const probes = buildProbes({
    schema,
    base: record.base,
    resolver,
    lane: 'authored',
    declaration: 'Zed.External.PackagePublishPlan',
    maxProbes: 64,
  });
  assert.ok(probes.some((probe) => probe.origin === 'domain-member' && probe.pointer === '/actions/0/mode'));
  assert.ok(probes.every((probe) => probe.instance !== undefined));
});
