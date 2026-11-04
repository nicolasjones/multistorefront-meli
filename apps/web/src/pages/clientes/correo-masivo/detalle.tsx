import { useEffect, useRef, useState } from 'react'
import { Link as RouterLink, useNavigate, useParams } from 'react-router'
import { Box, Button, Chip, LinearProgress, Paper, Stack, TablePagination, Typography } from '@mui/material'
import { useNivelSeccion } from '../../../hooks/useNivelSeccion'
import { useFiltroPorEmpresaActiva } from '../../../hooks/useFiltroPorEmpresaActiva'
import { useDetalleCampanaCorreo } from '../../../hooks/useHistorialCorreoMasivo'
import {
  ETIQUETA_ESTADO_CAMPANA, ETIQUETA_ESTADO_DESTINATARIO, RUTA_HISTORIAL_CORREO_MASIVO, textoFechaCampana, textoProgreso,
  type DestinatarioCampana, type EstadoDestinatario,
} from '../../../lib/correoMasivoHistorial'
import { EstadoCargaPagina, EstadoError } from '../../../components/estados/EstadosPagina'
import { EncabezadoPagina } from '../../../components/pagina/EncabezadoPagina'
import { ContenedorSeccion } from '../../../components/pagina/ContenedorSeccion'
import { ContenidoAdaptable, type ColumnaAdaptable } from '../../../components/pagina/ContenidoAdaptable'
import { ContextoOrganizacionActiva } from '../../../components/pagina/ContextoOrganizacionActiva'
import { PestanasCorreoMasivo } from './pestanas'

const TAMANO_PAGINA = 50
// Barra de progreso indeterminada: alto fino propio del componente, no un valor del sistema.
const ALTO_BARRA_CARGA = 2
const COLOR_ESTADO: Record<EstadoDestinatario, 'default' | 'success' | 'error' | 'warning'> = {
  pendiente: 'warning', enviado: 'success', fallido: 'error', omitido: 'default',
}

const columnas: ColumnaAdaptable<DestinatarioCampana>[] = [
  { clave: 'cliente', encabezado: 'Cliente', render: (d) => d.nombre },
  { clave: 'correo', encabezado: 'Correo', render: (d) => d.correo },
  {
    clave: 'estado', encabezado: 'Estado',
    render: (d) => (
      <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: 'wrap' }}>
        <Chip size="small" color={COLOR_ESTADO[d.estado]} label={ETIQUETA_ESTADO_DESTINATARIO[d.estado]} />
        {d.baja ? <Chip size="small" variant="outlined" label="Se dio de baja" /> : null}
      </Stack>
    ),
  },
  { clave: 'error', encabezado: 'Error', render: (d) => d.error ?? '' },
]

// Detalle de una campaña (F-CLI-13, FR-031/FR-033/FR-035/FR-036): asunto y mensaje enviados (texto plano) y cada
// destinatario con cliente, correo usado, estado y error corto. Solo lectura. Sigue la empresa activa: si cambia
// mientras se mira, vuelve al historial (que se reencuadra) y una campaña de otra tienda no se muestra.
// `key={id}`: al pasar a otra campaña el detalle se monta de nuevo y la paginación vuelve a la primera página.
export function CorreoMasivoDetalle() {
  const { id = '' } = useParams()
  return <DetalleCampana key={id} id={id} />
}

function DetalleCampana({ id }: { id: string }) {
  const navegar = useNavigate()
  const { nivel, isLoading: verificandoPermiso } = useNivelSeccion('clientes')
  const [pagina, setPagina] = useState(1)
  const { empresaActivaId, cargando: cargandoEmpresas } = useFiltroPorEmpresaActiva()
  // Referencia solo cuando las empresas ya cargaron: antes la activa es null y pasar a su id real no es un cambio.
  const empresaAlAbrir = useRef<string | null | undefined>(undefined)

  useEffect(() => {
    if (cargandoEmpresas) return
    if (empresaAlAbrir.current === undefined) empresaAlAbrir.current = empresaActivaId
    else if (empresaAlAbrir.current !== empresaActivaId) navegar(RUTA_HISTORIAL_CORREO_MASIVO, { replace: true })
  }, [empresaActivaId, cargandoEmpresas, navegar])

  const { datos, noExiste, isLoading, isFetching, isError, refetch } = useDetalleCampanaCorreo({ campanaId: id, pagina, tamano: TAMANO_PAGINA })

  const puedeVer = nivel === 'lectura' || nivel === 'edicion'
  const campana = datos?.campana ?? null
  // Una campaña armada con otra tienda no se muestra bajo la empresa activa (Principio VIII).
  const deOtraTienda = campana !== null && empresaActivaId !== null && campana.empresa_id !== empresaActivaId

  return (
    <Box>
      <EncabezadoPagina
        titulo="Correo masivo"
        descripcion="Detalle de la campaña: lo que se envió y el resultado por destinatario."
        contexto={<ContextoOrganizacionActiva />}
      />
      <ContenedorSeccion>
        {verificandoPermiso || nivel === null ? (
          <EstadoCargaPagina />
        ) : !puedeVer ? (
          <EstadoError titulo="Sin permiso" descripcion="Tu rol no puede ver el historial del correo masivo." />
        ) : (
          <Stack spacing={2}>
            <PestanasCorreoMasivo activa="historial" puedeCrear={nivel === 'edicion'} />
            <Box><Button component={RouterLink} to={RUTA_HISTORIAL_CORREO_MASIVO} size="small">Volver al historial</Button></Box>
            {isFetching && !isLoading ? <LinearProgress aria-label="Actualizando la campaña" sx={{ height: ALTO_BARRA_CARGA }} /> : null}
            <Box aria-busy={isFetching}>
              {isLoading ? (
                <EstadoCargaPagina />
              ) : noExiste || deOtraTienda ? (
                <EstadoError titulo="No encontramos esa campaña." descripcion="Puede ser de otra tienda o no existir." />
              ) : isError || campana === null ? (
                <EstadoError descripcion="No pudimos cargar la campaña." reintentar={() => void refetch()} />
              ) : (
                <Stack spacing={2}>
                  <Paper variant="outlined" sx={{ p: 2 }} component="section" aria-labelledby="campana-asunto">
                    <Stack spacing={1}>
                      <Typography id="campana-asunto" component="h2" variant="t2">{campana.asunto}</Typography>
                      <Typography variant="s" color="text.secondary">
                        {textoFechaCampana(campana.creada_en)} · {campana.autor} · {ETIQUETA_ESTADO_CAMPANA[campana.estado]}
                        {campana.estado === 'en_curso' ? ` (${textoProgreso(campana)})` : ''}
                      </Typography>
                      <Typography variant="s">
                        {campana.destinatarios} {campana.destinatarios === 1 ? 'destinatario' : 'destinatarios'} · {campana.enviados} enviados · {campana.fallidos} fallidos · {campana.omitidos} omitidos · {campana.bajas} {campana.bajas === 1 ? 'baja' : 'bajas'}
                      </Typography>
                      <Typography component="pre" sx={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', m: 0 }} aria-label="Mensaje enviado">{campana.mensaje}</Typography>
                    </Stack>
                  </Paper>
                  <ContenidoAdaptable
                    items={datos?.destinatarios ?? []}
                    columnas={columnas}
                    obtenerClave={(d) => d.cliente_id}
                    etiquetaTabla="Destinatarios de la campaña"
                  />
                  <TablePagination
                    component="div"
                    count={datos?.total ?? 0}
                    page={pagina - 1}
                    rowsPerPage={TAMANO_PAGINA}
                    rowsPerPageOptions={[TAMANO_PAGINA]}
                    onPageChange={(_, nueva) => setPagina(nueva + 1)}
                    labelRowsPerPage="Destinatarios por página"
                    labelDisplayedRows={({ from, to, count }) => `${from}–${to} de ${count}`}
                  />
                </Stack>
              )}
            </Box>
          </Stack>
        )}
      </ContenedorSeccion>
    </Box>
  )
}
