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
  // F-PRV-03: proveedor (id; '' = sin proveedor) y código con el que el proveedor lo conoce.
  proveedor_id: string
  codigo_proveedor: string
}

export type CampoProducto = keyof FormularioProducto
export type ErroresProducto = Partial<Record<CampoProducto, string>>

export const FORMULARIO_PRODUCTO_VACIO: FormularioProducto = {
  nombre: '', descripcion: '', sku: '', compatible_con: '', moneda: 'USD', precio_lista: '', costo: '',
  proveedor_id: '', codigo_proveedor: '',
}

export const LARGO_MAXIMO: Readonly<Partial<Record<CampoProducto, number>>> = {
  nombre: 200, descripcion: 4000, sku: 80, codigo_proveedor: 80,
}

export const AVISO_FALTAN_DATOS = 'Faltan datos obligatorios'
export const PRECIO_EN_PESOS_NO_DISPONIBLE = 'No disponible'
export const MENSAJE_SKU_REPETIDO = 'Ese SKU ya existe'
export const AYUDA_SKU = 'Se genera solo si lo dejás vacío'

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
  for (const campo of ['nombre', 'descripcion', 'sku', 'codigo_proveedor'] as const) {
    const maximo = LARGO_MAXIMO[campo] ?? 0
    if (!errores[campo] && formulario[campo].trim().length > maximo) {
      errores[campo] = `Máximo ${maximo} caracteres.`
    }
  }
  if (!errores.codigo_proveedor && formulario.proveedor_id === '' && formulario.codigo_proveedor.trim() !== '') {
    errores.codigo_proveedor = 'Elegí un proveedor para cargar su código.'
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
  // F-PRV-03: opcionales; sin proveedor no hay código (la base lo exige igual).
  p_proveedor_id: string | null
  p_codigo_proveedor: string | null
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
    p_proveedor_id: formulario.proveedor_id === '' ? null : formulario.proveedor_id,
    p_codigo_proveedor: formulario.proveedor_id === '' || formulario.codigo_proveedor.trim() === '' ? null : formulario.codigo_proveedor.trim(),
  }
}

// Fila de dominio.productos tal como la lee la ficha (F-CAT-04).
export type Producto = {
  id: string
  organizacion_id: string
  nombre: string
  descripcion: string | null
  sku: string | null
  compatible_con: string[]
  moneda: Moneda
  precio_lista: number | string
  activo: boolean
  updated_at: string
  proveedor_id: string | null
  codigo_proveedor: string | null
}

export function aFormulario(producto: Producto, costo: number | string | null): FormularioProducto {
  return {
    nombre: producto.nombre,
    descripcion: producto.descripcion ?? '',
    sku: producto.sku ?? '',
    compatible_con: producto.compatible_con.join(', '),
    moneda: producto.moneda,
    precio_lista: String(producto.precio_lista),
    costo: costo === null ? '' : String(costo),
    proveedor_id: producto.proveedor_id ?? '',
    codigo_proveedor: producto.codigo_proveedor ?? '',
  }
}

// Parámetros de public.actualizar_producto (M4): `p_actualizado_en` es el updated_at
// leído al abrir la ficha (bloqueo optimista). Un costo vacío viaja nulo = sin cambio.
export type ParametrosActualizarProducto = ParametrosCrearProducto & {
  p_id: string
  p_actualizado_en: string
  // La RPC conserva el proveedor salvo que se pida cambiarlo; el formulario siempre lo reenvía.
  p_cambiar_proveedor: true
}

export function aParametrosActualizar(
  formulario: FormularioProducto,
  { conCosto, id, actualizadoEn }: { conCosto: boolean; id: string; actualizadoEn: string },
): ParametrosActualizarProducto {
  return { p_id: id, p_actualizado_en: actualizadoEn, p_cambiar_proveedor: true, ...aParametrosCrear(formulario, { conCosto }) }
}

// ¿Hay algo cargado que se perdería al salir? (diálogo «Descartar cambios»).
export function hayCambios(actual: FormularioProducto, inicial: FormularioProducto): boolean {
  return (Object.keys(actual) as CampoProducto[]).some((campo) => actual[campo].trim() !== inicial[campo].trim())
}

// ¿El 23505 es del índice único de SKU? Otra restricción única no debe verse como «SKU repetido».
export function esSkuRepetido(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | null
  return e?.code === '23505' && (e.message ?? '').includes('productos_org_sku_uidx')
}

export const MENSAJE_CONFLICTO =
  'Otra persona modificó este producto mientras lo editabas. Recargá para ver sus cambios; no se guardó nada tuyo.'

export function esConflicto(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === '40001'
}

// El mensaje crudo de Postgres/PostgREST puede nombrar políticas, restricciones o
// columnas: al usuario va solo el texto en castellano y el detalle queda en consola.
export function mensajeDeError(error: unknown, porDefecto: string): string {
  console.error(porDefecto, error)
  const code = (error as { code?: string } | null)?.code
  if (code === '40001') return MENSAJE_CONFLICTO
  if (code === 'P0002') return 'El producto ya no existe o no pertenece a tu organización.'
  if (code === '42501') return 'No tenés permiso para esta acción. Puede que tu rol haya cambiado: recargá la página.'
  // F-CAT-03: el índice único de SKU (alta o edición, también ante carreras).
  if (esSkuRepetido(error)) return MENSAJE_SKU_REPETIDO
  if (code === '22023' && /^El proveedor no existe/.test((error as { message?: string }).message ?? '')) {
    return 'Ese proveedor no está disponible. Elegí otro activo o dejá el campo vacío.'
  }
  if (code === '22023') return 'Algún dato no es válido. Revisá el formulario e intentá de nuevo.'
  if (code === '22003') return 'Un importe es demasiado grande. Revisá el precio y el costo.'
  return porDefecto
}
