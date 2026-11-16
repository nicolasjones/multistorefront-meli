import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { FORMULARIO_CLIENTE_VACIO, type FormularioCliente as FormularioDatos } from '../../lib/clientes'
import { FormularioCliente } from './FormularioCliente'

const abrir = (
  onGuardar = vi.fn().mockResolvedValue(undefined),
  inicial: FormularioDatos = FORMULARIO_CLIENTE_VACIO,
  empresas: Array<{ id: string; nombre: string; activa: boolean }> = [],
) => {
  render(
    <MemoryRouter>
      <FormularioCliente inicial={inicial} etiquetaGuardar="Crear cliente" onGuardar={onGuardar} rutaCancelar="/clientes" empresas={empresas} />
    </MemoryRouter>,
  )
  return onGuardar
}

const escribir = (etiqueta: RegExp | string, valor: string) =>
  fireEvent.change(screen.getByLabelText(etiqueta), { target: { value: valor } })

describe('FormularioCliente · descuento (F-VTA-32)', () => {
  const abrirConDescuento = (puede: boolean, onGuardar = vi.fn().mockResolvedValue(undefined)) => {
    render(
      <MemoryRouter>
        <FormularioCliente
          inicial={{ ...FORMULARIO_CLIENTE_VACIO, nombre: 'Ana', descuento: '5' }}
          etiquetaGuardar="Guardar"
          onGuardar={onGuardar}
          rutaCancelar="/clientes"
          puedeEditarDescuento={puede}
        />
      </MemoryRouter>,
    )
    return onGuardar
  }

  it('quien no es Administrador no ve el campo ni envía el descuento', async () => {
    const onGuardar = abrirConDescuento(false)
    expect(screen.queryByLabelText(/descuento/i)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(onGuardar).toHaveBeenCalled())
    expect(onGuardar.mock.calls[0][0]).not.toHaveProperty('descuento')
  })

  it('el Administrador edita el descuento y se envía como número', async () => {
    const onGuardar = abrirConDescuento(true)
    escribir(/descuento/i, '7,5')
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(onGuardar).toHaveBeenCalled())
    expect(onGuardar.mock.calls[0][0]).toMatchObject({ descuento: 7.5 })
  })

  it('vaciar el campo envía null (sin descuento)', async () => {
    const onGuardar = abrirConDescuento(true)
    escribir(/descuento/i, '')
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(onGuardar).toHaveBeenCalled())
    expect(onGuardar.mock.calls[0][0]).toMatchObject({ descuento: null })
  })

  it('un descuento fuera de 0–100 muestra el error en el campo y no guarda', async () => {
    const onGuardar = abrirConDescuento(true)
    escribir(/descuento/i, '150')
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(await screen.findByText('Ingresá un porcentaje entre 0 y 100, con hasta 2 decimales.')).toBeInTheDocument()
    expect(screen.getByLabelText(/descuento/i)).toHaveAttribute('aria-invalid', 'true')
    expect(onGuardar).not.toHaveBeenCalled()
  })
})

describe('FormularioCliente', () => {
  it('muestra los campos de la ficha y los botones Cancelar y guardar', () => {
    abrir()
    for (const etiqueta of ['Nombre o razón social', 'DNI/CUIT', 'Correo', 'Teléfono', 'Celular', 'Dirección', 'Código postal', 'Localidad', 'Provincia']) {
      expect(screen.getByLabelText(new RegExp(etiqueta))).toBeInTheDocument()
    }
    expect(screen.getByRole('link', { name: 'Cancelar' })).toHaveAttribute('href', '/clientes')
    expect(screen.getByRole('button', { name: 'Crear cliente' })).toBeEnabled()
  })

  it('nombre solo con espacios: error en el campo y no guarda', async () => {
    const onGuardar = abrir()
    escribir(/nombre o razón social/i, '   ')
    fireEvent.click(screen.getByRole('button', { name: 'Crear cliente' }))
    expect(await screen.findByText('Ingresá el nombre o la razón social.')).toBeInTheDocument()
    expect(screen.getByLabelText(/nombre o razón social/i)).toHaveAttribute('aria-invalid', 'true')
    expect(onGuardar).not.toHaveBeenCalled()
  })

  it('correo con formato inválido: no guarda', async () => {
    const onGuardar = abrir()
    escribir(/nombre o razón social/i, 'Distribuidora Norte SRL')
    escribir('Correo', 'no-es-un-correo')
    fireEvent.click(screen.getByRole('button', { name: 'Crear cliente' }))
    expect(await screen.findByText('Ingresá un correo con formato válido.')).toBeInTheDocument()
    expect(onGuardar).not.toHaveBeenCalled()
  })

  it('guarda con el nombre recortado y los opcionales vacíos como null', async () => {
    const onGuardar = abrir()
    escribir(/nombre o razón social/i, '  Distribuidora Norte SRL  ')
    escribir('DNI/CUIT', '30-71234567-8')
    fireEvent.click(screen.getByRole('button', { name: 'Crear cliente' }))
    await waitFor(() => expect(onGuardar).toHaveBeenCalledTimes(1))
    expect(onGuardar).toHaveBeenCalledWith(
      expect.objectContaining({ nombre: 'Distribuidora Norte SRL', documento: '30-71234567-8', correo: null, provincia: null }),
      expect.anything(),
    )
  })

  it('doble envío: mientras guarda deshabilita el botón y envía una sola vez', async () => {
    let terminar: () => void = () => undefined
    const onGuardar = vi.fn().mockImplementation(() => new Promise<void>((resolver) => { terminar = resolver }))
    abrir(onGuardar)
    escribir(/nombre o razón social/i, 'Cliente')
    const boton = screen.getByRole('button', { name: 'Crear cliente' })
    fireEvent.click(boton)
    fireEvent.click(boton)
    expect(await screen.findByRole('button', { name: 'Guardando…' })).toBeDisabled()
    expect(onGuardar).toHaveBeenCalledTimes(1)
    terminar()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Crear cliente' })).toBeEnabled())
  })

  it('DNI/CUIT repetido: el error aparece en el campo documento, no como error general', async () => {
    const onGuardar = vi.fn().mockRejectedValue({
      code: '23505',
      message: 'duplicate key value violates unique constraint "clientes_org_documento_uq"',
    })
    abrir(onGuardar)
    escribir(/nombre o razón social/i, 'Otro cliente')
    escribir('DNI/CUIT', '30712345678')
    fireEvent.click(screen.getByRole('button', { name: 'Crear cliente' }))
    expect(await screen.findByText('Ya existe un cliente con ese DNI/CUIT')).toBeInTheDocument()
    expect(screen.getByLabelText('DNI/CUIT')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.queryByText('No se guardó el cliente.')).not.toBeInTheDocument()
  })

  it('nombre repetido: se guarda sin aviso', async () => {
    const onGuardar = abrir()
    escribir(/nombre o razón social/i, 'Distribuidora Norte SRL')
    fireEvent.click(screen.getByRole('button', { name: 'Crear cliente' }))
    await waitFor(() => expect(onGuardar).toHaveBeenCalled())
    expect(screen.queryByText(/ya existe/i)).not.toBeInTheDocument()
  })

  it('error de servidor: lo muestra, conserva lo escrito y permite reintentar', async () => {
    const consola = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const onGuardar = vi.fn().mockRejectedValueOnce(new Error('Falló la red')).mockResolvedValueOnce(undefined)
    abrir(onGuardar)
    escribir(/nombre o razón social/i, 'Cliente')
    escribir('Localidad', 'Rosario')
    fireEvent.click(screen.getByRole('button', { name: 'Crear cliente' }))
    expect(await screen.findByText('No pudimos guardar el cliente.')).toBeInTheDocument()
    expect(screen.queryByText('Falló la red')).not.toBeInTheDocument()
    expect(consola).toHaveBeenCalled()
    expect(screen.getByLabelText('Localidad')).toHaveValue('Rosario')
    fireEvent.click(screen.getByRole('button', { name: 'Crear cliente' }))
    await waitFor(() => expect(onGuardar).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByText('No pudimos guardar el cliente.')).not.toBeInTheDocument())
    consola.mockRestore()
  })

  it('alta: el tipo arranca en minorista, se explica y viaja en el envío', async () => {
    const onGuardar = abrir()
    expect(screen.getByRole('button', { name: /Minorista/ })).toBeInTheDocument()
    expect(screen.getByText('Compra al precio de lista (escala x1).')).toBeInTheDocument()
    expect(screen.queryByText(/próximas ventas/)).not.toBeInTheDocument()
    escribir(/nombre o razón social/i, 'Cliente')
    fireEvent.click(screen.getByRole('button', { name: 'Crear cliente' }))
    await waitFor(() => expect(onGuardar).toHaveBeenCalledWith(expect.objectContaining({ tipo: 'minorista' }), expect.anything()))
  })

  it('alta como mayorista: envía el tipo elegido y cambia la explicación', async () => {
    const onGuardar = abrir()
    fireEvent.click(screen.getByRole('button', { name: /Mayorista/ }))
    expect(screen.getByText('Compra con precio por cantidad.')).toBeInTheDocument()
    escribir(/nombre o razón social/i, 'Distribuidora')
    fireEvent.click(screen.getByRole('button', { name: 'Crear cliente' }))
    await waitFor(() => expect(onGuardar).toHaveBeenCalledWith(expect.objectContaining({ tipo: 'mayorista' }), expect.anything()))
  })

  it('edición: cambiar el tipo muestra el aviso y se guarda el nuevo tipo; volver al original lo quita', async () => {
    const onGuardar = abrir(undefined, { ...FORMULARIO_CLIENTE_VACIO, nombre: 'Ana', tipo: 'mayorista' })
    expect(screen.getByRole('button', { name: /Mayorista/ })).toBeInTheDocument()
    expect(screen.queryByText(/próximas ventas/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Minorista/ }))
    expect(screen.getByText(/próximas ventas usarán la escala/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Mayorista/ }))
    expect(screen.queryByText(/próximas ventas/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Minorista/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Crear cliente' }))
    await waitFor(() => expect(onGuardar).toHaveBeenCalledWith(expect.objectContaining({ nombre: 'Ana', tipo: 'minorista' }), expect.anything()))
  })

  it('«Habilitado en»: sin tiendas cargadas lo dice', () => {
    abrir()
    expect(screen.getByText('La organización todavía no tiene tiendas cargadas.')).toBeInTheDocument()
  })

  it('«Habilitado en»: elige tiendas y la selección viaja en el envío', async () => {
    const onGuardar = abrir(undefined, FORMULARIO_CLIENTE_VACIO, [
      { id: 'e-1', nombre: 'San Javucho', activa: true },
      { id: 'e-2', nombre: 'Mundo JC', activa: true },
    ])
    const sanJavucho = screen.getByRole('checkbox', { name: 'San Javucho' })
    const mundoJc = screen.getByRole('checkbox', { name: 'Mundo JC' })
    expect(sanJavucho).not.toBeChecked()

    fireEvent.click(sanJavucho)
    expect(screen.getByRole('checkbox', { name: 'San Javucho' })).toBeChecked()

    fireEvent.click(mundoJc)
    fireEvent.click(mundoJc)
    expect(screen.getByRole('checkbox', { name: 'Mundo JC' })).not.toBeChecked()

    escribir(/nombre o razón social/i, 'Cliente')
    fireEvent.click(screen.getByRole('button', { name: 'Crear cliente' }))
    await waitFor(() => expect(onGuardar).toHaveBeenCalledWith(expect.objectContaining({ empresas: ['e-1'] }), expect.anything()))
  })
})

describe('FormularioCliente · lista de precios (F-CLI-21, RF-CLI-21-3)', () => {
  const LISTAS = [
    { id: 'l-1', nombre: 'Revendedores', descripcion: null, ajustePct: -20, archivadaEn: null, clientesAsignados: 0, actualizadoEn: 't' },
    { id: 'l-2', nombre: 'Gremio', descripcion: null, ajustePct: 5.5, archivadaEn: null, clientesAsignados: 0, actualizadoEn: 't' },
  ]
  const abrirConLista = (
    cambios: { editable?: boolean; bandera?: boolean; hayError?: boolean; cargando?: boolean; listaPrecioId?: string; descuento?: string } = {},
    onGuardar = vi.fn().mockResolvedValue(undefined),
  ) => {
    render(
      <MemoryRouter>
        <FormularioCliente
          inicial={{ ...FORMULARIO_CLIENTE_VACIO, nombre: 'Ana', listaPrecioId: cambios.listaPrecioId ?? '', descuento: cambios.descuento ?? '' }}
          etiquetaGuardar="Guardar"
          onGuardar={onGuardar}
          rutaCancelar="/clientes"
          puedeEditarDescuento
          listasPrecios={{ listas: cambios.cargando ? [] : LISTAS, cargando: cambios.cargando ?? false, hayError: cambios.hayError ?? false, editable: cambios.editable ?? true, bandera: cambios.bandera ?? true }}
        />
      </MemoryRouter>,
    )
    return onGuardar
  }

  const elegir = (nombre: string | RegExp) => {
    fireEvent.mouseDown(screen.getByRole('combobox', { name: /Lista de precios/ }))
    fireEvent.click(screen.getByRole('option', { name: nombre }))
  }

  it('si la lista actual del cliente no está entre las cargadas, igual es una opción y no queda un valor fuera de rango', () => {
    const consola = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    abrirConLista({ listaPrecioId: 'l-9', hayError: true })
    expect(screen.getByRole('combobox', { name: /Lista de precios/ })).toHaveTextContent('Lista asignada')
    expect(consola.mock.calls.flat().join(' ')).not.toMatch(/out-of-range/)
    consola.mockRestore()
  })

  it('mientras cargan las listas muestra «Cargando…» y no el aviso de nombre ilegible', () => {
    abrirConLista({ listaPrecioId: 'l-1', cargando: true })
    const combo = screen.getByRole('combobox', { name: /Lista de precios/ })
    expect(combo).toHaveTextContent('Cargando…')
    expect(combo).not.toHaveTextContent('no se pudo leer')
  })

  it('sin la prop no muestra el campo (alta)', () => {
    abrir()
    expect(screen.queryByText('Lista de precios')).not.toBeInTheDocument()
  })

  it('el Administrador elige una lista activa, ve su porcentaje y se envía solo lo que cambió', async () => {
    const onGuardar = abrirConLista()
    expect(screen.getByRole('combobox', { name: /Lista de precios/ })).toHaveTextContent('Sin lista')
    elegir(/Revendedores/)
    expect(screen.getByText('Revendedores: -20 % sobre el precio central.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(onGuardar).toHaveBeenCalled())
    expect(onGuardar.mock.calls[0][2]).toEqual({ listaPrecioId: 'l-1' })
  })

  it('sin tocar la lista no manda cambio de lista; quitarla manda null', async () => {
    const sinCambio = abrirConLista({ listaPrecioId: 'l-1' })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(sinCambio).toHaveBeenCalled())
    expect(sinCambio.mock.calls[0][2]).toBeUndefined()
  })

  it('quitar la lista envía null', async () => {
    const onGuardar = abrirConLista({ listaPrecioId: 'l-1' })
    elegir('Sin lista')
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(onGuardar).toHaveBeenCalled())
    expect(onGuardar.mock.calls[0][2]).toEqual({ listaPrecioId: null })
  })

  it('quien no es Administrador la ve en solo lectura y no envía cambios', async () => {
    const onGuardar = abrirConLista({ editable: false, listaPrecioId: 'l-2' })
    const campo = screen.getByRole('combobox', { name: /Lista de precios/ })
    expect(campo).toHaveAttribute('aria-disabled', 'true')
    expect(campo).toHaveTextContent('Gremio (+5,5 %)')
    expect(screen.getByText('Solo un administrador puede asignar una lista.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(onGuardar).toHaveBeenCalled())
    expect(onGuardar.mock.calls[0][2]).toBeUndefined()
  })

  it('avisa que no se acumula con el descuento personal', () => {
    abrirConLista({ listaPrecioId: 'l-1', descuento: '5' })
    expect(screen.getByText(/Este cliente también tiene un descuento personal/)).toBeInTheDocument()
  })

  it('sin descuento personal no muestra el aviso', () => {
    abrirConLista({ listaPrecioId: 'l-1' })
    expect(screen.queryByText(/descuento personal/)).not.toBeInTheDocument()
  })

  it('con la bandera apagada avisa y solo permite quitar la lista actual', () => {
    abrirConLista({ bandera: false, listaPrecioId: 'l-1' })
    expect(screen.getByText(/desactivadas en este entorno/)).toBeInTheDocument()
    fireEvent.mouseDown(screen.getByRole('combobox', { name: /Lista de precios/ }))
    expect(screen.getByRole('option', { name: /Gremio/ })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('option', { name: /Revendedores/ })).not.toHaveAttribute('aria-disabled', 'true')
  })

  it('si no pudo cargar las listas lo dice', () => {
    abrirConLista({ hayError: true })
    expect(screen.getByText('No pudimos cargar las listas de precios.')).toBeInTheDocument()
  })

  it.each([320, 768, 1440])('sin violaciones de axe a %i px', async (ancho) => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: ancho })
    abrirConLista({ listaPrecioId: 'l-1', descuento: '5' })
    const { violacionesAxe } = await import('../../test/axe')
    expect(await violacionesAxe(document.body)).toEqual([])
  })
})
