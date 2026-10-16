// Ficha de cliente (F-CLI-01, FR-001/FR-016). El esquema y los límites de
// largo viven en la migración 20261016130000_clientes_ficha_y_numeracion.sql;
// acá se espejan solo para validar en el formulario antes de viajar.

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
  archivado_en: string | null
  tipo: TipoCliente
  es_consumidor_final: boolean
  created_at: string
}

// Tipos fijos (F-CLI-03, FR-008): no se crean ni se borran.
export type TipoCliente = 'minorista' | 'mayorista'

export const CAMPOS_FICHA = [
  'nombre', 'documento', 'correo', 'telefono', 'celular', 'direccion', 'codigo_postal', 'localidad', 'provincia',
] as const
export type CampoFicha = (typeof CAMPOS_FICHA)[number]
export type FormularioCliente = Record<CampoFicha, string>
export type ErroresCliente = Partial<Record<CampoFicha, string>>

export const FORMULARIO_CLIENTE_VACIO: FormularioCliente = {
  nombre: '', documento: '', correo: '', telefono: '', celular: '', direccion: '', codigo_postal: '', localidad: '', provincia: '',
}

export const LARGO_MAXIMO: Readonly<Record<CampoFicha, number>> = {
  nombre: 200, documento: 40, correo: 200, telefono: 60, celular: 60, direccion: 200, codigo_postal: 20, localidad: 120, provincia: 120,
}

export const MENSAJE_DOCUMENTO_REPETIDO = 'Ya existe un cliente con ese DNI/CUIT'

const CORREO_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function aFormulario(cliente: Cliente): FormularioCliente {
  return Object.fromEntries(CAMPOS_FICHA.map((campo) => [campo, cliente[campo] ?? ''])) as FormularioCliente
}

// Los opcionales vacíos viajan como null (la base también los normaliza).
export function aValores(formulario: FormularioCliente): Record<CampoFicha, string | null> {
  return Object.fromEntries(
    CAMPOS_FICHA.map((campo) => {
      const valor = formulario[campo].trim()
      return [campo, campo === 'nombre' ? valor : valor === '' ? null : valor]
    }),
  ) as Record<CampoFicha, string | null>
}

export function validarCliente(formulario: FormularioCliente): ErroresCliente {
  const errores: ErroresCliente = {}
  if (formulario.nombre.trim() === '') {
    errores.nombre = 'Ingresá el nombre o la razón social.'
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
