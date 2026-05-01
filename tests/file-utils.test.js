const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.SQLITE_MIRROR_ENABLED = "0";

const {
  appendJsonArray,
  readJsonSafe,
  writeJsonAtomic,
} = require("../runtime/file-utils");

test("writeJsonAtomic persists JSON payloads safely", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "file-utils-"));
  const file = path.join(dir, "state.json");

  writeJsonAtomic(file, { ok: true, count: 2 });

  assert.deepEqual(readJsonSafe(file, {}), { ok: true, count: 2 });
});

test("appendJsonArray keeps array structure on disk", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "file-utils-"));
  const file = path.join(dir, "orders-log.json");

  appendJsonArray(file, { id: 1 });
  appendJsonArray(file, { id: 2 });

  assert.deepEqual(readJsonSafe(file, []), [{ id: 1 }, { id: 2 }]);
});
