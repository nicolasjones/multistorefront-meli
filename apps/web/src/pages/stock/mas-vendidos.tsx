import { useState } from 'react'
import { Box, Button, LinearProgress, Stack, TablePagination, TextField, Typography } from '@mui/material'
import { useFiltroPorEmpresaActiva } from '../../hooks/useFiltroPorEmpresaActiva'
import { useMasVendidos } from '../../hooks/useMasVendidos'
import { useOrganizacionActiva } from '../../hooks/useOrganizacionActiva'
import { formatearFecha } from '../../lib/formatoRanking'
import { TAMANO_PAGINA_MAS_VENDIDOS, periodoInicial, type FilaMasVendido } from '../../lib/masVendidos'
import { ATAJOS_PERIODO, rangoDeAtajo, validarRango, type AtajoPeriodo, type ErroresRango, type RangoFechas } from '../../lib/periodosRanking'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../../components/estados/EstadosPagina'
import { BarraHerramientas } from '../../components/pagina/BarraHerramientas'
import { ContenedorSeccion } from '../../components/pagina/ContenedorSeccion'
import { ContenidoAdaptable, type ColumnaAdaptable } from '../../components/pagina/ContenidoAdaptable'
import { ContextoOrganizacionActiva } from '../../components/pagina/ContextoOrganizacionActiva'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { FiltroEmpresa } from '../../components/pagina/FiltroEmpresa'
import { PestanasStock } from './PestanasStock'
import { tokens } from '../../tema/tokens'

// Reporte de productos más vendidos (F-STK-18, MSF-414). No hay pantalla dibujada en el
// prototipo: las columnas, el período y el filtro salen de FR-402…FR-407 (ver la spec de la
// épica, «Reporte de más vendidos»).
//
// QUÉ MUESTRA: las unidades de las líneas de las FACTURAS que cuentan, del período elegido y de
// las tiendas visibles para quien consulta. El orden (unidades descendente y, en empate, el
// nombre) y la posición global los calcula la base (`public.productos_mas_vendidos`): la pantalla
// no reordena ni recalcula nada, solo pagina de a 25.
//
// EMPRESA ACTIVA (Principio VIII, FR-406): el filtro de tienda sigue a la empresa activa de la
// barra superior (`useFiltroPorEmpresaActiva`). Cuando cambia el ámbito —organización, tienda o
// período— la pantalla se reencuadra: vuelve a la primera página y descarta lo anterior, así que
// nunca muestra filas ni totales de la tienda o del período anterior.
const ANCHO_CAMPO_FECHA = 170
const formatoUnidades = new Intl.NumberFormat('es-AR')
// Región viva para el lector de pantalla: anuncia el total sin mostrarlo dos veces.
const visuallyHidden = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' } as const

export function MasVendidosStock() {
  const { empresas, valor: empresaId, cambiar: elegirEmpresa, cargando: cargandoTiendas, hayError: errorTiendas } = useFiltroPorEmpresaActiva()
  const { organizacionActiva } = useOrganizacionActiva()
  const [borrador, setBorrador] = useState<RangoFechas>(() => periodoInicial())
  const [aplicado, setAplicado] = useState<RangoFechas>(borrador)
  const [errores, setErrores] = useState<ErroresRango>({})
  const [pagina, setPagina] = useState(1)

  const { filas, total, isLoading, isFetching, isError, refetch } = useMasVendidos({
    desde: aplicado.desde, hasta: aplicado.hasta, empresaId, pagina, tamano: TAMANO_PAGINA_MAS_VENDIDOS,
  })

  // Reencuadre (FR-406): al cambiar la organización, la tienda o el período, la pantalla vuelve a la
  // primera página. Se ajusta en el MISMO render —no en un efecto— para que no se dibuje ni un
  // cuadro con la paginación del ámbito anterior y para que la consulta nueva salga una sola vez,
  // ya en la página 1.
  const ambito = `${organizacionActiva?.id ?? ''}|${empresaId ?? 'todas'}|${aplicado.desde}|${aplicado.hasta}`
  const [ambitoVisto, setAmbitoVisto] = useState(ambito)
  if (ambito !== ambitoVisto) {
    setAmbitoVisto(ambito)
    setPagina(1)
  }

  const aplicar = (rango: RangoFechas) => {
    const nuevos = validarRango(rango)
    setErrores(nuevos)
    if (Object.keys(nuevos).length > 0) return
    setAplicado(rango)
    setPagina(1)
  }

  const elegirAtajo = (atajo: AtajoPeriodo) => {
    const rango = rangoDeAtajo(atajo)
    setBorrador(rango)
    aplicar(rango)
  }

  const columnas: ColumnaAdaptable<FilaMasVendido>[] = [
    { clave: 'posicion', encabezado: 'Posición', render: (fila) => <Typography variant="b">{fila.posicion}</Typography> },
    {
      clave: 'producto',
      encabezado: 'Producto',
      render: (fila) => (
        <Stack spacing={0}>
          <Typography variant="b" sx={{ fontWeight: tokens.tipografia.pesoEnfasis }}>{fila.nombre}</Typography>
          <Typography variant="xs">{fila.sku ?? '—'}</Typography>
        </Stack>
      ),
    },
    {
      clave: 'unidades',
      encabezado: 'Unidades vendidas',
      align: 'right',
      render: (fila) => <Typography variant="b">{formatoUnidades.format(fila.unidades)}</Typography>,
    },
  ]

  const contenido = () => {
    if (isLoading) return <EstadoCargaPagina />
    if (isError) {
      return <EstadoError descripcion="No pudimos cargar los productos más vendidos." reintentar={() => void refetch()} />
    }
    if (filas.length === 0) {
      return (
        <EstadoVacio
          titulo="No hay ventas en el período"
          descripcion="Probá con otro rango de fechas o con otra tienda."
        />
      )
    }
    return (
      <Box aria-busy={isFetching} sx={{ opacity: isFetching ? 0.5 : 1, transition: 'opacity 150ms' }}>
        <ContenidoAdaptable
          items={filas}
          columnas={columnas}
          obtenerClave={(fila) => fila.producto_id}
          etiquetaTabla="Productos más vendidos"
        />
        <TablePagination
          component="div"
          count={total}
          page={pagina - 1}
          rowsPerPage={TAMANO_PAGINA_MAS_VENDIDOS}
          rowsPerPageOptions={[TAMANO_PAGINA_MAS_VENDIDOS]}
          onPageChange={(_, nueva) => setPagina(nueva + 1)}
          labelRowsPerPage="Productos por página"
          labelDisplayedRows={({ from, to, count }) => `${from}–${to} de ${count}`}
        />
        <Typography variant="xs" component="p" sx={{ mt: 1 }}>
          {`Unidades vendidas del ${formatearFecha(aplicado.desde)} al ${formatearFecha(aplicado.hasta)}. Cuentan las facturas que están en firme; los presupuestos y los borradores no.`}
        </Typography>
      </Box>
    )
  }

  return (
    <Box>
      <EncabezadoPagina
        titulo="Productos más vendidos"
        descripcion="Unidades vendidas por producto en el período, según las facturas que cuentan."
        contexto={<ContextoOrganizacionActiva />}
      />
      <ContenedorSeccion>
        <PestanasStock activa="mas-vendidos" />
        <Stack spacing={2}>
          <Box component="form" onSubmit={(evento) => { evento.preventDefault(); aplicar(borrador) }} noValidate aria-label="Período del reporte">
            <Stack direction="row" spacing={1.25} alignItems="flex-start" useFlexGap flexWrap="wrap">
              <TextField
                type="date" label="Desde" size="small" value={borrador.desde}
                onChange={(evento) => setBorrador((actual) => ({ ...actual, desde: evento.target.value }))}
                error={Boolean(errores.desde)} helperText={errores.desde}
                slotProps={{ inputLabel: { shrink: true } }} sx={{ width: ANCHO_CAMPO_FECHA }}
              />
              <TextField
                type="date" label="Hasta" size="small" value={borrador.hasta}
                onChange={(evento) => setBorrador((actual) => ({ ...actual, hasta: evento.target.value }))}
                error={Boolean(errores.hasta)} helperText={errores.hasta}
                slotProps={{ inputLabel: { shrink: true } }} sx={{ width: ANCHO_CAMPO_FECHA }}
              />
              <Button type="submit" variant="contained" disabled={isFetching}>Aplicar</Button>
            </Stack>
          </Box>

          <BarraHerramientas contador={isLoading || isError ? undefined : `${total} ${total === 1 ? 'producto' : 'productos'}`}>
            <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" role="group" aria-label="Atajos de período">
              {ATAJOS_PERIODO.map((atajo) => (
                <Button key={atajo.valor} size="small" variant="outlined" onClick={() => elegirAtajo(atajo.valor)}>{atajo.etiqueta}</Button>
              ))}
            </Stack>
          </BarraHerramientas>

          {cargandoTiendas || errorTiendas || empresas.length > 0 ? (
            <FiltroEmpresa
              empresas={empresas}
              valor={empresaId}
              onCambiar={(id) => {
                elegirEmpresa(id)
                setPagina(1)
              }}
              cargando={cargandoTiendas}
              hayError={errorTiendas}
              textoAyuda="Por defecto se ven todas; si elegís una empresa en la barra superior, se filtra por esa tienda."
            />
          ) : null}

          {isFetching && !isLoading ? <LinearProgress aria-label="Actualizando el reporte" /> : null}
          <Box role="status" aria-live="polite" sx={visuallyHidden}>
            {isLoading || isError ? '' : `${total} ${total === 1 ? 'producto' : 'productos'} más vendidos`}
          </Box>
          {contenido()}
        </Stack>
      </ContenedorSeccion>
    </Box>
  )
}
