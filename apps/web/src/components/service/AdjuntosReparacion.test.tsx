import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listarAdjuntos: vi.fn(),
  subirAdjunto: vi.fn(),
  quitarAdjunto: vi.fn(),
  urlsAdjuntos: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({ supabaseClient: {} }))
vi.mock('../../lib/reparacionAdjuntos', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/reparacionAdjuntos')>()),
  listarAdjuntos: mocks.listarAdjuntos,
  subirAdjunto: mocks.subirAdjunto,
  quitarAdjunto: mocks.quitarAdjunto,
  urlsAdjuntos: mocks.urlsAdjuntos,
}))

import { tipoPorCabecera, validarArchivoAdjunto, type Adjunto } from '../../lib/reparacionAdjuntos'
import { AdjuntosReparacion } from './AdjuntosReparacion'

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]
const JPG = [0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]
const WEBP = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]

const archivo = (nombre: string, bytes: number[], tipo = 'image/png') => new File([new Uint8Array(bytes)], nombre, { type: tipo })

const adjunto = (n: number): Adjunto => ({
  id: `a-${n}`,
  ruta: `org/rep/${n}.png`,
  nombre_original: `foto-${n}.png`,
  mime: 'image/png',
  bytes: 1000,
  creado_en: '2026-10-28T15:00:00Z',
  subido_por: 'Ana Pérez',
})

function montar(props: Partial<React.ComponentProps<typeof AdjuntosReparacion>> = {}) {
  return render(<AdjuntosReparacion reparacionId="r-1" organizacionId="org" puedeEditar anulada={false} {...props} />)
}

describe('validación por archivo (FR-003)', () => {
  it('reconoce PNG, JPEG y WebP por su cabecera', () => {
    expect(tipoPorCabecera(new Uint8Array(PNG))).toBe('image/png')
    expect(tipoPorCabecera(new Uint8Array(JPG))).toBe('image/jpeg')
    expect(tipoPorCabecera(new Uint8Array(WEBP))).toBe('image/webp')
    expect(tipoPorCabecera(new Uint8Array([1, 2, 3]))).toBeNull()
  })

  it('acepta una imagen válida', async () => {
    expect(await validarArchivoAdjunto(archivo('a.png', PNG))).toEqual({ ok: true, mime: 'image/png' })
    expect(await validarArchivoAdjunto(archivo('a.jpeg', JPG, 'image/jpeg'))).toEqual({ ok: true, mime: 'image/jpeg' })
  })

  it('rechaza una extensión no permitida', async () => {
    const r = await validarArchivoAdjunto(archivo('a.gif', PNG, 'image/gif'))
    expect(r.ok).toBe(false)
  })

  it('rechaza un archivo cuya cabecera no coincide con la extensión', async () => {
    const r = await validarArchivoAdjunto(archivo('falso.png', [0x4d, 0x5a, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]))
    expect(r).toEqual({ ok: false, mensaje: '«falso.png»: solo se admiten imágenes JPG, PNG o WebP.' })
    expect((await validarArchivoAdjunto(archivo('jpg-como-png.png', JPG))).ok).toBe(false)
  })

  it('rechaza más de 5 MB y los archivos vacíos', async () => {
    const grande = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'grande.png', { type: 'image/png' })
    expect(await validarArchivoAdjunto(grande)).toEqual({ ok: false, mensaje: '«grande.png»: pesa más de 5 MB.' })
    expect((await validarArchivoAdjunto(new File([], 'vacio.png'))).ok).toBe(false)
  })
})

describe('AdjuntosReparacion (FR-007, FR-008, FR-010)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listarAdjuntos.mockResolvedValue([])
    mocks.urlsAdjuntos.mockImplementation(async (rutas: string[]) => Object.fromEntries(rutas.map((r) => [r, `https://firmada/${r}`])))
    mocks.subirAdjunto.mockResolvedValue(undefined)
    mocks.quitarAdjunto.mockResolvedValue(undefined)
  })

  it('muestra el estado de carga y luego el vacío con la invitación a agregar fotos', async () => {
    montar()
    expect(screen.getByText('Cargando fotos…')).toBeTruthy()
    expect(await screen.findByText(/todavía no tiene fotos/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Agregar fotos' })).toBeTruthy()
  })

  it('muestra el error con «Reintentar»', async () => {
    mocks.listarAdjuntos.mockRejectedValueOnce(new Error('falla'))
    montar()
    expect(await screen.findByText('No pudimos cargar las fotos.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByText(/todavía no tiene fotos/)).toBeTruthy()
    expect(mocks.listarAdjuntos).toHaveBeenCalledTimes(2)
  })

  it('muestra miniaturas con texto alternativo = nombre original, firmadas en una sola llamada', async () => {
    mocks.listarAdjuntos.mockResolvedValue([adjunto(1), adjunto(2)])
    montar()
    const imagen = await screen.findByAltText('foto-1.png')
    expect(imagen.getAttribute('src')).toBe('https://firmada/org/rep/1.png')
    expect(screen.getByAltText('foto-2.png')).toBeTruthy()
    expect(mocks.urlsAdjuntos).toHaveBeenCalledTimes(1)
    expect(mocks.urlsAdjuntos).toHaveBeenCalledWith(['org/rep/1.png', 'org/rep/2.png'])
  })

  it('la entrada de archivos admite varias imágenes desde galería o cámara (sin forzar `capture`)', async () => {
    montar()
    await screen.findByText(/todavía no tiene fotos/)
    const entrada = screen.getByTestId('entrada-adjuntos')
    expect(entrada.getAttribute('accept')).toBe('image/jpeg,image/png,image/webp')
    expect(entrada.hasAttribute('multiple')).toBe(true)
    expect(entrada.hasAttribute('capture')).toBe(false)
  })

  it('sube cada imagen válida y recarga la lista', async () => {
    montar()
    await screen.findByText(/todavía no tiene fotos/)
    mocks.listarAdjuntos.mockResolvedValue([adjunto(1), adjunto(2)])
    fireEvent.change(screen.getByTestId('entrada-adjuntos'), { target: { files: [archivo('a.png', PNG), archivo('b.jpg', JPG, 'image/jpeg')] } })
    await waitFor(() => expect(mocks.subirAdjunto).toHaveBeenCalledTimes(2))
    expect(mocks.subirAdjunto.mock.calls[0].slice(0, 2)).toEqual(['org', 'r-1'])
    expect(await screen.findByAltText('foto-2.png')).toBeTruthy()
  })

  it('rechaza el archivo inválido con un mensaje por archivo y sube solo los válidos', async () => {
    montar()
    await screen.findByText(/todavía no tiene fotos/)
    fireEvent.change(screen.getByTestId('entrada-adjuntos'), {
      target: { files: [archivo('ok.png', PNG), archivo('malo.gif', PNG, 'image/gif')] },
    })
    expect(await screen.findByText('«malo.gif»: solo se admiten imágenes JPG, PNG o WebP.')).toBeTruthy()
    expect(mocks.subirAdjunto).toHaveBeenCalledTimes(1)
  })

  it('informa el error de la base al subir', async () => {
    mocks.subirAdjunto.mockRejectedValueOnce({ code: '22023', message: 'Una reparación admite hasta 20 fotos y adjuntos' })
    montar()
    await screen.findByText(/todavía no tiene fotos/)
    fireEvent.change(screen.getByTestId('entrada-adjuntos'), { target: { files: [archivo('a.png', PNG)] } })
    expect(await screen.findByText(/«a.png»: Una reparación admite hasta 20 fotos y adjuntos/)).toBeTruthy()
  })

  it('con 20 adjuntos no deja agregar más y lo dice', async () => {
    mocks.listarAdjuntos.mockResolvedValue(Array.from({ length: 20 }, (_, i) => adjunto(i + 1)))
    montar()
    expect(await screen.findByText(/Llegaste al máximo de 20/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Agregar fotos' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('el tope también corta una selección múltiple que lo supera', async () => {
    mocks.listarAdjuntos.mockResolvedValue(Array.from({ length: 19 }, (_, i) => adjunto(i + 1)))
    montar()
    await screen.findByAltText('foto-1.png')
    fireEvent.change(screen.getByTestId('entrada-adjuntos'), { target: { files: [archivo('a.png', PNG), archivo('b.png', PNG)] } })
    expect(await screen.findByText(/«b.png»: la reparación ya tiene el máximo de 20/)).toBeTruthy()
    expect(mocks.subirAdjunto).toHaveBeenCalledTimes(1)
  })

  it('abre la vista ampliada con nombre, fecha y quién la subió (nunca el correo)', async () => {
    mocks.listarAdjuntos.mockResolvedValue([adjunto(1)])
    montar()
    fireEvent.click(await screen.findByRole('button', { name: 'Ver foto-1.png' }))
    const dialogo = await screen.findByRole('dialog')
    expect(within(dialogo).getByText('foto-1.png', { selector: 'span' })).toBeTruthy()
    expect(within(dialogo).getByText(/Subida por Ana Pérez/)).toBeTruthy()
    expect(within(dialogo).getByAltText('foto-1.png')).toBeTruthy()
  })

  it('quita con confirmación y recarga la lista', async () => {
    mocks.listarAdjuntos.mockResolvedValueOnce([adjunto(1)]).mockResolvedValue([])
    montar()
    fireEvent.click(await screen.findByRole('button', { name: 'Ver foto-1.png' }))
    const dialogo = await screen.findByRole('dialog')
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Quitar' }))
    expect(mocks.quitarAdjunto).not.toHaveBeenCalled()
    expect(within(dialogo).getByText(/¿Quitar esta foto\?/)).toBeTruthy()
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Quitar foto' }))
    await waitFor(() => expect(mocks.quitarAdjunto).toHaveBeenCalledWith('a-1'))
    expect(await screen.findByText(/todavía no tiene fotos/)).toBeTruthy()
  })

  it('si quitar falla, muestra el error en el diálogo y lo deja abierto', async () => {
    mocks.listarAdjuntos.mockResolvedValue([adjunto(1)])
    mocks.quitarAdjunto.mockRejectedValueOnce({ code: '42501' })
    montar()
    fireEvent.click(await screen.findByRole('button', { name: 'Ver foto-1.png' }))
    const dialogo = await screen.findByRole('dialog')
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Quitar' }))
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Quitar foto' }))
    expect(await within(dialogo).findByText(/No tenés permiso/)).toBeTruthy()
  })

  it('anulada: solo lectura, sin «Agregar fotos» ni quitar', async () => {
    mocks.listarAdjuntos.mockResolvedValue([adjunto(1)])
    montar({ anulada: true })
    expect(await screen.findByText(/anulada: las fotos son de solo lectura/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Agregar fotos' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Ver foto-1.png' }))
    const dialogo = await screen.findByRole('dialog')
    expect(within(dialogo).queryByRole('button', { name: 'Quitar' })).toBeNull()
  })

  it('lectura: ve las fotos pero no agrega ni quita', async () => {
    mocks.listarAdjuntos.mockResolvedValue([adjunto(1)])
    montar({ puedeEditar: false })
    await screen.findByAltText('foto-1.png')
    expect(screen.queryByRole('button', { name: 'Agregar fotos' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Ver foto-1.png' }))
    expect(within(await screen.findByRole('dialog')).queryByRole('button', { name: 'Quitar' })).toBeNull()
  })

  it('lectura sin fotos: vacío sin invitación a agregar', async () => {
    montar({ puedeEditar: false })
    expect(await screen.findByText('Esta reparación no tiene fotos.')).toBeTruthy()
  })
})
