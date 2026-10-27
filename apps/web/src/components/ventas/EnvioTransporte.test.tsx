import type { ComponentProps } from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// F-VTA-16 (MSF-166, SC-005, FR-023): bloque «Envío y transporte» del comprobante. El rótulo del selector según
// la forma de envío, el texto de «Retiro en local», el aviso de qué falta, el rol en lectura y el cambio de
// empresa activa (Principio VIII): lo elegido en una tienda nunca se guarda en otra.

const mocks = vi.hoisted(() => ({
  obtenerDespachoComprobante: vi.fn(),
  obtenerFormaEnvioDeComprobante: vi.fn(),
  obtenerEnvioComprobante: vi.fn(),
  obtenerTransportePorId: vi.fn(),
  listarTransportesDeEmpresa: vi.fn(),
  guardarEnvioComprobante: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({ supabaseClient: { rpc: vi.fn() } }))

// Solo se reemplazan las lecturas y el guardado; los rótulos, la elegibilidad y los mensajes son los de la
// biblioteca (los verifica `ventasEnvio.test.ts`).
vi.mock('../../lib/ventasEnvio', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/ventasEnvio')>()),
  obtenerFormaEnvioDeComprobante: mocks.obtenerFormaEnvioDeComprobante,
  obtenerEnvioComprobante: mocks.obtenerEnvioComprobante,
  obtenerTransportePorId: mocks.obtenerTransportePorId,
  listarTransportesDeEmpresa: mocks.listarTransportesDeEmpresa,
  guardarEnvioComprobante: mocks.guardarEnvioComprobante,
}))

vi.mock('../../lib/ventasDespacho', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/ventasDespacho')>()),
  obtenerDespachoComprobante: mocks.obtenerDespachoComprobante,
}))

import {
  ETIQUETA_GUARDAR_ENVIO,
  LARGO_MAXIMO_GUIA,
  MENSAJE_CONFLICTO_ENVIO,
  MENSAJE_ERROR_CARGA_ENVIO,
  MENSAJE_EXITO_ENVIO,
  MENSAJE_FACTURA_ENTREGADA,
  MENSAJE_SIN_FORMA_ENVIO,
  MENSAJE_SIN_PERMISO_ENVIO,
  TEXTO_RETIRO_EN_LOCAL,
  type DatosEnvio,
  type FormaEnvioDelComprobante,
  type Transporte,
  type TipoFormaEnvio,
} from '../../lib/ventasEnvio'
import { AVISO_CAMBIO_DE_TIENDA_ENVIO, EnvioTransporte } from './EnvioTransporte'
import { MENSAJE_SIN_ESTADO_DESPACHO } from '../../lib/ventasDespacho'

const forma = (tipo: TipoFormaEnvio, exige = false): FormaEnvioDelComprobante => ({
  id: 'f-1',
  nombre: tipo === 'retiro_local' ? 'Retiro en local' : 'Expreso',
  tipo,
  exige_transporte_guia: exige,
})

const ENVIO: DatosEnvio = {
  transporte_id: null,
  guia: null,
  fecha_envio: null,
  updated_at: '2026-12-14T10:00:00.123456+00:00',
}

const ENVIO_CARGADO: DatosEnvio = {
  transporte_id: 't-expreso',
  guia: 'A-004471',
  fecha_envio: '2026-10-08',
  updated_at: '2026-12-14T10:00:00.123456+00:00',
}

const transporte = (id: string, nombre: string, tipo: Transporte['tipo'], activa = true): Transporte => ({
  id,
  organizacion_id: 'o-1',
  nombre,
  tipo,
  cuit: null,
  terminal_retiro: null,
  localidad: null,
  telefono: null,
  correo: null,
  persona_contacto: null,
  direccion: null,
  cobra_contrarreembolso: false,
  comision_pct: 0,
  plazo_rendicion_dias: 0,
  orden: 1,
  activa,
  updated_at: '2026-12-14T10:00:00Z',
  empresas: [],
})

const CATALOGO: Transporte[] = [
  transporte('t-expreso', 'Expreso Ejemplo', 'expreso'),
  transporte('t-correo', 'Correo Ejemplo', 'correo'),
  transporte('t-apagado', 'Expreso Apagado', 'expreso', false),
]

// Despacho de la factura: el bloque lo lee para saber si puede despachar y si la factura ya fue entregada.
const DESPACHO = {
  estado_despacho: 'sin_armar',
  armo_id: null,
  armo: null,
  controlo_id: null,
  controlo: null,
  entrego_id: null,
  entrego: null,
  entregado_en: null,
  updated_at: '2026-12-14T10:00:00.123456+00:00',
  puede_despachar: true,
}

const renderBloque = (props: Partial<ComponentProps<typeof EnvioTransporte>> = {}) => {
  const onCambio = vi.fn()
  const utils = render(
    <EnvioTransporte
      comprobanteId="k-1"
      empresaId="e-1"
      envioId="f-1"
      empresaActivaId="e-1"
      puedeEditar
      onCambio={onCambio}
      {...props}
    />,
  )
  return { ...utils, onCambio }
}

// El selector de MUI arma el nombre accesible con la etiqueta y el valor elegido, así que se busca por el
// comienzo de la etiqueta.
const selector = (nombre: RegExp) => screen.getByRole('combobox', { name: nombre })

const opciones = async () => {
  fireEvent.mouseDown(selector(/^Transporte \/ expreso/))
  const lista = await screen.findByRole('listbox')
  return within(lista).getAllByRole('option')
}

const elegirTransporte = async (nombre: string) => {
  fireEvent.mouseDown(selector(/^Transporte \/ expreso/))
  fireEvent.click(await screen.findByRole('option', { name: nombre }))
  // Al elegir, el menú se cierra y la pantalla vuelve a quedar accesible para el lector de pantalla.
  await waitFor(() => expect(selector(/^Transporte \/ expreso/)).toHaveAttribute('aria-expanded', 'false'))
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  mocks.obtenerDespachoComprobante.mockResolvedValue(DESPACHO)
  mocks.obtenerFormaEnvioDeComprobante.mockResolvedValue(forma('expreso'))
  mocks.obtenerEnvioComprobante.mockResolvedValue(ENVIO)
  mocks.obtenerTransportePorId.mockResolvedValue(null)
  mocks.listarTransportesDeEmpresa.mockResolvedValue(CATALOGO)
  mocks.guardarEnvioComprobante.mockResolvedValue(ENVIO)
})

describe('Rótulo del selector según la forma de envío (FR-023)', () => {
  const casos: ReadonlyArray<[TipoFormaEnvio, string]> = [
    ['expreso', 'Transporte / expreso'],
    ['terminal', 'Transporte / expreso'],
    ['correo', 'Correo'],
    ['moto', 'Mensajería propia'],
  ]

  it.each(casos)('con la forma «%s» el selector se llama «%s»', async (tipo, rotulo) => {
    mocks.obtenerFormaEnvioDeComprobante.mockResolvedValue(forma(tipo))
    renderBloque()
    expect(await screen.findByRole('combobox', { name: new RegExp(`^${rotulo}`) })).toBeInTheDocument()
    // Los campos de la guía y de la fecha de envío están siempre.
    expect(screen.getByLabelText('Guía')).toBeInTheDocument()
    expect(screen.getByLabelText('Fecha de envío')).toBeInTheDocument()
  })

  it('con «Retiro en local» no hay selector: avisa que el cliente retira en el local', async () => {
    mocks.obtenerFormaEnvioDeComprobante.mockResolvedValue(forma('retiro_local'))
    renderBloque()
    expect(await screen.findByText(TEXTO_RETIRO_EN_LOCAL)).toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Guía')).not.toBeInTheDocument()
    // Sin transporte no hay nada que cargar.
    expect(mocks.listarTransportesDeEmpresa).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: ETIQUETA_GUARDAR_ENVIO })).not.toBeInTheDocument()
  })
})

describe('Transportes que se pueden elegir (FR-021, FR-023)', () => {
  it('solo ofrece los del tipo de la forma de envío y los activos', async () => {
    renderBloque()
    await screen.findByRole('combobox', { name: /^Transporte \/ expreso/ })
    const nombres = (await opciones()).map((opcion) => opcion.textContent)
    expect(nombres).toEqual(['Sin transporte', 'Expreso Ejemplo'])
  })

  it('un transporte desactivado que ya está cargado se muestra pero no se puede elegir', async () => {
    mocks.obtenerEnvioComprobante.mockResolvedValue({ ...ENVIO, transporte_id: 't-apagado' })
    renderBloque()
    await screen.findByRole('combobox', { name: /^Transporte \/ expreso/ })
    const lista = await opciones()
    const apagado = lista.find((opcion) => opcion.textContent === 'Expreso Apagado (desactivado)')
    expect(apagado).toBeDefined()
    expect(apagado).toHaveAttribute('aria-disabled', 'true')
  })

  it('muestra el transporte, la guía y la fecha ya cargados', async () => {
    mocks.obtenerEnvioComprobante.mockResolvedValue(ENVIO_CARGADO)
    renderBloque()
    await screen.findByRole('combobox', { name: /^Transporte \/ expreso/ })
    expect(selector(/^Transporte \/ expreso/)).toHaveTextContent('Expreso Ejemplo')
    expect(screen.getByLabelText('Guía')).toHaveValue('A-004471')
    expect(screen.getByLabelText('Fecha de envío')).toHaveValue('2026-10-08')
  })

  it('un transporte cargado que no corresponde a la forma de envío se muestra pero no se puede elegir', async () => {
    // La factura salió con un transporte de correo, pero la forma de envío ahora es «Expreso»: el transporte
    // cargado se muestra (para saber qué salió) y no se puede elegir (la base lo rechazaría).
    mocks.obtenerEnvioComprobante.mockResolvedValue({ ...ENVIO, transporte_id: 't-correo' })
    renderBloque()
    await screen.findByRole('combobox', { name: /^Transporte \/ expreso/ })
    const lista = await opciones()
    const correo = lista.find(
      (opcion) => opcion.textContent === 'Correo Ejemplo (no corresponde a esta forma de envío)',
    )
    expect(correo).toBeDefined()
    expect(correo).toHaveAttribute('aria-disabled', 'true')
  })

  it('un transporte que ya no se usa en la tienda se muestra y no se puede elegir', async () => {
    // MSF-139 le quitó la tienda al transporte: el catálogo de la tienda no lo trae, pero la factura lo tiene.
    mocks.obtenerEnvioComprobante.mockResolvedValue({ ...ENVIO, transporte_id: 't-fuera' })
    mocks.obtenerTransportePorId.mockResolvedValue({
      id: 't-fuera',
      nombre: 'Expreso Retirado',
      activa: true,
    })
    renderBloque()
    await screen.findByRole('combobox', { name: /^Transporte \/ expreso/ })
    // El transporte de la factura se lee por id, porque el catálogo ya no lo trae.
    expect(mocks.obtenerTransportePorId).toHaveBeenCalledWith('t-fuera')
    // El selector no queda en blanco: la factura no parece no tener transporte.
    expect(selector(/^Transporte \/ expreso/)).toHaveTextContent('Expreso Retirado')
    const lista = await opciones()
    const fuera = lista.find((opcion) => opcion.textContent === 'Expreso Retirado (no se usa en esta tienda)')
    expect(fuera).toBeDefined()
    expect(fuera).toHaveAttribute('aria-disabled', 'true')
  })

  it('un transporte cargado que sí está en la tienda no se vuelve a leer por id', async () => {
    mocks.obtenerEnvioComprobante.mockResolvedValue(ENVIO_CARGADO)
    renderBloque()
    await screen.findByRole('combobox', { name: /^Transporte \/ expreso/ })
    expect(mocks.obtenerTransportePorId).not.toHaveBeenCalled()
  })
})

describe('Aviso de qué falta (FR-022, FR-023)', () => {
  it('con una forma que exige transporte y guía avisa que faltan los dos', async () => {
    mocks.obtenerFormaEnvioDeComprobante.mockResolvedValue(forma('expreso', true))
    renderBloque()
    expect(
      await screen.findByText('Faltan el transporte y la guía: con esta forma de envío la factura no se puede entregar.'),
    ).toBeInTheDocument()
  })

  it('con el transporte elegido avisa que falta la guía', async () => {
    mocks.obtenerFormaEnvioDeComprobante.mockResolvedValue(forma('expreso', true))
    renderBloque()
    await screen.findByRole('combobox', { name: /^Transporte \/ expreso/ })
    await elegirTransporte('Expreso Ejemplo')
    expect(
      await screen.findByText('Falta la guía: con esta forma de envío la factura no se puede entregar.'),
    ).toBeInTheDocument()
  })

  it('con la guía cargada y sin transporte avisa que falta el transporte', async () => {
    mocks.obtenerFormaEnvioDeComprobante.mockResolvedValue(forma('expreso', true))
    renderBloque()
    await screen.findByRole('combobox', { name: /^Transporte \/ expreso/ })
    // Con la guía escrita solo falta el transporte: el aviso lo dice (no «faltan los dos»).
    fireEvent.change(screen.getByLabelText('Guía'), { target: { value: 'A-004471' } })
    expect(
      await screen.findByText('Falta el transporte: con esta forma de envío la factura no se puede entregar.'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/Faltan el transporte/)).not.toBeInTheDocument()
  })

  it('con la guía cargada no avisa que falta nada', async () => {
    mocks.obtenerFormaEnvioDeComprobante.mockResolvedValue(forma('expreso', true))
    mocks.obtenerEnvioComprobante.mockResolvedValue(ENVIO_CARGADO)
    renderBloque()
    await screen.findByRole('combobox', { name: /^Transporte \/ expreso/ })
    expect(screen.queryByText(/Falta la guía/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Faltan el transporte/)).not.toBeInTheDocument()
  })

  it('una forma que no exige transporte ni guía no avisa', async () => {
    renderBloque()
    await screen.findByRole('combobox', { name: /^Transporte \/ expreso/ })
    expect(screen.queryByText(/Falta/)).not.toBeInTheDocument()
  })
})

describe('Guardar el envío (FR-021, FR-023)', () => {
  it('manda el transporte, la guía y la fecha con el bloqueo optimista y avisa que se guardó', async () => {
    mocks.guardarEnvioComprobante.mockResolvedValue({
      ...ENVIO_CARGADO,
      updated_at: '2026-12-14T11:00:00.123456+00:00',
    })
    const { onCambio } = renderBloque()
    await screen.findByRole('combobox', { name: /^Transporte \/ expreso/ })
    await elegirTransporte('Expreso Ejemplo')
    fireEvent.change(screen.getByLabelText('Guía'), { target: { value: 'A-004471' } })
    fireEvent.change(screen.getByLabelText('Fecha de envío'), { target: { value: '2026-10-08' } })
    fireEvent.click(screen.getByRole('button', { name: ETIQUETA_GUARDAR_ENVIO }))
    await waitFor(() => expect(mocks.guardarEnvioComprobante).toHaveBeenCalledTimes(1))
    expect(mocks.guardarEnvioComprobante).toHaveBeenCalledWith({
      id: 'k-1',
      transporteId: 't-expreso',
      guia: 'A-004471',
      fechaEnvio: '2026-10-08',
      actualizadoEn: '2026-12-14T10:00:00.123456+00:00',
    })
    expect(await screen.findByText(MENSAJE_EXITO_ENVIO)).toBeInTheDocument()
    // El `updated_at` de la factura avanzó: la pantalla recarga el comprobante.
    expect(onCambio).toHaveBeenCalledTimes(1)
  })

  it('una guía de más de 100 caracteres no se guarda y avisa en el campo', async () => {
    renderBloque()
    await screen.findByRole('combobox', { name: /^Transporte \/ expreso/ })
    fireEvent.change(screen.getByLabelText('Guía'), { target: { value: 'x'.repeat(LARGO_MAXIMO_GUIA + 1) } })
    expect(
      await screen.findByText(`La guía no puede tener más de ${LARGO_MAXIMO_GUIA} caracteres.`),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: ETIQUETA_GUARDAR_ENVIO }))
    expect(mocks.guardarEnvioComprobante).not.toHaveBeenCalled()
  })

  it('un doble clic no manda dos veces el envío', async () => {
    mocks.guardarEnvioComprobante.mockImplementation(() => new Promise(() => undefined))
    renderBloque()
    await screen.findByRole('combobox', { name: /^Transporte \/ expreso/ })
    fireEvent.change(screen.getByLabelText('Guía'), { target: { value: 'A-004471' } })
    const boton = screen.getByRole('button', { name: ETIQUETA_GUARDAR_ENVIO })
    fireEvent.click(boton)
    fireEvent.click(boton)
    await waitFor(() => expect(mocks.guardarEnvioComprobante).toHaveBeenCalledTimes(1))
    expect(boton).toBeDisabled()
  })

  it('muestra el mensaje en castellano de la base y no avisa que se guardó', async () => {
    mocks.guardarEnvioComprobante.mockRejectedValue({
      code: '22023',
      message: 'El transporte «Expreso Ejemplo» está desactivado: elegí otro',
    })
    const { onCambio } = renderBloque()
    await screen.findByRole('combobox', { name: /^Transporte \/ expreso/ })
    fireEvent.change(screen.getByLabelText('Guía'), { target: { value: 'A-004471' } })
    fireEvent.click(screen.getByRole('button', { name: ETIQUETA_GUARDAR_ENVIO }))
    expect(
      await screen.findByText('El transporte «Expreso Ejemplo» está desactivado: elegí otro'),
    ).toBeInTheDocument()
    expect(screen.queryByText(MENSAJE_EXITO_ENVIO)).not.toBeInTheDocument()
    expect(onCambio).not.toHaveBeenCalled()
  })

  it('un conflicto de concurrencia avisa que hay que recargar y vuelve a leer el envío', async () => {
    mocks.guardarEnvioComprobante.mockRejectedValue({
      code: '40001',
      message: 'Alguien modificó este comprobante mientras lo mirabas: recargalo y volvé a intentar',
    })
    renderBloque()
    await screen.findByRole('combobox', { name: /^Transporte \/ expreso/ })
    fireEvent.change(screen.getByLabelText('Guía'), { target: { value: 'A-004471' } })
    fireEvent.click(screen.getByRole('button', { name: ETIQUETA_GUARDAR_ENVIO }))
    expect(await screen.findByText(MENSAJE_CONFLICTO_ENVIO)).toBeInTheDocument()
    // Se relee el envío para que el reintento vaya con el `updated_at` nuevo.
    await waitFor(() => expect(mocks.obtenerEnvioComprobante).toHaveBeenCalledTimes(2))
  })

  it('un error inesperado avisa que no se guardó nada, sin datos técnicos', async () => {
    mocks.guardarEnvioComprobante.mockRejectedValue({ code: 'XX000', message: 'relation dominio.x does not exist' })
    renderBloque()
    await screen.findByRole('combobox', { name: /^Transporte \/ expreso/ })
    fireEvent.change(screen.getByLabelText('Guía'), { target: { value: 'A-004471' } })
    fireEvent.click(screen.getByRole('button', { name: ETIQUETA_GUARDAR_ENVIO }))
    expect(await screen.findByText('No pudimos guardar el envío. No se guardó nada: probá de nuevo.')).toBeInTheDocument()
    expect(screen.queryByText(/relation/)).not.toBeInTheDocument()
  })
})

describe('Solo lectura (FR-023)', () => {
  it('sin `despachar` y sin Ventas en `edicion` se ve el envío pero no se puede cargar', async () => {
    mocks.obtenerDespachoComprobante.mockResolvedValue({ ...DESPACHO, puede_despachar: false })
    renderBloque({ puedeEditar: false })
    await screen.findByRole('combobox', { name: /^Transporte \/ expreso/ })
    expect(screen.getByText(MENSAJE_SIN_PERMISO_ENVIO)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: ETIQUETA_GUARDAR_ENVIO })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Guía')).toBeDisabled()
    expect(selector(/^Transporte \/ expreso/)).toHaveAttribute('aria-disabled', 'true')
  })

  it('con la acción `despachar` se puede cargar aunque Ventas no esté en `edicion`', async () => {
    renderBloque({ puedeEditar: false })
    await screen.findByRole('combobox', { name: /^Transporte \/ expreso/ })
    expect(screen.queryByText(MENSAJE_SIN_PERMISO_ENVIO)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: ETIQUETA_GUARDAR_ENVIO })).toBeInTheDocument()
  })
})

describe('Factura entregada (FR-021, FR-023)', () => {
  it('no ofrece «Guardar envío» ni deja cambiar los campos: el envío de una factura entregada no se cambia', async () => {
    // La factura está entregada: la base rechaza siempre cualquier cambio de envío.
    mocks.obtenerDespachoComprobante.mockResolvedValue({ ...DESPACHO, estado_despacho: 'entregado' })
    mocks.obtenerFormaEnvioDeComprobante.mockResolvedValue(forma('expreso', true))
    renderBloque()
    await screen.findByRole('combobox', { name: /^Transporte \/ expreso/ })
    expect(await screen.findByText(MENSAJE_FACTURA_ENTREGADA)).toBeInTheDocument()
    // Los campos quedan deshabilitados.
    expect(screen.getByLabelText('Guía')).toBeDisabled()
    expect(screen.getByLabelText('Fecha de envío')).toBeDisabled()
    expect(selector(/^Transporte \/ expreso/)).toHaveAttribute('aria-disabled', 'true')
    // No se ofrece la acción que la base siempre rechaza.
    expect(screen.queryByRole('button', { name: ETIQUETA_GUARDAR_ENVIO })).not.toBeInTheDocument()
    expect(mocks.guardarEnvioComprobante).not.toHaveBeenCalled()
    // Y no es un tema de permisos: no se muestra el aviso de «tu rol no puede cargarlo».
    expect(screen.queryByText(MENSAJE_SIN_PERMISO_ENVIO)).not.toBeInTheDocument()
    // La factura ya salió: no tiene sentido avisar que falta el transporte o la guía para entregarla.
    expect(screen.queryByText(/Falta/)).not.toBeInTheDocument()
  })

  it('muestra el transporte que ya no se usa en la tienda, pero sin ofrecer guardar', async () => {
    // Los dos casos juntos: la factura ya se entregó y MSF-139 le quitó la tienda al transporte cargado.
    mocks.obtenerDespachoComprobante.mockResolvedValue({ ...DESPACHO, estado_despacho: 'entregado' })
    mocks.obtenerEnvioComprobante.mockResolvedValue({ ...ENVIO_CARGADO, transporte_id: 't-fuera' })
    mocks.obtenerTransportePorId.mockResolvedValue({
      id: 't-fuera',
      nombre: 'Expreso Retirado',
      activa: true,
    })
    renderBloque()
    await screen.findByRole('combobox', { name: /^Transporte \/ expreso/ })
    // Se lee por id: el selector no queda en blanco aunque el catálogo de la tienda no lo traiga.
    expect(mocks.obtenerTransportePorId).toHaveBeenCalledWith('t-fuera')
    expect(selector(/^Transporte \/ expreso/)).toHaveTextContent('Expreso Retirado')
    // Y sigue en solo lectura: nada de la acción que la base rechaza siempre.
    expect(selector(/^Transporte \/ expreso/)).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByLabelText('Guía')).toBeDisabled()
    expect(screen.getByLabelText('Fecha de envío')).toBeDisabled()
    expect(screen.queryByRole('button', { name: ETIQUETA_GUARDAR_ENVIO })).not.toBeInTheDocument()
    expect(mocks.guardarEnvioComprobante).not.toHaveBeenCalled()
  })
})

describe('Lo que la base acepta (FR-021, FR-023)', () => {
  it('mientras se lee el estado del despacho no ofrece «Guardar envío»', async () => {
    // El estado del despacho decide si la factura ya fue entregada (y la base rechaza siempre ese envío): hasta
    // que se sepa, el bloque no ofrece la acción.
    let resolver: ((despacho: typeof DESPACHO) => void) | undefined
    mocks.obtenerDespachoComprobante.mockImplementation(
      () => new Promise((resolve) => { resolver = resolve }),
    )
    renderBloque()
    expect(await screen.findByRole('status', { name: 'Cargando contenido' })).toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: ETIQUETA_GUARDAR_ENVIO })).not.toBeInTheDocument()

    await act(async () => { resolver?.({ ...DESPACHO, estado_despacho: 'entregado' }) })

    // Cuando se sabe que la factura ya salió, el bloque avisa y sigue sin ofrecer la acción.
    expect(await screen.findByText(MENSAJE_FACTURA_ENTREGADA)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: ETIQUETA_GUARDAR_ENVIO })).not.toBeInTheDocument()
  })

  it('una factura que todavía no entró al despacho no ofrece «Guardar envío»', async () => {
    // La base rechaza el envío de una factura sin estado de despacho (`55000`): el bloque lo avisa y no lo ofrece.
    mocks.obtenerDespachoComprobante.mockResolvedValue({ ...DESPACHO, estado_despacho: null })
    renderBloque()
    await screen.findByRole('combobox', { name: /^Transporte \/ expreso/ })
    expect(await screen.findByText(MENSAJE_SIN_ESTADO_DESPACHO)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: ETIQUETA_GUARDAR_ENVIO })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Guía')).toBeDisabled()
    expect(screen.getByLabelText('Fecha de envío')).toBeDisabled()
  })

  it('si no se puede leer el estado del despacho, el bloque se ve igual', async () => {
    // Un fallo de lectura no deja el bloque en carga eterna: se sigue viendo y la base vuelve a validar al guardar.
    mocks.obtenerDespachoComprobante.mockRejectedValue(new Error('sin red'))
    renderBloque()
    await screen.findByRole('combobox', { name: /^Transporte \/ expreso/ })
    expect(screen.getByRole('button', { name: ETIQUETA_GUARDAR_ENVIO })).toBeInTheDocument()
  })
})

describe('Estados del kit (FR-023)', () => {
  it('muestra la carga mientras llega el envío', async () => {
    let resolver: ((valor: DatosEnvio) => void) | undefined
    mocks.obtenerEnvioComprobante.mockImplementation(
      () => new Promise<DatosEnvio>((resolve) => { resolver = resolve }),
    )
    renderBloque()
    expect(await screen.findByRole('status', { name: 'Cargando contenido' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await act(async () => { resolver?.(ENVIO) })
    expect(await screen.findByRole('combobox', { name: /^Transporte \/ expreso/ })).toBeInTheDocument()
  })

  it('si no puede cargar el envío, muestra el error con «Reintentar»', async () => {
    mocks.obtenerEnvioComprobante.mockRejectedValue(new Error('sin red'))
    renderBloque()
    expect(await screen.findByText(MENSAJE_ERROR_CARGA_ENVIO)).toBeInTheDocument()
    const reintentar = screen.getByRole('button', { name: 'Reintentar' })
    mocks.obtenerEnvioComprobante.mockResolvedValue(ENVIO)
    fireEvent.click(reintentar)
    expect(await screen.findByRole('combobox', { name: /^Transporte \/ expreso/ })).toBeInTheDocument()
  })

  it('una factura sin forma de envío avisa que falta elegirla', async () => {
    mocks.obtenerFormaEnvioDeComprobante.mockResolvedValue(null)
    renderBloque()
    expect(await screen.findByText(MENSAJE_SIN_FORMA_ENVIO)).toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })
})

describe('Lectura acotada a la empresa del comprobante (aislamiento por empresa)', () => {
  it('lee el envío con la empresa del comprobante, no con un id suelto', async () => {
    renderBloque()
    await screen.findByRole('combobox', { name: /^Transporte \/ expreso/ })
    expect(mocks.obtenerEnvioComprobante).toHaveBeenCalledWith('k-1', 'e-1')
  })
})

describe('Cambio de empresa activa (Principio VIII, FR-023)', () => {
  it('suelta lo elegido, avisa y relee el envío: no guarda bajo la otra tienda', async () => {
    const { rerender } = renderBloque()
    await screen.findByRole('combobox', { name: /^Transporte \/ expreso/ })
    await elegirTransporte('Expreso Ejemplo')
    fireEvent.change(screen.getByLabelText('Guía'), { target: { value: 'A-004471' } })

    rerender(
      <EnvioTransporte
        comprobanteId="k-1"
        empresaId="e-1"
        envioId="f-1"
        empresaActivaId="e-2"
        puedeEditar
        onCambio={vi.fn()}
      />,
    )

    expect(await screen.findByText(AVISO_CAMBIO_DE_TIENDA_ENVIO)).toBeInTheDocument()
    // Lo elegido se soltó: no queda nada de la tienda anterior.
    await waitFor(() => expect(selector(/^Transporte \/ expreso/)).toHaveTextContent('Sin transporte'))
    expect(screen.getByLabelText('Guía')).toHaveValue('')
    expect(screen.getByRole('button', { name: ETIQUETA_GUARDAR_ENVIO })).toBeDisabled()
    // Y el envío se volvió a leer.
    await waitFor(() => expect(mocks.obtenerEnvioComprobante).toHaveBeenCalledTimes(2))
    expect(mocks.guardarEnvioComprobante).not.toHaveBeenCalled()
  })

  it('si la tienda cambia mientras se guarda, no muestra el éxito de la anterior', async () => {
    let resolver: ((valor: DatosEnvio) => void) | undefined
    mocks.guardarEnvioComprobante.mockImplementation(
      () => new Promise<DatosEnvio>((resolve) => { resolver = resolve }),
    )
    const { rerender, onCambio } = renderBloque()
    await screen.findByRole('combobox', { name: /^Transporte \/ expreso/ })
    fireEvent.change(screen.getByLabelText('Guía'), { target: { value: 'A-004471' } })
    fireEvent.click(screen.getByRole('button', { name: ETIQUETA_GUARDAR_ENVIO }))
    await waitFor(() => expect(mocks.guardarEnvioComprobante).toHaveBeenCalledTimes(1))

    rerender(
      <EnvioTransporte
        comprobanteId="k-1"
        empresaId="e-1"
        envioId="f-1"
        empresaActivaId="e-2"
        puedeEditar
        onCambio={onCambio}
      />,
    )
    expect(await screen.findByText(AVISO_CAMBIO_DE_TIENDA_ENVIO)).toBeInTheDocument()
    await act(async () => { resolver?.(ENVIO_CARGADO) })

    // El resultado era de la tienda anterior: no se anuncia ni se pide recargar el comprobante.
    expect(screen.queryByText(MENSAJE_EXITO_ENVIO)).not.toBeInTheDocument()
    expect(onCambio).not.toHaveBeenCalled()
  })

  it('una respuesta vieja de otra tienda no pisa el envío de la nueva', async () => {
    let resolverVieja: ((valor: DatosEnvio) => void) | undefined
    mocks.obtenerEnvioComprobante.mockImplementationOnce(
      () => new Promise<DatosEnvio>((resolve) => { resolverVieja = resolve }),
    )
    mocks.obtenerEnvioComprobante.mockResolvedValue(ENVIO_CARGADO)
    const { rerender } = renderBloque()
    rerender(
      <EnvioTransporte
        comprobanteId="k-1"
        empresaId="e-1"
        envioId="f-1"
        empresaActivaId="e-2"
        puedeEditar
        onCambio={vi.fn()}
      />,
    )
    await screen.findByRole('combobox', { name: /^Transporte \/ expreso/ })
    expect(screen.getByLabelText('Guía')).toHaveValue('A-004471')

    await act(async () => { resolverVieja?.(ENVIO) })

    // Lo que llegó tarde era de la tienda anterior: no pisa lo recién leído.
    expect(screen.getByLabelText('Guía')).toHaveValue('A-004471')
  })
})
