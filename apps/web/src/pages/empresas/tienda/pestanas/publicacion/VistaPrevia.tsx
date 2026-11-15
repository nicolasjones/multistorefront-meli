import { useCallback, useEffect, useRef, useState } from 'react'
import { Link as EnlaceRuta } from 'react-router'
import { Box, Button, Card, CardContent, Stack, Typography } from '@mui/material'
import { leerVistaPrevia, type VistaPreviaTienda } from '../../../../../lib/tiendaBorrador'
import { identidadDesdeFila, urlPublica, type FilaIdentidad } from '../../../../../lib/tiendaIdentidad'
import { formatearPrecioTienda } from '../../../../../lib/tiendaCatalogo'
import { EstadoCargaPagina, EstadoError } from '../../../../../components/estados/EstadosPagina'
import type { PropsPestanaTienda } from '../../pestanas'
import { EVENTO_PUBLICACION } from './Publicacion'

// F-TDA-06 (FR-059): tarjeta «Vista previa» de «Dominio y publicación». Banner, logo y tres productos de ejemplo
// alimentados por `public.vista_previa_tienda` (borrador sobre lo publicado, con precios y estado reales). La
// vista completa está en `/empresas/:id/tienda/vista-previa`. Va después de «Publicación».
export const orden = 30

function Tarjeta({ empresaId, empresaNombre }: PropsPestanaTienda) {
  const [vista, setVista] = useState<VistaPreviaTienda | null>(null)
  const [hayError, setHayError] = useState(false)
  const [cargando, setCargando] = useState(true)
  const ultima = useRef(0)

  const cargar = useCallback(async () => {
    const peticion = ++ultima.current
    setCargando(true)
    try {
      const resultado = await leerVistaPrevia(empresaId)
      if (peticion !== ultima.current) return
      setVista(resultado)
      setHayError(false)
    } catch (error) {
      if (peticion !== ultima.current) return
      console.error('No se pudo cargar la vista previa de la tienda', error instanceof Error ? error.message : error)
      setVista(null)
      setHayError(true)
    }
    setCargando(false)
  }, [empresaId])

  useEffect(() => {
    void cargar()
    return () => { ultima.current++ }
  }, [cargar])

  // Al publicar o descartar, la vista previa se relee.
  useEffect(() => {
    const alCambiar = (evento: Event) => {
      if ((evento as CustomEvent<{ empresaId: string }>).detail?.empresaId === empresaId) void cargar()
    }
    window.addEventListener(EVENTO_PUBLICACION, alCambiar)
    return () => window.removeEventListener(EVENTO_PUBLICACION, alCambiar)
  }, [empresaId, cargar])

  const identidad = vista ? identidadDesdeFila(vista.identidad as unknown as FilaIdentidad) : null
  const logo = urlPublica(identidad?.logoRuta ?? null)
  const banner = urlPublica(identidad?.bannerRuta ?? null)

  return (
    <Card component="section" aria-labelledby="titulo-vista-previa">
      <CardContent>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ justifyContent: 'space-between', mb: 2 }}>
          <Box>
            <Typography id="titulo-vista-previa" variant="h6" component="h2">Vista previa</Typography>
            <Typography variant="body2" color="text.secondary">Se actualiza con los cambios sin publicar.</Typography>
          </Box>
          <Button component={EnlaceRuta} to={`/empresas/${empresaId}/tienda/vista-previa`} variant="outlined" sx={{ alignSelf: { sm: 'flex-start' } }}>
            Abrir vista previa
          </Button>
        </Stack>
        {cargando && !vista ? <EstadoCargaPagina lineas={2} /> : null}
        {hayError ? <EstadoError descripcion="No pudimos cargar la vista previa." reintentar={() => void cargar()} /> : null}
        {vista && identidad ? (
          <Box data-testid="tarjeta-vista-previa" sx={{ border: 1, borderColor: 'divider', borderRadius: (tema) => `${tema.shape.borderRadius}px`, overflow: 'hidden', bgcolor: identidad.colorFondo }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 1 }}>
              {logo ? <Box component="img" src={logo} alt={`Logo de ${empresaNombre}`} sx={{ height: (tema) => tema.spacing(4), maxWidth: 140, objectFit: 'contain' }} /> : null}
              <Typography component="span" sx={{ fontWeight: 700, color: identidad.colorPrimario }}>{vista.empresaNombre}</Typography>
            </Box>
            {banner ? <Box component="img" src={banner} alt="" sx={{ display: 'block', width: '100%', height: 'auto', maxHeight: 200, objectFit: 'cover' }} /> : null}
            <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 1.5, display: 'grid', gap: 1, gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}>
              {vista.destacados.slice(0, 3).map((p) => (
                <Box component="li" key={p.id} sx={{ border: 1, borderColor: 'divider', borderRadius: (tema) => `${tema.shape.borderRadius}px`, p: 1 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>{p.nombre}</Typography>
                  <Typography variant="body2" sx={{ color: identidad.colorAcento }}>{formatearPrecioTienda('', p.precio).trim()}</Typography>
                </Box>
              ))}
            </Box>
            {vista.destacados.length === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ px: 1.5, pb: 1.5 }}>Todavía no hay productos destacados para mostrar.</Typography>
            ) : null}
          </Box>
        ) : null}
      </CardContent>
    </Card>
  )
}

// Con otra empresa activa la tarjeta se monta de cero (key): nunca queda la vista previa de la anterior.
export default function VistaPrevia(props: PropsPestanaTienda) {
  return <Tarjeta key={props.empresaId} {...props} />
}
