import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { violacionesAxe } from '../../../test/axe'
import { ANALITICA_VACIA, ErrorGuardadoAnalitica } from '../../../lib/tiendaAnalitica'

const mocks = vi.hoisted(() => ({
  leer: vi.fn(), guardar: vi.fn(), setWarnWhen: vi.fn(),
  nivel: { valor: 'edicion' as 'edicion' | 'lectura' | 'ninguno' },
}))

vi.mock('../../../hooks/useNivelSeccion', () => ({
  useNivelSeccion: () => ({ nivel: mocks.nivel.valor, isLoading: false, error: false }),
}))

vi.mock('@refinedev/core', () => ({
  useWarnAboutChange: () => ({ warnWhen: false, setWarnWhen: mocks.setWarnWhen }),
}))
vi.mock('../../../lib/tiendaAnalitica', async (original) => ({
  ...(await original<typeof import('../../../lib/tiendaAnalitica')>()),
  leerAnalitica: mocks.leer,
  guardarAnalitica: mocks.guardar,
}))

import PestanaAnalitica from './pestanas/analitica'

const guardado = { ga4_id: 'G-ABC123', meta_pixel_id: '123456789' }

const abrir = (empresaId = 'e-1', empresaNombre = 'Mundo JC') =>
  render(<PestanaAnalitica empresaId={empresaId} empresaNombre={empresaNombre} />)

const ga4 = () => screen.getByLabelText('ID de Google Analytics 4')
const pixel = () => screen.getByLabelText('ID de Meta Pixel')

describe('pestaña Analítica (F-TDA-24, FR-013, SC-005)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.nivel.valor = 'edicion'
    mocks.leer.mockResolvedValue(guardado)
  })

  it('muestra los dos campos con lo guardado, su ayuda y el aviso de condiciones', async () => {
    abrir()

    expect(await screen.findByLabelText('ID de Google Analytics 4')).toHaveValue('G-ABC123')
    expect(pixel()).toHaveValue('123456789')
    expect(screen.getByText(/Empieza con G-/)).toBeInTheDocument()
    expect(screen.getByText(/Solo números, de 8 a 20 dígitos/)).toBeInTheDocument()
    expect(screen.getByText('Solo se cargan en la tienda publicada y si la persona acepta las cookies.')).toBeInTheDocument()
    expect(mocks.leer).toHaveBeenCalledWith('e-1')
  })

  it('sin nada cargado deja ambos campos vacíos', async () => {
    mocks.leer.mockResolvedValue(ANALITICA_VACIA)
    abrir()
    expect(await screen.findByLabelText('ID de Google Analytics 4')).toHaveValue('')
    expect(pixel()).toHaveValue('')
  })

  it('Guardar y Descartar están deshabilitados hasta que hay cambios', async () => {
    abrir()
    await screen.findByLabelText('ID de Google Analytics 4')

    expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Descartar' })).toBeDisabled()
    expect(screen.queryByText('Hay cambios sin guardar.')).not.toBeInTheDocument()
  })

  it('un cambio avisa que hay cambios sin guardar y lo informa a la gestión (Principio VIII)', async () => {
    abrir()
    fireEvent.change(await screen.findByLabelText('ID de Google Analytics 4'), { target: { value: 'G-NUEVO99' } })

    expect(screen.getByText('Hay cambios sin guardar.')).toBeInTheDocument()
    expect(mocks.setWarnWhen).toHaveBeenLastCalledWith(true)
  })

  it('un ID de GA4 con formato inválido marca el campo al salir y al guardar, sin llamar a la base (CA-TDA-24-3)', async () => {
    abrir()
    const campo = await screen.findByLabelText('ID de Google Analytics 4')
    fireEvent.change(campo, { target: { value: 'UA-123' } })
    fireEvent.blur(campo)

    expect(await screen.findByText(/formato inválido\. Ejemplo: G-XXXXXXXXXX/)).toBeInTheDocument()
    expect(campo).toBeInvalid()

    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(mocks.guardar).not.toHaveBeenCalled()
  })

  it('un ID de Meta Pixel con formato inválido marca ese campo y no guarda nada', async () => {
    abrir()
    fireEvent.change(await screen.findByLabelText('ID de Meta Pixel'), { target: { value: '12ab' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(await screen.findByText(/solo números, de 8 a 20 dígitos\./i)).toBeInTheDocument()
    expect(pixel()).toBeInvalid()
    expect(mocks.guardar).not.toHaveBeenCalled()
  })

  it('el ID de GA4 en minúsculas y con espacios es válido (la base lo normaliza)', async () => {
    mocks.guardar.mockImplementation(async (_e: string, v: typeof guardado) => ({ ...v, ga4_id: v.ga4_id.trim().toUpperCase() }))
    abrir()
    fireEvent.change(await screen.findByLabelText('ID de Google Analytics 4'), { target: { value: '  g-nuevo99 ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(mocks.guardar).toHaveBeenCalledTimes(1))
    expect(await screen.findByDisplayValue('G-NUEVO99')).toBeInTheDocument()
  })

  it('Guardar envía los valores, confirma y deja el botón deshabilitado', async () => {
    mocks.guardar.mockImplementation(async (_e: string, v: typeof guardado) => v)
    abrir()
    fireEvent.change(await screen.findByLabelText('ID de Meta Pixel'), { target: { value: '999888777' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(await screen.findByText('Cambios guardados. Se aplican a la tienda publicada.')).toBeInTheDocument()
    expect(mocks.guardar).toHaveBeenCalledWith('e-1', { ga4_id: 'G-ABC123', meta_pixel_id: '999888777' })
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled()
    expect(screen.queryByText('Hay cambios sin guardar.')).not.toBeInTheDocument()
  })

  it('vaciar un campo quita esa herramienta (valor vacío)', async () => {
    mocks.guardar.mockImplementation(async (_e: string, v: typeof guardado) => v)
    abrir()
    fireEvent.change(await screen.findByLabelText('ID de Google Analytics 4'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(mocks.guardar).toHaveBeenCalledWith('e-1', { ga4_id: '', meta_pixel_id: '123456789' }))
  })

  it('Descartar vuelve al último valor guardado', async () => {
    abrir()
    fireEvent.change(await screen.findByLabelText('ID de Google Analytics 4'), { target: { value: 'G-OTRO999' } })
    fireEvent.click(screen.getByRole('button', { name: 'Descartar' }))

    expect(ga4()).toHaveValue('G-ABC123')
    expect(screen.queryByText('Hay cambios sin guardar.')).not.toBeInTheDocument()
    expect(mocks.setWarnWhen).toHaveBeenLastCalledWith(false)
    expect(mocks.guardar).not.toHaveBeenCalled()
  })

  it('un error de formato de la base marca el campo que indica y conserva lo escrito', async () => {
    mocks.guardar.mockRejectedValue(new ErrorGuardadoAnalitica('El ID de Google Analytics 4 tiene un formato inválido', 'ga4_id'))
    abrir()
    fireEvent.change(await screen.findByLabelText('ID de Google Analytics 4'), { target: { value: 'G-ZZZZ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(await screen.findByText('El ID de Google Analytics 4 tiene un formato inválido')).toBeInTheDocument()
    expect(ga4()).toBeInvalid()
    expect(ga4()).toHaveValue('G-ZZZZ')
  })

  it('un fallo al guardar avisa, conserva lo escrito y no confirma', async () => {
    const consola = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.guardar.mockRejectedValue(new Error('red'))
    abrir()
    fireEvent.change(await screen.findByLabelText('ID de Google Analytics 4'), { target: { value: 'G-OTRO999' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos guardar los cambios. Intentá de nuevo.')
    expect(ga4()).toHaveValue('G-OTRO999')
    expect(screen.queryByText(/Cambios guardados/)).not.toBeInTheDocument()
    consola.mockRestore()
  })

  it('un error al cargar ofrece reintentar', async () => {
    const consola = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.leer.mockRejectedValueOnce(new Error('red'))
    abrir()

    fireEvent.click(await screen.findByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByLabelText('ID de Google Analytics 4')).toHaveValue('G-ABC123')
    consola.mockRestore()
  })

  it('al cambiar de empresa se vuelve a leer y no queda nada de la anterior (Principio VIII)', async () => {
    mocks.leer.mockImplementation(async (id: string) =>
      id === 'e-1' ? guardado : { ga4_id: 'G-SANJAV1', meta_pixel_id: '' })
    const { rerender } = abrir('e-1', 'Mundo JC')
    fireEvent.change(await screen.findByLabelText('ID de Google Analytics 4'), { target: { value: 'G-SINGUARDAR' } })

    rerender(<PestanaAnalitica empresaId="e-2" empresaNombre="San Javucho" />)

    await waitFor(() => expect(ga4()).toHaveValue('G-SANJAV1'))
    expect(mocks.leer).toHaveBeenLastCalledWith('e-2')
    expect(pixel()).toHaveValue('')
    expect(screen.queryByDisplayValue('G-SINGUARDAR')).not.toBeInTheDocument()
    expect(screen.queryByText('Hay cambios sin guardar.')).not.toBeInTheDocument()
  })
})

describe('pestaña Analítica: rol y aviso de privacidad (hallazgos 2, 3 y 9)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.nivel.valor = 'edicion'
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.leer.mockResolvedValue(guardado)
  })

  it.each(['lectura', 'ninguno'] as const)('con nivel «%s» los campos y los botones están deshabilitados y avisa que es solo lectura', async (nivel) => {
    mocks.nivel.valor = nivel
    abrir()

    expect(await screen.findByLabelText('ID de Google Analytics 4')).toBeDisabled()
    expect(pixel()).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Descartar' })).toBeDisabled()
    expect(screen.getByText(/Tu rol no puede editar la analítica de la tienda\./)).toBeInTheDocument()
  })

  it('con edición los campos están activos y no hay aviso de solo lectura', async () => {
    abrir()
    expect(await screen.findByLabelText('ID de Google Analytics 4')).toBeEnabled()
    expect(screen.queryByText(/Tu rol no puede editar/)).not.toBeInTheDocument()
  })

  it('si la base rechaza por rol (42501) al guardar, muestra «Tu rol no puede editar…» y no el genérico', async () => {
    mocks.guardar.mockRejectedValue(new ErrorGuardadoAnalitica('permission denied', null, '42501'))
    abrir()
    fireEvent.change(await screen.findByLabelText('ID de Google Analytics 4'), { target: { value: 'G-NUEVO99' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Tu rol no puede editar la analítica de la tienda.')
    expect(screen.queryByText(/No pudimos guardar/)).not.toBeInTheDocument()
  })

  it('avisa que no se envían datos del visitante y que las mediciones mejoradas de GA4 se desactivan en la propiedad', async () => {
    abrir()
    await screen.findByLabelText('ID de Google Analytics 4')
    expect(screen.getByText(/No se envían datos del visitante/)).toBeInTheDocument()
    expect(screen.getByText(/desactivá la «Medición mejorada»/)).toBeInTheDocument()
    expect(screen.getByText(/se apaga y se borran sus cookies/)).toBeInTheDocument()
  })
})

describe.each([320, 768, 1440])('accesibilidad a %i px', (ancho) => {
  it('la pestaña no tiene violaciones de axe', async () => {
    window.innerWidth = ancho
    mocks.leer.mockResolvedValue(guardado)
    const { container } = abrir()
    await screen.findByLabelText('ID de Google Analytics 4')
    expect(await violacionesAxe(container)).toEqual([])
  })
})
