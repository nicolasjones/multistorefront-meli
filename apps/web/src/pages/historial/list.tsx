import { useState, type ReactNode } from 'react'
import { Alert, Box, Chip, LinearProgress, Stack, Tab, Tabs, TablePagination, TextField, Typography } from '@mui/material'
import { useFiltroPorEmpresaActiva } from '../../hooks/useFiltroPorEmpresaActiva'
import { useOrganizacionActiva } from '../../hooks/useOrganizacionActiva'
import {
  TAMANO_PAGINA_HISTORIAL,
  useHistorialVentasCobros,
  type CobroHistorico,
  type TipoConsultaHistorial,
  type VentaHistorica,
} from '../../hooks/useHistorialVentasCobros'
import { CotizacionesTab } from './CotizacionesTab'
import { formatearFecha, formatearImporteHistorial } from '../../lib/formatoHistorial'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../../components/estados/EstadosPagina'
import { EtiquetaEstado, type VarianteEtiqueta } from '../../components/base/EtiquetaEstado'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { ContenedorSeccion } from '../../components/pagina/ContenedorSeccion'
import { ContenidoAdaptable, type ColumnaAdaptable } from '../../components/pagina/ContenidoAdaptable'
import { BarraHerramientas } from '../../components/pagina/BarraHerramientas'
import { ContextoOrganizacionActiva } from '../../components/pagina/ContextoOrganizacionActiva'

type Pestana = TipoConsultaHistorial | 'cotizaciones'

const PESTANAS: ReadonlyArray<{ valor: Pestana; etiqueta: string }> = [
  { valor: 'ventas', etiqueta: 'Ventas' },
  { valor: 'cobros', etiqueta: 'Cobros' },
  { valor: 'cotizaciones', etiqueta: 'Cotizaciones del dólar' },
]

// Barra de progreso indeterminada: alto fino propio del componente, no un valor del sistema.
const ALTO_BARRA_CARGA = 2
const visuallyHidden = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' } as const // estilos-sueltos: ok: oculta visualmente sin quitar del lector

const TONO_ESTADO: Readonly<Record<string, VarianteEtiqueta>> = {
  Cobrado: 'exito',
  Deuda: 'error',
  Incompleto: 'aviso',
}

// Número original del comprobante con el rótulo «Histórico» (FR-017): deja claro que no es
// un comprobante vivo y que no se puede editar, anular ni borrar.
function NumeroHistorico({ numero }: { numero: string }) {
  return (
    <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap">
      <Typography component="span" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{numero}</Typography>
      <EtiquetaEstado texto="Histórico" variante="info" />
    </Stack>
  )
}

const tienda = (nombre: string | null) => (nombre ? <EtiquetaEstado texto={nombre} variante="contorno" /> : '—')
const textoOGuion = (valor: string | null) => (valor && valor.trim() !== '' ? valor : '—')

const columnasVentas: ColumnaAdaptable<VentaHistorica>[] = [
  { clave: 'numero', encabezado: 'Comprobante', render: (venta) => <NumeroHistorico numero={venta.numero} /> },
  { clave: 'tienda', encabezado: 'Tienda', render: (venta) => tienda(venta.empresa_nombre) },
  { clave: 'fecha', encabezado: 'Fecha', render: (venta) => formatearFecha(venta.fecha) },
  { clave: 'cliente', encabezado: 'Cliente', render: (venta) => <Typography component="span" sx={{ fontWeight: 600 }}>{venta.cliente_nombre}</Typography> },
  { clave: 'operador', encabezado: 'Operador', render: (venta) => textoOGuion(venta.operador) },
  {
    clave: 'estado', encabezado: 'Estado final',
    render: (venta) => venta.estado_final ? <EtiquetaEstado texto={venta.estado_final} variante={TONO_ESTADO[venta.estado_final] ?? 'neutral'} /> : '—',
  },
  { clave: 'total', encabezado: 'Total', align: 'right', render: (venta) => <b>{formatearImporteHistorial(venta.total)}</b> },
]

const columnasCobros: ColumnaAdaptable<CobroHistorico>[] = [
  { clave: 'fecha', encabezado: 'Fecha', render: (cobro) => formatearFecha(cobro.fecha) },
  { clave: 'comprobante', encabezado: 'Comprobante', render: (cobro) => <NumeroHistorico numero={cobro.comprobante_numero} /> },
  { clave: 'tienda', encabezado: 'Tienda', render: (cobro) => tienda(cobro.empresa_nombre) },
  { clave: 'cliente', encabezado: 'Cliente', render: (cobro) => <Typography component="span" sx={{ fontWeight: 600 }}>{cobro.cliente_nombre}</Typography> },
  { clave: 'cuenta', encabezado: 'Cuenta de cobro', render: (cobro) => textoOGuion(cobro.cuenta_cobro) },
  { clave: 'aprobado', encabezado: 'Aprobado por', render: (cobro) => textoOGuion(cobro.aprobado_por) },
  { clave: 'importe', encabezado: 'Importe', align: 'right', render: (cobro) => <b>{formatearImporteHistorial(cobro.importe)}</b> },
]

// Consulta del historial importado (F-VTA-38, FR-011…FR-019). Solo lectura: no hay acciones de
// edición, anulación ni borrado. El acceso por sección lo resuelve la ruta (RequiereAccesoSeccion)
// y, en serio, la RLS de `historial_*`; la tienda se elige entre las empresas asignadas.
export function HistorialList() {
  const [pestana, setPestana] = useState<Pestana>('ventas')
  // El filtro Tienda sigue a la empresa activa de la barra superior (Constitución VIII) y los
  // chips lo sobreescriben hasta que esa cambie. Se conserva al pasar de Ventas a Cobros.
  const { empresas, valor, cambiar, empresaActivaId } = useFiltroPorEmpresaActiva()
  const { organizacionActiva } = useOrganizacionActiva()
  const empresaId = valor ?? ''
  return (
    <Box>
      <EncabezadoPagina
        titulo="Historial"
        descripcion="Consulta de lo registrado antes de la plataforma. No se puede editar ni borrar."
        accion={<EtiquetaEstado texto="Solo lectura" />}
        contexto={<ContextoOrganizacionActiva />}
      />
      <ContenedorSeccion>
        <Stack spacing={2}>
          <Alert severity="info" role="note">
            Datos del sistema anterior, importados una sola vez al migrar. Sirven para consultar ventas, cobros y cotizaciones del dólar anteriores a la plataforma; no afectan el stock actual.
          </Alert>
          <Tabs value={pestana} onChange={(_, valor: Pestana) => setPestana(valor)} aria-label="Secciones del historial" variant="scrollable" scrollButtons="auto" allowScrollButtonsMobile>
            {PESTANAS.map((p) => (
              <Tab key={p.valor} value={p.valor} label={p.etiqueta} id={`historial-tab-${p.valor}`} aria-controls={p.valor === pestana ? `historial-panel-${p.valor}` : undefined} />
            ))}
          </Tabs>
          <Box role="tabpanel" id={`historial-panel-${pestana}`} aria-labelledby={`historial-tab-${pestana}`}>
            {pestana === 'cotizaciones' ? (
              // Globales de la organización: no dependen de la tienda ni de la empresa activa.
              <CotizacionesTab key={organizacionActiva?.id ?? ''} />
            ) : (
              // Al cambiar de organización o de empresa activa se remonta: vuelve a la página 1,
              // limpia la búsqueda y recarga todo, sin filas de la empresa anterior.
              <ConsultaVentasCobros key={`${pestana}:${organizacionActiva?.id ?? ''}:${empresaActivaId ?? ''}`} tipo={pestana} tiendas={empresas} empresaId={empresaId} onEmpresa={(id) => cambiar(id === '' ? null : id)} />
            )}
          </Box>
        </Stack>
      </ContenedorSeccion>
    </Box>
  )
}

function ConsultaVentasCobros({ tipo, tiendas, empresaId, onEmpresa }: { tipo: TipoConsultaHistorial; tiendas: ReadonlyArray<{ id: string; nombre: string }>; empresaId: string; onEmpresa: (id: string) => void }) {
  const esVentas = tipo === 'ventas'
  const consulta = useHistorialVentasCobros<VentaHistorica | CobroHistorico>(tipo, empresaId)
  const { filas, total, desde, hasta, texto, setTexto, textoAplicado, pagina, setPagina, isLoading, isFetching, isError, refetch } = consulta
  const elegirTienda = (id: string) => {
    onEmpresa(id)
    setPagina(1)
  }
  const hayFiltros = textoAplicado.trim() !== '' || empresaId !== ''
  const nombre = esVentas ? 'ventas' : 'cobros'

  let contenido: ReactNode
  // Página fuera de rango: el hook vuelve a la 1; mientras tanto no se muestra «Sin resultados».
  if (isLoading || (pagina > 1 && filas.length === 0 && !isError)) {
    contenido = <EstadoCargaPagina />
  } else if (isError) {
    contenido = <EstadoError descripcion={`No pudimos cargar el historial de ${nombre}.`} reintentar={() => void refetch()} />
  } else if (filas.length === 0) {
    contenido = hayFiltros ? (
      <EstadoVacio titulo="Sin resultados" descripcion="Probá con otro texto o con otra tienda." />
    ) : (
      <EstadoVacio titulo="Todavía no hay historial importado." descripcion={`Cuando se importen las ${nombre} del sistema anterior, las vas a ver acá.`} />
    )
  } else {
    contenido = (
      <>
        {esVentas ? (
          <ContenidoAdaptable items={filas as VentaHistorica[]} columnas={columnasVentas} obtenerClave={(fila) => fila.id} etiquetaTabla="Ventas históricas" />
        ) : (
          <ContenidoAdaptable items={filas as CobroHistorico[]} columnas={columnasCobros} obtenerClave={(fila) => fila.id} etiquetaTabla="Cobros históricos" />
        )}
        <TablePagination
          component="div"
          count={total}
          page={pagina - 1}
          rowsPerPage={TAMANO_PAGINA_HISTORIAL}
          rowsPerPageOptions={[TAMANO_PAGINA_HISTORIAL]}
          onPageChange={(_, nueva) => setPagina(nueva + 1)}
          labelRowsPerPage="Registros por página"
          labelDisplayedRows={({ from, to, count }) => `Página ${pagina} · ${from}–${to} de ${count}`}
        />
      </>
    )
  }

  return (
    <Stack spacing={2}>
      {tiendas.length > 0 ? (
        <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap" role="group" aria-label="Filtrar por tienda">
          <Typography component="span" variant="s" sx={{ fontWeight: 600 }}>Tienda</Typography>
          <Chip label="Todas las tiendas" clickable aria-pressed={empresaId === ''} color={empresaId === '' ? 'primary' : 'default'} variant={empresaId === '' ? 'filled' : 'outlined'} onClick={() => elegirTienda('')} />
          {tiendas.map((t) => (
            <Chip key={t.id} label={t.nombre} clickable aria-pressed={empresaId === t.id} color={empresaId === t.id ? 'primary' : 'default'} variant={empresaId === t.id ? 'filled' : 'outlined'} onClick={() => elegirTienda(t.id)} />
          ))}
          <Typography component="span" variant="xs">Cada venta y cobro quedó asignado a la tienda que lo emitió. Las cotizaciones del dólar son globales.</Typography>
        </Stack>
      ) : null}

      <BarraHerramientas contador={isLoading || isError ? undefined : `${total} registros mostrados`}>
        <TextField
          type="search"
          label="Buscar por cliente o número"
          value={texto}
          onChange={(evento) => setTexto(evento.target.value)}
          size="small"
          sx={{ width: 320, maxWidth: '100%' }}
        />
        {desde ? <Chip variant="outlined" label={`Desde: ${formatearFecha(desde)}`} /> : null}
        {hasta ? <Chip variant="outlined" label={`Hasta: ${formatearFecha(hasta)}`} /> : null}
      </BarraHerramientas>

      <Box role="status" aria-live="polite" sx={visuallyHidden}>
        {isLoading || isError ? '' : `${total} ${total === 1 ? 'resultado' : 'resultados'}`}
      </Box>
      {isFetching && !isLoading ? <LinearProgress aria-label={`Actualizando ${nombre}`} sx={{ height: ALTO_BARRA_CARGA }} /> : null}
      <Box aria-busy={isFetching}>{contenido}</Box>
    </Stack>
  )
}
