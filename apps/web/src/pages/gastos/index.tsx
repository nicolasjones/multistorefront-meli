import { lazy, Suspense, useMemo, useState } from 'react'
import {
  Alert, Box, Button, Card, CardContent, Chip, FormControlLabel, MenuItem, Snackbar, Stack, Switch, TextField, ToggleButton,
  ToggleButtonGroup, Typography,
} from '@mui/material'
import { BarraHerramientas } from '../../components/pagina/BarraHerramientas'
import { CargaInfinita } from '../../components/pagina/CargaInfinita'
import { ContenidoAdaptable, type ColumnaAdaptable } from '../../components/pagina/ContenidoAdaptable'
import { ContenedorSeccion } from '../../components/pagina/ContenedorSeccion'
import { ContextoOrganizacionActiva } from '../../components/pagina/ContextoOrganizacionActiva'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { FiltroEmpresa } from '../../components/pagina/FiltroEmpresa'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../../components/estados/EstadosPagina'
import { useFiltroPorEmpresaActiva } from '../../hooks/useFiltroPorEmpresaActiva'
import { useGastos } from '../../hooks/useGastos'
import { useNivelSeccion } from '../../hooks/useNivelSeccion'
import { descargarCsv, nombreArchivoCsv } from '../../lib/exportarCsv'
import { formatearFecha } from '../../lib/formatoRanking'
import {
  CATEGORIAS_GASTO,
  type CategoriaGasto,
  type FiltrosGastos,
  type Gasto,
  PERIODOS_GASTO,
  type PeriodoGasto,
  type TipoCostoGasto,
  exportarGastosCsv,
  formatearImporteGasto,
  rangoDePeriodoGasto,
} from '../../lib/gastos'
import { SECCION_RENTABILIDAD } from '../../lib/rentabilidad'

// Los diálogos (MUI Dialog + formulario) quedan fuera de la carga inicial de la pantalla (Principio VI).
const DialogoGasto = lazy(() => import('./DialogoGasto').then((m) => ({ default: m.DialogoGasto })))
const DialogoAnularGasto = lazy(() => import('./DialogoAnularGasto').then((m) => ({ default: m.DialogoAnularGasto })))

// Diálogo abierto con la empresa activa de la barra superior con la que se abrió (`base`): si la activa cambia, ya no vale y se
// cierra con aviso, sin guardar nada (Principio VIII).
type Abierto = { tipo: 'editar'; gasto: Gasto | null; base: string | null } | { tipo: 'anular'; gasto: Gasto; base: string | null }

const TODAS = 'todas'
const formatoPesos = (valor: number) => formatearImporteGasto(valor, 'ARS')

// «Gastos» (Administración · F-GAS-01/02; prototipo VentasGastos.dc.html). Registra, edita y anula los gastos generales de cada tienda
// y los consulta por período, tienda, concepto y tipo de costo, con total y desglose. Ver = `lectura` en `rentabilidad`; cargar,
// editar y anular = `edicion` (la base valida igual: RPC `security definer`). No cambia ninguna cifra de rentabilidad.
export function Gastos() {
  const { nivel } = useNivelSeccion(SECCION_RENTABILIDAD)
  const puedeEditar = nivel === 'edicion'
  const { empresas, valor: empresaId, cambiar: elegirEmpresa, empresaActivaId, cargando: cargandoTiendas, hayError: errorTiendas } = useFiltroPorEmpresaActiva()
  const [periodo, setPeriodo] = useState<PeriodoGasto>('mes')
  const [categoria, setCategoria] = useState<CategoriaGasto | null>(null)
  const [tipoCosto, setTipoCosto] = useState<TipoCostoGasto | null>(null)
  const [mostrarAnulados, setMostrarAnulados] = useState(false)
  const [abierto, setAbierto] = useState<Abierto | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [errorExportar, setErrorExportar] = useState<string | null>(null)
  const [exportando, setExportando] = useState(false)

  const filtros = useMemo<FiltrosGastos>(() => {
    const { desde, hasta } = rangoDePeriodoGasto(periodo)
    return { desde, hasta, empresaId, categoria, tipoCosto }
  }, [periodo, empresaId, categoria, tipoCosto])
  const { filas, resumen, hayMas, cargando, cargandoMas, hayError, errorTanda, recargar, cargarMas } = useGastos(filtros, mostrarAnulados)

  // Derivado, sin efecto: el diálogo abierto con otra empresa activa ya no vale.
  const vigente = abierto && abierto.base === empresaActivaId ? abierto : null
  const cerradoPorCambio = abierto !== null && vigente === null
  const abrirEditar = (gasto: Gasto | null) => { setAviso(null); setAbierto({ tipo: 'editar', gasto, base: empresaActivaId }) }
  const abrirAnular = (gasto: Gasto) => { setAviso(null); setAbierto({ tipo: 'anular', gasto, base: empresaActivaId }) }

  const exportar = async () => {
    if (exportando) return
    setExportando(true)
    setErrorExportar(null)
    try {
      const { contenido, total, truncado } = await exportarGastosCsv(filtros, mostrarAnulados)
      descargarCsv(contenido, nombreArchivoCsv('gastos'))
      setAviso(truncado ? `Exportamos los primeros 10.000 de ${total} gastos: acotá el período para el resto.` : `Exportamos ${total} ${total === 1 ? 'gasto' : 'gastos'}.`)
    } catch {
      setErrorExportar('No pudimos exportar los gastos. Intentá de nuevo.')
    } finally {
      setExportando(false)
    }
  }

  const columnas = useMemo<ColumnaAdaptable<Gasto>[]>(() => [
    { clave: 'fecha', encabezado: 'Fecha', render: (g) => formatearFecha(g.fecha) },
    {
      clave: 'concepto',
      encabezado: 'Concepto',
      render: (g) => (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <Typography component="span" sx={{ fontWeight: 600 }}>{g.categoria}</Typography>
          <Typography component="span" variant="xs" color="text.secondary">{g.tipoCosto === 'fijo' ? 'Fijo' : 'Variable'}</Typography>
          {g.recurrente ? <Chip size="small" label="Recurrente" /> : null}
          {g.anuladoEn ? <Chip size="small" color="error" variant="outlined" label="Anulado" /> : null}
        </Stack>
      ),
    },
    {
      clave: 'detalle',
      encabezado: 'Detalle',
      render: (g) => (
        <Box>
          <Typography component="span">{g.detalle ?? '—'}</Typography>
          {g.motivoAnulacion ? <Typography component="span" variant="xs" color="text.secondary" sx={{ display: 'block' }}>{`Motivo: ${g.motivoAnulacion}`}</Typography> : null}
        </Box>
      ),
    },
    { clave: 'tienda', encabezado: 'Tienda', render: (g) => g.empresaNombre },
    {
      clave: 'importe',
      encabezado: 'Importe',
      align: 'right',
      render: (g) => (
        <Box sx={{ textAlign: 'right', textDecoration: g.anuladoEn ? 'line-through' : 'none' }}>
          <Typography component="span" sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{formatearImporteGasto(g.importe, g.moneda)}</Typography>
          {g.moneda === 'USD' ? (
            <Typography component="span" variant="xs" color="text.secondary" sx={{ display: 'block', whiteSpace: 'nowrap' }}>
              {`${formatoPesos(g.importePesos)} al dólar de ${formatoPesos(g.cotizacionUsada ?? 0)}`}
            </Typography>
          ) : null}
        </Box>
      ),
    },
  ], [])

  const nuevo = puedeEditar ? <Button variant="contained" onClick={() => abrirEditar(null)}>Nuevo gasto</Button> : null
  const acciones = (
    <Stack direction="row" spacing={1}>
      <Button variant="outlined" onClick={() => void exportar()} disabled={exportando || cargando || hayError}>{exportando ? 'Exportando…' : 'Exportar'}</Button>
      {nuevo}
    </Stack>
  )

  const primeraCarga = cargando && filas.length === 0 && !hayError
  const sinGastos = !cargando && !hayError && filas.length === 0

  return (
    <Box>
      <EncabezadoPagina
        titulo="Gastos"
        descripcion="Los gastos generales de cada tienda, para entender cuánto cuesta operarla."
        contexto={<ContextoOrganizacionActiva />}
        accion={acciones}
      />
      <ContenedorSeccion>
        <Stack spacing={2}>
          <FiltroEmpresa
            empresas={empresas}
            valor={empresaId}
            onCambiar={elegirEmpresa}
            cargando={cargandoTiendas}
            hayError={errorTiendas}
            textoAyuda="Por defecto se ve la tienda activa de la barra superior; elegí «Todas las tiendas» para sumarlas."
          />

          {cerradoPorCambio ? <Alert severity="info" onClose={() => setAbierto(null)}>Cambiaste de empresa: cerramos el diálogo sin guardar nada.</Alert> : null}
          {errorExportar ? <Alert severity="error" role="alert">{errorExportar}</Alert> : null}

          <Card variant="outlined">
            <CardContent>
              <Typography component="p" variant="s">Total del período</Typography>
              <Typography component="p" variant="kpi" sx={{ mt: 0.75 }}>{resumen ? formatoPesos(resumen.total) : '—'}</Typography>
              <Typography component="p" variant="s" sx={{ mt: 0.25 }}>
                {resumen ? `${resumen.conteo} ${resumen.conteo === 1 ? 'gasto' : 'gastos'}` : ''}
              </Typography>
              {resumen && resumen.desglose.length > 0 ? (
                <Box component="ul" aria-label="Desglose por concepto" sx={{ listStyle: 'none', p: 0, m: 0, mt: 1.5 }}>
                  {resumen.desglose.map((d) => (
                    <Stack component="li" key={`${d.categoria}-${d.tipoCosto}`} direction="row" sx={{ justifyContent: 'space-between', py: 0.5 }}>
                      <Typography component="span">{`${d.categoria} · ${d.tipoCosto === 'fijo' ? 'fijo' : 'variable'}`}</Typography>
                      <Typography component="span" sx={{ fontWeight: 600 }}>{formatoPesos(d.total)}</Typography>
                    </Stack>
                  ))}
                </Box>
              ) : null}
            </CardContent>
          </Card>

          <Card variant="outlined">
            <CardContent>
              <BarraHerramientas>
                <ToggleButtonGroup
                  exclusive
                  size="small"
                  aria-label="Período"
                  value={periodo}
                  onChange={(_, valor: PeriodoGasto | null) => { if (valor) setPeriodo(valor) }}
                >
                  {PERIODOS_GASTO.map((p) => <ToggleButton key={p.valor} value={p.valor}>{p.etiqueta}</ToggleButton>)}
                </ToggleButtonGroup>
                <TextField
                  select
                  size="small"
                  label="Concepto"
                  value={categoria ?? TODAS}
                  onChange={(evento) => setCategoria(evento.target.value === TODAS ? null : (evento.target.value as CategoriaGasto))}
                  sx={{ minWidth: 160 }}
                >
                  <MenuItem value={TODAS}>Todos</MenuItem>
                  {CATEGORIAS_GASTO.map((c) => <MenuItem key={c} value={c}>{c}</MenuItem>)}
                </TextField>
                <TextField
                  select
                  size="small"
                  label="Tipo de costo"
                  value={tipoCosto ?? TODAS}
                  onChange={(evento) => setTipoCosto(evento.target.value === TODAS ? null : (evento.target.value as TipoCostoGasto))}
                  sx={{ minWidth: 160 }}
                >
                  <MenuItem value={TODAS}>Todos</MenuItem>
                  <MenuItem value="fijo">Fijo</MenuItem>
                  <MenuItem value="variable">Variable</MenuItem>
                </TextField>
                <FormControlLabel
                  control={<Switch checked={mostrarAnulados} onChange={(evento) => setMostrarAnulados(evento.target.checked)} />}
                  label="Mostrar anulados"
                />
              </BarraHerramientas>

              {primeraCarga ? <EstadoCargaPagina lineas={3} /> : null}
              {hayError ? <EstadoError descripcion="No pudimos cargar los gastos. Intentá de nuevo." reintentar={() => void recargar()} /> : null}
              {sinGastos ? (
                <EstadoVacio
                  titulo="Sin gastos en el período"
                  descripcion={puedeEditar ? 'Cambiá el período o los filtros, o cargá un gasto nuevo.' : 'Cambiá el período o los filtros.'}
                  accion={nuevo ?? undefined}
                />
              ) : null}
              {filas.length > 0 ? (
                <Box aria-busy={cargando}>
                  <ContenidoAdaptable
                    items={filas}
                    columnas={columnas}
                    obtenerClave={(g) => g.id}
                    etiquetaTabla="Gastos"
                    acciones={puedeEditar ? (g) => (g.anuladoEn ? null : (
                      <Stack direction="row" spacing={1}>
                        <Button size="small" variant="outlined" aria-label={`Editar gasto de ${g.categoria} del ${formatearFecha(g.fecha)}`} onClick={() => abrirEditar(g)}>Editar</Button>
                        <Button size="small" variant="outlined" color="error" aria-label={`Anular gasto de ${g.categoria} del ${formatearFecha(g.fecha)}`} onClick={() => abrirAnular(g)}>Anular</Button>
                      </Stack>
                    )) : undefined}
                  />
                </Box>
              ) : null}
              {!primeraCarga && !hayError && filas.length > 0 ? (
                <CargaInfinita
                  mostrarFin
                  hayMas={hayMas}
                  cargando={cargandoMas}
                  hayError={errorTanda}
                  sustantivo="gastos"
                  cargados={filas.length}
                  onCargarMas={() => void cargarMas()}
                />
              ) : null}
            </CardContent>
          </Card>
        </Stack>
      </ContenedorSeccion>

      <Suspense fallback={null}>
        {vigente?.tipo === 'editar' ? (
          <DialogoGasto
            gasto={vigente.gasto}
            empresas={empresas}
            empresaInicialId={empresaActivaId}
            onCerrar={() => setAbierto(null)}
            onGuardado={(alta) => { setAbierto(null); setAviso(alta ? 'Gasto cargado.' : 'Gasto actualizado.'); void recargar() }}
          />
        ) : null}
        {vigente?.tipo === 'anular' ? (
          <DialogoAnularGasto
            gasto={vigente.gasto}
            onCerrar={() => setAbierto(null)}
            onAnulado={() => { setAbierto(null); setAviso('Gasto anulado.'); void recargar() }}
          />
        ) : null}
      </Suspense>

      <Snackbar open={aviso !== null} autoHideDuration={5000} onClose={() => setAviso(null)}>
        <Alert severity="success" onClose={() => setAviso(null)}>{aviso}</Alert>
      </Snackbar>
    </Box>
  )
}
