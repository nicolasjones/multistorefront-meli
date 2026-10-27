import { useEffect, useRef, useState } from 'react'
import { Box, LinearProgress, Stack, TablePagination, Typography } from '@mui/material'
import { Link as RouterLink } from 'react-router'
import { useFiltroPorEmpresaActiva } from '../../hooks/useFiltroPorEmpresaActiva'
import { useListarFaltantes } from '../../hooks/useListarFaltantes'
import { formatearCuando } from '../../lib/actividad'
import {
  type FaltanteVenta,
  estadoStockHoy,
  unidadesDisponibles,
  unidadesFaltantes,
} from '../../lib/ventasFaltantes'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../../components/estados/EstadosPagina'
import { EtiquetaEstado } from '../../components/base/EtiquetaEstado'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { ContenedorSeccion } from '../../components/pagina/ContenedorSeccion'
import { ContenidoAdaptable, type ColumnaAdaptable } from '../../components/pagina/ContenidoAdaptable'
import { BarraHerramientas } from '../../components/pagina/BarraHerramientas'
import { ContextoOrganizacionActiva } from '../../components/pagina/ContextoOrganizacionActiva'
import { FiltroEmpresa } from '../../components/pagina/FiltroEmpresa'

const TAMANO_PAGINA = 10
// Barra de progreso indeterminada: alto fino propio del componente, no un valor del sistema.
const ALTO_BARRA_CARGA = 2

// Texto de ayuda del filtro de tienda: el del prototipo («VentasFaltantes»).
const AYUDA_FILTRO_TIENDA =
  'Por defecto se ven todas; si elegís una empresa en la barra superior, se filtra por esa tienda.'

const columnas: ColumnaAdaptable<FaltanteVenta>[] = [
  { clave: 'empresa', encabezado: 'Tienda', render: (faltante) => <EtiquetaEstado texto={faltante.empresa} variante="contorno" /> },
  {
    clave: 'cliente',
    encabezado: 'Cliente',
    render: (faltante) => <Typography component="span" sx={{ fontWeight: 600 }}>{faltante.cliente}</Typography>,
  },
  {
    clave: 'producto',
    encabezado: 'Producto',
    render: (faltante) => (
      <Stack spacing={0}>
        <Typography component="span" sx={{ fontWeight: 600 }}>{faltante.producto}</Typography>
        <Typography component="span" variant="caption" color="text.secondary">{faltante.sku ?? '—'}</Typography>
      </Stack>
    ),
  },
  {
    clave: 'pedido',
    encabezado: 'Pedido',
    align: 'right',
    render: (faltante) => (
      <Typography component="span" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
        {unidadesFaltantes(faltante.cantidad_faltante)}
      </Typography>
    ),
  },
  {
    clave: 'comprobante',
    encabezado: 'Comprobante',
    render: (faltante) => (
      <Typography
        component={RouterLink}
        to={`/ventas/comprobantes/${faltante.comprobante_id}`}
        sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}
      >
        {faltante.comprobante}
      </Typography>
    ),
  },
  { clave: 'desde', encabezado: 'Desde', render: (faltante) => formatearCuando(faltante.desde) },
  {
    clave: 'stock',
    encabezado: 'Stock hoy',
    render: (faltante) => {
      const estado = estadoStockHoy(faltante.stock_estado)
      return (
        <Stack spacing={0} alignItems="flex-start">
          <EtiquetaEstado texto={estado.texto} variante={estado.variante} />
          <Typography component="span" variant="caption" color="text.secondary">
            {unidadesDisponibles(faltante.stock_disponible)}
          </Typography>
        </Stack>
      )
    },
  },
]

// Pantalla «Ventas · Faltantes» (F-VTA-18, FR-044 y FR-046). Solo lectura: los faltantes abiertos los
// registra el despacho (F-VTA-18, FR-047) desde el comprobante. La autoridad es la base
// (`listar_faltantes`: las empresas donde la persona tiene Ventas al menos en lectura); la pantalla
// solo acota por tienda y pagina. La tienda sigue a la empresa activa de la barra superior.
export function FaltantesList() {
  const {
    empresas,
    valor: empresaId,
    empresaActivaId,
    cambiar: elegirEmpresa,
    cargando: cargandoTiendas,
    hayError: errorTiendas,
  } = useFiltroPorEmpresaActiva()
  const [pagina, setPagina] = useState(1)

  const { faltantes, total, isLoading, isFetching, isError, refetch } = useListarFaltantes({
    empresaId,
    pagina,
    tamano: TAMANO_PAGINA,
  })

  // Cambio de empresa activa (Principio VIII, FR-046): la pantalla se reencuadra. El filtro sigue a la
  // empresa activa, así que la consulta ya se recarga sola; lo que falta es volver a la primera página
  // para no mostrar una página vacía de la empresa anterior.
  const empresaAlAbrir = useRef<string | null | undefined>(undefined)
  useEffect(() => {
    if (empresaAlAbrir.current === undefined) {
      empresaAlAbrir.current = empresaActivaId
      return
    }
    if (empresaAlAbrir.current === empresaActivaId) return
    empresaAlAbrir.current = empresaActivaId
    setPagina(1)
  }, [empresaActivaId])

  // Página fuera de rango (p. ej. se resolvió el último faltante de la última página): vuelve a la primera.
  useEffect(() => {
    if (!isLoading && !isFetching && !isError && faltantes.length === 0 && pagina > 1) setPagina(1)
  }, [isLoading, isFetching, isError, faltantes.length, pagina])

  return (
    <Box>
      <EncabezadoPagina
        titulo="Faltantes"
        descripcion="Líneas vendidas o pedidas sin stock."
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

          <BarraHerramientas
            contador={isLoading || isError ? undefined : `${total} ${total === 1 ? 'faltante' : 'faltantes'}`}
          />

          {isFetching && !isLoading ? <LinearProgress aria-label="Actualizando los faltantes" sx={{ height: ALTO_BARRA_CARGA }} /> : null}

          <Box aria-busy={isFetching}>
            {isLoading ? (
              <EstadoCargaPagina />
            ) : isError ? (
              <EstadoError descripcion="No pudimos cargar los faltantes." reintentar={() => void refetch()} />
            ) : faltantes.length === 0 ? (
              <EstadoVacio
                titulo="Sin resultados"
                descripcion="No hay faltantes abiertos en las tiendas que podés ver."
              />
            ) : (
              <>
                <ContenidoAdaptable
                  items={faltantes}
                  columnas={columnas}
                  obtenerClave={(faltante) => faltante.id}
                  etiquetaTabla="Faltantes"
                />
                <TablePagination
                  component="div"
                  count={total}
                  page={pagina - 1}
                  rowsPerPage={TAMANO_PAGINA}
                  rowsPerPageOptions={[TAMANO_PAGINA]}
                  onPageChange={(_, nueva) => setPagina(nueva + 1)}
                  labelRowsPerPage="Faltantes por página"
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
