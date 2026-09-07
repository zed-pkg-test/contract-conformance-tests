import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { checkPublicParity } from '../.deps/zed-lib-core/.deps/zed-interfaces/validation/compiler/public-parity.mjs';
import { SchemaResolver, validateInstance } from '../.deps/zed-lib-core/.deps/zed-interfaces/.deps/typespec-json-schema-validator/src/instance-validator.mjs';
import { safeParsePublic } from '../.deps/zed-lib-core/validation/typescript/dist/public.js';

const root = resolve(import.meta.dirname, '..');
const identities = {
  RequestMeta: { runtime: 'request-meta', base: { requestId: 'r', traceId: 't' } },
  PageQuery: { runtime: 'page-query', base: { limit: 50 } },
  ProblemDetails: { runtime: 'problem-details', base: { type: 'error', title: 'Error', status: 500, requestId: 'r' } },
};

function laneCheck(schema, name) {
  const resolver = new SchemaResolver();
  const record = resolver.addDocument(schema, `${name}.schema.json`);
  return (instance) => validateInstance({ schema, instance, resolver, base: record.base, formatAssertion: true }).valid;
}

test('independent boundary probes agree with both admitted lanes and the real TypeScript runtime', async (t) => {
  const pins = JSON.parse(await readFile(resolve(root, 'fixtures/production-validation-pins.json'), 'utf8'));
  const checkoutPaths = {
    libCore: '.deps/zed-lib-core',
    interfaces: '.deps/zed-lib-core/.deps/zed-interfaces',
    validator: '.deps/zed-lib-core/.deps/zed-interfaces/.deps/typespec-json-schema-validator',
  };
  for (const [name, path] of Object.entries(checkoutPaths)) {
    assert.match(pins[name], /^[a-f0-9]{40}$/u);
    assert.equal(execFileSync('git', ['-C', resolve(root, path), 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), pins[name]);
    execFileSync('git', ['-C', resolve(root, path), 'diff', '--exit-code', 'HEAD']);
  }
  const evidence = await checkPublicParity();
  assert.equal(evidence.contractIr.admission.scope.complete, true);
  assert.equal(evidence.cases.length, 34);
  let checked = 0;
  for (const [name, { runtime, base }] of Object.entries(identities)) {
    const declaration = evidence.contractIr.declarations.find((item) => item.id === `Zed.Validation.${name}`);
    assert.ok(declaration, `missing actual production declaration ${name}`);
    const checkAuthored = laneCheck(declaration.lanes.authoredJsonSchema.normalizedSchema, `authored-${name}`);
    const checkWitness = laneCheck(declaration.lanes.typespecGeneratedJsonSchema.normalizedSchema, `witness-${name}`);
    const probe = async (id, value, expected) => {
      checked += 1;
      await t.test(`${name}/${id}`, () => {
        assert.equal(checkAuthored(value), expected, 'authored schema disagrees with boundary expectation');
        assert.equal(checkWitness(value), expected, 'TypeSpec witness disagrees with boundary expectation');
        const result = safeParsePublic(runtime, value);
        assert.equal(result.success, expected, 'actual runtime disagrees with both peer authorities');
        if (expected) assert.deepEqual(result.data, value, 'runtime mutated accepted wire data');
      });
    };
    await probe('baseline', base, true);
    for (const unknown of ['serverOnly', '__proto__']) {
      await probe(`unknown-${unknown}`, { ...base, [unknown]: 'must-reject' }, false);
    }
    const schema = declaration.assertionSchema;
    assert.equal(schema.type, 'object');
    assert.equal(schema.additionalProperties, false);
    assert.ok(Array.isArray(schema.required));
    for (const [field, property] of Object.entries(schema.properties)) {
      const absent = { ...base }; delete absent[field];
      await probe(`${field}-absent`, absent, !schema.required.includes(field));
      await probe(`${field}-null`, { ...base, [field]: null }, false);
      await probe(`${field}-wrong-type`, { ...base, [field]: property.type === 'string' ? 17 : '17' }, false);
      if (property.type === 'string') {
        const minimum = property.minLength ?? 0;
        const maximum = property.maxLength;
        assert.ok(Number.isSafeInteger(minimum) && Number.isSafeInteger(maximum) && maximum <= 4096);
        const lengths = new Set([Math.max(0, minimum - 1), minimum, maximum, maximum + 1]);
        for (const [alphabet, character] of [['ascii', 'a'], ['astral', '😀']]) {
          for (const length of lengths) {
            await probe(`${field}-${alphabet}-${length}`, { ...base, [field]: character.repeat(length) }, length >= minimum && length <= maximum);
          }
        }
      } else if (property.type === 'integer') {
        const { minimum, maximum } = property;
        assert.ok(Number.isSafeInteger(minimum) && Number.isSafeInteger(maximum));
        for (const value of [minimum - 1, minimum, maximum, maximum + 1, minimum + 0.5]) {
          await probe(`${field}-${value}`, { ...base, [field]: value }, Number.isInteger(value) && value >= minimum && value <= maximum);
        }
      } else {
        assert.fail(`new field kind requires independent conformance coverage: ${name}.${field}`);
      }
    }
  }
  assert.equal(checked, 111, 'production inventory or boundary coverage changed; review the new scope');
});
