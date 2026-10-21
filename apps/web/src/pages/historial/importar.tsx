import { type FormEvent, useEffect, useRef, useState } from 'react'
import { Link as RouterLink } from 'react-router'
import { Alert, Box, Button, CircularProgress, MenuItem, Stack, TextField, Typography } from '@mui/material'
import { usePuedeEscribir } from '../../hooks/usePuedeEscribir'
import { useOrganizacionDeTrabajo } from '../../hooks/useOrganizacionDeTrabajo'
import { supabaseClient } from '../../lib/supabase'
import {
  AYUDA_PLANILLA,
  TIPOS_HISTORIAL,
  type EjecucionHistorial,
  type TipoHistorial,
  consultarEjecucionHistorial,
  resumenDeEjecucion,
  solicitarImportacionHistorial,
  validarArchivoHistorial,
} from '../../lib/historial'
import { ContenedorSeccion } from '../../components/pagina/ContenedorSeccion'
import { ContextoOrganizacionActiva } from '../../components/pagina/ContextoOrganizacionActiva'
import { ContenidoAdaptable } from '../../components/pagina/ContenidoAdaptable'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { EstadoCargaPagina, EstadoError, EstadoExito } from '../../components/estados/EstadosPagina'

const INTERVALO_CONSULTA_MS = 3000

const formatoTamano = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 })

function tamanoLegible(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${formatoTamano.format(bytes / 1024)} KB`
  return `${formatoTamano.format(bytes / (1024 * 1024))} MB`
}

// Pantalla de importación del historial (MSF-293, F-VTA-37/FR-010): elegir
// tipo, subir la planilla, seguir la ejecución y ver el resultado. Solo se
// muestra a quien puede importar; la autorización real la hace la RPC y RLS.
// El historial no se edita desde acá: es una carga inicial de solo lectura.
export function HistorialImportar() {
  const { puedeEscribir, isLoading: cargandoPermiso } = usePuedeEscribir()
  const { organizacionId, isLoading: cargandoOrganizacion } = useOrganizacionDeTrabajo()
  const entradaArchivo = useRef<HTMLInputElement>(null)
  const [tipo, setTipo] = useState<TipoHistorial>('comprobantes')
  const [archivo, setArchivo] = useState<File | null>(null)
  const [errorArchivo, setErrorArchivo] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [ejecucionId, setEjecucionId] = useState<string | null>(null)
  const [ejecucion, setEjecucion] = useState<EjecucionHistorial | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!ejecucionId || !organizacionId) return
    let cancelada = false
    let temporizador: ReturnType<typeof setTimeout> | undefined

    const consultar = async () => {
      try {
        const datos = await consultarEjecucionHistorial(supabaseClient, organizacionId, ejecucionId)
        if (cancelada) return
        if (!datos) {
          setError('No encontramos la ejecución de esta importación en la organización activa.')
          return
        }
        setEjecucion(datos)
        if (datos.estado === 'en_curso') {
          temporizador = setTimeout(() => { void consultar() }, INTERVALO_CONSULTA_MS)
        }
      } catch (excepcion) {
        if (!cancelada) setError(excepcion instanceof Error ? excepcion.message : 'No pudimos consultar el estado de la importación.')
      }
    }

    void consultar()
    return () => {
      cancelada = true
      if (temporizador) clearTimeout(temporizador)
    }
  }, [ejecucionId, organizacionId])

  const tipoSeleccionado = TIPOS_HISTORIAL.find((opcion) => opcion.valor === tipo) ?? TIPOS_HISTORIAL[0]

  function limpiarEntrada() {
    if (entradaArchivo.current) entradaArchivo.current.value = ''
  }

  function reiniciar() {
    setArchivo(null)
    setErrorArchivo(null)
    setEjecucion(null)
    setEjecucionId(null)
    setError(null)
    setTipo('comprobantes')
    limpiarEntrada()
  }

  function elegirArchivo(elegido: File | null) {
    setArchivo(elegido)
    setError(null)
    setErrorArchivo(elegido ? validarArchivoHistorial(elegido) : null)
    setEjecucion(null)
    setEjecucionId(null)
  }

  function quitarArchivo() {
    setArchivo(null)
    setErrorArchivo(null)
    setEjecucion(null)
    setEjecucionId(null)
    setError(null)
    limpiarEntrada()
  }

  async function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    setError(null)
    const problema = archivo ? validarArchivoHistorial(archivo) : 'Elegí una planilla .csv o .xlsx para importar.'
    if (problema) {
      setErrorArchivo(problema)
      return
    }
    if (!archivo || !organizacionId) return

    setEnviando(true)
    setEjecucion(null)
    setEjecucionId(null)
    try {
      const { ejecucionId: id } = await solicitarImportacionHistorial(supabaseClient, {
        organizacionId,
        tipo,
        archivo,
      })
      setEjecucionId(id)
    } catch (excepcion) {
      setError(excepcion instanceof Error ? excepcion.message : 'No pudimos iniciar la importación.')
    } finally {
      setEnviando(false)
    }
  }

  if (cargandoPermiso || cargandoOrganizacion) return <EstadoCargaPagina />
  if (!puedeEscribir || !organizacionId) {
    return <Alert severity="error" sx={{ m: 2 }}>Solo un administrador con una organización activa puede importar el historial.</Alert>
  }

  const resumen = ejecucion ? resumenDeEjecucion(ejecucion) : null
  const enCurso = ejecucion?.estado === 'en_curso'

  return (
    <>
      <EncabezadoPagina
        titulo="Importar historial"
        descripcion="Cargá una sola vez las ventas, los cobros y las cotizaciones anteriores a la plataforma. No modifica el stock actual."
        contexto={<ContextoOrganizacionActiva />}
        accion={<Button component={RouterLink} to="/ejecuciones" variant="outlined">Ver ejecuciones</Button>}
      />
      <ContenedorSeccion>
        <Stack spacing={3}>
          <Box component="form" onSubmit={enviar} noValidate>
            <Stack spacing={2}>
              <TextField
                select
                label="Tipo de importación"
                value={tipo}
                onChange={(evento) => {
                  setTipo(evento.target.value as TipoHistorial)
                  setEjecucion(null)
                  setEjecucionId(null)
                  setError(null)
                }}
                helperText={tipoSeleccionado.detalle}
                disabled={enviando}
                fullWidth
              >
                {TIPOS_HISTORIAL.map((opcion) => (
                  <MenuItem key={opcion.valor} value={opcion.valor}>{opcion.etiqueta}</MenuItem>
                ))}
              </TextField>
              <Stack spacing={1}>
                <Typography component="span" variant="body2" fontWeight={600}>Planilla</Typography>
                <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                  <Button variant="outlined" component="label" disabled={enviando}>
                    Elegir planilla
                    <input
                      ref={entradaArchivo}
                      type="file"
                      accept=".csv,.xlsx"
                      hidden
                      aria-label="Planilla del historial"
                      aria-describedby="ayuda-planilla"
                      onChange={(evento) => elegirArchivo(evento.target.files?.[0] ?? null)}
                    />
                  </Button>
                  {archivo ? <Button variant="text" onClick={quitarArchivo} disabled={enviando}>Quitar</Button> : null}
                </Stack>
                <Typography id="ayuda-planilla" variant="body2" color="text.secondary">
                  {archivo ? `${archivo.name} · ${tamanoLegible(archivo.size)}` : AYUDA_PLANILLA}
                </Typography>
                {errorArchivo ? <Typography role="alert" variant="body2" color="error.main">{errorArchivo}</Typography> : null}
              </Stack>
              <Box>
                <Button type="submit" variant="contained" disabled={enviando || !archivo}>
                  {enviando ? 'Iniciando…' : 'Importar'}
                </Button>
              </Box>
            </Stack>
          </Box>

          {error ? <EstadoError titulo="No pudimos iniciar la importación." descripcion={error} /> : null}
          {enviando ? <Alert severity="info" role="status" icon={<CircularProgress size={18} />}>Subiendo la planilla…</Alert> : null}
          {!enviando && ejecucionId && !ejecucion && !error ? (
            <Alert severity="info" role="status" icon={<CircularProgress size={18} />}>Consultando el estado de la importación…</Alert>
          ) : null}

          {ejecucion && resumen ? (
            <Stack spacing={2}>
              {enCurso ? (
                <Alert severity="info" role="status" icon={<CircularProgress size={18} />}>
                  <Typography component="p" fontWeight={600}>{resumen.titulo}</Typography>
                  <Box component="span">{resumen.descripcion}</Box>
                </Alert>
              ) : resumen.severidad === 'success' ? (
                <EstadoExito titulo={resumen.titulo} descripcion={resumen.descripcion} />
              ) : (
                <EstadoError titulo={resumen.titulo} descripcion={resumen.descripcion} />
              )}
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                <Button component={RouterLink} to={`/ejecuciones/${ejecucion.id}`} variant="outlined">Ver en Ejecuciones</Button>
                {!enCurso ? <Button onClick={reiniciar}>Importar otra planilla</Button> : null}
              </Stack>
              {resumen.rechazos.length > 0 ? (
                <Stack spacing={1}>
                  <Typography component="h2" variant="t3">Filas rechazadas</Typography>
                  <ContenidoAdaptable
                    items={resumen.rechazos}
                    etiquetaTabla="Filas rechazadas"
                    obtenerClave={(rechazo) => `${rechazo.fila}-${rechazo.columna}-${rechazo.motivo}`}
                    columnas={[
                      { clave: 'fila', encabezado: 'Fila', render: (rechazo) => rechazo.fila },
                      { clave: 'columna', encabezado: 'Columna', render: (rechazo) => rechazo.columna },
                      { clave: 'motivo', encabezado: 'Motivo', render: (rechazo) => rechazo.motivo },
                    ]}
                  />
                  {resumen.rechazosTruncados ? (
                    <Typography variant="body2" color="text.secondary">
                      Se muestran los primeros {resumen.rechazos.length} de {resumen.totalRechazos} rechazos.
                    </Typography>
                  ) : null}
                </Stack>
              ) : null}
            </Stack>
          ) : null}
        </Stack>
      </ContenedorSeccion>
    </>
  )
}
