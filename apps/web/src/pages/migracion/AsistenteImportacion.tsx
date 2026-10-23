import { useMemo, useRef, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  LinearProgress,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import { ContextoOrganizacionActiva } from '../../components/pagina/ContextoOrganizacionActiva'
import { ContenedorSeccion } from '../../components/pagina/ContenedorSeccion'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { EstadoCargaPagina, EstadoError } from '../../components/estados/EstadosPagina'
import { useEmpresaActiva } from '../../hooks/useEmpresaActiva'
import { usePuedeEscribir } from '../../hooks/usePuedeEscribir'
import {
  TAMANO_LOTE_MIGRACION,
  aplicarLotes,
  camposObligatoriosFaltantes,
  camposRepetidos,
  cerrarCargaMigracion,
  construirFilas,
  contenidoPlantilla,
  contarEstados,
  erroresPorMotivo,
  iniciarCargaMigracion,
  mapeoAutomatico,
  marcarIdentificadoresRepetidos,
  mensajeDeErrorMigracion,
  previsualizarFilas,
  type DefinicionEntidad,
  type FilaMigracion,
  type InformeCarga,
  type ResultadoFila,
} from '../../lib/migracion'
import { ErrorCsv, descargarCsv, leerCsvUtf8, type CsvLeido } from '../../lib/migracionCsv'
import { supabaseClient } from '../../lib/supabase'

type Paso = 'subir' | 'mapear' | 'vista' | 'aplicando' | 'resultado'

const PASOS = ['Subir archivo', 'Mapear columnas', 'Vista previa', 'Aplicar'] as const

function indiceDePaso(paso: Paso): number {
  if (paso === 'subir') return 0
  if (paso === 'mapear') return 1
  if (paso === 'vista') return 2
  return 3
}

/**
 * Asistente genérico de importación (FR-001): subir CSV → mapear → vista
 * previa con errores por fila → aplicar por lotes. Recibe la definición de la
 * entidad para que F-MIG-02 y F-MIG-03 lo reutilicen sin copiarlo.
 *
 * La empresa activa no filtra el lote (FR-011): la carga es de toda la
 * organización y cambiar la empresa de la barra superior no la reencuadra ni
 * la mezcla. El permiso real lo aplican las RPC y RLS; acá solo se evita
 * ofrecer el asistente a quien no es Administrador (FR-009).
 */
export function AsistenteImportacion({ definicion }: { definicion: DefinicionEntidad }) {
  const { puedeEscribir, isLoading: cargandoPermiso } = usePuedeEscribir()
  const { empresas } = useEmpresaActiva()
  const entradaArchivo = useRef<HTMLInputElement>(null)
  const [paso, setPaso] = useState<Paso>('subir')
  const [csv, setCsv] = useState<CsvLeido | null>(null)
  const [nombreArchivo, setNombreArchivo] = useState('')
  const [mapeo, setMapeo] = useState<Record<number, string>>({})
  const [leyendo, setLeyendo] = useState(false)
  const [cargandoVista, setCargandoVista] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errorMapeo, setErrorMapeo] = useState<string | null>(null)
  const [errorAplicacion, setErrorAplicacion] = useState<string | null>(null)
  const [reintentable, setReintentable] = useState(false)
  const [filas, setFilas] = useState<FilaMigracion[]>([])
  const [previsualizacion, setPrevisualizacion] = useState<ResultadoFila[] | null>(null)
  const [cargaId, setCargaId] = useState<string | null>(null)
  const [informe, setInforme] = useState<InformeCarga | null>(null)
  const [avanceLotes, setAvanceLotes] = useState({ hechos: 0, total: 0 })

  const resumen = useMemo(() => (previsualizacion ? contarEstados(previsualizacion) : null), [previsualizacion])
  const erroresAgrupados = useMemo(
    () => (previsualizacion ? erroresPorMotivo(previsualizacion) : []),
    [previsualizacion],
  )
  const totalValidas = resumen ? resumen.nueva + resumen.actualizada : 0
  const totalLotes = Math.max(1, Math.ceil(filas.length / TAMANO_LOTE_MIGRACION))
  const porcentaje = avanceLotes.total > 0 ? Math.round((avanceLotes.hechos / avanceLotes.total) * 100) : 0
  const empresaActiva = empresas.find((empresa) => empresa.esActiva)?.nombre ?? 'Todas mis empresas'

  function limpiarEntrada() {
    if (entradaArchivo.current) entradaArchivo.current.value = ''
  }

  function reiniciar() {
    setPaso('subir')
    setCsv(null)
    setNombreArchivo('')
    setMapeo({})
    setError(null)
    setErrorMapeo(null)
    setErrorAplicacion(null)
    setReintentable(false)
    setFilas([])
    setPrevisualizacion(null)
    setCargaId(null)
    setInforme(null)
    setAvanceLotes({ hechos: 0, total: 0 })
    limpiarEntrada()
  }

  async function elegirArchivo(elegido: File | null) {
    if (!elegido) return
    setError(null)
    setErrorMapeo(null)
    setErrorAplicacion(null)
    setReintentable(false)
    setPrevisualizacion(null)
    setInforme(null)
    setCargaId(null)
    setLeyendo(true)
    try {
      const leido = await leerCsvUtf8(elegido)
      setCsv(leido)
      setNombreArchivo(elegido.name)
      setMapeo(mapeoAutomatico(definicion, leido.encabezados))
      setPaso('mapear')
    } catch (excepcion) {
      setCsv(null)
      setNombreArchivo(elegido.name)
      setMapeo({})
      setPaso('subir')
      setError(excepcion instanceof ErrorCsv ? excepcion.message : 'No pudimos leer el archivo. Elegilo de nuevo.')
    } finally {
      setLeyendo(false)
      limpiarEntrada()
    }
  }

  function cambiarMapeo(indice: number, clave: string) {
    setErrorMapeo(null)
    setMapeo((actual) => ({ ...actual, [indice]: clave }))
  }

  async function continuarAVistaPrevia() {
    if (!csv) return
    const faltantes = camposObligatoriosFaltantes(definicion, mapeo)
    if (faltantes.length > 0) {
      setErrorMapeo(`Mapeá las columnas obligatorias: ${faltantes.join(', ')}.`)
      return
    }
    const repetidos = camposRepetidos(mapeo)
    if (repetidos.length > 0) {
      const etiquetas = repetidos.map((clave) => definicion.campos.find((campo) => campo.clave === clave)?.etiqueta ?? clave)
      setErrorMapeo(`Cada campo puede tener una sola columna: ${etiquetas.join(', ')}.`)
      return
    }

    const filasConstruidas = construirFilas(csv, mapeo)
    setFilas(filasConstruidas)
    setCargandoVista(true)
    setError(null)
    try {
      const resultados = await previsualizarFilas(supabaseClient, definicion, filasConstruidas)
      setPrevisualizacion(marcarIdentificadoresRepetidos(filasConstruidas, resultados))
      setPaso('vista')
    } catch (excepcion) {
      setError(mensajeDeErrorMigracion(excepcion, 'No pudimos revisar las filas. Intentá de nuevo.'))
    } finally {
      setCargandoVista(false)
    }
  }

  async function importar() {
    if (filas.length === 0) return
    setPaso('aplicando')
    setErrorAplicacion(null)
    setReintentable(false)
    setAvanceLotes({ hechos: 0, total: totalLotes })
    let carga = cargaId
    try {
      if (!carga) {
        carga = await iniciarCargaMigracion(supabaseClient, definicion.id, nombreArchivo, filas.length)
        setCargaId(carga)
      }
      await aplicarLotes(supabaseClient, definicion, carga, filas, (hechos, total) => {
        setAvanceLotes({ hechos, total })
      })
      const cierre = await cerrarCargaMigracion(supabaseClient, carga)
      setInforme(cierre)
      if (cierre.estado === 'aplicada') {
        setErrorAplicacion(null)
        setPaso('resultado')
      } else {
        setErrorAplicacion(cierre.error ?? 'La carga quedó incompleta. Reintentá para completar lo pendiente.')
        setReintentable(true)
      }
    } catch (excepcion) {
      setErrorAplicacion(mensajeDeErrorMigracion(
        excepcion,
        'No pudimos aplicar la importación. Revisá la conexión y reintentá; lo ya cargado no se duplica.',
      ))
      setReintentable(true)
    }
  }

  if (cargandoPermiso) return <EstadoCargaPagina />
  if (!puedeEscribir) {
    return (
      <Box>
        <EncabezadoPagina titulo="Migración de datos" contexto={<ContextoOrganizacionActiva />} />
        <ContenedorSeccion>
          <EstadoError
            titulo="Sin permiso"
            descripcion="Solo un administrador de la organización puede importar datos desde el panel actual."
          />
        </ContenedorSeccion>
      </Box>
    )
  }

  const pasoIndice = indiceDePaso(paso)
  const mensajeResultado = informe
    ? `Importación lista: ${informe.nuevos} ${informe.nuevos === 1 ? `${definicion.sustantivo} nuevo` : `${definicion.sustantivoPlural} nuevos`}, ` +
      `${informe.actualizados} ${informe.actualizados === 1 ? 'actualizado' : 'actualizados'}, ${informe.con_error} con error`
    : ''

  return (
    <Box>
      <EncabezadoPagina
        titulo="Migración de datos"
        descripcion={definicion.descripcion}
        contexto={<ContextoOrganizacionActiva />}
        accion={paso !== 'subir' ? <Button onClick={reiniciar} variant="outlined" disabled={paso === 'aplicando'}>Cancelar</Button> : undefined}
      />
      <ContenedorSeccion>
        <Stack spacing={3}>
          <Box component="ol" aria-label="Pasos de la importación" sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, listStyle: 'none', m: 0, p: 0 }}>
            {PASOS.map((etiqueta, indice) => (
              <Box
                component="li"
                key={etiqueta}
                aria-current={indice === pasoIndice ? 'step' : undefined}
                sx={{ color: indice <= pasoIndice ? 'text.primary' : 'text.disabled', fontWeight: indice === pasoIndice ? 600 : 400 }}
              >
                {indice + 1}. {etiqueta}
              </Box>
            ))}
          </Box>

          <Typography variant="body2" color="text.secondary">
            Empresa activa: {empresaActiva}. No aplica filtrado por empresa: la importación es de toda la organización
            y los registros nuevos quedan disponibles en toda la organización. Cambiar la empresa de la barra superior
            no cambia el destino de esta carga.
          </Typography>

          {leyendo ? (
            <Alert severity="info" role="status" icon={<CircularProgress size={18} />}>Leyendo el archivo…</Alert>
          ) : null}
          {error ? <Alert severity="error" role="alert">{error}</Alert> : null}

          {paso === 'subir' ? (
            <Stack spacing={2}>
              <Typography component="h2" variant="t3">Subir archivo</Typography>
              <Typography variant="body2" color="text.secondary">
                Formato CSV UTF-8. Si la planilla está en Excel, guardala como «CSV UTF-8» antes de subirla.
              </Typography>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                <Button variant="contained" onClick={() => entradaArchivo.current?.click()} disabled={leyendo} aria-describedby="ayuda-archivo">
                  Elegir archivo CSV
                </Button>
                <Button
                  variant="outlined"
                  onClick={() => descargarCsv(definicion.archivoPlantilla, contenidoPlantilla(definicion))}
                >
                  Descargar plantilla CSV
                </Button>
                <input
                  ref={entradaArchivo}
                  type="file"
                  accept=".csv,text/csv"
                  hidden
                  aria-label={`Archivo CSV de ${definicion.sustantivoPlural}`}
                  aria-describedby="ayuda-archivo"
                  onChange={(evento) => void elegirArchivo(evento.target.files?.[0] ?? null)}
                />
              </Stack>
              <Typography id="ayuda-archivo" variant="body2" color="text.secondary">
                La primera fila son los encabezados. El identificador del panel actual es obligatorio para no duplicar.
              </Typography>
              {nombreArchivo && !csv ? (
                <Typography variant="body2" color="text.secondary">Archivo elegido: {nombreArchivo}</Typography>
              ) : null}
            </Stack>
          ) : null}

          {paso === 'mapear' && csv ? (
            <Stack spacing={2}>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }} justifyContent="space-between">
                <Typography component="h2" variant="t3">Mapear columnas</Typography>
                <Chip size="small" label={`${nombreArchivo} · ${csv.filas.length} ${csv.filas.length === 1 ? 'fila' : 'filas'} · UTF-8`} />
              </Stack>
              <Typography variant="body2" color="text.secondary">
                Asociá cada columna del archivo con un campo. Las columnas sin campo no se importan.
              </Typography>
              <Stack spacing={2}>
                {csv.encabezados.map((encabezado, indice) => (
                  <TextField
                    key={`${encabezado}-${indice}`}
                    select
                    fullWidth
                    label={`Columna «${encabezado}»`}
                    value={mapeo[indice] ?? ''}
                    onChange={(evento) => cambiarMapeo(indice, evento.target.value)}
                  >
                    <MenuItem value="">No importar</MenuItem>
                    {definicion.campos.map((campo) => {
                      const usadoEnOtraColumna = Object.entries(mapeo).some(
                        ([otraColumna, clave]) => Number(otraColumna) !== indice && clave === campo.clave,
                      )
                      return (
                        <MenuItem key={campo.clave} value={campo.clave} disabled={usadoEnOtraColumna}>
                          {campo.etiqueta}{campo.obligatorio ? ' *' : ''}
                        </MenuItem>
                      )
                    })}
                  </TextField>
                ))}
              </Stack>
              <Typography variant="body2" color="text.secondary">* Campo obligatorio.</Typography>
              {errorMapeo ? <Alert severity="error" role="alert">{errorMapeo}</Alert> : null}
              {cargandoVista ? (
                <Alert severity="info" role="status" icon={<CircularProgress size={18} />}>Revisando las filas…</Alert>
              ) : null}
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                <Button variant="contained" onClick={() => void continuarAVistaPrevia()} disabled={cargandoVista}>
                  Continuar a la vista previa
                </Button>
                <Button variant="text" onClick={reiniciar} disabled={cargandoVista}>Cambiar archivo</Button>
              </Stack>
            </Stack>
          ) : null}

          {paso === 'vista' && resumen ? (
            <Stack spacing={2}>
              <Typography component="h2" variant="t3">Vista previa</Typography>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                <Chip color="success" label={`${resumen.nueva} ${resumen.nueva === 1 ? 'nuevo' : 'nuevos'}`} />
                <Chip color="info" label={`${resumen.actualizada} a actualizar`} />
                <Chip color={resumen.error > 0 ? 'warning' : 'default'} label={`${resumen.error} con error`} />
              </Stack>
              {resumen.error > 0 ? (
                <Alert severity="warning">
                  <Typography component="p" fontWeight={600}>
                    {resumen.error} {resumen.error === 1 ? 'fila con error' : 'filas con error'}. No se importan.
                  </Typography>
                  <Box component="ul" sx={{ m: 0, pl: 2 }}>
                    {erroresAgrupados.map((grupo) => (
                      <li key={grupo.motivo}>
                        {grupo.motivo} (filas {grupo.filas.join(', ')}).
                      </li>
                    ))}
                  </Box>
                </Alert>
              ) : null}
              {resumen.error > 0 ? (
                <Box sx={{ overflowX: 'auto' }}>
                  <Table size="small" aria-label="Filas con error">
                    <TableHead>
                      <TableRow>
                        <TableCell>Fila</TableCell>
                        <TableCell>Motivo</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {previsualizacion?.filter((resultado) => resultado.estado === 'error').map((resultado) => (
                        <TableRow key={resultado.fila}>
                          <TableCell>{resultado.fila}</TableCell>
                          <TableCell>{resultado.motivo ?? 'La fila no pasó la validación.'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Box>
              ) : null}
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                <Button variant="contained" onClick={() => void importar()} disabled={totalValidas === 0}>
                  Importar {totalValidas} {totalValidas === 1 ? definicion.sustantivo : definicion.sustantivoPlural}
                </Button>
                <Button variant="outlined" onClick={() => setPaso('mapear')}>Volver a mapear</Button>
                <Button variant="text" onClick={reiniciar}>Cancelar</Button>
              </Stack>
            </Stack>
          ) : null}

          {paso === 'aplicando' ? (
            <Stack spacing={2}>
              <Typography component="h2" variant="t3">Aplicando</Typography>
              <Alert severity="info" role="status" icon={<CircularProgress size={18} />}>
                Aplicando lote {Math.min(avanceLotes.hechos + 1, avanceLotes.total || totalLotes)} de {avanceLotes.total || totalLotes}…
              </Alert>
              <LinearProgress variant="determinate" value={porcentaje} aria-label="Progreso de la importación" />
              {errorAplicacion ? (
                <Alert severity="error" role="alert">
                  <Typography component="p" fontWeight={600}>No pudimos aplicar la importación.</Typography>
                  <Box component="span">{errorAplicacion}</Box>
                </Alert>
              ) : null}
              {errorAplicacion && reintentable ? (
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                  <Button variant="contained" onClick={() => void importar()}>Reintentar</Button>
                  <Button variant="text" onClick={reiniciar}>Cancelar</Button>
                </Stack>
              ) : null}
            </Stack>
          ) : null}

          {paso === 'resultado' && informe ? (
            <Stack spacing={2}>
              <Typography component="h2" variant="t3">Resultado</Typography>
              <Alert severity="success" role="status">
                <Typography component="p" fontWeight={600}>{mensajeResultado}</Typography>
                <Box component="span">
                  Se leyeron {informe.filas_total} {informe.filas_total === 1 ? 'fila' : 'filas'} de {informe.archivo}.
                </Box>
              </Alert>
              {informe.errores.length > 0 ? (
                <Box sx={{ overflowX: 'auto' }}>
                  <Table size="small" aria-label="Filas con error al aplicar">
                    <TableHead>
                      <TableRow>
                        <TableCell>Fila</TableCell>
                        <TableCell>Motivo</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {informe.errores.map((fila) => (
                        <TableRow key={fila.fila}>
                          <TableCell>{fila.fila}</TableCell>
                          <TableCell>{fila.motivo}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Box>
              ) : null}
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                <Button variant="contained" onClick={reiniciar}>Importar otro archivo</Button>
              </Stack>
            </Stack>
          ) : null}
        </Stack>
      </ContenedorSeccion>
    </Box>
  )
}
