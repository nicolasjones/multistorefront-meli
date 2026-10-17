// Alta de producto (F-CAT-02, FR-001/FR-004). El esquema y los límites viven en
// las migraciones 20261017120100_catalogo_productos_y_costos.sql y
// 20261017120200_catalogo_crear_producto.sql; acá se espejan solo para validar
// en el formulario antes de viajar (la autoridad es la base).

export type Moneda = 'USD' | 'ARS'

export const MONEDAS: ReadonlyArray<{ valor: Moneda; etiqueta: string }> = [
  { valor: 'USD', etiqueta: 'USD · dólares' },
  { valor: 'ARS', etiqueta: 'ARS · pesos' },
]

export type FormularioProducto = {
  nombre: string
  descripcion: string
  sku: string
  // Valores libres separados por coma (las sugerencias son F-CAT-09, fuera de alcance).
  compatible_con: string
  moneda: Moneda
  precio_lista: string
  costo: string
}

export type CampoProducto = keyof FormularioProducto
export type ErroresProducto = Partial<Record<CampoProducto, string>>

export const FORMULARIO_PRODUCTO_VACIO: FormularioProducto = {
  nombre: '', descripcion: '', sku: '', compatible_con: '', moneda: 'USD', precio_lista: '', costo: '',
}

export const LARGO_MAXIMO: Readonly<Partial<Record<CampoProducto, number>>> = {
  nombre: 200, descripcion: 4000, sku: 80,
}

export const AVISO_FALTAN_DATOS = 'Faltan datos obligatorios'
export const PRECIO_EN_PESOS_NO_DISPONIBLE = 'No disponible'
export const MENSAJE_SKU_REPETIDO = 'Ese SKU ya existe'
export const AYUDA_SKU = 'Se genera sola si lo dejás vacío'

const MAX_COMPATIBLES = 50
const MAX_LARGO_COMPATIBLE = 100

// Acepta «1234,50» o «1234.50»; rechaza miles, letras, más de 2 decimales y más de
// 12 enteros (la columna es numeric(14,2): más desborda en la base o pierde precisión).
const IMPORTE_VALIDO = /^\d{1,12}([.,]\d{1,2})?$/

export function parsearImporte(texto: string): number | null {
  const limpio = texto.trim()
  return IMPORTE_VALIDO.test(limpio) ? Number(limpio.replace(',', '.')) : null
}

export function separarCompatibles(texto: string): string[] {
  const vistos = new Set<string>()
  for (const valor of texto.split(',')) {
    const limpio = valor.trim()
    if (limpio !== '') {
      vistos.add(limpio)
    }
  }
  return [...vistos]
}

export function validarProducto(formulario: FormularioProducto, { conCosto }: { conCosto: boolean }): ErroresProducto {
  const errores: ErroresProducto = {}
  if (formulario.nombre.trim() === '') {
    errores.nombre = 'Ingresá el nombre del producto.'
  }
  const precio = parsearImporte(formulario.precio_lista)
  if (formulario.precio_lista.trim() === '') {
    errores.precio_lista = 'Ingresá el precio de lista.'
  } else if (precio === null || precio <= 0) {
    errores.precio_lista = 'Ingresá un precio mayor a cero, con hasta 12 enteros y 2 decimales.'
  }
  if (conCosto && formulario.costo.trim() !== '' && parsearImporte(formulario.costo) === null) {
    errores.costo = 'Ingresá un costo de cero o más, con hasta 12 enteros y 2 decimales.'
  }
  for (const campo of ['nombre', 'descripcion', 'sku'] as const) {
    const maximo = LARGO_MAXIMO[campo] ?? 0
    if (!errores[campo] && formulario[campo].trim().length > maximo) {
      errores[campo] = `Máximo ${maximo} caracteres.`
    }
  }
  const compatibles = separarCompatibles(formulario.compatible_con)
  if (compatibles.length > MAX_COMPATIBLES || compatibles.some((valor) => valor.length > MAX_LARGO_COMPATIBLE)) {
    errores.compatible_con = `Hasta ${MAX_COMPATIBLES} valores de ${MAX_LARGO_COMPATIBLE} caracteres.`
  }
  return errores
}

// Parámetros de public.crear_producto. Sin stock (FR-002); el costo solo viaja
// si el usuario puede cargarlo (la base lo rechaza igual si no).
export type ParametrosCrearProducto = {
  p_nombre: string
  p_descripcion: string | null
  p_sku: string | null
  p_compatible_con: string[]
  p_moneda: Moneda
  p_precio_lista: number
  p_costo: number | null
}

export function aParametrosCrear(formulario: FormularioProducto, { conCosto }: { conCosto: boolean }): ParametrosCrearProducto {
  const costo = conCosto ? parsearImporte(formulario.costo) : null
  return {
    p_nombre: formulario.nombre.trim(),
    p_descripcion: formulario.descripcion.trim() === '' ? null : formulario.descripcion.trim(),
    p_sku: formulario.sku.trim() === '' ? null : formulario.sku.trim(),
    p_compatible_con: separarCompatibles(formulario.compatible_con),
    p_moneda: formulario.moneda,
    p_precio_lista: parsearImporte(formulario.precio_lista) ?? 0,
    p_costo: costo,
  }
}

// ¿Hay algo cargado que se perdería al salir? (diálogo «Descartar cambios»).
export function hayCambios(actual: FormularioProducto, inicial: FormularioProducto): boolean {
  return (Object.keys(actual) as CampoProducto[]).some((campo) => actual[campo].trim() !== inicial[campo].trim())
}

// El mensaje crudo de Postgres/PostgREST puede nombrar políticas, restricciones o
// columnas: al usuario va solo el texto en castellano y el detalle queda en consola.
export function mensajeDeError(error: unknown, porDefecto: string): string {
  console.error(porDefecto, error)
  const code = (error as { code?: string } | null)?.code
  if (code === '42501') return 'No tenés permiso para esta acción. Puede que tu rol haya cambiado: recargá la página.'
  // F-CAT-03: el índice único de SKU (alta o edición, también ante carreras).
  if (code === '23505') return MENSAJE_SKU_REPETIDO
  if (code === '22023') return 'Algún dato no es válido. Revisá el formulario e intentá de nuevo.'
  if (code === '22003') return 'Un importe es demasiado grande. Revisá el precio y el costo.'
  return porDefecto
}
