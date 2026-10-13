import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  lectura: vi.fn(),
  escritura: vi.fn(),
  update: vi.fn(),
  usePuedeEscribir: vi.fn(),
  setWarnWhen: vi.fn(),
}))

vi.mock('@refinedev/core', () => ({ useWarnAboutChange: () => ({ setWarnWhen: mocks.setWarnWhen }) }))
vi.mock('../../hooks/usePuedeEscribir', () => ({ usePuedeEscribir: mocks.usePuedeEscribir }))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))
vi.mock('../../lib/supabase', () => ({
  supabaseClient: {
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u-1' } } }) },
    schema: () => ({
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: mocks.lectura }) }),
        update: (valores: unknown) => {
          mocks.update(valores)
          return { eq: () => ({ select: () => ({ maybeSingle: mocks.escritura }) }) }
        },
      }),
    }),
  },
}))

import { registrarDestinoActividad } from '../../lib/eventosActividad'
import { EmpresaEdit } from './edit'

const mundoJc = { id: 'e-2', nombre: 'Mundo JC', whatsapp: null, correo: null, instagram: null, direccion: null, activa: true }

const abrir = () =>
  render(
    <MemoryRouter initialEntries={['/empresas/edit/e-2']}>
      <Routes>
        <Route path="/empresas/edit/:id" element={<EmpresaEdit />} />
      </Routes>
    </MemoryRouter>,
  )

describe('EmpresaEdit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    registrarDestinoActividad(null)
    mocks.usePuedeEscribir.mockReturnValue({ puedeEscribir: true, isLoading: false })
    mocks.lectura.mockResolvedValue({ data: mundoJc, error: null })
  })

  it('muestra los datos generales con dominio, idioma y moneda fijos', async () => {
    abrir()
    expect(await screen.findByLabelText(/nombre comercial/i)).toHaveValue('Mundo JC')
    expect(screen.getByLabelText('Dominio')).toBeDisabled()
    expect(screen.getByLabelText('Dominio')).toHaveValue('Sin configurar')
    expect(screen.getByLabelText('Idioma')).toHaveValue('Español (Argentina)')
    expect(screen.getByLabelText('Moneda')).toHaveValue('ARS · Peso argentino')
  })

  it('rechaza nombre vacío y correo inválido sin guardar', async () => {
    abrir()
    const nombre = await screen.findByLabelText(/nombre comercial/i)
    fireEvent.change(nombre, { target: { value: '  ' } })
    fireEvent.change(screen.getByLabelText('Correo'), { target: { value: 'sin-arroba' } })
    fireEvent.click(screen.getByRole('button', { name: /guardar cambios/i }))

    expect(await screen.findByText('El nombre comercial es obligatorio.')).toBeInTheDocument()
    expect(screen.getByText('Ingresá un correo con formato válido.')).toBeInTheDocument()
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('guarda, confirma y emite el evento de actividad con lo que cambió', async () => {
    const destino = vi.fn()
    registrarDestinoActividad(destino)
    mocks.escritura.mockResolvedValue({ data: { ...mundoJc, nombre: 'Mundo JC SRL', correo: 'hola@mundojc.com' }, error: null })
    abrir()
    fireEvent.change(await screen.findByLabelText(/nombre comercial/i), { target: { value: 'Mundo JC SRL' } })
    fireEvent.change(screen.getByLabelText('Correo'), { target: { value: 'hola@mundojc.com' } })
    expect(mocks.setWarnWhen).toHaveBeenLastCalledWith(true)
    fireEvent.click(screen.getByRole('button', { name: /guardar cambios/i }))

    expect(await screen.findByText('Cambios guardados.')).toBeInTheDocument()
    expect(mocks.update).toHaveBeenCalledWith({ nombre: 'Mundo JC SRL', whatsapp: null, correo: 'hola@mundojc.com', instagram: null, direccion: null })
    await waitFor(() => expect(destino).toHaveBeenCalledTimes(1))
    expect(destino.mock.calls[0][0]).toMatchObject({
      tipo: 'empresa.actualizada',
      actorId: 'u-1',
      empresaId: 'e-2',
      cambios: [
        { campo: 'nombre', antes: 'Mundo JC', despues: 'Mundo JC SRL' },
        { campo: 'correo', antes: null, despues: 'hola@mundojc.com' },
      ],
    })
    expect(mocks.setWarnWhen).toHaveBeenLastCalledWith(false)
  })

  it('informa el error cuando el guardado falla (RLS: cero filas) y no emite evento', async () => {
    const destino = vi.fn()
    registrarDestinoActividad(destino)
    mocks.escritura.mockResolvedValue({ data: null, error: null })
    abrir()
    fireEvent.change(await screen.findByLabelText(/nombre comercial/i), { target: { value: 'Otro' } })
    fireEvent.click(screen.getByRole('button', { name: /guardar cambios/i }))

    expect(await screen.findByText('No se guardaron los cambios.')).toBeInTheDocument()
    expect(destino).not.toHaveBeenCalled()
  })

  it('queda en solo lectura sin permiso de escritura', async () => {
    mocks.usePuedeEscribir.mockReturnValue({ puedeEscribir: false, isLoading: false })
    abrir()
    expect(await screen.findByLabelText(/nombre comercial/i)).toBeDisabled()
    expect(screen.getByText('Solo lectura')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /guardar cambios/i })).not.toBeInTheDocument()
  })

  it('muestra no encontrada para una empresa ajena o inexistente', async () => {
    mocks.lectura.mockResolvedValue({ data: null, error: null })
    abrir()
    expect(await screen.findByText('Empresa no encontrada')).toBeInTheDocument()
  })

  it('ofrece reintentar si la carga falla', async () => {
    mocks.lectura.mockResolvedValue({ data: null, error: new Error('red') })
    abrir()
    expect(await screen.findByRole('button', { name: /reintentar/i })).toBeInTheDocument()
  })
})
