import { hallazgosPorDefecto } from './secretos-por-defecto.mjs';

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
    soloEstricto: true,
  },
  {
    nombre: 'KESTRA_BASIC_AUTH_USERNAME',
    descripcion: 'credencial de kestra sin valor por defecto en el VPS (infra/kestra/compose.vps.yaml, MSF-705)',
    soloEstricto: true,
  },
  {
    nombre: 'KESTRA_BASIC_AUTH_PASSWORD',
    descripcion: 'credencial de kestra sin valor por defecto en el VPS (infra/kestra/compose.vps.yaml, MSF-705)',
    soloEstricto: true,
  },
  {
    nombre: 'KESTRA_BACKUPS_DB_PASSWORD',
    descripcion: 'credencial de kestra sin valor por defecto en el VPS (infra/kestra/compose.vps.yaml, MSF-705)',
    soloEstricto: true,
  },
  {
    nombre: 'KESTRA_ORQUESTACION_DB_PASSWORD',
    descripcion: 'credencial de kestra sin valor por defecto en el VPS (infra/kestra/compose.vps.yaml, MSF-705)',
    soloEstricto: true,
  },
  {
    nombre: 'KESTRA_BACKUPS_PGDUMP_URL',
    descripcion: 'credencial de kestra sin valor por defecto en el VPS (infra/kestra/compose.estricto.yaml, MSF-705)',
    soloEstricto: true,
  },
  {
    nombre: 'RESPALDOS_STORAGE_ACCESS_KEY_ID',
    descripcion: 'credencial de kestra sin valor por defecto en el VPS (infra/kestra/compose.estricto.yaml, MSF-705)',
    soloEstricto: true,
  },
  {
    nombre: 'RESPALDOS_STORAGE_SECRET_ACCESS_KEY',
    descripcion: 'credencial de kestra sin valor por defecto en el VPS (infra/kestra/compose.estricto.yaml, MSF-705)',
    soloEstricto: true,
  },
  {
    nombre: 'SUPERSET_DB_PASSWORD',
    descripcion: 'credencial de superset sin valor por defecto en el VPS (infra/superset/compose.vps.yaml, MSF-705)',
    soloEstricto: true,
  },
  {
    nombre: 'SUPERSET_SECRET_KEY',
    descripcion: 'credencial de superset sin valor por defecto en el VPS (infra/superset/compose.vps.yaml, MSF-705)',
    soloEstricto: true,
  },
  {
    nombre: 'SUPERSET_ADMIN_PASSWORD',
    descripcion: 'credencial de superset sin valor por defecto en el VPS (infra/superset/compose.vps.yaml, MSF-705)',
    soloEstricto: true,
  },
  {
    nombre: 'SUPERSET_GUEST_TOKEN_JWT_SECRET',
    descripcion: 'credencial de superset sin valor por defecto en el VPS (infra/superset/compose.vps.yaml, MSF-705)',
    soloEstricto: true,
  },
  {
    nombre: 'SUPERSET_GUEST_TOKEN_PASSWORD',
    descripcion: 'credencial de superset sin valor por defecto en el VPS (infra/superset/compose.vps.yaml, MSF-705)',
    soloEstricto: true,
  },
  {
    nombre: 'NANGO_DB_PASSWORD',
    descripcion: 'credencial de nango sin valor por defecto en el VPS (infra/nango/compose.vps.yaml, MSF-705)',
    soloEstricto: true,
  },
  {
    nombre: 'NANGO_ENCRYPTION_KEY',
    descripcion: 'credencial de nango sin valor por defecto en el VPS (infra/nango/compose.vps.yaml, MSF-705)',
    soloEstricto: true,
  },
  {
    nombre: 'NANGO_DASHBOARD_PASSWORD',
    descripcion: 'credencial de nango sin valor por defecto en el VPS (infra/nango/compose.vps.yaml, MSF-705)',
    soloEstricto: true,
  },
  {
    nombre: 'NANGO_SECRET_KEY_DEV',
    descripcion: 'credencial de nango sin valor por defecto en el VPS (infra/nango/compose.vps.yaml, MSF-705)',
    soloEstricto: true,
  },
  {
    nombre: 'HISTORIAL_IMPORTADOR_IMAGEN',
    descripcion: 'imagen del worker por referencia inmutable (imagen@sha256:<64 hex> o tag de commit de 40 hex), nunca :latest (MSF-712; la publica worker-images.yml en su resumen)',
    inmutable: true,
    soloEstricto: true,
  },
  {
    nombre: 'IMPORTAR_PRODUCTOS_IMAGEN',
    descripcion: 'imagen del worker por referencia inmutable (imagen@sha256:<64 hex> o tag de commit de 40 hex), nunca :latest (MSF-712; la publica worker-images.yml en su resumen)',
    inmutable: true,
    soloEstricto: true,
  },
  {
    nombre: 'EXPORTAR_COMPROBANTES_IMAGEN',
    descripcion: 'imagen del worker por referencia inmutable (imagen@sha256:<64 hex> o tag de commit de 40 hex), nunca :latest (MSF-712; la publica worker-images.yml en su resumen)',
    inmutable: true,
    soloEstricto: true,
  },
  {
    nombre: 'EXPORTAR_ORGANIZACION_IMAGEN',
    descripcion: 'imagen del worker por referencia inmutable (imagen@sha256:<64 hex> o tag de commit de 40 hex), nunca :latest (MSF-712; la publica worker-images.yml en su resumen)',
    inmutable: true,
    soloEstricto: true,
  },
  {
    nombre: 'COMPROBANTES_PDF_IMAGEN',
    descripcion: 'imagen del worker por referencia inmutable (imagen@sha256:<64 hex> o tag de commit de 40 hex), nunca :latest (MSF-712; la publica worker-images.yml en su resumen)',
    inmutable: true,
    soloEstricto: true,
  },
];

// Referencia inmutable de una imagen: digest `@sha256:<64 hex>` o tag igual al SHA del commit (40 hex). `:latest` o sin tag no sirven.
export const IMAGEN_INMUTABLE = /^[^\s@:]+(?::\d+)?(?:\/[^\s@:]+)*(?:@sha256:[0-9a-f]{64}|:[0-9a-f]{40})$/;

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
  // Falta si no está definida o, para las imágenes de workers, si no es una referencia inmutable (MSF-712).
  return VARIABLES_OBLIGATORIAS.filter(({ nombre, inmutable }) => {
    const valor = valores.get(nombre);
    return !valor || (inmutable && !IMAGEN_INMUTABLE.test(valor));
  });
}

export function mensajeFaltantes(faltantes, entorno, archivo = `.env.${entorno}`) {
  return [
    `Falta definir ${faltantes.map((f) => f.nombre).join(', ')} en ${archivo} (se sintetiza desde el secret VPS_DEPLOY_ENV de GitHub del entorno ${entorno}).`,
    ...faltantes.map((f) => `- ${f.nombre}: ${f.descripcion}.`),
    'Sin esas variables `docker compose config` falla y se aborta el despliegue de Kestra, Superset y Nango (lo ya desplegado sigue corriendo): ninguno arranca con una credencial por defecto (MSF-705). Ver docs/deployment.md y, para CORREO_MASIVO_URL_BAJA, docs/correo-masivo.md.',
  ].join('\n');
}

// Modo transicional (MSF-705, MSF-706, MSF-712): staging y producción son SIEMPRE estrictos (fail-closed). En `dev` los controles nuevos
// advierten y el despliegue continúa, hasta que se carguen los valores y se pase a estricto con VPS_ESTRICTO=1 (docs/deployment.md,
// «Pasar dev a modo estricto»). VPS_ESTRICTO=0 NO relaja staging ni producción.
export function modoEstricto(entorno, env = process.env, contenidoEnv = '') {
  if (entorno !== 'dev') return true;
  // La variable del proceso (Environment del job) manda; si no está, se lee del propio `.env.<entorno>`, igual que las demás.
  const valor = env.VPS_ESTRICTO?.trim() || leerEnv(contenidoEnv).get('VPS_ESTRICTO') || '';
  return valor === '1';
}

// Separa lo que corta el despliegue de lo que solo advierte. Solo se manejan NOMBRES: nunca el valor de una variable.
export function clasificarFaltantes(faltantes, estricto) {
  return {
    bloqueantes: faltantes.filter((f) => !f.soloEstricto || estricto),
    advertencias: faltantes.filter((f) => f.soloEstricto && !estricto),
  };
}

export function mensajeAdvertencia(faltantes, archivo) {
  return [
    `::warning::MODO TRANSICIONAL (dev): faltan o son inválidas ${faltantes.length} variable(s) en ${archivo}; el despliegue CONTINÚA, pero staging y producción lo rechazarían:`,
    ...faltantes.map((f) => `- ${f.nombre}: ${f.descripcion}.`),
    'Cargalas en el .env de dev y activá VPS_ESTRICTO=1 para que dev también bloquee (docs/deployment.md, «Pasar dev a modo estricto»).',
  ].join('\n');
}

// MSF-649 / MSF-705: un valor por defecto público en el `.env` del ambiente (la variable está definida, pero con `change-me-local`, `postgres`,
// el secreto JWT público de Supabase, etc.) es tan malo como que falte. Solo nombres y motivo: nunca el valor. Mismo criterio estricto/transicional.
export function valoresPorDefecto(contenido) {
  return hallazgosPorDefecto(contenido);
}

export function mensajeValoresPorDefecto(hallazgos, entorno, archivo = `.env.${entorno}`) {
  return [
    `${hallazgos.length} variable(s) de ${archivo} usan un valor por defecto público (${entorno}); se muestran solo los nombres:`,
    ...hallazgos.map((h) => `- ${h.nombre}: ${h.motivo}.`),
    'Generá valores propios con `node scripts/generar-secretos-entorno.mjs` y rotalos (docs/endurecimiento-infra.md, «Rotar los secretos de un entorno»).',
  ].join('\n');
}
