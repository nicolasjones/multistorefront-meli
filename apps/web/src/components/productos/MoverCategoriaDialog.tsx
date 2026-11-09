import { Alert, Box, Button, Dialog, DialogActions, DialogContent, List, ListItemButton, ListItemText, Typography } from '@mui/material'
import { useEjecutarEdicionMasiva } from '../../hooks/useEjecutarEdicionMasiva'
import { type Categoria, opcionesCategoriaProducto } from '../../lib/categorias'
import { avisoResultado, moverProductosCategoria, productosN } from '../../lib/edicionMasiva'
import { supabaseClient } from '../../lib/supabase'
import { TituloDialogo } from '../base/TituloDialogo'

type Props = {
  open: boolean
  ids: readonly string[]
  categorias: readonly Categoria[]
  onCerrar: () => void
  onHecho: (aviso: string) => void
}

// «Mover de categoría» (F-CAT-12, FR-003): árbol de categorías de MSF-160 con sangría por nivel; al elegir
// una se mueve y se avisa. El prototipo dice «hasta 3.er nivel»; el árbol es de 2 niveles (Decisión 3).
export function MoverCategoriaDialog({ open, ids, categorias, onCerrar, onHecho }: Props) {
  const { enCurso, error, ejecutar, limpiarError } = useEjecutarEdicionMasiva()
  const opciones = opcionesCategoriaProducto(categorias)
  const cerrar = () => { if (!enCurso) { limpiarError(); onCerrar() } }

  const mover = async (id: string, ruta: string) => {
    const cambiados = await ejecutar(() => moverProductosCategoria(supabaseClient, ids, id))
    if (cambiados === null) return
    onHecho(avisoResultado(cambiados, { singular: 'movido', plural: 'movidos' }, ruta))
  }

  return (
    <Dialog open={open} onClose={cerrar} fullWidth maxWidth="sm" aria-labelledby="titulo-mover-categoria">
      <TituloDialogo id="titulo-mover-categoria" onCerrar={cerrar}>Mover de categoría</TituloDialogo>
      <DialogContent>
        <Typography variant="body2" sx={{ mb: 1.5 }}>
          {ids.length === 1 ? 'Se mueve 1 producto' : `Se mueven ${productosN(ids.length)}`} a la categoría elegida.
        </Typography>
        {error ? <Alert severity="error" sx={{ mb: 1.5 }}>{error}</Alert> : null}
        {opciones.length === 0 ? (
          <Typography variant="body2" color="text.secondary">Todavía no hay categorías para elegir.</Typography>
        ) : (
          <Box sx={{ maxHeight: 300, overflow: 'auto', border: 1, borderColor: 'divider', borderRadius: 1, p: 0.5 }}>
            <List dense disablePadding aria-label="Categorías">
              {opciones.map((opcion) => (
                <ListItemButton key={opcion.id} disabled={enCurso} onClick={() => void mover(opcion.id, opcion.ruta)} sx={{ pl: opcion.nivel === 1 ? 4 : 2 }}>
                  <ListItemText primary={opcion.nivel === 1 ? opcion.ruta.split(' > ').pop() : opcion.ruta} />
                </ListItemButton>
              ))}
            </List>
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={cerrar} disabled={enCurso}>Cancelar</Button>
      </DialogActions>
    </Dialog>
  )
}
