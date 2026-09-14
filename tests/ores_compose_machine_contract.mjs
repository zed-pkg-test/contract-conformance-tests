import assert from 'node:assert/strict';
import test from 'node:test';

const SHA = '5dbda2127357b4be87821902d36e4ce9560f6876';
const BASE = `https://raw.githubusercontent.com/ORESoftware/ores-interfaces/${SHA}/contracts/ores-compose-machine/v1`;
async function read(path) {
  const response = await fetch(`${BASE}/${path}`);
  assert.equal(response.status, 200, path);
  return response.text();
}
const [schemaText, tsp, configText] = await Promise.all([
  read('authored.schema.json'),
  read('main.tsp'),
  read('contracts.config.json'),
]);
const defs = JSON.parse(schemaText).$defs;
const config = JSON.parse(configText);

const MODELS = ['EnsureRequest','EnqueueResponse','MachineIngress','ActiveSystem','JobStatusResponse','ReadinessResponse','MachineErrorResponse'];

test('contract config wires independent TypeSpec and authored JSON Schema peers', () => {
  assert.equal(config.typespec, 'main.tsp');
  assert.equal(config.jsonSchema, 'authored.schema.json');
  assert.notEqual(config.typespec, config.jsonSchema);
});

test('all top-level machine declarations exist in both authorities', () => {
  for (const model of MODELS) {
    assert.ok(defs[model], `schema missing ${model}`);
    assert.match(tsp, new RegExp(`model\\s+${model}\\b`), `TypeSpec missing ${model}`);
  }
});

test('job-state enum parity is exact across peer authorities', () => {
  const schemaStates = defs.JobStatusResponse.properties.state.anyOf.map((x) => x.const);
  assert.deepEqual(schemaStates, ['queued','running','ready','failed']);
  for (const state of schemaStates) assert.match(tsp, new RegExp(`"${state}"`));
});

test('machine-error enum parity includes admission queue fence and ingress failures', () => {
  const codes = defs.MachineErrorResponse.properties.code.anyOf.map((x) => x.const);
  for (const code of ['invalid_request','unknown_project','unknown_service','lazy_start_denied','queue_full','machine_busy','stale_generation','activation_failed','ingress_unavailable']) {
    assert.ok(codes.includes(code), code);
    assert.match(tsp, new RegExp(`"${code}"`), code);
  }
});

test('optional fields and ingress authority remain fail-closed in both peers', () => {
  assert.equal(defs.ActiveSystem.required.includes('ingress'), false);
  assert.equal(defs.JobStatusResponse.required.includes('active'), false);
  assert.equal(defs.ReadinessResponse.required.includes('active'), false);
  const p = new RegExp(defs.MachineIngress.properties.authority.pattern);
  assert.ok(p.test('127.0.0.1:39001'));
  assert.equal(p.test('10.1.2.3:8080'), false);
  assert.match(tsp, /ingress\?:\s*MachineIngress/);
  assert.match(tsp, /active\?:\s*ActiveSystem/);
});
