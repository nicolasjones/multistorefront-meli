import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router'
import { Box, Button, GlobalStyles, Stack, Typography } from '@mui/material'
import { supabaseClient } from '../../lib/supabase'
import { useOrganizacionActiva } from '../../hooks/useOrganizacionActiva'
import {
  armarEtiquetas, avisoOmitidos, COLUMNAS_ETIQUETA, idsDeParametro, type ClienteOmitido, type DatosEtiquetaCliente, type EtiquetaCliente,
} from '../../lib/etiquetasCliente'
import { EstadoCargaPagina, EstadoError, EstadoExito, EstadoVacio } from '../estados/EstadosPagina'
import { EncabezadoPagina } from '../pagina/EncabezadoPagina'
import { ContenedorSeccion } from '../pagina/ContenedorSeccion'

// Hoja de etiquetas de envío (F-CLI-17, FR-001/FR-005). Solo lee `public.clientes` (RLS por organización y
// sección); la impresión es del navegador: `@media print` oculta menú, barra y avisos (`.no-imprimir`).
const ESTILOS_IMPRESION = {
  '@page': { size: 'A4', margin: '10mm' },
  '@media print': {
    '.MuiAppBar-root, .MuiDrawer-root, nav, .no-imprimir': { display: 'none !important' },
    body: { background: '#fff !important' },
    '.hoja-etiquetas': { margin: '0 !important', padding: '0 !important', width: 'auto !important', maxWidth: 'none !important' },
  },
}

type Carga = { estado: 'cargando' } | { estado: 'error' } | { estado: 'listo'; aptas: EtiquetaCliente[]; omitidos: ClienteOmitido[] }

export function HojaEtiquetas() {
  const [parametros] = useSearchParams()
  const navegar = useNavigate()
  const location = useLocation()
  const { organizacionActiva } = useOrganizacionActiva()
  const organizacionId = organizacionActiva?.id ?? null
  const clave = parametros.get('ids')
  const [carga, setCarga] = useState<Carga>({ estado: 'cargando' })
  const [impresa, setImpresa] = useState(false)
  const ultimaPeticion = useRef(0)
  const volverA = (location.state as { volverA?: string } | null)?.volverA ?? '/clientes'

  const cargar = useCallback(async () => {
    const ids = idsDeParametro(clave)
    const peticion = ++ultimaPeticion.current
    if (ids.length === 0) {
      setCarga({ estado: 'listo', aptas: [], omitidos: [] })
      return
    }
    setCarga({ estado: 'cargando' })
    setImpresa(false)
    try {
      const { data, error } = await supabaseClient.from('clientes').select(COLUMNAS_ETIQUETA).in('id', ids)
      if (peticion !== ultimaPeticion.current) return
      if (error) throw error
      const porId = new Map((data as DatosEtiquetaCliente[] ?? []).map((c) => [c.id, c]))
      // Se respeta el orden de la selección.
      const clientes = ids.map((id) => porId.get(id)).filter((c): c is DatosEtiquetaCliente => Boolean(c))
      setCarga({ estado: 'listo', ...armarEtiquetas(clientes) })
    } catch {
      if (peticion === ultimaPeticion.current) setCarga({ estado: 'error' })
    }
  }, [clave])

  // Al cambiar la organización activa se recarga: nunca quedan etiquetas de la anterior.
  useEffect(() => { void cargar() }, [cargar, organizacionId])

  const aptas = carga.estado === 'listo' ? carga.aptas : []
  const omitidos = carga.estado === 'listo' ? carga.omitidos : []

  const imprimir = () => {
    window.print()
    setImpresa(true)
  }

  const volver = () => navegar(volverA, { state: impresa ? { mensaje: 'Etiqueta enviada a imprimir' } : undefined })

  return (
    <Box>
      <GlobalStyles styles={ESTILOS_IMPRESION} />
      <Box className="no-imprimir">
        <EncabezadoPagina
          titulo="Etiquetas de envío"
          descripcion="Una etiqueta por cliente, lista para imprimir o guardar como PDF."
          accion={(
            <Stack direction="row" spacing={1}>
              <Button onClick={volver}>Volver</Button>
              <Button variant="contained" onClick={imprimir} disabled={aptas.length === 0}>Imprimir</Button>
            </Stack>
          )}
        />
        <ContenedorSeccion>
          <Stack spacing={2}>
            {carga.estado === 'cargando' ? <EstadoCargaPagina /> : null}
            {carga.estado === 'error' ? <EstadoError descripcion="No pudimos cargar los clientes." reintentar={() => void cargar()} /> : null}
            {impresa ? <EstadoExito titulo="Etiqueta enviada a imprimir" /> : null}
            {omitidos.length > 0 ? (
              <EstadoError titulo="Algunos clientes no tienen etiqueta." descripcion={avisoOmitidos(omitidos)} />
            ) : null}
            {carga.estado === 'listo' && aptas.length === 0 && omitidos.length === 0 ? (
              <EstadoVacio titulo="No hay clientes para imprimir." descripcion="Volvé al listado y marcá al menos un cliente." />
            ) : null}
          </Stack>
        </ContenedorSeccion>
      </Box>
      {aptas.length > 0 ? (
        <Box
          component="section"
          className="hoja-etiquetas"
          aria-label="Etiquetas de envío"
          sx={{ bgcolor: '#fff', color: '#000', maxWidth: '210mm', mx: 'auto', p: '10mm', display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: '6mm' }}
        >
          {aptas.map((etiqueta) => (
            <Box component="article" key={etiqueta.id} aria-label={`Etiqueta de ${etiqueta.nombre}`} sx={{ border: '1px dashed #000', p: '5mm', breakInside: 'avoid' }}>
              <Typography component="p" variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>{etiqueta.nombre}</Typography>
              {etiqueta.lineas.map((linea) => <Typography key={linea} component="p" variant="body1">{linea}</Typography>)}
            </Box>
          ))}
        </Box>
      ) : null}
    </Box>
  )
}
