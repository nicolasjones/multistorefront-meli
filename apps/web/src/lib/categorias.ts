// Categorías del catálogo (F-CAT-08, MSF-298). Árbol de 3 niveles (categoría raíz, subcategoría y sub
// subcategoría) en `dominio.categorias`; la visibilidad por tienda en `dominio.categorias_empresa`. Las
// escrituras van por las RPC `guardar_categoria`, `reordenar_categorias` y `eliminar_categoria` (atómicas; la
// base valida los 3 niveles y el nombre único por nivel aunque la pantalla falle). Acá: lectura, armado del
// árbol y las reglas de movimiento que la pantalla usa para avisar antes de pedirle algo imposible a la base.
import type { SupabaseClient } from '@supabase/supabase-js'

export const LARGO_MAXIMO_NOMBRE_CATEGORIA = 100
export const MENSAJE_NOMBRE_REPETIDO = 'Ya existe una categoría con ese nombre en ese nivel'
export const MENSAJE_TRES_NIVELES = 'Las categorías admiten hasta 3 niveles: una categoría de tercer nivel no puede tener subcategorías.'
export const MENSAJE_PADRE_NO_VALIDO = 'Las categorías admiten hasta 3 niveles: elegí una categoría de primer o segundo nivel como padre.'

export type Categoria = {
  id: string
  nombre: string
  padre_id: string | null
  posicion: number
  // IVA de la categoría (F-PRE-12, FR-020); opcional porque el selector del producto no lo necesita.
  alicuota_iva_id?: string | null
  // Empresas (tiendas) donde se ve la categoría; vacío = no se ve en ninguna.
  empresa_ids: string[]
}

export type NodoCategoria = Categoria & {
  hijos: NodoCategoria[]
  // Productos asignados directamente / con las subcategorías incluidas (FR-018).
  productos_directos: number
  productos: number
}

export type OrdenCategoria = { id: string; padre_id: string | null; posicion: number }

const comparar = (a: Categoria, b: Categoria) =>
  a.posicion - b.posicion || a.nombre.localeCompare(b.nombre, 'es') || a.id.localeCompare(b.id)

export function normalizarNombre(nombre: string): string {
  return nombre.trim().toLowerCase()
}

// Mensaje de error del nombre, o null si es válido. La base revalida (recorta, no vacío, ≤ 100).
export function validarNombreCategoria(nombre: string): string | null {
  const limpio = nombre.trim()
  if (limpio === '') return 'El nombre es obligatorio.'
  if (limpio.length > LARGO_MAXIMO_NOMBRE_CATEGORIA) return `El nombre admite hasta ${LARGO_MAXIMO_NOMBRE_CATEGORIA} caracteres.`
  return null
}

// Profundidad de una categoría en el árbol: 1 = raíz, 2 = subcategoría, 3 = sub subcategoría.
// El recorrido corta a los 10 niveles para que un árbol corrupto no lo cuelgue.
export function nivelCategoria(categorias: readonly Pick<Categoria, 'id' | 'padre_id'>[], id: string): number {
  const porId = new Map(categorias.map((categoria) => [categoria.id, categoria]))
  let nivel = 1
  let actual = porId.get(id)
  const vistos = new Set<string>()
  while (actual?.padre_id && !vistos.has(actual.padre_id)) {
    vistos.add(actual.padre_id)
    const padre = porId.get(actual.padre_id)
    if (!padre) break
    nivel += 1
    actual = padre
    if (nivel > 10) break
  }
  return nivel
}

// ¿La categoría es antepasada de otra? (sería un ciclo si se la deja como padre de sí misma).
export function esAntepasada(categorias: readonly Pick<Categoria, 'id' | 'padre_id'>[], posibleAntepasada: string, id: string): boolean {
  const porId = new Map(categorias.map((categoria) => [categoria.id, categoria]))
  let actual = porId.get(id)
  const vistos = new Set<string>()
  while (actual?.padre_id && !vistos.has(actual.padre_id)) {
    vistos.add(actual.padre_id)
    if (actual.padre_id === posibleAntepasada) return true
    actual = porId.get(actual.padre_id)
  }
  return false
}

// Arma el árbol (hasta 3 niveles) con los conteos de productos. Una categoría cuyo padre no llegó
// (p. ej. no visible) se muestra como raíz en vez de desaparecer.
export function armarArbol(categorias: readonly Categoria[], conteos: ReadonlyMap<string, number> = new Map()): NodoCategoria[] {
  const ids = new Set(categorias.map((categoria) => categoria.id))
  const nodo = (categoria: Categoria): NodoCategoria => {
    const directos = conteos.get(categoria.id) ?? 0
    return { ...categoria, hijos: [], productos_directos: directos, productos: directos }
  }
  const raices = categorias.filter((c) => c.padre_id === null || !ids.has(c.padre_id)).sort(comparar).map(nodo)
  const porId = new Map(raices.map((raiz) => [raiz.id, raiz]))
  // El árbol se arma en una pasada; el conteo de productos se acumula de abajo hacia arriba (3 niveles).
  for (const categoria of categorias.filter((c) => c.padre_id !== null && ids.has(c.padre_id)).sort(comparar)) {
    const padre = porId.get(categoria.padre_id as string)
    if (!padre) continue
    const hijo = nodo(categoria)
    padre.hijos.push(hijo)
    porId.set(hijo.id, hijo)
  }
  const acumular = (nodo: NodoCategoria): number => {
    nodo.productos = nodo.productos_directos + nodo.hijos.reduce((suma, hijo) => suma + acumular(hijo), 0)
    return nodo.productos
  }
  raices.forEach(acumular)
  return raices
}

// Filtro de tienda del árbol (FR-018): deja las categorías visibles en esa empresa; una raíz que no se ve
// pero tiene subcategorías visibles se conserva para no esconderlas. `null` = todas las tiendas.
export function filtrarArbolPorTienda(arbol: readonly NodoCategoria[], empresaId: string | null): NodoCategoria[] {
  if (empresaId === null) return [...arbol]
  const visible = (nodo: Categoria) => nodo.empresa_ids.includes(empresaId)
  const filtrar = (nodo: NodoCategoria): NodoCategoria => {
    const hijos = nodo.hijos.map(filtrar).filter((hijo) => visible(hijo) || hijo.hijos.length > 0)
    // El conteo del nodo suma solo las subcategorías que quedan a la vista.
    return { ...nodo, hijos, productos: nodo.productos_directos + hijos.reduce((suma, hijo) => suma + hijo.productos, 0) }
  }
  return arbol.map(filtrar).filter((raiz) => visible(raiz) || raiz.hijos.length > 0)
}

// Ruta «Padre > Hija» (o solo el nombre de una raíz).
export function rutaCategoria(categoria: Pick<Categoria, 'nombre' | 'padre_id'>, categorias: readonly Pick<Categoria, 'id' | 'nombre'>[]): string {
  const padre = categoria.padre_id ? categorias.find((c) => c.id === categoria.padre_id) : undefined
  return padre ? `${padre.nombre} > ${categoria.nombre}` : categoria.nombre
}

// Opciones de «Categoría padre»: raíces (dejan la categoría en el segundo nivel) y subcategorías (la dejan en
// el tercero). Si la categoría que se edita ya tiene subcategorías, solo puede colgar de una raíz (una categoría
// de tercer nivel no puede tener subcategorías) y no se ofrecen ni ella misma ni sus descendientes.
export function opcionesPadre(categorias: readonly Categoria[], editandoId: string | null): Categoria[] {
  const tieneHijos = editandoId !== null && categorias.some((c) => c.padre_id === editandoId)
  // Descendientes de la categoría que se edita: no pueden pasar a ser su propio padre.
  const descendientes = new Set<string>()
  if (editandoId !== null) {
    const pendientes = [editandoId]
    while (pendientes.length > 0) {
      const actual = pendientes.pop() as string
      for (const hijo of categorias.filter((c) => c.padre_id === actual)) {
        if (descendientes.has(hijo.id)) continue
        descendientes.add(hijo.id)
        pendientes.push(hijo.id)
      }
    }
  }
  return categorias
    .filter((c) => c.id !== editandoId && !descendientes.has(c.id) && (tieneHijos ? c.padre_id === null : nivelCategoria(categorias, c.id) <= 2))
    .sort(comparar)
}

// ¿Ya hay una categoría con ese nombre en ese nivel (sin distinguir mayúsculas ni espacios extremos)?
export function nombreRepetidoEnNivel(categorias: readonly Categoria[], nombre: string, padreId: string | null, ignorarId: string | null = null): boolean {
  const buscado = normalizarNombre(nombre)
  return categorias.some((c) => c.id !== ignorarId && c.padre_id === padreId && normalizarNombre(c.nombre) === buscado)
}

// ---------------------------------------------------------------------------------------------
// Reordenar y mover (FR-019): funciones puras que devuelven el estado COMPLETO del árbol como
// `[{id, padre_id, posicion}]` para `reordenar_categorias`, o el motivo por el que no se puede.
// ---------------------------------------------------------------------------------------------

export type ResultadoMovimiento =
  | { ok: true; orden: OrdenCategoria[] }
  | { ok: false; motivo: string | null }

type Listas = Map<string | null, string[]>

function listasDe(categorias: readonly Categoria[]): Listas {
  const listas: Listas = new Map([[null, []]])
  const ids = new Set(categorias.map((c) => c.id))
  for (const categoria of [...categorias].sort(comparar)) {
    const clave = categoria.padre_id !== null && ids.has(categoria.padre_id) ? categoria.padre_id : null
    const lista = listas.get(clave) ?? []
    lista.push(categoria.id)
    listas.set(clave, lista)
  }
  return listas
}

function aOrden(listas: Listas): OrdenCategoria[] {
  const orden: OrdenCategoria[] = []
  for (const [padre, ids] of listas) ids.forEach((id, posicion) => orden.push({ id, padre_id: padre, posicion }))
  return orden
}

// Mueve `id` bajo `nuevoPadre` en el índice indicado (null = al final), validando las reglas.
function mover(categorias: readonly Categoria[], id: string, nuevoPadre: string | null, indice: number | null): ResultadoMovimiento {
  const categoria = categorias.find((c) => c.id === id)
  if (!categoria) return { ok: false, motivo: 'La categoría ya no existe.' }
  const listas = listasDe(categorias)
  if (nuevoPadre !== null) {
    const padre = categorias.find((c) => c.id === nuevoPadre)
    if (!padre || nuevoPadre === id) return { ok: false, motivo: MENSAJE_PADRE_NO_VALIDO }
    // El padre puede ser raíz o subcategoría: la categoría movida queda en el segundo o el tercer nivel.
    const nivelPadre = nivelCategoria(categorias, nuevoPadre)
    if (nivelPadre > 2) return { ok: false, motivo: MENSAJE_PADRE_NO_VALIDO }
    // Una categoría con subcategorías solo puede quedar en el primer o segundo nivel.
    if ((listas.get(id) ?? []).length > 0 && nivelPadre > 1) return { ok: false, motivo: MENSAJE_TRES_NIVELES }
    // No se puede colgar de una descendiente propia (sería un ciclo).
    if (esAntepasada(categorias, id, nuevoPadre)) return { ok: false, motivo: MENSAJE_PADRE_NO_VALIDO }
  }
  const origen = categoria.padre_id !== null && listas.has(categoria.padre_id) ? categoria.padre_id : null
  if (origen !== nuevoPadre && categorias.some((c) => c.id !== id && c.padre_id === nuevoPadre && normalizarNombre(c.nombre) === normalizarNombre(categoria.nombre))) {
    return { ok: false, motivo: MENSAJE_NOMBRE_REPETIDO }
  }
  const sinEl = (listas.get(origen) ?? []).filter((x) => x !== id)
  listas.set(origen, sinEl)
  const destino = origen === nuevoPadre ? sinEl : [...(listas.get(nuevoPadre) ?? [])]
  destino.splice(indice === null ? destino.length : Math.min(Math.max(indice, 0), destino.length), 0, id)
  listas.set(nuevoPadre, destino)
  return { ok: true, orden: aOrden(listas) }
}

// Subir / Bajar por teclado: intercambia con el hermano de al lado. `null` motivo = ya está en el borde.
// Con `visibles` (vista filtrada por tienda) el «hermano de al lado» es el visible más cercano, no uno oculto.
export function moverEnNivel(categorias: readonly Categoria[], id: string, delta: -1 | 1, visibles?: ReadonlySet<string>): ResultadoMovimiento {
  const categoria = categorias.find((c) => c.id === id)
  if (!categoria) return { ok: false, motivo: 'La categoría ya no existe.' }
  const listas = listasDe(categorias)
  const padre = categoria.padre_id !== null && listas.has(categoria.padre_id) ? categoria.padre_id : null
  const hermanos = listas.get(padre) ?? []
  const actual = hermanos.indexOf(id)
  let destino = actual + delta
  while (visibles && destino >= 0 && destino < hermanos.length && !visibles.has(hermanos[destino])) destino += delta
  if (destino < 0 || destino >= hermanos.length) return { ok: false, motivo: null }
  return mover(categorias, id, padre, destino)
}

// Arrastrar una fila sobre otra:
//  - mismo nivel (mismo padre): se reordena tomando el lugar de la fila de destino;
//  - sobre una raíz distinta: pasa a ser su última subcategoría;
//  - sobre una subcategoría de otra raíz: pasa a ser subcategoría de esa raíz, en ese lugar.
export function soltarSobre(categorias: readonly Categoria[], arrastradoId: string, destinoId: string): ResultadoMovimiento {
  if (arrastradoId === destinoId) return { ok: false, motivo: null }
  const arrastrado = categorias.find((c) => c.id === arrastradoId)
  const destino = categorias.find((c) => c.id === destinoId)
  if (!arrastrado || !destino) return { ok: false, motivo: 'La categoría ya no existe.' }
  const listas = listasDe(categorias)
  const padreDe = (c: Categoria) => (c.padre_id !== null && listas.has(c.padre_id) ? c.padre_id : null)
  if (padreDe(arrastrado) === padreDe(destino)) {
    return mover(categorias, arrastradoId, padreDe(destino), (listas.get(padreDe(destino)) ?? []).indexOf(destinoId))
  }
  if (padreDe(destino) === null) return mover(categorias, arrastradoId, destinoId, null)
  return mover(categorias, arrastradoId, padreDe(destino), (listas.get(padreDe(destino)) ?? []).indexOf(destinoId))
}

// ---------------------------------------------------------------------------------------------
// Acceso a datos
// ---------------------------------------------------------------------------------------------

export async function leerCategorias(cliente: Pick<SupabaseClient, 'schema' | 'from'>): Promise<{ categorias: Categoria[]; conteos: Map<string, number> }> {
  const [categorias, visibles, conteos] = await Promise.all([
    cliente.schema('dominio').from('categorias').select('id, nombre, padre_id, posicion, alicuota_iva_id').returns<Array<Omit<Categoria, 'empresa_ids'>>>(),
    cliente.schema('dominio').from('categorias_empresa').select('categoria_id, empresa_id').returns<Array<{ categoria_id: string; empresa_id: string }>>(),
    cliente.from('v_categorias_productos').select('categoria_id, productos').returns<Array<{ categoria_id: string; productos: number }>>(),
  ])
  if (categorias.error) throw categorias.error
  if (visibles.error) throw visibles.error
  if (conteos.error) throw conteos.error
  const empresasPor = new Map<string, string[]>()
  for (const fila of visibles.data ?? []) empresasPor.set(fila.categoria_id, [...(empresasPor.get(fila.categoria_id) ?? []), fila.empresa_id])
  return {
    categorias: (categorias.data ?? []).map((c) => ({ ...c, empresa_ids: empresasPor.get(c.id) ?? [] })),
    conteos: new Map((conteos.data ?? []).map((fila) => [fila.categoria_id, fila.productos])),
  }
}

// Solo las categorías (sin visibilidad ni conteos): alcanza para el selector del producto.
export async function leerCategoriasSelector(cliente: Pick<SupabaseClient, 'schema'>): Promise<Categoria[]> {
  const { data, error } = await cliente
    .schema('dominio')
    .from('categorias')
    .select('id, nombre, padre_id, posicion, alicuota_iva_id')
    .returns<Array<Omit<Categoria, 'empresa_ids'>>>()
  if (error) throw error
  return (data ?? []).map((categoria) => ({ ...categoria, empresa_ids: [] }))
}

// Opciones del selector de categoría del producto: cada raíz seguida de sus subcategorías y sub
// subcategorías (3 niveles), con la ruta completa «Padre > Hija > SubHija».
export function opcionesCategoriaProducto(categorias: readonly Categoria[]): Array<{ id: string; ruta: string; nivel: 0 | 1 | 2 }> {
  const recorrer = (nodo: NodoCategoria, prefijo: string, nivel: 0 | 1 | 2): Array<{ id: string; ruta: string; nivel: 0 | 1 | 2 }> => [
    { id: nodo.id, ruta: prefijo, nivel },
    ...nodo.hijos.flatMap((hijo) => recorrer(hijo, `${prefijo} > ${hijo.nombre}`, (Math.min(nivel + 1, 2)) as 0 | 1 | 2)),
  ]
  return armarArbol(categorias).flatMap((raiz) => recorrer(raiz, raiz.nombre, 0))
}

export async function guardarCategoria(
  cliente: Pick<SupabaseClient, 'rpc'>,
  datos: { id: string | null; nombre: string; padreId: string | null; empresaIds: readonly string[] },
): Promise<string> {
  const { data, error } = await cliente.rpc('guardar_categoria', {
    p_id: datos.id,
    p_nombre: datos.nombre,
    p_padre_id: datos.padreId,
    p_empresa_ids: [...datos.empresaIds],
  })
  if (error) throw error
  return data as string
}

export async function reordenarCategorias(cliente: Pick<SupabaseClient, 'rpc'>, orden: readonly OrdenCategoria[]): Promise<void> {
  const { error } = await cliente.rpc('reordenar_categorias', { p_orden: orden })
  if (error) throw error
}

export async function eliminarCategoria(cliente: Pick<SupabaseClient, 'rpc'>, id: string): Promise<{ productos: number; subcategorias: number }> {
  const { data, error } = await cliente.rpc('eliminar_categoria', { p_id: id })
  if (error) throw error
  return data as { productos: number; subcategorias: number }
}

export async function asignarCategoriaProducto(cliente: Pick<SupabaseClient, 'rpc'>, productoId: string, categoriaId: string | null): Promise<void> {
  const { error } = await cliente.rpc('asignar_categoria_producto', { p_producto_id: productoId, p_categoria_id: categoriaId })
  if (error) throw error
}

// Mensaje para mostrar de un error de las RPC de categorías (la base ya trae el texto en castellano).
export function mensajeErrorCategoria(error: unknown, porDefecto: string): string {
  const mensaje = typeof error === 'object' && error !== null && 'message' in error ? String((error as { message: unknown }).message) : ''
  const codigo = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : ''
  if (codigo === '23505' || codigo === '23514' || codigo === '22023' || codigo === 'P0002' || codigo === '42501') return mensaje || porDefecto
  return porDefecto
}
