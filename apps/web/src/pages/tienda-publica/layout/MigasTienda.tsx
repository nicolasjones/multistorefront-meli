import { Box } from '@mui/material'
import { Fragment } from 'react'
import { Link as EnlaceRuta } from 'react-router'

export type MigaTienda = { texto: string; a?: string }

// Migas de pan de la tienda (prototipo: «Inicio / Página»): 14 px en el gris secundario, con 18 px de aire arriba y abajo;
// los enlaces van sin subrayado y la página actual en negrita. Es una lista dentro de `<nav aria-label="Migas de pan">`
// (la actual lleva `aria-current="page"`); el separador es decorativo.
export function MigasTienda({ items }: { items: MigaTienda[] }) {
  return (
    <Box component="nav" aria-label="Migas de pan" sx={{ py: '18px', fontSize: 14, color: 'text.secondary' /* estilos-sueltos: ok */ }}>
      <Box component="ol" sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', listStyle: 'none', m: 0, p: 0 }}>
        {items.map((miga, indice) => (
          <Fragment key={`${indice}-${miga.texto}`}>
            {indice > 0 ? <Box component="li" aria-hidden sx={{ px: '6px' /* estilos-sueltos: ok */ }}>/</Box> : null}
            <Box component="li" sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>
              {miga.a ? (
                <Box component={EnlaceRuta} to={miga.a} sx={{ color: 'inherit', textDecoration: 'none', '&:hover, &:focus-visible': { textDecoration: 'underline' } }}>{miga.texto}</Box>
              ) : (
                <Box component="span" aria-current="page" sx={{ fontWeight: 700 }}>{miga.texto}</Box>
              )}
            </Box>
          </Fragment>
        ))}
      </Box>
    </Box>
  )
}
