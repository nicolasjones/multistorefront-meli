// Pruebas de `enviar-correo-clientes` con dependencias falsas: auth, permisos,
// clientes y envío. Corre con `node --test` (el handler no importa nada de Deno).
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { manejar, type Deps } from './handler.ts'

const ENVIADOS: { para: string[]; asunto: string; texto: string }[] = []

function montar(opciones: {
  usuario?: { id: string } | null
  permisos?: { seccion: string; nivel: string }[]
  clientes?: { id: string; nombre: string; correo: string | null }[]
  fallaEnvio?: boolean
} = {}): Deps {
  return {
    verificarJwt: async () => opciones.usuario ?? { id: 'admin' },
    permisos: async () => ({ data: opciones.permisos ?? [{ seccion: 'clientes', nivel: 'edicion' }], error: null }),
    clientes: async (_jwt, ids) => ({
      data: (opciones.clientes ?? ids.map((id) => ({ id, nombre: id, correo: `${id}@ejemplo.com` }))),
      error: null,
    }),
    enviar: async (m) => {
      if (opciones.fallaEnvio) throw new Error('smtp caído')
      ENVIADOS.push(m)
    },
  }
}

const pedido = (cuerpo: unknown, jwt = 'valido') =>
  new Request('http://x', {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}` },
    body: JSON.stringify(cuerpo),
  })

describe('enviar-correo-clientes', () => {
  it('envía a los que tienen correo e informa a los que no', async () => {
    ENVIADOS.length = 0
    const r = await manejar(pedido({ ids: ['a', 'b'], asunto: 'Promo', mensaje: 'Hola' }), montar({
      clientes: [
        { id: 'a', nombre: 'A', correo: 'a@ejemplo.com' },
        { id: 'b', nombre: 'B', correo: null },
      ],
    }))
    assert.equal(r.status, 200)
    assert.deepEqual(await r.json(), { enviados: 1, sin_correo: 1 })
    assert.deepEqual(ENVIADOS[0].para, ['a@ejemplo.com'])
  })

  it('exige edición en Clientes aunque el JWT sea válido', async () => {
    const r = await manejar(pedido({ ids: ['a'], asunto: 'X', mensaje: 'Y' }),
      montar({ permisos: [{ seccion: 'clientes', nivel: 'lectura' }] }))
    assert.equal(r.status, 403)
    assert.equal(ENVIADOS.length, 0)
  })

  it('rechaza sin auth, sin asunto/mensaje y exceso de destinatarios', async () => {
    assert.equal((await manejar(pedido({ ids: ['a'], asunto: 'X', mensaje: 'Y' }, ''), montar())).status, 403)
    assert.equal((await manejar(pedido({ ids: [], asunto: 'X', mensaje: 'Y' }), montar())).status, 400)
    assert.equal((await manejar(pedido({ ids: ['a'], asunto: '', mensaje: 'Y' }), montar())).status, 400)
    const muchos = Array.from({ length: 501 }, (_, i) => `id-${i}`)
    assert.equal((await manejar(pedido({ ids: muchos, asunto: 'X', mensaje: 'Y' }), montar())).status, 400)
  })

  it('si el SMTP falla responde 502 sin decir que se envió', async () => {
    const r = await manejar(pedido({ ids: ['a'], asunto: 'X', mensaje: 'Y' }), montar({ fallaEnvio: true }))
    assert.equal(r.status, 502)
  })
})
