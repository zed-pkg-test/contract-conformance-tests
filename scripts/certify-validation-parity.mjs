#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const [rootArg, expectedRepository, expectedRef] = process.argv.slice(2);
if (!rootArg || !expectedRepository || !expectedRef) {
  throw new Error('usage: certify-validation-parity.mjs <producer-root> <repository> <commit>');
}
const root = resolve(rootArg);
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const readJson = (path) => JSON.parse(read(path));
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const sort = (value) => Array.isArray(value) ? value.map(sort) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, sort(value[key])])) : value;
const canonicalJson = (value) => JSON.stringify(sort(value), null, 2) + '\n';

assert(/^[0-9a-f]{40}$/.test(expectedRef), `producer ref is not an immutable commit: ${expectedRef}`);
const receipt = readJson('generated/final/parity-receipt.v2.json');
assert(receipt.receiptVersion === 'ores.validation.parity-receipt.v2', 'unexpected receipt version');
assert(receipt.contractVersion === 'ores.validation.v2', 'unexpected contract version');
assert(receipt.repository === expectedRepository, `receipt repository ${receipt.repository} != ${expectedRepository}`);
assert(receipt.agreement === true, 'authority agreement is not true');
assert(receipt.generatedOnlyAfterAgreement === true, 'final artifacts were not marked agreement-gated');
assert(receipt.routeAuthority === 'https://github.com/ORESoftware/api-docs', 'route authority is not api-docs');

const targets = receipt.finalTargetDigests ?? {};
assert(Object.keys(targets).length >= 9, 'receipt is missing multi-language/runtime targets');
for (const [relativePath, expectedDigest] of Object.entries(targets)) {
  const fullPath = resolve(root, 'generated/final', relativePath);
  assert(existsSync(fullPath), `missing final target ${relativePath}`);
  const actualDigest = sha256(readFileSync(fullPath));
  assert(actualDigest === expectedDigest, `digest mismatch for ${relativePath}: ${actualDigest} != ${expectedDigest}`);
}
assert(sha256(canonicalJson(targets)) === receipt.finalAggregateDigest, 'aggregate target digest mismatch');

const jsonCandidate = read('generated/candidates/json-schema/isomorphic.signature.json');
const typeSpecCandidate = read('generated/candidates/typespec/isomorphic.signature.json');
assert(jsonCandidate === typeSpecCandidate, 'independent candidate signatures differ');

const assignedModels = new Map();
for (const [scope, evidence] of Object.entries(receipt.scopes ?? {})) {
  assert(evidence.agreement === true, `scope ${scope} did not agree`);
  assert(evidence.authorities?.jsonSchema?.semanticDigest === evidence.authorities?.typespec?.semanticDigest,
    `authority semantic digests differ in ${scope}`);
  for (const model of evidence.models ?? []) {
    assert(!assignedModels.has(model), `model ${model} is assigned to both ${assignedModels.get(model)} and ${scope}`);
    assignedModels.set(model, scope);
  }
}
assert(assignedModels.size > 0, 'receipt assigns no models');

const forbidden = ['TrustedActor', 'ServerRequestContext', 'InternalCommand'];
for (const runtime of ['browser', 'edge']) {
  const source = read(`generated/final/typescript/runtime/${runtime}/index.ts`);
  assert(source.includes(`validationRuntime=\"${runtime}\"`), `${runtime} runtime identity is missing`);
  assert(!/\.\.\/\.\.\/server\//.test(source), `${runtime} runtime exports server scope`);
}
for (const relativePath of Object.keys(targets).filter((path) => !path.includes('/server/'))) {
  const source = read(`generated/final/${relativePath}`);
  for (const model of forbidden) assert(!source.includes(model), `${model} leaked into public target ${relativePath}`);
}

const bindings = receipt.routeBindings;
if (bindings) {
  assert(bindings.count === bindings.operationIds.length, 'route binding count mismatch');
  assert(new Set(bindings.operationIds).size === bindings.operationIds.length, 'duplicate api-docs operationId');
  assert(bindings.operationIds.every((id) => typeof id === 'string' && id.trim()), 'blank api-docs operationId');
}

console.log(JSON.stringify({
  certification: 'ores.validation.external-certification.v2',
  repository: expectedRepository,
  commit: expectedRef,
  aggregateDigest: receipt.finalAggregateDigest,
  models: [...assignedModels.keys()].sort(),
  targets: Object.keys(targets).length,
}, null, 2));
