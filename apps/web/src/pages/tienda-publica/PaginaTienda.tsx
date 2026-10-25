import type { ComponentType } from 'react'
import type { TiendaPublica } from '../../lib/tienda'

export type PropsSeccionTienda = { tienda: TiendaPublica; host: string }

// Contrato de cada archivo de `secciones/`: exporta por defecto el componente y, opcional, `orden`
// (menor primero). Cada historia de la épica (identidad, contenido, catálogo) aporta la suya sin
// tocar un archivo común.
export type ModuloSeccionTienda = { default: ComponentType<PropsSeccionTienda>; orden?: number }

const ORDEN_POR_DEFECTO = 100

const MODULOS_SECCIONES = import.meta.glob<ModuloSeccionTienda>('./secciones/*.tsx', { eager: true })

export type SeccionTienda = { clave: string; Componente: ComponentType<PropsSeccionTienda>; orden: number }

export function ordenarSecciones(modulos: Record<string, ModuloSeccionTienda>): SeccionTienda[] {
  return Object.entries(modulos)
    .map(([ruta, modulo]) => ({ clave: ruta, Componente: modulo.default, orden: modulo.orden ?? ORDEN_POR_DEFECTO }))
    .sort((a, b) => a.orden - b.orden || a.clave.localeCompare(b.clave))
}

// Contenido de la home (FR-007): las secciones registradas. El encabezado con la marca y el menú, y el
// pie de categorías los pone `layout/LayoutTienda` (F-TDA-11).
export function PaginaTienda({
  tienda,
  host,
  modulos = MODULOS_SECCIONES,
}: {
  tienda: TiendaPublica
  host: string
  modulos?: Record<string, ModuloSeccionTienda>
}) {
  const secciones = ordenarSecciones(modulos)
  return (
    <>
      {secciones.map(({ clave, Componente }) => (
        <Componente key={clave} tienda={tienda} host={host} />
      ))}
    </>
  )
}
