import CloseIcon from '@mui/icons-material/Close'
import { Box, Dialog, IconButton } from '@mui/material'
import { usePantallaChica } from '../useAnchoCelular'

// Imagen ampliada (F-TDA-13, FR-053): diálogo modal de MUI, que gestiona el foco (lo lleva adentro al
// abrir, lo devuelve al disparador al cerrar y atrapa el Tab) y cierra con Esc o con el botón.
export function Ampliacion({ abierta, url, nombre, onCerrar }: { abierta: boolean; url: string; nombre: string; onCerrar: () => void }) {
  // En celular (F-TDA-17, FR-042) ocupa toda la pantalla: la imagen se ve lo más grande posible.
  const pantallaChica = usePantallaChica()
  return (
    <Dialog
      open={abierta}
      onClose={onCerrar}
      maxWidth="md"
      fullWidth
      fullScreen={pantallaChica}
      // El nombre va en el Paper, que es el que lleva role="dialog".
      slotProps={{ paper: { 'aria-label': `Imagen ampliada de ${nombre}` } }}
    >
      <IconButton
        aria-label="Cerrar imagen ampliada"
        onClick={onCerrar}
        autoFocus
        sx={{ position: 'absolute', top: 8, right: 8, width: 48, height: 48, bgcolor: 'background.paper', '&:hover': { bgcolor: 'background.paper' } }}
      >
        <CloseIcon />
      </IconButton>
      <Box component="img" src={url} alt={nombre} sx={{ display: 'block', width: '100%', maxHeight: { xs: '100vh', sm: '85vh' }, height: { xs: '100%', sm: 'auto' }, objectFit: 'contain' }} />
    </Dialog>
  )
}
