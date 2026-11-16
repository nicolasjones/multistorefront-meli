#!/usr/bin/env node
// Genera el inventario técnico de la documentación desde el código (determinístico, sin LLM).
// Uso: node scripts/docs-inventario.mjs
// Escribe docs/_generated/inventory.json y docs/_generated/inventory.md (se versionan; el CI verifica
// que estén al día con `git diff --exit-code docs/_generated`).
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const outDir = path.join(root, "docs", "_generated");
fs.mkdirSync(outDir, { recursive: true });

function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
}

const rel = (p) => path.relative(root, p).split(path.sep).join("/");

// Rutas del panel: apps/web/src/pages/**/*.tsx (sin tests) → /ruta
const pageFiles = walk(path.join(root, "apps/web/src/pages"))
  .filter((f) => f.endsWith(".tsx") && !/\.test\.tsx$/.test(f));
const rutas = [...new Set(pageFiles.map((f) => {
  let r = rel(f).replace(/^apps\/web\/src\/pages\//, "").replace(/\.tsx$/, "");
  r = r.replace(/\/index$/, "").replace(/^index$/, "");
  return "/" + r;
}))].sort();

// Tablas: create table ... en migraciones
const tablas = [...new Set(walk(path.join(root, "supabase/migrations"))
  .filter((f) => f.endsWith(".sql"))
  .flatMap((f) => [...fs.readFileSync(f, "utf8").matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?([a-zA-Z0-9_.]+)/gi)]
    .map((m) => m[1]))
)].sort();

// Variables de entorno del contrato
const envFile = path.join(root, ".env.example");
const variables = fs.existsSync(envFile)
  ? fs.readFileSync(envFile, "utf8").split(/\r?\n/)
      .map((l) => l.match(/^([A-Z0-9_]+)=/)?.[1]).filter(Boolean).sort()
  : [];

// Specs
const specsDir = path.join(root, "specs");
const specs = fs.existsSync(specsDir)
  ? fs.readdirSync(specsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && fs.existsSync(path.join(specsDir, e.name, "spec.md")))
      .map((e) => {
        const md = fs.readFileSync(path.join(specsDir, e.name, "spec.md"), "utf8");
        return { slug: e.name, titulo: (md.match(/^#\s+(.+)$/m)?.[1] || e.name).trim() };
      }).sort((a, b) => a.slug.localeCompare(b.slug))
  : [];

const paginas = walk(path.join(root, "docs")).filter((f) => f.endsWith(".md")).length;
const data = { rutas, tablas, variables, specs, paginas };
fs.writeFileSync(path.join(outDir, "inventory.json"), JSON.stringify(data, null, 2) + "\n");

const md = [
  "# Inventario (generado)",
  "",
  "> Generado por `pnpm docs:wiki:inventario` desde el código. **No editar a mano.**",
  "",
  `- Rutas del panel: **${rutas.length}**`,
  `- Tablas en migraciones: **${tablas.length}**`,
  `- Variables de entorno: **${variables.length}**`,
  `- Specs: **${specs.length}**`,
  `- Páginas de documentación: **${paginas}**`,
  "",
  "## Rutas del panel",
  "",
  ...rutas.map((r) => `- \`${r}\``),
  "",
  "## Tablas en migraciones",
  "",
  ...tablas.map((t) => `- \`${t}\``),
  "",
  "## Variables de entorno (`.env.example`)",
  "",
  ...variables.map((v) => `- \`${v}\``),
  "",
  "## Specs",
  "",
  ...specs.map((s) => `- \`${s.slug}\` — ${s.titulo}`),
  "",
].join("\n");
fs.writeFileSync(path.join(outDir, "inventory.md"), md);
console.log(`Inventario: ${rutas.length} rutas · ${tablas.length} tablas · ${variables.length} vars · ${specs.length} specs · ${paginas} páginas`);
