// Stock (F-STK-02, FR-002/FR-003/FR-009). El esquema y las reglas viven en las
// migraciones 20261017140000_stock_existencias_y_movimientos.sql y
// 20261017140100_stock_registrar_movimiento.sql; acá se espejan solo para validar
// y previsualizar en el diálogo antes de viajar (la autoridad es la base).

export type TipoMovimiento = 'entrada' | 'salida' | 'ajuste'

export const TIPOS_MOVIMIENTO: ReadonlyArray<{ valor: TipoMovimiento; etiqueta: string }> = [
  { valor: 'entrada', etiqueta: 'Entrada' },
  { valor: 'salida', etiqueta: 'Salida' },
  { valor: 'ajuste', etiqueta: 'Ajuste' },
]

export const LARGO_MAXIMO_NOTA = 500
export const LARGO_MAXIMO_MOTIVO = 80
export const MENSAJE_MOVIMIENTO_REGISTRADO = 'Movimiento registrado'

export type FormularioMovimiento = {
  tipo: TipoMovimiento
  producto_id: string
  // Depósito sobre el que se aplica el movimiento (F-STK-14, FR-008/FR-010).
  deposito_id: string
  // Unidades (entrada/salida) o stock contado (ajuste), tal como las escribe la persona.
  cantidad: string
  fecha: string
  motivo_id: string
  nota: string
}

export type CampoMovimiento = keyof FormularioMovimiento
export type ErroresMovimiento = Partial<Record<CampoMovimiento, string>>

export type MotivoMovimiento = {
  id: string
  nombre: string
  aplica_a: TipoMovimiento[]
  activo: boolean
}

// Fecha local en formato YYYY-MM-DD (la que entiende <input type="date"> y la RPC).
export function fechaDeHoy(ahora: Date = new Date()): string {
  const mes = String(ahora.getMonth() + 1).padStart(2, '0')
  const dia = String(ahora.getDate()).padStart(2, '0')
  return `${ahora.getFullYear()}-${mes}-${dia}`
}

export function formularioMovimientoVacio(productoId = '', depositoId = ''): FormularioMovimiento {
  return { tipo: 'entrada', producto_id: productoId, deposito_id: depositoId, cantidad: '', fecha: fechaDeHoy(), motivo_id: '', nota: '' }
}

// Entero sin signo, sin decimales ni separadores; acota a int4 como la columna.
const ENTERO_VALIDO = /^\d{1,9}$/

export function parsearCantidad(texto: string): number | null {
  const limpio = texto.trim()
  return ENTERO_VALIDO.test(limpio) ? Number(limpio) : null
}

// Stock que quedaría tras el movimiento; null mientras la cantidad no sea válida.
export function stockResultante(tipo: TipoMovimiento, actual: number, cantidad: string): number | null {
  const valor = parsearCantidad(cantidad)
  if (valor === null) return null
  if (tipo === 'entrada') return actual + valor
  if (tipo === 'salida') return actual - valor
  return valor
}

export const TITULO_STOCK_INSUFICIENTE = 'No hay stock suficiente'

const unidades = (n: number) => `${n} ${n === 1 ? 'unidad' : 'unidades'}`

// Aviso de F-STK-06 (FR-018): null mientras el movimiento no deje el stock en negativo.
// Solo la salida puede hacerlo desde el formulario (el ajuste admite 0 pero no negativos).
export function avisoStockInsuficiente(tipo: TipoMovimiento, actual: number, cantidad: string): string | null {
  const resultante = stockResultante(tipo, actual, cantidad)
  if (resultante === null || resultante >= 0) return null
  return `Hay ${unidades(actual)} y la salida es de ${parsearCantidad(cantidad)}. Reducí la cantidad para continuar.`
}

export function motivosDelTipo(motivos: readonly MotivoMovimiento[], tipo: TipoMovimiento): MotivoMovimiento[] {
  // El motivo de sistema del traslado se usa solo desde «Trasladar» (F-STK-15).
  return motivos.filter((motivo) => motivo.activo && motivo.aplica_a.includes(tipo) && !esMotivoDeTraslado(motivo.nombre))
}

export const NOMBRE_MOTIVO_TRASLADO = 'Traslado entre depósitos'

export function esMotivoDeTraslado(nombre: string): boolean {
  return nombre.trim().toLowerCase() === NOMBRE_MOTIVO_TRASLADO.toLowerCase()
}

export function validarMovimiento(formulario: FormularioMovimiento, hoy: string = fechaDeHoy()): ErroresMovimiento {
  const errores: ErroresMovimiento = {}
  if (formulario.producto_id === '') {
    errores.producto_id = 'Elegí un producto.'
  }
  if (formulario.deposito_id === '') {
    errores.deposito_id = 'Elegí un depósito.'
  }
  const cantidad = parsearCantidad(formulario.cantidad)
  if (formulario.tipo === 'ajuste') {
    if (cantidad === null) errores.cantidad = 'Ingresá el stock contado: un entero de cero o más.'
  } else if (cantidad === null || cantidad <= 0) {
    errores.cantidad = 'Ingresá una cantidad entera mayor a cero.'
  }
  if (formulario.fecha === '') {
    errores.fecha = 'Ingresá la fecha.'
  } else if (formulario.fecha > hoy) {
    errores.fecha = 'La fecha no puede ser futura.'
  }
  if (formulario.motivo_id === '') {
    errores.motivo_id = 'Elegí un motivo.'
  }
  if (formulario.nota.trim().length > LARGO_MAXIMO_NOTA) {
    errores.nota = `Máximo ${LARGO_MAXIMO_NOTA} caracteres.`
  }
  return errores
}

// El mensaje crudo de Postgres/PostgREST puede nombrar políticas o columnas: al
// usuario va solo el texto en castellano y el detalle queda en consola.
export function mensajeDeErrorStock(error: unknown, porDefecto: string): string {
  console.error(porDefecto, error)
  const code = (error as { code?: string } | null)?.code
  if (code === '42501') return 'No tenés permiso para esta acción. Puede que tu rol haya cambiado: recargá la página.'
  if (code === '22023') return 'Algún dato no es válido. Revisá el formulario e intentá de nuevo.'
  if (code === '23505') return 'Ya existe un motivo con ese nombre.'
  return porDefecto
}

// Stock mínimo y estados (F-STK-05, FR-013…FR-015). Los estados los calcula la vista
// `public.stock_estados` (migración 20261017160000_stock_minimo_y_estados.sql); acá solo
// se rotulan. El mínimo es un entero >= 0 y cabe en un `integer` de Postgres.
export type EstadoStock = 'sin_stock' | 'stock_bajo' | 'disponible'

export const ESTADOS_STOCK: ReadonlyArray<{ valor: EstadoStock; etiqueta: string; variante: 'error' | 'aviso' | 'exito' }> = [
  { valor: 'sin_stock', etiqueta: 'Sin stock', variante: 'error' },
  { valor: 'stock_bajo', etiqueta: 'Stock bajo', variante: 'aviso' },
  { valor: 'disponible', etiqueta: 'Disponible', variante: 'exito' },
]

export const MAXIMO_MINIMO = 2147483647

export function validarMinimo(texto: string): { valor: number } | { error: string } {
  const recortado = texto.trim()
  if (!/^\d+$/.test(recortado) || Number(recortado) > MAXIMO_MINIMO) {
    return { error: 'El mínimo debe ser un entero de cero o más.' }
  }
  return { valor: Number(recortado) }
}

// Arma el filtro `or` de PostgREST para buscar por nombre o SKU. Se quitan los
// caracteres que separan o agrupan condiciones (`,` `(` `)` `"` `\`) y se escapan los
// comodines de LIKE (`%` `_`), para que lo tipeado no altere la consulta.
export function filtroBusquedaStock(texto: string): string | null {
  const limpio = texto.slice(0, 80).replace(/[,()"\\]/g, ' ').replace(/[%_]/g, (c) => `\\${c}`).trim()
  if (limpio === '') return null
  return `nombre.ilike.%${limpio}%,sku.ilike.%${limpio}%`
}

// Solo para registrar movimientos: ahí `23514` con mensaje «No hay stock suficiente» es el disparador de stock
// negativo; otros checks de `movimientos_stock` (nota, cantidad, saldo) usan el mensaje genérico.
// En otras pantallas (p. ej. motivos) el mismo código es un check de nombre y no
// debe leerse como falta de stock.
export function esStockInsuficiente(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | null
  return e?.code === '23514' && (e.message ?? '').includes(TITULO_STOCK_INSUFICIENTE)
}

export function mensajeDeErrorMovimiento(error: unknown, porDefecto: string): string {
  if (esStockInsuficiente(error)) {
    console.error(porDefecto, error)
    return `${TITULO_STOCK_INSUFICIENTE}. El stock cambió mientras cargabas el movimiento: revisá la cantidad e intentá de nuevo.`
  }
  return mensajeDeErrorStock(error, porDefecto)
}
