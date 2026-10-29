import { useCallback, useEffect, useRef, useState } from 'react'
import { Box, Button, Chip, LinearProgress, Stack, Tab, TablePagination, Tabs, Typography } from '@mui/material'
import { useFiltroPorEmpresaActiva } from '../../../hooks/useFiltroPorEmpresaActiva'
import { useOrganizacionActiva } from '../../../hooks/useOrganizacionActiva'
import { usePuedeEscribir } from '../../../hooks/usePuedeEscribir'
import { listarTransportes, etiquetaTipo, type PaginaTransportes, type Transporte } from '../../../lib/ventas/transportes'
import {
  codigoDeError,
  listarContrarreembolsos,
  puedeCobrarContrarreembolso,
  resumenContrarreembolsos,
  type PaginaContrarreembolsos,
  type ResumenContrarreembolsos,
} from '../../../lib/ventas/contrarreembolsos'
import { TransporteDialog } from '../../../components/ventas/TransporteDialog'
import { ContrarreembolsosTabla, ContrarreembolsosTarjetas } from '../../../components/ventas/ContrarreembolsosTabla'
import { EstadoCargaPagina, EstadoError, EstadoExito, EstadoVacio } from '../../../components/estados/EstadosPagina'
import { EtiquetaEstado } from '../../../components/base/EtiquetaEstado'
import { EncabezadoPagina } from '../../../components/pagina/EncabezadoPagina'
import { ContenedorSeccion } from '../../../components/pagina/ContenedorSeccion'
import { ContenidoAdaptable, type ColumnaAdaptable } from '../../../components/pagina/ContenidoAdaptable'
import { BarraHerramientas } from '../../../components/pagina/BarraHerramientas'
import { ContextoOrganizacionActiva } from '../../../components/pagina/ContextoOrganizacionActiva'
import { FiltroEmpresa } from '../../../components/pagina/FiltroEmpresa'

const TAMANO_PAGINA = 25
// Los contrarreembolsos se paginan de a 10 (el tamaño por defecto de `listar_contrarreembolsos`).
const TAMANO_PAGINA_CONTRARREEMBOLSOS = 10
// Barra de progreso indeterminada: alto fino propio del componente, no un valor del sistema.
const ALTO_BARRA_CARGA = 2
const visuallyHidden = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' } as const // estilos-sueltos: ok: oculta visualmente sin quitar del lector

const PAGINA_VACIA: PaginaTransportes = { transportes: [], total: 0, totalOrganizacion: 0 }
const PAGINA_CONTRARREEMBOLSOS_VACIA: PaginaContrarreembolsos = { contrarreembolsos: [], total: 0 }

// Sub-pestañas de «Transportes y contrarreembolsos» (F-VTA-14, FR-046). La de Terminales es la
// de MSF-139 (F-VTA-04) tal cual; la de Contrarreembolsos es la nueva de US3. La ayuda de cada
// pestaña es la del prototipo.
type Pestana = 'contrarreembolsos' | 'terminales'

const PESTANAS: ReadonlyArray<{ valor: Pestana; etiqueta: string; ayuda: string }> = [
  {
    valor: 'contrarreembolsos',
    etiqueta: 'Contrarreembolsos',
    ayuda: 'El transporte cobra al entregar y rinde después.',
  },
  {
    valor: 'terminales',
    etiqueta: 'Terminales de retiro',
    ayuda: 'Empresas de transporte y dónde retira cada una.',
  },
]

const columnas: ColumnaAdaptable<Transporte>[] = [
  {
    clave: 'nombre', encabezado: 'Empresa de transporte',
    render: (transporte) => (
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        <Typography component="span" sx={{ fontWeight: 600 }}>{transporte.nombre}</Typography>
        <Chip label={etiquetaTipo(transporte.tipo)} size="small" variant="outlined" />
        {transporte.activa ? null : <EtiquetaEstado texto="Inactiva" />}
      </Stack>
    ),
  },
  { clave: 'terminal_retiro', encabezado: 'Terminal de retiro', render: (transporte) => transporte.terminal_retiro ?? '—' },
  { clave: 'localidad', encabezado: 'Localidad', render: (transporte) => transporte.localidad ?? '—' },
  { clave: 'telefono', encabezado: 'Teléfono', render: (transporte) => transporte.telefono ?? '—' },
  { clave: 'contacto', encabezado: 'Contacto', render: (transporte) => transporte.persona_contacto ?? '—' },
]

// Pantalla Transportes y contrarreembolsos (F-VTA-04 y F-VTA-14, FR-018 y FR-046): el catálogo de
// empresas de transporte con sus terminales de retiro, y la pestaña de contrarreembolsos por
// transporte (US3). Quien tiene la sección `ventas` la ve; solo el Administrador suma
// `Nueva empresa` y edita (la base aplica el mismo límite por RLS).
// La columna «Envíos del mes» y las motos son de despacho (fuera de alcance).
export function TransporteList() {
  const { puedeEscribir } = usePuedeEscribir()
  const puedeEditar = puedeEscribir === true
  const { organizacionActiva } = useOrganizacionActiva()
  const organizacionId = organizacionActiva?.id ?? null
  // Filtro de tienda de la pantalla (F-ROL-06, Principio VIII): sigue a la empresa activa de la
  // barra superior, como en Clientes, Productos o Cuentas de cobro; las píldoras lo sobreescriben
  // sin cambiar la activa. La pantalla no guarda su propia empresa: la fuente de verdad es la de la
  // barra superior.
  const {
    empresas: tiendas,
    valor: empresaContrarreembolsos,
    cambiar: elegirEmpresaContrarreembolsos,
    cargando: cargandoEmpresasActivas,
    empresaActivaId,
  } = useFiltroPorEmpresaActiva()
  // «Terminales de retiro» conserva el filtro propio de MSF-139, con «Todas las tiendas» por
  // defecto: el catálogo de transportes es de la organización, no de la tienda. Al cambiar la
  // empresa activa se recarga igual (la clave de contexto la incluye), sin cambiar este filtro.
  const [empresaTerminales, setEmpresaTerminales] = useState<string | null>(null)
  const [paginaTerminales, setPaginaTerminales] = useState(1)
  const [paginaContrarreembolsos, setPaginaContrarreembolsos] = useState(1)
  const [pestana, setPestana] = useState<Pestana>('contrarreembolsos')
  const [datos, setDatos] = useState<PaginaTransportes>(PAGINA_VACIA)
  const [cargando, setCargando] = useState(true)
  const [hayError, setHayError] = useState(false)
  // Contexto (organización y empresa activa) para el que llegó la última respuesta.
  const [respondidaPara, setRespondidaPara] = useState<string | undefined>(undefined)
  const [creando, setCreando] = useState(false)
  const [editando, setEditando] = useState<Transporte | null>(null)
  const [guardado, setGuardado] = useState(false)
  const ultimaPeticion = useRef(0)

  // Contrarreembolsos (F-VTA-14, FR-045 y FR-047): listado, tarjetas y permiso de cobro por tienda.
  const [contrarreembolsos, setContrarreembolsos] = useState<PaginaContrarreembolsos>(PAGINA_CONTRARREEMBOLSOS_VACIA)
  const [resumen, setResumen] = useState<ResumenContrarreembolsos | null>(null)
  const [cargandoContrarreembolsos, setCargandoContrarreembolsos] = useState(true)
  const [actualizandoContrarreembolsos, setActualizandoContrarreembolsos] = useState(false)
  const [errorContrarreembolsos, setErrorContrarreembolsos] = useState<string | null>(null)
  const [respondidaParaContrarreembolsos, setRespondidaParaContrarreembolsos] = useState<string | undefined>(undefined)
  const [empresasConPermiso, setEmpresasConPermiso] = useState<ReadonlySet<string>>(new Set())
  const ultimaPeticionContrarreembolsos = useRef(0)
  // Permisos ya leídos: una llamada por tienda, no una por fila. La clave incluye la
  // organización: el permiso depende del rol, que es por organización.
  const permisosPorEmpresa = useRef(new Map<string, boolean>())

  // El contexto de cada pestaña: cambia con la organización, con la empresa activa de la barra y con
  // el filtro de tienda de esa pestaña. Mientras no llegue la respuesta de este contexto no se
  // muestra la lista anterior (Principio VIII).
  const claveTerminales = `${organizacionId ?? ''}:${empresaActivaId ?? ''}:${empresaTerminales ?? ''}`
  const claveContrarreembolsos = `${organizacionId ?? ''}:${empresaActivaId ?? ''}:${empresaContrarreembolsos ?? ''}`

  // Al cambiar la tienda de una pestaña su paginación vuelve a la primera. Se ajusta en el render
  // (como en Productos): así la consulta sale una sola vez, ya con la página 1 y con la tienda
  // nueva, sin pedir la página vieja.
  const [empresaPreviaContrarreembolsos, setEmpresaPreviaContrarreembolsos] = useState(empresaContrarreembolsos)
  if (empresaPreviaContrarreembolsos !== empresaContrarreembolsos) {
    setEmpresaPreviaContrarreembolsos(empresaContrarreembolsos)
    setPaginaContrarreembolsos(1)
  }
  const [empresaPreviaTerminales, setEmpresaPreviaTerminales] = useState(empresaTerminales)
  if (empresaPreviaTerminales !== empresaTerminales) {
    setEmpresaPreviaTerminales(empresaTerminales)
    setPaginaTerminales(1)
  }

  // «Última petición gana»: una respuesta vieja no pisa a la nueva.
  const cargar = useCallback(async () => {
    const peticion = ++ultimaPeticion.current
    setCargando(true)
    try {
      const resultado = await listarTransportes({ empresaId: empresaTerminales, pagina: paginaTerminales, tamano: TAMANO_PAGINA })
      if (peticion !== ultimaPeticion.current) return
      setDatos(resultado)
      setHayError(false)
    } catch (error) {
      if (peticion !== ultimaPeticion.current) return
      console.error('No pudimos listar los transportes.', codigoDeError(error))
      setDatos(PAGINA_VACIA)
      setHayError(true)
    }
    setCargando(false)
    setRespondidaPara(claveTerminales)
    // organizacionId y empresaActivaId solo disparan la recarga; RLS resuelve la organización.
  }, [empresaTerminales, paginaTerminales, claveTerminales])

  // El catálogo de transportes se pide solo cuando su pestaña está a la vista.
  useEffect(() => {
    if (pestana !== 'terminales') return
    void cargar()
  }, [cargar, pestana])

  // Permiso de «Marcar cobrado» por tienda (FR-041 y FR-047): una llamada por tienda de la página.
  // Si la lectura falla, la tienda queda sin permiso (deny-by-default): no se ofrece lo que la
  // base va a rechazar.
  const leerPermisos = useCallback(async (empresaIds: string[]): Promise<Set<string>> => {
    const clave = (id: string) => `${organizacionId ?? ''}:${id}`
    const distintas = [...new Set(empresaIds)].filter((id) => !permisosPorEmpresa.current.has(clave(id)))
    await Promise.all(distintas.map(async (id) => {
      try {
        permisosPorEmpresa.current.set(clave(id), await puedeCobrarContrarreembolso(id))
      } catch (error) {
        console.error('No pudimos leer el permiso de cobro de contrarreembolsos.', codigoDeError(error))
        permisosPorEmpresa.current.set(clave(id), false)
      }
    }))
    return new Set(
      [...new Set(empresaIds)].filter((id) => permisosPorEmpresa.current.get(clave(id)) === true),
    )
  }, [organizacionId])

  const cargarContrarreembolsos = useCallback(async () => {
    const peticion = ++ultimaPeticionContrarreembolsos.current
    setCargandoContrarreembolsos(true)
    setActualizandoContrarreembolsos(true)
    try {
      const [paginaDatos, totales] = await Promise.all([
        listarContrarreembolsos({
          empresaId: empresaContrarreembolsos,
          estado: null,
          pagina: paginaContrarreembolsos,
          tamano: TAMANO_PAGINA_CONTRARREEMBOLSOS,
        }),
        resumenContrarreembolsos(empresaContrarreembolsos),
      ])
      if (peticion !== ultimaPeticionContrarreembolsos.current) return
      setContrarreembolsos(paginaDatos)
      setResumen(totales)
      setErrorContrarreembolsos(null)
      // La lista ya se puede mostrar: la lectura del permiso de cobro no la bloquea (si esa
      // llamada se cuelga, la persona ve los contrarreembolsos igual y el botón aparece después).
      setRespondidaParaContrarreembolsos(claveContrarreembolsos)
      const conPermiso = await leerPermisos(paginaDatos.contrarreembolsos.map((cr) => cr.empresa_id))
      if (peticion !== ultimaPeticionContrarreembolsos.current) return
      setEmpresasConPermiso(conPermiso)
    } catch (error) {
      if (peticion !== ultimaPeticionContrarreembolsos.current) return
      console.error('No pudimos cargar los contrarreembolsos.', codigoDeError(error))
      setContrarreembolsos(PAGINA_CONTRARREEMBOLSOS_VACIA)
      setResumen(null)
      setEmpresasConPermiso(new Set())
      setErrorContrarreembolsos('No pudimos cargar los contrarreembolsos.')
      setRespondidaParaContrarreembolsos(claveContrarreembolsos)
    } finally {
      if (peticion === ultimaPeticionContrarreembolsos.current) {
        setCargandoContrarreembolsos(false)
        setActualizandoContrarreembolsos(false)
      }
    }
  }, [empresaContrarreembolsos, paginaContrarreembolsos, claveContrarreembolsos, leerPermisos])

  // El listado de contrarreembolsos se pide solo cuando su pestaña está a la vista.
  useEffect(() => {
    if (pestana !== 'contrarreembolsos') return
    void cargarContrarreembolsos()
  }, [cargarContrarreembolsos, pestana])

  const { transportes, total, totalOrganizacion } = datos
  // Mientras no llegó la respuesta de este contexto, no se muestran filas de la tienda anterior.
  const isLoading = respondidaPara === undefined || respondidaPara !== claveTerminales
  const isFetching = cargando

  const isLoadingContrarreembolsos =
    respondidaParaContrarreembolsos === undefined || respondidaParaContrarreembolsos !== claveContrarreembolsos

  // Página fuera de rango (p. ej. se cambió el filtro estando en la última página): vuelve a la primera.
  useEffect(() => {
    if (!isLoading && !isFetching && !hayError && transportes.length === 0 && paginaTerminales > 1) setPaginaTerminales(1)
  }, [isLoading, isFetching, hayError, transportes.length, paginaTerminales])

  // Página fuera de rango de contrarreembolsos (p. ej. se cobró el último de la última página).
  const filasContrarreembolsos = contrarreembolsos.contrarreembolsos.length
  useEffect(() => {
    if (
      !isLoadingContrarreembolsos
      && !cargandoContrarreembolsos
      && errorContrarreembolsos === null
      && filasContrarreembolsos === 0
      && paginaContrarreembolsos > 1
    ) setPaginaContrarreembolsos(1)
  }, [isLoadingContrarreembolsos, cargandoContrarreembolsos, errorContrarreembolsos, filasContrarreembolsos, paginaContrarreembolsos])

  // Empresa activa (Principio VIII, FR-048): al cambiar la tienda de la barra superior la pantalla
  // se reencuadra. «Contrarreembolsos» sigue a esa tienda (`useFiltroPorEmpresaActiva`) y
  // «Terminales» conserva su filtro propio de MSF-139; en las dos, la paginación vuelve a la
  // primera y las consultas se recargan (la clave de contexto cambia). Nunca queda una fila ni un
  // total de la tienda anterior.
  const empresaActivaPrevia = useRef<string | null | undefined>(undefined)
  useEffect(() => {
    if (cargandoEmpresasActivas) return
    if (empresaActivaPrevia.current === undefined) {
      empresaActivaPrevia.current = empresaActivaId
      return
    }
    if (empresaActivaId === empresaActivaPrevia.current) return
    empresaActivaPrevia.current = empresaActivaId
    setPaginaTerminales(1)
    setPaginaContrarreembolsos(1)
  }, [cargandoEmpresasActivas, empresaActivaId])

  // «Hay filtro» para el mensaje de vacío: una tienda elegida que deja la lista sin filas. La vista
  // por defecto de «Contrarreembolsos» (la empresa activa de la barra) no se anuncia como filtro
  // vacío: si no hay datos, es que todavía no se cargaron. «Terminales» arranca en «Todas las
  // tiendas», así que cualquier valor es un filtro elegido.
  const hayFiltroContrarreembolsos =
    empresaContrarreembolsos !== null && empresaContrarreembolsos !== empresaActivaId
  const hayFiltroTerminales = empresaTerminales !== null
  const botonNueva = puedeEditar
    ? <Button variant="contained" onClick={() => { setGuardado(false); setCreando(true) }}>Nueva empresa</Button>
    : undefined
  const pestanaActual = PESTANAS.find((p) => p.valor === pestana) ?? PESTANAS[0]

  return (
    <Box>
      <EncabezadoPagina
        titulo="Transportes y contrarreembolsos"
        descripcion="Cobros a la entrega por empresa de transporte, mensajería propia en moto y terminales de retiro."
        accion={botonNueva}
        contexto={<ContextoOrganizacionActiva />}
      />
      <ContenedorSeccion>
        <Stack spacing={2}>
          {guardado ? <EstadoExito titulo="Empresa de transporte guardada" /> : null}
          <BarraHerramientas>
            {tiendas.length > 0 ? (
              <FiltroEmpresa
                empresas={tiendas}
                valor={pestana === 'contrarreembolsos' ? empresaContrarreembolsos : empresaTerminales}
                onCambiar={(nuevo) => {
                  // Cada sub-pestaña tiene su filtro: el de contrarreembolsos sigue a la empresa
                  // activa y el de terminales es el propio de MSF-139.
                  if (pestana === 'contrarreembolsos') elegirEmpresaContrarreembolsos(nuevo)
                  else setEmpresaTerminales(nuevo)
                }}
                textoAyuda="Por defecto se ven todas; si elegís una empresa en la barra superior, se filtra por esa tienda."
              />
            ) : null}
          </BarraHerramientas>

          <Stack direction="row" spacing={2} alignItems="center" useFlexGap flexWrap="wrap">
            <Tabs
              value={pestana}
              onChange={(_, valor: Pestana) => setPestana(valor)}
              aria-label="Transportes y contrarreembolsos"
              variant="scrollable"
              scrollButtons="auto"
              allowScrollButtonsMobile
            >
              {PESTANAS.map((p) => (
                <Tab
                  key={p.valor}
                  value={p.valor}
                  label={p.etiqueta}
                  id={`transportes-tab-${p.valor}`}
                  aria-controls={p.valor === pestana ? `transportes-panel-${p.valor}` : undefined}
                />
              ))}
            </Tabs>
            <Typography variant="s" color="text.secondary">{pestanaActual.ayuda}</Typography>
          </Stack>

          <Box
            role="tabpanel"
            id={`transportes-panel-${pestana}`}
            aria-labelledby={`transportes-tab-${pestana}`}
          >
            {pestana === 'contrarreembolsos' ? (
              <Stack spacing={2}>
                <Box role="status" aria-live="polite" sx={visuallyHidden}>
                  {isLoadingContrarreembolsos || errorContrarreembolsos !== null
                    ? ''
                    : `${contrarreembolsos.total} ${contrarreembolsos.total === 1 ? 'contrarreembolso' : 'contrarreembolsos'}`}
                </Box>
                <ContrarreembolsosTarjetas
                  resumen={resumen}
                  cargando={isLoadingContrarreembolsos}
                />
                <ContrarreembolsosTabla
                  contrarreembolsos={contrarreembolsos.contrarreembolsos}
                  total={contrarreembolsos.total}
                  pagina={paginaContrarreembolsos}
                  tamanoPagina={TAMANO_PAGINA_CONTRARREEMBOLSOS}
                  cargando={isLoadingContrarreembolsos}
                  actualizando={actualizandoContrarreembolsos}
                  error={errorContrarreembolsos}
                  hayFiltro={hayFiltroContrarreembolsos}
                  empresasConPermiso={empresasConPermiso}
                  onRecargar={() => void cargarContrarreembolsos()}
                  onCambiarPagina={setPaginaContrarreembolsos}
                />
              </Stack>
            ) : (
              <Stack spacing={2}>
                <BarraHerramientas
                  contador={isLoading || hayError ? undefined : `${total} de ${totalOrganizacion} empresas de transporte`}
                />
                <Box role="status" aria-live="polite" sx={visuallyHidden}>
                  {isLoading || hayError ? '' : `${total} ${total === 1 ? 'resultado' : 'resultados'}`}
                </Box>
                {isFetching && !isLoading ? <LinearProgress aria-label="Actualizando transportes" sx={{ height: ALTO_BARRA_CARGA }} /> : null}

                <Box aria-busy={isFetching}>
                  {isLoading ? (
                    <EstadoCargaPagina />
                  ) : hayError ? (
                    <EstadoError descripcion="No pudimos cargar los transportes." reintentar={() => void cargar()} />
                  ) : transportes.length === 0 && paginaTerminales === 1 ? (
                    hayFiltroTerminales ? (
                      <EstadoVacio titulo="Sin resultados" descripcion="Ninguna empresa de transporte se usa en esa tienda." />
                    ) : (
                      <EstadoVacio
                        titulo="Todavía no hay empresas de transporte cargadas."
                        descripcion={puedeEditar ? 'Cargá la primera para empezar.' : undefined}
                        accion={botonNueva}
                      />
                    )
                  ) : (
                    <>
                      <ContenidoAdaptable
                        items={transportes}
                        columnas={columnas}
                        obtenerClave={(transporte) => transporte.id}
                        etiquetaTabla="Transportes"
                        acciones={puedeEditar ? (transporte) => (
                          <Button
                            aria-label={`Editar ${transporte.nombre}`}
                            size="small"
                            variant="outlined"
                            onClick={() => { setGuardado(false); setEditando(transporte) }}
                          >
                            Editar
                          </Button>
                        ) : undefined}
                      />
                      {transportes.length > 0 ? <TablePagination
                        component="div"
                        count={total}
                        page={paginaTerminales - 1}
                        rowsPerPage={TAMANO_PAGINA}
                        rowsPerPageOptions={[TAMANO_PAGINA]}
                        onPageChange={(_, nueva) => setPaginaTerminales(nueva + 1)}
                        labelRowsPerPage="Empresas por página"
                        labelDisplayedRows={({ from, to, count }) => `${from}–${to} de ${count}`}
                      /> : null}
                    </>
                  )}
                </Box>
              </Stack>
            )}
          </Box>
        </Stack>
      </ContenedorSeccion>

      {puedeEditar ? (
        <>
          <TransporteDialog
            open={creando}
            onCerrar={() => setCreando(false)}
            onGuardado={() => {
              setCreando(false)
              setGuardado(true)
              setPaginaTerminales(1)
              void cargar()
            }}
          />
          {editando ? (
            <TransporteDialog
              open
              transporte={editando}
              onCerrar={() => setEditando(null)}
              onGuardado={() => {
                setEditando(null)
                setGuardado(true)
                void cargar()
              }}
              onRecargar={() => { setEditando(null); void cargar() }}
            />
          ) : null}
        </>
      ) : null}
    </Box>
  )
}
