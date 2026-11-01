import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { revalidarConexion } from './autenticacion.js'
import { crearServidorHttp } from './servidor.js'

function adminFalso(estado: { activa: boolean; errorBase?: boolean }) {
  return {
    from: () => ({ select: () => Promise.resolve({ data: [] }), insert: () => Promise.resolve({ error: null }) }),
    rpc: (nombre: string, p: Record<string, unknown>) => {
      if (estado.errorBase) return Promise.resolve({ data: null, error: { message: 'base caída' } })
      if (nombre === 'validar_credencial_mcp') return Promise.resolve({ data: estado.activa && p.p_token === 'tok' ? 'org-1' : null })
      if (nombre === 'resolver_credencial_id_mcp') return Promise.resolve({ data: estado.activa && p.p_token === 'tok' ? 'cred-1' : null })
      return Promise.resolve({ data: null })
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

const conexion = { credencialId: 'cred-1', token: 'tok' }

describe('revalidarConexion', () => {
  it('acepta la credencial activa con el mismo token', async () => {
    expect(await revalidarConexion(adminFalso({ activa: true }), 'tok', conexion)).toEqual({ vigente: true })
  })
  it('marca como revocada la credencial que ya no está activa', async () => {
    expect(await revalidarConexion(adminFalso({ activa: false }), 'tok', conexion)).toEqual({ vigente: false, motivo: 'credencial-revocada' })
  })
  it('distingue el token ausente del token distinto (ninguno revoca la credencial)', async () => {
    const admin = adminFalso({ activa: true })
    expect(await revalidarConexion(admin, undefined, conexion)).toEqual({ vigente: false, motivo: 'token-ausente' })
    expect(await revalidarConexion(admin, 'otro', conexion)).toEqual({ vigente: false, motivo: 'token-distinto' })
  })
  it('falla cerrado ante un error de la base, sin revocar la credencial', async () => {
    expect(await revalidarConexion(adminFalso({ activa: true, errorBase: true }), 'tok', conexion)).toEqual({ vigente: false, motivo: 'error-base' })
  })
})

describe('servidor HTTP: sesión existente', () => {
  let servidor: Server | undefined
  afterEach(() => new Promise<void>((r) => (servidor ? servidor.close(() => r()) : r())))

  async function abrir(estado: { activa: boolean }) {
    servidor = crearServidorHttp(adminFalso(estado))
    await new Promise<void>((r) => servidor!.listen(0, r))
    const url = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}/mcp`
    const cabeceras = (token: string | undefined, sid?: string) => ({
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(sid ? { 'mcp-session-id': sid } : {}),
    })
    const init = await fetch(url, {
      method: 'POST',
      headers: cabeceras('tok'),
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '0' } } }),
    })
    const sid = init.headers.get('mcp-session-id')!
    await init.text()
    return { url, cabeceras, sid, init }
  }
  const lista = (id: number) => JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/list' })

  it('con la credencial activa la sesión sigue respondiendo', async () => {
    const { url, cabeceras, sid, init } = await abrir({ activa: true })
    expect(init.status).toBe(200)
    const r = await fetch(url, { method: 'POST', headers: cabeceras('tok', sid), body: lista(2) })
    expect(r.status).toBe(200)
    await r.text()
  })

  it('tras revocar, la siguiente solicitud da 403 y la sesión se elimina (404 después)', async () => {
    const estado = { activa: true }
    const { url, cabeceras, sid } = await abrir(estado)
    estado.activa = false
    const r = await fetch(url, { method: 'POST', headers: cabeceras('tok', sid), body: lista(2) })
    expect(r.status).toBe(403)
    await r.text()
    // La sesión ya no existe: el protocolo responde 404 (no 500) y no
    // vuelve a abrir sesión con el token revocado.
    const otra = await fetch(url, { method: 'POST', headers: cabeceras('tok', sid), body: lista(3) })
    expect(otra.status).toBe(404)
    await otra.text()
  })

  it('un token distinto en la sesión existente da 403 sin cerrar la sesión', async () => {
    const { url, cabeceras, sid } = await abrir({ activa: true })
    const r = await fetch(url, { method: 'POST', headers: cabeceras('otro', sid), body: lista(2) })
    expect(r.status).toBe(403)
    await r.text()
    // Quien no tiene la credencial no puede tumbar la sesión de otro: la
    // sesión sigue viva y su dueño puede seguir usándola.
    const delDueño = await fetch(url, { method: 'POST', headers: cabeceras('tok', sid), body: lista(3) })
    expect(delDueño.status).toBe(200)
    await delDueño.text()
  })

  it('un Bearer ausente en la sesión existente da 403 sin cerrar la sesión', async () => {
    const { url, cabeceras, sid } = await abrir({ activa: true })
    const r = await fetch(url, { method: 'POST', headers: cabeceras(undefined, sid), body: lista(2) })
    expect(r.status).toBe(403)
    await r.text()
    const delDueño = await fetch(url, { method: 'POST', headers: cabeceras('tok', sid), body: lista(3) })
    expect(delDueño.status).toBe(200)
    await delDueño.text()
  })

  it('DELETE con la credencial revocada da 403 y cierra la sesión', async () => {
    const estado = { activa: true }
    const { url, cabeceras, sid } = await abrir(estado)
    estado.activa = false
    const r = await fetch(url, { method: 'DELETE', headers: cabeceras('tok', sid) })
    expect(r.status).toBe(403)
    await r.text()
    const otra = await fetch(url, { method: 'DELETE', headers: cabeceras('tok', sid) })
    expect(otra.status).toBe(404)
    await otra.text()
  })

  it('DELETE con un token distinto da 403 sin cerrar la sesión', async () => {
    const { url, cabeceras, sid } = await abrir({ activa: true })
    const r = await fetch(url, { method: 'DELETE', headers: cabeceras('otro', sid) })
    expect(r.status).toBe(403)
    await r.text()
    const delDueño = await fetch(url, { method: 'POST', headers: cabeceras('tok', sid), body: lista(2) })
    expect(delDueño.status).toBe(200)
    await delDueño.text()
  })
})
