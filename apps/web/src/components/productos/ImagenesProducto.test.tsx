import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { type CambiosImagenes, type ImagenExistente, SIN_CAMBIOS_IMAGENES } from '../../lib/productoImagenes'
import { ImagenesProducto } from './ImagenesProducto'

const EXISTENTES: ImagenExistente[] = [
  { id: 'i-1', posicion: 1, ruta: 'o/p/a.png', url: 'https://firmada/a' },
  { id: 'i-2', posicion: 2, ruta: 'o/p/b.png', url: 'https://firmada/b' },
]

const archivo = (nombre: string, tipo = 'image/png', tamano = 10) => {
  const f = new File(['x'], nombre, { type: tipo })
  Object.defineProperty(f, 'size', { value: tamano })
  return f
}

function Montado({ existentes = EXISTENTES, soloLectura = false }: { existentes?: ImagenExistente[]; soloLectura?: boolean }) {
  const [cambios, setCambios] = useState<CambiosImagenes>(SIN_CAMBIOS_IMAGENES)
  return (
    <>
      <ImagenesProducto existentes={existentes} cambios={cambios} onCambiar={setCambios} soloLectura={soloLectura} />
      <output data-testid="resumen">{`${cambios.nuevas.length}/${cambios.eliminadas.length}`}</output>
    </>
  )
}

const elegir = (...archivos: File[]) => fireEvent.change(screen.getByTestId('entrada-imagenes'), { target: { files: archivos } })

describe('ImagenesProducto', () => {
  it('explica los límites y marca la primera como principal', () => {
    render(<Montado />)
    expect(screen.getByText('Hasta 4 imágenes JPG, PNG o WebP de hasta 2 MB. La primera es la principal.')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Imagen 1 (principal)' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Imagen 2' })).toBeInTheDocument()
  })

  it('rechaza formato y tamaño con mensajes claros y no las agrega', () => {
    render(<Montado />)
    elegir(archivo('a.gif', 'image/gif'), archivo('grande.png', 'image/png', 3 * 1024 * 1024))
    expect(screen.getByText('«a.gif» no es JPG, PNG ni WebP.')).toBeInTheDocument()
    expect(screen.getByText('«grande.png» pesa más de 2 MB.')).toBeInTheDocument()
    expect(screen.getByTestId('resumen')).toHaveTextContent('0/0')
  })

  it('no deja pasar de 4 y deshabilita agregar', () => {
    render(<Montado />)
    elegir(archivo('c.png'), archivo('d.png'), archivo('e.png'))
    expect(screen.getByText(/Ya hay 4 imágenes: quitá alguna para agregar «e.png»/)).toBeInTheDocument()
    expect(screen.getByTestId('resumen')).toHaveTextContent('2/0')
    expect(screen.getByRole('button', { name: 'Agregar imágenes' })).toBeDisabled()
  })

  it('quitar una existente la marca para eliminar y promueve a la siguiente', () => {
    render(<Montado />)
    fireEvent.click(screen.getByRole('button', { name: 'Quitar imagen 1' }))
    expect(screen.getByTestId('resumen')).toHaveTextContent('0/1')
    expect(screen.getByRole('img', { name: 'Imagen 1 (principal)' })).toHaveAttribute('src', 'https://firmada/b')
  })

  it('quitar una nueva la descarta sin tocar las guardadas', () => {
    render(<Montado existentes={[]} />)
    elegir(archivo('n.png'))
    expect(screen.getByRole('img', { name: 'Imagen 1 (principal), se sube al guardar' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Quitar imagen 1' }))
    expect(screen.getByTestId('resumen')).toHaveTextContent('0/0')
    expect(screen.getByText('Todavía no hay imágenes.')).toBeInTheDocument()
  })

  it('en solo lectura no ofrece agregar ni quitar', () => {
    render(<Montado soloLectura />)
    expect(screen.queryByRole('button', { name: /Quitar imagen|Agregar imágenes/ })).not.toBeInTheDocument()
    expect(screen.queryByTestId('entrada-imagenes')).not.toBeInTheDocument()
  })

  it('sin imágenes en solo lectura lo dice', () => {
    render(<Montado existentes={[]} soloLectura />)
    expect(screen.getByText('Este producto no tiene imágenes.')).toBeInTheDocument()
  })
})
