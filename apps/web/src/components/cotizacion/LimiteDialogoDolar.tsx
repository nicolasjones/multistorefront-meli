import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Alert, Button } from '@mui/material'

type Props = { children: ReactNode; onCerrar: () => void }
type Estado = { fallo: boolean }

// Límite de errores del diálogo de carga del dólar de Inicio, que se baja con `lazy`: si el chunk no carga (red
// cortada, versión nueva publicada) o el diálogo revienta, la tarjeta de Inicio sigue viva y avisa en vez de
// dejar la pantalla en blanco.
export class LimiteDialogoDolar extends Component<Props, Estado> {
  state: Estado = { fallo: false }

  static getDerivedStateFromError(): Estado {
    return { fallo: true }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('No pudimos abrir el diálogo del dólar.', error, info.componentStack)
  }

  render() {
    if (!this.state.fallo) return this.props.children
    return (
      <Alert severity="error" sx={{ width: '100%' }} action={<Button color="inherit" size="small" onClick={this.props.onCerrar}>Cerrar</Button>}>
        No pudimos abrir la carga del dólar. Recargá la página e intentá de nuevo.
      </Alert>
    )
  }
}
