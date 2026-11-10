import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { violacionesAxe } from '../../../test/axe'
import { ErrorGuardadoPagina, type PaginaTienda } from '../../../lib/tiendaPaginas'

const mocks = vi.hoisted(() => ({
  listar: vi.fn(), guardar: vi.fn(), eliminar: vi.fn(), setWarnWhen: vi.fn(),
  nivel: { valor: 'edicion' as 'edicion' | 'lectura' | 'ninguno' },
}))

vi.mock('../../../hooks/useNivelSeccion', () => ({
  useNivelSeccion: () => ({ nivel: mocks.nivel.valor, isLoading: false, error: false }),
}))

vi.mock('@refinedev/core', () => ({
  useWarnAboutChange: () => ({ warnWhen: false, setWarnWhen: mocks.setWarnWhen }),
}))
vi.mock('../../../lib/tiendaPaginas', async (original) => ({
  ...(await original<typeof import('../../../lib/tiendaPaginas')>()),
  listarPaginas: mocks.listar,
  guardarPagina: mocks.guardar,
  eliminarPagina: mocks.eliminar,
}))

import PestanaPaginas from './pestanas/paginas'

const pagina = (n: number, visible = false): PaginaTienda => ({ id: `p-${n}`, titulo: `Página ${n}`, slug: `pagina-${n}`, contenido: `Texto ${n}`, visible })

const abrir = (empresaId = 'e-1', empresaNombre = 'Mundo JC') =>
  render(<PestanaPaginas empresaId={empresaId} empresaNombre={empresaNombre} />)

describe('pestaña Páginas (FR-004, FR-005, SC-002)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.nivel.valor = 'edicion'
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.listar.mockResolvedValue({ filas: [pagina(1, true), pagina(2)], total: 2 })
  })

  it('lista título, dirección y estado, con el contador total', async () => {
    const { container } = abrir()

    expect(await screen.findByText('Página 1')).toBeInTheDocument()
    expect(screen.getByText('/pagina/pagina-1')).toBeInTheDocument()
    expect(screen.getByText('Visible')).toBeInTheDocument()
    expect(screen.getByText('Oculta')).toBeInTheDocument()
    expect(screen.getByTestId('paginas-total')).toHaveTextContent('2 páginas')
    expect(mocks.listar).toHaveBeenCalledWith('e-1', 0)
    expect(await violacionesAxe(container)).toEqual([])
  })

  it('sin páginas muestra el vacío con «Nueva página»', async () => {
    mocks.listar.mockResolvedValue({ filas: [], total: 0 })
    abrir()

    expect(await screen.findByText('Todavía no hay páginas.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Nueva página' })).toBeInTheDocument()
  })

  it('un error de carga ofrece «Reintentar»', async () => {
    mocks.listar.mockRejectedValueOnce(new Error('falla'))
    abrir()

    fireEvent.click(await screen.findByRole('button', { name: 'Reintentar' }))

    expect(await screen.findByText('Página 1')).toBeInTheDocument()
    expect(mocks.listar).toHaveBeenCalledTimes(2)
  })

  it('«Cargar más» suma la tanda siguiente a lo ya mostrado', async () => {
    mocks.listar.mockResolvedValueOnce({ filas: [pagina(1), pagina(2)], total: 3 })
    mocks.listar.mockResolvedValueOnce({ filas: [pagina(3)], total: 3 })
    abrir()

    fireEvent.click(await screen.findByRole('button', { name: 'Cargar más' }))

    expect(await screen.findByText('Página 3')).toBeInTheDocument()
    expect(screen.getByText('Página 1')).toBeInTheDocument()
    expect(mocks.listar).toHaveBeenLastCalledWith('e-1', 2)
  })

  it('crear: valida el título, guarda oculta por defecto, avisa y recarga', async () => {
    mocks.guardar.mockResolvedValue({ ...pagina(9), titulo: 'Cómo comprar' })
    abrir()
    fireEvent.click(await screen.findByRole('button', { name: 'Nueva página' }))

    const dialogo = await screen.findByRole('dialog', { name: 'Nueva página' })
    expect(within(dialogo).getByRole('checkbox', { name: 'Visible en la tienda' })).not.toBeChecked()
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Guardar' }))
    expect(await within(dialogo).findByText('El título es obligatorio.')).toBeInTheDocument()
    expect(mocks.guardar).not.toHaveBeenCalled()

    fireEvent.change(within(dialogo).getByLabelText('Título'), { target: { value: 'Cómo comprar' } })
    fireEvent.change(within(dialogo).getByLabelText('Contenido'), { target: { value: 'Paso 1' } })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(mocks.guardar).toHaveBeenCalledWith('e-1', null, { titulo: 'Cómo comprar', contenido: 'Paso 1', visible: false }))
    expect(await screen.findByText(/Creamos la página «Cómo comprar»/)).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mocks.listar).toHaveBeenCalledTimes(2)
  })

  it('el error del servidor se muestra bajo el campo que lo causó', async () => {
    mocks.guardar.mockRejectedValue(new ErrorGuardadoPagina('El título no puede superar los 80 caracteres', 'titulo'))
    abrir()
    fireEvent.click(await screen.findByRole('button', { name: 'Nueva página' }))
    const dialogo = await screen.findByRole('dialog')
    fireEvent.change(within(dialogo).getByLabelText('Título'), { target: { value: 'Algo' } })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Guardar' }))

    expect(await within(dialogo).findByText('El título no puede superar los 80 caracteres')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('un error sin campo muestra un aviso general y no cierra el diálogo', async () => {
    mocks.guardar.mockRejectedValue(new ErrorGuardadoPagina('fallo', null))
    abrir()
    fireEvent.click(await screen.findByRole('button', { name: 'Nueva página' }))
    const dialogo = await screen.findByRole('dialog')
    fireEvent.change(within(dialogo).getByLabelText('Título'), { target: { value: 'Algo' } })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Guardar' }))

    expect(await within(dialogo).findByRole('alert')).toHaveTextContent('No pudimos guardar la página')
  })

  it('editar precarga los valores y manda el id de la página', async () => {
    mocks.guardar.mockResolvedValue(pagina(1, true))
    abrir()
    fireEvent.click(await screen.findByRole('button', { name: 'Editar Página 1' }))

    const dialogo = await screen.findByRole('dialog', { name: 'Editar página' })
    expect(within(dialogo).getByLabelText('Título')).toHaveValue('Página 1')
    expect(within(dialogo).getByRole('checkbox', { name: 'Visible en la tienda' })).toBeChecked()
    fireEvent.click(within(dialogo).getByRole('checkbox', { name: 'Visible en la tienda' }))
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(mocks.guardar).toHaveBeenCalledWith('e-1', 'p-1', { titulo: 'Página 1', contenido: 'Texto 1', visible: false }))
  })

  it('eliminar pide confirmación con el título y recién ahí borra', async () => {
    mocks.eliminar.mockResolvedValue(undefined)
    abrir()
    fireEvent.click(await screen.findByRole('button', { name: 'Eliminar Página 2' }))

    const dialogo = await screen.findByRole('dialog', { name: 'Eliminar página' })
    expect(dialogo).toHaveTextContent('«Página 2»')
    expect(mocks.eliminar).not.toHaveBeenCalled()
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Eliminar' }))

    await waitFor(() => expect(mocks.eliminar).toHaveBeenCalledWith('e-1', 'p-2'))
    expect(await screen.findByText(/Eliminamos la página «Página 2»/)).toBeInTheDocument()
  })

  it('cancelar la confirmación no borra nada', async () => {
    abrir()
    fireEvent.click(await screen.findByRole('button', { name: 'Eliminar Página 2' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancelar' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mocks.eliminar).not.toHaveBeenCalled()
  })

  it('el diálogo pasa axe', async () => {
    abrir()
    fireEvent.click(await screen.findByRole('button', { name: 'Nueva página' }))
    const dialogo = await screen.findByRole('dialog')

    expect(await violacionesAxe(dialogo)).toEqual([])
  })

  it('al cambiar de empresa se reencuadra: cierra el diálogo, descarta la lista y vuelve a pedir (Principio VIII)', async () => {
    mocks.listar.mockImplementation(async (empresaId: string) =>
      empresaId === 'e-1' ? { filas: [pagina(1)], total: 1 } : { filas: [{ ...pagina(7), titulo: 'Envíos de San Javucho' }], total: 1 })
    const { rerender } = abrir()
    fireEvent.click(await screen.findByRole('button', { name: 'Nueva página' }))
    await screen.findByRole('dialog')

    rerender(<PestanaPaginas empresaId="e-2" empresaNombre="San Javucho" />)

    expect(await screen.findByText('Envíos de San Javucho')).toBeInTheDocument()
    expect(screen.queryByText('Página 1')).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(mocks.listar).toHaveBeenLastCalledWith('e-2', 0)
  })
})

describe('pestaña Páginas: rol y tope (hallazgo 9, hallazgo 6)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.nivel.valor = 'edicion'
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.listar.mockResolvedValue({ filas: [pagina(1, true), pagina(2)], total: 2 })
  })

  it.each(['lectura', 'ninguno'] as const)('con nivel «%s» deshabilita Nueva página, Editar y Eliminar y avisa que es solo lectura', async (nivel) => {
    mocks.nivel.valor = nivel
    abrir()

    expect(await screen.findByText('Página 1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Nueva página' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Editar Página 1' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Eliminar Página 2' })).toBeDisabled()
    expect(screen.getByText(/Tu rol no puede editar las páginas de la tienda\./)).toBeInTheDocument()
  })

  it('con solo lectura y sin páginas, «Nueva página» también queda deshabilitado', async () => {
    mocks.nivel.valor = 'lectura'
    mocks.listar.mockResolvedValue({ filas: [], total: 0 })
    abrir()
    expect(await screen.findByRole('button', { name: 'Nueva página' })).toBeDisabled()
  })

  it('con edición los controles están activos y no hay aviso de solo lectura', async () => {
    abrir()
    expect(await screen.findByRole('button', { name: 'Editar Página 1' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Nueva página' })).toBeEnabled()
    expect(screen.queryByText(/Tu rol no puede editar/)).not.toBeInTheDocument()
  })

  it('si la base rechaza por rol (42501) al guardar, muestra «Tu rol no puede editar…» y no el genérico', async () => {
    mocks.guardar.mockRejectedValue(new ErrorGuardadoPagina('permission denied', null, '42501'))
    abrir()
    fireEvent.click(await screen.findByRole('button', { name: 'Editar Página 1' }))
    const dialogo = await screen.findByRole('dialog')
    fireEvent.change(within(dialogo).getByLabelText('Título'), { target: { value: 'Otro título' } })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Guardar' }))

    expect(await within(dialogo).findByRole('alert')).toHaveTextContent('Tu rol no puede editar las páginas de la tienda.')
    expect(within(dialogo).queryByText(/No pudimos guardar/)).not.toBeInTheDocument()
  })

  it('si la base rechaza por rol (42501) al eliminar, muestra el mensaje de rol', async () => {
    mocks.eliminar.mockRejectedValue(new ErrorGuardadoPagina('permission denied', null, '42501'))
    abrir()
    fireEvent.click(await screen.findByRole('button', { name: 'Eliminar Página 1' }))
    const dialogo = await screen.findByRole('dialog')
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Eliminar' }))

    expect(await within(dialogo).findByRole('alert')).toHaveTextContent('Tu rol no puede editar las páginas de la tienda.')
  })

  it('el tope de 50 páginas de la base (22023, sin campo) se muestra con su mensaje claro', async () => {
    const mensaje = 'La empresa ya tiene el máximo de 50 páginas. Eliminá alguna para crear otra'
    mocks.guardar.mockRejectedValue(new ErrorGuardadoPagina(mensaje, null, '22023'))
    abrir()
    fireEvent.click(await screen.findByRole('button', { name: 'Nueva página' }))
    const dialogo = await screen.findByRole('dialog')
    fireEvent.change(within(dialogo).getByLabelText('Título'), { target: { value: 'Una más' } })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Guardar' }))

    expect(await within(dialogo).findByRole('alert')).toHaveTextContent(mensaje)
  })

  it('con 50 páginas «Nueva página» se deshabilita y explica el máximo', async () => {
    mocks.listar.mockResolvedValue({ filas: Array.from({ length: 20 }, (_, i) => pagina(i + 1)), total: 50 })
    abrir()
    expect(await screen.findByText('Página 1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Nueva página' })).toBeDisabled()
    expect(screen.getByText(/Llegaste al máximo de 50 páginas/)).toBeInTheDocument()
  })

  it('un contenido de exactamente 10000 caracteres se guarda; 10001 se rechaza en el campo antes de llamar a la base', async () => {
    mocks.guardar.mockResolvedValue(pagina(3))
    abrir()
    fireEvent.click(await screen.findByRole('button', { name: 'Nueva página' }))
    const dialogo = await screen.findByRole('dialog')
    fireEvent.change(within(dialogo).getByLabelText('Título'), { target: { value: 'Larga' } })

    fireEvent.change(within(dialogo).getByLabelText('Contenido'), { target: { value: 'a'.repeat(10001) } })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Guardar' }))
    expect(await within(dialogo).findByText('El contenido no puede superar los 10000 caracteres.')).toBeInTheDocument()
    expect(mocks.guardar).not.toHaveBeenCalled()

    fireEvent.change(within(dialogo).getByLabelText('Contenido'), { target: { value: 'a'.repeat(10000) } })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(mocks.guardar).toHaveBeenCalledTimes(1))
  })
})
