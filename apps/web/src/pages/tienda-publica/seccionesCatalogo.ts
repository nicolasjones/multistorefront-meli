import type { ComponentType } from 'react'
import type { TiendaPublica } from '../../lib/tienda'

export type PropsSeccionCatalogo = { tienda: TiendaPublica; host: string; categoriaId: string | null }

// Contrato de cada archivo de `secciones-catalogo/` (lo aporta F-TDA-12): exporta por defecto el
// componente del listado y, opcional, `orden` (menor primero). La página de categoría los carga con
// `import.meta.glob` sin depender de ningún archivo concreto: mientras la carpeta no exista el cuerpo
// del listado queda vacío (F-TDA-11, FR-006).
export type ModuloSeccionCatalogo = { default: ComponentType<PropsSeccionCatalogo>; orden?: number }

const ORDEN_POR_DEFECTO = 100

const MODULOS_SECCIONES_CATALOGO = import.meta.glob<ModuloSeccionCatalogo>('./secciones-catalogo/*.tsx', { eager: true })

export type SeccionCatalogo = { clave: string; Componente: ComponentType<PropsSeccionCatalogo>; orden: number }

export function ordenarSeccionesCatalogo(
  modulos: Record<string, ModuloSeccionCatalogo> = MODULOS_SECCIONES_CATALOGO,
): SeccionCatalogo[] {
  return Object.entries(modulos)
    .map(([clave, modulo]) => ({ clave, Componente: modulo.default, orden: modulo.orden ?? ORDEN_POR_DEFECTO }))
    .sort((a, b) => a.orden - b.orden || a.clave.localeCompare(b.clave))
}
