import { Alert, Box, Button, Dialog, DialogActions, DialogContent, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material'
import { useDetalleActividad } from '../../hooks/useDetalleActividad'
import { camposDelCambio, etiquetaTipoActividad, formatearCuando } from '../../lib/actividad'
import { EstadoCargaPagina, EstadoError } from '../estados/EstadosPagina'
import { TituloDialogo } from '../base/TituloDialogo'

type Props = {
  eventoId: string
  onCerrar: () => void
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <Box>
      <Typography variant="body2" color="text.secondary">{etiqueta}</Typography>
      <Typography>{valor}</Typography>
    </Box>
  )
}

// Detalle de un evento del historial (F-AUD-02, FR-007): cuándo, tipo, tienda, quién y detalle, y campo por campo
// el valor anterior → el nuevo. Es solo consulta: no hay acción de deshacer. Un evento sin valores (anterior a la
// épica o de un tipo no sensible) lo dice. Sin identificadores técnicos visibles. El cierre al cambiar la empresa
// activa lo decide la pantalla que lo abre (Principio VIII).
export function DetalleActividadDialog({ eventoId, onCerrar }: Props) {
  const { detalle, isLoading, isError, refetch } = useDetalleActividad(eventoId)
  const campos = detalle ? camposDelCambio(detalle.valorAnterior, detalle.valorNuevo) : []

  return (
    <Dialog open onClose={onCerrar} aria-labelledby="detalle-actividad-titulo" fullWidth maxWidth="sm">
      <TituloDialogo id="detalle-actividad-titulo" onCerrar={onCerrar}>Detalle de la actividad</TituloDialogo>
      <DialogContent>
        {isLoading ? (
          <EstadoCargaPagina />
        ) : isError ? (
          <EstadoError descripcion="No pudimos cargar el detalle." reintentar={() => void refetch()} />
        ) : !detalle ? (
          <Alert severity="info">Este evento ya no está disponible.</Alert>
        ) : (
          <Stack spacing={2}>
            <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ flexWrap: 'wrap', gap: 2 }}>
              <Dato etiqueta="Cuándo" valor={formatearCuando(detalle.creadoEn)} />
              <Dato etiqueta="Tipo" valor={etiquetaTipoActividad(detalle.tipo)} />
              <Dato etiqueta="Tienda" valor={detalle.empresaNombre ?? (detalle.empresaId ? 'Empresa no disponible' : 'Compartido')} />
              <Dato etiqueta="Quién" valor={detalle.actorNombre ?? 'Sistema'} />
            </Stack>
            <Dato etiqueta="Detalle" valor={detalle.detalle} />
            {campos.length === 0 ? (
              <Typography color="text.secondary">Este evento no tiene valores registrados.</Typography>
            ) : (
              <TableContainer>
                <Table size="small" aria-label="Valores del cambio">
                  <TableHead>
                    <TableRow>
                      <TableCell>Campo</TableCell>
                      <TableCell>Antes</TableCell>
                      <TableCell>Después</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {campos.map((campo) => (
                      <TableRow key={campo.campo}>
                        <TableCell>{campo.campo}</TableCell>
                        <TableCell>{campo.anterior}</TableCell>
                        <TableCell>{campo.nuevo}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onCerrar} autoFocus>Cerrar</Button>
      </DialogActions>
    </Dialog>
  )
}
