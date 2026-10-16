// Pruebas de la lógica de `invitar-miembro` (FR-018) con clientes simulados: reemplazo de cuenta,
// correo con cuenta existente, cancelar, mapeo de errores y compensación. Corre con `node --test`
// (`pnpm test:edge:invitar-miembro`); el handler no importa nada de Deno ni de Supabase.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { manejar, type Deps } from './handler.ts'

type Opciones = {
  invitacion?: { id: string; created_at: string; updated_at: string; auth_user_id: string | null }
  cuentas?: { id: string; email: string; last_sign_in_at: string | null; email_confirmed_at?: string | null; invited_at?: string | null }[]
  rpcError?: Record<string, { message: string; code: string }>
  rpcData?: Record<string, unknown>
  listError?: boolean
  deleteUserError?: boolean
  inviteError?: boolean
  pendientesAjenas?: { id: string }[]
  vinculadas?: { id: string }[]
}

const AHORA = '2026-10-13T12:00:00.000Z'
const NUEVA = { id: 'inv-1', created_at: AHORA, updated_at: AHORA, auth_user_id: null }
const RENOVADA = { id: 'inv-1', created_at: AHORA, updated_at: '2026-10-13T13:00:00.000Z', auth_user_id: 'cuenta-vieja' }

function montar(opciones: Opciones = {}) {
  const llamadas: { rpc: [string, Record<string, unknown>][]; borradas: string[]; invitados: string[]; tabla: [string, string][]; filtros: [string, unknown][] } = { rpc: [], borradas: [], invitados: [], tabla: [], filtros: [] }
  const deps: Deps = {
    appUrl: 'https://app.example.com',
    admin: {
      auth: {
        getUser: async (jwt) => jwt === 'valido' ? { data: { user: { id: 'admin' } }, error: null } : { data: { user: null }, error: { message: 'x' } },
        admin: {
          listUsers: async () => opciones.listError ? { data: { users: [] }, error: { message: 'boom' } } : { data: { users: opciones.cuentas ?? [] }, error: null },
          deleteUser: async (id) => {
            llamadas.borradas.push(id)
            return { data: null, error: opciones.deleteUserError ? { message: 'no se pudo' } : null }
          },
          inviteUserByEmail: async (email) => {
            llamadas.invitados.push(email)
            return opciones.inviteError ? { data: { user: null }, error: { message: 'smtp' } } : { data: { user: { id: 'cuenta-nueva' } }, error: null }
          },
        },
      },
      from: (_tabla: string) => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              neq: async () => ({ data: opciones.pendientesAjenas ?? [], error: null }),
              eq: async (columna: string, valor: unknown) => { llamadas.filtros.push([columna, valor]); return { data: opciones.vinculadas ?? [], error: null } },
            }),
          }),
        }),
        delete: () => ({ eq: async (_c: string, id: string) => { llamadas.tabla.push(['delete', id]); return { error: null } } }),
        update: (cambios: Record<string, unknown>) => ({ eq: async (_c: string, id: string) => { llamadas.tabla.push([`update:${JSON.stringify(cambios)}`, id]); return { error: null } } }),
      }),
    },
    caller: () => ({
      rpc: async (nombre, args) => {
        llamadas.rpc.push([nombre, args])
        const error = opciones.rpcError?.[nombre]
        if (error) return { data: null, error }
        if (nombre === 'puede_invitar') return { data: 'org-1', error: null }
        if (nombre === 'registrar_invitacion') return { data: opciones.invitacion ?? NUEVA, error: null }
        if (nombre === 'vincular_invitacion') return { data: { id: 'inv-1', estado: 'pendiente' }, error: null }
        return { data: opciones.rpcData?.[nombre] ?? null, error: null }
      },
    }),
  }
  return { deps, llamadas }
}

const pedir = (cuerpo: unknown, jwt = 'valido') =>
  new Request('https://x/invitar-miembro', { method: 'POST', headers: { Authorization: `Bearer ${jwt}` }, body: JSON.stringify(cuerpo) })
const invitar = { accion: 'invitar', email: 'Persona@Example.com', rol: 'consulta' }
const leer = async (res: Response) => ({ status: res.status, cuerpo: await res.json() as Record<string, unknown> })

describe('invitar-miembro', () => {
  it('rechaza sin token o con token inválido', async () => {
    const { deps } = montar()
    assert.equal((await manejar(new Request('https://x', { method: 'POST' }), deps)).status, 403)
    assert.equal((await manejar(pedir(invitar, 'otro'), deps)).status, 403)
  })

  it('invita a un correo sin cuenta y emite invitacion_enviada', async () => {
    const { deps, llamadas } = montar()
    const { status, cuerpo } = await leer(await manejar(pedir(invitar), deps))

    assert.equal(status, 201)
    assert.equal(cuerpo.resultado, 'invitacion_enviada')
    assert.deepEqual(llamadas.invitados, ['persona@example.com'])
    assert.deepEqual(llamadas.rpc[2], ['vincular_invitacion', { p_invitacion_id: 'inv-1', p_user_id: 'cuenta-nueva', p_accion: 'invitacion_enviada' }])
  })

  it('una cuenta existente que ya ingresó no se agrega directo: responde el mismo 409 genérico y no deja invitación', async () => {
    const { deps, llamadas } = montar({ cuentas: [{ id: 'cuenta-ingresada', email: 'persona@example.com', last_sign_in_at: AHORA, email_confirmed_at: AHORA }] })
    const { status, cuerpo } = await leer(await manejar(pedir(invitar), deps))

    assert.equal(status, 409)
    assert.equal(cuerpo.error, 'No se puede invitar a ese correo.')
    assert.deepEqual(llamadas.invitados, [])
    assert.deepEqual(llamadas.borradas, [])
    // Se rechaza antes de registrar: no se crea ni se renueva (rol/vencimiento) ninguna invitación.
    assert.deepEqual(llamadas.rpc.map(([nombre]) => nombre), ['puede_invitar'])
    assert.deepEqual(llamadas.tabla, [])
  })

  it('una auto-registración pendiente de confirmar (sin invited_at) no se borra ni se invita: 409 sin tocar la base', async () => {
    const { deps, llamadas } = montar({ cuentas: [{ id: 'cuenta-propia', email: 'persona@example.com', last_sign_in_at: null, email_confirmed_at: null }] })
    const { status, cuerpo } = await leer(await manejar(pedir(invitar), deps))

    assert.equal(status, 409)
    assert.equal(cuerpo.error, 'No se puede invitar a ese correo.')
    assert.deepEqual(llamadas.borradas, [])
    assert.deepEqual(llamadas.rpc.map(([nombre]) => nombre), ['puede_invitar'])
    assert.deepEqual(llamadas.tabla, [])
  })

  it('reenviar reemplaza la cuenta sin ingreso de ESTA invitación y emite invitacion_reenviada', async () => {
    const { deps, llamadas } = montar({
      invitacion: RENOVADA,
      cuentas: [{ id: 'cuenta-vieja', email: 'persona@example.com', last_sign_in_at: null, invited_at: AHORA }],
    })
    const { status, cuerpo } = await leer(await manejar(pedir(invitar), deps))

    assert.equal(status, 201)
    assert.equal(cuerpo.resultado, 'invitacion_reenviada')
    assert.deepEqual(llamadas.borradas, ['cuenta-vieja'])
    assert.deepEqual(llamadas.invitados, ['persona@example.com'])
  })

  it('reenviar a la cuenta de ESTA invitación que abrió el enlace sin definir contraseña emite un enlace nuevo, no la agrega', async () => {
    const { deps, llamadas } = montar({
      invitacion: RENOVADA,
      cuentas: [{ id: 'cuenta-vieja', email: 'persona@example.com', last_sign_in_at: AHORA, email_confirmed_at: AHORA, invited_at: AHORA }],
      vinculadas: [{ id: 'inv-1' }],
    })
    const { status, cuerpo } = await leer(await manejar(pedir(invitar), deps))

    assert.equal(status, 201)
    assert.equal(cuerpo.resultado, 'invitacion_reenviada')
    assert.deepEqual(llamadas.borradas, ['cuenta-vieja'])
    assert.deepEqual(llamadas.invitados, ['persona@example.com'])
    assert.deepEqual(llamadas.rpc[2], ['vincular_invitacion', { p_invitacion_id: 'inv-1', p_user_id: 'cuenta-nueva', p_accion: 'invitacion_reenviada' }])
  })

  it('no borra la cuenta sin ingreso usada por otra invitación pendiente: 409 genérico y compensa', async () => {
    const { deps, llamadas } = montar({
      cuentas: [{ id: 'cuenta-ajena', email: 'persona@example.com', last_sign_in_at: null, invited_at: AHORA }],
      pendientesAjenas: [{ id: 'inv-otra-org' }],
    })
    const { status, cuerpo } = await leer(await manejar(pedir(invitar), deps))

    assert.equal(status, 409)
    assert.equal(cuerpo.error, 'No se puede invitar a ese correo.')
    assert.deepEqual(llamadas.borradas, [])
    assert.deepEqual(llamadas.invitados, [])
    assert.deepEqual(llamadas.tabla, [['delete', 'inv-1']])
  })

  it('adopta la cuenta huérfana (sin ingreso, sin otra invitación) que dejó una cancelación fallida', async () => {
    const { deps, llamadas } = montar({
      cuentas: [{ id: 'cuenta-huerfana', email: 'persona@example.com', last_sign_in_at: null, invited_at: AHORA }],
    })
    const { status, cuerpo } = await leer(await manejar(pedir(invitar), deps))

    assert.equal(status, 201)
    assert.equal(cuerpo.resultado, 'invitacion_reenviada')
    assert.deepEqual(llamadas.borradas, ['cuenta-huerfana'])
    assert.deepEqual(llamadas.invitados, ['persona@example.com'])
    assert.deepEqual(llamadas.rpc[2], ['vincular_invitacion', { p_invitacion_id: 'inv-1', p_user_id: 'cuenta-nueva', p_accion: 'invitacion_reenviada' }])
  })

  it('si falla el envío de una invitación nueva, la elimina para no dejar una pendiente fantasma', async () => {
    const { deps, llamadas } = montar({ inviteError: true })
    const { status } = await leer(await manejar(pedir(invitar), deps))

    assert.equal(status, 502)
    assert.deepEqual(llamadas.tabla, [['delete', 'inv-1']])
    assert.ok(!llamadas.rpc.some(([nombre]) => nombre === 'vincular_invitacion'))
  })

  it('si falla el envío al reenviar tras borrar la cuenta vieja, suelta la cuenta y conserva la invitación', async () => {
    const { deps, llamadas } = montar({
      invitacion: RENOVADA,
      cuentas: [{ id: 'cuenta-vieja', email: 'persona@example.com', last_sign_in_at: null, invited_at: AHORA }],
      inviteError: true,
    })
    const { status } = await leer(await manejar(pedir(invitar), deps))

    assert.equal(status, 502)
    assert.deepEqual(llamadas.tabla, [['update:{"auth_user_id":null}', 'inv-1']])
  })

  it('si no se puede listar las cuentas, responde 502 antes de registrar nada', async () => {
    const { deps, llamadas } = montar({ listError: true })
    const { status } = await leer(await manejar(pedir(invitar), deps))

    assert.equal(status, 502)
    assert.deepEqual(llamadas.rpc.map(([nombre]) => nombre), ['puede_invitar'])
    assert.deepEqual(llamadas.tabla, [])
    assert.deepEqual(llamadas.invitados, [])
  })

  it('si vincular falla, borra la cuenta recién creada, compensa y mapea el código', async () => {
    const { deps, llamadas } = montar({ rpcError: { vincular_invitacion: { message: 'detalle interno de Postgres', code: '23505' } } })
    const { status, cuerpo } = await leer(await manejar(pedir(invitar), deps))

    assert.equal(status, 409)
    assert.equal(cuerpo.error, 'No se puede invitar a ese correo.')
    assert.deepEqual(llamadas.borradas, ['cuenta-nueva'])
    assert.deepEqual(llamadas.tabla, [['delete', 'inv-1']])
  })

  it('un no-administrador recibe 403 con cuenta existente o libre, sin listar cuentas ni registrar nada (FR-009)', async () => {
    const rpcError = { puede_invitar: { message: 'No puede gestionar', code: '42501' } }
    const libre = montar({ rpcError })
    const existente = montar({ rpcError, cuentas: [{ id: 'cuenta-x', email: 'persona@example.com', last_sign_in_at: AHORA, email_confirmed_at: AHORA }] })
    let listados = 0
    const original = existente.deps.admin.auth.admin.listUsers
    existente.deps.admin.auth.admin.listUsers = async (params) => { listados += 1; return original(params) }

    const r1 = await leer(await manejar(pedir(invitar), libre.deps))
    const r2 = await leer(await manejar(pedir(invitar), existente.deps))

    assert.equal(r1.status, 403)
    assert.deepEqual(r2, r1)
    assert.equal(listados, 0)
    assert.deepEqual(existente.llamadas.rpc.map(([nombre]) => nombre), ['puede_invitar'])
    assert.deepEqual(existente.llamadas.borradas, [])
  })

  it('la comprobación de cuenta vinculada filtra por la organización del llamador', async () => {
    const { deps, llamadas } = montar({
      cuentas: [{ id: 'cuenta-x', email: 'persona@example.com', last_sign_in_at: AHORA, email_confirmed_at: AHORA, invited_at: AHORA }],
      vinculadas: [],
    })
    const { status } = await leer(await manejar(pedir(invitar), deps))

    assert.equal(status, 409)
    assert.deepEqual(llamadas.filtros, [['organizacion_id', 'org-1']])
    assert.deepEqual(llamadas.rpc.map(([nombre]) => nombre), ['puede_invitar'])
  })

  it('mapea 403 y no filtra el mensaje interno de otros errores', async () => {
    const prohibido = montar({ rpcError: { registrar_invitacion: { message: 'No puede gestionar', code: '42501' } } })
    assert.equal((await manejar(pedir(invitar), prohibido.deps)).status, 403)

    const otro = montar({ rpcError: { registrar_invitacion: { message: 'relation "x" does not exist', code: '42P01' } } })
    const { status, cuerpo } = await leer(await manejar(pedir(invitar), otro.deps))
    assert.equal(status, 400)
    assert.equal(cuerpo.error, 'No se pudo completar la operación.')
  })

  it('no devuelve el texto de Postgres en 22023/P0002: solo rol/correo inválido tienen mensaje propio', async () => {
    const ajena = montar({ rpcError: { vincular_invitacion: { message: 'La cuenta todavía no ingresó: debe aceptar la invitación', code: '22023' } } })
    const r1 = await leer(await manejar(pedir(invitar), ajena.deps))
    assert.equal(r1.status, 409)
    assert.equal(r1.cuerpo.error, 'No se puede invitar a ese correo.')

    const rol = montar({ rpcError: { registrar_invitacion: { message: 'Rol inválido', code: '22023' } } })
    const r2 = await leer(await manejar(pedir(invitar), rol.deps))
    assert.equal(r2.status, 400)
    assert.equal(r2.cuerpo.error, 'Rol inválido')

    const inexistente = montar({ rpcError: { cancelar_invitacion: { message: 'Invitación inexistente o no pendiente', code: 'P0002' } } })
    const r3 = await leer(await manejar(pedir({ accion: 'cancelar', invitacion_id: 'x' }), inexistente.deps))
    assert.equal(r3.status, 404)
  })

  it('cuenta confirmada que nunca ingresó: 409 genérico, no se registra, no se vincula ni se borra', async () => {
    const { deps, llamadas } = montar({ cuentas: [{ id: 'c1', email: 'persona@example.com', last_sign_in_at: null, email_confirmed_at: AHORA }] })
    const { status, cuerpo } = await leer(await manejar(pedir(invitar), deps))
    assert.equal(status, 409)
    assert.equal(cuerpo.error, 'No se puede invitar a ese correo.')
    assert.deepEqual(llamadas.borradas, [])
    assert.deepEqual(llamadas.rpc.map(([nombre]) => nombre), ['puede_invitar'])
    assert.deepEqual(llamadas.tabla, [])
  })

  it('rechaza correo o rol inválidos antes de tocar la base', async () => {
    const { deps, llamadas } = montar()
    assert.equal((await manejar(pedir({ accion: 'invitar', email: 'x', rol: 'consulta' }), deps)).status, 400)
    assert.equal((await manejar(pedir({ accion: 'invitar', email: 'a@b.co', rol: 'miembro' }), deps)).status, 400)
    assert.deepEqual(llamadas.rpc, [])
  })

  describe('cancelar', () => {
    it('borra la cuenta de Auth sin uso que devuelve el RPC', async () => {
      const { deps, llamadas } = montar({ rpcData: { cancelar_invitacion: 'cuenta-sin-uso' } })
      const { status, cuerpo } = await leer(await manejar(pedir({ accion: 'cancelar', invitacion_id: 'inv-1' }), deps))

      assert.equal(status, 200)
      assert.equal(cuerpo.resultado, 'invitacion_cancelada')
      assert.deepEqual(llamadas.borradas, ['cuenta-sin-uso'])
    })

    it('no borra nada si el RPC no devuelve cuenta', async () => {
      const { deps, llamadas } = montar()
      assert.equal((await manejar(pedir({ accion: 'cancelar', invitacion_id: 'inv-1' }), deps)).status, 200)
      assert.deepEqual(llamadas.borradas, [])
    })

    it('si no puede borrar la cuenta lo informa (502) en vez de reportar éxito', async () => {
      const { deps } = montar({ rpcData: { cancelar_invitacion: 'cuenta-sin-uso' }, deleteUserError: true })
      const { status, cuerpo } = await leer(await manejar(pedir({ accion: 'cancelar', invitacion_id: 'inv-1' }), deps))

      assert.equal(status, 502)
      assert.notEqual(cuerpo.resultado, 'invitacion_cancelada')
    })

    it('mapea 403 (no Administrador) y exige la invitación', async () => {
      const { deps } = montar({ rpcError: { cancelar_invitacion: { message: 'No puede', code: '42501' } } })
      assert.equal((await manejar(pedir({ accion: 'cancelar', invitacion_id: 'inv-1' }), deps)).status, 403)
      assert.equal((await manejar(pedir({ accion: 'cancelar' }), deps)).status, 400)
    })
  })

  it('guarda las asignaciones de empresa en la invitación antes de vincular la cuenta (F-ROL-07)', async () => {
    const asignaciones = [{ empresa_id: 'emp-a', rol_id: 'operador' }]
    const { deps, llamadas } = montar()
    const { status } = await leer(await manejar(pedir({ ...invitar, asignaciones }), deps))

    assert.equal(status, 201)
    assert.deepEqual(llamadas.rpc[2], ['guardar_asignaciones_invitacion', { p_invitacion_id: 'inv-1', p_asignaciones: asignaciones }])
    assert.equal(llamadas.rpc[3][0], 'vincular_invitacion')
  })

  it('si la base rechaza las asignaciones, compensa la invitación y no crea cuenta (F-ROL-07)', async () => {
    const { deps, llamadas } = montar({ rpcError: { guardar_asignaciones_invitacion: { message: 'Empresa fuera de la organización', code: '42501' } } })
    const { status } = await leer(await manejar(pedir({ ...invitar, asignaciones: [{ empresa_id: 'ajena', rol_id: 'operador' }] }), deps))

    assert.equal(status, 400)
    assert.deepEqual(llamadas.tabla, [['delete', 'inv-1']])
    assert.deepEqual(llamadas.invitados, [])
  })

  it('un rol por empresa inválido responde 400 con mensaje propio sin filtrar el de Postgres (F-ROL-07)', async () => {
    const { deps } = montar({ rpcError: { guardar_asignaciones_invitacion: { message: 'Rol inválido para una empresa', code: '22023' } } })
    const { status, cuerpo } = await leer(await manejar(pedir({ ...invitar, asignaciones: [{ empresa_id: 'emp-a', rol_id: 'administrador' }] }), deps))

    assert.equal(status, 400)
    assert.equal(cuerpo.error, 'Las empresas o roles elegidos no son válidos.')
  })

  it('rechaza asignaciones que no son una lista antes de registrar nada (F-ROL-07)', async () => {
    const { deps, llamadas } = montar()
    const { status } = await leer(await manejar(pedir({ ...invitar, asignaciones: 'todas' }), deps))

    assert.equal(status, 400)
    assert.ok(!llamadas.rpc.some(([nombre]) => nombre === 'registrar_invitacion'))
  })
})
