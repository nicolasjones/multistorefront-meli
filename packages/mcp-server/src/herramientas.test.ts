import { describe, expect, it, vi } from 'vitest'
import { esClaveDeOrganizacion, nombreHerramienta, registrarHerramientas } from './herramientas.js'
import type { ConexionAutenticada } from './autenticacion.js'

// Mock mínimo de McpServer: solo necesitamos capturar qué se registró.
function crearServidorFalso() {
  const registradas: string[] = []
  return {
    registradas,
    registerTool: vi.fn((nombre: string) => { registradas.push(nombre) }),
  }
}

// Mock de un admin de supabase-js: responde según la tabla/rpc pedida.
function crearAdminFalso(opciones: {
  fuentes: Array<{ feature_id: string; vista: string; descripcion: string | null }>
  acciones: Array<{ feature_id: string; rpc: string; descripcion: string | null }>
  lecturaPermitida: Record<string, boolean>
  ejecucionPermitida: Record<string, boolean>
}) {
  return {
    from: (tabla: string) => ({
      select: () => {
        if (tabla === 'fuentes_mcp') return Promise.resolve({ data: opciones.fuentes })
        if (tabla === 'acciones_mcp') return Promise.resolve({ data: opciones.acciones })
        return Promise.resolve({ data: [] })
      },
    }),
    rpc: (nombre: string, parametros: Record<string, unknown>) => {
      if (nombre === 'puede_mcp_leer_funcionalidad') {
        return Promise.resolve({ data: opciones.lecturaPermitida[parametros.p_feature_id as string] ?? false })
      }
      if (nombre === 'puede_mcp_ejecutar_funcionalidad') {
        return Promise.resolve({ data: opciones.ejecucionPermitida[parametros.p_feature_id as string] ?? false })
      }
      if (nombre === 'resolver_credencial_id_mcp') return Promise.resolve({ data: 'credencial-falsa' })
      return Promise.resolve({ data: null })
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

describe('registrarHerramientas', () => {
  it('nunca registra leer_<feature> para una funcionalidad sin lectura habilitada a nivel plataforma (T014)', async () => {
    const admin = crearAdminFalso({
      fuentes: [
        { feature_id: 'con-lectura', vista: 'v1', descripcion: null },
        { feature_id: 'sin-lectura', vista: 'v2', descripcion: null },
      ],
      acciones: [],
      lecturaPermitida: { 'con-lectura': true, 'sin-lectura': false },
      ejecucionPermitida: {},
    })
    const servidor = crearServidorFalso()
    const conexion: ConexionAutenticada = { organizacionId: 'org-1', credencialId: 'credencial-falsa', admin, token: 'token-falso' }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await registrarHerramientas(servidor as any, conexion)

    expect(servidor.registradas).toContain('leer_con-lectura')
    expect(servidor.registradas).not.toContain('leer_sin-lectura')
  })

  it('nunca registra ejecutar_<feature> para una funcionalidad sin ejecución habilitada a nivel plataforma', async () => {
    const admin = crearAdminFalso({
      fuentes: [],
      acciones: [
        { feature_id: 'con-ejecucion', rpc: 'rpc_x', descripcion: null },
        { feature_id: 'sin-ejecucion', rpc: 'rpc_y', descripcion: null },
      ],
      lecturaPermitida: {},
      ejecucionPermitida: { 'con-ejecucion': true, 'sin-ejecucion': false },
    })
    const servidor = crearServidorFalso()
    const conexion: ConexionAutenticada = { organizacionId: 'org-1', credencialId: 'credencial-falsa', admin, token: 'token-falso' }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await registrarHerramientas(servidor as any, conexion)

    expect(servidor.registradas).toContain('ejecutar_con-ejecucion')
    expect(servidor.registradas).not.toContain('ejecutar_sin-ejecucion')
  })
})

describe('nombres de herramienta', () => {
  it('varias vistas o acciones de una misma funcionalidad no registran dos veces el mismo nombre', async () => {
    const admin = crearAdminFalso({
      fuentes: [
        { feature_id: 'f', vista: 'v_a', descripcion: null },
        { feature_id: 'f', vista: 'v_b', descripcion: null },
      ],
      acciones: [
        { feature_id: 'f', rpc: 'rpc_a', descripcion: null },
        { feature_id: 'f', rpc: 'rpc_b', descripcion: null },
      ],
      lecturaPermitida: { f: true },
      ejecucionPermitida: { f: true },
    })
    const servidor = crearServidorFalso()
    const nombres = new Set<string>()
    servidor.registerTool.mockImplementation((nombre: string) => {
      if (nombres.has(nombre)) throw new Error(`Tool ${nombre} is already registered`)
      nombres.add(nombre)
    })
    const conexion: ConexionAutenticada = { organizacionId: 'org-1', credencialId: 'c', admin, token: 't' }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await registrarHerramientas(servidor as any, conexion)
    expect([...nombres].sort()).toEqual(['ejecutar_f_rpc_a', 'ejecutar_f_rpc_b', 'leer_f_v_a', 'leer_f_v_b'])
  })

  it('con una sola fila por funcionalidad conserva el nombre histórico', () => {
    expect(nombreHerramienta('leer', 'f', 'v', 1)).toBe('leer_f')
    expect(nombreHerramienta('ejecutar', 'f', 'r', 1)).toBe('ejecutar_f')
  })
})

describe('esClaveDeOrganizacion', () => {
  it.each(['organizacion_id', 'organizacionId', 'p_organizacion_id', 'org_id', 'orgId', 'organization_id', 'organizacion'])('reconoce %s', (clave) => {
    expect(esClaveDeOrganizacion(clave)).toBe(true)
  })
  it.each(['producto_id', 'cliente_id', 'organizacion_nombre'])('no toca %s', (clave) => {
    expect(esClaveDeOrganizacion(clave)).toBe(false)
  })
})

describe('ejecutar_*', () => {
  function montar(opciones: { inicio?: { data: unknown; error: unknown }; accion?: { data: unknown; error: unknown }; finalizarError?: boolean }) {
    const llamadas: Array<{ nombre: string; parametros: Record<string, unknown> }> = []
    const vencimientos: unknown[] = []
    const admin = {
      from: (tabla: string) => ({
        select: () => Promise.resolve({ data: tabla === 'acciones_mcp' ? [{ feature_id: 'f', rpc: 'rpc_x', descripcion: null }] : [] }),
        update: (valores: unknown) => {
          vencimientos.push(valores)
          const cadena: Record<string, unknown> = {}
          for (const m of ['eq', 'lt']) cadena[m] = () => cadena
          cadena.then = (resolver: (v: unknown) => void) => resolver({ error: null })
          return cadena
        },
      }),
      rpc: (nombre: string, parametros: Record<string, unknown>) => {
        llamadas.push({ nombre, parametros })
        if (nombre === 'puede_mcp_ejecutar_funcionalidad') return Promise.resolve({ data: true })
        if (nombre === 'iniciar_ejecucion_mcp') return Promise.resolve(opciones.inicio ?? { data: 'ej-1', error: null })
        if (nombre === 'rpc_x') return Promise.resolve(opciones.accion ?? { data: { ok: true }, error: null })
        if (nombre === 'finalizar_ejecucion_mcp') return Promise.resolve({ data: null, error: opciones.finalizarError ? { message: 'boom' } : null })
        return Promise.resolve({ data: null })
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any
    let manejador: (a: { parametros?: Record<string, unknown> }) => Promise<{ content: Array<{ text: string }>; isError?: boolean }> = async () => ({ content: [] })
    const servidor = { registerTool: (_n: string, _c: unknown, h: typeof manejador) => { manejador = h } }
    const conexion: ConexionAutenticada = { organizacionId: 'org-1', credencialId: 'cred-1', admin, token: 't' }
    return { servidor, conexion, llamadas, vencimientos, ejecutar: (parametros?: Record<string, unknown>) => manejador({ parametros }) }
  }

  it('pisa con la organización de la credencial cualquier variante del nombre del parámetro', async () => {
    const m = montar({})
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await registrarHerramientas(m.servidor as any, m.conexion)
    await m.ejecutar({ organizacionId: 'ajena', org_id: 'ajena', p_organizacion_id: 'ajena', cantidad: 3 })
    const accion = m.llamadas.find((l) => l.nombre === 'rpc_x')!
    expect(accion.parametros).toEqual({ organizacionId: 'org-1', org_id: 'org-1', p_organizacion_id: 'org-1', cantidad: 3 })
  })

  it('no devuelve al cliente el mensaje de la base al fallar el inicio ni la acción', async () => {
    const a = montar({ inicio: { data: null, error: { message: 'duplicate key ejecuciones_mcp_en_curso_idx', code: '23505' } } })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await registrarHerramientas(a.servidor as any, a.conexion)
    const r1 = await a.ejecutar()
    expect(r1.isError).toBe(true)
    expect(r1.content[0].text).toBe('EJECUCION_EN_CURSO')

    const b = montar({ accion: { data: null, error: { message: 'relation dominio.secreto does not exist' } } })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await registrarHerramientas(b.servidor as any, b.conexion)
    const r2 = await b.ejecutar()
    expect(r2.content[0].text).toBe('ERROR_AL_EJECUTAR')
  })

  it('vence las ejecuciones abandonadas antes de iniciar y avisa si no puede finalizar', async () => {
    const m = montar({ finalizarError: true })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await registrarHerramientas(m.servidor as any, m.conexion)
    const consola = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const r = await m.ejecutar()
    expect(m.vencimientos).toHaveLength(1)
    expect(m.vencimientos[0]).toMatchObject({ estado: 'fallida', motivo_error: 'vencida' })
    expect(consola).toHaveBeenCalledWith('mcp: no se pudo finalizar la ejecución', 'ej-1', 'boom')
    expect(r.isError).toBeUndefined()
    consola.mockRestore()
  })
})
