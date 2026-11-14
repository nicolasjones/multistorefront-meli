import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  obtenerReparacion: vi.fn(),
  listarTecnicos: vi.fn(),
  obtenerDatosTienda: vi.fn(),
  useIsSuperadmin: vi.fn(),
  useNivelSeccion: vi.fn(),
  useOrganizacionDeTrabajo: vi.fn(),
  maybeSingle: vi.fn(),
  eq: vi.fn(),
  getUser: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({
  supabaseClient: { auth: { getUser: mocks.getUser }, from: () => ({ select: () => ({ eq: mocks.eq }) }) },
}))
vi.mock('../../hooks/useIsSuperadmin', () => ({ useIsSuperadmin: mocks.useIsSuperadmin }))
vi.mock('../../hooks/useNivelSeccion', () => ({ useNivelSeccion: mocks.useNivelSeccion }))
vi.mock('../../hooks/useOrganizacionDeTrabajo', () => ({ useOrganizacionDeTrabajo: mocks.useOrganizacionDeTrabajo }))
vi.mock('../../lib/reparaciones', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/reparaciones')>()),
  obtenerReparacion: mocks.obtenerReparacion,
  listarTecnicos: mocks.listarTecnicos,
}))
vi.mock('../../lib/documentosReparacion', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/documentosReparacion')>()),
  obtenerDatosTienda: mocks.obtenerDatosTienda,
}))

import { RequiereAccesoSeccion } from '../../components/RequiereAccesoSeccion'
import type { Reparacion } from '../../lib/reparaciones'
import { leerQr } from '../../lib/qr/qr.lector.test-util'
import { violacionesAxe } from '../../test/axe'
import { fijarAncho } from '../../test/ancho'
import { ServicioEtiqueta } from './etiqueta'

const ID = '0b6f4c1e-8d2a-4c3b-9a7e-5f2d1c0a9b87'
const TIENDA = { nombre: 'San Javucho', direccion: 'Calle Secreta 123', whatsapp: '11 4444-4444', correo: 'tienda@example.com' }

// Una reparación cargada de datos personales: nada de esto puede llegar a la etiqueta (FR-044).
const REPARACION: Reparacion = {
  id: ID, numero: 238, codigo: 'R-0238', empresa_id: 'e-1', empresa: 'San Javucho', cliente_id: 'c-1', cliente: 'Ana Pérez Confidencial',
  contacto: '11 5555-5555', modelo_id: 'm-1', equipo: 'PlayStation', modelo: '5', estado_id: 's-1', estado: 'Recibido',
  estado_cierra: false, estado_tono: 'neutral', numero_serie: 'SERIE-SECRETA-77', accesorios: 'Cargador secreto', falla: 'Falla secreta del equipo',
  puede_ver_costos: true, costo_mano_obra: 777, costo_repuestos: 555, tecnico_id: 't-1', ingreso_en: '2026-11-12',
  entrega_prevista: '2026-11-25', entrega_real: null, entregado_por: null, anulada_en: null, anulada_motivo: null,
  updated_at: 't', items: [], total_mano_obra: 31415, total_repuestos: 2718, total_cliente: 34133, ganancia_estimada: 999,
}

const abrir = (id = ID) =>
  render(
    <MemoryRouter initialEntries={[`/service-tecnico/reparaciones/${id}/etiqueta`]}>
      <Routes>
        <Route path="/service-tecnico/reparaciones/:id/etiqueta" element={<ServicioEtiqueta />} />
        <Route path="/service-tecnico/reparaciones/:id" element={<div>Detalle de la reparación</div>} />
      </Routes>
    </MemoryRouter>,
  )

const copias = (contenedor: HTMLElement) => [...contenedor.querySelectorAll<HTMLElement>('.etiqueta-copia')]

// Reconstruye la matriz del QR desde el `<path>` que está en el DOM, igual que lo vería un lector, y la decodifica.
function decodificarDelDom(contenedor: HTMLElement): string {
  const svg = contenedor.querySelector('svg[role="img"]') as SVGSVGElement
  const lado = Number(svg.getAttribute('viewBox')!.split(' ')[2])
  const raster = Array.from({ length: lado }, () => new Array<boolean>(lado).fill(false))
  const path = svg.querySelector('path')!.getAttribute('d')!
  for (const [, x, y, largo] of path.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) for (let i = 0; i < Number(largo); i++) raster[Number(y)][Number(x) + i] = true
  const simbolo = raster.slice(4, lado - 4).map((fila) => fila.slice(4, lado - 4))
  return leerQr(simbolo).texto
}

// `@page` va en una hoja de estilos de emotion: se busca en todas las del documento.
const estilosDelDocumento = () => [...document.querySelectorAll('style')].map((estilo) => estilo.textContent ?? '').join('\n')

const stubOrigen = (origin: string) => {
  const url = new URL(origin)
  vi.stubGlobal('location', { ...window.location, origin: url.origin, hostname: url.hostname, href: origin, host: url.host, protocol: url.protocol })
}

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  mocks.obtenerDatosTienda.mockResolvedValue(TIENDA)
  mocks.listarTecnicos.mockResolvedValue([{ user_id: 't-1', nombre: 'Marta Técnica' }])
  mocks.obtenerReparacion.mockResolvedValue(REPARACION)
  fijarAncho(1440)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('Etiqueta de la reparación · contenido (FR-044, FR-048, amenazas 3.1 y 3.7)', () => {
  it('muestra el título, el QR con nombre accesible y solo los cuatro textos previstos', async () => {
    const { container } = abrir()
    expect(await screen.findByRole('heading', { name: 'Etiqueta de la reparación R-0238' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Código QR de la reparación R-0238' })).toBeInTheDocument()
    const [etiqueta] = copias(container)
    expect(etiqueta.textContent).toBe('R-0238San JavuchoPlayStation 5Ingreso 12/11/2026')
    // Ni un dato más de la reparación ni de la tienda en toda la página.
    for (const prohibido of ['Ana Pérez', '5555', 'SERIE-SECRETA', 'Cargador', 'Falla secreta', 'Marta', '777', '31415', '34133', 'Calle Secreta', 'tienda@example.com', '4444-4444', '999']) {
      expect(container.textContent, prohibido).not.toContain(prohibido)
    }
  })

  it('muestra literales los valores con HTML o <script> y no inyecta nada', async () => {
    mocks.obtenerDatosTienda.mockResolvedValue({ ...TIENDA, nombre: '<img src=x onerror=alert(1)>Tienda' })
    mocks.obtenerReparacion.mockResolvedValue({ ...REPARACION, equipo: '<script>alert(1)</script>', modelo: '<b>5</b>' })
    const { container } = abrir()
    await screen.findByRole('heading', { name: 'Etiqueta de la reparación R-0238' })
    const [etiqueta] = copias(container)
    expect(etiqueta.textContent).toContain('<script>alert(1)</script> <b>5</b>')
    expect(etiqueta.textContent).toContain('<img src=x onerror=alert(1)>Tienda')
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('b')).toBeNull()
    expect(container.querySelector('img')).toBeNull()
  })

  it('el QR decodifica exactamente la ruta de la reparación y nada más (SC-005)', async () => {
    const { container } = abrir()
    await screen.findByRole('img', { name: 'Código QR de la reparación R-0238' })
    expect(decodificarDelDom(container)).toBe(`${window.location.origin}/service-tecnico/reparaciones/${ID}`)
  })

  it('con un dominio de panel real el QR trae ese dominio y la etiqueta es negra sobre blanco con bordes nítidos', async () => {
    stubOrigen('https://panel.msf.example')
    const { container } = abrir()
    await screen.findByRole('img', { name: 'Código QR de la reparación R-0238' })
    expect(decodificarDelDom(container)).toBe(`https://panel.msf.example/service-tecnico/reparaciones/${ID}`)
    expect(screen.queryByText(/entorno de prueba/)).toBeNull()
    const svg = container.querySelector('svg[role="img"]')!
    expect(svg.getAttribute('shape-rendering')).toBe('crispEdges')
    expect(svg.querySelectorAll('path')).toHaveLength(1)
    expect(svg.querySelector('path')!.getAttribute('fill')).toBe('#000')
    expect(svg.getAttribute('viewBox')).toMatch(/^0 0 (\d+) \1$/)
  })
})

describe('Etiqueta de la reparación · entorno y dirección (FR-047, FR-049)', () => {
  it('avisa del entorno de prueba en localhost y en 127.0.0.1, y no en un dominio real', async () => {
    abrir()
    expect(await screen.findByText('Estás en un entorno de prueba: el QR apunta a esta dirección y no va a funcionar en otros equipos.')).toBeInTheDocument()
    vi.unstubAllGlobals()
    stubOrigen('http://127.0.0.1:4300')
    abrir()
    expect((await screen.findAllByText(/entorno de prueba/)).length).toBeGreaterThan(0)
  })

  it('una dirección de panel demasiado larga muestra el error, no dibuja el QR y deshabilita «Imprimir»', async () => {
    stubOrigen(`https://${'a'.repeat(140)}.example.com`)
    const { container } = abrir()
    expect(await screen.findByText('La dirección del panel es demasiado larga para el código QR.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Imprimir' })).toBeDisabled()
    expect(container.querySelector('svg[role="img"]')).toBeNull()
  })
})

describe('Etiqueta de la reparación · tamaño, copias e impresión (FR-045, FR-046)', () => {
  it('imprime con window.print y un @page del tamaño elegido, sin márgenes', async () => {
    const imprimir = vi.spyOn(window, 'print').mockImplementation(() => undefined)
    abrir()
    const boton = await screen.findByRole('button', { name: 'Imprimir' })
    expect(screen.getByRole('combobox', { name: 'Tamaño de la etiqueta' })).toHaveTextContent('Mediana · 50 × 30 mm')
    expect(estilosDelDocumento()).toMatch(/@page\s*\{\s*size:\s*50mm 30mm;\s*margin:\s*0;?\s*\}/)
    fireEvent.click(boton)
    expect(imprimir).toHaveBeenCalledTimes(1)

    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Tamaño de la etiqueta' }))
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'Grande · 70 × 40 mm' }))
    await waitFor(() => expect(estilosDelDocumento()).toMatch(/@page\s*\{\s*size:\s*70mm 40mm;\s*margin:\s*0;?\s*\}/))
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Tamaño de la etiqueta' }))
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'Chica · 40 × 25 mm' }))
    await waitFor(() => expect(estilosDelDocumento()).toMatch(/@page\s*\{\s*size:\s*40mm 25mm;\s*margin:\s*0;?\s*\}/))
  })

  it('oculta al imprimir todo lo que no es la etiqueta (controles, avisos, título, menú)', async () => {
    const { container } = abrir()
    await screen.findByRole('button', { name: 'Imprimir' })
    expect(estilosDelDocumento()).toMatch(/@media print\s*\{\s*\.MuiAppBar-root,\s*\.MuiDrawer-root,\s*nav,\s*\.no-imprimir\s*\{\s*display:\s*none\s*!important/)
    const oculto = [...container.querySelectorAll('.no-imprimir')]
    expect(oculto.some((nodo) => nodo.contains(screen.getByRole('heading', { name: /Etiqueta de la reparación/ })))).toBe(true)
    expect(oculto.some((nodo) => nodo.contains(screen.getByRole('button', { name: 'Imprimir' })))).toBe(true)
    expect(oculto.some((nodo) => nodo.contains(screen.getByLabelText('Cantidad de etiquetas')))).toBe(true)
    expect(oculto.some((nodo) => nodo.contains(screen.getByText(/dejá la escala en 100 %/)))).toBe(true)
    // La etiqueta en sí NO está dentro de nada oculto.
    for (const copia of copias(container)) expect(oculto.some((nodo) => nodo.contains(copia))).toBe(false)
  })

  it('«Personalizada» pide ancho y alto con sus errores y solo aplica medidas válidas', async () => {
    const imprimir = vi.spyOn(window, 'print').mockImplementation(() => undefined)
    abrir()
    await screen.findByRole('button', { name: 'Imprimir' })
    expect(screen.queryByLabelText('Ancho (mm)')).toBeNull()
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Tamaño de la etiqueta' }))
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'Personalizada' }))
    const ancho = await screen.findByLabelText('Ancho (mm)')
    const alto = screen.getByLabelText('Alto (mm)')
    expect(ancho).toHaveValue(50)
    expect(alto).toHaveValue(30)

    fireEvent.change(ancho, { target: { value: '24' } })
    expect(screen.getByText('Ingresá un ancho entre 25 y 100 mm.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Imprimir' })).toBeDisabled()
    fireEvent.change(ancho, { target: { value: '101' } })
    expect(screen.getByText('Ingresá un ancho entre 25 y 100 mm.')).toBeInTheDocument()
    fireEvent.change(ancho, { target: { value: '' } })
    expect(screen.getByText('Ingresá un ancho entre 25 y 100 mm.')).toBeInTheDocument()
    fireEvent.change(alto, { target: { value: '14' } })
    expect(screen.getByText('Ingresá un alto entre 15 y 100 mm.')).toBeInTheDocument()
    fireEvent.change(alto, { target: { value: '12.5' } })
    expect(screen.getByText('Ingresá un alto entre 15 y 100 mm.')).toBeInTheDocument()
    // Con un valor inválido la hoja conserva la última medida válida (50 × 30).
    expect(estilosDelDocumento()).toMatch(/size:\s*50mm 30mm/)

    fireEvent.change(ancho, { target: { value: '60' } })
    fireEvent.change(alto, { target: { value: '25' } })
    expect(screen.queryByText(/Ingresá un (ancho|alto)/)).toBeNull()
    await waitFor(() => expect(estilosDelDocumento()).toMatch(/size:\s*60mm 25mm/))
    const imprimirBoton = screen.getByRole('button', { name: 'Imprimir' })
    expect(imprimirBoton).toBeEnabled()
    fireEvent.click(imprimirBoton)
    expect(imprimir).toHaveBeenCalledTimes(1)
  })

  it('«Cantidad de etiquetas» de 1 a 10 imprime esa cantidad, una por página, y valida el rango', async () => {
    const { container } = abrir()
    const cantidad = await screen.findByLabelText('Cantidad de etiquetas')
    expect(cantidad).toHaveValue(1)
    expect(copias(container)).toHaveLength(1)
    fireEvent.change(cantidad, { target: { value: '3' } })
    expect(copias(container)).toHaveLength(3)
    // En pantalla se ve una sola; las otras existen para imprimir.
    expect(copias(container).filter((copia) => copia.dataset.soloImpresion === 'true')).toHaveLength(2)
    expect(screen.getAllByRole('img', { name: 'Código QR de la reparación R-0238' })).toHaveLength(1)
    expect(estilosDelDocumento()).toMatch(/break-after:\s*page/)
    fireEvent.change(cantidad, { target: { value: '10' } })
    expect(copias(container)).toHaveLength(10)
    for (const invalido of ['0', '11', '', '2.5']) {
      fireEvent.change(cantidad, { target: { value: invalido } })
      expect(screen.getByText('Ingresá una cantidad entre 1 y 10.')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Imprimir' })).toBeDisabled()
    }
  })

  it('recuerda el tamaño en este navegador y no recuerda la cantidad', async () => {
    const primera = abrir()
    await screen.findByRole('button', { name: 'Imprimir' })
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Tamaño de la etiqueta' }))
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'Grande · 70 × 40 mm' }))
    fireEvent.change(screen.getByLabelText('Cantidad de etiquetas'), { target: { value: '4' } })
    await waitFor(() => expect(JSON.parse(window.localStorage.getItem('msf.service.etiqueta')!)).toEqual({ tamano: 'grande', ancho: 50, alto: 30 }))
    expect(window.localStorage.getItem('msf.service.etiqueta')).not.toMatch(/copias|cantidad|4/)
    primera.unmount()

    abrir()
    await screen.findByRole('button', { name: 'Imprimir' })
    expect(screen.getByRole('combobox', { name: 'Tamaño de la etiqueta' })).toHaveTextContent('Grande · 70 × 40 mm')
    expect(screen.getByLabelText('Cantidad de etiquetas')).toHaveValue(1)
  })

  it('una preferencia corrupta, extrema o un almacén bloqueado no rompen la pantalla', async () => {
    window.localStorage.setItem('msf.service.etiqueta', '{"tamano":"personalizada","ancho":99999,"alto":-3}')
    const extrema = abrir()
    await screen.findByRole('button', { name: 'Imprimir' })
    expect(estilosDelDocumento()).toMatch(/size:\s*100mm 15mm/)
    extrema.unmount()

    window.localStorage.setItem('msf.service.etiqueta', 'basura{')
    const corrupta = abrir()
    await screen.findByRole('button', { name: 'Imprimir' })
    expect(screen.getByRole('combobox', { name: 'Tamaño de la etiqueta' })).toHaveTextContent('Mediana · 50 × 30 mm')
    corrupta.unmount()

    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('bloqueado', 'SecurityError') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('bloqueado', 'SecurityError') })
    abrir()
    await screen.findByRole('button', { name: 'Imprimir' })
    expect(screen.getByRole('combobox', { name: 'Tamaño de la etiqueta' })).toHaveTextContent('Mediana · 50 × 30 mm')
  })

  it('con un tamaño donde el módulo mide menos de 0,4 mm avisa y deshabilita «Imprimir»', async () => {
    abrir()
    await screen.findByRole('button', { name: 'Imprimir' })
    expect(screen.queryByText(/demasiado chico para leerse/)).toBeNull()
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Tamaño de la etiqueta' }))
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'Personalizada' }))
    fireEvent.change(await screen.findByLabelText('Ancho (mm)'), { target: { value: '25' } })
    fireEvent.change(screen.getByLabelText('Alto (mm)'), { target: { value: '15' } })
    expect(await screen.findByText('Con este tamaño el código QR queda demasiado chico para leerse. Probá con una etiqueta más grande.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Imprimir' })).toBeDisabled()
  })
})

describe('Etiqueta de la reparación · estados', () => {
  it('muestra la carga y después el error con «Reintentar»', async () => {
    mocks.obtenerReparacion.mockRejectedValueOnce({ code: 'P0002' })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    abrir()
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true')
    expect(await screen.findByText('No pudimos cargar la reparación.')).toBeInTheDocument()
    expect(screen.getByText('Esa reparación ya no existe. Volvé al listado.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByRole('heading', { name: 'Etiqueta de la reparación R-0238' })).toBeInTheDocument()
    expect(mocks.obtenerReparacion).toHaveBeenCalledTimes(2)
  })

  it('una reparación anulada no se imprime y ofrece volver', async () => {
    mocks.obtenerReparacion.mockResolvedValue({ ...REPARACION, anulada_en: '2026-11-13T10:00:00Z', anulada_motivo: 'Cliente desistió' })
    const { container } = abrir()
    expect(await screen.findByText('La reparación está anulada: no se imprime etiqueta.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Imprimir' })).toBeNull()
    expect(container.querySelector('svg[role="img"]')).toBeNull()
    fireEvent.click(screen.getByRole('link', { name: '← Volver a la reparación' }))
    expect(await screen.findByText('Detalle de la reparación')).toBeInTheDocument()
  })

  it('«← Volver a la reparación» lleva al detalle', async () => {
    abrir()
    fireEvent.click(await screen.findByRole('link', { name: '← Volver a la reparación' }))
    expect(await screen.findByText('Detalle de la reparación')).toBeInTheDocument()
  })

  it('sin acceso a Service técnico muestra la pantalla de acceso restringido y no pide la reparación (FR-050)', async () => {
    mocks.useIsSuperadmin.mockReturnValue({ isSuperadmin: false, isLoading: false })
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'ninguno', isLoading: false })
    mocks.useOrganizacionDeTrabajo.mockReturnValue({ organizacionId: 'org-1', isLoading: false })
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
    mocks.eq.mockReturnValue({ eq: mocks.eq, maybeSingle: mocks.maybeSingle })
    mocks.maybeSingle.mockResolvedValue({ data: { rol_id: 'operador' }, error: null })
    render(
      <MemoryRouter initialEntries={[`/service-tecnico/reparaciones/${ID}/etiqueta`]}>
        <Routes>
          <Route
            path="/service-tecnico/reparaciones/:id/etiqueta"
            element={<RequiereAccesoSeccion seccion="service_tecnico"><ServicioEtiqueta /></RequiereAccesoSeccion>}
          />
        </Routes>
      </MemoryRouter>,
    )
    expect(await screen.findByText('Sección no disponible para tu rol')).toBeInTheDocument()
    expect(mocks.obtenerReparacion).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Imprimir' })).toBeNull()
  })
})

describe.each([320, 768, 1440])('Etiqueta de la reparación · accesibilidad a %i px (FR-048, FR-049)', (ancho) => {
  it('no tiene violaciones de axe, el QR tiene nombre y se opera con teclado', async () => {
    fijarAncho(ancho)
    const { container } = abrir()
    await screen.findByRole('img', { name: 'Código QR de la reparación R-0238' })
    expect(await violacionesAxe(container)).toEqual([])
    // Controles etiquetados y alcanzables por teclado (nada con tabindex negativo).
    for (const control of [screen.getByRole('combobox', { name: 'Tamaño de la etiqueta' }), screen.getByLabelText('Cantidad de etiquetas'), screen.getByRole('button', { name: 'Imprimir' })]) {
      expect(control.getAttribute('tabindex')).not.toBe('-1')
    }
    // Sin scroll horizontal: la hoja no fija un ancho en px y la vista previa nunca pasa del 100 % disponible.
    expect(container.innerHTML).not.toMatch(/width:\s*\d{3,}px/)
    expect(estilosDelDocumento()).toMatch(/width:\s*min\(100%,\s*150mm\)/)
  })

  it('con medidas personalizadas y errores también cumple axe', async () => {
    fijarAncho(ancho)
    const { container } = abrir()
    await screen.findByRole('button', { name: 'Imprimir' })
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Tamaño de la etiqueta' }))
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'Personalizada' }))
    fireEvent.change(await screen.findByLabelText('Ancho (mm)'), { target: { value: '5' } })
    expect(await violacionesAxe(container)).toEqual([])
  })
})
