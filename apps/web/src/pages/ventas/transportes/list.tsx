import { useCallback, useEffect, useRef, useState } from 'react'
import { Box, Button, Chip, LinearProgress, Stack, Tab, TablePagination, Tabs, Typography } from '@mui/material'
import { useEmpresas } from '../../../hooks/useEmpresas'
import { useOrganizacionActiva } from '../../../hooks/useOrganizacionActiva'
import { usePuedeEscribir } from '../../../hooks/usePuedeEscribir'
import { listarTransportes, etiquetaTipo, type PaginaTransportes, type Transporte } from '../../../lib/ventas/transportes'
import { TransporteDialog } from '../../../components/ventas/TransporteDialog'
import { EstadoCargaPagina, EstadoError, EstadoExito, EstadoVacio } from '../../../components/estados/EstadosPagina'
import { EtiquetaEstado } from '../../../components/base/EtiquetaEstado'
import { EncabezadoPagina } from '../../../components/pagina/EncabezadoPagina'
import { ContenedorSeccion } from '../../../components/pagina/ContenedorSeccion'
import { ContenidoAdaptable, type ColumnaAdaptable } from '../../../components/pagina/ContenidoAdaptable'
import { BarraHerramientas } from '../../../components/pagina/BarraHerramientas'
import { ContextoOrganizacionActiva } from '../../../components/pagina/ContextoOrganizacionActiva'
import { FiltroEmpresa } from '../../../components/pagina/FiltroEmpresa'

const TAMANO_PAGINA = 25
// Barra de progreso indeterminada: alto fino propio del componente, no un valor del sistema.
const ALTO_BARRA_CARGA = 2
const visuallyHidden = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' } as const // estilos-sueltos: ok: oculta visualmente sin quitar del lector

const PAGINA_VACIA: PaginaTransportes = { transportes: [], total: 0, totalOrganizacion: 0 }

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
  const { empresas: tiendas } = useEmpresas()
  const [empresaId, setEmpresaId] = useState('')
  const [pagina, setPagina] = useState(1)
  const [pestana, setPestana] = useState<Pestana>('contrarreembolsos')
  const [datos, setDatos] = useState<PaginaTransportes>(PAGINA_VACIA)
  const [cargando, setCargando] = useState(true)
  const [hayError, setHayError] = useState(false)
  // Organización para la que llegó la última respuesta (undefined = ninguna).
  const [respondidaPara, setRespondidaPara] = useState<string | null | undefined>(undefined)
  const [creando, setCreando] = useState(false)
  const [editando, setEditando] = useState<Transporte | null>(null)
  const [guardado, setGuardado] = useState(false)
  const ultimaPeticion = useRef(0)

  // «Última petición gana»: una respuesta vieja no pisa a la nueva.
  const cargar = useCallback(async () => {
    const peticion = ++ultimaPeticion.current
    setCargando(true)
    try {
      const resultado = await listarTransportes({ empresaId: empresaId || null, pagina, tamano: TAMANO_PAGINA })
      if (peticion !== ultimaPeticion.current) return
      setDatos(resultado)
      setHayError(false)
    } catch (error) {
      if (peticion !== ultimaPeticion.current) return
      console.error('No pudimos listar los transportes.', error)
      setDatos(PAGINA_VACIA)
      setHayError(true)
    }
    setCargando(false)
    setRespondidaPara(organizacionId)
    // organizacionId solo dispara la recarga; RLS resuelve la organización.
  }, [empresaId, pagina, organizacionId])

  // El catálogo de transportes se pide solo cuando su pestaña está a la vista.
  useEffect(() => {
    if (pestana !== 'terminales') return
    void cargar()
  }, [cargar, pestana])

  const { transportes, total, totalOrganizacion } = datos
  const isLoading = respondidaPara === undefined || respondidaPara !== organizacionId
  const isFetching = cargando

  // Página fuera de rango (p. ej. se cambió el filtro estando en la última página): vuelve a la primera.
  useEffect(() => {
    if (!isLoading && !isFetching && !hayError && transportes.length === 0 && pagina > 1) setPagina(1)
  }, [isLoading, isFetching, hayError, transportes.length, pagina])

  const hayFiltro = empresaId !== ''
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
                valor={empresaId === '' ? null : empresaId}
                onCambiar={(nuevo) => { setEmpresaId(nuevo ?? ''); setPagina(1) }}
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
              // La tabla de contrarreembolsos (columnas, «Marcar cobrado» y las tarjetas) la arma la
              // tarea siguiente de F-VTA-14; la pestaña y su ayuda ya son de esta.
              <Box />
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
                  ) : transportes.length === 0 && pagina === 1 ? (
                    hayFiltro ? (
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
                        page={pagina - 1}
                        rowsPerPage={TAMANO_PAGINA}
                        rowsPerPageOptions={[TAMANO_PAGINA]}
                        onPageChange={(_, nueva) => setPagina(nueva + 1)}
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
              setPagina(1)
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
