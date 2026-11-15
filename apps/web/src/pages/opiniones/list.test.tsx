import { MemoryRouter } from 'react-router'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { violacionesAxe } from '../../test/axe'

vi.setConfig({ testTimeout: 20000 })

const mocks = vi.hoisted(() => ({
  useFiltroPorEmpresaActiva: vi.fn(),
  listarOpiniones: vi.fn(),
  moderarOpinion: vi.fn(),
  leerBanderaOpiniones: vi.fn(),
  elegirEmpresa: vi.fn(),
}))

vi.mock('../../hooks/useFiltroPorEmpresaActiva', () => ({ useFiltroPorEmpresaActiva: mocks.useFiltroPorEmpresaActiva }))
vi.mock('../../hooks/useOrganizacionActiva', () => ({ useOrganizacionActiva: () => ({ organizacionActiva: { id: 'org-1' } }) }))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))
vi.mock('../../lib/opiniones', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/opiniones')>()),
  listarOpiniones: mocks.listarOpiniones,
  moderarOpinion: mocks.moderarOpinion,
  leerBanderaOpiniones: mocks.leerBanderaOpiniones,
}))

import { OpinionesList } from './list'
import { DESTINOS_PANEL } from '../../components/navegacion/destinosPanel'

const OP1 = {
  id: 'o-1', empresa_id: 'e-1', empresa_nombre: 'San Javucho', cliente_id: 'c-1', cliente_nombre: 'Valeria Sánchez',
  producto_id: 'p-1', producto_nombre: 'Vidrio templado', puntuacion: 5, comentario: 'Llegó rapidísimo y quedó perfecto.',
  estado: 'pendiente', motivo_rechazo: null, creada_en: '2027-03-10T10:00:00Z', actualizada_en: '2027-03-10T10:00:00Z',
}
const OP2 = { ...OP1, id: 'o-2', empresa_id: 'e-2', empresa_nombre: 'Mundo JC', cliente_nombre: 'Bruno Díaz', puntuacion: 1, comentario: 'Mensaje con enlaces a otro sitio.', estado: 'aceptada' }
const OP3 = { ...OP1, id: 'o-3', cliente_nombre: 'Pablo Fernández', estado: 'rechazada', motivo_rechazo: 'No coincidía' }

const CONTADORES = { pendientes: 3, aceptadas: 1, rechazadas: 1 }
const tanda = (filas: unknown[], siguiente: unknown = null, contadores = CONTADORES) => ({ contadores, filas, siguiente })

const FILTROS = {
  empresas: [{ id: 'e-1', nombre: 'San Javucho' }, { id: 'e-2', nombre: 'Mundo JC' }],
  valor: null as string | null,
  cambiar: mocks.elegirEmpresa,
  empresaActivaId: null as string | null,
  cargando: false,
  hayError: false,
}

const abrir = () => render(<MemoryRouter><OpinionesList /></MemoryRouter>)

describe('pantalla Opiniones', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.useFiltroPorEmpresaActiva.mockReturnValue(FILTROS)
    mocks.leerBanderaOpiniones.mockResolvedValue(true)
    mocks.listarOpiniones.mockResolvedValue(tanda([OP1]))
    mocks.moderarOpinion.mockResolvedValue({ estado: 'ok' })
  })

  it('muestra el aviso, los contadores y la lista pendiente por defecto', async () => {
    abrir()
    expect(await screen.findByText('Llegó rapidísimo y quedó perfecto.')).toBeTruthy()
    expect(screen.getByText(/Las opiniones nuevas quedan pendientes hasta que las aceptes o rechazes/)).toBeTruthy()
    const resumen = screen.getByRole('group', { name: 'Resumen de opiniones' })
    expect(within(resumen).getByText('3')).toBeTruthy()
    expect(screen.getByText('Valeria Sánchez')).toBeTruthy()
    expect(screen.getByText('5 sobre 5')).toBeTruthy()
    expect(screen.getByText('Sobre: Vidrio templado')).toBeTruthy()
    expect(mocks.listarOpiniones.mock.calls[0][0]).toMatchObject({ estado: 'pendiente', empresaId: null })
    // Con «Todas las tiendas» cada fila indica su tienda.
    expect(screen.getByText('San Javucho', { selector: '.MuiChip-label' })).toBeTruthy()
  })

  it('cada botón se oculta cuando ya es el estado actual', async () => {
    mocks.listarOpiniones.mockResolvedValue(tanda([OP1, OP2, OP3]))
    abrir()
    await screen.findByText('Bruno Díaz')
    expect(screen.queryByRole('button', { name: /Aceptar la opinión de Bruno/ })).toBeNull()
    expect(screen.getByRole('button', { name: /Rechazar la opinión de Bruno/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Rechazar la opinión de Pablo/ })).toBeNull()
    expect(screen.getByRole('button', { name: /Aceptar la opinión de Pablo/ })).toBeTruthy()
    expect(screen.getByText('Motivo del rechazo: No coincidía')).toBeTruthy()
  })

  it('cambiar de filtro reinicia la lista con el estado elegido', async () => {
    abrir()
    await screen.findByText('Valeria Sánchez')
    fireEvent.click(screen.getByRole('button', { name: 'Aceptadas' }))
    await waitFor(() => expect(mocks.listarOpiniones.mock.calls.at(-1)![0]).toMatchObject({ estado: 'aceptada', empresaId: null }))
    expect(mocks.listarOpiniones.mock.calls.at(-1)![0].desde).toBeUndefined()
  })

  it('acepta con la fecha vista, avisa y recarga la lista y los contadores', async () => {
    abrir()
    fireEvent.click(await screen.findByRole('button', { name: /Aceptar la opinión de Valeria/ }))
    await waitFor(() => expect(mocks.moderarOpinion).toHaveBeenCalledWith({ id: 'o-1', decision: 'aceptar', motivo: undefined, actualizadaEn: OP1.actualizada_en }))
    expect(await screen.findByText('Opinión aceptada')).toBeTruthy()
    await waitFor(() => expect(mocks.listarOpiniones).toHaveBeenCalledTimes(2))
  })

  it('rechaza desde un diálogo con motivo opcional', async () => {
    abrir()
    fireEvent.click(await screen.findByRole('button', { name: /Rechazar la opinión de Valeria/ }))
    const dialogo = await screen.findByRole('dialog', { name: 'Rechazar opinión' })
    fireEvent.change(within(dialogo).getByLabelText('Motivo (opcional)'), { target: { value: '  Contenido ajeno  ' } })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Rechazar' }))
    await waitFor(() => expect(mocks.moderarOpinion).toHaveBeenCalledWith({ id: 'o-1', decision: 'rechazar', motivo: 'Contenido ajeno', actualizadaEn: OP1.actualizada_en }))
    expect(await screen.findByText('Opinión rechazada')).toBeTruthy()
  })

  it('rechaza sin motivo y no deja pasar un motivo de más de 200 caracteres', async () => {
    abrir()
    fireEvent.click(await screen.findByRole('button', { name: /Rechazar la opinión de Valeria/ }))
    const dialogo = await screen.findByRole('dialog', { name: 'Rechazar opinión' })
    fireEvent.change(within(dialogo).getByLabelText('Motivo (opcional)'), { target: { value: 'x'.repeat(201) } })
    expect((within(dialogo).getByRole('button', { name: 'Rechazar' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(within(dialogo).getByLabelText('Motivo (opcional)'), { target: { value: '' } })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Rechazar' }))
    await waitFor(() => expect(mocks.moderarOpinion).toHaveBeenCalledWith(expect.objectContaining({ decision: 'rechazar', motivo: null })))
  })

  it('un conflicto avisa, no pisa la decisión del otro administrador y recarga', async () => {
    mocks.moderarOpinion.mockRejectedValue({ code: '40001' })
    abrir()
    fireEvent.click(await screen.findByRole('button', { name: /Aceptar la opinión de Valeria/ }))
    expect(await screen.findByText(/La opinión cambió mientras la mirabas/)).toBeTruthy()
    await waitFor(() => expect(mocks.listarOpiniones).toHaveBeenCalledTimes(2))
  })

  it('con la bandera apagada avisa y solo permite rechazar', async () => {
    mocks.leerBanderaOpiniones.mockResolvedValue(false)
    abrir()
    expect(await screen.findByText(/Las opiniones están desactivadas en este entorno: por ahora solo podés rechazar/)).toBeTruthy()
    const aceptar = await screen.findByRole('button', { name: /Aceptar la opinión de Valeria/ })
    expect((aceptar as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: /Rechazar la opinión de Valeria/ }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('carga infinita: «Cargar más» pide la tanda siguiente con el cursor y no repite filas', async () => {
    mocks.listarOpiniones
      .mockResolvedValueOnce(tanda([OP1], { creada: '2027-03-10T10:00:00Z', id: 'o-1' }))
      .mockResolvedValueOnce(tanda([OP1, OP3]))
    abrir()
    await screen.findByText('Valeria Sánchez')
    fireEvent.click(await screen.findByRole('button', { name: /Cargar más/ }))
    expect(await screen.findByText('Pablo Fernández')).toBeTruthy()
    expect(mocks.listarOpiniones.mock.calls[1][0].desde).toEqual({ creada: '2027-03-10T10:00:00Z', id: 'o-1' })
    expect(screen.getAllByText('Valeria Sánchez')).toHaveLength(1)
  })

  it('error con reintento y estado vacío', async () => {
    mocks.listarOpiniones.mockRejectedValueOnce({ code: 'XX000' })
    abrir()
    fireEvent.click(await screen.findByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByText('Valeria Sánchez')).toBeTruthy()
  })

  it('sin opiniones muestra el estado vacío', async () => {
    mocks.listarOpiniones.mockResolvedValue(tanda([], null, { pendientes: 0, aceptadas: 0, rechazadas: 0 }))
    abrir()
    expect(await screen.findByText('No hay opiniones pendientes.')).toBeTruthy()
  })

  it('un usuario sin permiso ve el aviso y no la lista', async () => {
    mocks.listarOpiniones.mockRejectedValue({ code: '42501' })
    abrir()
    expect(await screen.findByText('Solo un Administrador puede moderar opiniones.')).toBeTruthy()
  })

  it('con la tienda elegida pide solo esa tienda y no repite el chip de tienda en cada fila', async () => {
    mocks.useFiltroPorEmpresaActiva.mockReturnValue({ ...FILTROS, valor: 'e-2', empresaActivaId: 'e-2' })
    abrir()
    await screen.findByText('Valeria Sánchez')
    expect(mocks.listarOpiniones.mock.calls[0][0]).toMatchObject({ empresaId: 'e-2' })
    expect(screen.queryByText('San Javucho', { selector: '.MuiChip-label' })).toBeNull()
  })

  it('cambiar la empresa activa con el diálogo abierto recarga lista y contadores, reinicia la tanda y cierra el diálogo con aviso', async () => {
    const CONT_A = { pendientes: 7, aceptadas: 2, rechazadas: 1 }
    const CONT_B = { pendientes: 4, aceptadas: 9, rechazadas: 6 }
    mocks.listarOpiniones.mockImplementation(async ({ empresaId }: { empresaId: string | null }) =>
      empresaId === 'e-2' ? tanda([OP2], null, CONT_B) : tanda([OP1], { creada: '2027-03-10T10:00:00Z', id: 'o-1' }, CONT_A))
    const vista = abrir()
    fireEvent.click(await screen.findByRole('button', { name: /Rechazar la opinión de Valeria/ }))
    await screen.findByRole('dialog', { name: 'Rechazar opinión' })
    const resumenAntes = screen.getByRole('group', { name: 'Resumen de opiniones', hidden: true })
    expect(within(resumenAntes).getByText('7')).toBeTruthy()
    const llamadas = mocks.listarOpiniones.mock.calls.length
    mocks.useFiltroPorEmpresaActiva.mockReturnValue({ ...FILTROS, valor: 'e-2', empresaActivaId: 'e-2' })
    await act(async () => { vista.rerender(<MemoryRouter><OpinionesList /></MemoryRouter>) })
    await waitFor(() => expect(mocks.listarOpiniones.mock.calls.length).toBeGreaterThan(llamadas))
    const ultima = mocks.listarOpiniones.mock.calls.at(-1)![0]
    expect(ultima).toMatchObject({ empresaId: 'e-2' })
    expect(ultima.desde).toBeUndefined()
    // Los contadores y la lista mostrados son los de la tienda nueva, no los de la anterior.
    const resumen = await screen.findByRole('group', { name: 'Resumen de opiniones', hidden: true })
    await waitFor(() => expect(within(resumen).getByText('9')).toBeTruthy())
    expect(within(resumen).getByText('4')).toBeTruthy()
    expect(within(resumen).getByText('6')).toBeTruthy()
    expect(within(resumen).queryByText('7')).toBeNull()
    expect(await screen.findByText('Bruno Díaz')).toBeTruthy()
    expect(screen.queryByText('Valeria Sánchez')).toBeNull()
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Rechazar opinión' })).toBeNull())
    expect(await screen.findByText(/Cambiaste de tienda: cerramos el diálogo sin rechazar la opinión/)).toBeTruthy()
    expect(mocks.moderarOpinion).not.toHaveBeenCalled()
  })

  it('el motivo se normaliza antes de enviar: saltos y espacios múltiples pasan a un espacio', async () => {
    abrir()
    fireEvent.click(await screen.findByRole('button', { name: /Rechazar la opinión de Valeria/ }))
    const dialogo = await screen.findByRole('dialog', { name: 'Rechazar opinión' })
    expect(within(dialogo).getByLabelText('Motivo (opcional)').tagName).toBe('INPUT')
    fireEvent.change(within(dialogo).getByLabelText('Motivo (opcional)'), { target: { value: '  Contenido   ajeno \t al    producto  ' } })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Rechazar' }))
    await waitFor(() => expect(mocks.moderarOpinion).toHaveBeenCalledWith(expect.objectContaining({ decision: 'rechazar', motivo: 'Contenido ajeno al producto' })))
  })

  it('el contador del motivo cuenta caracteres como el servidor (un emoji es uno) y el recorte', async () => {
    abrir()
    fireEvent.click(await screen.findByRole('button', { name: /Rechazar la opinión de Valeria/ }))
    const dialogo = await screen.findByRole('dialog', { name: 'Rechazar opinión' })
    fireEvent.change(within(dialogo).getByLabelText('Motivo (opcional)'), { target: { value: `  ${'😀'.repeat(150)}  ` } })
    expect(within(dialogo).getByText('150/200')).toBeTruthy()
    expect((within(dialogo).getByRole('button', { name: 'Rechazar' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('al aceptar una opinión que ya no existe avisa y recarga', async () => {
    mocks.moderarOpinion.mockResolvedValue({ estado: 'no_encontrada' })
    abrir()
    fireEvent.click(await screen.findByRole('button', { name: /Aceptar la opinión de Valeria/ }))
    expect(await screen.findByText('La opinión ya no existe. Recargamos la lista.')).toBeTruthy()
    expect(screen.queryByText('Opinión aceptada')).toBeNull()
    await waitFor(() => expect(mocks.listarOpiniones).toHaveBeenCalledTimes(2))
  })

  it('si el servidor responde 55000 al aceptar, avisa que las opiniones están desactivadas', async () => {
    mocks.moderarOpinion.mockRejectedValue({ code: '55000' })
    abrir()
    fireEvent.click(await screen.findByRole('button', { name: /Aceptar la opinión de Valeria/ }))
    expect(await screen.findByText('Las opiniones están desactivadas en este entorno: por ahora solo se pueden rechazar.')).toBeTruthy()
    expect(screen.queryByText('Opinión aceptada')).toBeNull()
  })

  it('un motivo con caracteres no permitidos (22023) no se presenta como un problema de largo', async () => {
    mocks.moderarOpinion.mockRejectedValue({ code: '22023', message: 'El motivo tiene caracteres no permitidos (saltos de línea, enlaces o marcas ocultas)' })
    abrir()
    fireEvent.click(await screen.findByRole('button', { name: /Rechazar la opinión de Valeria/ }))
    const dialogo = await screen.findByRole('dialog', { name: 'Rechazar opinión' })
    fireEvent.change(within(dialogo).getByLabelText('Motivo (opcional)'), { target: { value: 'Mirá http://spam.example' } })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Rechazar' }))
    expect(await screen.findByText(/caracteres no permitidos/)).toBeTruthy()
    expect(screen.queryByText(/hasta 200/)).toBeNull()
  })

  it('si falla «Cargar más» muestra el error sin perder lo ya cargado y deja reintentar', async () => {
    mocks.listarOpiniones
      .mockResolvedValueOnce(tanda([OP1], { creada: '2027-03-10T10:00:00Z', id: 'o-1' }))
      .mockRejectedValueOnce({ code: 'XX000' })
      .mockResolvedValueOnce(tanda([OP3]))
    abrir()
    await screen.findByText('Valeria Sánchez')
    fireEvent.click(await screen.findByRole('button', { name: /Cargar más/ }))
    const reintentar = await screen.findByRole('button', { name: 'Reintentar' })
    expect(screen.getByText('Valeria Sánchez')).toBeTruthy()
    fireEvent.click(reintentar)
    expect(await screen.findByText('Pablo Fernández')).toBeTruthy()
    expect(mocks.listarOpiniones.mock.calls[2][0].desde).toEqual({ creada: '2027-03-10T10:00:00Z', id: 'o-1' })
  })

  it('cambiar de tienda limpia los avisos de la tienda anterior', async () => {
    mocks.moderarOpinion.mockResolvedValueOnce({ estado: 'ok' })
    const vista = abrir()
    fireEvent.click(await screen.findByRole('button', { name: /Aceptar la opinión de Valeria/ }))
    expect(await screen.findByText('Opinión aceptada')).toBeTruthy()
    mocks.useFiltroPorEmpresaActiva.mockReturnValue({ ...FILTROS, valor: 'e-2', empresaActivaId: 'e-2' })
    await act(async () => { vista.rerender(<MemoryRouter><OpinionesList /></MemoryRouter>) })
    await waitFor(() => expect(screen.queryByText('Opinión aceptada')).toBeNull())
  })

  it('no tiene violaciones de accesibilidad', async () => {
    const { container } = abrir()
    await screen.findByText('Valeria Sánchez')
    expect(await violacionesAxe(container)).toEqual([])
  })

  it('«Opiniones» es un destino solo para el Administrador, en Canales', () => {
    const destino = DESTINOS_PANEL.find((d) => d.id === 'opiniones')
    expect(destino).toMatchObject({ etiqueta: 'Opiniones', ruta: '/opiniones', audiencia: 'administrador' })
  })
})
