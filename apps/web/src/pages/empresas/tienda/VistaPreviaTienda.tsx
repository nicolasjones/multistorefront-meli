import { useEffect, useMemo, useState } from 'react'
import { Link as EnlaceRuta, Navigate, useParams } from 'react-router'
import { Alert, Box, Button, Stack, Typography } from '@mui/material'
import { useEmpresasAccesibles } from '../../../hooks/useEmpresasAccesibles'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../../../components/estados/EstadosPagina'
import { EncabezadoPagina } from '../../../components/pagina/EncabezadoPagina'
import { fuenteDesdeVistaPrevia, ProveedorFuenteTienda, type FuenteTienda } from '../../../lib/fuenteTienda'
import { leerVistaPrevia } from '../../../lib/tiendaBorrador'
import type { TiendaPublica } from '../../../lib/tienda'
import { ProveedorTemaTienda } from '../../../tema/ProveedorTemaTienda'
import { PaginaTienda } from '../../tienda-publica/PaginaTienda'

// F-TDA-06 (FR-060, FR-070): vista previa de la home con el borrador sobre lo publicado, en
// `/empresas/:id/tienda/vista-previa` (autenticada, edición en Empresas). Reutiliza las secciones del front público
// alimentadas por `public.vista_previa_tienda` (nunca por `publico.*`). Lleva «no indexar» y no escribe nada.
// Navegar catálogo, ficha y búsqueda dentro de la vista previa queda fuera de alcance: los enlaces no navegan.

const HOST_VISTA_PREVIA = 'vista-previa'

// <meta name="robots" content="noindex,nofollow"> mientras la página está montada.
function useNoIndexar() {
  useEffect(() => {
    const meta = document.createElement('meta')
    meta.name = 'robots'
    meta.content = 'noindex,nofollow'
    document.head.appendChild(meta)
    return () => meta.remove()
  }, [])
}

type Carga = { fase: 'cargando' } | { fase: 'error' } | { fase: 'lista'; nombre: string; enLinea: boolean; fuente: FuenteTienda }

function VistaPrevia({ empresaId }: { empresaId: string }) {
  const [carga, setCarga] = useState<Carga>({ fase: 'cargando' })
  const [intento, setIntento] = useState(0)

  useEffect(() => {
    let cancelada = false
    setCarga({ fase: 'cargando' })
    leerVistaPrevia(empresaId)
      .then(async (vista) => ({ vista, fuente: await fuenteDesdeVistaPrevia(vista) }))
      .then(({ vista, fuente }) => { if (!cancelada) setCarga({ fase: 'lista', nombre: vista.empresaNombre, enLinea: vista.enLinea, fuente }) })
      .catch((error) => {
        console.error('No se pudo cargar la vista previa de la tienda', error instanceof Error ? error.message : error)
        if (!cancelada) setCarga({ fase: 'error' })
      })
    return () => { cancelada = true }
  }, [empresaId, intento])

  const tienda = useMemo<TiendaPublica | null>(
    () => (carga.fase === 'lista' ? { tiendaId: HOST_VISTA_PREVIA, empresaNombre: carga.nombre, estado: 'activa' } : null),
    [carga],
  )

  if (carga.fase === 'cargando') return <EstadoCargaPagina />
  if (carga.fase === 'error' || !tienda) {
    return <EstadoError titulo="No pudimos cargar la vista previa." descripcion="Revisá tu conexión e intentá de nuevo." reintentar={() => setIntento((n) => n + 1)} />
  }
  const { fuente } = carga
  return (
    <Stack spacing={2}>
      <Alert severity="info" role="status">Así se ve la tienda con los cambios sin publicar. Los enlaces no navegan en la vista previa.</Alert>
      {!carga.enLinea ? <Alert severity="warning" role="status">La empresa está desactivada: los visitantes ven «Volvemos pronto».</Alert> : null}
      <ProveedorFuenteTienda value={fuente}>
        <ProveedorTemaTienda identidad={fuente.identidad}>
          <Box
            data-testid="vista-previa-tienda"
            // Los enlaces de las secciones públicas llevan a rutas de la tienda, que no existen en el panel.
            onClickCapture={(evento) => { if ((evento.target as HTMLElement).closest('a')) evento.preventDefault() }}
            sx={{ border: 1, borderColor: 'divider', borderRadius: (tema) => `${tema.shape.borderRadius}px`, bgcolor: fuente.identidad.colorFondo, color: 'text.primary', p: 2, overflow: 'hidden' }}
          >
            <Typography component="p" variant="h5" sx={{ fontWeight: 700, mb: 1 }}>{carga.nombre}</Typography>
            <PaginaTienda tienda={tienda} host={HOST_VISTA_PREVIA} />
          </Box>
        </ProveedorTemaTienda>
      </ProveedorFuenteTienda>
    </Stack>
  )
}

// Opera sobre la empresa activa de la barra superior (Principio VIII): si la activa cambia, la ruta la sigue y la
// vista previa se carga de nuevo. Sin empresa concreta se pide elegir una.
export function VistaPreviaTiendaPagina() {
  const { id } = useParams()
  const { empresaActivaId, isLoading } = useEmpresasAccesibles()
  useNoIndexar()

  if (isLoading) return <EstadoCargaPagina />
  if (!empresaActivaId) {
    return <EstadoVacio titulo="Elegí una empresa" descripcion="La vista previa es de una sola empresa: elegila en la barra superior." />
  }
  if (id !== empresaActivaId) return <Navigate to={`/empresas/${empresaActivaId}/tienda/vista-previa`} replace />

  return (
    <>
      <EncabezadoPagina
        titulo="Vista previa de la tienda"
        descripcion="La página de inicio con los cambios sin publicar."
        accion={<Button component={EnlaceRuta} to={`/empresas/${empresaActivaId}/tienda/publicacion`} variant="outlined">Volver a Dominio y publicación</Button>}
      />
      <VistaPrevia key={empresaActivaId} empresaId={empresaActivaId} />
    </>
  )
}
