import type { HTMLAttributes, ReactNode } from 'react'
import { Box } from '@mui/material'
import { MiniaturaProducto } from './MiniaturaProducto'

type ProductoConImagen = { id: string; nombre: string; sku?: string | null }

type OpcionProductoProps = {
  nombre: string
  sku?: string | null
  imagen?: string | null
}

// Fila de un combo de productos: miniatura + nombre + SKU. Presentacional; la URL viene de `useImagenesProductos`.
export function OpcionProducto({ nombre, sku, imagen }: OpcionProductoProps) {
  return (
    <Box component="span" sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
      <MiniaturaProducto alt="" src={imagen} />
      <Box component="span" sx={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <span>{nombre}</span>
        {sku ? <Box component="span" sx={{ typography: 'caption', color: 'text.secondary' }}>{sku}</Box> : null}
      </Box>
    </Box>
  )
}

const etiquetaPorDefecto = (producto: ProductoConImagen) => (producto.sku ? `${producto.nombre} · ${producto.sku}` : producto.nombre)

// `renderOption` para un `Autocomplete` de productos: `renderOption={renderOpcionProducto(imagenes)}`.
// `etiqueta` es la misma que usa el `getOptionLabel` del combo: la opción conserva ese nombre accesible.
export function renderOpcionProducto<T extends ProductoConImagen>(
  imagenes: ReadonlyMap<string, string>,
  etiqueta: (producto: T) => string = etiquetaPorDefecto,
) {
  return (props: HTMLAttributes<HTMLLIElement> & { key?: string }, opcion: T): ReactNode => {
    const { key, ...resto } = props
    return (
      <li key={key} {...resto} aria-label={etiqueta(opcion)}>
        <OpcionProducto nombre={opcion.nombre} sku={opcion.sku} imagen={imagenes.get(opcion.id)} />
      </li>
    )
  }
}
