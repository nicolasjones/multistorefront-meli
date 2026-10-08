import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { EstadoCargaPagina, EstadoError, EstadoExito, EstadoVacio } from './EstadosPagina'

describe('EstadoCargaPagina', () => {
  it('muestra feedback visual inmediato con semántica de estado (T037: antes de que resuelva cualquier carga)', () => {
    render(<EstadoCargaPagina />)

    expect(screen.getByRole('status', { name: 'Cargando contenido' })).toBeInTheDocument()
  })

  it('permite ajustar la cantidad de líneas del skeleton', () => {
    const { container } = render(<EstadoCargaPagina lineas={5} />)

    expect(container.querySelectorAll('.MuiSkeleton-root')).toHaveLength(5)
  })
})

describe('EstadoVacio', () => {
  it('explica la ausencia de datos en vez de dejar un área en blanco', () => {
    render(<EstadoVacio titulo="Todavía no hay nada acá." descripcion="Creá el primero para empezar." />)

    expect(screen.getByText('Todavía no hay nada acá.')).toBeInTheDocument()
    expect(screen.getByText('Creá el primero para empezar.')).toBeInTheDocument()
  })
})

describe('EstadoExito', () => {
  it('comunica un resultado positivo con severidad success', () => {
    render(<EstadoExito titulo="Listo." />)

    expect(screen.getByRole('alert')).toHaveClass('MuiAlert-standardSuccess')
    expect(screen.getByText('Listo.')).toBeInTheDocument()
  })
})

describe('EstadoError', () => {
  it('usa un título por defecto cuando no se especifica uno', () => {
    render(<EstadoError />)

    expect(screen.getByText('No pudimos cargar esta información.')).toBeInTheDocument()
  })

  it('ofrece un botón de reintentar que ejecuta la función provista', async () => {
    const reintentar = vi.fn()
    render(<EstadoError reintentar={reintentar} />)

    screen.getByRole('button', { name: 'Reintentar' }).click()

    expect(reintentar).toHaveBeenCalledTimes(1)
  })

  it('no ofrece reintentar cuando no hay una función de recuperación', () => {
    render(<EstadoError />)

    expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument()
  })
})
