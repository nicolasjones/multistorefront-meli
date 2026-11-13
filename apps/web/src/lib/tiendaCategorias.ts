import { supabaseClient } from './supabase'
import { limpiarTextoPublico } from './tiendaTextos'

// F-TDA-11 (MSF-386): categorías visibles de la tienda pública. La visibilidad (la categoría y su
// padre), el orden de Catálogo y el conteo de productos efectivamente visibles los calcula la base
// (migración 20261023150000_tienda_categorias_publicas.sql); acá solo se lee.

export type CategoriaPublica = {
  id: string
  nombre: string
  padreId: string | null
  productos: number
  // Ruta de storage (bucket productos-imagenes) de la foto de la categoría: la imagen principal de un producto
  // visible de ella o de sus subcategorías. null si ninguno tiene imagen. Sin campo de configuración (MSF-841).
  imagen: string | null
}

type FilaCategorias = {
  categorias: Array<{ id: string; nombre: string; padre_id: string | null; productos: number; imagen?: string | null }>
}

// publico.categorias_por_dominio es ejecutable por anon (sin sesión). Dominio desconocido o empresa
// desactivada devuelven null (FR-002): para el front es lo mismo que una tienda sin categorías.
export async function leerCategoriasPublicas(host: string): Promise<CategoriaPublica[]> {
  const { data, error } = await supabaseClient.schema('publico').rpc('categorias_por_dominio', { host })
  if (error) {
    throw new Error(error.message)
  }
  if (!data) {
    return []
  }
  return (data as FilaCategorias).categorias.map((c) => ({
    id: c.id,
    nombre: limpiarTextoPublico(c.nombre),
    padreId: c.padre_id,
    productos: c.productos,
    imagen: c.imagen ?? null,
  }))
}

// MSF-825 (MSF-826/MSF-827): cuántas categorías principales muestran el menú, la home y el pie (el prototipo
// muestra 6). El resto se alcanza desde el catálogo.
export const CATEGORIAS_PRINCIPALES = 6

// Categorías principales de la tienda: las raíces visibles (sin padre) que la base ya devolvió con productos,
// de mayor a menor cantidad (empate: por nombre), sin nombres repetidos y hasta `maximo`. La tienda decide
// qué se ve ocultando categorías en su configuración; sin raíces (todas colgadas de una oculta) se usan las
// que haya. Una tienda sin categorías devuelve [].
export function categoriasPrincipales(categorias: CategoriaPublica[], maximo: number = CATEGORIAS_PRINCIPALES): CategoriaPublica[] {
  const raices = categorias.filter((c) => c.padreId === null)
  const base = raices.length > 0 ? raices : categorias
  const vistos = new Set<string>()
  return [...base]
    .sort((a, b) => b.productos - a.productos || a.nombre.localeCompare(b.nombre, 'es'))
    .filter((c) => {
      const clave = c.nombre.trim().toLocaleLowerCase('es')
      if (vistos.has(clave)) return false
      vistos.add(clave)
      return true
    })
    .slice(0, Math.max(0, maximo))
}

export const hayMasCategorias = (categorias: CategoriaPublica[], principales: CategoriaPublica[]): boolean =>
  categorias.length > principales.length

// Cuántas categorías principales entran en una fila de `disponible` px sin cortar la última (MSF-846): `anchos` son
// los anchos de cada entrada, `anchoMas` el de «Más categorías» y `gap` la separación. Si no entran todas (o ya
// hay más categorías en el catálogo, `hayMas`) se reserva el lugar de «Más categorías». Sin medidas útiles
// (anchos todos 0, p. ej. sin layout) entran todas.
export function cuantasEntran(anchos: number[], anchoMas: number, gap: number, disponible: number, hayMas: boolean): number {
  const total = anchos.length
  if (total === 0 || disponible <= 0 || anchos.every((a) => a === 0)) return total
  let usado = 0
  let entran = 0
  for (let n = 1; n <= total; n += 1) {
    usado += (n > 1 ? gap : 0) + anchos[n - 1]
    const reserva = n < total || hayMas ? gap + anchoMas : 0
    if (usado + reserva <= disponible) entran = n
  }
  return entran
}

export type FilaCategoriaPanel<T> = { categoria: T; nivel: number }

// Filas del panel «Categorías» del catálogo (MSF-825, MSF-830): las raíces en el orden recibido y, debajo de la
// que está elegida (o de la que contiene a la elegida), sus subcategorías con sangría por nivel, en orden de
// árbol (cada hija bajo su padre). Así el panel no es una lista plana de cientos de entradas. Una categoría
// elegida cuyo padre no vino (oculto) se muestra como raíz.
export function filasPanelCategorias<T extends { id: string; padreId: string | null }>(
  categorias: T[],
  seleccionada: string | null,
): Array<FilaCategoriaPanel<T>> {
  const porId = new Map(categorias.map((c) => [c.id, c]))
  const hijasDe = new Map<string | null, T[]>()
  for (const c of categorias) {
    const clave = c.padreId !== null && porId.has(c.padreId) ? c.padreId : null
    hijasDe.set(clave, [...(hijasDe.get(clave) ?? []), c])
  }
  // Camino desde la elegida hasta su raíz: esas se despliegan.
  const desplegadas = new Set<string>()
  for (let actual = seleccionada ? porId.get(seleccionada) : undefined, saltos = 0; actual && saltos < 20; saltos += 1) {
    desplegadas.add(actual.id)
    actual = actual.padreId !== null ? porId.get(actual.padreId) : undefined
  }
  const filas: Array<FilaCategoriaPanel<T>> = []
  const agregar = (padre: string | null, nivel: number) => {
    for (const c of hijasDe.get(padre) ?? []) {
      filas.push({ categoria: c, nivel })
      if (desplegadas.has(c.id)) agregar(c.id, nivel + 1)
    }
  }
  agregar(null, 0)
  return filas
}
