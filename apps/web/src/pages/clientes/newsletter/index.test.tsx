import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { violacionesAxe } from '../../../test/axe'

vi.setConfig({ testTimeout: 20000 })

const mocks = vi.hoisted(() => ({
  estado: { empresa: 'e-1' as string | null, esAdmin: true, nivel: 'edicion' as 'lectura' | 'edicion' | 'sin_acceso', bandera: true },
  llamar: vi.fn(),
  refetch: vi.fn(),
  useRpc: vi.fn(),
  cambiar: vi.fn(),
}))

vi.mock('../../../hooks/useRpcNewsletter', () => ({ useRpcNewsletter: mocks.useRpc, llamarRpcNewsletter: mocks.llamar }))
vi.mock('../../../hooks/useNivelSeccion', () => ({ useNivelSeccion: () => ({ nivel: mocks.estado.nivel, isLoading: false }) }))
vi.mock('../../../hooks/useEsAdministrador', () => ({ useEsAdministrador: () => ({ esAdministrador: mocks.estado.esAdmin, isLoading: false }) }))
vi.mock('../../../hooks/useFiltroPorEmpresaActiva', () => ({
  useFiltroPorEmpresaActiva: () => ({
    empresas: [{ id: 'e-1', nombre: 'San Javucho' }, { id: 'e-2', nombre: 'Mundo JC' }],
    valor: mocks.estado.empresa, cambiar: mocks.cambiar, empresaActivaId: mocks.estado.empresa, cargando: false, hayError: false,
  }),
}))
vi.mock('../../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))

import { NewsletterPage } from './index'

const suscriptor = (n: number, estado = 'confirmado') => ({ id: `s-${n}`, correo: `persona${n}@ejemplo.com`, empresa_id: 'e-1', tienda: 'San Javucho', origen: 'formulario', creado_en: '2027-03-30T15:05:00Z', estado })
const envio = (n: number, estado: string) => ({
  id: `n-${n}`, nombre_interno: `Campaña ${n}`, empresa_id: 'e-1', tienda: 'San Javucho', asunto: `Asunto ${n}`, version: 1, fecha: '2027-03-30T15:05:00Z',
  destinatarios: 10, enviados: 6, fallidos: 1, omitidos: 2, pendientes: 1, bajas: 1, estado,
})

function respuestas() {
  mocks.useRpc.mockImplementation((nombre: string, parametros: Record<string, unknown>) => {
    const base = { isLoading: false, isFetching: false, isError: false, refetch: mocks.refetch }
    if (nombre === 'resumen_newsletter') {
      return { ...base, datos: { confirmados: 3, pendientes: 2, bajas: 1, envios: 4, bandera: mocks.estado.bandera, tiendas: [{ empresa_id: 'e-1', tienda: 'San Javucho', activo: true }, { empresa_id: 'e-2', tienda: 'Mundo JC', activo: false }] }, parametros }
    }
    if (nombre === 'listar_suscriptores_newsletter') return { ...base, datos: { total: 2, filas: [suscriptor(1), suscriptor(2, 'pendiente')] }, parametros }
    return { ...base, datos: { total: 2, filas: [envio(1, 'enviando'), envio(2, 'borrador')] }, parametros }
  })
}

const abrir = () => render(<MemoryRouter><NewsletterPage /></MemoryRouter>)

describe('Newsletter · pantalla del panel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.assign(mocks.estado, { empresa: 'e-1', esAdmin: true, nivel: 'edicion', bandera: true })
    mocks.llamar.mockResolvedValue({ data: { ok: true }, error: null })
    respuestas()
  })

  it('muestra los KPI, los suscriptores y las campañas con sus estados', () => {
    abrir()
    expect(screen.getByRole('group', { name: 'Resumen del newsletter' })).toHaveTextContent('Suscriptores activos')
    expect(screen.getByText('persona1@ejemplo.com')).toBeInTheDocument()
    expect(screen.getAllByText('Confirmado').length).toBeGreaterThan(0)
    expect(screen.getByText('Enviando')).toBeInTheDocument()
    expect(screen.getByText('Borrador')).toBeInTheDocument()
    expect(screen.queryByText('Aperturas')).toBeNull()
  })

  it('el Administrador ve «Nueva campaña» y las acciones; un lector las ve ocultas y entra en modo lectura', () => {
    const { unmount } = abrir()
    expect(screen.getByRole('button', { name: 'Nueva campaña' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Dar de baja' }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: 'Borrar datos' }).length).toBeGreaterThan(0)
    unmount()
    Object.assign(mocks.estado, { esAdmin: false, nivel: 'lectura' })
    abrir()
    expect(screen.queryByRole('button', { name: 'Nueva campaña' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Dar de baja' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Borrar datos' })).toBeNull()
    expect(screen.getByText(/modo lectura/)).toBeInTheDocument()
    for (const interruptor of screen.getAllByRole('checkbox', { name: /Mostrar suscripción en el pie/ })) expect(interruptor).toBeDisabled()
  })

  it('con la bandera apagada avisa y no ofrece componer', () => {
    mocks.estado.bandera = false
    abrir()
    expect(screen.getByText(/todavía no está habilitado/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Nueva campaña' })).toBeNull()
  })

  it('dar de baja pide confirmación y llama a la RPC con el suscriptor', async () => {
    abrir()
    fireEvent.click(screen.getAllByRole('button', { name: 'Dar de baja' })[0])
    expect(mocks.llamar).not.toHaveBeenCalled()
    fireEvent.click(await screen.findByRole('button', { name: 'Confirmar' }))
    await waitFor(() => expect(mocks.llamar).toHaveBeenCalledWith('dar_de_baja_suscriptor_newsletter', { p_suscriptor: 's-1' }))
    expect(await screen.findByText('El suscriptor quedó dado de baja.')).toBeInTheDocument()
  })

  it('borrar datos y cancelar envío también piden confirmación', async () => {
    abrir()
    fireEvent.click(screen.getAllByRole('button', { name: 'Borrar datos' })[0])
    fireEvent.click(await screen.findByRole('button', { name: 'Confirmar' }))
    await waitFor(() => expect(mocks.llamar).toHaveBeenCalledWith('borrar_datos_suscriptor_newsletter', { p_suscriptor: 's-1' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Cancelar envío' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Confirmar' }))
    await waitFor(() => expect(mocks.llamar).toHaveBeenCalledWith('cancelar_envio_newsletter', { p_id: 'n-1' }))
  })

  it('un error de la base se muestra con un mensaje legible, sin detalle técnico', async () => {
    mocks.llamar.mockResolvedValue({ data: null, error: { code: '42501', message: 'detalle interno' } })
    abrir()
    fireEvent.click(screen.getAllByRole('button', { name: 'Dar de baja' })[0])
    fireEvent.click(await screen.findByRole('button', { name: 'Confirmar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Tu rol no puede hacer esta acción.')
    expect(screen.queryByText(/detalle interno/)).toBeNull()
  })

  it('el interruptor por tienda llama a guardar_newsletter_configuracion', async () => {
    abrir()
    fireEvent.click(screen.getByRole('checkbox', { name: /Mundo JC/ }))
    await waitFor(() => expect(mocks.llamar).toHaveBeenCalledWith('guardar_newsletter_configuracion', { p_empresa: 'e-2', p_activo: true }))
  })

  it('«Empresa activa»: pide todo con la empresa y, al cambiarla con el diálogo abierto, lo cierra con aviso sin guardar ni enviar', async () => {
    const { rerender } = abrir()
    expect(mocks.useRpc).toHaveBeenCalledWith('listar_newsletters', expect.objectContaining({ p_empresa: 'e-1', p_pagina: 1 }), true)
    fireEvent.click(screen.getByRole('button', { name: 'Nueva campaña' }))
    expect(await screen.findByRole('dialog', { name: 'Nueva campaña' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/^Asunto del correo/), { target: { value: 'Algo sin guardar' } })

    mocks.estado.empresa = 'e-2'
    await act(async () => { rerender(<MemoryRouter><NewsletterPage /></MemoryRouter>) })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Nueva campaña' })).toBeNull())
    expect(screen.getByText('Cambiaste de empresa: se cerró la campaña sin guardar.')).toBeInTheDocument()
    expect(mocks.useRpc).toHaveBeenCalledWith('listar_suscriptores_newsletter', expect.objectContaining({ p_empresa: 'e-2', p_pagina: 1 }), true)
    expect(mocks.useRpc).toHaveBeenCalledWith('resumen_newsletter', { p_empresa: 'e-2' }, true)
    expect(mocks.llamar.mock.calls.map((llamada) => llamada[0])).not.toContain('guardar_newsletter')
    expect(mocks.llamar.mock.calls.map((llamada) => llamada[0])).not.toContain('enviar_newsletter')
  })

  it('no tiene violaciones de accesibilidad', async () => {
    const { container } = abrir()
    expect(await violacionesAxe(container)).toEqual([])
  })
})

describe('Newsletter · diálogo «Nueva campaña»', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.assign(mocks.estado, { empresa: 'e-1', esAdmin: true, nivel: 'edicion', bandera: true })
    respuestas()
    mocks.llamar.mockImplementation(async (nombre: string) => {
      if (nombre === 'vista_previa_newsletter') return { data: { confirmados: 3, generado_en: '2027-03-30T15:00:00Z', html: '<div>Hola &lt;b&gt;</div>' }, error: null }
      if (nombre === 'guardar_newsletter') return { data: { id: 'n-9', version: 1 }, error: null }
      if (nombre === 'enviar_newsletter') return { data: { campana_id: 'c-1', destinatarios: 3 }, error: null }
      return { data: { ok: true }, error: null }
    })
  })

  const abrirDialogo = async () => {
    abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Nueva campaña' }))
    const dialogo = await screen.findByRole('dialog', { name: 'Nueva campaña' })
    await screen.findByDisplayValue('Suscriptores activos (3)')
    return dialogo
  }
  const completar = () => {
    fireEvent.change(screen.getByLabelText(/^Nombre interno/), { target: { value: 'Marzo' } })
    fireEvent.change(screen.getByLabelText(/^Asunto del correo/), { target: { value: 'Novedades de marzo' } })
    fireEvent.change(screen.getByLabelText(/^Mensaje/), { target: { value: 'Hola a todos' } })
  }

  it('no guarda ni envía con datos inválidos y marca los campos (espejo de la base)', async () => {
    await abrirDialogo()
    fireEvent.click(screen.getByRole('button', { name: 'Guardar borrador' }))
    expect(await screen.findByText('El nombre interno es obligatorio.')).toBeInTheDocument()
    expect(screen.getByText('El asunto es obligatorio.')).toBeInTheDocument()
    expect(screen.getByText('El mensaje es obligatorio.')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/^Asunto del correo/), { target: { value: 'a'.repeat(201) } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar borrador' }))
    expect(await screen.findByText('El asunto admite hasta 200 caracteres.')).toBeInTheDocument()
    expect(mocks.llamar.mock.calls.map((c) => c[0])).not.toContain('guardar_newsletter')
  })

  it('guarda el borrador con los límites y las secciones elegidas', async () => {
    await abrirDialogo()
    completar()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Productos destacados' }))
    fireEvent.click(screen.getByRole('button', { name: 'Guardar borrador' }))
    await waitFor(() => expect(mocks.llamar).toHaveBeenCalledWith('guardar_newsletter', {
      p_id: null, p_version: null, p_empresa: 'e-1', p_nombre: 'Marzo', p_asunto: 'Novedades de marzo', p_mensaje: 'Hola a todos', p_destacados: true, p_promociones: false,
    }))
    expect(await screen.findByText('Borrador guardado.')).toBeInTheDocument()
  })

  it('la vista previa muestra el HTML de la base en un iframe sin permisos (CA-NL-9)', async () => {
    await abrirDialogo()
    completar()
    fireEvent.click(screen.getByRole('button', { name: 'Vista previa' }))
    await waitFor(() => expect(mocks.llamar).toHaveBeenCalledWith('vista_previa_newsletter', expect.objectContaining({ p_empresa: 'e-1', p_mensaje: 'Hola a todos' })))
    const marco = await screen.findByTitle('Vista previa del correo')
    expect(marco).toHaveAttribute('sandbox', '')
    expect(marco).toHaveAttribute('srcdoc', '<div>Hola &lt;b&gt;</div>')
    expect(screen.getByText(/Precios al día/)).toBeInTheDocument()
  })

  it('«Enviar a N» pide confirmación, guarda y envía una sola vez con una clave estable (doble clic)', async () => {
    await abrirDialogo()
    completar()
    fireEvent.click(screen.getByRole('button', { name: 'Enviar a 3' }))
    const confirmar = await screen.findByRole('button', { name: 'Confirmar envío' })
    expect(mocks.llamar.mock.calls.map((c) => c[0])).not.toContain('enviar_newsletter')
    fireEvent.click(confirmar)
    await waitFor(() => expect(mocks.llamar.mock.calls.filter((c) => c[0] === 'enviar_newsletter')).toHaveLength(1))
    const [, parametros] = mocks.llamar.mock.calls.find((c) => c[0] === 'enviar_newsletter') as [string, { p_id: string; p_version: number; p_clave: string }]
    expect(parametros.p_id).toBe('n-9')
    expect(parametros.p_clave).toMatch(/^[0-9a-f-]{36}$/)
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Nueva campaña' })).toBeNull())
  })

  it('sin suscriptores confirmados el botón de envío no se puede usar y un error del envío se explica', async () => {
    mocks.llamar.mockImplementation(async (nombre: string) => {
      if (nombre === 'vista_previa_newsletter') return { data: { confirmados: 0, generado_en: '2027-03-30T15:00:00Z', html: '' }, error: null }
      return { data: null, error: null }
    })
    abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Nueva campaña' }))
    await screen.findByDisplayValue('Suscriptores activos (0)')
    expect(within(screen.getByRole('dialog', { name: 'Nueva campaña' })).getByRole('button', { name: 'Enviar a 0' })).toBeDisabled()
  })

  it('un envío rechazado por la base muestra el motivo legible y no cierra el diálogo', async () => {
    mocks.llamar.mockImplementation(async (nombre: string) => {
      if (nombre === 'vista_previa_newsletter') return { data: { confirmados: 3, generado_en: '2027-03-30T15:00:00Z', html: '' }, error: null }
      if (nombre === 'guardar_newsletter') return { data: { id: 'n-9', version: 1 }, error: null }
      return { data: null, error: { code: '22023', hint: 'tienda_apagada', message: 'x' } }
    })
    await (async () => { abrir(); fireEvent.click(screen.getByRole('button', { name: 'Nueva campaña' })); await screen.findByDisplayValue('Suscriptores activos (3)') })()
    completar()
    fireEvent.click(screen.getByRole('button', { name: 'Enviar a 3' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Confirmar envío' }))
    expect(await screen.findByText('Activá el newsletter de la tienda antes de enviar.')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Nueva campaña' })).toBeInTheDocument())
  })
})
