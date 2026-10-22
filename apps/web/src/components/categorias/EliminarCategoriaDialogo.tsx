import { useRef, useState } from 'react'
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogContentText } from '@mui/material'
import { TituloDialogo } from '../base/TituloDialogo'
import { mensajeErrorCategoria, type NodoCategoria } from '../../lib/categorias'

type Props = {
  categoria: NodoCategoria
  onCancelar: () => void
  // Rechaza con el error del servidor; el diálogo queda abierto para reintentar.
  onConfirmar: () => Promise<void>
}

const productos = (n: number) => `${n} ${n === 1 ? 'producto' : 'productos'}`
const subcategorias = (n: number) => `${n} ${n === 1 ? 'subcategoría' : 'subcategorías'}`

// Diálogo «Eliminar categoría» (F-CAT-08, FR-021). Texto del prototipo: los productos quedan sin
// categoría y las subcategorías suben un nivel (pasan a raíz). La confirmación es atómica en la base
// (`eliminar_categoria`); si el nombre de una subcategoría choca con el de una raíz, la base la rechaza
// y el mensaje se muestra acá sin cerrar el diálogo.
export function EliminarCategoriaDialogo({ categoria, onCancelar, onConfirmar }: Props) {
  const [eliminando, setEliminando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const enVuelo = useRef(false)

  const confirmar = async () => {
    if (enVuelo.current) return
    enVuelo.current = true
    setEliminando(true)
    setError(null)
    try {
      await onConfirmar()
    } catch (excepcion) {
      setError(mensajeErrorCategoria(excepcion, 'No pudimos eliminar la categoría. Probá de nuevo.'))
    } finally {
      enVuelo.current = false
      setEliminando(false)
    }
  }

  return (
    <Dialog open onClose={eliminando ? undefined : onCancelar} aria-labelledby="eliminar-categoria-titulo">
      <TituloDialogo id="eliminar-categoria-titulo" onCerrar={eliminando ? undefined : onCancelar}>Eliminar categoría</TituloDialogo>
      <DialogContent>
        {error ? <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert> : null}
        <DialogContentText>
          «{categoria.nombre}» tiene {productos(categoria.productos_directos)} y {subcategorias(categoria.hijos.length)}. Los productos quedan sin categoría y las subcategorías suben un nivel.
        </DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancelar} disabled={eliminando} autoFocus>Cancelar</Button>
        <Button color="error" variant="contained" onClick={() => void confirmar()} disabled={eliminando}>
          {eliminando ? 'Eliminando…' : 'Eliminar'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
