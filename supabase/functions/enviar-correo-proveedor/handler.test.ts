// Pruebas de `enviar-correo-proveedor` con clientes simulados. Corre con `node --test`
// (`pnpm test:edge:enviar-correo-proveedor`); el handler no importa nada de Deno ni de Supabase.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { manejar, type Deps } from './handler.ts'

const ID = '11111111-1111-4111-8111-111111111111'

type Opciones = {
  nivel?: string | null
  nivelError?: boolean
  proveedor?: { razon_social: string; correo: string | null; activo: boolean } | null
  proveedorError?: boolean
  falloSmtp?: boolean
}

function montar(opciones: Opciones = {}) {
  const enviados: { para: string[]; asunto: string; texto: string }[] = []
  const lecturas: string[] = []
  const deps: Deps = {
    getUser: async (jwt) => jwt === 'valido' ? { data: { user: { id: 'u1' } }, error: null } : { data: { user: null }, error: { message: 'x' } },
    caller: () => ({
      nivelProveedores: async () => opciones.nivelError ? { data: null, error: { message: 'boom' } } : { data: opciones.nivel === undefined ? 'edicion' : opciones.nivel, error: null },
      proveedor: async (id) => {
        lecturas.push(id)
        if (opciones.proveedorError) return { data: null, error: { message: 'boom' } }
        const sin = opciones.proveedor === null
        return { data: sin ? null : opciones.proveedor ?? { razon_social: 'Acme', correo: 'ventas@acme.com', activo: true }, error: null }
      },
    }),
    enviar: async (mensaje) => {
      if (opciones.falloSmtp) throw new Error('smtp caído')
      enviados.push(mensaje)
    },
  }
  return { deps, enviados, lecturas }
}

const pedir = (deps: Deps, body: unknown, jwt: string | null = 'valido', method = 'POST') =>
  manejar(new Request('http://x/', { method, headers: jwt ? { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' } : {}, body: method === 'POST' ? JSON.stringify(body) : undefined }), deps)
const valido = { proveedor_id: ID, asunto: 'Pedido', mensaje: 'Hola, necesitamos cotización.' }

describe('enviar-correo-proveedor', () => {
  it('envía al correo guardado del proveedor, no al que mande el cliente', async () => {
    const { deps, enviados } = montar()
    const res = await pedir(deps, { ...valido, para: 'atacante@evil.com' })
    assert.equal(res.status, 200)
    assert.deepEqual(enviados, [{ para: ['ventas@acme.com'], asunto: 'Pedido', texto: 'Hola, necesitamos cotización.' }])
  })

  it('rechaza sin sesión y con token inválido', async () => {
    const { deps, enviados } = montar()
    assert.equal((await pedir(deps, valido, null)).status, 403)
    assert.equal((await pedir(deps, valido, 'malo')).status, 403)
    assert.equal(enviados.length, 0)
  })

  it('rechaza método distinto de POST', async () => {
    assert.equal((await pedir(montar().deps, null, 'valido', 'GET')).status, 405)
  })

  it('exige edición en proveedores (lectura y ninguno no envían)', async () => {
    for (const nivel of ['lectura', 'ninguno', null]) {
      const { deps, enviados, lecturas } = montar({ nivel })
      assert.equal((await pedir(deps, valido)).status, 403)
      assert.equal(enviados.length, 0)
      assert.equal(lecturas.length, 0)
    }
  })

  it('proveedor de otra organización o inexistente: 404 sin enviar', async () => {
    const { deps, enviados } = montar({ proveedor: null })
    assert.equal((await pedir(deps, valido)).status, 404)
    assert.equal(enviados.length, 0)
  })

  it('proveedor sin correo: 422', async () => {
    const { deps, enviados } = montar({ proveedor: { razon_social: 'Acme', correo: null, activo: true } })
    assert.equal((await pedir(deps, valido)).status, 422)
    assert.equal(enviados.length, 0)
  })

  it('valida proveedor_id, asunto y mensaje (vacíos, largos, tipos)', async () => {
    const largo = (n: number) => 'a'.repeat(n)
    for (const body of [
      { ...valido, proveedor_id: 'no-uuid' }, { ...valido, proveedor_id: undefined },
      { ...valido, asunto: '  ' }, { ...valido, asunto: largo(201) }, { ...valido, asunto: 5 },
      { ...valido, mensaje: '' }, { ...valido, mensaje: largo(5001) }, null,
    ]) {
      const { deps, enviados } = montar()
      assert.equal((await pedir(deps, body)).status, 400, JSON.stringify(body)?.slice(0, 60))
      assert.equal(enviados.length, 0)
    }
  })

  it('pasa el asunto tal cual al envío (el saneo de saltos de línea lo hace enviarPorSmtp/lineaSegura)', async () => {
    const { deps, enviados } = montar()
    await pedir(deps, { ...valido, asunto: 'Hola\r\nBcc: x@y.com' })
    assert.equal(enviados.length, 1)
    assert.equal(enviados[0].para.length, 1)
  })

  it('falla de SMTP: 502 con mensaje controlado, sin filtrar el error', async () => {
    const { deps } = montar({ falloSmtp: true })
    const res = await pedir(deps, valido)
    assert.equal(res.status, 502)
    assert.doesNotMatch(JSON.stringify(await res.json()), /smtp caído/)
  })

  it('error al resolver permiso o proveedor: 502', async () => {
    assert.equal((await pedir(montar({ nivelError: true }).deps, valido)).status, 502)
    assert.equal((await pedir(montar({ proveedorError: true }).deps, valido)).status, 502)
  })
})
