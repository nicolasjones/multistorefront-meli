import { useEffect, useMemo, useState } from 'react'
import { Alert, Box, Button, Stack, TablePagination, Typography } from '@mui/material'
import { Link as RouterLink } from 'react-router'
import {
  TAMANO_PAGINA_ARCHIVO_INGRESOS, useArchivoIngresos, type ArchivoIngresoFila,
} from '../../hooks/useArchivoIngresos'
import { usePuedeEscribir } from '../../hooks/usePuedeEscribir'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../estados/EstadosPagina'
import { ContenidoAdaptable, type ColumnaAdaptable } from '../pagina/ContenidoAdaptable'

const formatearFecha = (fecha: string) => fecha.split('-').reverse().join('/')

// Pestaña «Archivo anterior al sistema» de Ingreso de mercadería (F-MIG-03, FR-033). No está
// dibujada en el prototipo: usa la tabla del historial de ingresos con las columnas Fecha,
// Producto, Cantidad, Proveedor y Operador. Solo consulta: ninguna acción edita ni borra filas
// (FR-031). Es de la organización, no de una empresa (FR-034).
export function ArchivoIngresos() {
  const [pagina, setPagina] = useState(1)
  const { filas, total, hayError, cargando, recargar } = useArchivoIngresos(pagina)
  const { puedeEscribir } = usePuedeEscribir()

  // Página fuera de rango: se vuelve a la primera.
  useEffect(() => {
    if (filas !== null && filas.length === 0 && pagina > 1) setPagina(1)
  }, [filas, pagina])

  const columnas: ColumnaAdaptable<ArchivoIngresoFila>[] = useMemo(() => [
    { clave: 'fecha', encabezado: 'Fecha', render: (fila) => <Typography variant="b">{formatearFecha(fila.fecha)}</Typography> },
    { clave: 'producto', encabezado: 'Producto', render: (fila) => <Typography variant="b">{fila.producto}</Typography> },
    { clave: 'cantidad', encabezado: 'Cantidad', align: 'right', render: (fila) => <Typography variant="b">{`+${fila.cantidad}`}</Typography> },
    { clave: 'proveedor', encabezado: 'Proveedor', render: (fila) => <Typography variant="b">{fila.proveedor ?? '—'}</Typography> },
    { clave: 'operador', encabezado: 'Operador', render: (fila) => <Typography variant="b">{fila.operador ?? '—'}</Typography> },
  ], [])

  return (
    <Stack spacing={1.5}>
      <Stack direction="row" justifyContent="space-between" alignItems="baseline" useFlexGap flexWrap="wrap">
        <Typography variant="h3" component="h2">Archivo anterior al sistema</Typography>
        <Typography variant="xs">{total} {total === 1 ? 'línea' : 'líneas'}</Typography>
      </Stack>

      <Alert severity="info">
        Archivo de solo consulta: son los ingresos del panel anterior y no modifican el stock. Pertenece a toda la
        organización, por eso no cambia con la empresa activa de la barra superior.
      </Alert>

      {puedeEscribir ? (
        <Box>
          <Button component={RouterLink} to="/migracion/importar/ingresos_archivo" variant="outlined" size="small">
            Importar ingresos anteriores
          </Button>
        </Box>
      ) : null}

      {hayError ? (
        <EstadoError descripcion="No pudimos cargar el archivo de ingresos." reintentar={() => void recargar()} />
      ) : filas === null || (filas.length === 0 && pagina > 1) ? (
        <EstadoCargaPagina />
      ) : filas.length === 0 ? (
        <EstadoVacio
          titulo="Todavía no hay ingresos archivados."
          descripcion="Cuando se importe el historial del panel anterior, lo vas a ver acá."
        />
      ) : (
        <Box aria-busy={cargando} sx={{ opacity: cargando ? 0.5 : 1, transition: 'opacity 150ms' }}>
          <ContenidoAdaptable
            items={filas}
            columnas={columnas}
            obtenerClave={(fila) => fila.id}
            etiquetaTabla="Archivo de ingresos de mercadería anterior al sistema"
          />
          <TablePagination
            component="div"
            count={total}
            page={pagina - 1}
            rowsPerPage={TAMANO_PAGINA_ARCHIVO_INGRESOS}
            rowsPerPageOptions={[TAMANO_PAGINA_ARCHIVO_INGRESOS]}
            onPageChange={(_, nueva) => setPagina(nueva + 1)}
            labelRowsPerPage="Líneas por página"
            labelDisplayedRows={({ from, to, count }) => `${from}–${to} de ${count}`}
          />
        </Box>
      )}
    </Stack>
  )
}
