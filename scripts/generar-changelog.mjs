#!/usr/bin/env node
// Genera docs/changelog.md desde commits convencionales (sin LLM).
// Uso: node scripts/generar-changelog.mjs [--from <ref>] [--to <ref>] [--out docs/changelog.md]
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const to = opt("--to", "HEAD");
const from = opt("--from", "HEAD~40");
const out = opt("--out", path.join(process.cwd(), "docs/changelog.md"));

const r = spawnSync("git", ["log", "--first-parent", "--no-merges", "--pretty=format:%h%x09%s", `${from}..${to}`], { encoding: "utf8" });
if (r.status !== 0) { console.error(r.stderr || "git log falló"); process.exit(1); }
const fecha = spawnSync("git", ["log", "-1", "--format=%cs", to], { encoding: "utf8" }).stdout.trim();

const grupos = { producto: { feat: [], fix: [], perf: [] }, tecnico: { docs: [], test: [], chore: [], refactor: [], build: [], ci: [], style: [], revert: [] }, otros: [] };
for (const line of (r.stdout || "").split("\n").filter(Boolean)) {
  const [hash, subject] = line.split("\t");
  const m = subject.match(/^(\w+)(?:\(([^)]+)\))?:\s*(.+)$/);
  if (!m) { grupos.otros.push({ hash, subject }); continue; }
  const [, tipo, scope, texto] = m;
  const item = { hash, scope, texto };
  if (grupos.producto[tipo]) grupos.producto[tipo].push(item);
  else if (grupos.tecnico[tipo]) grupos.tecnico[tipo].push(item);
  else grupos.otros.push({ hash, subject });
}
const fmt = (list) => list.map((x) => `- ${x.scope ? `**${x.scope}**: ` : ""}${x.texto} (\`${x.hash}\`)`).join("\n");
const seccion = (titulo, obj) => [`## ${titulo}`, ...Object.entries(obj).filter(([, v]) => v.length).map(([t, v]) => `### ${t}\n${fmt(v)}`)].join("\n\n");
const md = `# Changelog\n\n> Generado desde commits convencionales por \`pnpm changelog\` (rango \`${from}..${to}\`, ${fecha}). **No editar a mano.**\n\n${seccion("Producto", grupos.producto)}\n\n${seccion("Técnico", grupos.tecnico)}\n${grupos.otros.length ? `\n## Otros\n${fmt(grupos.otros)}\n` : ""}`;
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, md);
console.log(`Changelog: ${path.relative(process.cwd(), out)} (${fecha}, ${from}..${to})`);
