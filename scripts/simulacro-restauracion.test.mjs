// MSF-520 (FR-011, SC-002): el guion del simulacro de restauración no puede dar un verde falso.
//
// Se corre el guion real (scripts/simulacro-restauracion.mjs) contra una base imitada: lo que
// devuelve `psql` lo decide la prueba. Sin base, sin red y sin tocar ningún ambiente: lo que se
// prueba es que el guion mide lo que tiene que medir, se niega cuando tiene que negarse y NO
// firma un simulacro que nadie autorizó ni autorizó él.
import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  OBJETIVO_PERDIDA_HORAS,
  OBJETIVO_TIEMPO_HORAS,
  principal,
  revisarHost,
  revisarIdentificadores,
} from './simulacro-restauracion.mjs'

const HORA = 3_600_000
const ISO = (instante) => new Date(instante).toISOString().replace('.000Z', 'Z')
const AHORA = Date.parse('2026-11-21T12:00:00Z')

/** Datos que devuelve la base en el pre-flight (antes de restaurar). */
const preflight = (extra = {}) => ({
  base: 'postgres',
  servidor: '10.0.0.9',
  verificacion_ultima: 'completado',
  verificacion_ok: { finalizado_en: ISO(AHORA - 2 * 24 * HORA), antigua: false },
  copia_base: { id: 12, fecha: ISO(AHORA - 24 * HORA), ubicacion: 'respaldos:/respaldos/base/20261120-030000-12.dump' },
  copia_imagenes: { id: 7, fecha: ISO(AHORA - 24 * HORA), ubicacion: 'respaldos:/respaldos/imagenes/20261120-031500' },
  ultimo_dato_vivo: ISO(AHORA - 3 * HORA),
  caida_simulada: ISO(AHORA),
  ...extra,
})

/** Datos que devuelve la base restaurada (después de restaurar y de levantar la app). */
const verificacion = (extra = {}) => ({
  fin: ISO(AHORA + HORA),
  organizaciones: 3,
  ultimo_dato_restaurado: ISO(AHORA - 4 * HORA),
  tipo_testigo: 'timestamp with time zone',
  funciones: [
    { funcion: 'public.iniciar_respaldo(text)', kestra: true, autenticado: false, anon: false },
    { funcion: 'public.finalizar_respaldo_completado(bigint, bigint, text)', kestra: true, autenticado: false, anon: false },
  ],
  tablas: [
    { tabla: 'public.respaldos', autenticado: true, anon: false },
    { tabla: 'public.respaldos_imagenes', autenticado: true, anon: false },
    { tabla: 'public.verificaciones_restauracion', autenticado: true, anon: false },
  ],
  ...extra,
})

/** `psql` imitado: decide la respuesta por el marcador del SQL. */
const baseFalsa = (datos) => async (comando, args, { input }) => {
  if (input.includes('-- simulacro:preflight')) return { codigo: 0, salida: JSON.stringify(datos.preflight), error: '' }
  if (input.includes('-- simulacro:verificacion')) return { codigo: 0, salida: JSON.stringify(datos.verificacion), error: '' }
  return { codigo: 1, salida: '', error: 'SQL que la prueba no conoce' }
}

const entorno = (extra = {}) => ({
  DATABASE_URL: 'postgres://postgres:secreta@bd-stg.midominio.com:5432/postgres',
  SIMULACRO_HOST_ESPERADO: 'bd-stg.midominio.com',
  SIMULACRO_AUTORIZACION: 'MSF-520 · Nicolás · 2026-11-21',
  SIMULACRO_EJECUTO: 'nicolas',
  KESTRA_SMTP_HOST: 'smtp.midominio.com',
  SOPORTE_CORREO: 'soporte@midominio.com',
  ...extra,
})

/** Corre el guion y devuelve su código de salida y lo que dijo. */
const correr = async (argv, env, datos) => {
  const salida = []
  const errores = []
  const codigo = await principal(argv, env, {
    ejecutar: baseFalsa(datos),
    out: (m) => salida.push(m),
    err: (m) => errores.push(m),
  }).catch((error) => {
    errores.push(error.message)
    return 2
  })
  return { codigo, salida: salida.join('\n'), errores: errores.join('\n') }
}

const rutaEstado = async () => path.join(await mkdtemp(path.join(tmpdir(), 'simulacro-')), 'estado.json')

// --- el guion se niega a correr sin autorización o fuera de staging ---

test('sin --entorno staging el guion no corre', async () => {
  const r = await correr(['iniciar'], entorno(), { preflight: preflight(), verificacion: verificacion() })
  assert.equal(r.codigo, 2)
  assert.match(r.errores, /--entorno staging/)
})

test('con --entorno produccion el guion no corre (el simulacro es de staging)', async () => {
  const r = await correr(['iniciar', '--entorno', 'produccion'], entorno(), { preflight: preflight(), verificacion: verificacion() })
  assert.equal(r.codigo, 2)
  assert.match(r.errores, /--entorno staging/)
})

test('sin autorización del dueño el guion no corre', async () => {
  const env = entorno()
  delete env.SIMULACRO_AUTORIZACION
  const r = await correr(['iniciar', '--entorno', 'staging'], env, { preflight: preflight(), verificacion: verificacion() })
  assert.equal(r.codigo, 2)
  assert.match(r.errores, /SIMULACRO_AUTORIZACION/)
})

test('sin DATABASE_URL el guion no corre', async () => {
  const env = entorno()
  delete env.DATABASE_URL
  const r = await correr(['iniciar', '--entorno', 'staging'], env, { preflight: preflight(), verificacion: verificacion() })
  assert.equal(r.codigo, 2)
  assert.match(r.errores, /DATABASE_URL/)
})

test('una base que no es la de staging no se toca', async () => {
  const env = entorno({ DATABASE_URL: 'postgres://postgres:secreta@bd-otra.midominio.com:5432/postgres' })
  const r = await correr(['iniciar', '--entorno', 'staging'], env, { preflight: preflight(), verificacion: verificacion() })
  assert.equal(r.codigo, 2)
  assert.match(r.errores, /no a «bd-stg\.midominio\.com»/)
})

test('una base que parece de producción no se toca, aunque sea la esperada', () => {
  assert.ok(revisarHost('bd-produccion.midominio.com', 'bd-produccion.midominio.com')?.includes('producción'))
  assert.equal(revisarHost('bd-stg.midominio.com', 'bd-stg.midominio.com'), null)
})

// --- el pre-flight: sin ambiente sano no se empieza el simulacro ---

test('sin verificación de restauración completada el pre-flight no cierra', async () => {
  const r = await correr(['iniciar', '--entorno', 'staging'], entorno(), {
    preflight: preflight({ verificacion_ok: null }),
    verificacion: verificacion(),
  })
  assert.equal(r.codigo, 2)
  assert.match(r.errores, /verificación de restauración completada/)
})

test('con una verificación vieja el pre-flight no cierra', async () => {
  const r = await correr(['iniciar', '--entorno', 'staging'], entorno(), {
    preflight: preflight({ verificacion_ok: { finalizado_en: ISO(AHORA - 30 * 24 * HORA), antigua: true } }),
    verificacion: verificacion(),
  })
  assert.equal(r.codigo, 2)
  assert.match(r.errores, /más de 8 días/)
})

test('sin copia de base o de imágenes el pre-flight no cierra', async () => {
  const r = await correr(['iniciar', '--entorno', 'staging'], entorno(), {
    preflight: preflight({ copia_base: null, copia_imagenes: null }),
    verificacion: verificacion(),
  })
  assert.equal(r.codigo, 2)
  assert.match(r.errores, /copia de base completada/)
  assert.match(r.errores, /foto de imágenes completada/)
})

test('con la tabla testigo vacía el pre-flight no cierra (la pérdida no se puede medir)', async () => {
  const r = await correr(['iniciar', '--entorno', 'staging'], entorno(), {
    preflight: preflight({ ultimo_dato_vivo: null }),
    verificacion: verificacion(),
  })
  assert.equal(r.codigo, 2)
  assert.match(r.errores, /tabla testigo no tiene datos/)
})

test('con el SMTP de ejemplo el pre-flight no cierra (el aviso se pierde en silencio)', async () => {
  const r = await correr(['iniciar', '--entorno', 'staging'], entorno({
    KESTRA_SMTP_HOST: 'smtp.example.com',
    SOPORTE_CORREO: 'soporte@example.com',
  }), { preflight: preflight(), verificacion: verificacion() })
  assert.equal(r.codigo, 2)
  assert.match(r.errores, /valor de ejemplo/)
})

test('la tabla testigo se valida antes de meterse en el SQL', () => {
  assert.throws(() => revisarIdentificadores('public.registro_actividad; drop table public.organizaciones', 'creado_en'))
  assert.throws(() => revisarIdentificadores('public.registro_actividad', 'creado_en; --'))
  assert.deepEqual(revisarIdentificadores('public.registro_actividad', 'creado_en'), {
    tabla: 'public.registro_actividad',
    columna: 'creado_en',
  })
})

// --- el marcador de la «caída simulada» ---

test('iniciar anota el marcador y las copias en el archivo de estado', async () => {
  const estado = await rutaEstado()
  const r = await correr(['iniciar', '--entorno', 'staging', '--estado', estado], entorno(), {
    preflight: preflight(),
    verificacion: verificacion(),
  })
  assert.equal(r.codigo, 0, r.errores)
  const guardado = JSON.parse(await readFile(estado, 'utf8'))
  assert.equal(guardado.caida_simulada, ISO(AHORA))
  assert.equal(guardado.ultimo_dato_vivo, ISO(AHORA - 3 * HORA))
  assert.equal(guardado.inicio_restore, ISO(AHORA))
  assert.equal(guardado.copia_base.id, 12)
  assert.equal(guardado.copia_imagenes.id, 7)
  assert.equal(guardado.autorizacion, 'MSF-520 · Nicolás · 2026-11-21')
})

// --- la medición: el guion dice si los objetivos se cumplen ---

/** Corre `iniciar` y después `cerrar` con los datos de la base restaurada. */
const medir = async (datosVerificacion) => {
  const estado = await rutaEstado()
  const datos = { preflight: preflight(), verificacion: datosVerificacion }
  await correr(['iniciar', '--entorno', 'staging', '--estado', estado], entorno(), datos)
  const r = await correr(['cerrar', '--entorno', 'staging', '--estado', estado], entorno(), datos)
  return { ...r, estado: JSON.parse(await readFile(estado, 'utf8')) }
}

test('con la pérdida y el tiempo dentro de los objetivos, la corrida cierra en verde', async () => {
  const r = await medir(verificacion())
  assert.equal(r.codigo, 0, r.errores)
  assert.match(r.salida, /Pérdida de datos: 4 h 00 min \(objetivo ≤ 24 h\)/)
  assert.match(r.salida, /Tiempo de recuperación: 1 h 00 min \(objetivo ≤ 4 h\)/)
  assert.equal(r.estado.medicion.cumple, true)
})

test('con más de 4 h de recuperación la corrida NO cierra en verde', async () => {
  const r = await medir(verificacion({ fin: ISO(AHORA + 5 * HORA) }))
  assert.equal(r.codigo, 1)
  assert.match(r.salida, /NO cumple los objetivos/)
})

test('con más de 24 h de pérdida la corrida NO cierra en verde', async () => {
  const r = await medir(verificacion({ ultimo_dato_restaurado: ISO(AHORA - 30 * HORA) }))
  assert.equal(r.codigo, 1)
  assert.match(r.salida, /Pérdida de datos: 30 h 00 min/)
  assert.match(r.salida, /NO cumple los objetivos/)
})

test('con los privilegios abiertos (anon puede ejecutar) la corrida NO cierra en verde', async () => {
  const r = await medir(verificacion({
    funciones: [{ funcion: 'public.iniciar_respaldo(text)', kestra: true, autenticado: false, anon: true }],
  }))
  assert.equal(r.codigo, 1)
  assert.match(r.salida, /restore dejó los privilegios abiertos/)
})

test('sin lectura para authenticated la corrida NO cierra en verde', async () => {
  const r = await medir(verificacion({
    tablas: [{ tabla: 'public.respaldos', autenticado: false, anon: false }],
  }))
  assert.equal(r.codigo, 1)
  assert.match(r.salida, /falta reaplicar los privilegios/)
})

test('sin organizaciones en la base restaurada la corrida NO cierra en verde', async () => {
  const r = await medir(verificacion({ organizaciones: 0 }))
  assert.equal(r.codigo, 1)
  assert.match(r.salida, /el panel no puede responder con datos/)
})

test('con la tabla testigo vacía en la base restaurada la pérdida no se puede medir', async () => {
  const r = await medir(verificacion({ ultimo_dato_restaurado: null }))
  assert.equal(r.codigo, 1)
  assert.match(r.salida, /no se puede medir la pérdida/)
})

// --- el guion no firma ---

test('el guion nunca firma: la fila de firma queda para el dueño', async () => {
  const r = await medir(verificacion())
  assert.equal(r.codigo, 0, r.errores)
  assert.match(r.salida, /\| Firma del propietario \| _pendiente_ \|/)
  assert.match(r.salida, /falta la firma del propietario/)
})

test('el registro que arma el guion tiene los campos del registro del documento', async () => {
  const r = await medir(verificacion())
  for (const campo of [
    'Fecha',
    'Ejecutó',
    'Copia de base usada (fecha)',
    'Copia de imágenes usada (fecha)',
    'Pérdida de datos medida',
    'Tiempo total medido',
    'Problemas encontrados',
    'Resultado',
    'Firma del propietario',
  ]) {
    assert.match(r.salida, new RegExp(`\\| ${campo.replace(/[()]/g, '\\$&')} \\|`), `la salida no tiene el campo «${campo}»`)
  }
})

test('sin el archivo de estado, `cerrar` no mide nada', async () => {
  const estado = path.join(await mkdtemp(path.join(tmpdir(), 'simulacro-')), 'no-existe.json')
  const r = await correr(['cerrar', '--entorno', 'staging', '--estado', estado], entorno(), {
    preflight: preflight(),
    verificacion: verificacion(),
  })
  assert.equal(r.codigo, 2)
  assert.match(r.errores, /corré `iniciar` antes de `cerrar`/)
})

// --- los códigos de salida y los objetivos tienen un solo dueño ---

test('los códigos de salida tienen un solo dueño: la tabla del registro', async () => {
  const pagina = await readFile(new URL('../docs/simulacro-restauracion.md', import.meta.url), 'utf8')
  assert.deepEqual([...pagina.matchAll(/^\| `(\d)` \|/gm)].map((m) => m[1]), ['0', '1', '2'])

  const guion = await readFile(new URL('./simulacro-restauracion.mjs', import.meta.url), 'utf8')
  assert.deepEqual([...guion.matchAll(/^\/\/   (\d) =/gm)].map((m) => m[1]), ['0', '1', '2'])
})

test('los objetivos del guion son los del documento (24 h y 4 h)', async () => {
  const pagina = await readFile(new URL('../docs/simulacro-restauracion.md', import.meta.url), 'utf8')
  assert.match(pagina, new RegExp(`≤\\s*${OBJETIVO_PERDIDA_HORAS}\\s*h`))
  assert.match(pagina, new RegExp(`≤\\s*${OBJETIVO_TIEMPO_HORAS}\\s*h`))
})
