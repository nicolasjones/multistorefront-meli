import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link as RouterLink } from 'react-router'
import { Box, Button, Chip, MenuItem, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import { TarjetaBase } from '../../../components/base/TarjetaBase'
import { CargaInfinita } from '../../../components/pagina/CargaInfinita'
import { ContenidoAdaptable, type ColumnaAdaptable } from '../../../components/pagina/ContenidoAdaptable'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../../../components/estados/EstadosPagina'
import { ExportarCsvBoton } from '../../../components/stock/ExportarCsvBoton'
import { useListadoAcumulado } from '../../../hooks/useListadoAcumulado'
import { useExportarCsv } from '../../../hooks/useExportarCsv'
import { useMovimientosPorProducto } from '../../../hooks/useMovimientosPorProducto'
import { usePuedeAccion } from '../../../hooks/usePuedeAccion'
import { armarArbol, filtrarArbolPorTienda, leerCategorias, opcionesCategoriaProducto, type Categoria } from '../../../lib/categorias'
import { nombreArchivoCsv, type ColumnaCsv } from '../../../lib/exportarCsv'
import {
  ETIQUETA_ESTADO_MOVIMIENTO, FILTROS_MOVIMIENTOS_INICIALES, ORDENES_MOVIMIENTOS, TAMANO_LOTE_EXPORTACION, VISTAS_MOVIMIENTOS,
  formatoAjuste, formatoDia, leerMovimientosPorProducto,
  type ClaveOrdenMovimientos, type ContextoTablero, type EstadoMovimiento, type FiltrosMovimientos, type MovimientoProducto, type VistaMovimientos,
} from '../../../lib/inicioBloques'
import { formatoEntero } from '../../../lib/inicioTablero'
import { supabaseClient } from '../../../lib/supabase'
import { useLecturaInicio } from '../useLecturaInicio'

const DEMORA_BUSQUEDA_MS = 300
// Igual que el tope de la RPC (`left(…, 100)`): no se mandan textos enormes al servidor.
const LARGO_MAXIMO_BUSQUEDA = 100
const TODAS = ''
const COLOR_ESTADO: Record<EstadoMovimiento, 'error' | 'default' | 'success'> = { alerta: 'error', quieto: 'default', normal: 'success' }

type Props = { contexto: ContextoTablero; verVentas?: boolean }

const claveDeFila = (fila: MovimientoProducto) => fila.productoId

// «Movimientos por producto» (F-INI-06, MSF-822): una fila por producto con 12 columnas ordenables, vistas
// rápidas, búsqueda, categoría y orden en el SERVIDOR (llega por tandas con carga infinita, nunca paginado).
// Respeta Período, Tienda y Depósito del tablero. No muestra costo ni margen. «Exportar» baja por lotes lo mismo
// que se ve (mismos filtros); el rol sin permiso de exportar no ve el botón.
export function MovimientosPorProducto({ contexto, verVentas = true }: Props) {
  const [filtros, setFiltros] = useState<FiltrosMovimientos>(FILTROS_MOVIMIENTOS_INICIALES)
  const [busqueda, setBusqueda] = useState('')
  const [pagina, setPagina] = useState(1)
  const puedeExportar = usePuedeAccion('stock', 'exportar').puede === true
  const { desde, hasta, empresaId, depositoId } = contexto

  // La búsqueda espera un instante a que termine de escribir (y solo reinicia la lista si cambió el texto).
  useEffect(() => {
    const espera = setTimeout(() => {
      setFiltros((anteriores) => (anteriores.busqueda === busqueda ? anteriores : { ...anteriores, busqueda }))
    }, DEMORA_BUSQUEDA_MS)
    return () => clearTimeout(espera)
  }, [busqueda])

  // Categorías de la tienda elegida (CA-INI-06-11): el menú muestra solo las visibles en esa tienda.
  const leerMenu = useCallback(async () => (await leerCategorias(supabaseClient)).categorias, [])
  const categorias = useLecturaInicio<Categoria[]>(leerMenu)
  const opciones = useMemo(
    () => opcionesCategoriaProducto(filtrarArbolPorTienda(armarArbol(categorias.datos ?? []), empresaId)),
    [categorias.datos, empresaId],
  )
  // Si la categoría elegida deja de ser visible al cambiar de tienda, deja de aplicarse (se deriva, sin efecto).
  const categoriaVigente = filtros.categoriaId !== null && (categorias.datos === null || opciones.some((opcion) => opcion.id === filtros.categoriaId))
    ? filtros.categoriaId
    : null
  const filtrosEfectivos = useMemo(() => ({ ...filtros, categoriaId: categoriaVigente }), [filtros, categoriaVigente])

  const cambiar = (cambio: Partial<FiltrosMovimientos>) => setFiltros((anteriores) => ({ ...anteriores, ...cambio }))
  const limpiar = () => {
    setBusqueda('')
    setFiltros(FILTROS_MOVIMIENTOS_INICIALES)
    setPagina(1)
  }

  const { filas, total, isLoading, isError, refetch } = useMovimientosPorProducto(contexto, filtrosEfectivos, pagina)
  const listado = useListadoAcumulado({
    items: filas, pagina, setPagina, total, cargando: isLoading,
    reinicio: { desde, hasta, empresaId, depositoId, ...filtrosEfectivos },
  })
  const falloTanda = isError && pagina > 1
  // La paginación por offset puede repetir un producto entre tandas si el stock cambia mientras se carga más:
  // se muestra una sola vez (la primera) para no repetir claves en la lista.
  const filasUnicas = useMemo(() => {
    const vistos = new Set<string>()
    return listado.filas.filter((fila) => (vistos.has(fila.productoId) ? false : (vistos.add(fila.productoId), true)))
  }, [listado.filas])
  // Columna «Ventas»: solo con permiso de ventas (`verVentas`, que decide también con la lista vacía o ante el error de
  // la primera tanda). Con permiso, si ya hay filas se muestra salvo que la base devuelva null en toda la columna (rol
  // sin ventas en ninguna de las tiendas elegidas); sin filas todavía, se muestra. Una tanda que falla (página vacía)
  // no cambia la decisión porque se mira lo ya acumulado.
  const conVentas = verVentas && (listado.filas.length === 0 || listado.filas.some((fila) => fila.ventas !== null))

  const columnas = useMemo<ColumnaAdaptable<MovimientoProducto>[]>(() => {
    const lista: ColumnaAdaptable<MovimientoProducto>[] = [
      {
        clave: 'nombre', encabezado: 'Producto', ordenable: true,
        render: (fila) => <Typography component={RouterLink} to={`/productos/${fila.productoId}/edit`} color="primary" sx={{ fontWeight: 600 }}>{fila.nombre}</Typography>,
      },
      { clave: 'sku', encabezado: 'SKU', ordenable: true, render: (fila) => fila.sku ?? '—' },
      { clave: 'categoria', encabezado: 'Categoría', ordenable: true, render: (fila) => fila.categoria },
      { clave: 'stock_inicial', encabezado: 'Stock inicial', ordenable: true, align: 'right', render: (fila) => formatoEntero(fila.stockInicial) },
      { clave: 'entradas', encabezado: 'Entradas', ordenable: true, align: 'right', render: (fila) => formatoEntero(fila.entradas) },
      { clave: 'salidas', encabezado: 'Salidas', ordenable: true, align: 'right', render: (fila) => formatoEntero(fila.salidas) },
      { clave: 'ajustes', encabezado: 'Ajustes', ordenable: true, align: 'right', render: (fila) => formatoAjuste(fila.ajustes) },
      { clave: 'stock_actual', encabezado: 'Stock actual', ordenable: true, align: 'right', render: (fila) => formatoEntero(fila.stockActual) },
      { clave: 'minimo', encabezado: 'Mínimo', ordenable: true, align: 'right', render: (fila) => formatoEntero(fila.minimo) },
    ]
    if (conVentas) lista.push({ clave: 'ventas', encabezado: 'Ventas', ordenable: true, align: 'right', render: (fila) => (fila.ventas === null ? '—' : formatoEntero(fila.ventas)) })
    lista.push(
      { clave: 'ultimo_movimiento', encabezado: 'Último movimiento', ordenable: true, render: (fila) => formatoDia(fila.ultimoMovimiento) },
      { clave: 'estado', encabezado: 'Estado', ordenable: true, render: (fila) => <Chip size="small" color={COLOR_ESTADO[fila.estado]} label={ETIQUETA_ESTADO_MOVIMIENTO[fila.estado]} /> },
    )
    return lista
  }, [conVentas])

  // Exportación: mismos filtros que la pantalla, por lotes de la RPC (la misma consulta, sin paginar en pantalla).
  const columnasCsv = useMemo<ColumnaCsv<MovimientoProducto>[]>(() => [
    { encabezado: 'Producto', valor: (fila) => fila.nombre },
    { encabezado: 'SKU', valor: (fila) => fila.sku },
    { encabezado: 'Categoría', valor: (fila) => fila.categoria },
    { encabezado: 'Stock inicial', valor: (fila) => fila.stockInicial },
    { encabezado: 'Entradas', valor: (fila) => fila.entradas },
    { encabezado: 'Salidas', valor: (fila) => fila.salidas },
    { encabezado: 'Ajustes', valor: (fila) => fila.ajustes },
    { encabezado: 'Stock actual', valor: (fila) => fila.stockActual },
    { encabezado: 'Mínimo', valor: (fila) => fila.minimo },
    ...(conVentas ? [{ encabezado: 'Ventas', valor: (fila: MovimientoProducto) => fila.ventas }] : []),
    { encabezado: 'Último movimiento', valor: (fila) => fila.ultimoMovimiento },
    { encabezado: 'Estado', valor: (fila) => ETIQUETA_ESTADO_MOVIMIENTO[fila.estado] },
  ], [conVentas])
  const pedirLote = useCallback(async (desdeFila: number, limite: number) => {
    // `useExportarCsv` pide siempre lotes de `tamanoLote` (= `limite`) desde un múltiplo de ese tamaño: cada lote es una
    // página exacta de la RPC y nunca se pide una página que la RPC deba acotar.
    const pagina = Math.floor(desdeFila / limite) + 1
    return (await leerMovimientosPorProducto({ desde, hasta, empresaId, depositoId }, filtrosEfectivos, pagina, limite)).filas
  }, [desde, hasta, empresaId, depositoId, filtrosEfectivos])
  const nombreArchivo = useCallback(() => nombreArchivoCsv('movimientos-por-producto'), [])
  const exportacion = useExportarCsv({ columnas: columnasCsv, nombreArchivo, tamanoLote: TAMANO_LOTE_EXPORTACION, pedirLote, clave: claveDeFila })

  const hayFiltros = filtros.busqueda !== '' || categoriaVigente !== null || filtros.vista !== 'todos'
  const alOrdenar = (clave: string) => {
    const nueva = clave as ClaveOrdenMovimientos
    cambiar(filtros.orden === nueva ? { direccion: filtros.direccion === 'asc' ? 'desc' : 'asc' } : { orden: nueva, direccion: 'asc' })
  }

  return (
    <TarjetaBase titulo="Movimientos por producto">
      <Stack spacing={2}>
        <Stack
          component="form" role="search" aria-label="Filtros de movimientos por producto"
          onSubmit={(evento) => evento.preventDefault()}
          direction={{ xs: 'column', md: 'row' }} sx={{ flexWrap: 'wrap', gap: 2, alignItems: { md: 'center' } }}
        >
          <ToggleButtonGroup
            exclusive size="small" aria-label="Vistas rápidas" value={filtros.vista}
            onChange={(_, vista: VistaMovimientos | null) => { if (vista) cambiar({ vista }) }}
          >
            {VISTAS_MOVIMIENTOS.map((vista) => <ToggleButton key={vista.valor} value={vista.valor}>{vista.etiqueta}</ToggleButton>)}
          </ToggleButtonGroup>
          <TextField label="Buscar producto o SKU" type="search" size="small" value={busqueda} slotProps={{ htmlInput: { maxLength: LARGO_MAXIMO_BUSQUEDA } }} onChange={(evento) => setBusqueda(evento.target.value)} sx={{ minWidth: { md: 240 } }} />
          <TextField
            select label="Categoría" size="small" value={categoriaVigente ?? TODAS}
            onChange={(evento) => cambiar({ categoriaId: evento.target.value === TODAS ? null : evento.target.value })}
            sx={{ minWidth: { md: 220 } }}
          >
            <MenuItem value={TODAS}>Todas las categorías</MenuItem>
            {opciones.map((opcion) => <MenuItem key={opcion.id} value={opcion.id} sx={{ pl: opcion.nivel === 1 ? 4 : 2 }}>{opcion.ruta}</MenuItem>)}
          </TextField>
          <TextField
            select label="Ordenar por" size="small" value={filtros.orden}
            onChange={(evento) => cambiar({ orden: evento.target.value as ClaveOrdenMovimientos })}
            sx={{ minWidth: { md: 200 } }}
          >
            {ORDENES_MOVIMIENTOS.filter((orden) => orden.valor !== 'ventas' || conVentas).map((orden) => <MenuItem key={orden.valor} value={orden.valor}>{orden.etiqueta}</MenuItem>)}
          </TextField>
          <Button variant="outlined" size="small" onClick={() => cambiar({ direccion: filtros.direccion === 'asc' ? 'desc' : 'asc' })}>
            {filtros.direccion === 'asc' ? '↑ Ascendente' : '↓ Descendente'}
          </Button>
          {puedeExportar ? <ExportarCsvBoton {...exportacion} /> : null}
        </Stack>

        {isLoading && pagina === 1 && listado.filas.length === 0 ? (
          <EstadoCargaPagina />
        ) : isError && !falloTanda ? (
          <EstadoError titulo="No pudimos cargar los movimientos por producto." reintentar={() => void refetch()} />
        ) : filasUnicas.length === 0 ? (
          <EstadoVacio
            titulo="Sin movimientos para estos filtros"
            descripcion={hayFiltros ? 'Probá con otra búsqueda o cambiá los filtros.' : 'No hay productos activos para mostrar.'}
            accion={hayFiltros ? <Button color="inherit" onClick={limpiar}>Limpiar filtros</Button> : undefined}
          />
        ) : (
          <Box>
            <Typography variant="body2" color="text.secondary" role="status" sx={{ mb: 1 }}>
              Mostrando {formatoEntero(filasUnicas.length)} de {formatoEntero(total)} {total === 1 ? 'producto' : 'productos'}
            </Typography>
            <ContenidoAdaptable
              items={filasUnicas}
              columnas={columnas}
              obtenerClave={(fila) => fila.productoId}
              etiquetaTabla="Movimientos por producto"
              orden={{ clave: filtros.orden, direccion: filtros.direccion }}
              alOrdenar={alOrdenar}
            />
            <CargaInfinita hayMas={listado.hayMas} cargando={listado.cargandoMas} hayError={falloTanda} onCargarMas={falloTanda ? () => void refetch() : listado.cargarMas} />
          </Box>
        )}
      </Stack>
    </TarjetaBase>
  )
}
