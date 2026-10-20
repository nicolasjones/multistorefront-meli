#!/usr/bin/env node
// Verifica que una spec con datos tenga su DER en Mermaid (`erDiagram`).
// Uso:
//   node scripts/verificar-der.mjs                 # specs cambiadas vs. la base (GITHUB_BASE_REF / HEAD~1)
//   node scripts/verificar-der.mjs specs/x/spec.md # una o más specs
// Regla: toda spec cambiada debe tener `## Modelo de datos (DER)` con un bloque ```mermaid erDiagram```.
// Si la épica no toca el esquema, la sección existe y dice "Sin cambios de esquema." (no se borra).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { pathToFileURL } from "node:url";

export function verificarDer(texto = "") {
  if (!/^##\s+Modelo de datos \(DER\)\s*$/im.test(texto)) {
    return { ok: false, motivo: "falta la sección `## Modelo de datos (DER)`" };
  }
  const bloques = [...String(texto).matchAll(/```mermaid\s*\n([\s\S]*?)```/g)].map((m) => m[1]);
  if (!bloques.some((b) => /^\s*erDiagram\b/im.test(b))) {
    return { ok: false, motivo: "la sección no tiene un bloque ```mermaid con `erDiagram`" };
  }
  return { ok: true, motivo: "DER OK" };
}

function specsCambiadas() {
  const base = process.env.GITHUB_BASE_REF
    ? `origin/${process.env.GITHUB_BASE_REF}`
    : (process.env.DOCUMENTATION_CHECK_BASE || "HEAD~1");
  const r = spawnSync("git", ["diff", "--name-only", `${base}...HEAD`, "--", "specs"], { encoding: "utf8" });
  if (r.status !== 0) return [];
  return r.stdout.split(/\r?\n/).map((s) => s.trim()).filter((f) => /^specs\/.+\/spec\.md$/.test(f));
}

function todas() {
  const r = spawnSync("git", ["ls-files", "specs/*/spec.md"], { encoding: "utf8" });
  return (r.stdout || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const archivos = args.length ? args : (specsCambiadas().length ? specsCambiadas() : todas());
  if (!archivos.length) {
    console.log("DER: no hay specs para verificar.");
    return 0;
  }
  let fallas = 0;
  for (const f of archivos) {
    if (!fs.existsSync(f)) {
      console.error(`❌ ${f}: no existe`);
      fallas++;
      continue;
    }
    const r = verificarDer(fs.readFileSync(f, "utf8"));
    if (r.ok) console.log(`✅ ${f}: ${r.motivo}`);
    else {
      console.error(`❌ ${f}: ${r.motivo}`);
      fallas++;
    }
  }
  if (fallas) {
    console.error(`\n${fallas} spec(s) sin DER. Agregá \`## Modelo de datos (DER)\` con un \`erDiagram\` de Mermaid.`);
    return 1;
  }
  console.log(`\nDER OK (${archivos.length} spec/s).`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}
