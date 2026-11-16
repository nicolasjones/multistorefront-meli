import { Alert, Button, Snackbar } from '@mui/material'
import type { ReactNode } from 'react'
import type { AvisoCuenta } from './aviso'

// Aviso breve de resultado de la tienda (F-CLI-20, reglas comunes de «Pantallas y textos»): `Snackbar` de 4 s. Las
// confirmaciones se anuncian con `aria-live="polite"` y los errores con `assertive`; la acción (p. ej. «Deshacer»,
// «Ver lista») es un botón operable con teclado. Un aviso nuevo (otra `clave`) reemplaza al anterior.
export function AvisoTienda({ aviso, alCerrar }: { aviso: AvisoCuenta | null; alCerrar: () => void }): ReactNode {
  return (
    <Snackbar
      key={aviso?.clave}
      open={aviso !== null}
      autoHideDuration={4000}
      onClose={(_evento, motivo) => { if (motivo !== 'clickaway') alCerrar() }}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
    >
      {aviso ? (
        <Alert
          severity={aviso.error ? 'error' : 'success'}
          variant="filled"
          role={aviso.error ? 'alert' : 'status'}
          aria-live={aviso.error ? 'assertive' : 'polite'}
          sx={{ width: '100%', alignItems: 'center', overflowWrap: 'anywhere' }}
          action={aviso.accion ? (
            <Button color="inherit" size="small" onClick={() => { aviso.accion?.alElegir(); alCerrar() }} sx={{ minHeight: (tema) => tema.spacing(5.5) }}>
              {aviso.accion.etiqueta}
            </Button>
          ) : undefined}
        >
          {aviso.mensaje}
        </Alert>
      ) : <span />}
    </Snackbar>
  )
}
