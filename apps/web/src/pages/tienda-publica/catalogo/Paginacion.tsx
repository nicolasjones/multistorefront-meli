import { Pagination, PaginationItem } from '@mui/material'
import { Link as EnlaceRuta } from 'react-router'

// Paginación de a 24 (F-TDA-12, FR-039): las páginas son enlaces reales (teclado, lector de pantalla y
// URL compartible). El total sale del servidor; con una sola página no se dibuja.
export function Paginacion({
  pagina,
  total,
  tamano,
  hrefPagina,
}: {
  pagina: number
  total: number
  tamano: number
  hrefPagina: (pagina: number) => string
}) {
  const paginas = Math.ceil(total / tamano)
  if (paginas <= 1) return null
  return (
    <Pagination
      aria-label="Paginación del catálogo"
      count={paginas}
      page={Math.min(pagina, paginas)}
      shape="rounded"
      getItemAriaLabel={(tipo, numero, seleccionada) => {
        if (tipo === 'page') return seleccionada ? `Página ${numero}, página actual` : `Ir a la página ${numero}`
        if (tipo === 'first') return 'Primera página'
        if (tipo === 'last') return 'Última página'
        return tipo === 'next' ? 'Página siguiente' : 'Página anterior'
      }}
      renderItem={(item) => (
        <PaginationItem
          {...item}
          component={EnlaceRuta}
          to={hrefPagina(item.page ?? 1)}
        />
      )}
    />
  )
}
