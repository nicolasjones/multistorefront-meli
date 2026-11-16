import { Alert, Button, Snackbar } from '@mui/material'
import type { MensajeExportacion } from '../../hooks/useExportarCsv'

type Props = {
  exportar: () => void
  exportando: boolean
  mensaje: MensajeExportacion | null
  cerrarMensaje: () => void
}

// Botón «Exportar» de Stock actual y Movimientos (F-STK-08, FR-101/FR-107): «Exportando…»
// mientras corre y un aviso con reintento si falla. La lógica vive en `useExportarCsv`.
export function ExportarCsvBoton({ exportar, exportando, mensaje, cerrarMensaje }: Props) {
  return (
    <>
      <Button variant="outlined" onClick={exportar} disabled={exportando} aria-busy={exportando}>
        {exportando ? 'Exportando…' : 'Exportar'}
      </Button>
      <Snackbar open={mensaje !== null} onClose={(_, motivo) => { if (motivo !== 'clickaway') cerrarMensaje() }}>
        {mensaje ? (
          <Alert
            severity={mensaje.tipo === 'error' ? 'error' : 'info'}
            action={
              <>
                {mensaje.tipo === 'error' ? <Button color="inherit" size="small" onClick={exportar}>Reintentar</Button> : null}
                <Button color="inherit" size="small" onClick={cerrarMensaje}>Cerrar</Button>
              </>
            }
          >
            {mensaje.texto}
          </Alert>
        ) : undefined}
      </Snackbar>
    </>
  )
}
