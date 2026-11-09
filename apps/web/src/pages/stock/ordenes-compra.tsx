import { useEffect, useMemo, useState } from 'react'
import {
  Alert, Box, Button, MenuItem, Snackbar, Stack, TablePagination, TextField, Typography,
} from '@mui/material'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { ContenedorSeccion } from '../../components/pagina/ContenedorSeccion'
import { ContextoOrganizacionActiva } from '../../components/pagina/ContextoOrganizacionActiva'
import { ContenidoAdaptable, type ColumnaAdaptable } from '../../components/pagina/ContenidoAdaptable'
import { FiltroEmpresa } from '../../components/pagina/FiltroEmpresa'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../../components/estados/EstadosPagina'
import { EtiquetaEstado } from '../../components/base/EtiquetaEstado'
import { OrdenCompraFormDialog } from '../../components/stock/OrdenCompraFormDialog'
import { OrdenCompraDetalleDialog } from '../../components/stock/OrdenCompraDetalleDialog'
import { AnularOrdenCompraDialog, type OrdenAAnular } from '../../components/stock/AnularOrdenCompraDialog'
import { useFiltroPorEmpresaActiva } from '../../hooks/useFiltroPorEmpresaActiva'
import { useNivelSeccion } from '../../hooks/useNivelSeccion'
import { TAMANO_PAGINA_ORDENES, useOrdenesCompra, type OrdenFila } from '../../hooks/useOrdenesCompra'
import { ESTADOS_ORDEN, type EstadoOrdenCompra } from '../../lib/ordenesCompra'
import { PestanasStock } from './PestanasStock'

const formatearFecha = (fecha: string | null) => (fecha ? fecha.split('-').reverse().join('/') : '—')

type Aviso = { texto: string; severidad: 'success' | 'info' | 'warning' | 'error' }

// F-PRV-09: «Órdenes de compra» dentro de Stock. El listado sale de la base (RLS del
// llamador) y el alta se hace sobre el listado de reposición: los productos en alerta del
// proveedor. El detalle y las transiciones (recibir/anular) viven en diálogos.
export function OrdenesCompra() {
  const { empresas, valor: empresaId, cambiar: elegirEmpresa, cargando: cargandoTiendas, hayError: errorTiendas } = useFiltroPorEmpresaActiva()
  const { nivel } = useNivelSeccion('stock')
  const puedeEditar = nivel === 'edicion'
  const [estado, setEstado] = useState<EstadoOrdenCompra | ''>('')
  const [pagina, setPagina] = useState(1)
  const [dialogoAlta, setDialogoAlta] = useState(false)
  const [ordenAbierta, setOrdenAbierta] = useState<string | null>(null)
  const [ordenAAnular, setOrdenAAnular] = useState<OrdenAAnular | null>(null)
  const [aviso, setAviso] = useState<Aviso | null>(null)

  const { filas, total, hayError, cargando, recargar } = useOrdenesCompra({
    estado: estado === '' ? null : estado,
    empresaId,
    pagina,
    tamano: TAMANO_PAGINA_ORDENES,
  })

  // Cambió la empresa (barra superior o filtro): la pantalla se reencuadra (FR-008). Se ajusta
  // en el MISMO render —no en un efecto— para que no se dibuje ni un cuadro con los datos de la
  // empresa anterior ni el diálogo abierto sobre la nueva, y para que la consulta de la nueva
  // empresa salga una sola vez, ya en la página 1.
  const [empresaVista, setEmpresaVista] = useState(empresaId)
  if (empresaId !== empresaVista) {
    setEmpresaVista(empresaId)
    setPagina(1)
    if (dialogoAlta) {
      setDialogoAlta(false)
      setAviso({ texto: 'Cambiaste de empresa: se cerró el alta de la orden.', severidad: 'info' })
    }
    if (ordenAbierta) {
      setOrdenAbierta(null)
      setAviso({ texto: 'Cambiaste de empresa: se cerró el detalle de la orden.', severidad: 'info' })
    }
  }

  // Página fuera de rango (p. ej. al cambiar un filtro): se vuelve a la primera.
  useEffect(() => {
    if (filas !== null && filas.length === 0 && pagina > 1) setPagina(1)
  }, [filas, pagina])

  const columnas: ColumnaAdaptable<OrdenFila>[] = useMemo(() => [
    { clave: 'fecha', encabezado: 'Fecha', render: (fila) => <Typography variant="b">{formatearFecha(fila.fecha)}</Typography> },
    { clave: 'proveedor', encabezado: 'Proveedor', render: (fila) => <Typography variant="b">{fila.proveedor}</Typography> },
    { clave: 'empresa', encabezado: 'Tienda', render: (fila) => <Typography variant="b">{fila.empresa}</Typography> },
    {
      clave: 'estado',
      encabezado: 'Estado',
      render: (fila) => {
        const etiqueta = ESTADOS_ORDEN.find((opcion) => opcion.valor === fila.estado)
        return <EtiquetaEstado texto={etiqueta?.etiqueta ?? fila.estado} variante={etiqueta?.variante ?? 'neutral'} />
      },
    },
    { clave: 'unidades', encabezado: 'Unidades', align: 'right', render: (fila) => <Typography variant="b">{fila.unidades}</Typography> },
  ], [])

  const acciones = (fila: OrdenFila) => (
    <Button size="small" onClick={() => setOrdenAbierta(fila.orden_id)}>Ver</Button>
  )

  return (
    <Box>
      <EncabezadoPagina titulo="Stock" contexto={<ContextoOrganizacionActiva />} />
      <ContenedorSeccion>
        <PestanasStock activa="ordenes-compra" />
        <Stack spacing={1.5}>
          <Stack direction="row" justifyContent="space-between" alignItems="baseline" useFlexGap flexWrap="wrap">
            <Typography variant="h3" component="h2">Órdenes de compra</Typography>
            {puedeEditar ? (
              <Button variant="contained" onClick={() => setDialogoAlta(true)}>Nueva orden de compra</Button>
            ) : (
              <Typography variant="xs">Tu rol puede ver las órdenes, pero no crear ni cambiar su estado.</Typography>
            )}
          </Stack>

          <FiltroEmpresa
            empresas={empresas}
            valor={empresaId}
            onCambiar={(nuevo) => { elegirEmpresa(nuevo); setPagina(1) }}
            cargando={cargandoTiendas}
            hayError={errorTiendas}
          />

          <TextField
            select
            size="small"
            label="Estado"
            value={estado}
            onChange={(evento) => { setEstado(evento.target.value as EstadoOrdenCompra | ''); setPagina(1) }}
            sx={{ width: 180 }}
          >
            <MenuItem value="">Todos</MenuItem>
            {ESTADOS_ORDEN.map((opcion) => (
              <MenuItem key={opcion.valor} value={opcion.valor}>{opcion.etiqueta}</MenuItem>
            ))}
          </TextField>

          {hayError ? (
            <EstadoError descripcion="No pudimos cargar las órdenes de compra." reintentar={() => void recargar()} />
          ) : filas === null ? (
            <EstadoCargaPagina />
          ) : filas.length === 0 ? (
            <EstadoVacio
              titulo={estado === '' ? 'Todavía no hay órdenes de compra.' : 'No hay órdenes con ese estado.'}
              descripcion={estado === '' ? 'Cuando le pidas mercadería a un proveedor, la vas a ver acá.' : 'Probá con otro estado.'}
            />
          ) : (
            <Box aria-busy={cargando} sx={{ opacity: cargando ? 0.5 : 1, transition: 'opacity 150ms' }}>
              <ContenidoAdaptable
                items={filas}
                columnas={columnas}
                obtenerClave={(fila) => fila.orden_id}
                acciones={acciones}
                etiquetaTabla="Órdenes de compra a proveedores"
              />
              <TablePagination
                component="div"
                count={total}
                page={pagina - 1}
                rowsPerPage={TAMANO_PAGINA_ORDENES}
                rowsPerPageOptions={[TAMANO_PAGINA_ORDENES]}
                onPageChange={(_, nueva) => setPagina(nueva + 1)}
                labelRowsPerPage="Órdenes por página"
                labelDisplayedRows={({ from, to, count }) => `${from}–${to} de ${count}`}
              />
            </Box>
          )}
        </Stack>

        <OrdenCompraFormDialog
          abierto={dialogoAlta}
          onCerrar={() => setDialogoAlta(false)}
          onCambioEmpresa={() => {
            setDialogoAlta(false)
            setAviso({ texto: 'Cambiaste de empresa: se cerró el alta de la orden.', severidad: 'info' })
          }}
          onCreada={() => {
            setDialogoAlta(false)
            setAviso({ texto: 'Orden de compra creada', severidad: 'success' })
            setPagina(1)
            void recargar()
          }}
        />

        <OrdenCompraDetalleDialog
          abierto={ordenAbierta !== null}
          ordenId={ordenAbierta}
          puedeEditar={puedeEditar}
          onCerrar={() => setOrdenAbierta(null)}
          onCambiada={() => {
            setAviso({ texto: 'Orden marcada como recibida', severidad: 'success' })
            void recargar()
          }}
          onAnular={(ordenId) => {
            const fila = filas?.find((otra) => otra.orden_id === ordenId)
            setOrdenAAnular({ orden_id: ordenId, proveedor: fila?.proveedor ?? '', fecha: fila?.fecha ?? '' })
          }}
        />

        <AnularOrdenCompraDialog
          abierto={ordenAAnular !== null}
          orden={ordenAAnular}
          onCerrar={() => setOrdenAAnular(null)}
          onAnulada={() => {
            setOrdenAAnular(null)
            setOrdenAbierta(null)
            setAviso({ texto: 'Orden anulada', severidad: 'success' })
            void recargar()
          }}
        />

        <Snackbar open={aviso !== null} autoHideDuration={4000} onClose={() => setAviso(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
          <Alert severity={aviso?.severidad ?? 'info'} onClose={() => setAviso(null)} variant="filled">{aviso?.texto}</Alert>
        </Snackbar>
      </ContenedorSeccion>
    </Box>
  )
}
