import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { sha256Json, verifyContractIrAdmission, VALIDATOR_REVISION } from '../.deps/zed-clients/contract-admission/contract-ir-admission.mjs';

const exec = promisify(execFile);
const root = resolve(import.meta.dirname, '..');
const clients = join(root, '.deps/zed-clients');
const validator = join(clients, '.deps/typespec-json-schema-validator');
const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));

test('independent sibling consumer certifies the exact Zed admission implementation', async (t) => {
  const pins = await readJson(join(root, 'fixtures/contract-ir-pins.json'));
  assert.equal((await exec('git', ['-C', clients, 'rev-parse', 'HEAD'])).stdout.trim(), pins.clients);
  assert.equal((await exec('git', ['-C', validator, 'rev-parse', 'HEAD'])).stdout.trim(), pins.validator);
  assert.equal(VALIDATOR_REVISION, pins.validator);
  const work = await mkdtemp(join(validator, '.zed-sibling-test-'));
  t.after(() => rm(work, { recursive: true, force: true }));
  const sources = join(work, 'sources');
  await cp(join(root, 'fixtures/contract-ir-consumer'), sources, { recursive: true });
  const inputPaths = { typespec: join(sources, 'main.tsp'), authoredSchema: join(sources, 'authored.schema.json'), generatedSchema: join(work, 'witness') };
  const reportPath = join(work, 'report.json');
  const irPath = join(work, 'contract-ir.json');
  const cli = join(validator, 'bin/typespec-json-schema-validator.mjs');
  const args = ['check', `--typespec=${inputPaths.typespec}`, `--schema=${inputPaths.authoredSchema}`,
    `--output-dir=${inputPaths.generatedSchema}`, `--report=${reportPath}`, `--contract-ir=${irPath}`, '--quiet'];
  const run = (extra = []) => exec(process.execPath, [cli, ...args, ...extra], { cwd: validator, timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
  await run();
  const evidence = { contractIr: await readJson(irPath), parityReport: await readJson(reportPath), inputPaths,
    requiredDeclarations: ['Zed.Conformance.PackageInstallIntent'] };

  await t.test('admits the independently authored sibling contract after compilation', async () => {
    assert.equal((await verifyContractIrAdmission(evidence)).admitted, true);
  });
  await t.test('rejects forbidden exports in the actual compiled inventory', async () => {
    await assert.rejects(verifyContractIrAdmission({ ...evidence, forbiddenDeclarations: ['Zed.Conformance.PackageInstallIntent'] }), /forbidden declaration/);
  });
  await t.test('does not silently accept missing required SDK declarations', async () => {
    await assert.rejects(verifyContractIrAdmission({ ...evidence, requiredDeclarations: ['Zed.Conformance.AbsentOperation'] }), /required declaration is absent/);
  });
  await t.test('binds transitive local TypeSpec imports, not just the entrypoint', async () => {
    const path = join(sources, 'package.tsp');
    const original = await readFile(path, 'utf8');
    const entrypoint = await readFile(inputPaths.typespec, 'utf8');
    try {
      await writeFile(path, original.replace('dryRun: boolean', 'dryRun: string'));
      assert.equal(await readFile(inputPaths.typespec, 'utf8'), entrypoint);
      await assert.rejects(verifyContractIrAdmission(evidence), /current-checkout verification failed/);
    } finally { await writeFile(path, original); }
  });
  await t.test('rejects relabeled disabled evidence even when receipt and IR are rehashed', async () => {
    const changed = structuredClone(evidence);
    changed.parityReport.coverage.differentialInstanceValidation = false;
    changed.contractIr.coverage.differentialInstanceValidation = false;
    changed.contractIr.admission.receipt.digest = sha256Json(changed.parityReport);
    const { irId, ...body } = changed.contractIr;
    changed.contractIr.irId = sha256Json(body);
    await assert.rejects(verifyContractIrAdmission(changed), /differentialInstanceValidation/);
  });
  await t.test('a real probes-disabled run cannot retain the previously admissible artifact', async () => {
    await assert.rejects(run(['--probes=false']), (error) => error.code === 3);
    const stopped = { ...evidence, contractIr: await readJson(irPath), parityReport: await readJson(reportPath) };
    assert.equal(stopped.contractIr.admissible, false);
    await assert.rejects(verifyContractIrAdmission(stopped), /passed and admissible/);
  });
});
