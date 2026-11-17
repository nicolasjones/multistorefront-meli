// Preflight del despliegue al VPS: variables que el Compose exige (`${VAR:?}`) y que, si faltan, hacen fallar
// `docker compose config` y abortan el despliegue de los tres productos en esa corrida. Se comprueban ANTES, con un
// mensaje que dice exactamente qué variable falta y dónde definirla.

export const VARIABLES_OBLIGATORIAS = [
  {
    nombre: 'CORREO_MASIVO_URL_BAJA',
    descripcion: 'origen público https del panel de ese ambiente, sin barra final (por ejemplo https://panel.ejemplo.com); lo usa el enlace de baja del correo masivo (infra/kestra/compose.vps.yaml)',
  },
];

// Lee KEY=valor de un .env (sin expandir variables): suficiente para saber si la clave está definida y no vacía.
export function leerEnv(contenido) {
  const valores = new Map();
  for (const linea of String(contenido).split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(linea);
    if (!m) continue;
    valores.set(m[1], m[2].replace(/^(['"])(.*)\1$/, '$2'));
  }
  return valores;
}

export function variablesFaltantes(contenido) {
  const valores = leerEnv(contenido);
  return VARIABLES_OBLIGATORIAS.filter(({ nombre }) => !valores.get(nombre));
}

export function mensajeFaltantes(faltantes, entorno) {
  return [
    `Falta definir ${faltantes.map((f) => f.nombre).join(', ')} en .env.${entorno} (se sintetiza desde el secret VPS_DEPLOY_ENV de GitHub del entorno ${entorno}).`,
    ...faltantes.map((f) => `- ${f.nombre}: ${f.descripcion}.`),
    'Sin esa variable `docker compose config` falla y se aborta el despliegue de Kestra, Superset y Nango (lo ya desplegado sigue corriendo). Ver docs/correo-masivo.md.',
  ].join('\n');
}
