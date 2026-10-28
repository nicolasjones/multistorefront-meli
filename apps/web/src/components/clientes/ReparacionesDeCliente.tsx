import { useEffect, useState } from 'react'
import { Link as RouterLink } from 'react-router'
import { Box, LinearProgress, Link, Stack, TablePagination, Typography } from '@mui/material'
import { useEmpresasAccesibles } from '../../hooks/useEmpresasAccesibles'
import { formatearDiaCompleto } from '../../lib/reparacionesListado'
import {
  TAMANO_PAGINA_REPARACIONES_CLIENTE, useReparacionesDeCliente, type ReparacionDeCliente,
} from '../../lib/reparacionesDeCliente'
import { formatearARS } from '../../lib/serviceTecnico'
import { EtiquetaEstado } from '../base/EtiquetaEstado'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../estados/EstadosPagina'
import { ContenidoAdaptable, type ColumnaAdaptable } from '../pagina/ContenidoAdaptable'

type TonoEtiqueta = Parameters<typeof EtiquetaEstado>[0]['variante']

const columnas: ColumnaAdaptable<ReparacionDeCliente>[] = [
  {
    clave: 'reparacion', encabezado: 'Reparación',
    render: (reparacion) => (
      <Link component={RouterLink} to={`/service-tecnico/reparaciones/${reparacion.id}`} underline="hover" sx={{ fontWeight: 600 }}>
        {reparacion.numero}
      </Link>
    ),
  },
  { clave: 'tienda', encabezado: 'Tienda', render: (reparacion) => reparacion.empresa || '—' },
  {
    clave: 'equipo', encabezado: 'Equipo',
    render: (reparacion) => (
      <Stack>
        <span>{reparacion.equipo || '—'}</span>
        <Typography variant="xs">{reparacion.modelo}</Typography>
      </Stack>
    ),
  },
  {
    clave: 'estado', encabezado: 'Estado',
    render: (reparacion) => <EtiquetaEstado texto={reparacion.estado} variante={reparacion.estado_tono as TonoEtiqueta} />,
  },
  { clave: 'ingreso', encabezado: 'Ingreso', render: (reparacion) => (reparacion.ingreso_en ? formatearDiaCompleto(reparacion.ingreso_en) : '—') },
  { clave: 'entrega', encabezado: 'Entrega', render: (reparacion) => (reparacion.entrega_prevista ? formatearDiaCompleto(reparacion.entrega_prevista) : '—') },
  {
    clave: 'total', encabezado: 'Total', align: 'right',
    render: (reparacion) => (reparacion.total > 0 ? formatearARS(reparacion.total) : 'A presupuestar'),
  },
]

// Pestaña «Reparaciones» de la ficha del cliente (F-SVC-15, FR-041…FR-046). Paginada en el servidor y
// acotada a la empresa activa de la barra superior (Principio VIII, FR-043): al cambiarla recarga y vuelve
// a la página 1. Un error acá no afecta al resto de la ficha.
export function ReparacionesDeCliente({ clienteId }: { clienteId: string }) {
  const { empresaActivaId, isLoading: cargandoEmpresas } = useEmpresasAccesibles()
  // La página pertenece a la empresa con la que se eligió: si cambia, vale la primera.
  const [elegida, setElegida] = useState({ clave: empresaActivaId ?? '', pagina: 1 })
  const clave = empresaActivaId ?? ''
  const pagina = elegida.clave === clave ? elegida.pagina : 1
  const { filas, total, isLoading, isFetching, isError, refetch } =
    useReparacionesDeCliente(clienteId, empresaActivaId, pagina, TAMANO_PAGINA_REPARACIONES_CLIENTE)

  // Página fuera de rango (bajó la cantidad): vuelve a la primera.
  useEffect(() => {
    if (!isLoading && !isFetching && !isError && pagina > 1 && filas.length === 0 && total > 0) setElegida({ clave, pagina: 1 })
  }, [isLoading, isFetching, isError, pagina, filas.length, total, clave])

  const contador = `${total} ${total === 1 ? 'reparación' : 'reparaciones'}`

  return (
    <Box component="section" aria-labelledby="titulo-reparaciones-cliente">
      <Typography id="titulo-reparaciones-cliente" component="h2" variant="h6" sx={{ mb: 1 }}>Reparaciones</Typography>
      {cargandoEmpresas || isLoading ? (
        <EstadoCargaPagina />
      ) : isError ? (
        <EstadoError descripcion="No pudimos cargar las reparaciones del cliente." reintentar={() => void refetch()} />
      ) : filas.length === 0 && total === 0 ? (
        <EstadoVacio titulo="Este cliente todavía no tiene reparaciones" />
      ) : (
        <Box aria-busy={isFetching}>
          <Typography color="text.secondary" role="status" sx={{ mb: 1 }}>{contador}</Typography>
          {isFetching ? <LinearProgress aria-label="Actualizando reparaciones" /> : null}
          <ContenidoAdaptable
            items={filas}
            columnas={columnas}
            obtenerClave={(reparacion) => reparacion.id}
            etiquetaTabla="Reparaciones del cliente"
          />
          <TablePagination
            component="div" count={total} page={pagina - 1} rowsPerPage={TAMANO_PAGINA_REPARACIONES_CLIENTE}
            rowsPerPageOptions={[TAMANO_PAGINA_REPARACIONES_CLIENTE]}
            onPageChange={(_, nueva) => setElegida({ clave, pagina: nueva + 1 })}
            labelRowsPerPage="Reparaciones por página"
            labelDisplayedRows={({ from, to, count }) => `${from}–${to} de ${count}`}
          />
        </Box>
      )}
    </Box>
  )
}
