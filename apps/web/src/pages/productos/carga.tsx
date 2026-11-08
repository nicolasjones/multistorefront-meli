import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { Alert, Box, Button, Chip, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material'
import { useEsAdministrador } from '../../hooks/useEsAdministrador'
import { useContextoPanel } from '../../hooks/useContextoPanel'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { ContenedorSeccion } from '../../components/pagina/ContenedorSeccion'
import { EstadoCargaPagina } from '../../components/estados/EstadosPagina'
import {
  AVISO_IMPORTACION_REUTILIZADA,
  AYUDA_COLUMNAS,
  DESCRIPCION_COLUMNAS,
  ROTULO_ESTADO,
  TEXTO_FILAS_CON_ERROR,
  contarImportables,
  contarPorEstado,
  descargarPlantilla,
  descargarReporteErrores,
  descartarImagenes,
  importacionDeUrl,
  importacionHabilitada,
  leerImagenes,
  leerPlanillaProductos,
  mensajeDeErrorImportacion,
  mensajeFinal,
  mensajeSinImagenes,
  obtenerImportacion,
  PARAMETRO_IMPORTACION,
  resumenCsv,
  solicitarImportacion,
  subirImagenes,
  validarImportacion,
  type FilaValidada,
  type ImagenCarga,
  type ImportacionObtenida,
  type PlanillaProductos,
} from '../../lib/importacion-productos'

const ESPERA_SONDEO_MS = 3000
const TONO_ESTADO = { ok: 'success', aviso: 'warning', error: 'error' } as const
const ROTULO_VALIDACION = { ok: 'OK', aviso: 'Aviso', error: 'Error' } as const

// «Productos · Carga masiva (CSV)» (F-CAT-10, FR-101…FR-113). Pantalla de la organización: no depende de
// la empresa activa (FR-113), las tiendas salen de la columna `tiendas` del archivo. La autoridad de
// permisos es la base; acá solo se oculta lo que el rol no puede usar.
export function ProductoCarga() {
  const { esAdministrador, isLoading } = useEsAdministrador()
  const { contexto } = useContextoPanel()
  const organizacionId = contexto?.organizacion_id ?? null

  const [clave, setClave] = useState(() => crypto.randomUUID())
  const [nombreCsv, setNombreCsv] = useState<string | null>(null)
  const [planilla, setPlanilla] = useState<PlanillaProductos | null>(null)
  const [imagenes, setImagenes] = useState<ImagenCarga[]>([])
  const [rechazadas, setRechazadas] = useState<string[]>([])
  const [validadas, setValidadas] = useState<FilaValidada[] | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // La importación en seguimiento vive en la URL (`?importacion=<id>`): sobrevive a salir de la pantalla y a recargar, y
  // el sondeo la rehidrata con `obtener_importacion_productos` («al volver se ve su estado»).
  const [parametros, setParametros] = useSearchParams()
  const importacionId = importacionDeUrl(parametros.get(PARAMETRO_IMPORTACION))
  const fijarImportacion = useCallback((id: string | null) => {
    setParametros((actuales) => {
      const siguientes = new URLSearchParams(actuales)
      if (id) siguientes.set(PARAMETRO_IMPORTACION, id)
      else siguientes.delete(PARAMETRO_IMPORTACION)
      return siguientes
    }, { replace: true })
  }, [setParametros])
  const [habilitada, setHabilitada] = useState<boolean | null>(null)
  const [reutilizada, setReutilizada] = useState(false)
  const [seguimiento, setSeguimiento] = useState<ImportacionObtenida | null>(null)
  const entradaCsv = useRef<HTMLInputElement>(null)
  const entradaImagenes = useRef<HTMLInputElement>(null)

  const validar = useCallback(async (filas: PlanillaProductos, claveActual: string) => {
    try {
      setValidadas(await validarImportacion(filas.filas, claveActual))
    } catch (fallo) {
      setValidadas(null)
      setError(mensajeDeErrorImportacion(fallo, 'No pudimos validar el archivo. Probá de nuevo.'))
    }
  }, [])

  // ¿La organización tiene la conexión del importador? Se avisa ANTES de pedir el CSV (si la consulta falla no se bloquea:
  // al importar, el servidor igual rechaza con SIN_CONEXION_IMPORTACION).
  useEffect(() => {
    if (!esAdministrador) return
    let vigente = true
    importacionHabilitada()
      .then((valor) => { if (vigente) setHabilitada(valor) })
      .catch((fallo) => console.error('No pudimos comprobar si la importación está habilitada.', fallo))
    return () => { vigente = false }
  }, [esAdministrador])

  // Sondeo del estado de la importación hasta que termine o falle (FR-110, FR-111).
  useEffect(() => {
    if (!importacionId) return
    let activo = true
    let temporizador: ReturnType<typeof setTimeout> | undefined
    const consultar = async () => {
      try {
        const actual = await obtenerImportacion(importacionId)
        if (!activo) return
        setSeguimiento(actual)
        if (actual.estado === 'en_cola' || actual.estado === 'aplicando') temporizador = setTimeout(() => void consultar(), ESPERA_SONDEO_MS)
      } catch (fallo) {
        if (!activo) return
        // Una importación que no existe (id viejo o de otra organización en la URL) no se reintenta: se limpia la URL.
        if ((fallo as { code?: string } | null)?.code === 'P0002') {
          fijarImportacion(null)
          setError('No encontramos esa importación. Puede ser de otra organización o haber sido eliminada.')
          return
        }
        setError(mensajeDeErrorImportacion(fallo, 'No pudimos consultar el estado de la importación.'))
        temporizador = setTimeout(() => void consultar(), ESPERA_SONDEO_MS * 2)
      }
    }
    void consultar()
    return () => {
      activo = false
      if (temporizador) clearTimeout(temporizador)
    }
  }, [importacionId, fijarImportacion])

  if (isLoading) return <EstadoCargaPagina />
  if (!esAdministrador) {
    return (
      <Box>
        <EncabezadoPagina titulo="Carga masiva de productos" />
        <ContenedorSeccion><Alert severity="warning">No tenés permiso para importar productos.</Alert></ContenedorSeccion>
      </Box>
    )
  }

  const elegirCsv = async (archivo: File | undefined) => {
    if (!archivo) return
    setError(null)
    setOcupado(true)
    try {
      const leida = await leerPlanillaProductos(archivo)
      setNombreCsv(archivo.name)
      setPlanilla(leida)
      await validar(leida, clave)
    } catch (fallo) {
      setNombreCsv(null)
      setPlanilla(null)
      setValidadas(null)
      setError(fallo instanceof Error && fallo.name === 'ErrorImportacion' ? fallo.message : mensajeDeErrorImportacion(fallo, 'No pudimos leer el archivo.'))
    } finally {
      setOcupado(false)
    }
  }

  const elegirImagenes = async (archivos: FileList | null) => {
    if (!archivos || archivos.length === 0) return
    setError(null)
    setOcupado(true)
    try {
      const leidas = await leerImagenes([...archivos])
      // Nombres repetidos: gana la primera (regla única, ver leerImagenes). Lo ya cargado no se pisa.
      const yaCargadas = new Set(imagenes.map((imagen) => imagen.nombre))
      const nuevas = leidas.imagenes.filter((imagen) => !yaCargadas.has(imagen.nombre))
      const repetidas = leidas.imagenes
        .filter((imagen) => yaCargadas.has(imagen.nombre))
        .map((imagen) => `«${imagen.nombre}» ya estaba cargada: se mantiene la primera. Para reemplazarla, cancelá y volvé a cargarla.`)
      const fallidas = organizacionId ? await subirImagenes(organizacionId, clave, nuevas) : nuevas.map((i) => i.nombre)
      setImagenes([...imagenes, ...nuevas.filter((imagen) => !fallidas.includes(imagen.nombre))])
      setRechazadas([...leidas.rechazadas, ...repetidas, ...fallidas.map((nombre) => `No pudimos subir «${nombre}».`)])
      if (planilla) await validar(planilla, clave)
    } catch (fallo) {
      setError(mensajeDeErrorImportacion(fallo, 'No pudimos procesar las imágenes.'))
    } finally {
      setOcupado(false)
    }
  }

  const cancelar = () => {
    if (organizacionId) void descartarImagenes(organizacionId, clave, imagenes.map((imagen) => imagen.nombre))
    setClave(crypto.randomUUID())
    setNombreCsv(null)
    setPlanilla(null)
    setImagenes([])
    setRechazadas([])
    setValidadas(null)
    setError(null)
  }

  const importar = async () => {
    if (!planilla) return
    setError(null)
    setOcupado(true)
    try {
      const solicitud = await solicitarImportacion(planilla.filas, clave)
      setSeguimiento(null)
      setReutilizada(solicitud.reutilizada === true)
      fijarImportacion(solicitud.importacion_id)
    } catch (fallo) {
      setError(mensajeDeErrorImportacion(fallo, 'No pudimos solicitar la importación. Probá de nuevo.'))
    } finally {
      setOcupado(false)
    }
  }

  const nuevaImportacion = () => {
    fijarImportacion(null)
    setSeguimiento(null)
    setReutilizada(false)
    cancelar()
  }

  const importables = validadas ? contarImportables(validadas) : 0
  const porFila = new Map(planilla?.filas.map((fila) => [fila.fila, fila]))
  const enSeguimiento = importacionId !== null

  return (
    <Box>
      <EncabezadoPagina
        titulo="Carga masiva de productos"
        descripcion="Importá productos nuevos o actualizá existentes desde un archivo CSV, con sus imágenes."
        accion={<Button variant="outlined" onClick={descargarPlantilla}>Descargar plantilla CSV</Button>}
      />
      <ContenedorSeccion>
        <Stack spacing={2}>
          <Stack direction="row" spacing={1} aria-label="Pasos">
            <Chip size="small" color="primary" label="1 Archivos" />
            <Chip size="small" color={validadas || enSeguimiento ? 'primary' : 'default'} label="2 Validación" />
            <Chip size="small" color={enSeguimiento ? 'primary' : 'default'} label="3 Importación" />
          </Stack>
          {error ? <Alert severity="error">{error}</Alert> : null}
          {habilitada === false && !enSeguimiento ? (
            <Alert severity="warning">
              Tu organización todavía no tiene habilitada la importación de productos. Un Administrador tiene que crear la conexión «importar-productos» (servidor y credencial) antes de cargar un archivo.
            </Alert>
          ) : null}

          {enSeguimiento ? (
            <Paper variant="outlined" sx={{ p: 2.5 }}>
              <Stack spacing={1.5} role="status" aria-live="polite">
                <Typography variant="h3">Importación</Typography>
                <Box><Chip label={ROTULO_ESTADO[seguimiento?.estado ?? 'en_cola']} /></Box>
                {seguimiento && (seguimiento.estado === 'terminada' || seguimiento.estado === 'fallida') && (seguimiento.sin_imagenes ?? 0) > 0 ? (
                  <Alert severity="warning">{mensajeSinImagenes(seguimiento.sin_imagenes ?? 0)}</Alert>
                ) : null}
                {reutilizada ? <Alert severity="info">{AVISO_IMPORTACION_REUTILIZADA}</Alert> : null}
                {seguimiento?.estado === 'terminada' ? (
                  <Alert severity="success">{mensajeFinal(seguimiento.procesadas, seguimiento.omitidas, seguimiento.omitidas_temporales ?? 0)}</Alert>
                ) : seguimiento?.estado === 'fallida' ? (
                  <Alert severity="error">
                    {seguimiento.mensaje_fallo ?? 'La importación falló.'} Podés reintentarla desde la pantalla de ejecuciones.
                  </Alert>
                ) : (
                  <Typography variant="s" color="text.secondary">
                    {seguimiento?.estado === 'aplicando' ? 'Aplicando las filas…' : 'La importación quedó en cola; empieza cuando termine la anterior.'}
                  </Typography>
                )}
                <Stack direction="row" spacing={1}>
                  {seguimiento && seguimiento.errores.length > 0 ? (
                    <Button variant="outlined" onClick={() => descargarReporteErrores(seguimiento.errores)}>Descargar reporte de errores</Button>
                  ) : null}
                  {seguimiento && (seguimiento.estado === 'terminada' || seguimiento.estado === 'fallida') ? (
                    <Button variant="contained" onClick={nuevaImportacion}>Importar otro archivo</Button>
                  ) : null}
                </Stack>
              </Stack>
            </Paper>
          ) : (
            <>
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems="flex-start">
                <Paper variant="outlined" sx={{ p: 2.5, flex: 1, minWidth: 0 }}>
                  <Typography variant="h3">1 · Archivos</Typography>
                  <Stack spacing={1.5} sx={{ mt: 1.5 }}>
                    <Box sx={{ border: '1.5px dashed', borderColor: 'divider', borderRadius: (tema) => `${tema.shape.borderRadius}px`, p: 2.5, textAlign: 'center' }}>
                      <Typography sx={{ fontWeight: 600 }}>{nombreCsv ?? 'Archivo CSV de productos'}</Typography>
                      <Typography variant="s" color="text.secondary" component="p">
                        {planilla && nombreCsv ? resumenCsv(nombreCsv, planilla) : 'Ningún archivo elegido'}
                      </Typography>
                      <input ref={entradaCsv} type="file" accept=".csv,text/csv" hidden aria-label="Archivo CSV" data-testid="entrada-csv"
                        onChange={(e) => { void elegirCsv(e.target.files?.[0]); e.target.value = '' }} />
                      <Button size="small" variant="outlined" sx={{ mt: 1.25 }} disabled={ocupado || habilitada === false} onClick={() => entradaCsv.current?.click()}>
                        {planilla ? 'Cambiar archivo' : 'Elegir CSV'}
                      </Button>
                    </Box>
                    <Box sx={{ border: '1.5px dashed', borderColor: 'divider', borderRadius: (tema) => `${tema.shape.borderRadius}px`, p: 2.5, textAlign: 'center' }}>
                      <Typography sx={{ fontWeight: 600 }}>Imágenes (ZIP o archivos sueltos)</Typography>
                      <Typography variant="s" color="text.secondary" component="p">
                        {imagenes.length > 0 ? `${imagenes.length} ${imagenes.length === 1 ? 'imagen cargada' : 'imágenes cargadas'}` : 'Ninguna imagen elegida (opcional)'}
                      </Typography>
                      <input ref={entradaImagenes} type="file" multiple accept=".zip,.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" hidden
                        aria-label="Archivos de imágenes" data-testid="entrada-imagenes"
                        onChange={(e) => { void elegirImagenes(e.target.files); e.target.value = '' }} />
                      <Button size="small" variant="outlined" sx={{ mt: 1.25 }} disabled={ocupado || habilitada === false} onClick={() => entradaImagenes.current?.click()}>Elegir imágenes</Button>
                    </Box>
                    {rechazadas.length > 0 ? (
                      <Alert severity="warning">
                        <Box component="ul" sx={{ m: 0, pl: 2 }}>{rechazadas.map((motivo) => <li key={motivo}>{motivo}</li>)}</Box>
                      </Alert>
                    ) : null}
                    <Alert severity="info">{AYUDA_COLUMNAS}</Alert>
                  </Stack>
                </Paper>
                <Paper variant="outlined" sx={{ p: 2.5, flex: 1, minWidth: 0 }}>
                  <Typography variant="h3">Columnas de la plantilla</Typography>
                  <Table size="small" sx={{ mt: 1 }}>
                    <TableHead><TableRow><TableCell>Columna</TableCell><TableCell>Obligatoria</TableCell><TableCell>Ejemplo</TableCell></TableRow></TableHead>
                    <TableBody>
                      {DESCRIPCION_COLUMNAS.map((columna) => (
                        <TableRow key={columna.columna}>
                          <TableCell>{columna.columna}</TableCell>
                          <TableCell><Chip size="small" color={columna.obligatoria ? 'error' : 'default'} label={columna.obligatoria ? 'Sí' : 'No'} /></TableCell>
                          <TableCell>{columna.ejemplo}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Paper>
              </Stack>

              {validadas ? (
                <Paper variant="outlined">
                  <Stack direction="row" spacing={1.5} alignItems="center" sx={{ px: 2.5, py: 2 }} flexWrap="wrap" useFlexGap>
                    <Typography variant="h3" sx={{ flex: 1 }}>2 · Vista previa y validación</Typography>
                    <Chip size="small" color="success" label={`${contarPorEstado(validadas, 'ok')} correctas`} />
                    <Chip size="small" color="warning" label={`${contarPorEstado(validadas, 'aviso')} con aviso`} />
                    <Chip size="small" color="error" label={`${contarPorEstado(validadas, 'error')} con error`} />
                  </Stack>
                  <Box sx={{ overflowX: 'auto' }}>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Fila</TableCell><TableCell>SKU</TableCell><TableCell>Nombre</TableCell><TableCell>Categoría</TableCell>
                          <TableCell align="right">Precio x1</TableCell><TableCell>Imágenes</TableCell><TableCell>Acción</TableCell><TableCell>Validación</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {validadas.map((fila) => {
                          const origen = porFila.get(fila.fila)
                          const cantidadImagenes = origen?.imagenes ? origen.imagenes.split('|').filter(Boolean).length : 0
                          return (
                            <TableRow key={fila.fila}>
                              <TableCell>{fila.fila}</TableCell>
                              <TableCell>{fila.sku || '—'}</TableCell>
                              <TableCell>{origen?.nombre}</TableCell>
                              <TableCell>{origen?.categoria}</TableCell>
                              <TableCell align="right">{origen?.precio_x1 ? origen.precio_x1 : '—'}</TableCell>
                              <TableCell>{cantidadImagenes}</TableCell>
                              <TableCell><Chip size="small" color={fila.accion === 'nuevo' ? 'success' : 'default'} label={fila.accion === 'nuevo' ? 'Nuevo' : 'Actualiza'} /></TableCell>
                              <TableCell>
                                <Chip size="small" color={TONO_ESTADO[fila.estado]} label={fila.estado === 'ok' ? ROTULO_VALIDACION.ok : fila.mensaje || ROTULO_VALIDACION[fila.estado]} />
                              </TableCell>
                            </TableRow>
                          )
                        })}
                      </TableBody>
                    </Table>
                  </Box>
                  <Stack direction="row" spacing={1.5} alignItems="center" sx={{ px: 2.5, py: 1.75, borderTop: 1, borderColor: 'divider' }}>
                    <Typography variant="s" color="text.secondary" sx={{ flex: 1 }}>{TEXTO_FILAS_CON_ERROR}</Typography>
                    <Button onClick={cancelar} disabled={ocupado}>Cancelar</Button>
                    <Button variant="contained" onClick={() => void importar()} disabled={ocupado || importables === 0}>
                      Importar {importables} {importables === 1 ? 'producto' : 'productos'}
                    </Button>
                  </Stack>
                </Paper>
              ) : null}
            </>
          )}
        </Stack>
      </ContenedorSeccion>
    </Box>
  )
}
