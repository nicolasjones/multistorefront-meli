// Pruebas de `crear-organizacion` (F-ORG-02, FR-001/FR-002) con clientes simulados: rechazo a
// no-superadmin (403), alta con invitación y membresía de administrador, y reversión de la
// organización si la invitación o la membresía fallan. Corre con `node --test`
// (`pnpm test:edge:crear-organizacion`); el handler no importa nada de Deno ni de Supabase.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { manejar, type Deps } from './handler.ts'

type Opciones = {
  superadmin?: boolean
  insertOrgError?: boolean
  inviteError?: { message: string; status?: number }
  membresiaError?: boolean
}

function montar(opciones: Opciones = {}) {
  const { superadmin = true } = opciones
  const llamadas = {
    insertOrg: [] as unknown[],
    borradas: [] as unknown[],
    invitados: [] as string[],
    membresias: [] as unknown[],
  }
  const deps: Deps = {
    admin: {
      auth: {
        getUser: async (jwt) =>
          jwt === 'valido'
            ? { data: { user: { id: 'caller' } }, error: null }
            : { data: null, error: { message: 'expirado' } },
        admin: {
          inviteUserByEmail: async (email) => {
            llamadas.invitados.push(email)
            return opciones.inviteError
              ? { data: null, error: opciones.inviteError }
              : { data: { user: { id: 'fundador' } }, error: null }
          },
        },
      },
      from: (tabla: string) => {
        if (tabla === 'superadmins') {
          return {
            select: () => ({
              eq: () => ({ maybeSingle: async () => ({ data: superadmin ? { user_id: 'caller' } : null }) }),
            }),
          }
        }
        if (tabla === 'organizaciones') {
          return {
            insert: (fila: unknown) => {
              llamadas.insertOrg.push(fila)
              return {
                select: () => ({
                  single: async () =>
                    opciones.insertOrgError
                      ? { data: null, error: { message: 'duplicada' } }
                      : { data: { id: 'org-1' }, error: null },
                }),
              }
            },
            delete: () => ({ eq: async (_c: string, id: unknown) => { llamadas.borradas.push(id); return { error: null } } }),
          }
        }
        return {
          insert: async (fila: unknown) => {
            llamadas.membresias.push(fila)
            return { error: opciones.membresiaError ? { message: 'fk' } : null }
          },
        }
      },
    },
  }
  return { deps, llamadas }
}

const pedido = (cuerpo: unknown, token: string | null = 'valido') =>
  new Request('http://localhost/crear-organizacion', {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: JSON.stringify(cuerpo),
  })

const valido = { nombre: ' Acme ', email_fundador: ' fundador@example.com ' }

describe('crear-organizacion', () => {
  it('escenario 1: superadmin crea la organización e invita al fundador como administrador', async () => {
    const { deps, llamadas } = montar()
    const res = await manejar(pedido(valido), deps)
    assert.equal(res.status, 201)
    assert.deepEqual(await res.json(), { organizacion_id: 'org-1', invitado: 'fundador@example.com' })
    assert.deepEqual(llamadas.insertOrg, [{ nombre: 'Acme' }])
    assert.deepEqual(llamadas.invitados, ['fundador@example.com'])
    assert.deepEqual(llamadas.membresias, [{ user_id: 'fundador', organizacion_id: 'org-1', rol_id: 'administrador' }])
    assert.deepEqual(llamadas.borradas, [])
  })

  it('escenario 2: quien no es superadmin recibe 403 y no se crea nada', async () => {
    const { deps, llamadas } = montar({ superadmin: false })
    const res = await manejar(pedido(valido), deps)
    assert.equal(res.status, 403)
    assert.deepEqual(llamadas.insertOrg, [])
    assert.deepEqual(llamadas.invitados, [])
  })

  it('sin header Authorization o con token inválido responde 403 sin crear nada', async () => {
    const { deps, llamadas } = montar()
    assert.equal((await manejar(pedido(valido, null), deps)).status, 403)
    assert.equal((await manejar(pedido(valido, 'malo'), deps)).status, 403)
    assert.deepEqual(llamadas.insertOrg, [])
  })

  it('rechaza método distinto de POST, cuerpo inválido y campos faltantes', async () => {
    const { deps, llamadas } = montar()
    assert.equal((await manejar(new Request('http://localhost/', { method: 'GET' }), deps)).status, 400)
    const roto = new Request('http://localhost/', { method: 'POST', headers: { Authorization: 'Bearer valido' }, body: '{' })
    assert.equal((await manejar(roto, deps)).status, 400)
    assert.equal((await manejar(pedido({ nombre: '  ', email_fundador: 'a@b.c' }), deps)).status, 400)
    assert.deepEqual(llamadas.insertOrg, [])
  })

  it('escenario 3: si el correo ya tiene cuenta (422) revierte la organización y informa el motivo', async () => {
    const { deps, llamadas } = montar({ inviteError: { message: 'already registered', status: 422 } })
    const res = await manejar(pedido(valido), deps)
    assert.equal(res.status, 400)
    assert.match((await res.json()).error, /ya tiene una cuenta registrada/)
    assert.deepEqual(llamadas.borradas, ['org-1'])
    assert.deepEqual(llamadas.membresias, [])
  })

  it('escenario 3: si el envío de la invitación falla (otro error) revierte y responde 502', async () => {
    const { deps, llamadas } = montar({ inviteError: { message: 'smtp', status: 500 } })
    const res = await manejar(pedido(valido), deps)
    assert.equal(res.status, 502)
    assert.deepEqual(llamadas.borradas, ['org-1'])
  })

  it('si falla la membresía del fundador revierte la organización', async () => {
    const { deps, llamadas } = montar({ membresiaError: true })
    const res = await manejar(pedido(valido), deps)
    assert.equal(res.status, 400)
    assert.deepEqual(llamadas.borradas, ['org-1'])
  })

  it('si no se puede insertar la organización no invita a nadie', async () => {
    const { deps, llamadas } = montar({ insertOrgError: true })
    const res = await manejar(pedido(valido), deps)
    assert.equal(res.status, 400)
    assert.deepEqual(llamadas.invitados, [])
  })
})
