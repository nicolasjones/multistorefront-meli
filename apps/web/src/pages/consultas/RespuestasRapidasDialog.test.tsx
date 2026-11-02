import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  useRespuestasRapidas: vi.fn(),
  guardar: vi.fn(),
  eliminar: vi.fn(),
  refetch: vi.fn(),
}))

vi.mock('../../hooks/useRespuestasRapidas', () => ({ useRespuestasRapidas: mocks.useRespuestasRapidas }))
vi.mock('../../lib/respuestasRapidas', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/respuestasRapidas')>()),
  guardarRespuestaRapida: mocks.guardar,
  eliminarRespuestaRapida: mocks.eliminar,
}))

import { ErrorRespuestaRapida } from '../../lib/respuestasRapidas'
import { RespuestasRapidasDialog } from './RespuestasRapidasDialog'

const R1 = { id: 'r1', empresa_id: 'e-1', titulo: 'Gracias', texto: 'Hola {nombre}', created_at: '', updated_at: '' }

const abrir = (extra: Partial<React.ComponentProps<typeof RespuestasRapidasDialog>> = {}) => {
  const onCerrar = vi.fn()
  const vista = render(
    <RespuestasRapidasDialog empresaId="e-1" empresaNombre="San Javucho" puedeEditar onCerrar={onCerrar} {...extra} />,
  )
  return { onCerrar, ...vista }
}

describe('Respuestas rápidas · diálogo (F-CON-06, FR-014, FR-018)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.refetch.mockResolvedValue(undefined)
    mocks.guardar.mockResolvedValue('r2')
    mocks.eliminar.mockResolvedValue(undefined)
    mocks.useRespuestasRapidas.mockReturnValue({ respuestas: [R1], isLoading: false, isError: false, refetch: mocks.refetch })
  })

  it('lista los textos de la empresa activa y muestra la ayuda de variables', () => {
    abrir()
    expect(screen.getByText('Respuestas rápidas · San Javucho')).toBeInTheDocument()
    expect(screen.getByText('Gracias')).toBeInTheDocument()
    expect(screen.getByText(/\{nombre\}, \{tienda\}, \{producto\}/)).toBeInTheDocument()
    expect(mocks.useRespuestasRapidas).toHaveBeenCalledWith('e-1')
  })

  it('crea una respuesta para la empresa activa y recarga la lista', async () => {
    abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Nueva respuesta' }))
    fireEvent.change(screen.getByLabelText(/Título/), { target: { value: 'Horarios' } })
    fireEvent.change(screen.getByLabelText(/Texto/), { target: { value: 'Abrimos a las 9, {nombre}' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(mocks.guardar).toHaveBeenCalledWith({
      id: null, empresaId: 'e-1', titulo: 'Horarios', texto: 'Abrimos a las 9, {nombre}',
    }))
    await waitFor(() => expect(mocks.refetch).toHaveBeenCalled())
  })

  it('no deja guardar con título o texto vacíos', () => {
    abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Nueva respuesta' }))
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled()
  })

  it('edita una respuesta existente por su id', async () => {
    abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Editar Gracias' }))
    fireEvent.change(screen.getByLabelText(/Texto/), { target: { value: 'Hola de nuevo' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(mocks.guardar).toHaveBeenCalledWith({
      id: 'r1', empresaId: 'e-1', titulo: 'Gracias', texto: 'Hola de nuevo',
    }))
  })

  it('elimina solo tras confirmar', async () => {
    abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar Gracias' }))
    expect(mocks.eliminar).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Sí, eliminar' }))
    await waitFor(() => expect(mocks.eliminar).toHaveBeenCalledWith('r1'))
  })

  it('un permiso denegado (42501) muestra un mensaje claro, no el texto de la base', async () => {
    mocks.guardar.mockRejectedValueOnce(new ErrorRespuestaRapida('raw', '42501'))
    abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Nueva respuesta' }))
    fireEvent.change(screen.getByLabelText(/Título/), { target: { value: 'A' } })
    fireEvent.change(screen.getByLabelText(/Texto/), { target: { value: 'B' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(await screen.findByText(/No tenés permiso para editar las respuestas rápidas/)).toBeInTheDocument()
    expect(screen.queryByText('raw')).toBeNull()
  })

  it('con solo lectura ve la lista sin editar, eliminar ni crear', () => {
    abrir({ puedeEditar: false })
    expect(screen.getByText('Gracias')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Editar Gracias' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Eliminar Gracias' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Nueva respuesta' })).toBeDisabled()
    expect(screen.getByText(/Solo lectura/)).toBeInTheDocument()
  })

  it('empresa sin respuestas: estado vacío con explicación', () => {
    mocks.useRespuestasRapidas.mockReturnValue({ respuestas: [], isLoading: false, isError: false, refetch: mocks.refetch })
    abrir()
    expect(screen.getByText('Todavía no hay respuestas rápidas.')).toBeInTheDocument()
  })

  it('error de carga ofrece reintentar', () => {
    mocks.useRespuestasRapidas.mockReturnValue({ respuestas: [], isLoading: false, isError: true, refetch: mocks.refetch })
    abrir()
    fireEvent.click(screen.getByRole('button', { name: /Reintentar/ }))
    expect(mocks.refetch).toHaveBeenCalled()
  })

  it('«todas las empresas» pide elegir una tienda y no ofrece crear', () => {
    mocks.useRespuestasRapidas.mockReturnValue({ respuestas: [], isLoading: false, isError: false, refetch: mocks.refetch })
    abrir({ empresaId: null, empresaNombre: null })
    expect(screen.getByText(/Elegí una tienda en la barra superior/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Nueva respuesta' })).toBeNull()
  })

  it('al cambiar de empresa la pantalla lo cierra y el hook recibe la empresa nueva (sin datos de la anterior)', () => {
    const { rerender } = abrir()
    mocks.useRespuestasRapidas.mockReturnValue({ respuestas: [], isLoading: true, isError: false, refetch: mocks.refetch })
    rerender(<RespuestasRapidasDialog empresaId="e-2" empresaNombre="Mundo JC" puedeEditar onCerrar={vi.fn()} />)
    expect(mocks.useRespuestasRapidas).toHaveBeenLastCalledWith('e-2')
    expect(screen.queryByText('Gracias')).toBeNull()
  })
})
