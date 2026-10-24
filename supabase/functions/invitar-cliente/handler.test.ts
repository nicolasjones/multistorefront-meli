// Pruebas de la lógica de `invitar-cliente` (FR-003, FR-004, FR-009, FR-018, SC-001) con clientes simulados.
// Corre con `node --test` (`pnpm test:edge:invitar-cliente`); el handler no importa nada de Deno ni de Supabase.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { manejar, type Deps } from './handler.ts'

const CLIENTE = 'c5000000-0000-0000-0000-000000000001'
const EMPRESA = 'a1000000-0000-0000-0000-000000000001'
const OTRA_EMPRESA = 'a1000000-0000-0000-0000-000000000002'

type Opciones = {
  preparar?: { correo: string; dominio: string; auth_user_id: string | null }
  rpcError?: Record<string, { message: string; code: string }>
  vincularError?: { message: string; code: string }
  cuentas?: { empresa_id: string; estado: string }[]
  inviteError?: boolean
  enviarError?: boolean
  deleteUserError?: boolean
  correoAuth?: string
  actividadError?: boolean
}

function montar(opciones: Opciones = {}) {
  const llamadas = {
    caller: [] as [string, Record<string, unknown>][],
    admin: [] as [string, Record<string, unknown>][],
    invitados: [] as { email: string; redirectTo: string }[],
    creados: [] as { email: string; email_confirm: boolean }[],
    claves: [] as { email: string; redirectTo: string }[],
    borrados: [] as string[],
    consultados: [] as string[],
  }
  const deps: Deps = {
    protocolo: 'https',
    admin: {
      auth: {
        getUser: async (jwt) => jwt === 'valido' ? { data: { user: { id: 'operador-1' } }, error: null } : { data: { user: null }, error: { message: 'x' } },
        admin: {
          inviteUserByEmail: async (email, options) => {
            llamadas.invitados.push({ email, redirectTo: options.redirectTo })
            return opciones.inviteError ? { data: { user: null }, error: { message: 'ya registrado' } } : { data: { user: { id: 'auth-nuevo' } }, error: null }
          },
          createUser: async (options) => {
            llamadas.creados.push(options)
            return opciones.inviteError ? { data: { user: null }, error: { message: 'ya registrado' } } : { data: { user: { id: 'auth-nuevo' } }, error: null }
          },
          getUserById: async (id) => {
            llamadas.consultados.push(id)
            return { data: { user: { email: opciones.correoAuth ?? 'Auth@Example.com' } }, error: null }
          },
          deleteUser: async (id) => {
            llamadas.borrados.push(id)
            return { data: null, error: opciones.deleteUserError ? { message: 'no' } : null }
          },
        },
      },
      rpc: async (nombre, args) => {
        llamadas.admin.push([nombre, args])
        return opciones.vincularError ? { data: null, error: opciones.vincularError } : { data: 'cuenta-1', error: null }
      },
    },
    enviarClave: async (email, redirectTo) => {
      llamadas.claves.push({ email, redirectTo })
      return opciones.enviarError ? { data: null, error: { message: 'smtp' } } : { data: {}, error: null }
    },
    caller: () => ({
      rpc: async (nombre, args) => {
        llamadas.caller.push([nombre, args])
        const error = opciones.rpcError?.[nombre]
        if (error) return { data: null, error }
        if (nombre === 'preparar_cuenta_cliente') {
          return { data: [opciones.preparar ?? { correo: 'Norte@Example.com', dominio: 'sanjavucho.ejemplo.com', auth_user_id: null }], error: null }
        }
        if (nombre === 'registrar_restablecimiento_cuenta_cliente' && opciones.actividadError) return { data: null, error: { message: 'x', code: 'XX000' } }
        if (nombre === 'cuentas_web_de_cliente') return { data: opciones.cuentas ?? [], error: null }
        return { data: null, error: null }
      },
    }),
  }
  return { deps, llamadas }
}

const pedido = (cuerpo: unknown, jwt = 'valido', metodo = 'POST') =>
  new Request('https://x.example/invitar-cliente', {
    method: metodo,
    headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
    body: metodo === 'POST' ? JSON.stringify(cuerpo) : undefined,
  })

describe('invitar-cliente · crear', () => {
  it('invita por correo con redirección al dominio de la tienda, vincula la cuenta activa y no toca usuarios_organizacion (FR-004, SC-001)', async () => {
    const { deps, llamadas } = montar()
    const respuesta = await manejar(pedido({ cliente_id: CLIENTE, empresa_id: EMPRESA }), deps)
    assert.equal(respuesta.status, 200)
    assert.deepEqual(await respuesta.json(), { ok: true })
    assert.deepEqual(llamadas.invitados, [{ email: 'norte@example.com', redirectTo: 'https://sanjavucho.ejemplo.com/definir-contrasena' }])
    assert.deepEqual(llamadas.admin, [['vincular_cuenta_cliente', { p_cliente: CLIENTE, p_empresa: EMPRESA, p_auth_user: 'auth-nuevo', p_actor: 'operador-1' }]])
    // La única escritura va por vincular_cuenta_cliente: ninguna RPC ni acceso a tabla toca la membresía del panel.
    assert.equal(JSON.stringify([...llamadas.admin, ...llamadas.caller]).includes('usuarios_organizacion'), false)
    assert.equal('from' in deps.admin, false)
    assert.deepEqual(llamadas.claves, [])
  })

  it('reutiliza el usuario de Auth del cliente en una segunda tienda: un solo usuario por cliente y enlace de la nueva tienda (FR-003, D1)', async () => {
    const { deps, llamadas } = montar({ preparar: { correo: 'norte@example.com', dominio: 'mundojc.ejemplo.com', auth_user_id: 'auth-existente' } })
    const respuesta = await manejar(pedido({ cliente_id: CLIENTE, empresa_id: OTRA_EMPRESA }), deps)
    assert.equal(respuesta.status, 200)
    assert.deepEqual(llamadas.invitados, [], 'no crea otro usuario de Auth')
    assert.equal(llamadas.admin[0][1].p_auth_user, 'auth-existente')
    assert.deepEqual(llamadas.claves, [{ email: 'auth@example.com', redirectTo: 'https://mundojc.ejemplo.com/definir-contrasena' }])
  })

  it('es idempotente: repetir la acción vincula con el mismo usuario sin crear otro (SC-001)', async () => {
    const { deps, llamadas } = montar({ preparar: { correo: 'norte@example.com', dominio: 'sanjavucho.ejemplo.com', auth_user_id: 'auth-existente' } })
    await manejar(pedido({ cliente_id: CLIENTE, empresa_id: EMPRESA }), deps)
    await manejar(pedido({ cliente_id: CLIENTE, empresa_id: EMPRESA }), deps)
    assert.equal(llamadas.invitados.length, 0)
    assert.deepEqual(llamadas.admin.map(([, args]) => args.p_auth_user), ['auth-existente', 'auth-existente'])
  })

  it('sin invitación crea el usuario sin mandar correo y la cuenta queda activa (FR-015)', async () => {
    const { deps, llamadas } = montar()
    const respuesta = await manejar(pedido({ cliente_id: CLIENTE, empresa_id: EMPRESA, invitar: false }), deps)
    assert.equal(respuesta.status, 200)
    assert.deepEqual(llamadas.creados, [{ email: 'norte@example.com', email_confirm: false }])
    assert.deepEqual(llamadas.invitados, [])
    assert.deepEqual(llamadas.claves, [])
    assert.deepEqual(llamadas.admin[0][0], 'vincular_cuenta_cliente')
  })

  it('reutilizar un usuario con invitación manda el enlace; sin invitación no manda nada', async () => {
    const conInvitacion = montar({ preparar: { correo: 'norte@example.com', dominio: 'sanjavucho.ejemplo.com', auth_user_id: 'auth-existente' } })
    await manejar(pedido({ cliente_id: CLIENTE, empresa_id: EMPRESA }), conInvitacion.deps)
    assert.equal(conInvitacion.llamadas.claves.length, 1)

    const sinInvitacion = montar({ preparar: { correo: 'norte@example.com', dominio: 'sanjavucho.ejemplo.com', auth_user_id: 'auth-existente' } })
    await manejar(pedido({ cliente_id: CLIENTE, empresa_id: EMPRESA, invitar: false }), sinInvitacion.deps)
    assert.equal(sinInvitacion.llamadas.claves.length, 0)
    assert.equal(sinInvitacion.llamadas.invitados.length, 0)
  })

  it('un cliente sin correo se rechaza con su propio mensaje (FR-003)', async () => {
    const { deps, llamadas } = montar({ rpcError: { preparar_cuenta_cliente: { code: '22023', message: 'El cliente no tiene correo' } } })
    const respuesta = await manejar(pedido({ cliente_id: CLIENTE, empresa_id: EMPRESA }), deps)
    assert.equal(respuesta.status, 400)
    assert.match((await respuesta.json() as { error: string }).error, /correo/i)
    assert.equal(llamadas.invitados.length + llamadas.admin.length, 0)
  })

  it('correo de un usuario del panel (D5), cliente de otra organización y tienda no habilitada responden el mismo mensaje (FR-018)', async () => {
    const panel = montar({ inviteError: true })
    const otraOrg = montar({ rpcError: { preparar_cuenta_cliente: { code: 'P0002', message: 'El cliente no pertenece a tu organización' } } })
    const noHabilitada = montar({ rpcError: { preparar_cuenta_cliente: { code: '22023', message: 'El cliente no está habilitado en esa tienda' } } })
    const cuerpos = await Promise.all([panel, otraOrg, noHabilitada].map(async ({ deps }) => {
      const respuesta = await manejar(pedido({ cliente_id: CLIENTE, empresa_id: EMPRESA }), deps)
      return { status: respuesta.status, cuerpo: await respuesta.json() }
    }))
    assert.deepEqual(cuerpos[1], cuerpos[0])
    assert.deepEqual(cuerpos[2], cuerpos[0])
    assert.equal(cuerpos[0].status, 409)
    assert.equal(panel.llamadas.admin.length, 0, 'no vincula si el correo ya era de otro usuario')
  })

  it('si vincular falla borra el usuario recién invitado (sin huérfanos) y no filtra el texto de Postgres', async () => {
    const { deps, llamadas } = montar({ vincularError: { code: '22023', message: 'El correo ya pertenece a un usuario del panel' } })
    const respuesta = await manejar(pedido({ cliente_id: CLIENTE, empresa_id: EMPRESA }), deps)
    assert.equal(respuesta.status, 409)
    assert.equal(JSON.stringify(await respuesta.json()).includes('panel'), false)
    assert.deepEqual(llamadas.borrados, ['auth-nuevo'])
  })

  it('un operador sin permiso o sin alcance recibe 403', async () => {
    const { deps } = montar({ rpcError: { preparar_cuenta_cliente: { code: '42501', message: 'No tenés permiso' } } })
    const respuesta = await manejar(pedido({ cliente_id: CLIENTE, empresa_id: EMPRESA }), deps)
    assert.equal(respuesta.status, 403)
  })
})

const CON_AUTH = { correo: 'Nuevo@Example.com', dominio: 'sanjavucho.ejemplo.com', auth_user_id: 'auth-1' }

describe('invitar-cliente · restablecer', () => {
  it('envía el enlace al correo del usuario de Auth aunque el correo del cliente haya cambiado', async () => {
    const { deps, llamadas } = montar({ preparar: CON_AUTH, correoAuth: 'Viejo@Example.com', cuentas: [{ empresa_id: EMPRESA, estado: 'activa' }] })
    const respuesta = await manejar(pedido({ cliente_id: CLIENTE, empresa_id: EMPRESA, accion: 'restablecer' }), deps)
    assert.equal(respuesta.status, 200)
    assert.deepEqual(llamadas.consultados, ['auth-1'])
    assert.deepEqual(llamadas.claves.map((c) => c.email), ['viejo@example.com'])
  })

  it('si el registro de la actividad falla, el correo ya salió y responde ok con aviso', async () => {
    const { deps, llamadas } = montar({ preparar: CON_AUTH, actividadError: true, cuentas: [{ empresa_id: EMPRESA, estado: 'activa' }] })
    const consola = console.error
    console.error = () => undefined
    const respuesta = await manejar(pedido({ cliente_id: CLIENTE, empresa_id: EMPRESA, accion: 'restablecer' }), deps)
    console.error = consola
    assert.equal(respuesta.status, 200)
    assert.equal(llamadas.claves.length, 1)
    assert.ok((await respuesta.json() as { aviso?: string }).aviso)
  })

  it('con la cuenta activa envía el enlace con redirección a la tienda y deja el evento (FR-009)', async () => {
    const { deps, llamadas } = montar({ preparar: CON_AUTH, cuentas: [{ empresa_id: EMPRESA, estado: 'activa' }] })
    const respuesta = await manejar(pedido({ cliente_id: CLIENTE, empresa_id: EMPRESA, accion: 'restablecer' }), deps)
    assert.equal(respuesta.status, 200)
    assert.deepEqual(llamadas.claves, [{ email: 'auth@example.com', redirectTo: 'https://sanjavucho.ejemplo.com/definir-contrasena' }])
    assert.deepEqual(llamadas.caller.at(-1), ['registrar_restablecimiento_cuenta_cliente', { p_cliente: CLIENTE, p_empresa: EMPRESA }])
    assert.equal(llamadas.admin.length, 0)
  })

  it('con la cuenta suspendida o sin cuenta no envía nada', async () => {
    for (const cuentas of [[{ empresa_id: EMPRESA, estado: 'suspendida' }], [], [{ empresa_id: OTRA_EMPRESA, estado: 'activa' }]]) {
      const { deps, llamadas } = montar({ preparar: CON_AUTH, cuentas })
      const respuesta = await manejar(pedido({ cliente_id: CLIENTE, empresa_id: EMPRESA, accion: 'restablecer' }), deps)
      assert.equal(respuesta.status, 409)
      assert.deepEqual(llamadas.claves, [])
    }
  })

  it('si el correo no sale responde 502 y no registra el evento', async () => {
    const { deps, llamadas } = montar({ preparar: CON_AUTH, cuentas: [{ empresa_id: EMPRESA, estado: 'activa' }], enviarError: true })
    const respuesta = await manejar(pedido({ cliente_id: CLIENTE, empresa_id: EMPRESA, accion: 'restablecer' }), deps)
    assert.equal(respuesta.status, 502)
    assert.equal(llamadas.caller.some(([nombre]) => nombre === 'registrar_restablecimiento_cuenta_cliente'), false)
  })
})

describe('invitar-cliente · entrada', () => {
  it('exige autenticación válida, método POST y datos bien formados', async () => {
    const { deps } = montar()
    assert.equal((await manejar(pedido({ cliente_id: CLIENTE, empresa_id: EMPRESA }, 'malo'), deps)).status, 403)
    assert.equal((await manejar(pedido({}, 'valido', 'GET'), deps)).status, 405)
    assert.equal((await manejar(pedido({ cliente_id: 'no-uuid', empresa_id: EMPRESA }), deps)).status, 400)
    assert.equal((await manejar(pedido({ cliente_id: CLIENTE, empresa_id: EMPRESA, accion: 'borrar' }), deps)).status, 400)
  })
})
