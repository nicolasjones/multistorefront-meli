import { useState } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { type CambiosImagenes, type ImagenExistente, SIN_CAMBIOS_IMAGENES } from '../../lib/productoImagenes'
import { ImagenesProducto } from './ImagenesProducto'

const optimizar = vi.hoisted(() => vi.fn())
vi.mock('../../lib/optimizarImagen', () => ({ optimizarImagen: optimizar, ImagenDemasiadoGrandeError: class extends Error {} }))

// Promesa diferida para controlar cuándo termina cada optimización.
function diferida<T>() {
  let resolver!: (valor: T) => void
  const promesa = new Promise<T>((resolve) => { resolver = resolve })
  return { promesa, resolver }
}

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
  beforeEach(() => optimizar.mockReset().mockImplementation(async (f: File) => f))

  it('explica los límites y marca la primera como principal', () => {
    render(<Montado />)
    expect(screen.getByText('Hasta 4 imágenes JPG, PNG o WebP de hasta 15 MB; se optimizan automáticamente. La primera es la principal.')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Imagen 1 (principal)' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Imagen 2' })).toBeInTheDocument()
  })

  it('rechaza formato y tamaño con mensajes claros y no las agrega', async () => {
    render(<Montado />)
    elegir(archivo('a.gif', 'image/gif'), archivo('grande.png', 'image/png', 16 * 1024 * 1024))
    expect(await screen.findByText('«a.gif» no es JPG, PNG ni WebP.')).toBeInTheDocument()
    expect(screen.getByText('«grande.png» pesa más de 15 MB.')).toBeInTheDocument()
    expect(screen.getByTestId('resumen')).toHaveTextContent('0/0')
  })

  it('acepta una foto de 12 MB de origen: si el resultado sigue pasando de 2 MB, da un error claro', async () => {
    render(<Montado />)
    elegir(archivo('enorme.png', 'image/png', 12 * 1024 * 1024))
    // Sin soporte de decodificación (jsdom) se conserva el original, que supera 2 MB.
    expect(await screen.findByText('«enorme.png» sigue pesando más de 2 MB aun optimizada: usá una imagen más chica.')).toBeInTheDocument()
    expect(screen.getByTestId('resumen')).toHaveTextContent('0/0')
  })

  it('no deja pasar de 4 y deshabilita agregar', async () => {
    render(<Montado />)
    elegir(archivo('c.png'), archivo('d.png'), archivo('e.png'))
    expect(await screen.findByText(/Ya hay 4 imágenes: quitá alguna para agregar «e.png»/)).toBeInTheDocument()
    expect(screen.getByTestId('resumen')).toHaveTextContent('2/0')
    expect(screen.getByRole('button', { name: 'Agregar imágenes' })).toBeDisabled()
  })

  it('quitar una existente la marca para eliminar y promueve a la siguiente', () => {
    render(<Montado />)
    fireEvent.click(screen.getByRole('button', { name: 'Quitar imagen 1' }))
    expect(screen.getByTestId('resumen')).toHaveTextContent('0/1')
    expect(screen.getByRole('img', { name: 'Imagen 1 (principal)' })).toHaveAttribute('src', 'https://firmada/b')
  })

  it('quitar una nueva la descarta sin tocar las guardadas', async () => {
    render(<Montado existentes={[]} />)
    elegir(archivo('n.png'))
    await waitFor(() => expect(screen.getByTestId('resumen')).toHaveTextContent('1/0'))
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

  describe('con la optimización en curso', () => {
    it('deshabilita Agregar y Quitar y avisa; la eliminación previa no se pisa', async () => {
      const d = diferida<File>()
      optimizar.mockReset().mockReturnValue(d.promesa)
      render(<Montado />)
      fireEvent.click(screen.getByRole('button', { name: 'Quitar imagen 2' }))
      expect(screen.getByTestId('resumen')).toHaveTextContent('0/1')
      elegir(archivo('n.png'))
      expect(await screen.findByText('Optimizando imágenes…')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Agregar imágenes' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Quitar imagen 1' })).toBeDisabled()
      await act(async () => d.resolver(archivo('n.webp', 'image/webp')))
      await waitFor(() => expect(screen.getByTestId('resumen')).toHaveTextContent('1/1'))
      expect(screen.queryByText('Optimizando imágenes…')).not.toBeInTheDocument()
    })

    it('dos selecciones seguidas no pierden fotos y respetan el tope de 4 con el estado actual', async () => {
      const d1 = diferida<File>()
      const d2 = diferida<File>()
      const d3 = diferida<File>()
      optimizar.mockReset().mockReturnValueOnce(d1.promesa).mockReturnValueOnce(d2.promesa).mockReturnValueOnce(d3.promesa)
      render(<Montado />)
      elegir(archivo('a.png'))
      elegir(archivo('b.png'), archivo('c.png'))
      await act(async () => { d1.resolver(archivo('a.webp', 'image/webp')) })
      await act(async () => { d2.resolver(archivo('b.webp', 'image/webp')) })
      await act(async () => { d3.resolver(archivo('c.webp', 'image/webp')) })
      // 2 existentes + máximo 2 nuevas: nunca más de 4 en total.
      await waitFor(() => expect(screen.getByTestId('resumen')).toHaveTextContent('2/0'))
      expect(screen.getAllByRole('img')).toHaveLength(4)
    })

    it('en un lote con un archivo rechazado en el medio agrega los demás e informa el error', async () => {
      optimizar.mockReset().mockImplementation(async (f: File) => f)
      render(<Montado existentes={[]} />)
      elegir(archivo('a.png'), archivo('b.gif', 'image/gif'), archivo('c.png'))
      expect(await screen.findByText('«b.gif» no es JPG, PNG ni WebP.')).toBeInTheDocument()
      await waitFor(() => expect(screen.getByTestId('resumen')).toHaveTextContent('2/0'))
    })
  })
})
