import type { ComponentType } from 'react'

// F-TDA-01 (FR-008): estructura de las pestañas de la gestión de la tienda. Cada
// historia de la épica aporta el contenido en `pestanas/<clave>.tsx` sin tocar este
// archivo ni la pantalla; la carga es diferida por `import.meta.glob`.
export type ClavePestanaTienda = 'identidad' | 'contenido' | 'catalogo' | 'publicacion' | 'paginas'

// `alCambiarDominio` (F-TDA-05): la pestaña de dominio avisa a la gestión que el dominio cambió para que
// refresque el encabezado («Ver tienda»); las demás pestañas lo ignoran.
export type PropsPestanaTienda = { empresaId: string; empresaNombre: string; alCambiarDominio?: () => void }

export type ModuloPestanaTienda = { default: ComponentType<PropsPestanaTienda> }

export const PESTANAS_TIENDA: ReadonlyArray<{ clave: ClavePestanaTienda; etiqueta: string }> = [
  { clave: 'identidad', etiqueta: 'Identidad visual' },
  { clave: 'contenido', etiqueta: 'Contenido' },
  { clave: 'catalogo', etiqueta: 'Catálogo visible' },
  { clave: 'publicacion', etiqueta: 'Dominio y publicación' },
  { clave: 'paginas', etiqueta: 'Páginas' },
]

const MODULOS = import.meta.glob<ModuloPestanaTienda>('./pestanas/*.tsx')

export function esClavePestanaTienda(valor: string | undefined): valor is ClavePestanaTienda {
  return PESTANAS_TIENDA.some((pestana) => pestana.clave === valor)
}

export function cargarPestana(clave: ClavePestanaTienda): (() => Promise<ModuloPestanaTienda>) | null {
  return MODULOS[`./pestanas/${clave}.tsx`] ?? null
}
