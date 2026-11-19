// MSF-520 (cierre de MSF-457): el simulacro de restauración en staging se ejecuta A MANO en el
// ambiente, con autorización del propietario: no hay código que lo corra, así que lo que lo
// protege son reglas de documentación.
//
//  1. El protocolo tiene que seguir teniendo los pasos que miden los objetivos (FR-011/SC-002):
//     caída simulada (para medir la pérdida), comprobación de que la base restaurada es la de la
//     copia, reaplicación y verificación de los roles/grants (el restore los pierde), prueba del
//     aviso por correo y cierre con staging sano. Si se pierde uno de esos pasos, el simulacro deja
//     de cerrar el criterio y nadie lo nota.
//  2. El restore documentado tiene que ser el que funciona: aplicar los permisos del dump (el
//     panel tiene que poder leer la base restaurada) y ser atómico (si aborta, la base queda como
//     estaba: sin el chequeo del punto 1, un restore abortado se firmaría como simulacro exitoso).
//  3. La documentación no puede contradecirse sobre si el simulacro corrió: un "Done" que no
//     miente (AGENTS.md). Hoy está pendiente; cuando el propietario lo ejecute y firme, los
//     documentos que lo declaran pendiente tienen que cambiar en el mismo cambio.
//
// Las reglas se vigilan sobre el texto de los documentos: son la fuente de verdad del
// procedimiento (el prototipo/documento manda).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const leer = (ruta) => readFileSync(new URL(`../../${ruta}`, import.meta.url), 'utf8')

const simulacro = leer('docs/simulacro-restauracion.md')
// Los pasos se buscan sólo dentro de la sección «Protocolo» (hasta «Registro del simulacro»).
const protocolo = simulacro.split('## Protocolo')[1]?.split('## Registro del simulacro')[0] ?? ''
const copias = leer('docs/copias-y-restauracion.md')
const runbook = leer('docs/tecnico/runbooks/db-restore.md')
const indice = leer('docs/README.md')
const roadmap = leer('docs/roadmap-template.md')
const operar = leer('docs/operar-sistema.md')

// Los bloques de código de la guía (los permisos y la atomicidad se comprueban sobre el comando,
// no sobre la prosa que lo explica).
const bloquesBash = (texto) => [...texto.matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1])
const comandoRestore = bloquesBash(copias).find((b) => b.includes('pg_restore')) ?? ''

// La prosa se compara sin saltos de línea: el «wrapping» del markdown no es parte del contrato.
const plano = (texto) => texto.replace(/\s+/g, ' ')

test('el protocolo del simulacro tiene los pasos que miden los objetivos', () => {
  const pasos = [
    ['caída simulada (mide la pérdida)', 'caida_simulada'],
    ['comprobación de que la base restaurada es la de la copia', 'ultimo_dato_restaurado'],
    ['reaplicación de privilegios tras el restore', 'private.reaplicar_privilegios_copias()'],
    ['verificación de roles/grants', 'has_function_privilege'],
    ['prueba del aviso por correo', 'SOPORTE_CORREO'],
    ['cierre con staging sano (copia fresca)', 'respaldo-postgres'],
  ]
  for (const [que, marca] of pasos) {
    assert.ok(protocolo.includes(marca), `la sección Protocolo de docs/simulacro-restauracion.md no tiene el paso de ${que} (falta "${marca}")`)
  }
})

// Fija el CONTRATO DOCUMENTAL de la guía (que el texto lo pida y en el orden correcto), no el comportamiento: nada en el
// repositorio ejecuta el simulacro ni puede comprobar que quien lo corre haga la consulta.
test('contrato de la guía: el paso 1 manda confirmar el host de staging ANTES de restaurar', () => {
  const host = protocolo.indexOf('inet_server_addr()')
  const restaurar = protocolo.indexOf('Restaurar la base')
  assert.ok(host >= 0, 'el protocolo no pide confirmar el host de destino (falta "inet_server_addr()")')
  assert.ok(restaurar >= 0, 'el protocolo no tiene el paso «Restaurar la base»')
  assert.ok(host < restaurar, 'la confirmación del host tiene que ir antes del paso de restaurar')
  assert.ok(protocolo.indexOf('1. ') < host && host < protocolo.indexOf('2. '), 'la confirmación del host tiene que estar dentro del paso 1')
})

test('el protocolo declara los dos objetivos del criterio (pérdida ≤ 24 h y tiempo ≤ 4 h)', () => {
  assert.match(simulacro, /≤\s*24\s*h/, 'no declara el objetivo de pérdida máxima de datos')
  assert.match(simulacro, /≤\s*4\s*h/, 'no declara el objetivo de tiempo de recuperación')
})

test('la guía de restauración y el runbook incluyen el paso de reaplicar privilegios', () => {
  for (const [nombre, texto] of [
    ['docs/copias-y-restauracion.md', copias],
    ['docs/tecnico/runbooks/db-restore.md', runbook],
  ]) {
    assert.ok(
      texto.includes('private.reaplicar_privilegios_copias()'),
      `${nombre} no manda reaplicar los privilegios después del restore (con --no-privileges las funciones security definer quedan ejecutables por PUBLIC)`,
    )
  }
})

// El restore tiene que dejar la base como la copia: el dump lleva los permisos (pg_dump los
// incluye salvo --no-acl) y en este proyecto son explícitos por tabla (auto_expose_new_tables =
// false), así que perderlos deja al panel sin poder leer la base restaurada.
test('el restore documentado aplica los permisos del dump', () => {
  assert.ok(comandoRestore.includes('pg_restore'), 'la guía de copias no tiene el comando de restore')
  assert.ok(
    !comandoRestore.includes('--no-privileges'),
    'el restore no puede usar --no-privileges: el dump lleva los permisos (pg_dump --format=custom los incluye) y en este proyecto son explícitos por tabla (auto_expose_new_tables = false), así que el panel no leería la base restaurada',
  )
  assert.ok(
    copias.includes('auto_expose_new_tables'),
    'la guía tiene que explicar por qué el restore aplica los permisos del dump (auto_expose_new_tables = false)',
  )
})

test('el restore es atómico y la guía dice qué pasa si aborta', () => {
  assert.ok(comandoRestore.includes('--single-transaction'), 'el restore tiene que ser atómico (--single-transaction)')
  assert.ok(
    copias.includes('--exit-on-error'),
    'la guía tiene que decir que --single-transaction implica --exit-on-error: ante un error la base queda como estaba',
  )
  assert.ok(
    /queda como estaba/.test(plano(copias)) && /queda como estaba/.test(plano(runbook)),
    'la guía y el runbook tienen que avisar que un restore abortado deja la base como estaba',
  )
})

test('el simulacro comprueba que la base restaurada es la de la copia', () => {
  assert.ok(
    protocolo.includes('ultimo_dato_restaurado'),
    'el protocolo no compara el último dato de la base restaurada (sin esto, un restore abortado se firmaría como simulacro exitoso con pérdida 0)',
  )
  assert.ok(
    protocolo.includes('iniciado_en'),
    'el protocolo no anota el instante de la copia contra el que comparar el dato restaurado',
  )
  assert.ok(
    /se detiene/.test(plano(protocolo)) && /no se mide ni se firma/.test(plano(protocolo)),
    'el protocolo no dice que, si el restore no se aplicó, el simulacro se detiene sin medir ni firmar',
  )
  assert.ok(
    protocolo.includes('pg_restore'),
    'el protocolo no dice que la prueba principal de que el restore se aplicó es el código de salida de pg_restore',
  )
})

test('el procedimiento aplica las migraciones pendientes sobre la base restaurada', () => {
  assert.ok(
    bloquesBash(copias).some((b) => b.includes('supabase db push')),
    'la guía no manda aplicar las migraciones pendientes: la copia es de un día anterior y el panel de hoy puede usar columnas o RPC que la base restaurada no tiene',
  )
})

test('la verificación comprueba que el panel puede leer, no sólo el historial de copias', () => {
  assert.ok(copias.includes('has_schema_privilege'), 'la guía no verifica el USAGE de authenticated sobre private')
  assert.ok(copias.includes('dominio.empresas'), 'la guía no verifica la lectura de authenticated sobre dominio.empresas')
  assert.ok(copias.includes('public.organizaciones'), 'la guía no verifica la lectura de authenticated sobre public.organizaciones')
  assert.ok(protocolo.includes('dominio.empresas'), 'el protocolo no menciona la lectura que el panel necesita sobre dominio.empresas')
})

test('el registro del simulacro tiene los campos para medir y para firmar', () => {
  const campos = [
    'Fecha',
    'Ejecutó',
    'Copia de base usada',
    'Copia de imágenes usada',
    'Pérdida de datos medida',
    'Tiempo total medido',
    'Problemas encontrados',
    'Resultado',
    'Firma del propietario',
  ]
  for (const campo of campos) {
    assert.ok(simulacro.includes(campo), `docs/simulacro-restauracion.md no tiene el campo de registro "${campo}"`)
  }
})

// El estado sale del propio documento: pendiente mientras la firma está en `_pendiente_`.
const firma = simulacro.match(/\|\s*Firma del propietario\s*\|\s*([^|]+)\|/)?.[1]?.trim() ?? ''
const estado = firma && !/^_?pendiente/i.test(firma) ? 'firmado' : 'pendiente'

test('el estado y la firma del propio documento no se contradicen', () => {
  const dicePendiente = /Pendiente de ejecución/i.test(simulacro)
  if (estado === 'firmado') {
    assert.ok(
      !dicePendiente,
      'docs/simulacro-restauracion.md tiene la firma del propietario cargada pero el estado dice que sigue pendiente',
    )
  } else {
    assert.ok(
      dicePendiente,
      'docs/simulacro-restauracion.md tiene la firma del propietario en _pendiente_ pero el estado no dice que está pendiente',
    )
  }
})

test('los documentos que declaran el estado del simulacro no se contradicen entre sí', () => {
  // Cada documento con su marca de "pendiente": si el simulacro queda firmado, tienen que
  // cambiar en el mismo cambio (si no, la documentación miente sobre el estado real).
  const marcas = [
    ['docs/README.md', indice, /no ejecutado/],
    ['docs/roadmap-template.md', roadmap, /simulacro pendiente/],
    ['docs/operar-sistema.md', operar, /pendiente de ejecución en staging/],
  ]
  for (const [nombre, texto, marca] of marcas) {
    if (estado === 'firmado') {
      assert.ok(
        !marca.test(texto),
        `${nombre} sigue diciendo "${marca.source}" pero el simulacro ya está firmado: actualizalo junto con docs/simulacro-restauracion.md`,
      )
    } else {
      assert.ok(
        marca.test(texto),
        `${nombre} no dice que el simulacro está pendiente ("${marca.source}"): el estado real es pendiente y la documentación tiene que decirlo`,
      )
    }
  }
})
