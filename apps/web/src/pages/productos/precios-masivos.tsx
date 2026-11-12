import { useMemo, useRef, useState } from 'react'
import { Link as RouterLink } from 'react-router'
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, MenuItem, Stack,
  TextField, ToggleButton, ToggleButtonGroup, Typography,
} from '@mui/material'
import { RequiereAccesoSeccion } from '../../components/RequiereAccesoSeccion'
import { EstadoCargaPagina, EstadoError, EstadoExito, EstadoVacio } from '../../components/estados/EstadosPagina'
import { ContenedorSeccion } from '../../components/pagina/ContenedorSeccion'
import { CargaInfinita } from '../../components/pagina/CargaInfinita'
import { ContenidoAdaptable, type ColumnaAdaptable } from '../../components/pagina/ContenidoAdaptable'
import { ContextoOrganizacionActiva } from '../../components/pagina/ContextoOrganizacionActiva'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { EtiquetaEstado } from '../../components/base/EtiquetaEstado'
import { useCategorias } from '../../hooks/useCategorias'
import { useNivelSeccion } from '../../hooks/useNivelSeccion'
import { useCapacidadesPrecios } from '../../hooks/useCapacidadesPrecios'
import { MOTIVO_PRECIOS_MASIVOS_APAGADOS, MOTIVO_PRECIOS_MASIVOS_SIN_TIENDAS } from '../../lib/capacidadesPrecios'
import { opcionesCategoriaProducto } from '../../lib/categorias'
import { ErrorCsv, descargarCsv, leerCsvUtf8 } from '../../lib/migracionCsv'
import {
  ErrorPlanilla, NOMBRE_PLANTILLA, aplicarActualizacion, leerPlanilla, leerPorcentaje, mensajeErrorActualizacion,
  plantillaCsv, previsualizarActualizacion, type ErrorFilaPlanilla, type FilaVistaPrevia, type ModoActualizacion,
  type ParametrosPlanilla, type ParametrosPorcentaje, type QueCambia, type VistaPrevia,
} from '../../lib/preciosMasivos'
import { supabaseClient } from '../../lib/supabase'

const FILAS_POR_PAGINA = 25

function dinero(valor: number | null | undefined): string {
  if (valor === null || valor === undefined) return '—'
  return valor.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function antesDespues(antes: number | null | undefined, despues: number | null | undefined, moneda: string | null): string {
  if (antes === null || antes === undefined) return '—'
  const sufijo = moneda ? ` ${moneda}` : ''
  return antes === despues ? `${dinero(antes)}${sufijo} (sin cambio)` : `${dinero(antes)} → ${dinero(despues)}${sufijo}`
}

// F-PRE-10 (FR-001): pantalla de la organización, no de una empresa. La sección `productos` en
// edición abre la pantalla; el costo aparece solo con Rentabilidad. La base vuelve a validar todo.
export function PreciosMasivos() {
  return (
    <RequiereAccesoSeccion seccion="productos" nivelMinimo="edicion">
      <PuertaPreciosMasivos />
    </RequiereAccesoSeccion>
  )
}

// MSF-363: con la bandera `precios_masivos` apagada (por defecto) la pantalla no ofrece nada y explica el motivo; sin
// edición de productos en todas las tiendas tampoco. Las RPC rechazan lo mismo (55000 / 42501).
function PuertaPreciosMasivos() {
  const { capacidades, cargando, hayError } = useCapacidadesPrecios()
  if (cargando) return <EstadoCargaPagina />
  const motivo = hayError
    ? 'No pudimos verificar si la actualización de precios está activa. Recargá la página.'
    : !capacidades.preciosMasivos
      ? MOTIVO_PRECIOS_MASIVOS_APAGADOS
      : !capacidades.edicionEnTodasLasTiendas
        ? MOTIVO_PRECIOS_MASIVOS_SIN_TIENDAS
        : null
  if (motivo) {
    return (
      <Box>
        <EncabezadoPagina
          titulo="Actualizar precios"
          accion={<Button component={RouterLink} to="/productos" variant="outlined">Volver a Productos</Button>}
          contexto={<ContextoOrganizacionActiva />}
        />
        <ContenedorSeccion><Alert severity={hayError ? 'warning' : 'info'}>{motivo}</Alert></ContenedorSeccion>
      </Box>
    )
  }
  return <PantallaPreciosMasivos />
}

function PantallaPreciosMasivos() {
  const { nivel: nivelRentabilidad } = useNivelSeccion('rentabilidad')
  const veCosto = nivelRentabilidad === 'lectura' || nivelRentabilidad === 'edicion'
  const puedeCambiarCosto = nivelRentabilidad === 'edicion'
  const { categorias, isLoading: cargandoCategorias, isError: errorCategorias, refetch: recargarCategorias } = useCategorias()
  const opcionesAlcance = useMemo(() => opcionesCategoriaProducto(categorias), [categorias])

  const [modo, setModo] = useState<ModoActualizacion>('porcentaje')
  const [cambia, setCambia] = useState<QueCambia>('precio_lista')
  const [alcance, setAlcance] = useState('todos')
  const [textoPorcentaje, setTextoPorcentaje] = useState('')
  const [nombreArchivo, setNombreArchivo] = useState<string | null>(null)
  const [planilla, setPlanilla] = useState<ParametrosPlanilla | null>(null)
  const [erroresPlanilla, setErroresPlanilla] = useState<ErrorFilaPlanilla[]>([])
  const [errorArchivo, setErrorArchivo] = useState<string | null>(null)

  const [vista, setVista] = useState<VistaPrevia | null>(null)
  const [parametrosVista, setParametrosVista] = useState<ParametrosPorcentaje | ParametrosPlanilla | null>(null)
  const [generando, setGenerando] = useState(false)
  const [errorVista, setErrorVista] = useState<string | null>(null)
  // Carga infinita (Principio VI): cuántas filas de la vista previa se muestran; sube de a una tanda.
  const [visibles, setVisibles] = useState(FILAS_POR_PAGINA)

  const [confirmando, setConfirmando] = useState(false)
  const [aplicando, setAplicando] = useState(false)
  const [errorAplicar, setErrorAplicar] = useState<string | null>(null)
  const [aplicados, setAplicados] = useState<number | null>(null)
  // Una clave por intento: un doble clic o un reintento tras un corte de red no aplica dos veces.
  const clave = useRef<string>(crypto.randomUUID())

  const porcentaje = leerPorcentaje(textoPorcentaje)
  const parametrosActuales: ParametrosPorcentaje | ParametrosPlanilla | null =
    modo === 'porcentaje'
      ? porcentaje === null ? null : { cambia, alcance, porcentaje }
      : planilla && planilla.filas.length > 0 && erroresPlanilla.length === 0 ? planilla : null

  const descartarVista = () => {
    setVista(null)
    setParametrosVista(null)
    setErrorVista(null)
    setErrorAplicar(null)
    setVisibles(FILAS_POR_PAGINA)
  }

  const elegirModo = (nuevo: ModoActualizacion | null) => {
    if (nuevo === null || nuevo === modo) return
    setModo(nuevo)
    descartarVista()
  }

  const elegirArchivo = async (archivo: File | null) => {
    descartarVista()
    setPlanilla(null)
    setErroresPlanilla([])
    setErrorArchivo(null)
    if (archivo === null) {
      setNombreArchivo(null)
      return
    }
    setNombreArchivo(archivo.name)
    try {
      const resultado = leerPlanilla(await leerCsvUtf8(archivo), puedeCambiarCosto)
      setPlanilla({ filas: resultado.filas })
      setErroresPlanilla(resultado.errores)
    } catch (excepcion) {
      setErrorArchivo(excepcion instanceof ErrorCsv || excepcion instanceof ErrorPlanilla ? excepcion.message : 'No pudimos leer el archivo. Elegilo de nuevo.')
    }
  }

  const generarVista = async () => {
    if (parametrosActuales === null) return
    setGenerando(true)
    descartarVista()
    setAplicados(null)
    try {
      const resultado = await previsualizarActualizacion(supabaseClient, modo, parametrosActuales)
      setVista(resultado)
      setParametrosVista(parametrosActuales)
      clave.current = crypto.randomUUID()
    } catch (excepcion) {
      setErrorVista(mensajeErrorActualizacion(excepcion as { code?: string; message?: string }))
    } finally {
      setGenerando(false)
    }
  }

  const confirmar = async () => {
    if (vista === null || parametrosVista === null) return
    setAplicando(true)
    setErrorAplicar(null)
    try {
      const resultado = await aplicarActualizacion(supabaseClient, modo, parametrosVista, vista, clave.current)
      setAplicados(resultado.aplicados)
      setConfirmando(false)
      descartarVista()
    } catch (excepcion) {
      setErrorAplicar(mensajeErrorActualizacion(excepcion as { code?: string; message?: string }))
      setConfirmando(false)
    } finally {
      setAplicando(false)
    }
  }

  // Primero las filas con error, después las que cambian y al final las que no cambian.
  const filasOrdenadas = useMemo(() => {
    if (vista === null) return []
    const peso = (fila: FilaVistaPrevia) => (fila.error ? 0 : fila.cambia ? 1 : 2)
    return [...vista.filas].sort((a, b) => peso(a) - peso(b))
  }, [vista])
  const filasMostradas = filasOrdenadas.slice(0, visibles)

  const columnas: ColumnaAdaptable<FilaVistaPrevia>[] = [
    ...(modo === 'planilla' ? [{ clave: 'fila', encabezado: 'Fila', render: (f: FilaVistaPrevia) => f.fila ?? '—' }] : []),
    { clave: 'sku', encabezado: 'SKU', render: (f) => f.sku ?? '—' },
    { clave: 'nombre', encabezado: 'Producto', render: (f) => f.nombre ?? '—' },
    { clave: 'lista', encabezado: 'Precio de lista', align: 'right', render: (f) => antesDespues(f.lista_antes, f.lista_despues, f.moneda) },
    ...(veCosto ? [{ clave: 'costo', encabezado: 'Costo', align: 'right' as const, render: (f: FilaVistaPrevia) => antesDespues(f.costo_antes, f.costo_despues, f.moneda) }] : []),
    {
      clave: 'estado',
      encabezado: 'Resultado',
      render: (f) => f.error
        ? <EtiquetaEstado texto={f.error} variante="error" />
        : <EtiquetaEstado texto={f.cambia ? 'Se actualiza' : 'Sin cambio'} variante={f.cambia ? 'exito' : 'neutral'} />,
    },
  ]

  const puedeConfirmar = vista !== null && vista.con_error === 0 && vista.afectados > 0 && !aplicando

  return (
    <Box>
      <EncabezadoPagina
        titulo="Actualizar precios"
        descripcion="Subí o bajá costos y precios de lista en bloque. Primero ves cómo quedan; recién al confirmar se aplican. Los importes van sin IVA."
        accion={<Button component={RouterLink} to="/productos" variant="outlined">Volver a Productos</Button>}
        contexto={<ContextoOrganizacionActiva />}
      />
      <ContenedorSeccion>
        <Stack spacing={3}>
          {aplicados !== null ? (
            <EstadoExito
              titulo={aplicados === 1 ? 'Listo: se actualizó 1 producto.' : `Listo: se actualizaron ${aplicados} productos.`}
              descripcion="Todas las empresas ya muestran los precios nuevos."
            />
          ) : null}

          <Box>
            <Typography id="etiqueta-modo-precios" variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>¿Cómo definís el cambio?</Typography>
            <ToggleButtonGroup exclusive size="small" aria-labelledby="etiqueta-modo-precios" value={modo} onChange={(_, valor: ModoActualizacion | null) => elegirModo(valor)}>
              <ToggleButton value="porcentaje">Por porcentaje</ToggleButton>
              <ToggleButton value="planilla">Por planilla</ToggleButton>
            </ToggleButtonGroup>
          </Box>

          {modo === 'porcentaje' ? (
            <Stack spacing={2} sx={{ maxWidth: 480 }}>
              {errorCategorias ? (
                <EstadoError descripcion="No pudimos cargar las categorías." reintentar={() => void recargarCategorias()} />
              ) : null}
              <TextField
                select
                size="small"
                label="Qué cambia"
                value={cambia}
                onChange={(evento) => { setCambia(evento.target.value as QueCambia); descartarVista() }}
              >
                <MenuItem value="precio_lista">Precio de lista</MenuItem>
                {puedeCambiarCosto ? <MenuItem value="costo">Costo</MenuItem> : null}
                {puedeCambiarCosto ? <MenuItem value="ambos">Costo y precio de lista</MenuItem> : null}
              </TextField>
              <TextField
                select
                size="small"
                label="Alcance"
                value={alcance}
                disabled={cargandoCategorias}
                onChange={(evento) => { setAlcance(evento.target.value); descartarVista() }}
                helperText="Solo productos activos. Una categoría incluye sus subcategorías."
              >
                <MenuItem value="todos">Todos los productos activos</MenuItem>
                {opcionesAlcance.map((opcion) => (
                  <MenuItem key={opcion.id} value={opcion.id}>{opcion.ruta}</MenuItem>
                ))}
              </TextField>
              <TextField
                size="small"
                label="Porcentaje"
                value={textoPorcentaje}
                onChange={(evento) => { setTextoPorcentaje(evento.target.value); descartarVista() }}
                error={textoPorcentaje.trim() !== '' && porcentaje === null}
                helperText={textoPorcentaje.trim() !== '' && porcentaje === null
                  ? 'Ingresá un número mayor a −100. Ejemplo: 10 sube un 10 %, -5 baja un 5 %.'
                  : 'Positivo sube, negativo baja. Ejemplo: 10 o -5,5.'}
                slotProps={{ htmlInput: { inputMode: 'decimal' } }}
              />
            </Stack>
          ) : (
            <Stack spacing={2}>
              <Typography variant="body2" color="text.secondary">
                Subí un CSV con las columnas SKU (obligatoria), costo y precio_lista (al menos una de las dos), sin IVA.
                {puedeCambiarCosto ? '' : ' Tu rol puede cargar solo precios de lista.'}
              </Typography>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'center' }}>
                <Button variant="outlined" onClick={() => descargarCsv(NOMBRE_PLANTILLA, plantillaCsv())}>Descargar plantilla CSV</Button>
                <Button variant="outlined" component="label">
                  Elegir archivo CSV
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    hidden
                    aria-label="Archivo CSV de precios"
                    onChange={(evento) => { void elegirArchivo(evento.target.files?.[0] ?? null); evento.target.value = '' }}
                  />
                </Button>
                {nombreArchivo ? <Typography variant="body2">{nombreArchivo}</Typography> : null}
              </Stack>
              {errorArchivo ? <Alert severity="error">{errorArchivo}</Alert> : null}
              {erroresPlanilla.length > 0 ? (
                <Alert severity="error">
                  <Typography fontWeight={600}>Corregí estas filas y volvé a subir el archivo:</Typography>
                  <Box component="ul" sx={{ m: 0, pl: 3 }}>
                    {erroresPlanilla.slice(0, 20).map((error) => <li key={error.fila}>Fila {error.fila}: {error.motivo}</li>)}
                    {erroresPlanilla.length > 20 ? <li>… y {erroresPlanilla.length - 20} filas más.</li> : null}
                  </Box>
                </Alert>
              ) : null}
            </Stack>
          )}

          <Box>
            <Button variant="contained" disabled={parametrosActuales === null || generando} onClick={() => void generarVista()}>
              Ver vista previa
            </Button>
          </Box>

          {errorVista ? <EstadoError titulo="No pudimos generar la vista previa." descripcion={errorVista} reintentar={() => void generarVista()} /> : null}
          {errorAplicar ? <Alert severity="error" role="alert">{errorAplicar}</Alert> : null}
          {generando ? <EstadoCargaPagina /> : null}

          {vista !== null && !generando ? (
            <Stack spacing={2} aria-live="polite">
              <Typography variant="h6" component="h2">Vista previa</Typography>
              <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
                <EtiquetaEstado texto={`${vista.afectados} se actualizan`} variante="exito" />
                <EtiquetaEstado texto={`${vista.sin_cambio} sin cambio`} variante="neutral" />
                <EtiquetaEstado texto={`${vista.con_error} con error`} variante={vista.con_error > 0 ? 'error' : 'neutral'} />
              </Stack>
              {vista.filas.length === 0 ? (
                <EstadoVacio titulo="No hay productos para actualizar con este alcance." />
              ) : (
                <>
                  <ContenidoAdaptable
                    items={filasMostradas}
                    columnas={columnas}
                    obtenerClave={(fila, indice) => fila.producto_id ?? `fila-${fila.fila ?? indice}-${indice}`}
                    etiquetaTabla="Vista previa de la actualización de precios"
                  />
                  <Typography variant="body2" color="text.secondary" role="status">
                    {`Mostrando ${filasMostradas.length} de ${filasOrdenadas.length}`}
                  </Typography>
                  <CargaInfinita
                    hayMas={visibles < filasOrdenadas.length}
                    cargando={false}
                    onCargarMas={() => setVisibles((actual) => actual + FILAS_POR_PAGINA)}
                  />
                </>
              )}
              {vista.con_error > 0 ? (
                <Alert severity="warning">Hay filas con error: corregilas y generá la vista previa de nuevo. No se puede confirmar mientras tanto.</Alert>
              ) : null}
              <Box>
                <Button variant="contained" color="primary" disabled={!puedeConfirmar} onClick={() => setConfirmando(true)}>
                  Confirmar actualización
                </Button>
              </Box>
            </Stack>
          ) : null}
        </Stack>
      </ContenedorSeccion>

      <Dialog open={confirmando} onClose={() => { if (!aplicando) setConfirmando(false) }} aria-labelledby="titulo-confirmar-precios">
        <DialogTitle id="titulo-confirmar-precios">¿Aplicar la actualización?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Se van a actualizar {vista?.afectados ?? 0} {vista?.afectados === 1 ? 'producto' : 'productos'}.
            Se aplica todo junto: si algo falla, no se cambia nada.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmando(false)} disabled={aplicando}>Cancelar</Button>
          <Button variant="contained" onClick={() => void confirmar()} disabled={aplicando}>
            {aplicando ? 'Aplicando…' : 'Aplicar'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
