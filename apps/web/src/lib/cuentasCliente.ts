import { supabaseClient } from './supabase'

// Cuenta web del cliente (F-CLI-05, FR-002/FR-004/FR-008/FR-009/FR-010/FR-013).
// La cuenta vive en `public.cuentas_cliente`, una fila por (cliente, tienda).
// «Sin cuenta» (no hay fila) y «No habilitado» (el cliente no está en
// `clientes_empresas`) se derivan; «No habilitado» prevalece sobre el guardado.
// Las escrituras pasan por la Edge Function `invitar-cliente` y por las RPC de
// la base: acá no se toca `usuarios_organizacion` (la cuenta no es del panel).

export type EstadoGuardadoCuentaWeb = 'activa' | 'suspendida'
export type EstadoCuentaWeb = EstadoGuardadoCuentaWeb | 'sin_cuenta' | 'no_habilitado'
export type EstadoCuentaWebFormulario = 'sin_cuenta' | 'activa' | 'suspendida'

export type CuentaWeb = {
  empresa_id: string
  estado: EstadoGuardadoCuentaWeb
  correo: string
  ultimo_ingreso: string | null
}

export type EmpresaCuentaWeb = { id: string; nombre: string }

export type TiendaCuentaWeb = {
  empresaId: string
  nombre: string
  habilitada: boolean
  estado: EstadoCuentaWeb
  correo: string | null
  ultimoIngreso: string | null
}

export const TEXTOS_ESTADO_CUENTA_WEB: Readonly<Record<EstadoCuentaWeb, { etiqueta: string; descripcion: string; variante: 'exito' | 'aviso' | 'neutral' }>> = {
  activa: { etiqueta: 'Activa', descripcion: 'Puede ingresar a las tiendas con su correo.', variante: 'exito' },
  suspendida: { etiqueta: 'Suspendida', descripcion: 'No puede ingresar hasta que la reactives.', variante: 'aviso' },
  sin_cuenta: { etiqueta: 'Sin cuenta', descripcion: 'El cliente compra sin registrarse.', variante: 'neutral' },
  no_habilitado: { etiqueta: 'No habilitado', descripcion: 'El cliente no puede comprar en esta tienda.', variante: 'neutral' },
}

export const NOTA_CUENTA_WEB_FORMULARIO: Readonly<Record<EstadoCuentaWebFormulario, string>> = {
  sin_cuenta: 'El cliente compra sin registrarse.',
  activa: 'Puede ingresar a las tiendas con su correo.',
  suspendida: 'No puede ingresar hasta que lo reactives.',
}

// «No habilitado» prevalece sobre el estado guardado (FR-002).
export function estadoEfectivoCuentaWeb(habilitada: boolean, guardado: EstadoGuardadoCuentaWeb | null | undefined): EstadoCuentaWeb {
  if (!habilitada) return 'no_habilitado'
  return guardado ?? 'sin_cuenta'
}

// Estado de una tienda combinando la habilitación (clientes_empresas), la fila
// guardada y el correo de acceso del cliente (el mismo para todas las tiendas).
export function tiendaCuentaWeb(
  empresa: EmpresaCuentaWeb,
  habilitadas: ReadonlyArray<string>,
  cuentas: ReadonlyArray<CuentaWeb>,
  correoCliente: string | null,
): TiendaCuentaWeb {
  const habilitada = habilitadas.includes(empresa.id)
  const cuenta = cuentas.find((fila) => fila.empresa_id === empresa.id)
  return {
    empresaId: empresa.id,
    nombre: empresa.nombre,
    habilitada,
    estado: estadoEfectivoCuentaWeb(habilitada, cuenta?.estado),
    correo: cuenta ? (cuenta.correo || correoCliente) : correoCliente,
    ultimoIngreso: cuenta?.ultimo_ingreso ?? null,
  }
}

// Agregado para la columna «Cuenta web» del listado (D4): si hay una tienda
// elegida se muestra su estado; en «Todas mis empresas», Activa si alguna lo
// está, si no Suspendida si alguna lo está, y si no Sin cuenta.
export function estadoCuentaWebListado(
  cuentas: ReadonlyArray<CuentaWeb>,
  empresaId: string | null,
): EstadoCuentaWebFormulario {
  if (empresaId) {
    return cuentas.find((cuenta) => cuenta.empresa_id === empresaId)?.estado ?? 'sin_cuenta'
  }
  if (cuentas.some((cuenta) => cuenta.estado === 'activa')) return 'activa'
  if (cuentas.some((cuenta) => cuenta.estado === 'suspendida')) return 'suspendida'
  return 'sin_cuenta'
}

// Formato del prototipo: «05/10/2026 · 18:20». Sin ingreso, un guion.
export function formatearUltimoIngreso(iso: string | null): string {
  if (!iso) return '—'
  const fecha = new Date(iso)
  if (Number.isNaN(fecha.getTime())) return '—'
  const texto = new Intl.DateTimeFormat('es-AR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(fecha)
  return texto.replace(', ', ' · ')
}

// ============================================================================
// Consultas y acciones
// ============================================================================

export async function listarCuentasWebDeCliente(clienteId: string): Promise<CuentaWeb[]> {
  const { data, error } = await supabaseClient.rpc('cuentas_web_de_cliente', { p_cliente: clienteId })
  if (error) throw new Error(mensajeDeErrorCuentaWeb(error))
  return (data ?? []) as CuentaWeb[]
}

function mensajeDeErrorCuentaWeb(error: unknown): string {
  const codigo = (error as { code?: unknown } | null)?.code
  if (codigo === '42501') return 'No tenés permiso para gestionar cuentas web de esta tienda.'
  if (codigo === 'P0002') return 'El cliente o la cuenta ya no existen.'
  if (codigo === '22023') return 'Los datos de la cuenta web no son válidos.'
  return 'No pudimos completar la operación.'
}

type CuerpoFuncion = { ok?: boolean; error?: string }

// La Edge Function devuelve el motivo controlado en el cuerpo; nunca se muestra
// el texto crudo de Postgres. Si no hay cuerpo, se usa un mensaje genérico.
async function errorDeFuncion(error: unknown, data: unknown): Promise<never> {
  const delCuerpo = (data as CuerpoFuncion | null)?.error
  if (delCuerpo) throw new Error(delCuerpo)

  const contexto = (error as { context?: { json?: () => Promise<unknown> } } | null)?.context
  if (contexto?.json) {
    try {
      const cuerpo = (await contexto.json()) as CuerpoFuncion | null
      if (cuerpo?.error) throw new Error(cuerpo.error)
    } catch (excepcion) {
      if (excepcion instanceof Error && excepcion.message !== 'Unexpected end of JSON input') throw excepcion
    }
  }
  throw new Error('No pudimos completar la operación.')
}

// Crear (acción «crear») o reenviar el enlace de clave (acción «restablecer»).
// `invitar=false` crea la cuenta sin mandar el correo de invitación (la casilla
// «Enviar invitación por correo al crear la cuenta» del formulario).
export async function invitarCuentaWeb(
  clienteId: string,
  empresaId: string,
  accion: 'crear' | 'restablecer' = 'crear',
  invitar = true,
): Promise<void> {
  const { data, error } = await supabaseClient.functions.invoke<CuerpoFuncion>('invitar-cliente', {
    body: { cliente_id: clienteId, empresa_id: empresaId, accion, invitar },
  })
  if (error || data?.ok !== true) await errorDeFuncion(error, data)
}

export async function cambiarEstadoCuentaWeb(
  clienteId: string,
  empresaId: string,
  estado: EstadoGuardadoCuentaWeb,
): Promise<void> {
  const { error } = await supabaseClient.rpc('cambiar_estado_cuenta_cliente', {
    p_cliente: clienteId, p_empresa: empresaId, p_estado: estado,
  })
  if (error) throw new Error(mensajeDeErrorCuentaWeb(error))
}

// «Habilitado en» y «Habilitar en <Tienda>» reutilizan la RPC existente y
// conservan la cuenta guardada: deshabilitar deriva «No habilitado» sin borrarla.
export async function guardarTiendasDeCliente(clienteId: string, empresaIds: ReadonlyArray<string>): Promise<void> {
  const { error } = await supabaseClient.rpc('guardar_empresas_de_cliente', {
    p_cliente_id: clienteId, p_empresa_ids: [...empresaIds],
  })
  if (error) throw new Error(mensajeDeErrorCuentaWeb(error))
}

export type ResultadoCuentaWebTiendas = { creadas: number; errores: number }

// Aplica el campo «Cuenta web» del formulario al guardar (FR-015): crea la
// cuenta en cada tienda tildada que todavía no la tenga, suspende o reactiva
// según el estado elegido y nunca reenvía la invitación de una cuenta que ya
// existía. Si el operador no cambió el campo (`estado === estadoPrevio`) no se
// transiciona ninguna cuenta existente: con estados mixtos entre tiendas, editar
// otro dato no reactiva ni suspende nada. Los fallos de una tienda no impiden el resto; quien llama informa.
export async function aplicarCuentaWebEnTiendas(
  clienteId: string,
  tiendas: ReadonlyArray<string>,
  estado: EstadoCuentaWebFormulario,
  invitar: boolean,
  estadoPrevio?: EstadoCuentaWebFormulario,
): Promise<ResultadoCuentaWebTiendas> {
  if (estado === 'sin_cuenta' || tiendas.length === 0) return { creadas: 0, errores: 0 }
  const existentes = await listarCuentasWebDeCliente(clienteId)
  let creadas = 0
  let errores = 0
  for (const empresaId of tiendas) {
    const cuenta = existentes.find((fila) => fila.empresa_id === empresaId)
    try {
      if (!cuenta) {
        await invitarCuentaWeb(clienteId, empresaId, 'crear', invitar)
        creadas += 1
        if (estado === 'suspendida') await cambiarEstadoCuentaWeb(clienteId, empresaId, 'suspendida')
      } else if (estado === estadoPrevio) {
        continue
      } else if (estado === 'suspendida' && cuenta.estado === 'activa') {
        await cambiarEstadoCuentaWeb(clienteId, empresaId, 'suspendida')
      } else if (estado === 'activa' && cuenta.estado === 'suspendida') {
        await cambiarEstadoCuentaWeb(clienteId, empresaId, 'activa')
      }
    } catch (error) {
      errores += 1
      console.error('No se pudo aplicar la cuenta web en la tienda', empresaId, error instanceof Error ? error.message : error)
    }
  }
  return { creadas, errores }
}

export async function habilitarTiendaDeCliente(
  clienteId: string,
  empresaId: string,
  habilitada: boolean,
): Promise<string[]> {
  // `guardar_empresas_de_cliente` reemplaza el conjunto completo: se relee el estado actual para no pisar
  // cambios de otro operador hechos mientras la ficha estaba abierta.
  const { data, error } = await supabaseClient
    .from('clientes_empresas')
    .select('empresa_id')
    .eq('cliente_id', clienteId)
    .returns<{ empresa_id: string }[]>()
  if (error) throw new Error(mensajeDeErrorCuentaWeb(error))
  const actuales = (data ?? []).map((fila) => fila.empresa_id)
  const siguiente = habilitada
    ? Array.from(new Set([...actuales, empresaId]))
    : actuales.filter((id) => id !== empresaId)
  await guardarTiendasDeCliente(clienteId, siguiente)
  return siguiente
}
