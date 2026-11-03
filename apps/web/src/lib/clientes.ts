// Ficha de cliente (F-CLI-01, FR-001/FR-016). El esquema y los límites de
// largo viven en la migración 20261016130000_clientes_ficha_y_numeracion.sql;
// acá se espejan solo para validar en el formulario antes de viajar.

import type { EstadoCuentaWebFormulario } from './cuentasCliente'

export type Cliente = {
  id: string
  numero: number
  nombre: string
  documento: string | null
  correo: string | null
  telefono: string | null
  celular: string | null
  direccion: string | null
  codigo_postal: string | null
  localidad: string | null
  provincia: string | null
  expreso_preferido: string | null
  archivado_en: string | null
  tipo: TipoCliente
  es_consumidor_final: boolean
  // Acepta el correo masivo (F-CLI-11): solo a quienes lo aceptan se les escribe.
  acepta_correo_masivo: boolean
  // F-VTA-32: descuento porcentual (0..100) que Ventas aplica sobre la escala; null = sin descuento.
  descuento?: number | null
  created_at: string
}

// Tipos fijos (F-CLI-03, FR-008): no se crean ni se borran.
export type TipoCliente = 'minorista' | 'mayorista'

// Empresa (tienda) en la que está habilitado un cliente. Es lo que devuelve
// `public.buscar_clientes` en la columna `empresas` (F-CLI-05). El cliente es
// único en la organización; esta lista dice en qué tiendas puede comprar.
export type EmpresaDeCliente = { id: string; nombre: string }

export const CAMPOS_FICHA = [
  'nombre', 'documento', 'correo', 'telefono', 'celular', 'direccion', 'codigo_postal', 'localidad', 'provincia',
  'expreso_preferido',
] as const
export type CampoFicha = (typeof CAMPOS_FICHA)[number]
// `empresas` no es una columna de `clientes`: viaja aparte (tabla
// `public.clientes_empresas`, vía public.guardar_empresas_de_cliente). Por eso
// `aValores` lo devuelve separado del resto y quien persiste lo saca antes de
// escribir `clientes`. Ver docs/clientes.md § «Relación con empresas».
export type FormularioCliente = Record<CampoFicha, string> & {
  tipo: TipoCliente
  empresas: string[]
  // F-VTA-32: porcentaje como texto; vacío = sin descuento. Solo lo envía un Administrador (`descuento`
  // no entra en `aValores`: la pantalla lo suma si corresponde).
  descuento: string
  // Campo «Cuenta web» del formulario (F-CLI-05, FR-015): crea o suspende la
  // cuenta en cada tienda tildada al guardar. No es una columna de `clientes`.
  cuentaWeb: EstadoCuentaWebFormulario
  invitarCuentaWeb: boolean
  // Interruptor «Incluir en el correo masivo» (F-CLI-11): columna `clientes.acepta_correo_masivo`.
  aceptaCorreoMasivo: boolean
}
export type ErroresCliente = Partial<Record<CampoFicha | 'descuento', string>>
// Lo que el formulario devuelve aparte de los datos del cliente para que la
// pantalla cree la cuenta web en las tiendas elegidas.
export type OpcionesCuentaWeb = { estado: EstadoCuentaWebFormulario; invitar: boolean }

export const FORMULARIO_CLIENTE_VACIO: FormularioCliente = {
  nombre: '', documento: '', correo: '', telefono: '', celular: '', direccion: '', codigo_postal: '', localidad: '', provincia: '',
  expreso_preferido: '',
  tipo: 'minorista',
  empresas: [],
  descuento: '',
  cuentaWeb: 'sin_cuenta',
  invitarCuentaWeb: true,
  // El alta nace con el interruptor encendido, como el prototipo (F-CLI-11, FR-002).
  aceptaCorreoMasivo: true,
}

// Explicación visible del tipo (FR-008, FR-010): define la escala de precios que usa Ventas.
export const TIPOS_CLIENTE: ReadonlyArray<{ valor: TipoCliente; etiqueta: string; explicacion: string }> = [
  { valor: 'minorista', etiqueta: 'Minorista', explicacion: 'Compra al precio de lista (escala x1).' },
  { valor: 'mayorista', etiqueta: 'Mayorista', explicacion: 'Compra con precio por cantidad.' },
]

export const AVISO_CAMBIO_TIPO =
  'Al cambiar el tipo, las próximas ventas usarán la escala de precios del nuevo tipo. Lo ya vendido no cambia.'

export const LARGO_MAXIMO: Readonly<Record<CampoFicha, number>> = {
  nombre: 200, documento: 40, correo: 200, telefono: 60, celular: 60, direccion: 200, codigo_postal: 20, localidad: 120, provincia: 120,
  expreso_preferido: 120,
}

export const MENSAJE_DOCUMENTO_REPETIDO = 'Ya existe un cliente con ese DNI/CUIT'

const CORREO_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function aFormulario(
  cliente: Cliente,
  empresas: string[] = [],
  cuentaWeb: EstadoCuentaWebFormulario = 'sin_cuenta',
): FormularioCliente {
  const texto = Object.fromEntries(CAMPOS_FICHA.map((campo) => [campo, cliente[campo] ?? '']))
  const descuento = cliente.descuento == null ? '' : String(cliente.descuento)
  return {
    ...texto, tipo: cliente.tipo, empresas, descuento, cuentaWeb, invitarCuentaWeb: true, aceptaCorreoMasivo: cliente.acepta_correo_masivo,
  } as FormularioCliente
}

// Los opcionales vacíos viajan como null (la base también los normaliza).
// `empresas` viaja aparte: no es columna de `clientes` (F-CLI-05).
export function aValores(
  formulario: FormularioCliente,
): Record<CampoFicha, string | null> & { tipo: TipoCliente; empresas: string[]; acepta_correo_masivo: boolean } {
  const texto = Object.fromEntries(
    CAMPOS_FICHA.map((campo) => {
      const valor = formulario[campo].trim()
      return [campo, campo === 'nombre' ? valor : valor === '' ? null : valor]
    }),
  ) as Record<CampoFicha, string | null>
  return { ...texto, tipo: formulario.tipo, empresas: formulario.empresas, acepta_correo_masivo: formulario.aceptaCorreoMasivo }
}

export const MENSAJE_DESCUENTO = 'Ingresá un porcentaje entre 0 y 100, con hasta 2 decimales.'

// Vacío = sin descuento (null). Inválido (fuera de 0..100, más de 2 decimales, no numérico): `undefined`.
export function parsearDescuento(texto: string): number | null | undefined {
  const limpio = texto.trim().replace(',', '.')
  if (limpio === '') return null
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(limpio)) return undefined
  const valor = Number(limpio)
  return valor >= 0 && valor <= 100 ? valor : undefined
}

export function opcionesCuentaWeb(formulario: FormularioCliente): OpcionesCuentaWeb {
  return {
    estado: formulario.cuentaWeb,
    invitar: formulario.cuentaWeb === 'activa' && formulario.invitarCuentaWeb,
  }
}

export function validarCliente(formulario: FormularioCliente): ErroresCliente {
  const errores: ErroresCliente = {}
  if (formulario.nombre.trim() === '') {
    errores.nombre = 'Ingresá el nombre o la razón social.'
  }
  if (parsearDescuento(formulario.descuento) === undefined) {
    errores.descuento = MENSAJE_DESCUENTO
  }
  const correo = formulario.correo.trim()
  if (correo !== '' && !CORREO_VALIDO.test(correo)) {
    errores.correo = 'Ingresá un correo con formato válido.'
  }
  for (const campo of CAMPOS_FICHA) {
    if (!errores[campo] && formulario[campo].trim().length > LARGO_MAXIMO[campo]) {
      errores[campo] = `Máximo ${LARGO_MAXIMO[campo]} caracteres.`
    }
  }
  return errores
}

// 23505 sobre el índice único de documento (FR-016). PostgREST informa el código
// y el nombre de la restricción en el mensaje.
export function esDocumentoRepetido(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false
  }
  const { code, message } = error as { code?: unknown; message?: unknown }
  const texto = typeof message === 'string' ? message : ''
  return texto.includes('clientes_org_documento_uq') || (code === '23505' && texto.includes('documento'))
}

// El mensaje crudo de Postgres/PostgREST puede nombrar políticas, restricciones o
// columnas: al usuario va solo el texto en castellano y el detalle queda en consola.
export function mensajeDeError(error: unknown, porDefecto: string): string {
  console.error(porDefecto, error)
  return porDefecto
}
