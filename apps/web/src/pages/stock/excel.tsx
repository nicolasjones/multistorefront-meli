import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { Link as RouterLink } from 'react-router'
import {
  Alert, Box, Button, Chip, Link, MenuItem, Paper, Snackbar, Stack, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, TextField, Typography, alpha,
} from '@mui/material'
import DownloadIcon from '@mui/icons-material/Download'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { ContenedorSeccion } from '../../components/pagina/ContenedorSeccion'
import { ContextoOrganizacionActiva } from '../../components/pagina/ContextoOrganizacionActiva'
import { EstadoCargaPagina, EstadoError } from '../../components/estados/EstadosPagina'
import { useNivelSeccion } from '../../hooks/useNivelSeccion'
import { listarDepositosActivos, type DepositoOpcion } from '../../lib/depositos'
import { generarClaveIdempotencia } from '../../lib/ingresos'
import {
  ErrorPlanilla, MENSAJE_PLANTILLA_DESCARGADA, aplicarCarga, contarCambios, contarErrores, descargarPlantilla,
  leerPlanilla, mensajeDeErrorCarga, rotularDiferencia, validarCarga,
  type FilaPlanilla, type FilaValidada, type ResultadoCarga,
} from '../../lib/cargaStock'
import { PestanasStock } from './PestanasStock'

type Archivo = { nombre: string; filas: FilaPlanilla[] }

const FORMATO_PLANILLA = [
  { columna: 'sku', contenido: 'Código del producto (obligatorio)' },
  { columna: 'cantidad', contenido: 'Unidades en el depósito elegido' },
  { columna: 'motivo', contenido: 'Opcional. Queda en el movimiento' },
] as const

function colorDiferencia(diferencia: number | null) {
  if (diferencia === null || diferencia === 0) return 'text.secondary'
  return diferencia > 0 ? 'success.main' : 'error.main'
}

// F-STK-07: pestaña «Actualizar por Excel» dentro de Stock (prototipo StockExcel.dc.html). La planilla se lee
// en el navegador; el servidor valida cada fila y «Aplicar» confirma solo las válidas, con un ajuste por
// diferencia (RPC `aplicar_carga_inicial_stock`, todo o nada, idempotente por clave). El stock es único y
// compartido por todas las tiendas: la pantalla no consulta ni filtra por empresa (Principio VIII: no aplica).
// Sin `edicion` en Stock no hay controles; la autoridad real es la base.
export function ActualizarStockExcel() {
  const { nivel, isLoading: cargandoNivel } = useNivelSeccion('stock')
  const [depositos, setDepositos] = useState<DepositoOpcion[]>([])
  const [depositosListos, setDepositosListos] = useState(false)
  const [errorDepositos, setErrorDepositos] = useState(false)
  const [recargaDepositos, setRecargaDepositos] = useState(0)
  const [depositoId, setDepositoId] = useState('')
  const [archivo, setArchivo] = useState<Archivo | null>(null)
  const [errorArchivo, setErrorArchivo] = useState<string | null>(null)
  const [vista, setVista] = useState<FilaValidada[] | null>(null)
  const [validando, setValidando] = useState(false)
  const [errorVista, setErrorVista] = useState<string | null>(null)
  const [aplicando, setAplicando] = useState(false)
  const [errorAplicar, setErrorAplicar] = useState<string | null>(null)
  const [resultado, setResultado] = useState<ResultadoCarga | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [errorPlantilla, setErrorPlantilla] = useState(false)
  const [clave, setClave] = useState(generarClaveIdempotencia)
  const [recargaVista, setRecargaVista] = useState(0)
  const enCurso = useRef(false)

  const puedeCargar = nivel === 'edicion'

  useEffect(() => {
    if (!puedeCargar) return
    let vigente = true
    setErrorDepositos(false)
    listarDepositosActivos()
      .then((lista) => {
        if (!vigente) return
        setDepositos(lista)
        setDepositoId((previo) => previo || (lista.find((d) => d.por_defecto) ?? lista[0])?.id || '')
        setDepositosListos(true)
      })
      .catch((error) => {
        console.error('No pudimos cargar los depósitos.', error)
        if (vigente) setErrorDepositos(true)
      })
    return () => { vigente = false }
  }, [puedeCargar, recargaDepositos])

  // La vista previa se pide al servidor al elegir la planilla y al cambiar de depósito (el stock actual y
  // las reservas dependen del depósito).
  useEffect(() => {
    if (!archivo || depositoId === '') { setVista(null); return }
    let vigente = true
    setValidando(true)
    setErrorVista(null)
    setErrorAplicar(null)
    validarCarga(depositoId, archivo.filas)
      .then((filas) => { if (vigente) setVista(filas) })
      .catch((error) => {
        if (vigente) {
          setVista(null)
          setErrorVista(mensajeDeErrorCarga(error, 'No pudimos revisar la planilla. Intentá de nuevo.'))
        }
      })
      .finally(() => { if (vigente) setValidando(false) })
    return () => { vigente = false }
  }, [archivo, depositoId, recargaVista])

  const elegirArchivo = async (evento: ChangeEvent<HTMLInputElement>) => {
    const elegido = evento.target.files?.[0]
    evento.target.value = ''
    if (!elegido) return
    setErrorArchivo(null)
    setResultado(null)
    try {
      const { filas } = await leerPlanilla(elegido)
      setClave(generarClaveIdempotencia())
      setArchivo({ nombre: elegido.name, filas })
    } catch (error) {
      setArchivo(null)
      setVista(null)
      setErrorArchivo(error instanceof ErrorPlanilla ? error.message : 'No pudimos leer el archivo. Intentá de nuevo.')
    }
  }

  const cambiarDeposito = (id: string) => {
    setClave(generarClaveIdempotencia())
    setDepositoId(id)
  }

  const cancelar = () => {
    setArchivo(null)
    setVista(null)
    setErrorArchivo(null)
    setErrorVista(null)
    setErrorAplicar(null)
    setClave(generarClaveIdempotencia())
  }

  const bajarPlantilla = async () => {
    setErrorPlantilla(false)
    try {
      await descargarPlantilla()
      setAviso(MENSAJE_PLANTILLA_DESCARGADA)
    } catch (error) {
      console.error('No pudimos armar la plantilla.', error)
      setErrorPlantilla(true)
    }
  }

  const depositoElegido = depositos.find((d) => d.id === depositoId)
  const cambios = vista ? contarCambios(vista) : 0
  const errores = vista ? contarErrores(vista) : 0

  const aplicar = async () => {
    // Guarda síncrona: el estado `aplicando` llega tarde para un doble clic.
    if (enCurso.current || !archivo || depositoId === '' || cambios === 0) return
    enCurso.current = true
    setAplicando(true)
    setErrorAplicar(null)
    try {
      const respuesta = await aplicarCarga(depositoId, archivo.filas, clave)
      setResultado(respuesta)
      setAviso(`Stock actualizado en ${depositoElegido?.nombre ?? 'el depósito'}`)
      setArchivo(null)
      setVista(null)
      setClave(generarClaveIdempotencia())
    } catch (error) {
      setErrorAplicar(mensajeDeErrorCarga(error, 'No pudimos aplicar la carga. No se guardó ningún ajuste: probá de nuevo.'))
    } finally {
      enCurso.current = false
      setAplicando(false)
    }
  }

  const cuerpo = () => {
    if (cargandoNivel) return <EstadoCargaPagina />
    if (!puedeCargar) return <Alert severity="info">Tu rol no puede cargar stock por planilla.</Alert>
    if (errorDepositos) return <EstadoError reintentar={() => setRecargaDepositos((valor) => valor + 1)} />
    if (!depositosListos) return <EstadoCargaPagina />
    return (
      <Stack spacing={2.5}>
        {resultado && (
          <Alert severity="success">
            <strong>Stock actualizado.</strong>{' '}
            Se registraron {resultado.aplicadas} movimientos de ajuste. Podés verlos en{' '}
            <Link component={RouterLink} to="/stock/movimientos">Stock · Movimientos</Link>.
            {resultado.omitidas > 0 && ` Se omitieron ${resultado.omitidas} ${resultado.omitidas === 1 ? 'fila' : 'filas'} con error.`}
          </Alert>
        )}
        {errorPlantilla && <Alert severity="error">No pudimos armar la plantilla. Intentá de nuevo.</Alert>}

        <Paper variant="outlined" sx={{ p: 2.5 }}>
          <Typography variant="h6" component="h2" gutterBottom>1 · Planilla</Typography>
          <Stack spacing={2}>
            <TextField
              select
              label="Depósito de mercadería"
              value={depositoId}
              onChange={(evento) => cambiarDeposito(evento.target.value)}
              disabled={aplicando}
              sx={{ maxWidth: 420 }}
            >
              {depositos.map((deposito) => <MenuItem key={deposito.id} value={deposito.id}>{deposito.nombre}</MenuItem>)}
            </TextField>
            <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
              <Button component="label" variant="outlined" disabled={aplicando}>
                {archivo ? 'Cambiar archivo' : 'Elegir Excel'}
                <input
                  type="file"
                  hidden
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  aria-label="Archivo Excel"
                  onChange={elegirArchivo}
                />
              </Button>
              <Box>
                <Typography variant="body2">{archivo ? archivo.nombre : 'Ningún archivo elegido'}</Typography>
                {archivo && (
                  <Typography variant="caption" color="text.secondary">{archivo.filas.length} filas · hoja 1</Typography>
                )}
              </Box>
            </Stack>
            {errorArchivo && <Alert severity="error">{errorArchivo}</Alert>}

            <Paper variant="outlined" sx={{ p: 2 }}>
              <Typography variant="subtitle2" component="h3" gutterBottom>Formato de la planilla</Typography>
              <TableContainer>
                <Table size="small" aria-label="Formato de la planilla">
                  <TableHead>
                    <TableRow>
                      <TableCell>Columna</TableCell>
                      <TableCell>Contenido</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {FORMATO_PLANILLA.map((fila) => (
                      <TableRow key={fila.columna}>
                        <TableCell component="th" scope="row"><code>{fila.columna}</code></TableCell>
                        <TableCell>{fila.contenido}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                Las reservas por «A pedido» no cambian: se ajusta el stock físico, no el disponible.
              </Typography>
            </Paper>
          </Stack>
        </Paper>

        {archivo && (
          <Paper variant="outlined" sx={{ p: 2.5 }}>
            <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 1.5 }}>
              <Typography variant="h6" component="h2">2 · Diferencias a aplicar</Typography>
              {vista && (
                <>
                  <Chip size="small" color="success" variant="outlined" label={`${cambios} cambios`} />
                  <Chip size="small" color={errores > 0 ? 'error' : 'default'} variant="outlined" label={`${errores} con error`} />
                </>
              )}
            </Stack>
            {validando ? (
              <EstadoCargaPagina />
            ) : errorVista ? (
              <EstadoError titulo={errorVista} reintentar={() => setRecargaVista((valor) => valor + 1)} />
            ) : vista && (
              <>
                <TableContainer>
                  <Table size="small" aria-label="Diferencias a aplicar">
                    <TableHead>
                      <TableRow>
                        <TableCell>SKU</TableCell>
                        <TableCell>Producto</TableCell>
                        <TableCell align="right">Stock actual</TableCell>
                        <TableCell align="right">En planilla</TableCell>
                        <TableCell align="right">Quedará</TableCell>
                        <TableCell align="right">Diferencia</TableCell>
                        <TableCell>Validación</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {vista.map((fila) => (
                        <TableRow
                          key={fila.fila}
                          data-estado={fila.estado}
                          sx={fila.estado === 'error' ? { bgcolor: (tema) => alpha(tema.palette.error.main, 0.08) } : undefined}
                        >
                          <TableCell>{fila.sku || '—'}</TableCell>
                          <TableCell>{fila.producto ?? '—'}</TableCell>
                          <TableCell align="right">{fila.stock_actual ?? '—'}</TableCell>
                          <TableCell align="right">{fila.en_planilla ?? '—'}</TableCell>
                          <TableCell align="right">{fila.quedara ?? '—'}</TableCell>
                          <TableCell align="right" sx={{ color: colorDiferencia(fila.diferencia), fontWeight: 600 }}>
                            {rotularDiferencia(fila.diferencia)}
                          </TableCell>
                          <TableCell sx={fila.estado === 'error' ? { color: 'error.main', fontWeight: 600 } : undefined}>
                            {fila.mensaje}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
                  Se creará un movimiento de tipo Ajuste por cada diferencia, en {depositoElegido?.nombre ?? 'el depósito elegido'}.
                </Typography>
                {errorAplicar && <Alert severity="error" sx={{ mt: 2 }}>{errorAplicar}</Alert>}
                <Stack direction="row" spacing={1.5} justifyContent="flex-end" sx={{ mt: 2 }}>
                  <Button variant="text" onClick={cancelar} disabled={aplicando}>Cancelar</Button>
                  <Button variant="contained" onClick={aplicar} disabled={aplicando || cambios === 0}>
                    {aplicando ? 'Aplicando…' : `Aplicar ${cambios} ajustes`}
                  </Button>
                </Stack>
              </>
            )}
          </Paper>
        )}
      </Stack>
    )
  }

  return (
    <Box>
      <EncabezadoPagina titulo="Stock" contexto={<ContextoOrganizacionActiva />} />
      <ContenedorSeccion>
        <PestanasStock activa="excel" />
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={2} sx={{ mb: 2 }} flexWrap="wrap" useFlexGap>
          <Box sx={{ maxWidth: 720 }}>
            <Typography variant="h5" component="h2">Actualizar stock por Excel</Typography>
            <Typography variant="body2" color="text.secondary">
              Cargá las cantidades contadas desde una planilla. Cada diferencia genera un movimiento de ajuste. El stock es compartido: el cambio vale para todas las tiendas.
            </Typography>
          </Box>
          {puedeCargar && (
            <Button variant="outlined" startIcon={<DownloadIcon />} onClick={bajarPlantilla}>
              Descargar plantilla Excel
            </Button>
          )}
        </Stack>
        {cuerpo()}
      </ContenedorSeccion>
      <Snackbar open={aviso !== null} autoHideDuration={4000} onClose={() => setAviso(null)}>
        <Alert severity="success" onClose={() => setAviso(null)}>{aviso}</Alert>
      </Snackbar>
    </Box>
  )
}
