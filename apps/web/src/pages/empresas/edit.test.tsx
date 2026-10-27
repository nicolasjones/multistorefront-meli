import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Link, MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  lectura: vi.fn(),
  escritura: vi.fn(),
  update: vi.fn(),
  eqUpdate: vi.fn(),
  usePuedeEscribir: vi.fn(),
  setWarnWhen: vi.fn(),
  getUser: vi.fn(),
}))

vi.mock('@refinedev/core', () => ({ useWarnAboutChange: () => ({ setWarnWhen: mocks.setWarnWhen }) }))
vi.mock('../../hooks/usePuedeEscribir', () => ({ usePuedeEscribir: mocks.usePuedeEscribir }))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))
vi.mock('../../lib/supabase', () => ({
  supabaseClient: {
    auth: { getUser: () => mocks.getUser() },
    schema: () => ({
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: mocks.lectura }) }),
        update: (valores: unknown) => {
          mocks.update(valores)
          return {
            eq: (columna: string, valor: string) => {
              mocks.eqUpdate(columna, valor)
              const encadenado = {
                eq: (columna2: string, valor2: boolean) => {
                  mocks.eqUpdate(columna2, valor2)
                  return encadenado
                },
                select: () => ({ maybeSingle: mocks.escritura }),
              }
              return encadenado
            },
          }
        },
      }),
    }),
  },
}))

import { registrarDestinoActividad } from '../../lib/eventosActividad'
import { EmpresaEdit } from './edit'

const mundoJc = {
  id: 'e-2', nombre: 'Mundo JC', whatsapp: null, correo: null, instagram: null, direccion: null, horarios: null, razon_social: null, cuit: null, activa: true,
}

const abrir = () =>
  render(
    <MemoryRouter initialEntries={['/empresas/edit/e-2']}>
      <Routes>
        <Route path="/empresas/edit/:id" element={<><Link to="/empresas/edit/e-3">ir a otra</Link><EmpresaEdit /></>} />
      </Routes>
    </MemoryRouter>,
  )

describe('EmpresaEdit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    registrarDestinoActividad(null)
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'u-1' } } })
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
    expect(mocks.update).toHaveBeenCalledWith({
      nombre: 'Mundo JC SRL', whatsapp: null, correo: 'hola@mundojc.com', instagram: null, direccion: null, horarios: null, razon_social: null, cuit: null,
    })
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

  it('«Horarios de atención» (F-TDA-16, FR-014): se guarda recortado y vacío se guarda como null', async () => {
    mocks.escritura.mockResolvedValue({ data: { ...mundoJc, horarios: 'Lunes a viernes de 10 a 19 h' }, error: null })
    abrir()
    const campo = await screen.findByLabelText('Horarios de atención')
    expect(campo).toHaveValue('')
    fireEvent.change(campo, { target: { value: '  Lunes a viernes de 10 a 19 h  ' } })
    fireEvent.click(screen.getByRole('button', { name: /guardar cambios/i }))

    expect(await screen.findByText('Cambios guardados.')).toBeInTheDocument()
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ horarios: 'Lunes a viernes de 10 a 19 h' }))
    expect(mocks.eqUpdate).toHaveBeenCalledWith('id', 'e-2')
  })

  it('«Horarios de atención» rechaza más de 200 caracteres sin guardar', async () => {
    abrir()
    fireEvent.change(await screen.findByLabelText('Horarios de atención'), { target: { value: 'h'.repeat(201) } })
    fireEvent.click(screen.getByRole('button', { name: /guardar cambios/i }))

    expect(await screen.findByText('Los horarios admiten hasta 200 caracteres.')).toBeInTheDocument()
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('«Horarios de atención» opera sobre la empresa activa: al cambiar de empresa muestra los de la nueva', async () => {
    mocks.lectura.mockResolvedValue({ data: { ...mundoJc, horarios: 'De 9 a 18 h' }, error: null })
    abrir()
    expect(await screen.findByDisplayValue('De 9 a 18 h')).toBeInTheDocument()

    mocks.lectura.mockResolvedValue({ data: { ...mundoJc, id: 'e-3', nombre: 'Otra', horarios: 'Sábados de 10 a 14 h' }, error: null })
    fireEvent.click(screen.getByText('ir a otra'))

    expect(await screen.findByDisplayValue('Sábados de 10 a 14 h')).toBeInTheDocument()
    expect(screen.queryByDisplayValue('De 9 a 18 h')).not.toBeInTheDocument()
  })

  it('muestra la razón social y el CUIT cargados (FR-008)', async () => {
    mocks.lectura.mockResolvedValue({ data: { ...mundoJc, razon_social: 'Mundo JC SRL', cuit: '30712345678' }, error: null })
    abrir()
    expect(await screen.findByLabelText('Razón social')).toHaveValue('Mundo JC SRL')
    expect(screen.getByLabelText('CUIT')).toHaveValue('30712345678')
  })

  it('rechaza un CUIT que no tiene 11 dígitos sin guardar', async () => {
    abrir()
    fireEvent.change(await screen.findByLabelText('CUIT'), { target: { value: '30-7123' } })
    fireEvent.click(screen.getByRole('button', { name: /guardar cambios/i }))

    expect(await screen.findByText('El CUIT debe tener 11 dígitos.')).toBeInTheDocument()
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('guarda el CUIT solo con dígitos y los vacíos como null', async () => {
    mocks.escritura.mockResolvedValue({ data: { ...mundoJc, razon_social: 'Mundo JC SRL', cuit: '30712345678' }, error: null })
    abrir()
    fireEvent.change(await screen.findByLabelText('Razón social'), { target: { value: '  Mundo JC SRL ' } })
    fireEvent.change(screen.getByLabelText('CUIT'), { target: { value: '30-71234567-8' } })
    fireEvent.click(screen.getByRole('button', { name: /guardar cambios/i }))

    expect(await screen.findByText('Cambios guardados.')).toBeInTheDocument()
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ razon_social: 'Mundo JC SRL', cuit: '30712345678', direccion: null }))
  })

  it('al cambiar de empresa no arrastra el aviso de guardado de la anterior', async () => {
    const otra = { ...mundoJc, id: 'e-3', nombre: 'Otra' }
    mocks.escritura.mockResolvedValue({ data: mundoJc, error: null })
    abrir()
    fireEvent.change(await screen.findByLabelText(/nombre comercial/i), { target: { value: 'Mundo JC SRL' } })
    mocks.escritura.mockResolvedValue({ data: { ...mundoJc, nombre: 'Mundo JC SRL' }, error: null })
    fireEvent.click(screen.getByRole('button', { name: /guardar cambios/i }))
    expect(await screen.findByText('Cambios guardados.')).toBeInTheDocument()

    mocks.lectura.mockResolvedValue({ data: otra, error: null })
    fireEvent.click(screen.getByText('ir a otra'))

    expect(await screen.findByDisplayValue('Otra')).toBeInTheDocument()
    expect(screen.queryByText('Cambios guardados.')).not.toBeInTheDocument()
  })

  it('una respuesta tardía de guardar de la empresa anterior no pisa el formulario de la nueva', async () => {
    const destino = vi.fn()
    registrarDestinoActividad(destino)
    const otra = { ...mundoJc, id: 'e-3', nombre: 'Otra' }
    let resolver: (valor: unknown) => void = () => {}
    mocks.escritura.mockReturnValue(new Promise((resolve) => { resolver = resolve }))
    abrir()
    fireEvent.change(await screen.findByLabelText(/nombre comercial/i), { target: { value: 'Mundo JC SRL' } })
    fireEvent.click(screen.getByRole('button', { name: /guardar cambios/i }))

    mocks.lectura.mockResolvedValue({ data: otra, error: null })
    fireEvent.click(screen.getByText('ir a otra'))
    expect(await screen.findByDisplayValue('Otra')).toBeInTheDocument()

    await act(async () => {
      resolver({ data: { ...mundoJc, nombre: 'Mundo JC SRL' }, error: null })
    })
    await waitFor(() => expect(destino).toHaveBeenCalledTimes(1))
    expect(destino.mock.calls[0][0]).toMatchObject({ tipo: 'empresa.actualizada', empresaId: 'e-2' })
    expect(screen.getByLabelText(/nombre comercial/i)).toHaveValue('Otra')
    expect(screen.queryByText('Cambios guardados.')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /guardar cambios/i })).toBeEnabled()
  })

  it('un fallo tardío de guardar de la empresa anterior no muestra error en el formulario de la nueva', async () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const otra = { ...mundoJc, id: 'e-3', nombre: 'Otra' }
    let rechazar: (motivo: unknown) => void = () => {}
    mocks.escritura.mockReturnValue(new Promise((_, reject) => { rechazar = reject }))
    abrir()
    fireEvent.change(await screen.findByLabelText(/nombre comercial/i), { target: { value: 'Mundo JC SRL' } })
    fireEvent.click(screen.getByRole('button', { name: /guardar cambios/i }))

    mocks.lectura.mockResolvedValue({ data: otra, error: null })
    fireEvent.click(screen.getByText('ir a otra'))
    expect(await screen.findByDisplayValue('Otra')).toBeInTheDocument()

    await act(async () => {
      rechazar(new Error('sin red'))
    })
    await waitFor(() => expect(aviso).toHaveBeenCalledWith('No se pudo guardar la empresa anterior', expect.any(Error)))
    expect(screen.queryByText('sin red')).not.toBeInTheDocument()
    expect(screen.getByLabelText(/nombre comercial/i)).toHaveValue('Otra')
    expect(screen.getByRole('button', { name: /guardar cambios/i })).toBeEnabled()
    aviso.mockRestore()
  })

  it('no muestra error si falla obtener el actor después de guardar', async () => {
    const destino = vi.fn()
    registrarDestinoActividad(destino)
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    mocks.getUser.mockRejectedValue(new Error('sin red'))
    mocks.escritura.mockResolvedValue({ data: { ...mundoJc, nombre: 'Otro' }, error: null })
    abrir()
    fireEvent.change(await screen.findByLabelText(/nombre comercial/i), { target: { value: 'Otro' } })
    fireEvent.click(screen.getByRole('button', { name: /guardar cambios/i }))

    expect(await screen.findByText('Cambios guardados.')).toBeInTheDocument()
    await waitFor(() => expect(aviso).toHaveBeenCalled())
    expect(screen.queryByText('No se guardaron los cambios.')).not.toBeInTheDocument()
    expect(destino).not.toHaveBeenCalled()
    aviso.mockRestore()
  })

  it('no muestra error si el destino de actividad lanza una excepción', async () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    registrarDestinoActividad(() => {
      throw new Error('destino caído')
    })
    mocks.escritura.mockResolvedValue({ data: { ...mundoJc, nombre: 'Otro' }, error: null })
    abrir()
    fireEvent.change(await screen.findByLabelText(/nombre comercial/i), { target: { value: 'Otro' } })
    fireEvent.click(screen.getByRole('button', { name: /guardar cambios/i }))

    expect(await screen.findByText('Cambios guardados.')).toBeInTheDocument()
    await waitFor(() => expect(aviso).toHaveBeenCalled())
    expect(screen.queryByText('No se guardaron los cambios.')).not.toBeInTheDocument()
    aviso.mockRestore()
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
  describe('estado de la tienda (F-EMP-04)', () => {
    it('muestra el estado, aclara el efecto y pausa solo esa empresa emitiendo el evento', async () => {
      const destino = vi.fn()
      registrarDestinoActividad(destino)
      mocks.escritura.mockResolvedValue({ data: { ...mundoJc, activa: false }, error: null })
      abrir()
      expect(await screen.findByText('Activa')).toBeInTheDocument()
      expect(screen.getByText(/Volvemos pronto/)).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'Pausar tienda' }))

      expect(await screen.findByText('Pausada')).toBeInTheDocument()
      expect(mocks.update).toHaveBeenCalledWith({ activa: false })
      expect(mocks.eqUpdate).toHaveBeenCalledWith('id', 'e-2')
      expect(mocks.eqUpdate).toHaveBeenCalledWith('activa', true)
      await waitFor(() => expect(destino).toHaveBeenCalledTimes(1))
      expect(destino.mock.calls[0][0]).toMatchObject({
        tipo: 'empresa.pausada',
        actorId: 'u-1',
        empresaId: 'e-2',
        cambios: [{ campo: 'activa', antes: 'true', despues: 'false' }],
      })
      expect(screen.getByRole('button', { name: 'Reactivar tienda' })).toBeInTheDocument()
    })

    it('reactiva una empresa pausada y emite empresa.reactivada', async () => {
      const destino = vi.fn()
      registrarDestinoActividad(destino)
      mocks.lectura.mockResolvedValue({ data: { ...mundoJc, activa: false }, error: null })
      mocks.escritura.mockResolvedValue({ data: { ...mundoJc, activa: true }, error: null })
      abrir()
      expect(await screen.findByText('Pausada')).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'Reactivar tienda' }))

      expect(await screen.findByText('Activa')).toBeInTheDocument()
      expect(mocks.update).toHaveBeenCalledWith({ activa: true })
      await waitFor(() => expect(destino).toHaveBeenCalledTimes(1))
      expect(destino.mock.calls[0][0]).toMatchObject({ tipo: 'empresa.reactivada', cambios: [{ campo: 'activa', antes: 'false', despues: 'true' }] })
    })

    it('informa el error si el cambio falla (RLS: cero filas), no cambia el estado y no emite evento', async () => {
      const destino = vi.fn()
      registrarDestinoActividad(destino)
      mocks.escritura.mockResolvedValue({ data: null, error: null })
      abrir()
      fireEvent.click(await screen.findByRole('button', { name: 'Pausar tienda' }))

      expect(await screen.findByText('No se cambió el estado.')).toBeInTheDocument()
      expect(screen.getByText('Activa')).toBeInTheDocument()
      expect(destino).not.toHaveBeenCalled()
    })

    it('si el update lanza error de Supabase o una excepción de red, informa y ofrece reintentar', async () => {
      const destino = vi.fn()
      registrarDestinoActividad(destino)
      mocks.escritura.mockResolvedValueOnce({ data: null, error: new Error('permiso denegado') })
      abrir()
      fireEvent.click(await screen.findByRole('button', { name: 'Pausar tienda' }))
      expect(await screen.findByText('permiso denegado')).toBeInTheDocument()

      mocks.escritura.mockRejectedValueOnce('corte de red')
      fireEvent.click(screen.getByRole('button', { name: /reintentar/i }))
      expect(await screen.findByText('No pudimos cambiar el estado de la tienda.')).toBeInTheDocument()

      mocks.escritura.mockResolvedValueOnce({ data: { ...mundoJc, activa: false }, error: null })
      fireEvent.click(screen.getByRole('button', { name: /reintentar/i }))
      expect(await screen.findByText('Pausada')).toBeInTheDocument()
      await waitFor(() => expect(destino).toHaveBeenCalledTimes(1))
    })

    it('si otra persona ya cambió el estado (cero filas) no emite evento y recarga el estado real', async () => {
      const destino = vi.fn()
      registrarDestinoActividad(destino)
      mocks.escritura.mockResolvedValue({ data: null, error: null })
      abrir()
      fireEvent.click(await screen.findByRole('button', { name: 'Pausar tienda' }))
      mocks.lectura.mockResolvedValue({ data: { ...mundoJc, activa: false }, error: null })
      expect(await screen.findByText(/otra persona ya lo cambió/)).toBeInTheDocument()
      expect(await screen.findByText('Pausada')).toBeInTheDocument()
      expect(destino).not.toHaveBeenCalled()
    })

    it('pausar no descarta los cambios pendientes del formulario ni los guarda', async () => {
      mocks.escritura.mockResolvedValue({ data: { ...mundoJc, activa: false }, error: null })
      abrir()
      fireEvent.change(await screen.findByLabelText(/nombre comercial/i), { target: { value: 'Nombre sin guardar' } })
      fireEvent.click(screen.getByRole('button', { name: 'Pausar tienda' }))

      expect(await screen.findByText('Pausada')).toBeInTheDocument()
      expect(screen.getByLabelText(/nombre comercial/i)).toHaveValue('Nombre sin guardar')
      expect(mocks.update).toHaveBeenCalledTimes(1)
      expect(mocks.update).toHaveBeenCalledWith({ activa: false })
    })

    it('no deja guardar los datos mientras se cambia el estado, ni al revés', async () => {
      let resolver: (valor: unknown) => void = () => undefined
      mocks.escritura.mockReturnValue(new Promise((resolve) => (resolver = resolve)))
      abrir()
      fireEvent.click(await screen.findByRole('button', { name: 'Pausar tienda' }))

      expect(await screen.findByRole('button', { name: 'Cambiando estado…' })).toBeDisabled()
      expect(screen.getByRole('button', { name: /guardar cambios/i })).toBeDisabled()
      resolver({ data: { ...mundoJc, activa: false }, error: null })
      expect(await screen.findByRole('button', { name: 'Reactivar tienda' })).toBeEnabled()
    })

    it('el error de una empresa no se arrastra al cambiar a otra', async () => {
      mocks.escritura.mockResolvedValue({ data: null, error: null })
      abrir()
      fireEvent.click(await screen.findByRole('button', { name: 'Pausar tienda' }))
      expect(await screen.findByText('No se cambió el estado.')).toBeInTheDocument()
      mocks.lectura.mockResolvedValue({ data: { ...mundoJc, id: 'e-3', nombre: 'Otra' }, error: null })

      fireEvent.click(screen.getByText('ir a otra'))

      expect(await screen.findByDisplayValue('Otra')).toBeInTheDocument()
      expect(screen.queryByText('No se cambió el estado.')).not.toBeInTheDocument()
    })

    it('una respuesta tardía de la empresa anterior no pisa a la que se ve ahora', async () => {
      let resolver: (valor: unknown) => void = () => undefined
      mocks.escritura.mockReturnValue(new Promise((resolve) => (resolver = resolve)))
      mocks.lectura.mockImplementation(() => Promise.resolve({ data: mocks.lectura.mock.calls.length > 1 ? { ...mundoJc, id: 'e-3', nombre: 'Otra' } : mundoJc, error: null }))
      abrir()
      fireEvent.click(await screen.findByRole('button', { name: 'Pausar tienda' }))
      fireEvent.click(screen.getByText('ir a otra'))
      expect(await screen.findByDisplayValue('Otra')).toBeInTheDocument()

      resolver({ data: { ...mundoJc, activa: false }, error: null })
      await waitFor(() => expect(mocks.update).toHaveBeenCalled())
      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(screen.getByDisplayValue('Otra')).toBeInTheDocument()
      expect(screen.getByText('Activa')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Pausar tienda' })).toBeEnabled()
    })

    it('no ofrece pausar ni reactivar sin permiso de escritura', async () => {
      mocks.usePuedeEscribir.mockReturnValue({ puedeEscribir: false, isLoading: false })
      abrir()
      expect(await screen.findByText('Activa')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /pausar tienda|reactivar tienda/i })).not.toBeInTheDocument()
    })
  })
})
