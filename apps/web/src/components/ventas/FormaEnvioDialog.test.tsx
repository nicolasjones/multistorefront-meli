import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))

vi.mock('../../lib/supabase', () => ({ supabaseClient: { rpc: mocks.rpc } }))

import { FormaEnvioDialog } from './FormaEnvioDialog'
import type { FormaEnvio } from '../../lib/ventas/formasEnvio'

const SAN_JAVUCHO = { id: 'e-sj', nombre: 'San Javucho' }
const MUNDO_JC = { id: 'e-mjc', nombre: 'Mundo JC' }

const FORMA: FormaEnvio = {
  id: 'fe-1', empresa_id: 'e-sj', nombre: 'Moto propia', tipo: 'moto', exige_transporte_guia: false, costo_defecto: 3500,
  estado_despacho_inicial: 'armando', orden: 2, activo: true, updated_at: '2026-10-20T10:00:00.123456+00:00',
}

const abrir = (props: Partial<Parameters<typeof FormaEnvioDialog>[0]> = {}) => {
  const onCerrar = vi.fn()
  const onGuardado = vi.fn()
  const onRecargar = vi.fn()
  render(
    <FormaEnvioDialog
      open
      empresa={SAN_JAVUCHO}
      empresas={[SAN_JAVUCHO, MUNDO_JC]}
      ordenSugerido={3}
      onCerrar={onCerrar}
      onGuardado={onGuardado}
      onRecargar={onRecargar}
      {...props}
    />,
  )
  return { onCerrar, onGuardado, onRecargar }
}

const nombre = () => screen.getByRole('textbox', { name: /Nombre/ })
const costo = () => screen.getByRole('textbox', { name: /Costo por defecto/ })

function botonDelGrupo(grupo: string, opcion: string): HTMLElement {
  const contenedor = screen.getByRole('group', { name: grupo })
  const boton = Array.from(contenedor.querySelectorAll('button')).find((candidato) => candidato.textContent === opcion)
  if (!boton) throw new Error(`No hay «${opcion}» en el grupo «${grupo}»`)
  return boton
}

describe('FormaEnvioDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.rpc.mockResolvedValue({ data: [], error: null })
  })

  it('en el alta muestra los campos del prototipo, el prefijo ARS, la ayuda del estado de despacho y los botones', () => {
    abrir()
    expect(screen.getByRole('dialog', { name: 'Nueva forma de envío' })).toBeInTheDocument()
    expect(nombre()).toHaveAttribute('placeholder', 'Ej.: Expreso a domicilio')
    expect(screen.getByRole('combobox', { name: 'Tipo de forma de envío' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Exige transporte y guía' })).toBeInTheDocument()
    expect(costo()).toHaveValue('')
    expect(screen.getByText('ARS')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Estado de despacho inicial' })).toBeInTheDocument()
    expect(screen.getByText(/entra el pedido al tablero de despacho/)).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Orden' })).toHaveValue('3')
    expect(screen.getByRole('checkbox', { name: 'Activo' })).toBeChecked()
    expect(screen.getByRole('button', { name: 'San Javucho' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Crear' })).toBeInTheDocument()
  })

  it('con el nombre vacío avisa «Completá el nombre», enfoca el campo y no llama a la base', async () => {
    abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Crear' }))
    expect(await screen.findByText('Completá el nombre')).toBeInTheDocument()
    expect(nombre()).toHaveFocus()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it.each(['-5', 'abc', '1.234,50', '10,555'])('un costo inválido («%s») se rechaza en el campo', async (valor) => {
    abrir()
    fireEvent.change(nombre(), { target: { value: 'Correo' } })
    fireEvent.change(costo(), { target: { value: valor } })
    fireEvent.click(screen.getByRole('button', { name: 'Crear' }))
    expect(await screen.findByText(/El costo es un importe de 0 en adelante/)).toBeInTheDocument()
    expect(costo()).toHaveFocus()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('sin ninguna empresa marcada no guarda y lo dice', async () => {
    abrir()
    fireEvent.change(nombre(), { target: { value: 'Correo' } })
    fireEvent.click(screen.getByRole('button', { name: 'San Javucho' }))
    fireEvent.click(screen.getByRole('button', { name: 'Crear' }))
    expect(await screen.findByText('Elegí al menos una empresa.')).toBeInTheDocument()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('el alta multiempresa envía una sola llamada con las dos empresas y el costo con coma decimal', async () => {
    const { onGuardado } = abrir()
    fireEvent.change(nombre(), { target: { value: '  Expreso  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Mundo JC' }))
    fireEvent.change(costo(), { target: { value: '1500,5' } })
    fireEvent.click(botonDelGrupo('Estado de despacho inicial', 'Listo para despachar'))
    fireEvent.click(screen.getByRole('button', { name: 'Crear' }))

    await waitFor(() => expect(onGuardado).toHaveBeenCalledWith('Creado · Expreso'))
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
    expect(mocks.rpc).toHaveBeenCalledWith('crear_forma_envio', {
      p_empresa_ids: ['e-sj', 'e-mjc'],
      p_nombre: 'Expreso',
      p_tipo: 'expreso',
      p_exige_transporte_guia: true,
      p_costo_defecto: 1500.5,
      p_estado_despacho_inicial: 'listo_para_despachar',
      p_orden: 3,
      p_activo: true,
    })
  })

  it('el costo vacío viaja como nulo y «No» en transporte se respeta', async () => {
    const { onGuardado } = abrir()
    fireEvent.change(nombre(), { target: { value: 'Retiro en local' } })
    fireEvent.click(botonDelGrupo('Exige transporte y guía', 'No'))
    fireEvent.click(screen.getByRole('button', { name: 'Crear' }))
    await waitFor(() => expect(onGuardado).toHaveBeenCalled())
    expect(mocks.rpc).toHaveBeenCalledWith('crear_forma_envio', expect.objectContaining({
      p_costo_defecto: null, p_exige_transporte_guia: false,
    }))
  })

  it('un nombre repetido en la empresa se informa con un mensaje claro, sin datos técnicos', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "formas_envio_empresa_nombre_key"' } })
    const { onGuardado } = abrir()
    fireEvent.change(nombre(), { target: { value: 'Expreso' } })
    fireEvent.click(screen.getByRole('button', { name: 'Crear' }))
    expect(await screen.findByText('Ya existe una forma de envío con ese nombre en esa empresa.')).toBeInTheDocument()
    expect(screen.queryByText(/formas_envio_empresa_nombre_key/)).not.toBeInTheDocument()
    expect(onGuardado).not.toHaveBeenCalled()
  })

  it('en la edición carga los datos, bloquea las empresas y envía el updated_at leído', async () => {
    const { onGuardado } = abrir({ forma: FORMA })
    expect(screen.getByRole('dialog', { name: 'Editar forma de envío' })).toBeInTheDocument()
    expect(nombre()).toHaveValue('Moto propia')
    expect(costo()).toHaveValue('3500')
    for (const empresa of ['San Javucho', 'Mundo JC']) {
      expect(screen.queryByRole('button', { name: empresa })).not.toBeInTheDocument()
    }
    expect(screen.getByText('Los cambios aplican solo a San Javucho.')).toBeInTheDocument()

    fireEvent.change(costo(), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))

    await waitFor(() => expect(onGuardado).toHaveBeenCalledWith('Cambios guardados · Moto propia'))
    expect(mocks.rpc).toHaveBeenCalledWith('actualizar_forma_envio', expect.objectContaining({
      p_id: 'fe-1', p_actualizado_en: FORMA.updated_at, p_costo_defecto: null, p_estado_despacho_inicial: 'armando',
    }))
  })

  it('un conflicto de edición ofrece «Recargar» y no cierra el diálogo', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '40001', message: 'modificada' } })
    const { onGuardado, onRecargar } = abrir({ forma: FORMA })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    expect(await screen.findByText(/Otra persona modificó esta forma de envío/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Recargar' }))
    expect(onRecargar).toHaveBeenCalledTimes(1)
    expect(onGuardado).not.toHaveBeenCalled()
  })

  it('Cancelar cierra sin guardar', () => {
    const { onCerrar } = abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(onCerrar).toHaveBeenCalledTimes(1)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
})
