// Preflight del despliegue al VPS: variables que el Compose exige (`${VAR:?}`) y que, si faltan, hacen fallar
// `docker compose config` y abortan el despliegue de los tres productos en esa corrida. Se comprueban ANTES, con un
// mensaje que dice exactamente qué variable falta y dónde definirla.

export const VARIABLES_OBLIGATORIAS = [
  {
    nombre: 'CORREO_MASIVO_URL_BAJA',
    descripcion: 'origen público https del panel de ese ambiente, sin barra final (por ejemplo https://panel.ejemplo.com); lo usa el enlace de baja del correo masivo (infra/kestra/compose.vps.yaml)',
  },
  {
    nombre: 'KESTRA_DB_PASSWORD',
    descripcion: 'credencial de kestra sin valor por defecto en el VPS (infra/kestra/compose.vps.yaml, MSF-705)',
  },
  {
    nombre: 'KESTRA_BASIC_AUTH_USERNAME',
    descripcion: 'credencial de kestra sin valor por defecto en el VPS (infra/kestra/compose.vps.yaml, MSF-705)',
  },
  {
    nombre: 'KESTRA_BASIC_AUTH_PASSWORD',
    descripcion: 'credencial de kestra sin valor por defecto en el VPS (infra/kestra/compose.vps.yaml, MSF-705)',
  },
  {
    nombre: 'KESTRA_BACKUPS_DB_PASSWORD',
    descripcion: 'credencial de kestra sin valor por defecto en el VPS (infra/kestra/compose.vps.yaml, MSF-705)',
  },
  {
    nombre: 'KESTRA_ORQUESTACION_DB_PASSWORD',
    descripcion: 'credencial de kestra sin valor por defecto en el VPS (infra/kestra/compose.vps.yaml, MSF-705)',
  },
  {
    nombre: 'SUPERSET_DB_PASSWORD',
    descripcion: 'credencial de superset sin valor por defecto en el VPS (infra/superset/compose.vps.yaml, MSF-705)',
  },
  {
    nombre: 'SUPERSET_SECRET_KEY',
    descripcion: 'credencial de superset sin valor por defecto en el VPS (infra/superset/compose.vps.yaml, MSF-705)',
  },
  {
    nombre: 'SUPERSET_ADMIN_PASSWORD',
    descripcion: 'credencial de superset sin valor por defecto en el VPS (infra/superset/compose.vps.yaml, MSF-705)',
  },
  {
    nombre: 'SUPERSET_GUEST_TOKEN_JWT_SECRET',
    descripcion: 'credencial de superset sin valor por defecto en el VPS (infra/superset/compose.vps.yaml, MSF-705)',
  },
  {
    nombre: 'SUPERSET_GUEST_TOKEN_PASSWORD',
    descripcion: 'credencial de superset sin valor por defecto en el VPS (infra/superset/compose.vps.yaml, MSF-705)',
  },
  {
    nombre: 'NANGO_DB_PASSWORD',
    descripcion: 'credencial de nango sin valor por defecto en el VPS (infra/nango/compose.vps.yaml, MSF-705)',
  },
  {
    nombre: 'NANGO_ENCRYPTION_KEY',
    descripcion: 'credencial de nango sin valor por defecto en el VPS (infra/nango/compose.vps.yaml, MSF-705)',
  },
  {
    nombre: 'NANGO_DASHBOARD_PASSWORD',
    descripcion: 'credencial de nango sin valor por defecto en el VPS (infra/nango/compose.vps.yaml, MSF-705)',
  },
  {
    nombre: 'NANGO_SECRET_KEY_DEV',
    descripcion: 'credencial de nango sin valor por defecto en el VPS (infra/nango/compose.vps.yaml, MSF-705)',
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

export function mensajeFaltantes(faltantes, entorno, archivo = `.env.${entorno}`) {
  return [
    `Falta definir ${faltantes.map((f) => f.nombre).join(', ')} en ${archivo} (se sintetiza desde el secret VPS_DEPLOY_ENV de GitHub del entorno ${entorno}).`,
    ...faltantes.map((f) => `- ${f.nombre}: ${f.descripcion}.`),
    'Sin esas variables `docker compose config` falla y se aborta el despliegue de Kestra, Superset y Nango (lo ya desplegado sigue corriendo): ninguno arranca con una credencial por defecto (MSF-705). Ver docs/deployment.md y, para CORREO_MASIVO_URL_BAJA, docs/correo-masivo.md.',
  ].join('\n');
}
