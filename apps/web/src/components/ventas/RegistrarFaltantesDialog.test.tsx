import { useState } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  obtenerDespachoComprobante: vi.fn(),
  listarResponsablesDespacho: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({ supabaseClient: { rpc: mocks.rpc } }))
vi.mock('../../lib/ventasDespacho', async (original) => ({
  ...(await original<typeof import('../../lib/ventasDespacho')>()),
  obtenerDespachoComprobante: mocks.obtenerDespachoComprobante,
  listarResponsablesDespacho: mocks.listarResponsablesDespacho,
}))

import { MENSAJE_SIN_LINEAS, RegistrarFaltantesDialog } from './RegistrarFaltantesDialog'
import { ResponsablesDespacho } from './ResponsablesDespacho'
import {
  MENSAJE_CANTIDAD_CERO,
  MENSAJE_CANTIDAD_EXCEDE,
  MENSAJE_CANTIDAD_NO_NUMERO,
  MENSAJE_COMPROBANTE_INEXISTENTE,
  MENSAJE_CONFLICTO,
  MENSAJE_FUERA_DE_ESTADO,
  MENSAJE_SIN_PERMISO,
} from '../../lib/ventasFaltantes'
import { MENSAJE_SIN_DESPACHO } from '../../lib/ventasDespacho'
import type { DatosDespacho } from '../../lib/ventasDespacho'
import type { Comprobante } from '../../lib/ventas'
import type { LineaComprobante } from '../../lib/ventasLineas'

const linea = (cambios: Partial<LineaComprobante> = {}): LineaComprobante => ({
  id: 'l-1', orden: 1, producto_id: 'p-1', descripcion: 'Joystick', codigo: 'JOY-1', cantidad: 3, precio_unitario: 800,
  escala: 'x1', precio_manual: false, alicuota_porcentaje: 21, deposito_id: 'd-1', deposito: 'Principal', a_pedido: false,
  stock: 10, reservado: 0, subtotal_sin_iva: 2400, iva: 504, ...cambios,
})

const comprobante = (cambios: Partial<Comprobante> = {}): Comprobante => ({
  id: 'k-1', tipo: 'factura', numero: '00000001', estado: 'borrador', empresa_id: 'e-1', empresa: 'San Javucho',
  cliente: { id: 'c-1', nombre: 'Ana Pérez', documento: null, direccion: null, tipo: 'minorista', es_consumidor_final: false },
  canal: 'mostrador', fecha: '2026-10-24', valido_hasta: null, operador_id: 'u-1', operador: 'Lucía', forma_pago_id: null,
  envio_id: null, lineas: [linea(), linea({ id: 'l-2', orden: 2, descripcion: 'Volante', cantidad: 1 })],
  total_sin_iva: 2400, iva: 504, total_con_iva: 2904, editable: true, puede_editar: true,
  puede_editar_precio: true, updated_at: '2026-10-24T10:00:00Z', ...cambios,
})

const abrir = (c: Comprobante = comprobante(), empresaActivaId: string | null = 'e-1') => {
  const onCerrar = vi.fn()
  const onRegistrado = vi.fn()
  const onCambioEmpresa = vi.fn()
  const utils = render(
    <RegistrarFaltantesDialog
      open
      comprobante={c}
      empresaActivaId={empresaActivaId}
      onCerrar={onCerrar}
      onRegistrado={onRegistrado}
      onCambioEmpresa={onCambioEmpresa}
    />,
  )
  return { onCerrar, onRegistrado, onCambioEmpresa, ...utils }
}

const cantidadDeLaLinea = (orden: number) =>
  screen.getByRole('textbox', { name: new RegExp(`Cantidad faltante de la línea ${orden}:`) })

// El despacho tal como lo arma el comprobante (F-VTA-18, FR-047): la tarjeta de responsables abre el
// diálogo y el diálogo vive atado a la empresa activa.
function ComprobanteConDespacho() {
  const [abierto, setAbierto] = useState(false)
  return (
    <>
      <ResponsablesDespacho
        comprobanteId="k-1"
        empresaId="e-1"
        operador="Lucía"
        empresaActivaId="e-1"
        onRegistrarFaltantes={() => setAbierto(true)}
      />
      <RegistrarFaltantesDialog
        open={abierto}
        comprobante={comprobante()}
        empresaActivaId="e-1"
        onCerrar={() => setAbierto(false)}
        onRegistrado={() => setAbierto(false)}
      />
    </>
  )
}

const DATOS_DESPACHO: DatosDespacho = {
  estado_despacho: 'armando',
  armo_id: null,
  armo: null,
  controlo_id: null,
  controlo: null,
  entrego_id: null,
  entrego: null,
  entregado_en: null,
  updated_at: '2026-10-24T10:00:00Z',
  puede_despachar: true,
}

const despacho = (cambios: Partial<DatosDespacho> = {}): DatosDespacho => ({ ...DATOS_DESPACHO, ...cambios })

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  mocks.obtenerDespachoComprobante.mockResolvedValue(despacho())
  mocks.listarResponsablesDespacho.mockResolvedValue([])
})

describe('RegistrarFaltantesDialog (F-VTA-18, FR-047)', () => {
  it('lista las líneas del comprobante y no llama a la base hasta registrar', () => {
    abrir()
    expect(screen.getByRole('dialog', { name: /Registrar faltantes · 00000001/ })).toBeInTheDocument()
    expect(screen.getByText('Joystick')).toBeInTheDocument()
    expect(screen.getByText('Volante')).toBeInTheDocument()
    expect(screen.getByText('Línea 1 · se pidieron 3 unidades')).toBeInTheDocument()
    expect(screen.getByText('Línea 2 · se pidieron 1 unidad')).toBeInTheDocument()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('sin líneas marcadas no registra y avisa', async () => {
    const { onRegistrado } = abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Registrar faltantes' }))
    expect(await screen.findByText(MENSAJE_SIN_LINEAS)).toBeInTheDocument()
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(onRegistrado).not.toHaveBeenCalled()
  })

  it('valida cada cantidad contra lo pedido y no llama a la base', async () => {
    abrir()
    fireEvent.change(cantidadDeLaLinea(1), { target: { value: '4' } })
    fireEvent.change(cantidadDeLaLinea(2), { target: { value: 'dos' } })
    fireEvent.click(screen.getByRole('button', { name: 'Registrar faltantes' }))

    expect(await screen.findByText(MENSAJE_CANTIDAD_EXCEDE)).toBeInTheDocument()
    expect(screen.getByText(MENSAJE_CANTIDAD_NO_NUMERO)).toBeInTheDocument()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('rechaza una cantidad cero y no llama a la base', async () => {
    abrir()
    fireEvent.change(cantidadDeLaLinea(1), { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: 'Registrar faltantes' }))

    expect(await screen.findByText(MENSAJE_CANTIDAD_CERO)).toBeInTheDocument()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('con doble clic registra una sola vez: no manda dos pedidos a la base', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null })
    const { onRegistrado } = abrir()
    fireEvent.change(cantidadDeLaLinea(1), { target: { value: '1' } })
    const boton = screen.getByRole('button', { name: 'Registrar faltantes' })

    // Los dos clics en el mismo act: el ref `enVuelo` frena el segundo (y no se duplica el faltante).
    await act(async () => {
      fireEvent.click(boton)
      fireEvent.click(boton)
    })

    await waitFor(() => expect(onRegistrado).toHaveBeenCalledTimes(1))
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
  })

  it('registra las líneas con cantidad y avisa a la pantalla', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null })
    const { onRegistrado } = abrir()
    fireEvent.change(cantidadDeLaLinea(1), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Registrar faltantes' }))

    await waitFor(() => expect(onRegistrado).toHaveBeenCalledTimes(1))
    // Solo la línea marcada: una línea en blanco no es un faltante.
    expect(mocks.rpc).toHaveBeenCalledWith('registrar_faltantes_despacho', {
      p_id: 'k-1',
      p_faltantes: [{ linea_orden: 1, cantidad: 2 }],
      p_actualizado_en: '2026-10-24T10:00:00Z',
    })
  })

  it('si el rol no puede despachar muestra el mensaje y no cierra', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'permission denied' } })
    const { onRegistrado, onCerrar } = abrir()
    fireEvent.change(cantidadDeLaLinea(1), { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Registrar faltantes' }))

    expect(await screen.findByText(MENSAJE_SIN_PERMISO)).toBeInTheDocument()
    expect(onRegistrado).not.toHaveBeenCalled()
    expect(onCerrar).not.toHaveBeenCalled()
  })

  it('si otro cambió el comprobante avisa el conflicto y deja el diálogo abierto', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '40001', message: 'Alguien modificó el comprobante' } })
    const { onRegistrado, onCerrar } = abrir()
    fireEvent.change(cantidadDeLaLinea(1), { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Registrar faltantes' }))

    expect(await screen.findByText(MENSAJE_CONFLICTO)).toBeInTheDocument()
    expect(onRegistrado).not.toHaveBeenCalled()
    expect(onCerrar).not.toHaveBeenCalled()
  })

  it('si la factura ya no está en Armando ni en Incompleto avisa y no registra', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: '55000', message: 'Los faltantes se registran con la factura en Armando o Incompleto.' },
    })
    const { onRegistrado } = abrir()
    fireEvent.change(cantidadDeLaLinea(1), { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Registrar faltantes' }))

    expect(await screen.findByText(MENSAJE_FUERA_DE_ESTADO)).toBeInTheDocument()
    expect(onRegistrado).not.toHaveBeenCalled()
  })

  it('si el comprobante no existe avisa y no registra', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0002', message: 'no row found' } })
    const { onRegistrado } = abrir()
    fireEvent.change(cantidadDeLaLinea(1), { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Registrar faltantes' }))

    expect(await screen.findByText(MENSAJE_COMPROBANTE_INEXISTENTE)).toBeInTheDocument()
    expect(onRegistrado).not.toHaveBeenCalled()
  })

  it('si la base rechaza la cantidad muestra su mensaje en castellano y no cierra', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: '22023', message: 'La cantidad faltante tiene que estar entre 1 y lo pedido.' },
    })
    const { onRegistrado, onCerrar } = abrir()
    fireEvent.change(cantidadDeLaLinea(1), { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Registrar faltantes' }))

    expect(await screen.findByText('La cantidad faltante tiene que estar entre 1 y lo pedido.')).toBeInTheDocument()
    expect(onRegistrado).not.toHaveBeenCalled()
    expect(onCerrar).not.toHaveBeenCalled()
  })

  it('si cambia la empresa activa avisa para cerrar el diálogo sin mezclar tiendas', () => {
    const { rerender, onCambioEmpresa } = abrir()
    expect(onCambioEmpresa).not.toHaveBeenCalled()

    rerender(
      <RegistrarFaltantesDialog
        open
        comprobante={comprobante()}
        empresaActivaId="e-2"
        onCerrar={vi.fn()}
        onRegistrado={vi.fn()}
        onCambioEmpresa={onCambioEmpresa}
      />,
    )
    expect(onCambioEmpresa).toHaveBeenCalledTimes(1)
  })

  it('cancelar cierra sin registrar', () => {
    const { onCerrar } = abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(onCerrar).toHaveBeenCalledTimes(1)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
})

// FR-047: en el comprobante, elegir el estado «Incompleto» abre este diálogo. Acá se ejercita el camino
// completo: la tarjeta de responsables (la que ofrece «Incompleto») y el diálogo que se abre.
describe('abrir el diálogo desde el comprobante (F-VTA-18, FR-047)', () => {
  it('al elegir «Incompleto» se abre el diálogo «Registrar faltantes»', async () => {
    render(<ComprobanteConDespacho />)

    const chip = await screen.findByRole('button', { name: 'Elegir el estado Incompleto y registrar los faltantes' })
    expect(screen.queryByRole('dialog', { name: /Registrar faltantes/ })).not.toBeInTheDocument()

    fireEvent.click(chip)
    expect(await screen.findByRole('dialog', { name: /Registrar faltantes · 00000001/ })).toBeInTheDocument()
    expect(screen.getByText('Joystick')).toBeInTheDocument()
  })

  it('con la factura ya Incompleta el chip ofrece «Ajustar faltantes» y abre el mismo diálogo', async () => {
    mocks.obtenerDespachoComprobante.mockResolvedValue(despacho({ estado_despacho: 'incompleto' }))
    render(<ComprobanteConDespacho />)

    fireEvent.click(await screen.findByRole('button', { name: 'Ajustar los faltantes de esta factura' }))
    expect(await screen.findByRole('dialog', { name: /Registrar faltantes · 00000001/ })).toBeInTheDocument()
  })

  it('con Ventas en lectura no se ofrece «Incompleto»: no se puede registrar faltantes', async () => {
    // Sin la acción `despachar` la base no deja avanzar el despacho: el diálogo no se abre.
    mocks.obtenerDespachoComprobante.mockResolvedValue(despacho({ puede_despachar: false }))
    render(<ComprobanteConDespacho />)

    expect(await screen.findByText(MENSAJE_SIN_DESPACHO)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Incompleto/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: /Registrar faltantes/ })).not.toBeInTheDocument()
  })
})
