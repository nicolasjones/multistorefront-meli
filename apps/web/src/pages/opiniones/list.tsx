import { useEffect, useRef, useState } from 'react'
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, LinearProgress, Stack,
  TextField, ToggleButton, ToggleButtonGroup, Typography,
} from '@mui/material'
import { useFiltroPorEmpresaActiva } from '../../hooks/useFiltroPorEmpresaActiva'
import { useOpinionesPanel } from '../../hooks/useOpinionesPanel'
import {
  ETIQUETA_ESTADO_OPINION,
  type FiltroEstadoOpinion,
  MAX_MOTIVO_RECHAZO,
  type OpinionPanel,
  esConflictoOpinion,
  largoMotivo,
  leerBanderaOpiniones,
  mensajeDeErrorOpiniones,
  moderarOpinion,
  normalizarMotivo,
  textoPuntuacion,
} from '../../lib/opiniones'
import { EstadoCargaPagina, EstadoError, EstadoExito, EstadoVacio } from '../../components/estados/EstadosPagina'
import { EtiquetaEstado, type VarianteEtiqueta } from '../../components/base/EtiquetaEstado'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { ContenedorSeccion } from '../../components/pagina/ContenedorSeccion'
import { CargaInfinita } from '../../components/pagina/CargaInfinita'
import { BarraHerramientas } from '../../components/pagina/BarraHerramientas'
import { ContextoOrganizacionActiva } from '../../components/pagina/ContextoOrganizacionActiva'
import { FiltroEmpresa } from '../../components/pagina/FiltroEmpresa'

// Barra de progreso indeterminada: alto fino propio del componente, no un valor del sistema.
const ALTO_BARRA_CARGA = 2

const FILTROS: ReadonlyArray<{ valor: FiltroEstadoOpinion; etiqueta: string }> = [
  { valor: 'pendiente', etiqueta: 'Pendientes' },
  { valor: 'aceptada', etiqueta: 'Aceptadas' },
  { valor: 'rechazada', etiqueta: 'Rechazadas' },
  { valor: 'todas', etiqueta: 'Todas' },
]

const VARIANTE_ESTADO: Record<OpinionPanel['estado'], VarianteEtiqueta> = { pendiente: 'aviso', aceptada: 'exito', rechazada: 'error' }

const AVISO_BANDERA_APAGADA = 'Las opiniones están desactivadas en este entorno: por ahora solo podés rechazar. Pedile al equipo técnico que las active para poder aceptarlas.'
const AVISO_CAMBIO_EMPRESA = 'Cambiaste de tienda: cerramos el diálogo sin rechazar la opinión. Volvé a elegirla si querés rechazarla.'

const fechaCorta = (iso: string) => new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })

// Pantalla «Opiniones» (MSF-467, F-OPI): moderación previa de las opiniones de la tienda. Solo el Administrador (el menú no
// la ofrece a otros y las RPC responden 42501). Lista y contadores salen del servidor para el ámbito de la tienda: la
// empresa activa de la barra superior (o «Todas las tiendas»). Con la bandera `tienda_opiniones` apagada solo se permite
// rechazar (lo que reduce exposición); la base lo impone igual.
export function OpinionesList() {
  const { empresas, valor: empresaId, cambiar: elegirEmpresa, cargando: cargandoTiendas, hayError: errorTiendas } = useFiltroPorEmpresaActiva()
  const [estado, setEstado] = useState<FiltroEstadoOpinion>('pendiente')
  const [habilitada, setHabilitada] = useState<boolean | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [avisoError, setAvisoError] = useState<string | null>(null)
  const [ocupada, setOcupada] = useState<string | null>(null)
  // Opinión que se está rechazando (diálogo del motivo); `null` = cerrado.
  const [rechazando, setRechazando] = useState<OpinionPanel | null>(null)
  const [motivo, setMotivo] = useState('')

  const listado = useOpinionesPanel({ estado, empresaId })

  useEffect(() => {
    let vigente = true
    void leerBanderaOpiniones().then((activa) => { if (vigente) setHabilitada(activa) })
    return () => { vigente = false }
  }, [])

  // Cambió la tienda (barra superior o píldoras): el diálogo abierto se cierra con aviso, nunca guarda con la anterior.
  const empresaAnterior = useRef(empresaId)
  useEffect(() => {
    if (empresaAnterior.current === empresaId) return
    empresaAnterior.current = empresaId
    // Los avisos de la tienda anterior no se arrastran a la nueva.
    setAviso(null)
    setAvisoError(null)
    if (rechazando !== null) {
      setRechazando(null)
      setMotivo('')
      setAviso(AVISO_CAMBIO_EMPRESA)
    }
  }, [empresaId, rechazando])

  const puedeAceptar = habilitada === true

  const decidir = async (opinion: OpinionPanel, decision: 'aceptar' | 'rechazar', textoMotivo?: string | null) => {
    if (ocupada) return
    setAviso(null)
    setAvisoError(null)
    setOcupada(opinion.id)
    try {
      const resultado = await moderarOpinion({ id: opinion.id, decision, motivo: textoMotivo, actualizadaEn: opinion.actualizada_en })
      if (resultado.estado === 'no_encontrada') {
        setAvisoError('La opinión ya no existe. Recargamos la lista.')
      } else {
        setAviso(decision === 'aceptar' ? 'Opinión aceptada' : 'Opinión rechazada')
      }
      setRechazando(null)
      setMotivo('')
      listado.recargar()
    } catch (error) {
      setAvisoError(mensajeDeErrorOpiniones(error, 'No pudimos guardar la decisión. Intentá de nuevo.'))
      if (esConflictoOpinion(error)) {
        setRechazando(null)
        setMotivo('')
        listado.recargar()
      }
    } finally {
      setOcupada(null)
    }
  }

  const hayFiltros = estado !== 'pendiente' || empresaId !== null
  const { contadores } = listado
  const largoActual = largoMotivo(motivo)
  const motivoLargo = largoActual > MAX_MOTIVO_RECHAZO

  return (
    <Box>
      <EncabezadoPagina
        titulo="Opiniones"
        descripcion="Moderá las opiniones que los clientes dejan sobre tus productos."
        contexto={<ContextoOrganizacionActiva />}
      />
      <ContenedorSeccion>
        <Stack spacing={2}>
          <Alert severity="info" role="note">
            Las opiniones nuevas quedan pendientes hasta que las aceptes o rechazes. Solo las aceptadas se muestran en la tienda.
          </Alert>
          {habilitada === false ? <Alert severity="warning" role="status">{AVISO_BANDERA_APAGADA}</Alert> : null}
          {aviso ? <EstadoExito titulo={aviso} /> : null}
          {avisoError ? <Alert severity="error">{avisoError}</Alert> : null}

          <FiltroEmpresa
            empresas={empresas}
            valor={empresaId}
            onCambiar={elegirEmpresa}
            cargando={cargandoTiendas}
            hayError={errorTiendas}
            textoAyuda="Cada opinión pertenece a la tienda donde se escribió. Si elegís una empresa en la barra superior, se filtra por esa tienda."
          />

          <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap aria-label="Resumen de opiniones" role="group">
            {([['Pendientes', contadores.pendientes], ['Aceptadas', contadores.aceptadas], ['Rechazadas', contadores.rechazadas]] as const).map(([etiqueta, valor]) => (
              <Box key={etiqueta} sx={{ border: 1, borderColor: 'divider', borderRadius: (tema) => `${tema.shape.borderRadius}px`, px: 2, py: 1.5, minWidth: 140, bgcolor: 'background.paper' }}>
                <Typography variant="body2" color="text.secondary">{etiqueta}</Typography>
                <Typography component="p" variant="t2">{listado.cargando && listado.filas.length === 0 ? '—' : valor}</Typography>
              </Box>
            ))}
          </Stack>

          <BarraHerramientas>
            <ToggleButtonGroup
              exclusive
              size="small"
              aria-label="Filtrar por estado"
              value={estado}
              onChange={(_, valor: FiltroEstadoOpinion | null) => { if (valor !== null) setEstado(valor) }}
            >
              {FILTROS.map(({ valor, etiqueta }) => <ToggleButton key={valor} value={valor}>{etiqueta}</ToggleButton>)}
            </ToggleButtonGroup>
          </BarraHerramientas>

          {listado.cargando && listado.filas.length > 0 ? <LinearProgress aria-label="Actualizando opiniones" sx={{ height: ALTO_BARRA_CARGA }} /> : null}

          <Box aria-busy={listado.cargando}>
            {listado.cargando && listado.filas.length === 0 ? (
              <EstadoCargaPagina />
            ) : listado.sinPermiso ? (
              <EstadoError titulo="No tenés acceso" descripcion="Solo un Administrador puede moderar opiniones." />
            ) : listado.hayError ? (
              <EstadoError descripcion="No pudimos cargar las opiniones." reintentar={listado.recargar} />
            ) : listado.filas.length === 0 ? (
              hayFiltros
                ? <EstadoVacio titulo="Sin resultados" descripcion="No hay opiniones con este estado en esta tienda." />
                : <EstadoVacio titulo="No hay opiniones pendientes." descripcion="Cuando un cliente deje una, la vas a ver acá." />
            ) : (
              <>
                <Box component="ul" aria-label="Opiniones" sx={{ listStyle: 'none', m: 0, p: 0, border: 1, borderColor: 'divider', borderRadius: (tema) => `${tema.shape.borderRadius}px`, bgcolor: 'background.paper' }}>
                  {listado.filas.map((opinion) => (
                    <Box component="li" key={opinion.id} sx={{ p: 2, borderTop: 1, borderColor: 'divider', '&:first-of-type': { borderTop: 0 }, display: 'flex', gap: 2, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                      <Box sx={{ flex: 1, minWidth: 240 }}>
                        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                          {empresaId === null ? <EtiquetaEstado texto={opinion.empresa_nombre} variante="contorno" /> : null}
                          <Typography component="span" sx={{ fontWeight: 600 }}>{opinion.cliente_nombre}</Typography>
                          <Typography component="span" variant="body2" color="text.secondary">{fechaCorta(opinion.creada_en)}</Typography>
                          <EtiquetaEstado texto={ETIQUETA_ESTADO_OPINION[opinion.estado]} variante={VARIANTE_ESTADO[opinion.estado]} />
                          <Typography component="span" variant="body2" sx={{ fontWeight: 600 }}>{textoPuntuacion(opinion.puntuacion)}</Typography>
                        </Stack>
                        <Typography sx={{ mt: 0.75, overflowWrap: 'anywhere' }}>{opinion.comentario}</Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>Sobre: {opinion.producto_nombre}</Typography>
                        {opinion.estado === 'rechazada' && opinion.motivo_rechazo ? (
                          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>Motivo del rechazo: {opinion.motivo_rechazo}</Typography>
                        ) : null}
                      </Box>
                      <Stack direction="row" spacing={1}>
                        {opinion.estado !== 'aceptada' ? (
                          <Button
                            size="small"
                            variant="outlined"
                            aria-label={`Aceptar la opinión de ${opinion.cliente_nombre} sobre ${opinion.producto_nombre}`}
                            disabled={!puedeAceptar || ocupada !== null}
                            onClick={() => void decidir(opinion, 'aceptar')}
                          >
                            Aceptar
                          </Button>
                        ) : null}
                        {opinion.estado !== 'rechazada' ? (
                          <Button
                            size="small"
                            variant="outlined"
                            color="error"
                            aria-label={`Rechazar la opinión de ${opinion.cliente_nombre} sobre ${opinion.producto_nombre}`}
                            disabled={ocupada !== null}
                            onClick={() => { setAviso(null); setAvisoError(null); setMotivo(''); setRechazando(opinion) }}
                          >
                            Rechazar
                          </Button>
                        ) : null}
                      </Stack>
                    </Box>
                  ))}
                </Box>
                <CargaInfinita
                  hayMas={listado.hayMas}
                  cargando={listado.cargandoMas}
                  hayError={listado.errorTanda}
                  onCargarMas={listado.cargarMas}
                  sustantivo="opiniones"
                  cargados={listado.filas.length}
                />
              </>
            )}
          </Box>
        </Stack>
      </ContenedorSeccion>

      <Dialog open={rechazando !== null} onClose={() => { if (!ocupada) { setRechazando(null); setMotivo('') } }} fullWidth maxWidth="xs" aria-labelledby="titulo-rechazar-opinion">
        <DialogTitle id="titulo-rechazar-opinion">Rechazar opinión</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            La opinión no se muestra en la tienda. El cliente la ve como rechazada en su cuenta, con el motivo si lo indicás.
          </DialogContentText>
          <TextField
            label="Motivo (opcional)"
            value={motivo}
            onChange={(evento) => setMotivo(evento.target.value)}
            fullWidth
            error={motivoLargo}
            helperText={motivoLargo ? `Admite hasta ${MAX_MOTIVO_RECHAZO} caracteres.` : `${largoActual}/${MAX_MOTIVO_RECHAZO}`}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setRechazando(null); setMotivo('') }} disabled={ocupada !== null}>Cancelar</Button>
          <Button
            variant="contained"
            color="error"
            disabled={ocupada !== null || motivoLargo}
            onClick={() => { if (rechazando) void decidir(rechazando, 'rechazar', normalizarMotivo(motivo) === '' ? null : normalizarMotivo(motivo)) }}
          >
            Rechazar
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
