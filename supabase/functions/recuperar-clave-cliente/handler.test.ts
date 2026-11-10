// Pruebas de `recuperar-clave-cliente` (FR-023, SC-006) con clientes simulados.
// Corre con `node --test` (`pnpm test:edge:recuperar-clave-cliente`); el handler no importa nada de Deno ni de Supabase.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { manejar, type Deps } from './handler.ts'

type Opciones = {
  cuenta?: { correo: string; dominio: string } | null
  rpcError?: boolean
  enviarError?: boolean
}

function montar(opciones: Opciones = {}) {
  const pendientes: Promise<void>[] = []
  const llamadas = { rpc: [] as [string, Record<string, unknown>][], claves: [] as { email: string; redirectTo: string }[] }
  const deps: Deps = {
    protocolo: 'https',
    admin: {
      rpc: async (nombre, args) => {
        llamadas.rpc.push([nombre, args])
        if (opciones.rpcError) return { data: null, error: { message: 'boom' } }
        return { data: opciones.cuenta ? [opciones.cuenta] : [], error: null }
      },
    },
    enSegundoPlano: (tarea) => { pendientes.push(tarea) },
    enviarClave: async (email, redirectTo) => {
      llamadas.claves.push({ email, redirectTo })
      return { data: {}, error: opciones.enviarError ? { message: 'smtp' } : null }
    },
  }
  return { deps, llamadas, terminar: () => Promise.all(pendientes) }
}

const pedido = (body: unknown, method = 'POST') =>
  new Request('http://localhost/recuperar-clave-cliente', { method, headers: { 'Content-Type': 'application/json' }, body: method === 'POST' ? JSON.stringify(body) : undefined })

describe('recuperar-clave-cliente', () => {
  it('con cuenta activa en la tienda envía el correo con redirección al dominio de la tienda', async () => {
    const { deps, llamadas, terminar } = montar({ cuenta: { correo: 'cli@example.com', dominio: 'mundojc.ejemplo.com' } })
    const res = await manejar(pedido({ host: 'mundojc.ejemplo.com', correo: ' Cli@Example.com ' }), deps)
    await terminar()
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { ok: true })
    assert.deepEqual(llamadas.rpc, [['cuenta_cliente_para_recuperar', { p_host: 'mundojc.ejemplo.com', p_correo: 'cli@example.com' }]])
    assert.deepEqual(llamadas.claves, [{ email: 'cli@example.com', redirectTo: 'https://mundojc.ejemplo.com/definir-contrasena' }])
  })

  it('la redirección usa el dominio de la base, no el host recibido', async () => {
    const { deps, llamadas, terminar } = montar({ cuenta: { correo: 'cli@example.com', dominio: 'mundojc.ejemplo.com' } })
    await manejar(pedido({ host: 'MundoJC.Ejemplo.com:8443', correo: 'cli@example.com' }), deps)
    await terminar()
    assert.equal(llamadas.claves[0]?.redirectTo, 'https://mundojc.ejemplo.com/definir-contrasena')
  })

  it('sin cuenta activa (suspendida, sin cuenta, no habilitada, host ajeno) no envía y responde idéntico', async () => {
    const con = montar({ cuenta: { correo: 'cli@example.com', dominio: 'mundojc.ejemplo.com' } })
    const sin = montar({ cuenta: null })
    const resCon = await manejar(pedido({ host: 'mundojc.ejemplo.com', correo: 'cli@example.com' }), con.deps)
    const resSin = await manejar(pedido({ host: 'mundojc.ejemplo.com', correo: 'nadie@example.com' }), sin.deps)
    await Promise.all([con.terminar(), sin.terminar()])
    assert.equal(sin.llamadas.claves.length, 0)
    assert.equal(resSin.status, resCon.status)
    assert.equal(await resSin.text(), await resCon.text())
  })

  it('un fallo al consultar o al enviar no cambia la respuesta (no se enumeran cuentas)', async () => {
    const errorConsulta = montar({ rpcError: true })
    const errorEnvio = montar({ cuenta: { correo: 'cli@example.com', dominio: 'mundojc.ejemplo.com' }, enviarError: true })
    for (const { deps, terminar } of [errorConsulta, errorEnvio]) {
      const res = await manejar(pedido({ host: 'mundojc.ejemplo.com', correo: 'cli@example.com' }), deps)
      await terminar()
      assert.equal(res.status, 200)
      assert.deepEqual(await res.json(), { ok: true })
    }
  })

  it('responde sin esperar la consulta ni el envío (tiempo parejo, con o sin cuenta)', async () => {
    const { deps, llamadas, terminar } = montar({ cuenta: { correo: 'tiempo@example.com', dominio: 'mundojc.ejemplo.com' } })
    let liberar: () => void = () => undefined
    const puerta = new Promise<void>((resolver) => { liberar = resolver })
    const rpc = deps.admin.rpc
    deps.admin.rpc = async (nombre, args) => { await puerta; return rpc(nombre, args) }
    const res = await manejar(pedido({ host: 'mundojc.ejemplo.com', correo: 'tiempo@example.com' }), deps)
    assert.deepEqual(await res.json(), { ok: true })
    assert.equal(llamadas.claves.length, 0, 'la respuesta no esperó a la consulta ni al envío')
    liberar()
    await terminar()
    assert.equal(llamadas.claves.length, 1)
  })

  it('limita los envíos por correo y tienda; lo que excede responde igual y no envía', async () => {
    const { deps, llamadas, terminar } = montar({ cuenta: { correo: 'lim@example.com', dominio: 'mundojc.ejemplo.com' } })
    let reloj = 1_000_000
    deps.ahora = () => reloj
    for (let i = 0; i < 5; i++) {
      const res = await manejar(pedido({ host: 'mundojc.ejemplo.com', correo: 'lim@example.com' }), deps)
      assert.deepEqual(await res.json(), { ok: true })
      await terminar()
    }
    assert.equal(llamadas.claves.length, 3)
    reloj += 11 * 60 * 1000
    await manejar(pedido({ host: 'mundojc.ejemplo.com', correo: 'lim@example.com' }), deps)
    await terminar()
    assert.equal(llamadas.claves.length, 4)
  })

  it('el límite usa el dominio y el correo de la base: variar el puerto del host no lo esquiva', async () => {
    const { deps, llamadas, terminar } = montar({ cuenta: { correo: 'puerto@example.com', dominio: 'mundojc.ejemplo.com' } })
    deps.ahora = () => 2_000_000
    for (const host of ['mundojc.ejemplo.com:1', 'mundojc.ejemplo.com:2', 'MundoJC.ejemplo.com:3', 'mundojc.ejemplo.com:4', 'mundojc.ejemplo.com:5']) {
      await manejar(pedido({ host, correo: 'puerto@example.com' }), deps)
      await terminar()
    }
    assert.equal(llamadas.claves.length, 3)
  })

  it('rechaza datos con forma inválida sin consultar nada', async () => {
    const { deps, llamadas } = montar()
    for (const body of [null, {}, { host: 'mundojc.ejemplo.com' }, { correo: 'a@b.com' }, { host: 'x y', correo: 'a@b.com' }, { host: 'mundojc.ejemplo.com', correo: 'sin-arroba' }, { host: 5, correo: 'a@b.com' }]) {
      const res = await manejar(pedido(body), deps)
      assert.equal(res.status, 400)
    }
    assert.equal(llamadas.rpc.length, 0)
  })

  it('solo acepta POST (y responde el preflight de CORS)', async () => {
    const { deps } = montar()
    assert.equal((await manejar(pedido(null, 'GET'), deps)).status, 405)
    assert.equal((await manejar(pedido(null, 'OPTIONS'), deps)).status, 200)
  })
})
