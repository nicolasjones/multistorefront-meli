// Etiqueta impresa del cliente (F-CLI-17, FR-001/FR-002). Funciones puras: no
// leen ni escriben datos. Solo la dirección bloquea la etiqueta (CA-CLI-17-1);
// el resto de los datos vacíos se omite de la hoja.

export type DatosEtiquetaCliente = {
  id: string
  nombre: string
  direccion: string | null
  codigo_postal: string | null
  localidad: string | null
  provincia: string | null
  telefono: string | null
  expreso_preferido: string | null
}

// Columnas que se leen de `public.clientes` para armar la hoja.
export const COLUMNAS_ETIQUETA = 'id,nombre,direccion,codigo_postal,localidad,provincia,telefono,expreso_preferido'

export type EtiquetaCliente = { id: string; nombre: string; lineas: string[] }
export type ClienteOmitido = { id: string; nombre: string; faltantes: string[] }

const limpio = (valor: string | null | undefined) => (valor ?? '').trim()

// Datos obligatorios que le faltan al cliente para poder imprimir su etiqueta.
export function faltantes(cliente: DatosEtiquetaCliente): string[] {
  return limpio(cliente.direccion) === '' ? ['dirección'] : []
}

// Etiqueta lista para imprimir, o `null` si falta un dato que la bloquea.
export function armarEtiqueta(cliente: DatosEtiquetaCliente): EtiquetaCliente | null {
  if (faltantes(cliente).length > 0) return null
  const lugar = [limpio(cliente.codigo_postal), limpio(cliente.localidad)].filter(Boolean).join(' ')
  const lineas = [
    limpio(cliente.direccion),
    lugar,
    limpio(cliente.provincia),
    limpio(cliente.telefono) ? `Tel. ${limpio(cliente.telefono)}` : '',
    limpio(cliente.expreso_preferido) ? `Transporte: ${limpio(cliente.expreso_preferido)}` : '',
  ].filter(Boolean)
  return { id: cliente.id, nombre: limpio(cliente.nombre), lineas }
}

// Separa una selección en etiquetas aptas y clientes omitidos con su dato faltante.
export function armarEtiquetas(clientes: readonly DatosEtiquetaCliente[]): { aptas: EtiquetaCliente[]; omitidos: ClienteOmitido[] } {
  const aptas: EtiquetaCliente[] = []
  const omitidos: ClienteOmitido[] = []
  for (const cliente of clientes) {
    const etiqueta = armarEtiqueta(cliente)
    if (etiqueta) aptas.push(etiqueta)
    else omitidos.push({ id: cliente.id, nombre: limpio(cliente.nombre), faltantes: faltantes(cliente) })
  }
  return { aptas, omitidos }
}

export function avisoOmitidos(omitidos: readonly ClienteOmitido[]): string {
  return omitidos.map((o) => `${o.nombre} (falta ${o.faltantes.join(', ')})`).join('; ')
}

export const RUTA_ETIQUETAS = '/clientes/etiquetas'
export const MAXIMO_ETIQUETAS = 200
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function rutaEtiquetas(ids: readonly string[]): string {
  return `${RUTA_ETIQUETAS}?ids=${ids.join(',')}`
}

// Ids válidos del parámetro `ids` (sin repetidos, acotados): la entrada del usuario no llega cruda a la consulta.
export function idsDeParametro(parametro: string | null): string[] {
  const ids = (parametro ?? '').split(',').map((id) => id.trim()).filter((id) => UUID.test(id))
  return [...new Set(ids)].slice(0, MAXIMO_ETIQUETAS)
}
