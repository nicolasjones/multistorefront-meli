import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const script = path.resolve("scripts/calidad.mjs");

test("[MSF-683] calidad llega al RESUMEN y deja reports/calidad.log aunque no corra ninguna herramienta", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "calidad-"));
  const r = spawnSync(process.execPath, [script, "--only=ninguno"], { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /---- RESUMEN ----/);
  assert.ok(fs.existsSync(path.join(cwd, "reports", "calidad.log")));
  assert.ok(fs.existsSync(path.join(cwd, "reports", "calidad.md")));
});
