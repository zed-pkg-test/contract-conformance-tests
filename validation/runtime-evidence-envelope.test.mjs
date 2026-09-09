import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SchemaResolver, validateInstance } from '../tmp/tjsv/src/instance-validator.mjs';
import { validateRuntimeEvidence } from '../tmp/tjsv/src/runtime-conformance/normalize.mjs';
import { RUNTIME_EVIDENCE_SCHEMA } from '../tmp/tjsv/src/runtime-conformance/constants.mjs';

// Consumer-owned wire fixtures, not attestations that native adapters executed.
const schema = JSON.parse(readFileSync(new URL('../tmp/tjsv/schema/runtime-evidence.schema.json', import.meta.url), 'utf8'));
const resolver = new SchemaResolver();
const record = resolver.addDocument(schema, 'runtime-evidence.schema.json');

function fixture() {
  return {
    schema: RUNTIME_EVIDENCE_SCHEMA,
    contractIrId: 'a'.repeat(64), inputDigest: 'b'.repeat(64), corpusDigest: 'c'.repeat(64),
    adapters: [{
      id: 'rust-serde', language: 'rust', runtime: 'rust', validator: 'serde',
      toolchain: 'rustc', status: 'passed',
      results: [{ caseId: 'wire.valid', declaration: 'External.Wire', verdict: 'accepted' }],
    }],
  };
}

function check(value, expected) {
  // Exercise a genuine JSON serialization boundary, not JS-only coercion cases.
  const wire = JSON.parse(JSON.stringify(value));
  const before = structuredClone(wire);
  const schemaResult = validateInstance({ schema, instance: wire, resolver, base: record.base });
  assert.equal(schemaResult.valid, expected, 'published JSON Schema must match the independent expectation');
  const runtimeResult = validateRuntimeEvidence(wire);
  assert.equal(runtimeResult.findings.length === 0, expected, 'runtime admission must agree with the wire contract');
  assert.deepEqual(wire, before, 'admission must not mutate input');
  return runtimeResult;
}

test('an exact wire envelope passes both contract and runtime validation', () => {
  check(fixture(), true);
});

for (const field of ['contractIrId', 'inputDigest', 'corpusDigest']) {
  for (const [name, mutate] of [
    ['array', value => [value]],
    ['nested-array', value => [[value]]],
    ['object', value => ({ digest: value })],
    ['number', () => 42],
    ['null', () => null],
  ]) {
    test(`${field}: ${name} cannot cross a string-only digest boundary`, () => {
      const value = fixture();
      value[field] = mutate(value[field]);
      check(value, false);
    });
  }
}

for (const [name, select, fields] of [
  ['evidence', value => value, ['schema', 'contractIrId', 'inputDigest', 'corpusDigest', 'adapters']],
  ['adapter', value => value.adapters[0], ['id', 'language', 'runtime', 'validator', 'toolchain', 'status', 'results']],
  ['result', value => value.adapters[0].results[0], ['caseId', 'declaration', 'verdict']],
]) {
  for (const field of fields) {
    test(`${name}: missing ${field} is rejected in both validation paths`, () => {
      const value = fixture();
      delete select(value)[field];
      check(value, false);
    });
  }
  for (const field of ['stdout', '__proto__']) {
    test(`${name}: undeclared ${field} is rejected without retaining its payload`, () => {
      const value = fixture();
      Object.defineProperty(select(value), field, {
        enumerable: true, value: 'untrusted-wire-payload-do-not-retain',
      });
      const result = check(value, false);
      assert.ok(result.findings.some(finding => finding.ruleId === `runtime-${name}-fields-invalid`));
      assert.ok(!JSON.stringify(result).includes('untrusted-wire-payload-do-not-retain'));
    });
  }
}
