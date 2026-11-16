import type { SupabaseClient } from '@supabase/supabase-js'
import { type Moneda, parsearImporte } from './productos'
import { resumirPrecios } from './precios'

// Precios por escala del producto (F-PRE-15, FR-024…FR-027). La autoridad es la base
// (`dominio.producto_precios_escala`, `public.guardar_precios_escala`, `private.precio_para`):
// acá solo se arma el formulario y se espeja el margen de cada escala, que se muestra mientras
// se escribe (el precio todavía no se guardó). x1 es el precio de lista del producto: no se
// guarda en la tabla de escalas.

export type Escala = 'x1' | 'x5' | 'x10' | 'x50'
// Escalas con precio propio (las que guarda la tabla).
export type EscalaConPrecio = Exclude<Escala, 'x1'>

export const ESCALAS: ReadonlyArray<{ valor: Escala; rango: string; uso: string }> = [
  { valor: 'x1', rango: '1 a 4 u.', uso: 'todos' },
  { valor: 'x5', rango: '5 a 9 u.', uso: 'mayoristas' },
  { valor: 'x10', rango: '10 a 49 u.', uso: 'mayoristas' },
  { valor: 'x50', rango: '50 u. o más', uso: 'mayoristas' },
]
export const ESCALAS_CON_PRECIO: readonly EscalaConPrecio[] = ['x5', 'x10', 'x50']

// Texto del prototipo adaptado: la escala la define cada tipo de cliente, no la cantidad (spec, decisión 2).
export const TEXTO_USO_ESCALAS = 'Minorista usa x1 · cada tipo de cliente usa su escala'

// Texto escrito en el formulario por escala; '' = sin precio (cae en el precio de lista).
export type PreciosEscala = Record<EscalaConPrecio, string>
export type ErroresEscala = Partial<Record<EscalaConPrecio, string>>

export const PRECIOS_ESCALA_VACIOS: PreciosEscala = { x5: '', x10: '', x50: '' }

export const rotuloEscala = (escala: Escala) => {
  const datos = ESCALAS.find((item) => item.valor === escala)
  return datos ? `${datos.valor} · ${datos.rango}` : escala
}

export const hayCambiosEscalas = (a: PreciosEscala, b: PreciosEscala) =>
  ESCALAS_CON_PRECIO.some((escala) => a[escala].trim() !== b[escala].trim())

export const hayPreciosEscala = (valores: PreciosEscala) => ESCALAS_CON_PRECIO.some((escala) => valores[escala].trim() !== '')

// Vacío es válido (escala sin precio). Cargado: cero o más, hasta 12 enteros y 2 decimales (numeric(14,2)).
export function validarPreciosEscala(valores: PreciosEscala): ErroresEscala {
  const errores: ErroresEscala = {}
  for (const escala of ESCALAS_CON_PRECIO) {
    const texto = valores[escala].trim()
    if (texto !== '' && parsearImporte(texto) === null) {
      errores[escala] = 'Ingresá un precio de cero o más, con hasta 12 enteros y 2 decimales.'
    }
  }
  return errores
}

// Margen de una escala = (precio de la escala − costo) / precio de la escala, en pesos y sobre el neto.
// Sin precio de la escala usa el de lista (así la base resuelve `precio_para`). null sin dato.
export function margenDeEscala(
  entrada: { moneda: Moneda; precioLista: string; costo: string },
  escala: Escala,
  valores: PreciosEscala,
  cotizacion: number | null,
): number | null {
  const propio = escala === 'x1' ? '' : valores[escala].trim()
  const precio = propio === '' ? entrada.precioLista : propio
  return resumirPrecios({ moneda: entrada.moneda, precioLista: precio, costo: entrada.costo }, cotizacion).margen
}

type FilaEscala = { escala: EscalaConPrecio; precio: number | string | null }

const aTexto = (precio: number | string | null) => (precio === null ? '' : String(precio).replace('.', ','))

export async function leerPreciosEscala(cliente: Pick<SupabaseClient, 'schema'>, productoId: string): Promise<PreciosEscala> {
  const { data, error } = await cliente
    .schema('dominio')
    .from('producto_precios_escala')
    .select('escala, precio')
    .eq('producto_id', productoId)
    .returns<FilaEscala[]>()
  if (error) throw error
  const valores = { ...PRECIOS_ESCALA_VACIOS }
  for (const fila of data ?? []) {
    if (ESCALAS_CON_PRECIO.includes(fila.escala)) valores[fila.escala] = aTexto(fila.precio)
  }
  return valores
}

const aNumero = (texto: string) => (texto.trim() === '' ? null : parsearImporte(texto))

export async function guardarPreciosEscala(
  cliente: Pick<SupabaseClient, 'rpc'>,
  productoId: string,
  valores: PreciosEscala,
): Promise<void> {
  const { error } = await cliente.rpc('guardar_precios_escala', {
    p_producto: productoId,
    p_x5: aNumero(valores.x5),
    p_x10: aNumero(valores.x10),
    p_x50: aNumero(valores.x50),
  })
  if (error) throw error
}

// El mensaje crudo de Postgres puede nombrar políticas o columnas: al usuario va solo el texto en
// castellano; quien llama registra el error crudo.
export function mensajeErrorEscalas(error: unknown, porDefecto = 'No pudimos guardar los precios por escala. Probá de nuevo.'): string {
  const code = (error as { code?: string } | null)?.code
  if (code === '42501') return 'Tu rol no puede editar los precios por escala. Puede que haya cambiado: recargá la página.'
  if (code === 'P0002') return 'El producto ya no existe. Recargá la página.'
  if (code === '23514') return 'Revisá los precios por escala: cero o más, con hasta 2 decimales.'
  if (code === '22003') return 'Un precio por escala es demasiado grande. Revisá los valores.'
  return porDefecto
}

// Contrato con Clientes y proveedores (FR-027): `tipos_cliente.escala_precio` es texto (p. ej. «x5»).
// Quien consulta el precio (Ventas, cuenta web) pasa esa escala a `private.precio_para`; sin escala
// definida se usa x1. Un valor fuera de x1/x5/x10/x50 es un error de datos: no se adivina.
export function esEscala(valor: unknown): valor is Escala {
  return valor === 'x1' || valor === 'x5' || valor === 'x10' || valor === 'x50'
}

export function escalaDeTipoCliente(escalaPrecio: string | null | undefined): Escala {
  if (escalaPrecio === null || escalaPrecio === undefined || escalaPrecio.trim() === '') return 'x1'
  const normalizada = escalaPrecio.trim().toLowerCase()
  if (!esEscala(normalizada)) throw new Error(`La escala «${escalaPrecio}» no existe: usá x1, x5, x10 o x50.`)
  return normalizada
}
