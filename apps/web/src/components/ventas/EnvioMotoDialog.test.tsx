import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { violacionesAxe } from '../../test/axe'

vi.setConfig({ testTimeout: 20000 })

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('../../lib/supabase', () => ({ supabaseClient: { rpc: mocks.rpc } }))

import { aImporte, claveMensajero, normalizarMensajero, validarEnvioMoto, type EnvioMoto } from '../../lib/ventas/enviosMoto'
import { EnvioMotoDialog } from './EnvioMotoDialog'

const ELEGIBLE = { id: 'f-9', numero: '0003-00001300', empresa_id: 'e-1', empresa: 'San Javucho', fecha: '2026-10-08', cliente: 'Cliente Nuevo' }

const envio: EnvioMoto = {
  id: 'm-1', comprobante_id: 'f-1', comprobante_numero: '0003-00001247', empresa_id: 'e-1', empresa: 'San Javucho',
  fecha: '2026-10-07', cliente: 'Kiosco La Esquina', mensajero: 'Moto 1', guia: 'M-2201', costo_envio: 3500.5, abono: 0,
  enviado: false, rendido: false, rendido_en: null, actualizado_en: '2026-10-07T10:00:00+00:00', puede_editar: true, puede_rendir: true,
}

const rpcPorDefecto = (extra: Record<string, unknown> = {}) => vi.fn(async (nombre: string) => {
  if (nombre in extra) return extra[nombre]
  if (nombre === 'comprobantes_para_envio_moto') return { data: [ELEGIBLE], error: null }
  if (nombre === 'registrar_envio_moto' || nombre === 'actualizar_envio_moto') return { data: { id: 'm-1' }, error: null }
  return { data: [], error: null }
})

const llamadas = (nombre: string) => mocks.rpc.mock.calls.filter(([n]) => n === nombre)

const abrirAlta = (props: Partial<Parameters<typeof EnvioMotoDialog>[0]> = {}) => {
  const alt = { onCerrar: vi.fn(), onGuardado: vi.fn(), ...props }
  render(<EnvioMotoDialog open empresaId={null} {...alt} />)
  return alt
}

const elegirFactura = async () => {
  fireEvent.keyDown(screen.getByRole('combobox', { name: /Comprobante/ }), { key: 'ArrowDown' })
  fireEvent.click(await screen.findByRole('option', { name: '0003-00001300 · Cliente Nuevo' }))
}

describe('lib de envíos en moto', () => {
  it('normaliza el mensajero y lo compara sin mayúsculas ni espacios sobrantes', () => {
    expect(normalizarMensajero('  Moto   1 ')).toBe('Moto 1')
    expect(claveMensajero(' MOTO 1')).toBe(claveMensajero('moto   1 '))
    expect(claveMensajero('Moto 1')).not.toBe(claveMensajero('Moto 2'))
  })

  it('acepta importes de 0 en adelante con hasta dos decimales (coma o punto) y rechaza el resto', () => {
    expect(aImporte('0')).toBe(0)
    expect(aImporte('1200,50')).toBe(1200.5)
    expect(aImporte(' 3.5 ')).toBe(3.5)
    for (const malo of ['', '-1', '1,234', 'abc', '1e3', '1.000,50']) expect(aImporte(malo)).toBeNull()
  })

  it('valida mensajero obligatorio e importes', () => {
    const base = { mensajero: '   ', guia: '', costo_envio: '-1', abono: '', enviado: false }
    expect(Object.keys(validarEnvioMoto(base, { requerido: true, elegido: false })).sort()).toEqual(['abono', 'comprobante', 'costo_envio', 'mensajero'])
    expect(validarEnvioMoto({ ...base, mensajero: 'Moto 1', costo_envio: '0', abono: '0' }, { requerido: false, elegido: false })).toEqual({})
  })
})

describe('EnvioMotoDialog · registrar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.rpc.mockImplementation(rpcPorDefecto())
  })

  it('muestra los campos del diálogo y ofrece solo las facturas elegibles de la tienda del filtro', async () => {
    abrirAlta({ empresaId: 'e-1' })
    expect(screen.getByRole('dialog', { name: 'Registrar envío en moto' })).toBeInTheDocument()
    for (const campo of [/Comprobante/, /Mensajero/, 'Guía', /Costo de envío/, /Abona al recibir/]) {
      expect(screen.getByLabelText(campo)).toBeInTheDocument()
    }
    expect(screen.getByRole('checkbox', { name: 'Enviado' })).not.toBeChecked()
    await waitFor(() => expect(llamadas('comprobantes_para_envio_moto')[0]?.[1]).toEqual({ p_empresa_id: 'e-1', p_busqueda: null }))
    fireEvent.keyDown(screen.getByRole('combobox', { name: /Comprobante/ }), { key: 'ArrowDown' })
    expect(await screen.findByRole('option', { name: '0003-00001300 · Cliente Nuevo' })).toBeInTheDocument()
  })

  it('al tipear busca por número o cliente con espera', async () => {
    abrirAlta()
    await waitFor(() => expect(llamadas('comprobantes_para_envio_moto')).toHaveLength(1))
    fireEvent.change(screen.getByRole('combobox', { name: /Comprobante/ }), { target: { value: 'Nuevo' } })
    await waitFor(() => expect(llamadas('comprobantes_para_envio_moto').at(-1)?.[1]).toEqual({ p_empresa_id: null, p_busqueda: 'Nuevo' }))
  })

  it('una factura no elegible no se ofrece: sin resultados lo dice', async () => {
    mocks.rpc.mockImplementation(rpcPorDefecto({ comprobantes_para_envio_moto: { data: [], error: null } }))
    abrirAlta()
    fireEvent.keyDown(screen.getByRole('combobox', { name: /Comprobante/ }), { key: 'ArrowDown' })
    expect(await screen.findByText('No hay facturas con envío en moto sin registrar')).toBeInTheDocument()
  })

  it('valida mensajero vacío (solo espacios) e importes y no llama a la base', async () => {
    abrirAlta()
    await elegirFactura()
    fireEvent.change(screen.getByLabelText(/Mensajero/), { target: { value: '   ' } })
    fireEvent.change(screen.getByLabelText(/Costo de envío/), { target: { value: '-5' } })
    fireEvent.change(screen.getByLabelText(/Abona al recibir/), { target: { value: '1,234' } })
    fireEvent.click(screen.getByRole('button', { name: 'Registrar envío' }))
    expect(await screen.findByText('Escribí el nombre del mensajero.')).toBeInTheDocument()
    expect(screen.getByText(/costo de envío debe ser un importe de 0 en adelante/)).toBeInTheDocument()
    expect(screen.getByText(/Lo que abona al recibir debe ser un importe/)).toBeInTheDocument()
    expect(llamadas('registrar_envio_moto')).toHaveLength(0)
  })

  it('sin elegir factura pide elegirla', async () => {
    abrirAlta()
    fireEvent.change(screen.getByLabelText(/Mensajero/), { target: { value: 'Moto 1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Registrar envío' }))
    expect(await screen.findByText('Elegí la factura del envío.')).toBeInTheDocument()
  })

  it('registra con mensajero normalizado, guía vacía como nula y avisa al padre', async () => {
    const { onGuardado } = abrirAlta()
    await elegirFactura()
    fireEvent.change(screen.getByLabelText(/Mensajero/), { target: { value: '  Moto   3 ' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Enviado' }))
    fireEvent.click(screen.getByRole('button', { name: 'Registrar envío' }))
    await waitFor(() => expect(onGuardado).toHaveBeenCalledWith(false))
    expect(llamadas('registrar_envio_moto')[0][1]).toEqual({
      p_comprobante_id: 'f-9', p_mensajero: 'Moto 3', p_guia: null, p_costo_envio: 0, p_abono: 0, p_enviado: true,
    })
  })

  it('traduce los errores de la base a castellano sin filtrar el detalle crudo', async () => {
    mocks.rpc.mockImplementation(rpcPorDefecto({ registrar_envio_moto: { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "envios_moto_uq"' } } }))
    const { onGuardado } = abrirAlta()
    await elegirFactura()
    fireEvent.change(screen.getByLabelText(/Mensajero/), { target: { value: 'Moto 1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Registrar envío' }))
    expect(await screen.findByText('Ese comprobante ya tiene un envío en moto registrado.')).toBeInTheDocument()
    expect(screen.queryByText(/duplicate key/)).not.toBeInTheDocument()
    expect(onGuardado).not.toHaveBeenCalled()
  })

  it('«Cancelar» cierra sin guardar', () => {
    const { onCerrar } = abrirAlta()
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(onCerrar).toHaveBeenCalled()
  })

  it.each([320, 768, 1440])('no tiene violaciones de accesibilidad a %i px', async (ancho) => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: ancho })
    abrirAlta()
    await waitFor(() => expect(llamadas('comprobantes_para_envio_moto')).toHaveLength(1))
    expect(await violacionesAxe(document.body)).toEqual([])
  })
})

describe('EnvioMotoDialog · editar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.rpc.mockImplementation(rpcPorDefecto())
  })

  it('abre con los valores actuales, el comprobante fijo y sin buscar facturas', () => {
    abrirAlta({ envio })
    expect(screen.getByRole('dialog', { name: 'Editar envío en moto' })).toBeInTheDocument()
    expect(screen.getByLabelText(/Mensajero/)).toHaveValue('Moto 1')
    expect(screen.getByLabelText('Guía')).toHaveValue('M-2201')
    expect(screen.getByLabelText(/Costo de envío/)).toHaveValue('3500,5')
    expect(screen.getByLabelText(/Abona al recibir/)).toHaveValue('0')
    expect(screen.getByLabelText('Comprobante')).toBeDisabled()
    expect(screen.getByLabelText('Comprobante')).toHaveValue('0003-00001247 · Kiosco La Esquina')
    expect(llamadas('comprobantes_para_envio_moto')).toHaveLength(0)
  })

  it('guarda con la versión leída y marca Enviado sin tocar lo rendido', async () => {
    const { onGuardado } = abrirAlta({ envio })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Enviado' }))
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    await waitFor(() => expect(onGuardado).toHaveBeenCalledWith(true))
    const args = llamadas('actualizar_envio_moto')[0][1]
    expect(args).toEqual({
      p_id: 'm-1', p_mensajero: 'Moto 1', p_guia: 'M-2201', p_costo_envio: 3500.5, p_abono: 0, p_enviado: true,
      p_actualizado_en: '2026-10-07T10:00:00+00:00',
    })
    expect(args).not.toHaveProperty('p_rendido')
  })

  it('ante un conflicto ofrece «Recargar»', async () => {
    mocks.rpc.mockImplementation(rpcPorDefecto({ actualizar_envio_moto: { data: null, error: { code: '40001', message: 'x' } } }))
    const onRecargar = vi.fn()
    abrirAlta({ envio, onRecargar })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    expect(await screen.findByText(/Otra persona modificó este envío/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Recargar' }))
    expect(onRecargar).toHaveBeenCalled()
  })

  it('un envío rendido que la base rechaza (55000) se explica como solo lectura', async () => {
    mocks.rpc.mockImplementation(rpcPorDefecto({ actualizar_envio_moto: { data: null, error: { code: '55000', message: 'x' } } }))
    abrirAlta({ envio })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    expect(await screen.findByText(/ya está rendido: es de solo lectura/)).toBeInTheDocument()
  })
})
