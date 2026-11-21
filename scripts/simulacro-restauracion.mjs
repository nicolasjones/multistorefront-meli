#!/usr/bin/env node
// Guion del simulacro de restauración (MSF-520 · FR-011 y SC-002 de la épica MSF-457).
//
// Qué es: la CORRIDA del simulacro. El procedimiento está escrito en `docs/simulacro-restauracion.md`;
// el guion hace la parte que tiene que ser un NÚMERO y no una impresión: toma el marcador de la
// «caída simulada», mide cuánto se tardó en volver a operar y cuánto se perdió, verifica que la base
// restaurada quedó con los privilegios correctos y escribe las filas del registro para que el dueño
// las pegue y firme.
//
// Qué NO es: no restaura. El `pg_restore`, el `rclone` y el apagado/encendido de los servicios los
// hace la persona a cargo (son decisiones del ambiente); el guion mide y verifica lo que se puede
// medir, y no inventa lo que no.
//
// Cuándo corre: a mano, en el ambiente, con autorización escrita del dueño (`SIMULACRO_AUTORIZACION`).
// NO corre en `pnpm test` ni en el CI: lo que corre en el CI es su suite
// (`scripts/simulacro-restauracion.test.mjs`), que vigila que el guion no pueda dar un verde falso.
//
// Códigos de salida (la definición completa, con el detalle de cada caso, está en
// `docs/simulacro-restauracion.md`):
//   0 = medido: los dos objetivos se cumplen y la base restaurada quedó bien. La firma del dueño
//       sigue pendiente: el guion no firma.
//   1 = medido pero NO cumple (o la base restaurada quedó mal): el registro sale con el resultado real.
//   2 = uso incorrecto o pre-flight incompleto: no se midió nada.
//
// Variables (los valores reales nunca se commitean):
//   DATABASE_URL                  base de staging (la contraseña viaja por PGPASSWORD, no en la URL)
//   SIMULACRO_HOST_ESPERADO      host de la base de staging: el guion se niega si la URL apunta a otro
//   SIMULACRO_AUTORIZACION        referencia de la autorización escrita del dueño para tocar staging
//   SIMULACRO_EJECUTO             quién ejecuta la corrida (va al registro)
//   SIMULACRO_TABLA_TESTIGO       tabla testigo de la pérdida (por omisión public.registro_actividad)
//   SIMULACRO_COLUMNA_TESTIGO     columna de fecha de la tabla testigo (por omisión creado_en)
//   KESTRA_SMTP_HOST, SOPORTE_CORREO   relay y destinatario del aviso: si son los de ejemplo, el paso
//                                 de correo del simulacro no puede cerrar y el pre-flight se niega
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ejecutarProceso, separarContrasena } from './operaciones.mjs';

export const OBJETIVO_PERDIDA_HORAS = 24;
export const OBJETIVO_TIEMPO_HORAS = 4;

// Las nueve funciones `security definer` del historial de copias y las tres tablas: el invariante que
// el `pg_restore --no-privileges` deshace (misma lista que `private.reaplicar_privilegios_copias()`).
export const FUNCIONES_HISTORIAL = [
  'public.iniciar_respaldo(text)',
  'public.finalizar_respaldo_completado(bigint, bigint, text)',
  'public.finalizar_respaldo_error(bigint, text)',
  'public.iniciar_respaldo_imagenes(text)',
  'public.finalizar_respaldo_imagenes_completado(bigint, bigint, bigint, text)',
  'public.finalizar_respaldo_imagenes_error(bigint, text)',
  'public.iniciar_verificacion_restauracion()',
  'public.finalizar_verificacion_completado(bigint, integer, text)',
  'public.finalizar_verificacion_error(bigint, text)',
];
export const TABLAS_HISTORIAL = ['public.respaldos', 'public.respaldos_imagenes', 'public.verificaciones_restauracion'];

// La verificación semanal tiene que ser reciente: si no, el pre-flight no dice nada del ambiente actual.
export const MAXIMO_ANTIGUEDAD_VERIFICACION_DIAS = 8;

export const USO = [
  'Uso: node scripts/simulacro-restauracion.mjs <iniciar|cerrar> --entorno staging [--estado <archivo.json>]',
  '  iniciar  toma el marcador de la «caída simulada» y deja el pre-flight anotado (antes de restaurar).',
  '  cerrar   mide la pérdida y el tiempo de recuperación sobre la base restaurada y arma el registro.',
  'Sólo en staging y con autorización escrita del dueño (SIMULACRO_AUTORIZACION).',
].join('\n');

export class ErrorSimulacro extends Error {}

const IDENTIFICADOR = /^[a-z_][a-z0-9_]*$/;
// Etiquetas de un host que son de producción: con una de ellas el guion se niega, aunque el operador
// lo haya declarado como esperado.
const ETIQUETAS_PRODUCCION = new Set(['prod', 'prd', 'production', 'produccion']);

export function hostDeUrl(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

// Un host es de producción si alguna de sus etiquetas lo dice (`bd-produccion.midominio.com`).
export function esHostProduccion(host) {
  if (!host) return false;
  return host.toLowerCase().split(/[.\-_]/).filter(Boolean).some((e) => ETIQUETAS_PRODUCCION.has(e));
}

// Motivo por el que el destino no es el de staging, o null si lo es.
export function revisarHost(host, esperado) {
  if (!host) return 'DATABASE_URL no es una URL de conexión válida.';
  if (esperado && host.toLowerCase() !== esperado.trim().toLowerCase()) {
    return `DATABASE_URL apunta a «${host}» y no a «${esperado.trim()}»: confirmá que el destino es el de staging.`;
  }
  if (esHostProduccion(host)) return `DATABASE_URL apunta a «${host}», que parece producción: el simulacro es de staging.`;
  return null;
}

// La tabla y la columna testigo se interpolan en el SQL: sólo se admiten identificadores.
export function revisarIdentificadores(tabla, columna) {
  const partes = tabla.split('.');
  if (partes.length !== 2 || !partes.every((p) => IDENTIFICADOR.test(p))) {
    throw new ErrorSimulacro(`SIMULACRO_TABLA_TESTIGO tiene que ser «esquema.tabla» en minúsculas: recibí «${tabla}».`);
  }
  if (!IDENTIFICADOR.test(columna)) {
    throw new ErrorSimulacro(`SIMULACRO_COLUMNA_TESTIGO tiene que ser un identificador en minúsculas: recibí «${columna}».`);
  }
  return { tabla, columna };
}

export function leerArgumentos(argv) {
  let accion;
  let entorno;
  let rutaEstado;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--entorno' || a === '--estado') {
      const v = argv[i + 1];
      if (!v || v.startsWith('--')) throw new ErrorSimulacro(`Falta el valor de ${a}.\n${USO}`);
      if (a === '--entorno') entorno = v;
      else rutaEstado = v;
      i += 1;
    } else if (a.startsWith('--entorno=')) {
      entorno = a.slice('--entorno='.length);
    } else if (a.startsWith('--estado=')) {
      rutaEstado = a.slice('--estado='.length);
    } else if (a.startsWith('--')) {
      throw new ErrorSimulacro(`La opción «${a}» no existe.\n${USO}`);
    } else if (accion === undefined) {
      accion = a;
    } else {
      throw new ErrorSimulacro(`Sobra el argumento «${a}»: se pide una sola acción.\n${USO}`);
    }
  }
  return { accion, entorno, rutaEstado: rutaEstado ?? 'simulacro-restauracion.json' };
}

const iso = (expresion) => `to_char(${expresion} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;

// Preflight + marcador de la «caída simulada»: todo de una consulta de solo lectura.
export function sqlPreflight({ tabla, columna }) {
  return `-- simulacro:preflight
select json_build_object(
  'base', current_database(),
  'servidor', coalesce(inet_server_addr()::text, ''),
  'verificacion_ultima', (select v.estado from public.verificaciones_restauracion v order by v.id desc limit 1),
  'verificacion_ok', (select json_build_object('finalizado_en', ${iso('v.finalizado_en')}, 'antigua', v.finalizado_en < now() - interval '${MAXIMO_ANTIGUEDAD_VERIFICACION_DIAS} days')
    from public.verificaciones_restauracion v where v.estado = 'completado' order by v.finalizado_en desc, v.id desc limit 1),
  'copia_base', (select json_build_object('id', r.id, 'fecha', ${iso('r.finalizado_en')}, 'ubicacion', r.ubicacion)
    from public.respaldos r where r.estado = 'completado' order by r.finalizado_en desc, r.id desc limit 1),
  'copia_imagenes', (select json_build_object('id', r.id, 'fecha', ${iso('r.finalizado_en')}, 'ubicacion', r.ubicacion)
    from public.respaldos_imagenes r where r.estado = 'completado' order by r.finalizado_en desc, r.id desc limit 1),
  'ultimo_dato_vivo', (select ${iso(`max(t.${columna})`)} from ${tabla} t),
  'caida_simulada', ${iso('clock_timestamp()')}
)::text;
`;
}

// Verificación de la base RESTAURADA: los datos que tiene, el último dato vivo y los privilegios del
// historial de copias (los que el restore con `--no-privileges` deshace).
export function sqlVerificacion({ tabla, columna }) {
  const funciones = FUNCIONES_HISTORIAL.map((f) => `'${f}'`).join(', ');
  const tablas = TABLAS_HISTORIAL.map((t) => `'${t}'`).join(', ');
  const privilegio = (rol, objeto) => `(case when to_regprocedure(${objeto}) is null then null else has_function_privilege('${rol}', ${objeto}, 'EXECUTE') end)`;
  const lectura = (rol, objeto) => `(case when to_regclass(${objeto}) is null then null else has_table_privilege('${rol}', ${objeto}, 'SELECT') end)`;
  return `-- simulacro:verificacion
select json_build_object(
  'fin', ${iso('clock_timestamp()')},
  'organizaciones', (select count(*) from public.organizaciones),
  'ultimo_dato_restaurado', (select ${iso(`max(t.${columna})`)} from ${tabla} t),
  'tipo_testigo', (select pg_typeof(max(t.${columna}))::text from ${tabla} t),
  'funciones', (select json_agg(json_build_object(
      'funcion', f,
      'kestra', ${privilegio('kestra_backups', 'f')},
      'autenticado', ${privilegio('authenticated', 'f')},
      'anon', ${privilegio('anon', 'f')}))
    from unnest(array[${funciones}]) as f),
  'tablas', (select json_agg(json_build_object(
      'tabla', t,
      'autenticado', ${lectura('authenticated', 't')},
      'anon', ${lectura('anon', 't')}))
    from unnest(array[${tablas}]) as t)
)::text;
`;
}

// Lo que el pre-flight tiene que encontrar antes de tocar nada: el ambiente está sano y hay con qué
// restaurar.
export function revisarPreflight(datos) {
  const problemas = [];
  if (!datos.verificacion_ok) {
    problemas.push('no hay ninguna verificación de restauración completada: corré `verificar-restauracion` antes del simulacro.');
  } else if (datos.verificacion_ok.antigua) {
    problemas.push(`la última verificación de restauración completada es de ${datos.verificacion_ok.finalizado_en} (más de ${MAXIMO_ANTIGUEDAD_VERIFICACION_DIAS} días): no sirve de pre-flight.`);
  }
  if (!datos.copia_base) problemas.push('no hay ninguna copia de base completada en public.respaldos.');
  if (!datos.copia_imagenes) problemas.push('no hay ninguna foto de imágenes completada en public.respaldos_imagenes.');
  if (!datos.ultimo_dato_vivo) {
    problemas.push('la tabla testigo no tiene datos: no se puede medir la pérdida (elegí otra con SIMULACRO_TABLA_TESTIGO).');
  }
  return problemas;
}

// El aviso de prueba del simulacro sale por SMTP: con los valores de ejemplo se pierde en silencio
// (`transmitFailed: false`) y el paso de correo del simulacro no cierra.
export function revisarCorreo(env) {
  const problemas = [];
  const host = (env.KESTRA_SMTP_HOST ?? '').trim();
  const correo = (env.SOPORTE_CORREO ?? '').trim();
  if (!host) {
    problemas.push('falta KESTRA_SMTP_HOST: sin relay el aviso de fallo se pierde en silencio.');
  } else if (/example|host\.docker\.internal/i.test(host)) {
    problemas.push(`KESTRA_SMTP_HOST apunta a «${host}»: es un valor de ejemplo, no un relay real.`);
  }
  if (!correo) {
    problemas.push('falta SOPORTE_CORREO: el aviso de prueba del simulacro no tiene destinatario.');
  } else if (/@example\.com$/i.test(correo)) {
    problemas.push(`SOPORTE_CORREO apunta a «${correo}»: es un valor de ejemplo.`);
  }
  return problemas;
}

// La base restaurada tiene que servir datos y tener los privilegios del historial de copias como los
// dejaron las migraciones (el restore los deshace).
export function revisarBaseRestaurada(datos) {
  const problemas = [];
  if (!datos.organizaciones) {
    problemas.push('la base restaurada no tiene organizaciones: el panel no puede responder con datos.');
  }
  if (!datos.ultimo_dato_restaurado) {
    problemas.push('la tabla testigo quedó vacía en la base restaurada: no se puede medir la pérdida.');
  }
  if (datos.tipo_testigo && !/with time zone/.test(datos.tipo_testigo)) {
    problemas.push(`la columna testigo es de tipo «${datos.tipo_testigo}» y tiene que ser timestamptz.`);
  }
  for (const f of datos.funciones ?? []) {
    if (f.kestra === null) problemas.push(`la función ${f.funcion} no existe en la base restaurada.`);
    else if (!f.kestra) problemas.push(`${f.funcion} no la puede ejecutar el rol kestra_backups: falta reaplicar los privilegios.`);
    if (f.autenticado) problemas.push(`${f.funcion} la puede ejecutar un usuario autenticado: el restore dejó los privilegios abiertos.`);
    if (f.anon) problemas.push(`${f.funcion} la puede ejecutar el rol anon: el restore dejó los privilegios abiertos.`);
  }
  for (const t of datos.tablas ?? []) {
    if (t.autenticado === null) problemas.push(`la tabla ${t.tabla} no existe en la base restaurada.`);
    else if (!t.autenticado) problemas.push(`authenticated no puede leer ${t.tabla}: falta reaplicar los privilegios.`);
    if (t.anon) problemas.push(`anon puede leer ${t.tabla}: el restore dejó los privilegios abiertos.`);
  }
  return problemas;
}

// La medición: el tiempo de recuperación (de «se decide restaurar» a «el panel responde con datos»)
// y la pérdida de datos (de la caída simulada al último dato que quedó en la base restaurada).
export function medir({ estado, datos, problemas }) {
  const inicio = Date.parse(estado.inicio_restore);
  const caida = Date.parse(estado.caida_simulada);
  const fin = Date.parse(datos.fin);
  const restaurado = Date.parse(datos.ultimo_dato_restaurado);
  const tiempo = (fin - inicio) / 3_600_000;
  const perdida = (caida - restaurado) / 3_600_000;
  const medible = Number.isFinite(tiempo) && Number.isFinite(perdida) && tiempo >= 0 && perdida >= 0;
  if (!medible) problemas.push('no se pudo medir el tiempo o la pérdida: revisá los instantes del marcador y de la base restaurada.');
  const cumple = problemas.length === 0
    && tiempo <= OBJETIVO_TIEMPO_HORAS
    && perdida <= OBJETIVO_PERDIDA_HORAS;
  return {
    fin: datos.fin,
    tiempo_recuperacion_horas: medible ? Math.round(tiempo * 100) / 100 : null,
    perdida_horas: medible ? Math.round(perdida * 100) / 100 : null,
    cumple,
    problemas,
  };
}

export function formatearDuracion(horas) {
  if (horas === null || !Number.isFinite(horas)) return 'no medible';
  const minutos = Math.round(horas * 60);
  return `${Math.floor(minutos / 60)} h ${String(minutos % 60).padStart(2, '0')} min`;
}

// Las filas del registro de `docs/simulacro-restauracion.md`: el dueño las pega y firma. El guion
// nunca firma ni inventa un problema.
export function filasRegistro({ estado, medicion }) {
  const problemas = medicion.problemas.length ? medicion.problemas.join('; ') : 'ninguno';
  const copia = (c) => (c ? `#${c.id} (${c.fecha}) — ${c.ubicacion}` : '_pendiente_');
  return [
    `| Fecha | ${estado.caida_simulada} |`,
    `| Ejecutó | ${estado.ejecuto || '_pendiente_'} |`,
    `| Copia de base usada (fecha) | ${copia(estado.copia_base)} |`,
    `| Copia de imágenes usada (fecha) | ${copia(estado.copia_imagenes)} |`,
    `| Pérdida de datos medida | ${formatearDuracion(medicion.perdida_horas)} (objetivo ≤ ${OBJETIVO_PERDIDA_HORAS} h) |`,
    `| Tiempo total medido | ${formatearDuracion(medicion.tiempo_recuperacion_horas)} (objetivo ≤ ${OBJETIVO_TIEMPO_HORAS} h) |`,
    `| Problemas encontrados | ${problemas} |`,
    `| Resultado | ${medicion.cumple ? 'cumple los objetivos' : 'NO cumple los objetivos'} (medido por el guion; falta la firma del propietario) |`,
    '| Firma del propietario | _pendiente_ |',
  ];
}

async function consultar(psqlArgs, ejecutar, sql) {
  const r = await ejecutar('psql', psqlArgs, { input: sql });
  if (r.codigo !== 0) {
    throw new ErrorSimulacro(`No pude hablar con la base (psql terminó con código ${r.codigo}): ${(r.error ?? '').trim() || 'sin detalle'}`);
  }
  try {
    return JSON.parse(r.salida.trim());
  } catch {
    throw new ErrorSimulacro(`La base no devolvió el resultado esperado: ${r.salida.trim().slice(0, 200)}`);
  }
}

export async function principal(argv, env = process.env, deps = {}) {
  const out = deps.out ?? ((m) => console.log(m));
  const err = deps.err ?? ((m) => console.error(m));
  const ejecutar = deps.ejecutar ?? ejecutarProceso;
  const { accion, entorno, rutaEstado } = leerArgumentos(argv);

  if (accion !== 'iniciar' && accion !== 'cerrar') throw new ErrorSimulacro(`Falta la acción (iniciar o cerrar).\n${USO}`);
  if (entorno !== 'staging') {
    throw new ErrorSimulacro(
      `Me niego a operar: hace falta \`--entorno staging\` explícito (recibí ${entorno ? `«${entorno}»` : 'nada'}). `
      + 'El simulacro es de staging: en producción la restauración exige aprobación manual (Constitución).',
    );
  }
  const autorizacion = (env.SIMULACRO_AUTORIZACION ?? '').trim();
  if (!autorizacion) {
    throw new ErrorSimulacro('Me niego a operar: falta SIMULACRO_AUTORIZACION (la autorización escrita del dueño para tocar staging).');
  }
  const url = (env.DATABASE_URL ?? '').trim();
  if (!url) throw new ErrorSimulacro('Me niego a operar: falta DATABASE_URL (la base de staging).');
  const problemaHost = revisarHost(hostDeUrl(url), env.SIMULACRO_HOST_ESPERADO);
  if (problemaHost) throw new ErrorSimulacro(`Me niego a operar: ${problemaHost}`);

  let psqlArgs;
  let envPsql;
  try {
    const separadas = separarContrasena(url);
    psqlArgs = [separadas.urlSinContrasena, '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1'];
    envPsql = separadas.env;
  } catch {
    throw new ErrorSimulacro('Me niego a operar: DATABASE_URL no es una URL de conexión válida.');
  }
  const consultarBase = async (sql) => await consultar(psqlArgs, ejecutar, sql);

  if (accion === 'iniciar') {
    const { tabla, columna } = revisarIdentificadores(
      (env.SIMULACRO_TABLA_TESTIGO ?? 'public.registro_actividad').trim(),
      (env.SIMULACRO_COLUMNA_TESTIGO ?? 'creado_en').trim(),
    );
    const datos = await consultarBase(sqlPreflight({ tabla, columna }));
    const problemas = [...revisarPreflight(datos), ...revisarCorreo(env)];
    if (problemas.length) {
      throw new ErrorSimulacro(`El pre-flight no cierra:\n- ${problemas.join('\n- ')}`);
    }
    const estado = {
      version: 1,
      entorno: 'staging',
      host: hostDeUrl(url),
      autorizacion,
      ejecuto: (env.SIMULACRO_EJECUTO ?? '').trim(),
      tabla_testigo: tabla,
      columna_testigo: columna,
      base: datos.base,
      servidor: datos.servidor,
      caida_simulada: datos.caida_simulada,
      ultimo_dato_vivo: datos.ultimo_dato_vivo,
      inicio_restore: datos.caida_simulada,
      copia_base: datos.copia_base,
      copia_imagenes: datos.copia_imagenes,
    };
    await writeFile(rutaEstado, `${JSON.stringify(estado, null, 2)}\n`, 'utf8');
    out(`Base de destino: ${datos.base} (${datos.servidor || 'sin dirección'}) — ${estado.host}`);
    out(`Caída simulada: ${estado.caida_simulada}. Último dato vivo: ${estado.ultimo_dato_vivo}.`);
    out(`Copia de base: #${estado.copia_base.id} (${estado.copia_base.fecha}) — ${estado.copia_base.ubicacion}`);
    out(`Copia de imágenes: #${estado.copia_imagenes.id} (${estado.copia_imagenes.fecha}) — ${estado.copia_imagenes.ubicacion}`);
    out(`Marcador anotado en ${rutaEstado}. Restaurá según el protocolo y volvé con \`cerrar\`.`);
    return 0;
  }

  let estado;
  try {
    estado = JSON.parse(await readFile(rutaEstado, 'utf8'));
  } catch {
    throw new ErrorSimulacro(`No leí el archivo de estado ${rutaEstado}: corré \`iniciar\` antes de \`cerrar\`.`);
  }
  // El archivo de estado se interpola en el SQL: se vuelve a validar aunque lo haya escrito el guion.
  revisarIdentificadores(estado.tabla_testigo, estado.columna_testigo);
  const datos = await consultarBase(sqlVerificacion({ tabla: estado.tabla_testigo, columna: estado.columna_testigo }));
  const problemas = revisarBaseRestaurada(datos);
  const medicion = medir({ estado, datos, problemas });
  estado.medicion = medicion;
  await writeFile(rutaEstado, `${JSON.stringify(estado, null, 2)}\n`, 'utf8');

  out(`Pérdida de datos: ${formatearDuracion(medicion.perdida_horas)} (objetivo ≤ ${OBJETIVO_PERDIDA_HORAS} h).`);
  out(`Tiempo de recuperación: ${formatearDuracion(medicion.tiempo_recuperacion_horas)} (objetivo ≤ ${OBJETIVO_TIEMPO_HORAS} h).`);
  if (medicion.problemas.length) out(`Problemas: ${medicion.problemas.join('; ')}.`);
  out('Filas para el registro de docs/simulacro-restauracion.md:');
  for (const fila of filasRegistro({ estado, medicion })) out(fila);
  if (!medicion.cumple) {
    err('El simulacro NO cierra: los objetivos o la verificación de la base restaurada no se cumplen. El registro sale con el resultado real.');
    return 1;
  }
  out('El simulacro cumple los objetivos. Falta la firma del propietario en el registro: el guion no firma.');
  return 0;
}

// Ejecuta el script como proceso (no cuando se importa).
export function ejecutarComoScript(scriptPath, argv = process.argv.slice(2)) {
  return principal(argv).then(
    (codigo) => { process.exitCode = codigo; },
    (error) => {
      console.error(error instanceof ErrorSimulacro ? error.message : (error instanceof Error ? error.message : String(error)));
      process.exitCode = 2;
    },
  );
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await ejecutarComoScript('scripts/simulacro-restauracion.mjs');
}
