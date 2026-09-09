import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';

const tool = resolve('tmp/tjsv/bin/typespec-json-schema-validator.mjs');
const evidence = resolve('tmp/evidence');
mkdirSync(evidence, { recursive: true });
const digest = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const readJson = path => JSON.parse(readFileSync(path, 'utf8'));
function run(label, typespec, schema, instances, output, expectedExit) {
  mkdirSync(output, { recursive: true });
  const reportPath = join(output, 'report.json');
  const irPath = join(output, 'contract-ir.json');
  const args = [tool, 'check', `--typespec=${typespec}`, `--schema=${schema}`, `--instances=${instances}`,
    `--report=${reportPath}`, `--contract-ir=${irPath}`, `--output-dir=${join(output, 'generated')}`,
    '--max-probes=64', '--int64-strategy=string', '--seal-object-schemas=true', '--polymorphic-models-strategy=oneOf'];
  const result = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 90000, maxBuffer: 8 * 1024 * 1024 });
  writeFileSync(join(evidence, `${label}.log`), `${result.stdout ?? ''}\n${result.stderr ?? ''}`);
  assert.ifError(result.error);
  assert.equal(result.signal, null, label);
  assert.equal(result.status, expectedExit, `${label}: ${result.stdout}\n${result.stderr}`);
  const report = readJson(reportPath);
  const ir = readJson(irPath);
  writeFileSync(join(evidence, `${label}.report.json`), JSON.stringify(report, null, 2));
  writeFileSync(join(evidence, `${label}.contract-ir.json`), JSON.stringify(ir, null, 2));
  return { report, ir };
}
function stopped(result, status) {
  assert.equal(result.report.status, status);
  assert.equal(result.ir.status, status);
  assert.equal(result.ir.admissible, false);
  assert.deepEqual(result.ir.declarations, []);
}

test('tool and shared-interface source identities are immutable', () => {
  for (const [dir, sha] of [
    ['tmp/tjsv', '4473504c4c9d2831d825919f70c03994d8ce01d2'],
    ['tmp/interfaces', '7e76519750e53042ff3b5862d21b69a59bcf3d83'],
  ]) assert.equal(execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), sha);
});

test('actual shared contracts remain blocked, deterministic and source-preserving', () => {
  const source = resolve('tmp/interfaces');
  const tsp = join(source, 'contracts/shared-public/validation.tsp');
  const schema = join(source, 'contracts/shared-public/schema.json');
  const before = [digest(tsp), digest(schema)];
  const output = resolve('tmp/legacy-output');
  // An old positive-looking file must never survive a failed admission.
  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, 'contract-ir.json'), '{"admissible":true,"sentinel":"stale"}\n');
  const first = run('legacy-first', tsp, schema, join(source, 'corpus'), output, 2);
  stopped(first, 'stopped_for_evaluation');
  assert.equal(first.report.zeroUnexplainedFindings, false);
  assert.equal(first.report.findings.length, 8);
  for (const rule of ['authored-declaration-missing', 'generated-declaration-missing', 'generated-authored-semantic-mismatch']) {
    assert(first.report.findings.some(finding => finding.ruleId === rule), rule);
  }
  assert(!readFileSync(join(output, 'contract-ir.json'), 'utf8').includes('sentinel'));
  const second = run('legacy-repeat', tsp, schema, join(source, 'corpus'), output, 2);
  stopped(second, 'stopped_for_evaluation');
  assert.equal(second.report.runId, first.report.runId);
  assert.deepEqual([digest(tsp), digest(schema)], before);
});

test('real positive admission is invalidated on semantic drift and compiler failure, then recovers', () => {
  const source = resolve('tmp/independent-probe');
  const instances = join(source, 'instances');
  mkdirSync(join(instances, 'Probe/valid'), { recursive: true });
  mkdirSync(join(instances, 'Probe/invalid'), { recursive: true });
  const tsp = join(source, 'main.tsp');
  const schema = join(source, 'authored.schema.json');
  // Independently written test authorities; neither is derived from emitter output.
  const tspText = 'namespace ExternalValidation;\nmodel Probe { value: boolean; }\n';
  const authored = { $schema: 'https://json-schema.org/draft/2020-12/schema', $defs: {
    Probe: { type: 'object', properties: { value: { type: 'boolean' } }, required: ['value'], unevaluatedProperties: false },
  } };
  const schemaText = JSON.stringify(authored, null, 2) + '\n';
  writeFileSync(tsp, tspText);
  writeFileSync(schema, schemaText);
  writeFileSync(join(instances, 'Probe/valid/value.json'), '{"value":true}\n');
  writeFileSync(join(instances, 'Probe/invalid/type.json'), '{"value":"true"}\n');
  writeFileSync(join(instances, 'Probe/invalid/missing.json'), '{}\n');
  const output = resolve('tmp/probe-output');
  const accepted = run('probe-positive', tsp, schema, instances, output, 0);
  assert.equal(accepted.report.status, 'passed');
  assert.equal(accepted.ir.admissible, true);
  assert(accepted.ir.declarations.length > 0);
  assert.deepEqual([readFileSync(tsp, 'utf8'), readFileSync(schema, 'utf8')], [tspText, schemaText]);

  const drift = structuredClone(authored);
  drift.$defs.Probe.properties.value.type = 'string';
  writeFileSync(schema, JSON.stringify(drift, null, 2) + '\n');
  const rejected = run('probe-drift', tsp, schema, instances, output, 2);
  stopped(rejected, 'stopped_for_evaluation');
  assert(rejected.report.findings.some(finding => finding.ruleId === 'generated-authored-semantic-mismatch'));
  assert.notEqual(rejected.report.runId, accepted.report.runId);

  writeFileSync(schema, schemaText);
  const recovered = run('probe-recovery', tsp, schema, instances, output, 0);
  assert.equal(recovered.ir.admissible, true);
  assert.equal(recovered.report.runId, accepted.report.runId);

  writeFileSync(tsp, 'model Probe { this is deliberately invalid TypeSpec\n');
  const failed = run('probe-compiler-failure', tsp, schema, instances, output, 3);
  stopped(failed, 'failed');
  writeFileSync(tsp, tspText);
  const final = run('probe-final-recovery', tsp, schema, instances, output, 0);
  assert.equal(final.ir.admissible, true);
  assert.equal(final.report.runId, accepted.report.runId);
});
