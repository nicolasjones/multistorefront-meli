import type { SupabaseClient } from '@supabase/supabase-js'

// IVA por categoría y precio final (F-PRE-12, FR-015…FR-022). La autoridad es la base
// (`dominio.alicuotas_iva`, `private.alicuota_producto`, vista `precios_empresa_final`): acá se
// espeja SOLO la cuenta del texto de ejemplo del formulario de producto, que todavía no tiene
// vista porque el precio no se guardó. Las pantallas de empresa leen el final del servidor.

export type Alicuota = {
  id: string
  nombre: string
  // Porcentaje de IVA (21, 10.5); Exento = 0.
  porcentaje: number
  exento: boolean
}

type FilaAlicuota = { id: string; nombre: string; porcentaje: number | string; exento: boolean }

const formatoPorcentaje = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 })

// «21 %», «10,5 %»; Exento → «Exento».
export const formatearAlicuota = (alicuota: Pick<Alicuota, 'porcentaje' | 'exento'>) =>
  alicuota.exento ? 'Exento' : `${formatoPorcentaje.format(alicuota.porcentaje)} %`

// Valor del selector de producto cuando no tiene IVA propio (hereda el de su categoría).
export const SIN_ALICUOTA_PRODUCTO = ''
export const NOTA_OPCIONES_IVA = 'Opciones: 21 %, 10,5 %, Exento. Cada producto puede tener el suyo.'
export const AYUDA_IVA_EMPRESA = 'El IVA sale de la categoría de cada producto (o del propio producto).'

// Precio final = neto × (1 + alícuota), al centavo, redondeando la mitad ALEJÁNDOSE DEL CERO (igual que `round(numeric, 2)` de
// Postgres, que usa `private.aplicar_iva` y el total del comprobante); Exento ⇒ final = neto (MSF-720).
// Aritmética entera exacta con BigInt: neto y alícuota se toman como los decimales con que se escribieron (la representación
// más corta del número, la misma que se envía a la base) y se operan como fracciones, sin coma flotante ni escala fija:
// coincide con `private.aplicar_iva` con cualquier cantidad de cifras (8 enteras y 3 decimales incluidos).

// «12345678.905» → { signo: 1, mantisa: 12345678905n, decimales: 3 }; admite la notación exponencial de `String(número)`.
function aDecimal(valor: number): { signo: 1n | -1n; mantisa: bigint; decimales: number } {
  const texto = String(Math.abs(valor)).toLowerCase()
  const [cuerpo, exponente = '0'] = texto.split('e')
  const [entero, fraccion = ''] = cuerpo.split('.')
  const decimales = fraccion.length - Number(exponente)
  const digitos = BigInt(entero + fraccion)
  return decimales >= 0
    ? { signo: valor < 0 ? -1n : 1n, mantisa: digitos, decimales }
    : { signo: valor < 0 ? -1n : 1n, mantisa: digitos * 10n ** BigInt(-decimales), decimales: 0 }
}

export function calcularFinal(neto: number, alicuota: Pick<Alicuota, 'porcentaje' | 'exento'>): number {
  if (alicuota.exento || !Number.isFinite(neto) || !Number.isFinite(alicuota.porcentaje)) return alicuota.exento ? neto : Number.NaN
  const n = aDecimal(neto)
  const p = aDecimal(alicuota.porcentaje)
  // centavos = neto × (100 + alícuota) = nm/10^dn × (100·10^dp + pm)/10^dp, redondeado a entero (mitad lejos del cero).
  const numerador = n.mantisa * (100n * 10n ** BigInt(p.decimales) + p.signo * p.mantisa)
  const divisor = 10n ** BigInt(n.decimales + p.decimales)
  const signoNumerador = numerador < 0n ? -1n : 1n
  const absoluto = numerador * signoNumerador
  const cociente = absoluto / divisor
  const centavos = (absoluto % divisor) * 2n >= divisor ? cociente + 1n : cociente
  return Number(n.signo * signoNumerador * centavos) / 100
}

export async function leerAlicuotas(cliente: Pick<SupabaseClient, 'schema'>): Promise<Alicuota[]> {
  const { data, error } = await cliente
    .schema('dominio')
    .from('alicuotas_iva')
    .select('id, nombre, porcentaje, exento')
    .eq('activa', true)
    .order('exento')
    .order('porcentaje', { ascending: false })
    .returns<FilaAlicuota[]>()
  if (error) throw error
  return (data ?? []).map((fila) => ({ ...fila, porcentaje: Number(fila.porcentaje) }))
}

export async function guardarAlicuotaCategoria(
  cliente: Pick<SupabaseClient, 'rpc'>,
  categoriaId: string,
  alicuotaId: string,
): Promise<void> {
  const { error } = await cliente.rpc('guardar_alicuota_categoria', { p_categoria: categoriaId, p_alicuota: alicuotaId })
  if (error) throw error
}

// null = el producto hereda la alícuota de su categoría.
export async function asignarAlicuotaProducto(
  cliente: Pick<SupabaseClient, 'rpc'>,
  productoId: string,
  alicuotaId: string | null,
): Promise<void> {
  const { error } = await cliente.rpc('asignar_alicuota_producto', { p_producto: productoId, p_alicuota: alicuotaId })
  if (error) throw error
}

// El mensaje crudo de Postgres puede nombrar políticas o columnas: al usuario va solo el texto en
// castellano; quien llama registra el error crudo.
export function mensajeErrorIva(error: unknown, porDefecto: string): string {
  const code = (error as { code?: string } | null)?.code
  if (code === '42501') return 'Tu rol no puede cambiar el IVA. Puede que haya cambiado: recargá la página.'
  if (code === 'P0002') return 'La alícuota, la categoría o el producto ya no existen. Recargá la página.'
  if (code === '23514') return 'Esa alícuota no está activa. Elegí otra.'
  return porDefecto
}
