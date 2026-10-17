import { useState } from 'react'
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Typography } from '@mui/material'
import type { ClienteListado } from '../../hooks/useBuscarClientes'

// Botón «Etiquetas» (prototipo Clientes · Listado): vista previa de las etiquetas de los
// seleccionados (nombre + número + documento) con impresión del navegador.
export function EtiquetasClientes({ seleccionados }: { seleccionados: ClienteListado[] }) {
  const [abierto, setAbierto] = useState(false)
  return (
    <>
      <Button variant="outlined" disabled={seleccionados.length === 0} onClick={() => setAbierto(true)}>
        Etiquetas
      </Button>
      <Dialog open={abierto} onClose={() => setAbierto(false)} aria-labelledby="etiquetas-titulo" fullWidth maxWidth="sm">
        <DialogTitle id="etiquetas-titulo">Etiquetas ({seleccionados.length})</DialogTitle>
        <DialogContent>
          <Stack spacing={1}>
            {seleccionados.map((c) => (
              <Box key={c.id} sx={{ border: '1px dashed', borderColor: 'divider', borderRadius: 1, p: 1 }}>
                <Typography fontWeight={600}>{c.nombre}</Typography>
                <Typography variant="body2" color="text.secondary">
                  N.º {c.numero}{c.documento ? ` · ${c.documento}` : ''}
                </Typography>
              </Box>
            ))}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAbierto(false)}>Cerrar</Button>
          <Button variant="contained" onClick={() => window.print()}>Imprimir</Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
