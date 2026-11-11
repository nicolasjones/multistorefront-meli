// Pruebas de `api-v1` (F-API-01, FR-003, FR-004, FR-007, FR-009, SC-002) con
// las dependencias simuladas: 401 sin clave o con clave inválida/revocada/
// vencida, 403 por alcance, 429 con `Retry-After`, 400 por cursor inválido,
// lectura paginada de la organización de la clave, cabeceras de deprecación y
// auditoría de toda llamada (incluidas las rechazadas). Corre con
// `node --test` (`pnpm test:edge:api-v1`); el handler no importa nada de Deno
// ni de Supabase.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { manejar, type Deps, type Lectura, type Limite, type Validacion } from './handler.ts'

const CONTRATO = {
  openapi: '3.1.0',
  info: { title: 'API pública de la plataforma', version: 'v1' },
  paths: {
    '/v1/productos': {},
    '/v1/stock': {},
    '/v1/precios': {},
    '/v1/ventas': {},
    '/v1/openapi.json': {},
  },
  'x-versions-retiradas': {},
}

const CLAVE = 'msf_aaaaaaaa_secreto'

type Opciones = {
  validacion?: Partial<Validacion> | null
  limite?: Partial<Limite>
  lectura?: Partial<Lectura>
  errorLectura?: { message: string; code?: string } | null
  errorAuditoria?: { message: string; code?: string } | null
  documento?: unknown
}

function montar(opciones: Opciones = {}) {
  const llamadas = {
    auditoria: [] as unknown[],
    lecturas: [] as unknown[],
  }

  const deps: Deps = {
    openapi: async () => opciones.documento ?? CONTRATO,
    validarClave: async (token) => {
      // Como en la base: un token que no tiene el formato no resuelve clave.
      if (!/^msf_[0-9a-f]{8}_/.test(token)) {
        return {
          data: [{ valida: false, clave_id: null, organizacion_id: null, alcances: null, limite_por_minuto: null, motivo: 'token_invalido' }],
          error: null,
        }
      }
      return {
        data: [
          {
            valida: true,
            clave_id: 'clave-1',
            organizacion_id: 'org-1',
            alcances: ['productos', 'stock', 'precios', 'ventas'],
            limite_por_minuto: 60,
            motivo: null,
            ...(opciones.validacion ?? {}),
          },
        ],
        error: null,
      }
    },
    controlarLimite: async () => ({
      data: [{ permitido: true, reintentar_en_seg: 0, restantes: 59, ...(opciones.limite ?? {}) }],
      error: null,
    }),
    registrarLlamada: async (llamada) => {
      llamadas.auditoria.push(llamada)
      return { data: null, error: opciones.errorAuditoria ?? null }
    },
    leer: async (...args) => {
      llamadas.lecturas.push(args)
      return {
        data: [{ filas: [{ id: 'p-1', nombre: 'Producto' }], siguiente_cursor: null, ...(opciones.lectura ?? {}) }],
        error: opciones.errorLectura ?? null,
      }
    },
  }

  return { deps, llamadas }
}

const pedir = (ruta: string, token: string | null = CLAVE, metodo = 'GET') =>
  new Request(`https://ejemplo.com/api-v1${ruta}`, {
    method: metodo,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })

const pedirConApiKey = (ruta: string, token: string) =>
  new Request(`https://ejemplo.com/api-v1${ruta}`, {
    headers: { Authorization: 'Bearer clave-anonima', 'X-API-Key': token },
  })

describe('api-v1', () => {
  it('sin cabecera Authorization responde 401 token_ausente y audita la llamada', async () => {
    const { deps, llamadas } = montar()
    const res = await manejar(pedir('/v1/productos', null), deps)
    assert.equal(res.status, 401)
    assert.equal((await res.json() as { error: { codigo: string } }).error.codigo, 'token_ausente')
    assert.equal(llamadas.auditoria.length, 1)
    assert.equal((llamadas.auditoria[0] as { estado_http: number }).estado_http, 401)
  })

  it('un token mal formado responde 401 token_invalido', async () => {
    const { deps } = montar()
    const res = await manejar(pedir('/v1/productos', 'no-es-un-token'), deps)
    assert.equal(res.status, 401)
    assert.equal((await res.json() as { error: { codigo: string } }).error.codigo, 'token_invalido')
  })

  it('una clave revocada o vencida responde 401 con su motivo', async () => {
    const revocada = montar({ validacion: { valida: false, motivo: 'clave_revocada' } })
    const resRevocada = await manejar(pedir('/v1/productos'), revocada.deps)
    assert.equal(resRevocada.status, 401)
    assert.equal((await resRevocada.json() as { error: { codigo: string } }).error.codigo, 'clave_revocada')

    const vencida = montar({ validacion: { valida: false, motivo: 'clave_vencida' } })
    const resVencida = await manejar(pedir('/v1/productos'), vencida.deps)
    assert.equal(resVencida.status, 401)
    assert.equal((await resVencida.json() as { error: { codigo: string } }).error.codigo, 'clave_vencida')
  })

  it('una clave sin el alcance de la ruta responde 403', async () => {
    const { deps } = montar({ validacion: { alcances: ['stock'] } })
    const res = await manejar(pedir('/v1/productos'), deps)
    assert.equal(res.status, 403)
    assert.equal((await res.json() as { error: { codigo: string } }).error.codigo, 'alcance_insuficiente')
  })

  it('al superar el límite responde 429 con Retry-After y audita el rechazo', async () => {
    const { deps, llamadas } = montar({ limite: { permitido: false, reintentar_en_seg: 30, restantes: 0 } })
    const res = await manejar(pedir('/v1/stock'), deps)
    assert.equal(res.status, 429)
    assert.equal(res.headers.get('Retry-After'), '30')
    assert.equal((await res.json() as { error: { codigo: string } }).error.codigo, 'limite_excedido')
    assert.equal((llamadas.auditoria[0] as { estado_http: number }).estado_http, 429)
  })

  it('lee la organización de la clave y devuelve la página con su cursor', async () => {
    const { deps, llamadas } = montar({ lectura: { siguiente_cursor: 'cursor-2' } })
    const res = await manejar(pedir('/v1/ventas'), deps)
    assert.equal(res.status, 200)
    const cuerpo = await res.json() as { datos: unknown[]; siguiente_cursor: string | null }
    assert.equal(cuerpo.datos.length, 1)
    assert.equal(cuerpo.siguiente_cursor, 'cursor-2')
    // La organización sale de la clave, no de un parámetro del llamador.
    assert.equal((llamadas.lecturas[0] as unknown[])[1], 'org-1')
    assert.equal((llamadas.lecturas[0] as unknown[])[0], 'ventas')
  })

  it('el cursor y los filtros llegan a la lectura', async () => {
    const { deps, llamadas } = montar()
    await manejar(pedir('/v1/productos?cursor=c1&limite=10&actualizado_desde=2027-01-05T00:00:00Z'), deps)
    const [recurso, organizacion, cursor, limite, actualizado] = llamadas.lecturas[0] as unknown[]
    assert.equal(recurso, 'productos')
    assert.equal(organizacion, 'org-1')
    assert.equal(cursor, 'c1')
    assert.equal(limite, 10)
    assert.equal(actualizado, '2027-01-05T00:00:00Z')
  })

  it('un cursor que el SQL rechaza responde 400 cursor_invalido', async () => {
    const { deps } = montar({ errorLectura: { message: 'CURSOR_INVALIDO', code: '22023' } })
    const res = await manejar(pedir('/v1/productos?cursor=basura'), deps)
    assert.equal(res.status, 400)
    assert.equal((await res.json() as { error: { codigo: string } }).error.codigo, 'cursor_invalido')
  })

  it('un cursor con partes inválidas (22P02) también responde 400 cursor_invalido', async () => {
    const { deps } = montar({
      errorLectura: { message: 'invalid input syntax for type uuid: "def"', code: '22P02' },
    })
    const res = await manejar(pedir('/v1/productos?cursor=YWJjfGRlZg'), deps)
    assert.equal(res.status, 400)
    assert.equal((await res.json() as { error: { codigo: string } }).error.codigo, 'cursor_invalido')
  })

  it('la clave de API también se acepta en X-API-Key (gateway con JWT anónimo)', async () => {
    const { deps, llamadas } = montar()
    const res = await manejar(pedirConApiKey('/v1/productos', CLAVE), deps)
    assert.equal(res.status, 200)
    assert.equal((llamadas.lecturas[0] as unknown[])[1], 'org-1')
  })

  it('un límite o una fecha inválidos responden 400 parametro_invalido', async () => {
    const { deps } = montar()
    const limite = await manejar(pedir('/v1/productos?limite=500'), deps)
    assert.equal(limite.status, 400)
    assert.equal((await limite.json() as { error: { codigo: string } }).error.codigo, 'parametro_invalido')

    const fecha = await manejar(pedir('/v1/productos?actualizado_desde=ayer'), deps)
    assert.equal(fecha.status, 400)
    assert.equal((await fecha.json() as { error: { codigo: string } }).error.codigo, 'parametro_invalido')
  })

  it('actualizado_desde exige ISO-8601 con zona', async () => {
    const { deps, llamadas } = montar()
    // «01/02/2027» y «2027» los acepta un Date.parse laxo, pero el filtro
    // caería en un instante distinto del que el cliente cree.
    for (const valor of ['01/02/2027', '2027', '2027-01-05']) {
      const res = await manejar(pedir(`/v1/productos?actualizado_desde=${valor}`), deps)
      assert.equal(res.status, 400, `«${valor}» no es ISO-8601 con zona`)
      assert.equal((await res.json() as { error: { codigo: string } }).error.codigo, 'parametro_invalido')
    }
    assert.equal(llamadas.lecturas.length, 0, 'una fecha inválida no llega a la lectura')

    const conZona = await manejar(pedir('/v1/productos?actualizado_desde=2027-01-05T00:00:00-03:00'), deps)
    assert.equal(conZona.status, 200)
    assert.equal((llamadas.lecturas[0] as unknown[])[4], '2027-01-05T00:00:00-03:00')
  })

  it('una ruta inexistente responde 404 y un método de escritura 405', async () => {
    const { deps } = montar()
    const inexistente = await manejar(pedir('/v1/facturacion'), deps)
    assert.equal(inexistente.status, 404)

    const escritura = await manejar(pedir('/v1/productos', CLAVE, 'POST'), deps)
    assert.equal(escritura.status, 405)
  })

  it('el contrato se sirve sin clave', async () => {
    const { deps } = montar()
    const res = await manejar(pedir('/v1/openapi.json', null), deps)
    assert.equal(res.status, 200)
    const cuerpo = await res.json() as { openapi: string }
    assert.equal(cuerpo.openapi, '3.1.0')
  })

  it('una versión retirada responde con Deprecation y Sunset (D-4)', async () => {
    const documento = {
      ...CONTRATO,
      'x-versions-retiradas': {
        v1: { deprecacion: 'Wed, 30 Jun 2027 00:00:00 GMT', sunset: 'Wed, 30 Dec 2027 00:00:00 GMT' },
      },
    }
    const { deps } = montar({ documento })
    const res = await manejar(pedir('/v1/productos'), deps)
    assert.equal(res.headers.get('Deprecation'), 'Wed, 30 Jun 2027 00:00:00 GMT')
    assert.equal(res.headers.get('Sunset'), 'Wed, 30 Dec 2027 00:00:00 GMT')
  })

  it('una ruta larga se audita truncada y una falla de auditoría no cambia la respuesta', async () => {
    const rutaLarga = `/v1/productos/${'x'.repeat(300)}`
    const { deps, llamadas } = montar({ errorAuditoria: { message: 'no se pudo insertar' } })
    const res = await manejar(pedir(rutaLarga), deps)
    assert.equal(res.status, 404)
    const rutaAuditada = (llamadas.auditoria[0] as { ruta: string }).ruta
    assert.equal(rutaAuditada.length, 200)
  })

  it('la auditoría no lleva el token y sí el método, la ruta y la versión', async () => {
    const { deps, llamadas } = montar()
    await manejar(pedir('/v1/precios'), deps)
    const auditoria = llamadas.auditoria[0] as Record<string, unknown>
    assert.equal(auditoria.metodo, 'GET')
    assert.equal(auditoria.ruta, '/v1/precios')
    assert.equal(auditoria.version, 'v1')
    assert.equal(auditoria.clave_id, 'clave-1')
    assert.equal(auditoria.organizacion_id, 'org-1')
    assert.ok(!JSON.stringify(auditoria).includes(CLAVE), 'el token no se audita')
  })
})
