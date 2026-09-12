import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';

const TJSV_SHA = process.env.TJSV_SHA ?? '93dd73cb246a09b0a1c62d7192cc62ca6ecbe405';
const INTERFACES_SHA = process.env.INTERFACES_SHA ?? '7e76519750e53042ff3b5862d21b69a59bcf3d83';
const DRAFT_2020_12 = 'https://json-schema.org/draft/2020-12/schema';
const tool = resolve('tmp/tjsv/bin/typespec-json-schema-validator.mjs');
const evidence = resolve('tmp/evidence');
mkdirSync(evidence, { recursive: true });
const digest = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const readJson = path => JSON.parse(readFileSync(path, 'utf8'));

function assertSha256(value, label) {
  assert.match(value, /^[0-9a-f]{64}$/u, label);
}

function assertDualAuthorityReceipt(report, { differential = true } = {}) {
  assert.equal(report.authorities.typespec.authority, 'independently-authored');
  assert.equal(report.authorities.typespec.generatedJsonSchemaRole, 'comparison-evidence-only');
  assert.equal(report.authorities.jsonSchema.authority, 'independently-authored');
  assert.equal(report.authorities.jsonSchema.dialect, DRAFT_2020_12);
  assert.equal(report.authorities.precedence, 'none');
  assert.equal(report.authorities.onUnexplainedMismatch, 'STOPPED_FOR_EVALUATION');
  assert.equal(report.coverage.directDeclarationInventory, true);
  assert.equal(report.coverage.typespecGeneratedJsonSchemaComparison, true);
  assert.equal(report.coverage.differentialInstanceValidation, differential);
  assertSha256(report.inputs.typespec.digest, 'TypeSpec digest');
  assertSha256(report.inputs.authoredJsonSchema.digest, 'authored JSON Schema digest');
  assertSha256(report.inputs.generatedJsonSchema.digest, 'generated JSON Schema digest');
}

function run(label, typespec, schema, instances, output, expectedExit) {
  mkdirSync(output, { recursive: true });
  const reportPath = join(output, 'report.json');
  const irPath = join(output, 'contract-ir.json');
  const generatedPath = join(output, 'generated', 'typespec.generated.schema.json');
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
  if (expectedExit !== 3) {
    assert.equal(existsSync(generatedPath), true, `${label}: TypeSpec JSON Schema witness missing`);
    const generated = readJson(generatedPath);
    assert.equal(generated.$schema, DRAFT_2020_12);
    writeFileSync(join(evidence, `${label}.generated.schema.json`), JSON.stringify(generated, null, 2));
    assertDualAuthorityReceipt(report);
  }
  return { report, ir, generatedPath };
}

function runCompare(label, typespec, generatedSchema, authoredSchema, instances, expectedExit) {
  const reportPath = join(evidence, `${label}.compare.report.json`);
  const result = spawnSync(process.execPath, [
    tool,
    'compare',
    `--typespec=${typespec}`,
    `--generated-schema=${generatedSchema}`,
    `--schema=${authoredSchema}`,
    `--instances=${instances}`,
    `--report=${reportPath}`,
    '--max-probes=64',
  ], { encoding: 'utf8', timeout: 90000, maxBuffer: 8 * 1024 * 1024 });
  writeFileSync(join(evidence, `${label}.compare.log`), `${result.stdout ?? ''}\n${result.stderr ?? ''}`);
  assert.ifError(result.error);
  assert.equal(result.signal, null, label);
  assert.equal(result.status, expectedExit, `${label}: ${result.stdout}\n${result.stderr}`);
  const report = readJson(reportPath);
  assertDualAuthorityReceipt(report);
  return report;
}

function runMissingAuthority(typespec, missingSchema, output) {
  mkdirSync(output, { recursive: true });
  const reportPath = join(output, 'missing-authority.report.json');
  const result = spawnSync(process.execPath, [
    tool,
    'check',
    `--typespec=${typespec}`,
    `--schema=${missingSchema}`,
    `--report=${reportPath}`,
    `--output-dir=${join(output, 'generated')}`,
  ], { encoding: 'utf8', timeout: 90000, maxBuffer: 8 * 1024 * 1024 });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  assert.equal(result.status, 3, `${result.stdout}\n${result.stderr}`);
  const report = readJson(reportPath);
  assert.equal(report.status, 'failed');
  assert.equal(report.zeroUnexplainedFindings, false);
  writeFileSync(join(evidence, 'missing-authority.report.json'), JSON.stringify(report, null, 2));
}

function stopped(result, status) {
  assert.equal(result.report.status, status);
  assert.equal(result.ir.status, status);
  assert.equal(result.ir.admissible, false);
  assert.deepEqual(result.ir.declarations, []);
}

test('tool and shared-interface source identities are immutable', () => {
  for (const [dir, sha] of [
    ['tmp/tjsv', TJSV_SHA],
    ['tmp/interfaces', INTERFACES_SHA],
  ]) assert.equal(execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), sha);
});

test('actual shared contracts remain blocked, deterministic and source-preserving', () => {
  const source = resolve('tmp/interfaces');
  const tsp = join(source, 'contracts/shared-public/validation.tsp');
  const schema = join(source, 'contracts/shared-public/schema.json');
  const before = [digest(tsp), digest(schema)];
  const output = resolve('tmp/legacy-output');
  mkdirSync(output, { recursive: true });
  const first = run('legacy-first', tsp, schema, join(source, 'corpus'), output, 2);
  stopped(first, 'stopped_for_evaluation');
  assert.equal(first.report.zeroUnexplainedFindings, false);
  assert(first.report.findings.length > 0);
  for (const rule of ['authored-declaration-missing', 'generated-declaration-missing']) {
    assert(first.report.findings.some(finding => finding.ruleId === rule), rule);
  }
  const second = run('legacy-repeat', tsp, schema, join(source, 'corpus'), output, 2);
  stopped(second, 'stopped_for_evaluation');
  assert.equal(second.report.runId, first.report.runId);
  assert.deepEqual([digest(tsp), digest(schema)], before);
});

test('independent authorities generate a witness, compare explicitly, reject drift, and recover', () => {
  const source = resolve('tmp/independent-probe');
  const instances = join(source, 'instances');
  mkdirSync(join(instances, 'Probe/valid'), { recursive: true });
  mkdirSync(join(instances, 'Probe/invalid'), { recursive: true });
  const tsp = join(source, 'main.tsp');
  const schema = join(source, 'authored.schema.json');

  const tspText = 'namespace ExternalValidation;\nmodel Probe { value: boolean; }\n';
  const authored = { $schema: DRAFT_2020_12, $defs: {
    Probe: { type: 'object', properties: { value: { type: 'boolean' } }, required: ['value'], unevaluatedProperties: false },
  } };
  const schemaText = JSON.stringify(authored, null, 2) + '\n';
  writeFileSync(tsp, tspText);
  writeFileSync(schema, schemaText);
  writeFileSync(join(instances, 'Probe/valid/value.json'), '{"value":true}\n');
  writeFileSync(join(instances, 'Probe/invalid/type.json'), '{"value":"true"}\n');
  writeFileSync(join(instances, 'Probe/invalid/missing.json'), '{}\n');

  const before = { typespec: digest(tsp), authored: digest(schema) };
  const output = resolve('tmp/probe-output');
  const accepted = run('probe-positive', tsp, schema, instances, output, 0);
  assert.equal(accepted.report.status, 'passed');
  assert.equal(accepted.report.zeroUnexplainedFindings, true);
  assert.equal(accepted.ir.admissible, true);
  assert(accepted.ir.declarations.length > 0);
  assert.deepEqual([readFileSync(tsp, 'utf8'), readFileSync(schema, 'utf8')], [tspText, schemaText]);
  assert.deepEqual({ typespec: digest(tsp), authored: digest(schema) }, before);
  assert.equal(accepted.report.inputs.generatedJsonSchema.input.endsWith('typespec.generated.schema.json'), true);

  const replay = runCompare('probe-positive', tsp, accepted.generatedPath, schema, instances, 0);
  assert.equal(replay.status, 'passed');
  assert.equal(replay.inputs.typespec.digest, accepted.report.inputs.typespec.digest);
  assert.equal(replay.inputs.generatedJsonSchema.digest, accepted.report.inputs.generatedJsonSchema.digest);
  assert.equal(replay.inputs.authoredJsonSchema.digest, accepted.report.inputs.authoredJsonSchema.digest);

  const generatedDigest = accepted.report.inputs.generatedJsonSchema.digest;
  const drift = structuredClone(authored);
  drift.$defs.Probe.properties.value.type = 'string';
  writeFileSync(schema, JSON.stringify(drift, null, 2) + '\n');
  const rejected = run('probe-drift', tsp, schema, instances, output, 2);
  stopped(rejected, 'stopped_for_evaluation');
  assert(rejected.report.findings.some(finding => finding.ruleId === 'generated-authored-semantic-mismatch'));
  assert.notEqual(rejected.report.runId, accepted.report.runId);
  assert.equal(rejected.report.inputs.typespec.digest, accepted.report.inputs.typespec.digest);
  assert.equal(rejected.report.inputs.generatedJsonSchema.digest, generatedDigest);
  assert.notEqual(rejected.report.inputs.authoredJsonSchema.digest, accepted.report.inputs.authoredJsonSchema.digest);

  const driftReplay = runCompare('probe-drift', tsp, rejected.generatedPath, schema, instances, 2);
  assert.equal(driftReplay.status, 'stopped_for_evaluation');
  assert(driftReplay.findings.some(finding => finding.ruleId === 'generated-authored-semantic-mismatch'));

  writeFileSync(schema, schemaText);
  const recovered = run('probe-recovery', tsp, schema, instances, output, 0);
  assert.equal(recovered.ir.admissible, true);
  assert.equal(recovered.report.runId, accepted.report.runId);
  assert.deepEqual({ typespec: digest(tsp), authored: digest(schema) }, before);

  runMissingAuthority(tsp, join(source, 'missing.authored.schema.json'), resolve('tmp/missing-authority-output'));

  writeFileSync(tsp, 'model Probe { this is deliberately invalid TypeSpec\n');
  const failed = run('probe-compiler-failure', tsp, schema, instances, output, 3);
  stopped(failed, 'failed');
  writeFileSync(tsp, tspText);
  const final = run('probe-final-recovery', tsp, schema, instances, output, 0);
  assert.equal(final.ir.admissible, true);
  assert.equal(final.report.runId, accepted.report.runId);
  assert.deepEqual({ typespec: digest(tsp), authored: digest(schema) }, before);
});

test('unowned Contract IR destinations are preserved and execution fails closed', () => {
  const source = resolve('tmp/interfaces');
  const output = resolve('tmp/unowned-output');
  mkdirSync(output, { recursive: true });
  const irPath = join(output, 'contract-ir.json');
  const reportPath = join(output, 'report.json');
  const original = '{"sentinel":"caller-owned; not a TJSV receipt"}\n';
  writeFileSync(irPath, original);
  const result = spawnSync(process.execPath, [tool, 'check',
    `--typespec=${join(source, 'contracts/shared-public/validation.tsp')}`,
    `--schema=${join(source, 'contracts/shared-public/schema.json')}`,
    `--instances=${join(source, 'corpus')}`, `--report=${reportPath}`,
    `--contract-ir=${irPath}`, `--output-dir=${join(output, 'generated')}`,
  ], { encoding: 'utf8', timeout: 90000, maxBuffer: 8 * 1024 * 1024 });
  writeFileSync(join(evidence, 'unowned-refusal.log'), `${result.stdout ?? ''}\n${result.stderr ?? ''}`);
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  assert.equal(result.status, 3);
  assert.match(`${result.stdout}\n${result.stderr}`, /not validator-owned Contract IR/);
  assert.equal(readFileSync(irPath, 'utf8'), original);
  const report = readJson(reportPath);
  assert.equal(report.status, 'failed');
  writeFileSync(join(evidence, 'unowned-refusal.report.json'), JSON.stringify(report, null, 2));
  writeFileSync(join(evidence, 'unowned-refusal.destination.json'), original);
});
