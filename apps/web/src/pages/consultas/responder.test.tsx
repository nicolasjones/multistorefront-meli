import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  useResponsablesConsultas: vi.fn(),
  useRespuestasRapidas: vi.fn(),
  actualizarConsulta: vi.fn(),
  getUser: vi.fn(),
  onCerrar: vi.fn(),
  onGuardado: vi.fn(),
  onRecargar: vi.fn(),
}))

vi.mock('../../hooks/useConsultas', () => ({ useResponsablesConsultas: mocks.useResponsablesConsultas }))
vi.mock('../../hooks/useRespuestasRapidas', () => ({ useRespuestasRapidas: mocks.useRespuestasRapidas }))
vi.mock('../../lib/supabase', () => ({ supabaseClient: { auth: { getUser: mocks.getUser } } }))
vi.mock('../../lib/consultas', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/consultas')>()),
  actualizarConsulta: mocks.actualizarConsulta,
}))

import { ErrorConsulta, type Consulta } from '../../lib/consultas'
import { cambiosAlResponder, enlaceRespuesta } from '../../lib/responderConsulta'
import { armarTextoInicial } from '../../lib/textoInicialConsulta'
import { DetalleConsulta } from '../../components/consultas/DetalleConsulta'

const YO = 'u-yo'
const consulta = (extra: Partial<Consulta> = {}): Consulta => ({
  id: 'c1000000-0000-0000-0000-000000000001',
  empresa_id: 'e-1',
  empresa_nombre: 'San Javucho',
  origen: 'formulario',
  nombre: 'Ana Pérez',
  contacto: 'ana@example.com',
  mensaje: 'Hola',
  producto_id: null,
  producto_nombre: null,
  estado: 'nueva',
  responsable_id: null,
  responsable_nombre: null,
  nota_interna: null,
  created_at: '2026-10-23T11:48:00.000Z',
  updated_at: '2026-10-23T11:48:00.000Z',
  ...extra,
})

const abrir = (fila: Consulta = consulta(), puedeEditar = true) => {
  render(
    <DetalleConsulta
      consulta={fila}
      puedeEditar={puedeEditar}
      onCerrar={mocks.onCerrar}
      onGuardado={mocks.onGuardado}
      onRecargar={mocks.onRecargar}
    />,
  )
}

const responder = (nombre: RegExp | string) => fireEvent.click(screen.getByRole('button', { name: nombre }))

const RAPIDA = {
  id: 'r1', empresa_id: 'e-1', titulo: 'Gracias', texto: 'Hola {nombre}, gracias por escribir a {tienda} por {producto}.',
  created_at: '2026-10-23T11:00:00.000Z', updated_at: '2026-10-23T11:00:00.000Z',
}

describe('texto inicial (FR-009)', () => {
  it('saluda con el nombre y nombra la tienda, con y sin producto', () => {
    expect(armarTextoInicial(consulta()).cuerpo).toBe('Hola Ana Pérez, te escribimos de San Javucho por tu consulta. ')
    expect(armarTextoInicial(consulta({ producto_nombre: 'Funda' })).cuerpo).toBe(
      'Hola Ana Pérez, te escribimos de San Javucho por tu consulta por Funda. ',
    )
    expect(armarTextoInicial(consulta()).asunto).toBe('Tu consulta en San Javucho')
  })
})

describe('enlace por canal (FR-007, FR-008)', () => {
  it('un correo va codificado en el mailto con asunto y cuerpo', () => {
    const enlace = enlaceRespuesta(consulta({ producto_nombre: 'Funda & Co' }))
    expect(enlace?.via).toBe('correo')
    const href = enlace!.href
    expect(href.startsWith('mailto:ana%40example.com?subject=Tu%20consulta%20en%20San%20Javucho&body=')).toBe(true)
    expect(href).toContain('Funda%20%26%20Co')
    expect(href).not.toContain(' ')
  })

  it('un correo con parámetros inyectados queda como texto del destinatario', () => {
    expect(enlaceRespuesta(consulta({ contacto: 'a?bcc=x@example.com' }))?.href).toContain('mailto:a%3Fbcc%3Dx%40example.com?')
  })

  it('un teléfono se reduce a dígitos para wa.me y lleva el texto codificado', () => {
    const enlace = enlaceRespuesta(consulta({ contacto: '+54 9 11 5555-1234', producto_nombre: 'Funda' }))
    expect(enlace?.via).toBe('WhatsApp')
    expect(enlace?.href.startsWith('https://wa.me/5491155551234?text=Hola%20Ana%20P%C3%A9rez')).toBe(true)
  })

  it('un contacto que no es ni correo ni teléfono no ofrece enlace', () => {
    expect(enlaceRespuesta(consulta({ contacto: '123' }))).toBeNull()
  })
})

describe('cambios al responder (FR-010)', () => {
  it('nueva pasa a en curso y toma al usuario como responsable', () => {
    expect(cambiosAlResponder({ estado: 'nueva', responsable_id: null }, YO)).toEqual({ estado: 'en_curso', responsableId: YO })
  })
  it('no pisa al responsable ni reabre una resuelta', () => {
    expect(cambiosAlResponder({ estado: 'resuelta', responsable_id: 'u-otro' }, YO)).toEqual({ estado: 'resuelta', responsableId: 'u-otro' })
    expect(cambiosAlResponder({ estado: 'en_curso', responsable_id: null }, YO)).toEqual({ estado: 'en_curso', responsableId: YO })
  })
})

describe('Responder por… en el detalle (FR-007…FR-013, SC-003)', () => {
  const abrirVentana = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('open', abrirVentana)
    mocks.useResponsablesConsultas.mockReturnValue({ responsables: [], isLoading: false, isError: false })
    mocks.useRespuestasRapidas.mockReturnValue({ respuestas: [], isLoading: false, isError: false, refetch: vi.fn() })
    mocks.getUser.mockResolvedValue({ data: { user: { id: YO } }, error: null })
    mocks.actualizarConsulta.mockResolvedValue('2026-10-23T12:00:00.000Z')
  })
  afterEach(() => vi.unstubAllGlobals())

  it('abre el enlace en pestaña nueva con noopener y registra En curso a nombre del usuario', async () => {
    abrir(consulta({ nota_interna: 'Nota vigente', updated_at: '2026-10-23T11:48:00.000Z' }))
    responder('Responder por correo')
    expect(abrirVentana).toHaveBeenCalledTimes(1)
    expect(abrirVentana.mock.calls[0][0]).toMatch(/^mailto:ana%40example.com\?subject=/)
    expect(abrirVentana.mock.calls[0][1]).toBe('_blank')
    expect(abrirVentana.mock.calls[0][2]).toBe('noopener,noreferrer')
    await waitFor(() => expect(mocks.actualizarConsulta).toHaveBeenCalledWith({
      id: 'c1000000-0000-0000-0000-000000000001',
      estado: 'en_curso',
      responsableId: YO,
      nota: 'Nota vigente',
      actualizadoEn: '2026-10-23T11:48:00.000Z',
    }))
    // FR-013: dice cómo quedó la consulta, no que el mensaje salió.
    await waitFor(() => expect(mocks.onGuardado).toHaveBeenCalledWith('Consulta En curso a tu nombre · Ana Pérez'))
    expect(mocks.onGuardado.mock.calls[0][0]).not.toMatch(/enviad/i)
  })

  it('por WhatsApp abre wa.me', async () => {
    abrir(consulta({ origen: 'whatsapp', contacto: '+54 9 11 5555-1234' }))
    responder('Responder por WhatsApp')
    expect(abrirVentana.mock.calls[0][0]).toMatch(/^https:\/\/wa\.me\/5491155551234\?text=/)
    await waitFor(() => expect(mocks.onGuardado).toHaveBeenCalled())
  })

  it('no pisa a otro responsable ni reabre una resuelta', async () => {
    abrir(consulta({ estado: 'resuelta', responsable_id: 'u-otro', responsable_nombre: 'Beto' }))
    responder('Responder por correo')
    await waitFor(() => expect(mocks.actualizarConsulta).toHaveBeenCalledWith(
      expect.objectContaining({ estado: 'resuelta', responsableId: 'u-otro' }),
    ))
    await waitFor(() => expect(mocks.onGuardado).toHaveBeenCalledWith('Consulta Resuelta a nombre de Beto · Ana Pérez'))
  })

  it('con solo lectura el botón está deshabilitado con la ayuda «Necesitás permiso de edición»', async () => {
    abrir(consulta(), false)
    const boton = screen.getByRole('button', { name: 'Responder por correo' })
    expect(boton).toBeDisabled()
    fireEvent.mouseOver(boton.parentElement as HTMLElement)
    expect(await screen.findByText('Necesitás permiso de edición')).toBeInTheDocument()
    expect(abrirVentana).not.toHaveBeenCalled()
    expect(mocks.actualizarConsulta).not.toHaveBeenCalled()
  })

  it('si el registro falla la app ya se abrió: muestra el error y «Reintentar» solo registra, sin reabrir', async () => {
    mocks.actualizarConsulta.mockRejectedValueOnce(new ErrorConsulta('boom', null))
    abrir()
    responder('Responder por correo')
    const alerta = await screen.findByRole('alert')
    expect(within(alerta).getByText('No se registró la respuesta.')).toBeInTheDocument()
    expect(mocks.onGuardado).not.toHaveBeenCalled()
    fireEvent.click(within(alerta).getByRole('button', { name: 'Reintentar' }))
    await waitFor(() => expect(mocks.onGuardado).toHaveBeenCalledTimes(1))
    expect(abrirVentana).toHaveBeenCalledTimes(1)
    expect(mocks.actualizarConsulta).toHaveBeenCalledTimes(2)
  })

  it('un conflicto (40001) ofrece «Recargar»', async () => {
    mocks.actualizarConsulta.mockRejectedValueOnce(new ErrorConsulta('x', '40001'))
    abrir()
    responder('Responder por correo')
    const alerta = await screen.findByRole('alert')
    expect(within(alerta).getByText('La consulta cambió.')).toBeInTheDocument()
    fireEvent.click(within(alerta).getByRole('button', { name: 'Recargar' }))
    expect(mocks.onRecargar).toHaveBeenCalled()
  })

  it('un permiso denegado (42501) muestra un mensaje claro', async () => {
    mocks.actualizarConsulta.mockRejectedValueOnce(new ErrorConsulta('x', '42501'))
    abrir()
    responder('Responder por correo')
    expect(await screen.findByText('No tenés permiso para editar esta consulta.')).toBeInTheDocument()
  })

  it('sin sesión no se escribe nada y se informa el fallo', async () => {
    mocks.getUser.mockResolvedValueOnce({ data: { user: null }, error: null })
    abrir()
    responder('Responder por correo')
    expect(await screen.findByText('No se registró la respuesta.')).toBeInTheDocument()
    expect(mocks.actualizarConsulta).not.toHaveBeenCalled()
  })

  it('un segundo clic inmediato no duplica el registro', async () => {
    abrir()
    await act(async () => {
      responder('Responder por correo')
      responder('Responder por correo')
    })
    await waitFor(() => expect(mocks.onGuardado).toHaveBeenCalled())
    expect(abrirVentana).toHaveBeenCalledTimes(1)
    expect(mocks.actualizarConsulta).toHaveBeenCalledTimes(1)
  })
})

describe('Respuesta rápida al responder (F-CON-06, FR-016)', () => {
  const abrirVentana = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('open', abrirVentana)
    mocks.useResponsablesConsultas.mockReturnValue({ responsables: [], isLoading: false, isError: false })
    mocks.useRespuestasRapidas.mockReturnValue({ respuestas: [RAPIDA], isLoading: false, isError: false, refetch: vi.fn() })
    mocks.getUser.mockResolvedValue({ data: { user: { id: YO } }, error: null })
    mocks.actualizarConsulta.mockResolvedValue('2026-10-23T12:00:00.000Z')
  })
  afterEach(() => vi.unstubAllGlobals())

  it('armarTextoInicial usa la respuesta con variables resueltas y conserva el asunto', () => {
    const texto = armarTextoInicial(consulta({ producto_nombre: 'Funda' }), RAPIDA)
    expect(texto.cuerpo).toBe('Hola Ana Pérez, gracias por escribir a San Javucho por Funda.')
    expect(texto.asunto).toBe('Tu consulta en San Javucho')
  })

  it('sin respuesta elegida queda la plantilla de siempre', () => {
    expect(armarTextoInicial(consulta(), null).cuerpo).toBe(armarTextoInicial(consulta()).cuerpo)
  })

  it('el enlace codifica el texto de la respuesta (&, saltos de línea y llaves sueltas)', () => {
    const enlace = enlaceRespuesta(consulta(), { texto: 'Ofertas & más\n{raro}' })
    expect(enlace?.href).toContain('body=Ofertas%20%26%20m%C3%A1s%0A%7Braro%7D')
  })

  it('elegir «Respuesta rápida» abre el enlace con ese texto y registra la respuesta como siempre', async () => {
    abrir(consulta({ producto_nombre: 'Funda' }))
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Respuesta rápida' }))
    fireEvent.click(await screen.findByRole('option', { name: 'Gracias' }))
    responder('Responder por correo')
    const href = decodeURIComponent(abrirVentana.mock.calls[0][0] as string)
    expect(href).toContain('body=Hola Ana Pérez, gracias por escribir a San Javucho por Funda.')
    await waitFor(() => expect(mocks.onGuardado).toHaveBeenCalledWith('Consulta En curso a tu nombre · Ana Pérez'))
  })

  it('sin elegir ninguna el texto es el de siempre', () => {
    abrir()
    responder('Responder por correo')
    expect(decodeURIComponent(abrirVentana.mock.calls[0][0] as string)).toContain('te escribimos de San Javucho por tu consulta')
  })

  it('el selector pide solo las respuestas de la empresa de la consulta y no aparece con solo lectura', () => {
    abrir(consulta({ empresa_id: 'e-9' }))
    expect(mocks.useRespuestasRapidas).toHaveBeenCalledWith('e-9')
  })

  it('con solo lectura no hay selector ni se consultan respuestas', () => {
    mocks.useRespuestasRapidas.mockReturnValue({ respuestas: [], isLoading: false, isError: false, refetch: vi.fn() })
    abrir(consulta(), false)
    expect(mocks.useRespuestasRapidas).toHaveBeenCalledWith(null)
    expect(screen.queryByRole('combobox', { name: 'Respuesta rápida' })).toBeNull()
  })
})
