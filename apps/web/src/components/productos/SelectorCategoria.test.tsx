import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Categoria } from '../../lib/categorias'
import { SelectorCategoria } from './SelectorCategoria'

const cat = (id: string, nombre: string, padre_id: string | null = null): Categoria => ({
  id, nombre, padre_id, posicion: 0, empresa_ids: [],
})

const CATEGORIAS = [cat('joy', 'Joysticks'), cat('cab', 'Cableados', 'joy'), cat('fun', 'Fundas')]

describe('SelectorCategoria (F-CAT-08, FR-022)', () => {
  it('ofrece sin categoría y las raíces con sus subcategorías en ruta «Padre > Hija»', async () => {
    render(<SelectorCategoria categorias={CATEGORIAS} valor="" onCambiar={vi.fn()} />)
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Categoría' }))
    const opciones = await screen.findAllByRole('option')
    expect(opciones.map((opcion) => opcion.textContent)).toEqual([
      'Sin categoría',
      'Fundas',
      'Joysticks',
      'Joysticks > Cableados',
    ])
  })

  it('elegir una categoría devuelve su id y permite quitarla', async () => {
    const onCambiar = vi.fn()
    render(<SelectorCategoria categorias={CATEGORIAS} valor="" onCambiar={onCambiar} />)
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Categoría' }))
    fireEvent.click(await screen.findByRole('option', { name: 'Joysticks > Cableados' }))
    expect(onCambiar).toHaveBeenCalledWith('cab')
  })

  it('en solo lectura está deshabilitado', () => {
    render(<SelectorCategoria categorias={CATEGORIAS} valor="joy" onCambiar={vi.fn()} soloLectura />)
    expect(screen.getByRole('combobox', { name: 'Categoría' })).toHaveAttribute('aria-disabled', 'true')
  })

  it('cargando deshabilita el selector y lo explica', () => {
    render(<SelectorCategoria categorias={[]} valor="" onCambiar={vi.fn()} cargando />)
    expect(screen.getByText('Cargando categorías…')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Categoría' })).toHaveAttribute('aria-disabled', 'true')
  })

  it('si la categoría actual no está en la lista no muestra un id técnico y avisa', async () => {
    render(<SelectorCategoria categorias={CATEGORIAS} valor="no-visible" onCambiar={vi.fn()} />)
    expect(screen.queryByText('no-visible')).toBeNull()
    expect(screen.getByText('La categoría actual no se puede mostrar con tu rol; se conserva si no la cambiás.')).toBeInTheDocument()
  })

  it('error de carga con reintento', () => {
    const onReintentar = vi.fn()
    render(<SelectorCategoria categorias={[]} valor="" onCambiar={vi.fn()} hayError onReintentar={onReintentar} />)
    expect(screen.getByText('No pudimos cargar las categorías.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar categorías' }))
    expect(onReintentar).toHaveBeenCalled()
  })
})
