import assert from "node:assert/strict";
import { test } from "node:test";
import { CONTRACT_VERSION } from "../dist/index.js";

test("contract version is stable", () => assert.equal(CONTRACT_VERSION, "athlet-o.pub-lib-core.v1"));
