import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ThemeProvider } from '@mui/material'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { violacionesAxe } from '../../../test/axe'
import { celular } from '../../../test/matchMedia'
import { contraste, crearTemaTienda } from '../../../tema/temaTienda'
import { FILTROS_INICIALES } from '../../../lib/tiendaListado'

const mocks = vi.hoisted(() => ({ enviar: vi.fn() }))
vi.mock('../../../lib/analiticaTienda', () => ({ registrarEventoTienda: vi.fn() }))
vi.mock('../../../lib/registroWhatsapp', () => ({ nuevaClaveEnvioWhatsapp: () => 'clave', registrarConsultaWhatsapp: vi.fn() }))
vi.mock('../../../lib/tiendaContacto', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/tiendaContacto')>()),
  enviarConsultaContacto: mocks.enviar,
}))

import { PanelFiltros } from '../catalogo/PanelFiltros'
import { FormularioContacto } from '../contacto/FormularioContacto'
import { DatosContacto } from '../contacto/DatosContacto'
import DialogoWhatsApp from '../whatsapp/DialogoWhatsApp'
import { estiloEnlacePie } from './estilosPie'

// MSF-847 (auditoría de fidelidad): lo que se corrigió y no tiene otro test propio.
const tema = crearTemaTienda({ colorPrimario: '#1B3A5C', colorAcento: '#E9A23B', colorTexto: '#1B2430', colorFondo: '#FBF8F2', colorBarra: '#1B3A5C' })
const conTema = (ui: React.ReactNode) => <ThemeProvider theme={tema}><MemoryRouter>{ui}</MemoryRouter></ThemeProvider>
const reglas = () => Array.from(document.querySelectorAll('style')).map((s) => s.textContent).join('')

describe('panel de categorías de escritorio (K-02, K-03)', () => {
  it('«Todos los productos» lleva el total (suma de las categorías raíz) y las filas no suman el margen de MUI', () => {
    const categorias = [
      { id: 'a', nombre: 'Joysticks', padreId: null, productos: 3 },
      { id: 'b', nombre: 'Cargadores', padreId: null, productos: 4 },
      { id: 'c', nombre: 'Pro', padreId: 'a', productos: 2 },
    ]
    render(conTema(<PanelFiltros categorias={categorias} filtros={FILTROS_INICIALES} alElegirCategoria={vi.fn()} alCambiarStock={vi.fn()} alCambiarPrecioMax={vi.fn()} alLimpiar={vi.fn()} />))
    expect(screen.getByRole('button', { name: /^Todos los productos/ })).toHaveTextContent('Todos los productos7')
    expect(reglas()).toMatch(/\.MuiListItemText-root\b|margin:0/)
  })
})

describe('pie (C-06)', () => {
  it('los enlaces del pie van sin subrayado (solo «Escribinos» lo lleva aparte)', () => {
    expect(estiloEnlacePie.textDecoration).toBe('none')
  })
})

describe('contacto (T-05, T-06, MK-01, MK-03, MK-04)', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.enviar.mockResolvedValue({ estado: 'exito' }) })

  it('al enviar se conserva el título «Escribinos» sobre el recuadro de éxito y «Enviar otra» mide 16 px', async () => {
    render(conTema(<FormularioContacto host="mundojc.localhost" />))
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Ana' } })
    fireEvent.change(screen.getByLabelText('Correo o WhatsApp'), { target: { value: 'ana@ejemplo.com' } })
    fireEvent.change(screen.getByLabelText('Mensaje'), { target: { value: 'Hola, ¿tienen stock?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar consulta' }))
    const exito = await screen.findByTestId('contacto-exito')
    expect(exito).toHaveTextContent('Escribinos')
    expect(exito).toHaveTextContent('¡Gracias! Recibimos tu consulta')
    expect(getComputedStyle(screen.getByRole('button', { name: 'Enviar otra' })).fontSize).toBe('16px')
  })

  it('en celular los rótulos quedan solo para lectores de pantalla y desaparece «Retiro y envíos»; los glifos miden 20 px', () => {
    celular(true)
    const { container } = render(conTema(<><DatosContacto contacto={{ nombre: 'Mundo JC', whatsapp: '+54 9 11 7365-2596', correo: 'a@b.com', horarios: null }} /><FormularioContacto host="mundojc.localhost" /></>))
    expect(screen.queryByTestId('bloque-retiro-envios')).not.toBeInTheDocument()
    expect(container.querySelector('section > span svg')?.getAttribute('width')).toBe('20')
    expect(screen.getByLabelText('Nombre')).toBeInTheDocument()
    expect(getComputedStyle(screen.getByText('Nombre', { selector: 'label' })).position).toBe('absolute')
    Reflect.deleteProperty(window, 'matchMedia')
  })
})

describe('diálogo de WhatsApp (P-07…P-10)', () => {
  const props = { abierto: true, host: 'mundojc.localhost', productoId: 'p-1', empresa: 'MundoJC', numero: '+54 9 11 7365-2596', mensaje: 'Hola MundoJC, quiero consultar por Case ($ 50.625). ¿Está disponible?', url: 'https://wa.me/5491173652596', onCerrar: vi.fn(), onAviso: vi.fn() }

  it('sigue el prototipo: radio 14, círculo verde, línea de contacto, mensaje en recuadro de solo lectura y botones de 44 px', async () => {
    render(conTema(<DialogoWhatsApp {...props} />))
    const dialogo = await screen.findByRole('dialog', { name: 'Consultar por WhatsApp' })
    expect(dialogo).toHaveTextContent('MundoJC · +54 9 11 7365-2596')
    expect(reglas()).toMatch(/border-radius:14px/)
    expect(reglas()).toMatch(/box-shadow:0 24px 60px rgba\(0,0,0,\.35\)/)
    const mensaje = screen.getByLabelText('Mensaje que se va a enviar')
    expect(mensaje).toHaveValue(props.mensaje)
    expect(mensaje).toHaveAttribute('readonly')
    expect(getComputedStyle(screen.getByRole('button', { name: 'Cancelar' })).fontSize).toBe('16px')
    expect(getComputedStyle(screen.getByRole('button', { name: 'Abrir WhatsApp' })).backgroundColor).toBe('rgb(37, 211, 102)')
  })

  it('el texto de «Abrir WhatsApp» sobre el verde #25D366 llega a AA (no blanco: 2:1)', async () => {
    render(conTema(<DialogoWhatsApp {...props} />))
    const boton = await screen.findByRole('button', { name: 'Abrir WhatsApp' })
    const [r, g, b] = getComputedStyle(boton).color.match(/\d+/g)!.map(Number)
    const hex = `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`
    expect(contraste(hex, '#25D366')).toBeGreaterThanOrEqual(4.5)
  })

  it('«Cancelar» cierra, «Abrir WhatsApp» abre wa.me y avisa; sin violaciones de axe', async () => {
    const abrir = vi.spyOn(window, 'open').mockImplementation(() => null)
    render(conTema(<DialogoWhatsApp {...props} />))
    await screen.findByRole('dialog')
    expect(await violacionesAxe(document.body)).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: 'Abrir WhatsApp' }))
    expect(abrir).toHaveBeenCalledWith(props.url, '_blank', 'noopener')
    await waitFor(() => expect(props.onAviso).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(props.onCerrar).toHaveBeenCalled()
    abrir.mockRestore()
  })
})
