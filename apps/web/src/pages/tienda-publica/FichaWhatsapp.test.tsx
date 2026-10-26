import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Outlet, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { violacionesAxe } from '../../test/axe'

const mocks = vi.hoisted(() => ({ leer: vi.fn(), firmar: vi.fn(), rpc: vi.fn() }))

vi.mock('../../lib/tiendaFicha', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/tiendaFicha')>()),
  leerFichaProducto: mocks.leer,
}))
vi.mock('../../lib/imagenProducto', () => ({ urlsImagenesProducto: mocks.firmar }))
// El cliente de Supabase shared: la ficha lee el contacto de la tienda y el registro de la consulta.
vi.mock('../../lib/supabase', () => ({
  supabaseClient: { schema: () => ({ rpc: mocks.rpc }) },
}))

import RutaProducto from './rutas/producto'

// F-TDA-14 (MSF-433, SC-007): la ficha del producto muestra el botón «Consultar por WhatsApp» solo si
// la empresa tiene un número válido (sin número, la ficha se ve sin botón y sin hueco), abre el diálogo
// con el mensaje armado y abre `wa.me` codificado con `noopener` sin que el registro la frene.
// Vive fuera de `rutas/` porque esa carpeta se carga con import.meta.glob.

const HOST = 'mundojc.localhost'
const ID = 'a1000000-0000-4000-8000-000000000001'
const NUMERO = '+54 9 11 7365-2596'

const contexto = {
  tienda: { tiendaId: 't-1', empresaNombre: 'Mundo JC', estado: 'publicada' },
  host: HOST,
  categorias: { fase: 'lista', categorias: [], reintentar: () => undefined },
}

function ficha(sobrescribe: Record<string, unknown> = {}) {
  return {
    id: ID,
    nombre: 'Joystick Pro',
    descripcion: 'Inalámbrico con vibración',
    sku: 'PC-1',
    categoria: { id: 'ca-1', nombre: 'Joysticks' },
    precio: 18455,
    disponible: true,
    compatibilidad: 'PS4, PS5',
    imagenes: [],
    ...sobrescribe,
  }
}

function montar() {
  return render(
    <MemoryRouter initialEntries={[`/producto/${ID}`]}>
      <Routes>
        <Route element={<Outlet context={contexto} />}>
          <Route path="/producto/:productoId" element={<RutaProducto />} />
          <Route path="/catalogo" element={<p>Pantalla de catálogo</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

// Respuesta del cliente de Supabase: el contacto de la tienda y el registro de la consulta.
function responder({ whatsapp = NUMERO, registrar = { estado: 'ok' } }: { whatsapp?: string | null; registrar?: { estado: string } | Error } = {}) {
  mocks.rpc.mockImplementation((nombre: string) => {
    if (nombre === 'contacto_por_dominio') {
      return Promise.resolve({ data: { nombre: 'Mundo JC', whatsapp }, error: null })
    }
    if (nombre === 'registrar_consulta_whatsapp') {
      return registrar instanceof Error ? Promise.reject(registrar) : Promise.resolve({ data: registrar, error: null })
    }
    return Promise.resolve({ data: null, error: null })
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.leer.mockResolvedValue(ficha())
  mocks.firmar.mockResolvedValue({})
  responder()
})

describe('Ficha · botón de WhatsApp (FR-020)', () => {
  it('con número válido, la ficha muestra el botón junto a «Ver más productos»', async () => {
    montar()
    const boton = await screen.findByRole('button', { name: 'Consultar por WhatsApp' })
    expect(boton).toBeInTheDocument()
    expect(mocks.rpc).toHaveBeenCalledWith('contacto_por_dominio', { host: HOST })
    const fila = screen.getByTestId('acciones-ficha')
    expect(within(fila).getByRole('button', { name: 'Consultar por WhatsApp' })).toBe(boton)
    expect(within(fila).getByRole('link', { name: 'Ver más productos' })).toBeInTheDocument()
  })

  it('sin número, la ficha se ve sin botón y sin hueco', async () => {
    responder({ whatsapp: null })
    montar()
    await screen.findByRole('heading', { level: 1, name: 'Joystick Pro' })
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('contacto_por_dominio', { host: HOST }))
    expect(screen.queryByRole('button', { name: 'Consultar por WhatsApp' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('boton-whatsapp')).not.toBeInTheDocument()
    // La fila de acciones queda con el único botón que sí existe: no queda un hueco vacío.
    const fila = screen.getByTestId('acciones-ficha')
    expect(within(fila).queryAllByTestId('boton-whatsapp')).toHaveLength(0)
    expect(fila.children).toHaveLength(1)
    expect(within(fila).getByRole('link', { name: 'Ver más productos' })).toBeInTheDocument()
  })

  it('con un número de menos de 8 dígitos tampoco hay botón', async () => {
    responder({ whatsapp: '1234567' })
    montar()
    await screen.findByRole('heading', { level: 1, name: 'Joystick Pro' })
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('contacto_por_dominio', { host: HOST }))
    expect(screen.queryByRole('button', { name: 'Consultar por WhatsApp' })).not.toBeInTheDocument()
  })
})

describe('Ficha · diálogo de WhatsApp (FR-021, FR-022, FR-023)', () => {
  it('el diálogo muestra la línea de la empresa y el mensaje con el precio de la ficha', async () => {
    montar()
    fireEvent.click(await screen.findByRole('button', { name: 'Consultar por WhatsApp' }))
    const dialogo = await screen.findByRole('dialog')
    expect(dialogo).toHaveAccessibleName('Consultar por WhatsApp')
    expect(screen.getByText(`Mundo JC · ${NUMERO}`)).toBeInTheDocument()
    expect(screen.getByLabelText('Mensaje que se va a enviar')).toHaveValue(
      'Hola Mundo JC, quiero consultar por Joystick Pro ($ 18.455). ¿Está disponible?',
    )
  })

  it('un producto sin precio arma el mensaje sin paréntesis', async () => {
    mocks.leer.mockResolvedValue(ficha({ precio: null }))
    montar()
    fireEvent.click(await screen.findByRole('button', { name: 'Consultar por WhatsApp' }))
    await screen.findByRole('dialog')
    expect(screen.getByLabelText('Mensaje que se va a enviar')).toHaveValue(
      'Hola Mundo JC, quiero consultar por Joystick Pro. ¿Está disponible?',
    )
  })

  it('«Abrir WhatsApp» abre la URL de wa.me codificada con noopener, cierra el diálogo y avisa', async () => {
    const abrir = vi.spyOn(window, 'open').mockImplementation(() => null)
    montar()
    fireEvent.click(await screen.findByRole('button', { name: 'Consultar por WhatsApp' }))
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('button', { name: 'Abrir WhatsApp' }))
    const url = 'https://wa.me/5491173652596?text=Hola%20Mundo%20JC%2C%20quiero%20consultar%20por%20Joystick%20Pro%20(%24%2018.455).%20%C2%BFEst%C3%A1%20disponible%3F'
    expect(abrir).toHaveBeenCalledWith(url, '_blank', 'noopener')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByText('Se abrió WhatsApp con el mensaje listo.')).toBeInTheDocument()
    abrir.mockRestore()
  })

  it('Esc cierra el diálogo sin efectos y el foco vuelve al botón', async () => {
    const abrir = vi.spyOn(window, 'open').mockImplementation(() => null)
    montar()
    const boton = await screen.findByRole('button', { name: 'Consultar por WhatsApp' })
    boton.focus()
    fireEvent.click(boton)
    const dialogo = await screen.findByRole('dialog')
    fireEvent.keyDown(dialogo, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(abrir).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalledWith('registrar_consulta_whatsapp', expect.anything())
    await waitFor(() => expect(boton).toHaveFocus())
    abrir.mockRestore()
  })
})

describe('Ficha · el registro no bloquea (FR-024)', () => {
  it('la apertura no espera al registro: el diálogo cierra y avisa igual', async () => {
    const abrir = vi.spyOn(window, 'open').mockImplementation(() => null)
    mocks.rpc.mockImplementation((nombre: string) => {
      if (nombre === 'contacto_por_dominio') return Promise.resolve({ data: { nombre: 'Mundo JC', whatsapp: NUMERO }, error: null })
      if (nombre === 'registrar_consulta_whatsapp') return new Promise(() => undefined)
      return Promise.resolve({ data: null, error: null })
    })
    montar()
    fireEvent.click(await screen.findByRole('button', { name: 'Consultar por WhatsApp' }))
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('button', { name: 'Abrir WhatsApp' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByText('Se abrió WhatsApp con el mensaje listo.')).toBeInTheDocument()
    abrir.mockRestore()
  })

  it('una falla del registro no se muestra al visitante', async () => {
    const consola = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const abrir = vi.spyOn(window, 'open').mockImplementation(() => null)
    responder({ registrar: new Error('sin red') })
    montar()
    fireEvent.click(await screen.findByRole('button', { name: 'Consultar por WhatsApp' }))
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('button', { name: 'Abrir WhatsApp' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByText('Se abrió WhatsApp con el mensaje listo.')).toBeInTheDocument()
    expect(screen.queryByText(/sin red/i)).not.toBeInTheDocument()
    consola.mockRestore()
    abrir.mockRestore()
  })

  it('el registro se hace una vez por apertura, con el host y el producto de la ficha', async () => {
    const abrir = vi.spyOn(window, 'open').mockImplementation(() => null)
    montar()
    fireEvent.click(await screen.findByRole('button', { name: 'Consultar por WhatsApp' }))
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('button', { name: 'Abrir WhatsApp' }))
    await waitFor(() => {
      const llamadas = mocks.rpc.mock.calls.filter(([nombre]) => nombre === 'registrar_consulta_whatsapp')
      expect(llamadas).toHaveLength(1)
    })
    expect(mocks.rpc).toHaveBeenCalledWith('registrar_consulta_whatsapp', {
      host: HOST,
      producto: ID,
      // La clave va a una columna `uuid`: tiene que ser un uuid v4, no cualquier cadena.
      clave_envio: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
    })
    abrir.mockRestore()
  })

  // FR-024 (una llamada por apertura): desde la ficha, un doble clic sobre «Abrir WhatsApp» no puede
  // abrir dos pestañas de WhatsApp ni registrar dos consultas de la misma apertura.
  it('un doble clic sobre «Abrir WhatsApp» abre y registra una sola vez', async () => {
    const abrir = vi.spyOn(window, 'open').mockImplementation(() => null)
    montar()
    fireEvent.click(await screen.findByRole('button', { name: 'Consultar por WhatsApp' }))
    await screen.findByRole('dialog')
    const boton = screen.getByRole('button', { name: 'Abrir WhatsApp' })
    fireEvent.click(boton)
    expect(boton).toBeInTheDocument()
    fireEvent.click(boton)
    expect(abrir).toHaveBeenCalledTimes(1)
    const llamadas = mocks.rpc.mock.calls.filter(([nombre]) => nombre === 'registrar_consulta_whatsapp')
    expect(llamadas).toHaveLength(1)
    abrir.mockRestore()
  })
})

describe('Ficha · accesibilidad (FR-026, SC-007)', () => {
  it.each([320, 768, 1440])('a %i px la ficha con el botón no tiene violaciones de axe', async (ancho) => {
    window.innerWidth = ancho
    const { container } = montar()
    await screen.findByRole('button', { name: 'Consultar por WhatsApp' })
    expect(await violacionesAxe(container)).toEqual([])
  })

  it.each([320, 768, 1440])('a %i px el diálogo de WhatsApp no tiene violaciones de axe', async (ancho) => {
    window.innerWidth = ancho
    montar()
    fireEvent.click(await screen.findByRole('button', { name: 'Consultar por WhatsApp' }))
    const dialogo = await screen.findByRole('dialog')
    expect(await violacionesAxe(dialogo)).toEqual([])
  })
})
