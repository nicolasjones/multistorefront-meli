// Pruebas de `solicitar-acceso` (F-ROL-05, FR-008, FR-012a) con transporte simulado: envío único por
// registro del día, reintento tras fallo, organización sin administradores y mapeo de errores de la RPC.
// Corre con `node --test` (`pnpm test:edge:solicitar-acceso`); el handler no importa nada de Deno.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { manejar, type Deps, type ResultadoRpc } from './handler.ts'

type Opciones = {
  rpc?: ResultadoRpc
  rpcError?: { message: string; code: string }
  admins?: string[]
  falloEnvio?: boolean
  reclamoPerdido?: boolean
}

const REGISTRO: ResultadoRpc = { id: 'sol-1', organizacion_id: 'org-1', nuevo: true, correo_enviado: false }

function montar(opciones: Opciones = {}) {
  const estado = { rpc: [] as [string, Record<string, unknown>][], reclamos: 0, liberaciones: 0, enviados: [] as { para: string[]; asunto: string; texto: string }[] }
  const deps: Deps = {
    verificarJwt: async (jwt) => jwt === 'valido' ? { id: 'u-1', email: 'ana@example.com' } : null,
    caller: () => ({
      rpc: async (nombre, args) => {
        estado.rpc.push([nombre, args])
        return opciones.rpcError ? { data: null, error: opciones.rpcError } : { data: opciones.rpc ?? REGISTRO, error: null }
      },
    }),
    datos: {
      reclamarEnvio: async () => { estado.reclamos += 1; return !opciones.reclamoPerdido },
      liberarEnvio: async () => { estado.liberaciones += 1 },
      administradoresActivos: async () => opciones.admins ?? ['admin1@example.com', 'admin2@example.com'],
      nombreVisible: async () => 'Ana\r\nBcc: x@example.com',
    },
    enviar: async (mensaje) => {
      if (opciones.falloEnvio) throw new Error('smtp caído')
      estado.enviados.push(mensaje)
    },
  }
  return { deps, estado }
}

const pedir = (deps: Deps, { jwt = 'valido', cuerpo = { seccion: 'rentabilidad' }, metodo = 'POST' }: { jwt?: string | null; cuerpo?: unknown; metodo?: string } = {}) =>
  manejar(new Request('http://localhost/solicitar-acceso', {
    method: metodo,
    headers: jwt ? { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' } : {},
    body: metodo === 'POST' ? JSON.stringify(cuerpo) : undefined,
  }), deps)

describe('solicitar-acceso', () => {
  it('registra el pedido y envía un único correo a todos los administradores activos', async () => {
    const { deps, estado } = montar()
    const res = await pedir(deps)

    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { resultado: 'solicitud_enviada', nuevo: true })
    assert.deepEqual(estado.rpc, [['solicitar_acceso', { p_seccion: 'rentabilidad' }]])
    assert.equal(estado.enviados.length, 1)
    assert.deepEqual(estado.enviados[0].para, ['admin1@example.com', 'admin2@example.com'])
    assert.match(estado.enviados[0].asunto, /Rentabilidad/)
    assert.match(estado.enviados[0].texto, /ana@example\.com/)
  })

  it('si el correo del día ya salió, no reenvía y devuelve la misma confirmación', async () => {
    const { deps, estado } = montar({ rpc: { ...REGISTRO, nuevo: false, correo_enviado: true } })
    const res = await pedir(deps)

    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { resultado: 'solicitud_enviada', nuevo: false })
    assert.equal(estado.enviados.length, 0)
    assert.equal(estado.reclamos, 0)
  })

  it('doble clic concurrente: quien pierde el reclamo no envía', async () => {
    const { deps, estado } = montar({ reclamoPerdido: true })
    const res = await pedir(deps)

    assert.equal(res.status, 200)
    assert.equal(estado.enviados.length, 0)
  })

  it('si falla el envío, el pedido queda, responde error reintentable y libera el envío', async () => {
    const { deps, estado } = montar({ falloEnvio: true })
    const res = await pedir(deps)

    assert.equal(res.status, 502)
    assert.match((await res.json() as { error: string }).error, /quedó registrada/)
    assert.equal(estado.liberaciones, 1)
  })

  it('el reintento tras el fallo envía el correo (el registro del día no se duplica)', async () => {
    const { deps, estado } = montar({ rpc: { ...REGISTRO, nuevo: false, correo_enviado: false } })
    const res = await pedir(deps)

    assert.equal(res.status, 200)
    assert.equal(estado.enviados.length, 1)
  })

  it('organización sin administrador activo: informa y no pierde el registro', async () => {
    const { deps, estado } = montar({ admins: [] })
    const res = await pedir(deps)

    assert.equal(res.status, 200)
    assert.equal((await res.json() as { resultado: string }).resultado, 'sin_administradores')
    assert.equal(estado.enviados.length, 0)
    assert.equal(estado.liberaciones, 1)
  })

  it('el nombre no puede inyectar cabeceras: el asunto sale sin saltos de línea', async () => {
    const { deps, estado } = montar()
    await pedir(deps)

    assert.doesNotMatch(estado.enviados[0].asunto, /[\r\n]/)
  })

  it('rechaza sin JWT o con JWT inválido', async () => {
    const { deps, estado } = montar()

    assert.equal((await pedir(deps, { jwt: null })).status, 403)
    assert.equal((await pedir(deps, { jwt: 'malo' })).status, 403)
    assert.equal(estado.rpc.length, 0)
  })

  it('rechaza una sección ausente o demasiado larga antes de llamar a la RPC', async () => {
    const { deps, estado } = montar()

    assert.equal((await pedir(deps, { cuerpo: {} })).status, 400)
    assert.equal((await pedir(deps, { cuerpo: { seccion: 'x'.repeat(61) } })).status, 400)
    assert.equal(estado.rpc.length, 0)
  })

  it('mapea los errores de la RPC sin filtrar el texto de Postgres', async () => {
    const sinMembresia = montar({ rpcError: { message: 'No perteneces a una organización activa', code: '42501' } })
    assert.equal((await pedir(sinMembresia.deps)).status, 403)

    const invalida = montar({ rpcError: { message: 'Sección inválida', code: '22023' } })
    const res = await pedir(invalida.deps)
    assert.equal(res.status, 400)
    assert.equal((await res.json() as { error: string }).error, 'Sección inválida')

    const otro = montar({ rpcError: { message: 'relation x does not exist', code: '42P01' } })
    const resOtro = await pedir(otro.deps)
    assert.equal(resOtro.status, 400)
    assert.doesNotMatch(JSON.stringify(await resOtro.json()), /relation/)
  })

  it('solo acepta POST (y OPTIONS para CORS)', async () => {
    const { deps } = montar()

    assert.equal((await pedir(deps, { metodo: 'GET' })).status, 405)
    assert.equal((await pedir(deps, { metodo: 'OPTIONS' })).status, 200)
  })
})
