// Rechaza un `.env` (o el entorno de un contenedor) que use un valor por defecto conocido como secreto (MSF-649, MSF-705).
// SOLO LECTURA. Imprime nombres de variable y el motivo, nunca el valor.
//
//   node scripts/verificar-secretos-por-defecto.mjs --archivo .env.staging
//   docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' <contenedor> | node scripts/verificar-secretos-por-defecto.mjs --archivo -
//
// Sale con 1 si encuentra alguno, con 2 si el uso es inválido o no puede leer el archivo.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { hallazgosPorDefecto } from './secretos-por-defecto.mjs';

export function verificar(contenido) {
  const hallazgos = hallazgosPorDefecto(contenido);
  return {
    ok: hallazgos.length === 0,
    mensaje: hallazgos.length === 0
      ? 'Ninguna variable usa un valor por defecto conocido.'
      : [`${hallazgos.length} variable(s) con un valor por defecto conocido (se muestran solo los nombres):`, ...hallazgos.map((h) => `- ${h.nombre}: ${h.motivo}`)].join('\n'),
  };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const i = process.argv.indexOf('--archivo');
  const archivo = i === -1 ? undefined : process.argv[i + 1];
  if (!archivo) {
    console.error('Uso: node scripts/verificar-secretos-por-defecto.mjs --archivo <ruta|->');
    process.exit(2);
  }
  let contenido;
  try {
    contenido = readFileSync(archivo === '-' ? 0 : archivo, 'utf8');
  } catch {
    console.error('No se pudo leer el archivo indicado.');
    process.exit(2);
  }
  const { ok, mensaje } = verificar(contenido);
  (ok ? console.log : console.error)(mensaje);
  process.exit(ok ? 0 : 1);
}
