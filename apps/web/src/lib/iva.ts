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
// Postgres, que usa `private.aplicar_iva` y el total del comprobante); Exento ⇒ final = neto (MSF-720). Aritmética decimal exacta con
// BigInt (neto y alícuota a 10 decimales), sin errores de coma flotante: vale también para netos con 3 decimales y negativos.
const ESCALA = 10n ** 10n

function aDecimalEscalado(valor: number): bigint {
  // `toFixed(10)` da los dígitos decimales «de lectura» del número (1.005 → «1.0050000000»), no su expansión binaria.
  const texto = Math.abs(valor).toFixed(10)
  const [entero, fraccion] = texto.split('.')
  const escalado = BigInt(entero) * ESCALA + BigInt(fraccion ?? '0')
  return valor < 0 ? -escalado : escalado
}

export function calcularFinal(neto: number, alicuota: Pick<Alicuota, 'porcentaje' | 'exento'>): number {
  if (alicuota.exento) return neto
  const n = aDecimalEscalado(neto)
  const p = aDecimalEscalado(alicuota.porcentaje)
  // final × 100 (centavos) = neto × (100 + alícuota) / 100 × 100 = n × (100·S + p) / S²  (con n, p escalados por S)
  const numerador = (n < 0n ? -n : n) * (100n * ESCALA + p)
  const divisor = ESCALA * ESCALA
  const cociente = numerador / divisor
  const centavos = (numerador % divisor) * 2n >= divisor ? cociente + 1n : cociente
  return (n < 0n ? -Number(centavos) : Number(centavos)) / 100
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
