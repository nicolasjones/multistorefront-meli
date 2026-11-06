import { Box, Button, Dialog, DialogActions, DialogContent, Stack, Typography } from '@mui/material'
import { useHistorialCostos, type PuntoCosto } from '../../hooks/useHistorialCostos'
import { useNivelSeccion } from '../../hooks/useNivelSeccion'
import { TituloDialogo } from '../base/TituloDialogo'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../estados/EstadosPagina'
import { ContenidoAdaptable, type ColumnaAdaptable } from '../pagina/ContenidoAdaptable'

type Props = {
  open: boolean
  producto: { id: string; nombre: string }
  // Si se informa, la evolución se acota a ese proveedor; sin él, compara todos los proveedores del producto.
  proveedorId?: string | null
  onCerrar: () => void
}

const formatoUsd = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const formatoFecha = (iso: string) => iso.split('-').reverse().join('/')

const columnas: ColumnaAdaptable<PuntoCosto>[] = [
  { clave: 'fecha', encabezado: 'Fecha', render: (p) => formatoFecha(p.fecha) },
  { clave: 'comprobante', encabezado: 'Comprobante', render: (p) => p.comprobante ?? '—' },
  { clave: 'costo', encabezado: 'Costo unit. USD', align: 'right', render: (p) => `USD ${formatoUsd.format(p.costo_unitario_usd)}` },
]

// Una serie por proveedor, en el orden en que aparece cada uno (los puntos llegan por fecha).
function porProveedor(puntos: PuntoCosto[]) {
  const series = new Map<string, { nombre: string; puntos: PuntoCosto[] }>()
  for (const punto of puntos) {
    const serie = series.get(punto.proveedor_id) ?? { nombre: punto.proveedor_razon_social, puntos: [] }
    serie.puntos.push(punto)
    series.set(punto.proveedor_id, serie)
  }
  return [...series.entries()]
}

// «Evolución del costo» de un producto (F-PRV-07, FR-019). Se monta al abrir. Sin Rentabilidad y
// Proveedores en lectura/edición no consulta ni muestra importes.
export function DialogoEvolucionCosto({ open, producto, proveedorId = null, onCerrar }: Props) {
  return (
    <Dialog open={open} onClose={onCerrar} fullWidth maxWidth="sm" aria-labelledby="titulo-evolucion-costo">
      <Contenido producto={producto} proveedorId={proveedorId} onCerrar={onCerrar} />
    </Dialog>
  )
}

function Contenido({ producto, proveedorId, onCerrar }: Omit<Props, 'open'>) {
  const rentabilidad = useNivelSeccion('rentabilidad')
  const proveedores = useNivelSeccion('proveedores')
  const permisoListo = !rentabilidad.isLoading && !proveedores.isLoading
  const permitido = (n: string | null) => n === 'lectura' || n === 'edicion'
  const puedeVer = permisoListo && permitido(rentabilidad.nivel) && permitido(proveedores.nivel)
  const { puntos, cargando, hayError, recargar } = useHistorialCostos(producto.id, proveedorId ?? null, puedeVer)

  return (
    <>
      <TituloDialogo id="titulo-evolucion-costo" onCerrar={onCerrar}>
        Evolución del costo · {producto.nombre}
      </TituloDialogo>
      <DialogContent aria-busy={cargando}>
        {!permisoListo ? (
          <EstadoCargaPagina />
        ) : !puedeVer ? (
          <EstadoError titulo="No tenés permiso." descripcion="Ver la evolución del costo requiere acceso a Rentabilidad y a Proveedores." />
        ) : cargando ? (
          <EstadoCargaPagina />
        ) : hayError ? (
          <EstadoError descripcion="No pudimos cargar la evolución del costo." reintentar={() => void recargar()} />
        ) : puntos.length === 0 ? (
          <EstadoVacio
            titulo="Todavía no hay costos registrados."
            descripcion="Aparecen los ingresos de mercadería de este producto que se cargaron con costo."
          />
        ) : (
          <Stack spacing={3}>
            {porProveedor(puntos).map(([id, serie]) => (
              <Box key={id} component="section" aria-labelledby={`serie-costo-${id}`}>
                <Typography id={`serie-costo-${id}`} component="h3" variant="subtitle1" sx={{ mb: 1 }}>
                  {serie.nombre}
                </Typography>
                <ContenidoAdaptable
                  items={serie.puntos}
                  columnas={columnas}
                  obtenerClave={(p) => p.ingreso_id}
                  etiquetaTabla={`Costos de ${serie.nombre}`}
                />
              </Box>
            ))}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onCerrar}>Cerrar</Button>
      </DialogActions>
    </>
  )
}
