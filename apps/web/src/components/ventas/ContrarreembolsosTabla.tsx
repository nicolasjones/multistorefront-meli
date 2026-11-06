import { useState } from 'react'
import {
  Alert, Box, Button, Card, CardContent, LinearProgress, Link, Snackbar, Stack, Typography,
} from '@mui/material'
import { Link as RouterLink } from 'react-router'
import { useListadoAcumulado } from '../../hooks/useListadoAcumulado'
import { CargaInfinita } from '../pagina/CargaInfinita'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../estados/EstadosPagina'
import { EtiquetaEstado } from '../base/EtiquetaEstado'
import { ContenidoAdaptable, type ColumnaAdaptable } from '../pagina/ContenidoAdaptable'
import { formatearFecha, formatearImporteHistorial } from '../../lib/formatoHistorial'
import { tokens } from '../../tema/tokens'
import {
  marcarContrarreembolsoCobrado,
  mensajeDeErrorContrarreembolso,
  type Contrarreembolso,
  type ResumenContrarreembolsos,
} from '../../lib/ventas/contrarreembolsos'

// Barra de progreso indeterminada: alto fino propio del componente, no un valor del sistema.
const ALTO_BARRA_CARGA = 2

// Columnas del prototipo `design/pantallas/VentasTransportes.dc.html` (FR-047): Fecha, Tienda,
// Comprobante, Cliente, Empresa de transporte, Guía, Importe y Estado.
const COLUMNAS: ColumnaAdaptable<Contrarreembolso>[] = [
  { clave: 'fecha', encabezado: 'Fecha', render: (cr) => formatearFecha(cr.fecha.slice(0, 10)) },
  { clave: 'empresa', encabezado: 'Tienda', render: (cr) => <EtiquetaEstado texto={cr.empresa} variante="contorno" /> },
  {
    clave: 'numero',
    encabezado: 'Comprobante',
    render: (cr) => (
      <Link
        component={RouterLink}
        to={`/ventas/comprobantes/${cr.comprobante_id}`}
        underline="hover"
        sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}
      >
        {cr.numero}
      </Link>
    ),
  },
  {
    clave: 'cliente',
    encabezado: 'Cliente',
    // El nombre del cliente puede venir vacío (la RLS de Clientes es más restrictiva): se muestra «—».
    render: (cr) => <Typography component="span" sx={{ fontWeight: 600 }}>{cr.cliente ?? '—'}</Typography>,
  },
  { clave: 'transporte', encabezado: 'Empresa de transporte', render: (cr) => cr.transporte },
  { clave: 'guia', encabezado: 'Guía', render: (cr) => cr.guia },
  {
    clave: 'importe',
    encabezado: 'Importe',
    align: 'right',
    render: (cr) => <b>{formatearImporteHistorial(cr.importe)}</b>,
  },
  {
    clave: 'estado',
    encabezado: 'Estado',
    render: (cr) => (
      <EtiquetaEstado
        texto={cr.estado === 'cobrado' ? 'Cobrado' : 'Pendiente'}
        variante={cr.estado === 'cobrado' ? 'exito' : 'aviso'}
      />
    ),
  },
]

export type PropsTarjetas = {
  // `null` mientras carga o si falló: la tarjeta muestra «—» en vez de un total inventado.
  resumen: ResumenContrarreembolsos | null
  cargando: boolean
}

// Tarjetas de la pantalla (FR-045): «Contrarreembolsos pendientes» (cuánto hay sin rendir) y
// «Cobrados este mes» (cuánto rindieron los transportes). Los dos importes son del resumen de la
// base, que solo cuenta la empresa activa.
export function ContrarreembolsosTarjetas({ resumen, cargando }: PropsTarjetas) {
  const pendiente = resumen?.pendiente_cantidad ?? 0
  const sinDatos = !cargando && !resumen
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} useFlexGap flexWrap="wrap">
      <Tarjeta
        id="tarjeta-contrarreembolsos-pendientes"
        titulo="Contrarreembolsos pendientes"
        valor={cargando || !resumen ? '—' : formatearImporteHistorial(resumen.pendiente_importe)}
        detalle={
          cargando
            ? 'Cargando…'
            : sinDatos
              ? 'Sin datos'
              : `${pendiente} ${pendiente === 1 ? 'envío sin rendir' : 'envíos sin rendir'}`
        }
        color={tokens.color.alerta.aviso.icono}
      />
      <Tarjeta
        id="tarjeta-contrarreembolsos-cobrados"
        titulo="Cobrados este mes"
        valor={cargando || !resumen ? '—' : formatearImporteHistorial(resumen.cobrado_mes_importe)}
        detalle={cargando ? 'Cargando…' : sinDatos ? 'Sin datos' : 'Rendidos por los transportes'}
        color={tokens.color.etiqueta.exito.texto}
      />
    </Stack>
  )
}

// Cada tarjeta es una región con su título (así el lector de pantalla anuncia de qué tarjeta
// habla el importe) y con el color del prototipo: aviso para lo pendiente, éxito para lo cobrado.
function Tarjeta({ id, titulo, valor, detalle, color }: { id: string; titulo: string; valor: string; detalle: string; color: string }) {
  return (
    <Card variant="outlined" component="section" aria-labelledby={id} sx={{ flex: '1 1 260px', minWidth: 0 }}>
      <CardContent>
        <Stack spacing={0.5}>
          <Typography id={id} component="h3" variant="s" color="text.secondary">{titulo}</Typography>
          <Typography variant="kpi" component="p" sx={{ color, fontVariantNumeric: 'tabular-nums' }}>{valor}</Typography>
          <Typography variant="s" color="text.secondary">{detalle}</Typography>
        </Stack>
      </CardContent>
    </Card>
  )
}

export type PropsTabla = {
  contrarreembolsos: Contrarreembolso[]
  total: number
  pagina: number
  // Se está pidiendo la tanda siguiente (o recargando): alimenta la carga infinita.
  cargandoTanda: boolean
  // Cambia cuando cambia la tienda o el contexto: vuelve a la primera tanda.
  reinicio: unknown
  // Primera carga: se muestra el esqueleto. Recarga: solo la barrita de progreso.
  cargando: boolean
  actualizando: boolean
  error: string | null
  // Si hay un filtro de tienda activo (para distinguir «no hay nada» de «no hay nada en esa tienda»).
  hayFiltro: boolean
  // Tiendas donde la persona tiene la acción `cobrar_contrarreembolso` (FR-041 y FR-047): sin
  // permiso, el botón «Marcar cobrado» no aparece. La base igual lo rechaza.
  empresasConPermiso: ReadonlySet<string>
  // Recarga la tanda actual (y las tarjetas); también es el «Reintentar» de una tanda que falló.
  onRecargar: () => void
  onCambiarPagina: (pagina: number) => void
}

// Tabla de contrarreembolsos (F-VTA-14, FR-047): las columnas del prototipo, el chip de Estado
// (Pendiente/Cobrado) y el botón «Marcar cobrado» (deshabilitado si ya está cobrado, oculto sin
// permiso). El cobro lo resuelve la base (`marcar_contrarreembolso_cobrado`): es idempotente y
// con bloqueo optimista, así que acá solo se ofrece y se avisa.
export function ContrarreembolsosTabla({
  contrarreembolsos, total, pagina, cargandoTanda, reinicio, cargando, actualizando, error, hayFiltro,
  empresasConPermiso, onRecargar, onCambiarPagina,
}: PropsTabla) {
  // Carga infinita (Principio VI): se suman las tandas que entrega el padre.
  const listado = useListadoAcumulado({ items: contrarreembolsos, pagina, setPagina: onCambiarPagina, total, cargando: cargandoTanda, reinicio })
  const falloTanda = error !== null && pagina > 1
  const [cobrando, setCobrando] = useState<string | null>(null)
  const [aviso, setAviso] = useState<{ texto: string; error: boolean } | null>(null)

  const marcarCobrado = async (cr: Contrarreembolso) => {
    // Un clic por vez: la RPC es idempotente, pero no hace falta pedirlo dos veces.
    if (cobrando !== null) return
    setCobrando(cr.id)
    try {
      await marcarContrarreembolsoCobrado(cr.id, cr.actualizado_en)
      setAviso({ texto: `Contrarreembolso cobrado · ${cr.transporte}`, error: false })
      // El estado de la fila cambió: se vuelve a leer desde la primera tanda.
      if (pagina === 1) onRecargar()
      else onCambiarPagina(1)
    } catch (errorCobro) {
      setAviso({
        texto: mensajeDeErrorContrarreembolso(errorCobro, 'No pudimos marcar el contrarreembolso como cobrado. Intentá de nuevo.'),
        error: true,
      })
    } finally {
      setCobrando(null)
    }
  }

  const acciones = (cr: Contrarreembolso) => {
    // Sin permiso en esa tienda, el botón no se ofrece (FR-047).
    if (!empresasConPermiso.has(cr.empresa_id)) return null
    return (
      <Button
        size="small"
        variant="outlined"
        // Ya cobrado no se cobra otra vez (FR-042): el botón queda deshabilitado.
        disabled={cr.estado === 'cobrado' || cobrando !== null}
        aria-busy={cobrando === cr.id}
        aria-label={`Marcar cobrado · ${cr.guia}`}
        onClick={() => void marcarCobrado(cr)}
      >
        Marcar cobrado
      </Button>
    )
  }

  return (
    <Stack spacing={2}>
      {actualizando && !cargando && pagina === 1 ? <LinearProgress aria-label="Actualizando contrarreembolsos" sx={{ height: ALTO_BARRA_CARGA }} /> : null}

      <Box aria-busy={cargando}>
        {cargando ? (
          <EstadoCargaPagina />
        ) : error !== null && !falloTanda ? (
          <EstadoError descripcion={error} reintentar={onRecargar} />
        ) : contrarreembolsos.length === 0 && pagina === 1 ? (
          hayFiltro ? (
            <EstadoVacio titulo="Sin resultados" descripcion="Esa tienda no tiene contrarreembolsos." />
          ) : (
            <EstadoVacio
              titulo="Todavía no hay contrarreembolsos."
              descripcion="Aparecen cuando un transporte cobra al entregar y lo rinde después."
            />
          )
        ) : (
          <>
            <ContenidoAdaptable
              items={listado.filas}
              columnas={COLUMNAS}
              obtenerClave={(cr) => cr.id}
              etiquetaTabla="Contrarreembolsos"
              acciones={empresasConPermiso.size > 0 ? acciones : undefined}
            />
            <CargaInfinita hayMas={listado.hayMas} cargando={listado.cargandoMas} hayError={falloTanda} onCargarMas={falloTanda ? onRecargar : listado.cargarMas} />
          </>
        )}
      </Box>

      <Snackbar
        open={aviso !== null}
        autoHideDuration={4000}
        onClose={() => setAviso(null)}
      >
        <Alert severity={aviso?.error ? 'error' : 'success'} onClose={() => setAviso(null)}>
          {aviso?.texto ?? ''}
        </Alert>
      </Snackbar>
    </Stack>
  )
}
