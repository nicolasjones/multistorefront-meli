import { Box, Button, Typography } from '@mui/material'
import { lazy, Suspense } from 'react'
import { Link as EnlaceRuta, useOutletContext } from 'react-router'
import type { ContextoTienda } from './layout/LayoutTienda'
import { CabeceraSeo } from './seo/CabeceraSeo'

const BuscadorTienda = lazy(() => import('./layout/BuscadorTienda'))

// 404 amable reutilizable (F-TDA-11, FR-007): categoría inexistente, oculta o de otra empresa, ruta
// desconocida y (F-TDA-13) producto no disponible. El mensaje es el mismo en todos los casos: no
// revela si el recurso existe. F-TDA-19 (FR-003) suma el buscador en el cuerpo para seguir
// navegando; se carga de forma diferida y solo si hay tienda (el host sale del layout).
export function PaginaNoEncontrada() {
  const contexto = useOutletContext<ContextoTienda | undefined>()
  return (
    <Box data-testid="pagina-no-encontrada" sx={{ py: 6, textAlign: 'center' }}>
      <CabeceraSeo noindex pagina="Página no encontrada" />
      <Typography component="h1" variant="h4" gutterBottom>No encontramos esta página</Typography>
      <Typography color="text.secondary" sx={{ mb: 3 }}>
        Puede que el enlace esté desactualizado o que ya no esté disponible.
      </Typography>
      {contexto ? (
        <Box data-testid="buscador-no-encontrada" sx={{ display: 'flex', justifyContent: 'center', mb: 3 }}>
          <Suspense fallback={<Box sx={(tema) => ({ width: { xs: '100%', sm: tema.spacing(45) }, height: tema.spacing(5) })} aria-hidden />}>
            <BuscadorTienda host={contexto.host} etiqueta="Buscar en la tienda" />
          </Suspense>
        </Box>
      ) : null}
      <Button component={EnlaceRuta} to="/" variant="contained">Volver al inicio</Button>
    </Box>
  )
}
