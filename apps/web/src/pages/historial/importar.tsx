import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { Link as RouterLink } from 'react-router'
import { Alert, Box, Button, MenuItem, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '@mui/material'
import { usePuedeEscribir } from '../../hooks/usePuedeEscribir'
import { useOrganizacionDeTrabajo } from '../../hooks/useOrganizacionDeTrabajo'
import { supabaseClient } from '../../lib/supabase'
import {
  BUCKET_HISTORIAL,
  MAX_RECHAZOS_VISIBLES,
  TIPOS_HISTORIAL,
  mensajeDeErrorImportacion,
  rutaDeSubida,
  validarArchivo,
  type EjecucionImportacion,
  type TipoHistorial,
} from '../../lib/historial'
import { EstadoCargaPagina, EstadoError, EstadoExito } from '../../components/estados/EstadosPagina'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { ContenedorSeccion } from '../../components/pagina/ContenedorSeccion'
import { ContextoOrganizacionActiva } from '../../components/pagina/ContextoOrganizacionActiva'

const INTERVALO_CONSULTA_MS = 3000

// Importación del historial (F-VTA-37, FR-010). Sin diseño en el prototipo: se arma con el kit de
// panel. La importación es de la organización (la tienda de cada fila sale de la planilla), así
// que la empresa activa no aplica. Solo quien puede escribir; la autorización real es la RPC.
export function ImportarHistorial() {
  const { puedeEscribir, isLoading: cargandoPermiso } = usePuedeEscribir()
  const { organizacionId, isLoading: cargandoOrganizacion } = useOrganizacionDeTrabajo()
  const [tipo, setTipo] = useState<TipoHistorial>('comprobantes')
  const [archivo, setArchivo] = useState<File | null>(null)
  const [errorFormulario, setErrorFormulario] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [ejecucionId, setEjecucionId] = useState<string | null>(null)
  const [ejecucion, setEjecucion] = useState<EjecucionImportacion | null>(null)
  const [errorConsulta, setErrorConsulta] = useState(false)
  // Guarda síncrona contra el doble clic (el estado tarda un render en deshabilitar el botón).
  const enCurso = useRef(false)

  const consultar = useCallback(async (id: string) => {
    const { data, error } = await supabaseClient
      .from('ejecuciones_worker')
      .select('id, estado, motivo_sanitizado, detalle')
      .eq('id', id)
      .maybeSingle()
    if (error || !data) {
      setErrorConsulta(true)
      return null
    }
    setErrorConsulta(false)
    setEjecucion(data as EjecucionImportacion)
    return data as EjecucionImportacion
  }, [])

  // Sigue la ejecución mientras esté en curso.
  useEffect(() => {
    if (!ejecucionId) return
    let vigente = true
    let temporizador: ReturnType<typeof setTimeout> | undefined
    const ciclo = async () => {
      const actual = await consultar(ejecucionId)
      if (!vigente) return
      if (!actual || actual.estado === 'en_curso') temporizador = setTimeout(() => void ciclo(), INTERVALO_CONSULTA_MS)
    }
    void ciclo()
    return () => {
      vigente = false
      if (temporizador) clearTimeout(temporizador)
    }
  }, [ejecucionId, consultar])

  if (cargandoPermiso || cargandoOrganizacion) return <EstadoCargaPagina />
  if (!puedeEscribir || !organizacionId) {
    return <Alert severity="error" sx={{ m: 2 }}>Solo un administrador con una organización activa puede importar el historial.</Alert>
  }

  const elegirArchivo = (evento: ChangeEvent<HTMLInputElement>) => {
    setArchivo(evento.target.files?.[0] ?? null)
    setErrorFormulario(null)
  }

  const importar = async (evento: FormEvent) => {
    evento.preventDefault()
    if (enCurso.current) return
    if (!archivo) {
      setErrorFormulario('Elegí la planilla a importar.')
      return
    }
    const invalido = validarArchivo(archivo)
    if (invalido) {
      setErrorFormulario(invalido)
      return
    }
    enCurso.current = true
    setEnviando(true)
    setErrorFormulario(null)
    setEjecucion(null)
    setEjecucionId(null)
    try {
      const ruta = rutaDeSubida(organizacionId, tipo, archivo.name)
      const { error: errorSubida } = await supabaseClient.storage.from(BUCKET_HISTORIAL).upload(ruta, archivo, { upsert: false })
      if (errorSubida) {
        console.error('No pudimos subir la planilla.', errorSubida)
        setErrorFormulario('No pudimos subir la planilla. Intentá de nuevo.')
        return
      }
      const { data, error } = await supabaseClient.rpc('solicitar_importacion_historial', { p_tipo: tipo, p_archivo: ruta })
      if (error || typeof data !== 'string') {
        setErrorFormulario(mensajeDeErrorImportacion(error))
        return
      }
      setEjecucionId(data)
    } finally {
      enCurso.current = false
      setEnviando(false)
    }
  }

  const rechazos = ejecucion?.detalle?.rechazos ?? []
  const totalRechazos = ejecucion?.detalle?.total_rechazos ?? rechazos.length

  return (
    <Box>
      <EncabezadoPagina
        titulo="Importar historial"
        descripcion="Cargá una sola vez las planillas del panel anterior. El historial queda solo para consulta."
        accion={<Button component={RouterLink} to="/ejecuciones" variant="outlined">Ver ejecuciones</Button>}
        contexto={<ContextoOrganizacionActiva />}
      />
      <ContenedorSeccion>
        <Stack spacing={2} component="form" onSubmit={(e) => void importar(e)} noValidate>
          <TextField select label="Tipo de planilla" value={tipo} onChange={(e) => setTipo(e.target.value as TipoHistorial)} disabled={enviando} fullWidth>
            {TIPOS_HISTORIAL.map((t) => <MenuItem key={t.valor} value={t.valor}>{t.etiqueta}</MenuItem>)}
          </TextField>
          <Box>
            <Button component="label" variant="outlined" disabled={enviando}>
              {archivo ? 'Cambiar planilla' : 'Elegir planilla'}
              <input type="file" hidden accept=".csv,.xlsx" aria-label="Planilla a importar (.csv o .xlsx)" onChange={elegirArchivo} />
            </Button>
            <Typography variant="xs" color="text.secondary" sx={{ ml: 1.5 }}>{archivo ? archivo.name : 'Formatos .csv o .xlsx, hasta 50 MB'}</Typography>
          </Box>
          {errorFormulario ? <Alert severity="error">{errorFormulario}</Alert> : null}
          <Box>
            <Button type="submit" variant="contained" disabled={enviando}>{enviando ? 'Enviando…' : 'Importar'}</Button>
          </Box>
        </Stack>

        {ejecucionId ? (
          <Stack spacing={2} sx={{ mt: 3 }} aria-live="polite">
            {errorConsulta ? <EstadoError descripcion="No pudimos consultar el estado de la importación." reintentar={() => void consultar(ejecucionId)} /> : null}
            {!ejecucion || ejecucion.estado === 'en_curso' ? <Alert severity="info">Importación en curso. Podés salir de esta pantalla: el resultado queda en Ejecuciones.</Alert> : null}
            {ejecucion?.estado === 'exitosa' ? (
              <EstadoExito
                titulo="Importación terminada."
                descripcion={`${ejecucion.detalle?.nuevas ?? 0} registros nuevos y ${ejecucion.detalle?.existentes ?? 0} que ya estaban cargados.`}
              />
            ) : null}
            {ejecucion?.estado === 'fallida' || ejecucion?.estado === 'timeout' ? (
              <Alert severity="error">
                <Typography component="p" fontWeight={600}>
                  {ejecucion.estado === 'timeout' ? 'La importación tardó demasiado y se cortó.' : 'No se importó nada: la planilla tiene errores.'}
                </Typography>
                {totalRechazos > 0 ? <Typography variant="b">Corregí las filas indicadas y volvé a subirla.</Typography> : null}
              </Alert>
            ) : null}
            {rechazos.length > 0 ? (
              <Box sx={{ overflowX: 'auto' }}>
                <Table size="small" aria-label="Filas rechazadas">
                  <TableHead><TableRow><TableCell>Fila</TableCell><TableCell>Columna</TableCell><TableCell>Motivo</TableCell></TableRow></TableHead>
                  <TableBody>
                    {rechazos.slice(0, MAX_RECHAZOS_VISIBLES).map((r, i) => <TableRow key={`${r.fila}-${r.columna}-${i}`}><TableCell>{r.fila}</TableCell><TableCell>{r.columna}</TableCell><TableCell>{r.motivo}</TableCell></TableRow>)}
                  </TableBody>
                </Table>
                {totalRechazos > MAX_RECHAZOS_VISIBLES ? <Typography variant="xs" color="text.secondary">{`Mostrando ${MAX_RECHAZOS_VISIBLES} de ${totalRechazos} errores.`}</Typography> : null}
              </Box>
            ) : null}
            <Box><Button component={RouterLink} to={`/ejecuciones/${ejecucionId}`} size="small">Ver detalle de la ejecución</Button></Box>
          </Stack>
        ) : null}
      </ContenedorSeccion>
    </Box>
  )
}
