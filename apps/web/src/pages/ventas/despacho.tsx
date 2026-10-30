import { useEffect, useState } from 'react'
import { Box, Button, LinearProgress, Link, Stack, TablePagination, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import { Link as RouterLink } from 'react-router'
import { useFiltroPorEmpresaActiva } from '../../hooks/useFiltroPorEmpresaActiva'
import { useListarDespacho } from '../../hooks/useListarDespacho'
import { ESTADOS_DESPACHO, ETIQUETA_ESTADO_DESPACHO, type EstadoDespacho } from '../../lib/ventasDespacho'
import { VARIANTE_ESTADO_DESPACHO, type FilaDespacho } from '../../lib/ventasDespachoLista'
import { formatearFecha } from '../../lib/formatoHistorial'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../../components/estados/EstadosPagina'
import { EtiquetaEstado } from '../../components/base/EtiquetaEstado'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { ContenedorSeccion } from '../../components/pagina/ContenedorSeccion'
import { ContenidoAdaptable, type ColumnaAdaptable } from '../../components/pagina/ContenidoAdaptable'
import { BarraHerramientas } from '../../components/pagina/BarraHerramientas'
import { ContextoOrganizacionActiva } from '../../components/pagina/ContextoOrganizacionActiva'
import { FiltroEmpresa } from '../../components/pagina/FiltroEmpresa'

const TAMANO_PAGINA = 10
const ESPERA_BUSQUEDA_MS = 300
// Barra de progreso indeterminada: alto fino propio del componente, no un valor del sistema.
const ALTO_BARRA_CARGA = 2
const visuallyHidden = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' } as const // estilos-sueltos: ok: oculta visualmente sin quitar del lector

const AYUDA_FILTRO_TIENDA =
  'Por defecto se ven todas; si elegís una empresa en la barra superior, se filtra por esa tienda.'

const SIN_DATO = '—'

const columnas: ColumnaAdaptable<FilaDespacho>[] = [
  {
    clave: 'numero',
    encabezado: 'Comprobante',
    render: (fila) => (
      <Link
        component={RouterLink}
        to={`/ventas/comprobantes/${fila.id}`}
        underline="hover"
        sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}
      >
        {fila.numero}
      </Link>
    ),
  },
  { clave: 'tienda', encabezado: 'Tienda', render: (fila) => <EtiquetaEstado texto={fila.empresa} variante="contorno" /> },
  { clave: 'fecha', encabezado: 'Fecha', render: (fila) => <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatearFecha(fila.fecha)}</span> },
  { clave: 'cliente', encabezado: 'Cliente', render: (fila) => <Typography component="span" sx={{ fontWeight: 600 }}>{fila.cliente}</Typography> },
  {
    clave: 'estado',
    encabezado: 'Estado',
    render: (fila) => (
      <EtiquetaEstado texto={ETIQUETA_ESTADO_DESPACHO[fila.estado_despacho]} variante={VARIANTE_ESTADO_DESPACHO[fila.estado_despacho]} />
    ),
  },
  {
    clave: 'responsables',
    encabezado: 'Responsables',
    render: (fila) => (
      <Stack spacing={0}>
        {([['Armó', fila.armo], ['Controló', fila.controlo], ['Entregó', fila.entrego]] as const).map(([rotulo, nombre]) => (
          <Typography key={rotulo} component="span" variant="caption" color="text.secondary">
            {rotulo}: {nombre ?? SIN_DATO}
          </Typography>
        ))}
      </Stack>
    ),
  },
  {
    clave: 'envio',
    encabezado: 'Transporte y guía',
    render: (fila) =>
      fila.transporte ? (
        <Stack spacing={0}>
          <Typography component="span" sx={{ fontWeight: 600 }}>{fila.transporte}</Typography>
          <Typography component="span" variant="caption" color="text.secondary">
            {fila.guia ?? 'Sin guía'}
            {fila.fecha_envio ? ` · ${formatearFecha(fila.fecha_envio)}` : ''}
          </Typography>
        </Stack>
      ) : (
        SIN_DATO
      ),
  },
]

// Pantalla «Ventas · Despacho» (F-VTA-17, FR-031 y FR-033). Sin artboard en el prototipo: se arma con el kit.
// Solo lectura: avanzar el despacho se hace desde el comprobante (cada fila lo abre). La autoridad es la base
// (`listar_despacho`: las tiendas donde la persona tiene Ventas al menos en lectura); la pantalla acota por
// tienda, estado y búsqueda y pagina. La tienda sigue a la empresa activa de la barra superior.
export function DespachoList() {
  const {
    empresas,
    valor: empresaId,
    cambiar: elegirEmpresa,
    cargando: cargandoTiendas,
    hayError: errorTiendas,
  } = useFiltroPorEmpresaActiva()
  const [pagina, setPagina] = useState(1)
  const [texto, setTexto] = useState('')
  const [busqueda, setBusqueda] = useState('')
  const [estado, setEstado] = useState<EstadoDespacho | null>(null)

  // La búsqueda espera a que se deje de tipear y vuelve a la primera página.
  useEffect(() => {
    if (texto === busqueda) return
    const espera = setTimeout(() => {
      setBusqueda(texto)
      setPagina(1)
    }, ESPERA_BUSQUEDA_MS)
    return () => clearTimeout(espera)
  }, [texto, busqueda])

  const { ambito, filas, total, conteos, isLoading, isFetching, isError, refetch } = useListarDespacho({
    busqueda,
    estado,
    empresaId,
    pagina,
    tamano: TAMANO_PAGINA,
  })

  // Cambió el ámbito (organización + tienda): la pantalla se reencuadra (Principio VIII, FR-033). Se ajusta en
  // el MISMO render —no en un efecto— para que la paginación vuelva a la primera página sin pedir la que ya no
  // correspondía; el hook ata cada lectura a su ámbito y descarta lo que llegó de otra tienda.
  const [ambitoVisto, setAmbitoVisto] = useState(ambito)
  if (ambito !== ambitoVisto) {
    setAmbitoVisto(ambito)
    setPagina(1)
  }

  // Página fuera de rango (p. ej. se filtró estando en la última página): vuelve a la primera.
  if (!isLoading && !isFetching && !isError && filas.length === 0 && pagina > 1) setPagina(1)

  const hayFiltros = busqueda.trim() !== '' || estado !== null
  const totalTablero = ESTADOS_DESPACHO.reduce((suma, e) => suma + conteos[e], 0)

  return (
    <Box>
      <EncabezadoPagina
        titulo="Despacho"
        descripcion="Facturas por armar, controlar y entregar."
        contexto={<ContextoOrganizacionActiva />}
      />
      <ContenedorSeccion>
        <Stack spacing={2}>
          <FiltroEmpresa
            empresas={empresas}
            valor={empresaId}
            onCambiar={(nuevo) => {
              elegirEmpresa(nuevo)
              setPagina(1)
            }}
            cargando={cargandoTiendas}
            hayError={errorTiendas}
            textoAyuda={AYUDA_FILTRO_TIENDA}
          />

          <BarraHerramientas contador={isLoading || isError ? undefined : `${total} ${total === 1 ? 'factura' : 'facturas'}`}>
            <TextField
              type="search"
              label="Buscar por cliente o número"
              value={texto}
              onChange={(evento) => setTexto(evento.target.value)}
              size="small"
              sx={{ width: 280, maxWidth: '100%' }}
              slotProps={{ htmlInput: { maxLength: 80 } }}
            />
            <ToggleButtonGroup
              exclusive
              size="small"
              aria-label="Filtrar por estado"
              value={estado ?? 'todos'}
              onChange={(_, valor: EstadoDespacho | 'todos' | null) => {
                if (valor === null) return
                setEstado(valor === 'todos' ? null : valor)
                setPagina(1)
              }}
              sx={{ flexWrap: 'wrap' }}
            >
              <ToggleButton value="todos">{`Todos (${totalTablero})`}</ToggleButton>
              {ESTADOS_DESPACHO.map((e) => (
                <ToggleButton key={e} value={e}>{`${ETIQUETA_ESTADO_DESPACHO[e]} (${conteos[e]})`}</ToggleButton>
              ))}
            </ToggleButtonGroup>
            {hayFiltros ? (
              <Button
                size="small"
                variant="text"
                onClick={() => {
                  setTexto('')
                  setBusqueda('')
                  setEstado(null)
                  setPagina(1)
                }}
              >
                Limpiar filtros
              </Button>
            ) : null}
          </BarraHerramientas>

          <Box role="status" aria-live="polite" sx={visuallyHidden}>
            {isLoading || isError ? '' : `${total} ${total === 1 ? 'resultado' : 'resultados'}`}
          </Box>
          {isFetching && !isLoading ? <LinearProgress aria-label="Actualizando el despacho" sx={{ height: ALTO_BARRA_CARGA }} /> : null}

          <Box aria-busy={isFetching}>
            {isLoading ? (
              <EstadoCargaPagina />
            ) : isError ? (
              <EstadoError descripcion="No pudimos cargar el despacho." reintentar={() => void refetch()} />
            ) : filas.length === 0 ? (
              <EstadoVacio
                titulo="Sin resultados"
                descripcion={
                  hayFiltros
                    ? 'Probá con otra búsqueda o limpiá los filtros.'
                    : 'No hay facturas por despachar en las tiendas que podés ver.'
                }
              />
            ) : (
              <>
                <ContenidoAdaptable
                  items={filas}
                  columnas={columnas}
                  obtenerClave={(fila) => fila.id}
                  etiquetaTabla="Despacho"
                />
                <TablePagination
                  component="div"
                  count={total}
                  page={pagina - 1}
                  rowsPerPage={TAMANO_PAGINA}
                  rowsPerPageOptions={[TAMANO_PAGINA]}
                  onPageChange={(_, nueva) => setPagina(nueva + 1)}
                  labelRowsPerPage="Facturas por página"
                  labelDisplayedRows={({ from, to, count }) => `${from}–${to} de ${count}`}
                />
              </>
            )}
          </Box>
        </Stack>
      </ContenedorSeccion>
    </Box>
  )
}
