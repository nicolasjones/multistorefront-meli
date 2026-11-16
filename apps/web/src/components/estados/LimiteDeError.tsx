import { Component, type ErrorInfo, type ReactNode } from 'react'
import { EstadoError } from './EstadosPagina'

type Props = { children: ReactNode; titulo?: string }
type Estado = { error: Error | null }

// Contiene el error de dibujado de una parte de la pantalla (p. ej. el contenido de una pestaña) para que no se caiga toda la
// aplicación en silencio: muestra qué falló y ofrece reintentar. Se reinicia solo al cambiar la `key` desde afuera.
export class LimiteDeError extends Component<Props, Estado> {
  state: Estado = { error: null }

  static getDerivedStateFromError(error: Error): Estado {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Error al dibujar una sección de la pantalla.', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <EstadoError
          titulo={this.props.titulo ?? 'No pudimos mostrar esta sección.'}
          descripcion={this.state.error.message}
          reintentar={() => this.setState({ error: null })}
        />
      )
    }
    return this.props.children
  }
}
