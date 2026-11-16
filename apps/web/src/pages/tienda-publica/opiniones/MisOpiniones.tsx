import { Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Link, Typography } from '@mui/material'
import { useState } from 'react'
import { Link as EnlaceRuta } from 'react-router'
import { CargaInfinita } from '../../../components/pagina/CargaInfinita'
import { EstadoCargaPagina } from '../../../components/estados/EstadosPagina'
import { useListadoPorCursor } from '../../../hooks/useListadoPorCursor'
import { esSinAcceso } from '../../../lib/tiendaCuentaDatos'
import { type EstadoOpinion } from '../../../lib/estadoOpinion'
import { borrarOpinion, leerMisOpiniones, type CursorOpiniones, type MiOpinion } from '../../../lib/tiendaOpiniones'
import { AvisoTienda } from '../cuenta/AvisoTienda'
import { crearAviso, type AvisoCuenta } from '../cuenta/aviso'
import { VacioMiCuenta } from '../cuenta/VacioMiCuenta'
import { ErrorConReintento } from '../ErrorConReintento'
import { LINEA_SUAVE } from '../layout/medidas'
import { EstrellasLectura } from './EstrellasPuntuacion'
import { FormularioOpinion, TEXTO_GRACIAS } from './FormularioOpinion'

const ETIQUETA_ESTADO: Record<EstadoOpinion, { texto: string; color: 'default' | 'success' | 'error' | 'warning' }> = {
  pendiente: { texto: 'Pendiente de revisión', color: 'warning' },
  aceptada: { texto: 'Publicada', color: 'success' },
  rechazada: { texto: 'Rechazada', color: 'error' },
}

// «Mis opiniones» de «Mi cuenta» (MSF-467, RF-OPI-8, RF-OPI-11): las opiniones de la cuenta en ESTA tienda con su estado (y el motivo
// si fue rechazada), por tandas con carga infinita. Editar abre el formulario con los datos actuales: una opinión editada vuelve a
// «Pendiente de revisión». Borrar pide confirmación. Solo se monta con la función de opiniones encendida.
export function MisOpiniones({ host, alSinAcceso }: { host: string; alSinAcceso: () => void }) {
  const [aviso, setAviso] = useState<AvisoCuenta | null>(null)
  const [editando, setEditando] = useState<string | null>(null)
  const [porBorrar, setPorBorrar] = useState<MiOpinion | null>(null)
  const [borrando, setBorrando] = useState(false)
  const publicar = (mensaje: string, error = false) => setAviso(crearAviso(mensaje, error))

  const listado = useListadoPorCursor<MiOpinion, CursorOpiniones>({
    clave: host,
    leer: (cursor) => leerMisOpiniones(host, cursor),
    idDe: (fila) => fila.id,
    alSinAcceso,
  })

  const confirmarBorrado = async () => {
    if (!porBorrar || borrando) return
    setBorrando(true)
    try {
      const resultado = await borrarOpinion(host, porBorrar.productoId)
      if (resultado.estado === 'ok') {
        listado.quitar(porBorrar.id)
        publicar('Borramos tu opinión')
        setPorBorrar(null)
      } else {
        publicar('Hiciste muchos intentos seguidos. Probá de nuevo en un minuto.', true)
      }
    } catch (error) {
      if (esSinAcceso(error)) alSinAcceso()
      else publicar('No pudimos borrar tu opinión. Probá de nuevo.', true)
    } finally {
      setBorrando(false)
    }
  }

  if (listado.fase === 'sin_acceso') return null
  if (listado.fase === 'cargando') return <EstadoCargaPagina etiqueta="Cargando tus opiniones" />
  if (listado.fase === 'error') return <ErrorConReintento titulo="No pudimos cargar tus opiniones." alReintentar={listado.reintentar} />
  if (listado.filas.length === 0 && !listado.hayMas) {
    return <VacioMiCuenta titulo="Todavía no dejaste opiniones" descripcion="Entrá a la ficha de un producto y contanos qué te pareció." />
  }

  return (
    <Box>
      <Typography component="p" aria-live="polite" color="text.secondary" sx={{ mb: 1 }}>{listado.total} {listado.total === 1 ? 'opinión' : 'opiniones'}</Typography>
      <Box component="ul" aria-label="Mis opiniones" sx={{ listStyle: 'none', m: 0, p: 0, display: 'grid', gap: 2 }}>
        {listado.filas.map((opinion) => {
          const estado = ETIQUETA_ESTADO[opinion.estado]
          return (
            <Box component="li" key={opinion.id} sx={{ border: LINEA_SUAVE, borderRadius: (tema) => `${tema.shape.borderRadius}px`, p: 2, minWidth: 0 }}>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 1, rowGap: 0.5 }}>
                <Link component={EnlaceRuta} to={`/producto/${encodeURIComponent(opinion.productoId)}`} color="inherit" sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{opinion.productoNombre}</Link>
                <Chip size="small" color={estado.color} label={estado.texto} />
              </Box>
              {editando === opinion.id ? (
                <Box sx={{ mt: 1.5 }}>
                  <FormularioOpinion
                    host={host}
                    productoId={opinion.productoId}
                    inicial={{ puntuacion: opinion.puntuacion, comentario: opinion.comentario }}
                    textoEnviar="Guardar cambios"
                    alCancelar={() => setEditando(null)}
                    alSinAcceso={alSinAcceso}
                    alGuardar={() => { setEditando(null); publicar(TEXTO_GRACIAS); listado.reintentar() }}
                  />
                </Box>
              ) : (
                <>
                  <Box sx={{ mt: 0.5 }}><EstrellasLectura valor={opinion.puntuacion} tamano="small" /></Box>
                  <Typography sx={{ mt: 0.5, overflowWrap: 'anywhere', whiteSpace: 'pre-line' }}>{opinion.comentario}</Typography>
                  {opinion.estado === 'rechazada' ? (
                    <Typography color="text.secondary" sx={{ mt: 0.5 }}>{opinion.motivoRechazo ? `Motivo: ${opinion.motivoRechazo}` : 'No cumple con las pautas de la tienda.'}</Typography>
                  ) : null}
                  <Box sx={{ mt: 1, display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                    <Button size="small" variant="outlined" aria-label={`Editar mi opinión sobre ${opinion.productoNombre}`} onClick={() => setEditando(opinion.id)} sx={{ minHeight: (tema) => tema.spacing(5.5), width: { xs: '100%', sm: 'auto' } }}>Editar</Button>
                    <Button size="small" variant="outlined" color="error" aria-label={`Borrar mi opinión sobre ${opinion.productoNombre}`} onClick={() => setPorBorrar(opinion)} sx={{ minHeight: (tema) => tema.spacing(5.5), width: { xs: '100%', sm: 'auto' } }}>Borrar</Button>
                  </Box>
                </>
              )}
            </Box>
          )
        })}
      </Box>
      <CargaInfinita hayMas={listado.hayMas} cargando={listado.cargandoMas} hayError={listado.errorMas} onCargarMas={listado.cargarMas} textoFin="Llegaste al final de tus opiniones" sustantivo="opiniones" cargados={listado.filas.length} />
      <Dialog open={porBorrar !== null} onClose={() => { if (!borrando) setPorBorrar(null) }} aria-labelledby="borrar-opinion-titulo">
        <DialogTitle id="borrar-opinion-titulo">¿Borrar tu opinión?</DialogTitle>
        <DialogContent>
          <DialogContentText>Vas a borrar tu opinión sobre «{porBorrar?.productoNombre}». No se puede deshacer.</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPorBorrar(null)} disabled={borrando}>Cancelar</Button>
          <Button color="error" variant="contained" onClick={() => { void confirmarBorrado() }} disabled={borrando}>Borrar</Button>
        </DialogActions>
      </Dialog>
      <AvisoTienda aviso={aviso} alCerrar={() => setAviso(null)} />
    </Box>
  )
}
