import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MENSAJE_NOMBRE_REPETIDO, type Categoria } from '../../lib/categorias'
import { FormularioCategoria } from './FormularioCategoria'

const cat = (id: string, nombre: string, padre_id: string | null = null, empresa_ids: string[] = []): Categoria => ({
  id, nombre, padre_id, posicion: 0, empresa_ids,
})

const CATEGORIAS = [cat('joy', 'Joysticks', null, ['e1', 'e2']), cat('cab', 'Cableados', 'joy', ['e2']), cat('fun', 'Fundas')]
const EMPRESAS = [
  { id: 'e1', nombre: 'San Javucho', activa: true },
  { id: 'e2', nombre: 'Mundo JC', activa: true },
  { id: 'e3', nombre: 'Vieja SA', activa: false },
]

const abrir = (extra: Partial<Parameters<typeof FormularioCategoria>[0]> = {}) => {
  const onGuardar = vi.fn().mockResolvedValue(undefined)
  const onCancelar = vi.fn()
  const utils = render(
    <FormularioCategoria categoria={null} categorias={CATEGORIAS} empresas={EMPRESAS} onCancelar={onCancelar} onGuardar={onGuardar} {...extra} />,
  )
  return { ...utils, onGuardar, onCancelar }
}

describe('FormularioCategoria (F-CAT-08, FR-020)', () => {
  it('pide Nombre, Categoría padre solo raíces y Visible en con todas las tiendas marcadas al crear', () => {
    abrir()
    expect(screen.getByRole('dialog', { name: 'Nueva categoría' })).toBeInTheDocument()
    expect(screen.getByLabelText(/^Nombre/)).toHaveValue('')
    expect(screen.getByLabelText('Categoría padre (opcional)')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'San Javucho' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Mundo JC' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Vieja SA (inactiva)' })).toBeChecked()
    expect(screen.getByText('Ruta: «Nueva categoría»')).toBeInTheDocument()
  })

  it('muestra el nombre vacío como error y no llama a guardar', async () => {
    const { onGuardar } = abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(await screen.findByText('El nombre es obligatorio.')).toBeInTheDocument()
    expect(onGuardar).not.toHaveBeenCalled()
  })

  it('rechaza un nombre repetido en el mismo nivel sin perder lo escrito', async () => {
    const { onGuardar } = abrir()
    fireEvent.change(screen.getByLabelText(/^Nombre/), { target: { value: '  fundas ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(await screen.findByText(MENSAJE_NOMBRE_REPETIDO)).toBeInTheDocument()
    expect(screen.getByLabelText(/^Nombre/)).toHaveValue('  fundas ')
    expect(onGuardar).not.toHaveBeenCalled()
  })

  it('guarda con el padre raíz elegido, la visibilidad marcada y la ruta resultante', async () => {
    const { onGuardar } = abrir()
    fireEvent.change(screen.getByLabelText(/^Nombre/), { target: { value: 'Nueva' } })
    fireEvent.mouseDown(screen.getByLabelText('Categoría padre (opcional)'))
    fireEvent.click(await screen.findByRole('option', { name: 'Joysticks' }))
    expect(screen.getByText('Ruta: «Joysticks > Nueva»')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Vieja SA (inactiva)' }))
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(onGuardar).toHaveBeenCalledWith({ id: null, nombre: 'Nueva', padreId: 'joy', empresaIds: ['e1', 'e2'], alicuotaId: null, alicuotaOriginalId: null }))
  })

  it('al editar precarga los datos y conserva el diálogo si el servidor rechaza el nombre repetido', async () => {
    const onGuardar = vi.fn().mockRejectedValue({ code: '23505', message: MENSAJE_NOMBRE_REPETIDO })
    render(<FormularioCategoria categoria={CATEGORIAS[1]} categorias={CATEGORIAS} empresas={EMPRESAS} onCancelar={vi.fn()} onGuardar={onGuardar} />)
    expect(screen.getByRole('dialog', { name: 'Editar categoría' })).toBeInTheDocument()
    expect(screen.getByLabelText(/^Nombre/)).toHaveValue('Cableados')
    expect(screen.getByRole('checkbox', { name: 'San Javucho' })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Mundo JC' })).toBeChecked()
    fireEvent.change(screen.getByLabelText(/^Nombre/), { target: { value: 'Cableados' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(onGuardar).toHaveBeenCalledWith({ id: 'cab', nombre: 'Cableados', padreId: 'joy', empresaIds: ['e2'], alicuotaId: null, alicuotaOriginalId: null }))
    expect(await screen.findByText(MENSAJE_NOMBRE_REPETIDO)).toBeInTheDocument()
    expect(screen.getByLabelText(/^Nombre/)).toHaveValue('Cableados')
  })

  it('muestra otros errores del servidor sin cerrar el diálogo', async () => {
    const onGuardar = vi.fn().mockRejectedValue({ code: '42501', message: 'Tu rol no puede editar categorías' })
    render(<FormularioCategoria categoria={null} categorias={CATEGORIAS} empresas={EMPRESAS} onCancelar={vi.fn()} onGuardar={onGuardar} />)
    fireEvent.change(screen.getByLabelText(/^Nombre/), { target: { value: 'Nueva' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Tu rol no puede editar categorías')
    expect(screen.getByRole('dialog', { name: 'Nueva categoría' })).toBeInTheDocument()
  })

  it('una categoría con subcategorías no ofrece padre y lo explica (2 niveles)', () => {
    render(<FormularioCategoria categoria={CATEGORIAS[0]} categorias={CATEGORIAS} empresas={EMPRESAS} onCancelar={vi.fn()} onGuardar={vi.fn()} />)
    fireEvent.mouseDown(screen.getByLabelText('Categoría padre (opcional)'))
    expect(screen.getAllByRole('option')).toHaveLength(1)
    expect(screen.getByRole('option', { name: 'Ninguna (categoría raíz)' })).toBeInTheDocument()
    expect(screen.getByText('Tiene subcategorías: solo puede ser una categoría raíz (máximo 2 niveles).')).toBeInTheDocument()
  })

  it('sin ninguna tienda marcada avisa que no se verá en ninguna', () => {
    abrir({ empresas: [] })
    expect(screen.getByText('Todavía no hay empresas cargadas.')).toBeInTheDocument()
    expect(screen.getByText('Sin ninguna tienda marcada, la categoría no se ve en ninguna.')).toBeInTheDocument()
  })
})
