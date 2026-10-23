import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { violacionesAxe } from '../../../test/axe'
import { CONTENIDO_VACIO, ErrorGuardadoContenido } from '../../../lib/tiendaContenido'

const mocks = vi.hoisted(() => ({ leer: vi.fn(), guardar: vi.fn(), setWarnWhen: vi.fn() }))

vi.mock('@refinedev/core', () => ({
  useWarnAboutChange: () => ({ warnWhen: false, setWarnWhen: mocks.setWarnWhen }),
}))
vi.mock('../../../lib/tiendaContenido', async (original) => ({
  ...(await original<typeof import('../../../lib/tiendaContenido')>()),
  leerContenido: mocks.leer,
  guardarContenido: mocks.guardar,
}))

import PestanaContenido from './pestanas/contenido'

const guardado = { ...CONTENIDO_VACIO, titulo: 'Todo para tu consola', texto_boton: 'Ver catálogo' }

const abrir = (empresaId = 'e-1', empresaNombre = 'Mundo JC') =>
  render(<PestanaContenido empresaId={empresaId} empresaNombre={empresaNombre} />)

const campo = (nombre: string) => screen.getByLabelText(nombre)

describe('pestaña Contenido (FR-031…FR-037, SC-013)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.leer.mockResolvedValue(guardado)
  })

  it('muestra los campos del prototipo con lo guardado y los contadores', async () => {
    abrir()

    expect(await screen.findByLabelText('Título')).toHaveValue('Todo para tu consola')
    for (const etiqueta of [
      'Subtítulo',
      'Texto del botón',
      'Mensaje de bienvenida (barra superior)',
      'Texto del pie de página',
      'Aviso en la ficha de producto',
      'Texto del botón de contacto',
    ]) {
      expect(campo(etiqueta)).toBeInTheDocument()
    }
    expect(screen.getByRole('combobox', { name: 'El botón lleva a' })).toHaveTextContent('Catálogo completo')
    expect(screen.getByText('20/120')).toBeInTheDocument()
    expect(mocks.leer).toHaveBeenCalledWith('e-1')
  })

  it('el contador cuenta puntos de código: un emoji suma 1, no 2', async () => {
    abrir()
    fireEvent.change(await screen.findByLabelText('Título'), { target: { value: '🎮🎮🎮' } })

    expect(screen.getByText('3/120')).toBeInTheDocument()
  })

  it('Guardar y Descartar están deshabilitados hasta que hay cambios', async () => {
    abrir()
    await screen.findByLabelText('Título')

    expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Descartar' })).toBeDisabled()
    expect(screen.queryByText('Hay cambios sin guardar.')).not.toBeInTheDocument()
  })

  it('la vista previa sigue lo escrito sin guardar y no escribe en la base (FR-037)', async () => {
    abrir()
    fireEvent.change(await screen.findByLabelText('Título'), { target: { value: 'Nuevo título' } })

    const vista = screen.getByTestId('vista-previa-banner')
    expect(within(vista).getByRole('heading', { name: 'Nuevo título' })).toBeInTheDocument()
    expect(mocks.guardar).not.toHaveBeenCalled()
    expect(screen.getByText('Hay cambios sin guardar.')).toBeInTheDocument()
    expect(mocks.setWarnWhen).toHaveBeenLastCalledWith(true)
  })

  it('un texto con HTML se previsualiza literal', async () => {
    abrir()
    fireEvent.change(await screen.findByLabelText('Título'), { target: { value: '<script>alert(1)</script>' } })

    const vista = screen.getByTestId('vista-previa-banner')
    expect(within(vista).getByRole('heading', { name: '<script>alert(1)</script>' })).toBeInTheDocument()
    expect(vista.querySelector('script')).toBeNull()
  })

  it('Descartar vuelve al último valor guardado', async () => {
    abrir()
    fireEvent.change(await screen.findByLabelText('Título'), { target: { value: 'Otro' } })
    fireEvent.click(screen.getByRole('button', { name: 'Descartar' }))

    expect(screen.getByLabelText('Título')).toHaveValue('Todo para tu consola')
    expect(screen.queryByText('Hay cambios sin guardar.')).not.toBeInTheDocument()
    expect(mocks.setWarnWhen).toHaveBeenLastCalledWith(false)
    expect(mocks.guardar).not.toHaveBeenCalled()
  })

  it('Guardar envía los valores y confirma', async () => {
    mocks.guardar.mockImplementation(async (_empresaId: string, valores: typeof guardado) => valores)
    abrir()
    fireEvent.change(await screen.findByLabelText('Título'), { target: { value: 'Otro título' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(await screen.findByText('Cambios guardados. La tienda ya muestra los textos nuevos.')).toBeInTheDocument()
    expect(mocks.guardar).toHaveBeenCalledWith('e-1', expect.objectContaining({ titulo: 'Otro título' }))
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled()
    expect(screen.queryByText('Hay cambios sin guardar.')).not.toBeInTheDocument()
  })

  it('un texto que supera el límite marca el campo y no guarda nada (US3.3)', async () => {
    abrir()
    fireEvent.change(await screen.findByLabelText('Título'), { target: { value: 'a'.repeat(121) } })
    fireEvent.change(campo('Texto del pie de página'), { target: { value: 'b'.repeat(301) } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(await screen.findByText('Título no puede superar los 120 caracteres.')).toBeInTheDocument()
    expect(screen.getByText('Texto del pie de página no puede superar los 300 caracteres.')).toBeInTheDocument()
    expect(campo('Título')).toBeInvalid()
    expect(mocks.guardar).not.toHaveBeenCalled()
  })

  it('el error de un campo que devuelve la base se muestra en ese campo', async () => {
    mocks.guardar.mockRejectedValue(new ErrorGuardadoContenido('El título no puede superar los 120 caracteres', 'titulo'))
    abrir()
    fireEvent.change(await screen.findByLabelText('Título'), { target: { value: 'Otro' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(await screen.findByText('El título no puede superar los 120 caracteres')).toBeInTheDocument()
    expect(campo('Título')).toBeInvalid()
    expect(campo('Título')).toHaveValue('Otro')
  })

  it('un fallo al guardar avisa, conserva lo escrito y no confirma', async () => {
    const consola = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.guardar.mockRejectedValue(new Error('red'))
    abrir()
    fireEvent.change(await screen.findByLabelText('Título'), { target: { value: 'Otro' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos guardar los cambios. Intentá de nuevo.')
    expect(campo('Título')).toHaveValue('Otro')
    expect(screen.queryByText(/Cambios guardados/)).not.toBeInTheDocument()
    consola.mockRestore()
  })

  it('un error al cargar ofrece reintentar', async () => {
    const consola = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.leer.mockRejectedValueOnce(new Error('red'))
    abrir()

    fireEvent.click(await screen.findByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByLabelText('Título')).toHaveValue('Todo para tu consola')
    consola.mockRestore()
  })

  it('al cambiar de empresa se vuelve a leer y no queda nada de la anterior (Principio VIII)', async () => {
    mocks.leer.mockImplementation(async (id: string) =>
      id === 'e-1' ? guardado : { ...CONTENIDO_VACIO, titulo: 'Mundo San Javucho' })
    const { rerender } = abrir('e-1', 'Mundo JC')
    fireEvent.change(await screen.findByLabelText('Título'), { target: { value: 'Sin guardar de la anterior' } })

    rerender(<PestanaContenido empresaId="e-2" empresaNombre="San Javucho" />)

    await waitFor(() => expect(screen.getByLabelText('Título')).toHaveValue('Mundo San Javucho'))
    expect(mocks.leer).toHaveBeenLastCalledWith('e-2')
    expect(screen.queryByDisplayValue('Sin guardar de la anterior')).not.toBeInTheDocument()
    expect(screen.queryByText('Hay cambios sin guardar.')).not.toBeInTheDocument()
  })
})

describe.each([320, 768, 1440])('accesibilidad a %i px', (ancho) => {
  it('la pestaña no tiene violaciones de axe', async () => {
    window.innerWidth = ancho
    mocks.leer.mockResolvedValue(guardado)
    const { container } = abrir()
    await screen.findByLabelText('Título')
    expect(await violacionesAxe(container)).toEqual([])
  })
})
