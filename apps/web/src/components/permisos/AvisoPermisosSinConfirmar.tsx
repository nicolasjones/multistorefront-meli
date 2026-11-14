import { Alert, Box, Button, Typography } from '@mui/material'

// MSF-855: aviso NO bloqueante que acompaña a un formulario inerte cuando falló el repedido de permisos de la
// MISMA clave `usuario:organización` con la pantalla abierta. No roba el foco; «Reintentar» es un botón normal
// (alcanzable con el teclado) y mientras verifica queda `aria-disabled` (sigue enfocable, no dispara otro pedido).
export function AvisoPermisosSinConfirmar({ reintentar, verificando }: { reintentar?: () => void; verificando: boolean }) {
  return (
    <Alert
      severity="warning"
      role="note"
      sx={{ mb: 2 }}
      action={
        reintentar ? (
          <Button color="inherit" size="small" aria-disabled={verificando} onClick={() => { if (!verificando) reintentar() }}>
            Reintentar
          </Button>
        ) : undefined
      }
    >
      <Typography component="p" fontWeight={600}>No pudimos verificar tus permisos.</Typography>
      <Box component="span">
        {verificando
          ? 'Verificando tu acceso…'
          : 'Lo que cargaste sigue acá, pero no se puede editar ni guardar hasta confirmar tu acceso. Reintentá en unos segundos.'}
      </Box>
    </Alert>
  )
}
