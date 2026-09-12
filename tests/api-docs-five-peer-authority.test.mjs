import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const DRAFT = 'https://json-schema.org/draft/2020-12/schema';
const apiDocs = resolve('tmp/api-docs');
const tool = resolve('tmp/tjsv/bin/typespec-json-schema-validator.mjs');
const evidence = resolve('tmp/api-docs-five-peer-evidence');
mkdirSync(evidence, { recursive: true });

const pairs = [
  ['docs-discovery', 'idl/typespec/docs-discovery.tsp', 'json-schema/docs-discovery.schema.json'],
  ['http-request-surface', 'idl/typespec/http/request-surface.tsp', 'json-schema/http-request-surface.schema.json'],
  ['ores-rpc-config', 'contracts/ores-rpc-config/typespec/main.tsp', 'contracts/ores-rpc-config/json-schema/ores-rpc-config.schema.json'],
  ['form-validation', 'form-validation/contracts/main.tsp', 'form-validation/contracts/authored.schema.json'],
  ['form-validation-admission-profiles', 'form-validation/admission-profiles/main.tsp', 'form-validation/admission-profiles/authored.schema.json'],
];

const readJson = path => JSON.parse(readFileSync(path, 'utf8'));
const digest = path => createHash('sha256').update(readFileSync(path)).digest('hex');

function assertPeerReceipt(report, label) {
  assert.equal(report.status, 'passed', `${label}: parity status`);
  assert.equal(report.zeroUnexplainedFindings, true, `${label}: unexplained findings`);
  assert.equal(report.authorities.typespec.authority, 'independently-authored', `${label}: TypeSpec authority`);
  assert.equal(report.authorities.typespec.generatedJsonSchemaRole, 'comparison-evidence-only', `${label}: generated witness role`);
  assert.equal(report.authorities.jsonSchema.authority, 'independently-authored', `${label}: JSON Schema authority`);
  assert.equal(report.authorities.jsonSchema.dialect, DRAFT, `${label}: JSON Schema dialect`);
  assert.equal(report.authorities.precedence, 'none', `${label}: source precedence`);
  assert.equal(report.authorities.onUnexplainedMismatch, 'STOPPED_FOR_EVALUATION', `${label}: mismatch policy`);
  assert.equal(report.coverage.directDeclarationInventory, true, `${label}: direct declaration inventory`);
  assert.equal(report.coverage.typespecGeneratedJsonSchemaComparison, true, `${label}: generated/authored comparison`);
}

function run(args, label, expected = 0) {
  const result = spawnSync(process.execPath, [tool, ...args], {
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null, `${label}: process signal`);
  assert.equal(result.status, expected, `${label}: ${result.stdout}\n${result.stderr}`);
  return result;
}

for (const [name, tspRel, schemaRel] of pairs) {
  test(`${name}: independent TypeSpec compiles to Schema B and compares with authored Schema A`, () => {
    const tsp = join(apiDocs, tspRel);
    const schema = join(apiDocs, schemaRel);
    assert.equal(existsSync(tsp), true, `${name}: TypeSpec input missing`);
    assert.equal(existsSync(schema), true, `${name}: authored JSON Schema input missing`);
    assert.equal(readJson(schema).$schema, DRAFT, `${name}: authored schema is not Draft 2020-12`);

    const before = { typespec: digest(tsp), authored: digest(schema) };
    const out = join(evidence, name);
    const generatedDir = join(out, 'generated');
    const generated = join(generatedDir, 'typespec.generated.schema.json');
    const reportPath = join(out, 'check.report.json');
    const irPath = join(out, 'contract-ir.json');
    mkdirSync(out, { recursive: true });

    run([
      'check',
      `--typespec=${tsp}`,
      `--schema=${schema}`,
      `--report=${reportPath}`,
      `--contract-ir=${irPath}`,
      `--output-dir=${generatedDir}`,
      '--max-probes=64',
      '--seal-object-schemas=true',
      '--polymorphic-models-strategy=oneOf',
    ], `${name}: check`);

    const report = readJson(reportPath);
    assertPeerReceipt(report, name);
    assert.equal(existsSync(generated), true, `${name}: generated Schema B missing`);
    assert.equal(readJson(generated).$schema, DRAFT, `${name}: generated schema dialect`);
    assert.equal(readJson(irPath).admissible, true, `${name}: Contract IR admission`);

    const comparePath = join(out, 'compare.report.json');
    run([
      'compare',
      `--typespec=${tsp}`,
      `--generated-schema=${generated}`,
      `--schema=${schema}`,
      `--report=${comparePath}`,
      '--max-probes=64',
    ], `${name}: explicit compare`);
    const replay = readJson(comparePath);
    assertPeerReceipt(replay, `${name}: explicit compare`);
    assert.equal(replay.inputs.typespec.digest, report.inputs.typespec.digest, `${name}: TypeSpec digest changed`);
    assert.equal(replay.inputs.generatedJsonSchema.digest, report.inputs.generatedJsonSchema.digest, `${name}: generated digest changed`);
    assert.equal(replay.inputs.authoredJsonSchema.digest, report.inputs.authoredJsonSchema.digest, `${name}: authored digest changed`);
    assert.deepEqual({ typespec: digest(tsp), authored: digest(schema) }, before, `${name}: source authority rewritten`);
  });
}

test('docs-discovery authored-schema drift blocks without editing either checked-out authority', () => {
  const tsp = join(apiDocs, 'idl/typespec/docs-discovery.tsp');
  const schema = join(apiDocs, 'json-schema/docs-discovery.schema.json');
  const before = { typespec: digest(tsp), authored: digest(schema) };
  const drift = structuredClone(readJson(schema));
  assert.equal(typeof drift.$defs?.DocsDiscoveryManifest?.properties?.schemaVersion?.const, 'string');
  drift.$defs.DocsDiscoveryManifest.properties.schemaVersion.const = '9.9.9';
  const drifted = join(evidence, 'docs-discovery-drifted.schema.json');
  writeFileSync(drifted, `${JSON.stringify(drift, null, 2)}\n`);
  const out = join(evidence, 'docs-discovery-drift');
  mkdirSync(out, { recursive: true });
  const reportPath = join(out, 'report.json');
  run([
    'check',
    `--typespec=${tsp}`,
    `--schema=${drifted}`,
    `--report=${reportPath}`,
    `--contract-ir=${join(out, 'contract-ir.json')}`,
    `--output-dir=${join(out, 'generated')}`,
    '--max-probes=64',
    '--seal-object-schemas=true',
    '--polymorphic-models-strategy=oneOf',
  ], 'docs-discovery drift', 2);
  const report = readJson(reportPath);
  assert.equal(report.status, 'stopped_for_evaluation');
  assert.equal(report.zeroUnexplainedFindings, false);
  assert(report.findings.some(finding => finding.ruleId === 'generated-authored-semantic-mismatch'));
  assert.deepEqual({ typespec: digest(tsp), authored: digest(schema) }, before);
});
