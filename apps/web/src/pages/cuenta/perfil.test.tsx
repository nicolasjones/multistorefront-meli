import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const auth = vi.hoisted(() => ({ getUser: vi.fn() }))
const maybeSingle = vi.hoisted(() => vi.fn())
const limit = vi.hoisted(() => vi.fn())
const order = vi.hoisted(() => vi.fn(() => ({ order, limit })))
const eq = vi.hoisted(() => vi.fn(() => ({ maybeSingle, order })))
const select = vi.hoisted(() => vi.fn(() => ({ eq })))
const upsert = vi.hoisted(() => vi.fn())
const from = vi.hoisted(() => vi.fn(() => ({ select, upsert })))
const upload = vi.hoisted(() => vi.fn())
const remove = vi.hoisted(() => vi.fn())
const download = vi.hoisted(() => vi.fn())
const createSignedUrl = vi.hoisted(() => vi.fn())
const storageFrom = vi.hoisted(() => vi.fn(() => ({ upload, remove, download, createSignedUrl })))

vi.mock('../../lib/supabase', () => ({
  supabaseClient: { auth, from, storage: { from: storageFrom } },
}))

import { PerfilPage } from './perfil'

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/cuenta/perfil']}>
      <Routes>
        <Route path="/cuenta/perfil" element={<PerfilPage />} />
        <Route path="/cuenta/cambiar-contrasena" element={<p>Cambio de contrasena</p>} />
        <Route path="/cuenta/cambiar-correo" element={<p>Cambio de correo</p>} />
        <Route path="/login" element={<p>Acceso requerido</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('PerfilPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    auth.getUser.mockResolvedValue({ data: { user: { id: 'user-1', email: 'persona@example.com' } }, error: null })
    maybeSingle.mockResolvedValue({ data: { nombre: 'Ada', apellido: 'Lovelace', foto_path: null }, error: null })
    limit.mockResolvedValue({ data: [], error: null })
    upsert.mockResolvedValue({ error: null })
    upload.mockResolvedValue({ error: null })
    remove.mockResolvedValue({ error: null })
    download.mockResolvedValue({ data: new Blob(['foto'], { type: 'image/png' }), error: null })
    createSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://storage.test/avatar' } })
  })

  it('carga los datos personales exclusivamente desde el perfil del titular', async () => {
    renderPage()
    expect(await screen.findByDisplayValue('Ada')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Lovelace')).toBeInTheDocument()
    expect(from).toHaveBeenCalledWith('perfiles_usuario')
    expect(eq).toHaveBeenCalledWith('user_id', 'user-1')
  })

  it('muestra solo los 20 avisos propios más recientes en orden descendente', async () => {
    limit.mockResolvedValue({
      data: [
        { id: 3, tipo: 'correo_modificado', created_at: '2026-09-10T12:00:00.000Z' },
        { id: 2, tipo: 'contrasena_modificada', created_at: '2026-09-10T11:00:00.000Z' },
        { id: 1, tipo: 'inicio_sesion', created_at: '2026-09-10T10:00:00.000Z' },
      ],
      error: null,
    })
    renderPage()

    expect(await screen.findByText(/correo modificado/)).toBeInTheDocument()
    expect(order).toHaveBeenNthCalledWith(1, 'created_at', { ascending: false })
    expect(order).toHaveBeenNthCalledWith(2, 'id', { ascending: false })
    expect(limit).toHaveBeenCalledWith(20)
    expect(from).toHaveBeenCalledWith('eventos_seguridad_usuario')
    expect(eq).toHaveBeenCalledWith('user_id', 'user-1')
  })

  it('muestra un estado vacío cuando no hay avisos de seguridad', async () => {
    renderPage()
    expect(await screen.findByText('Todavía no registramos acciones de seguridad para tu cuenta.')).toBeInTheDocument()
  })

  it('valida nombre y apellido obligatorios sin modificar el perfil', async () => {
    renderPage()
    await screen.findByLabelText(/^Nombre/)
    fireEvent.change(screen.getByLabelText(/^Nombre/), { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar datos personales' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Nombre y apellido son obligatorios.')
    expect(upsert).not.toHaveBeenCalled()
  })

  it('hace upsert con el identificador de la sesion y confirma el guardado', async () => {
    renderPage()
    await screen.findByLabelText(/^Nombre/)
    fireEvent.change(screen.getByLabelText(/^Nombre/), { target: { value: '  Grace ' } })
    fireEvent.change(screen.getByLabelText(/^Apellido/), { target: { value: ' Hopper  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar datos personales' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Tus datos personales fueron guardados.')
    expect(upsert).toHaveBeenCalledWith(
      { user_id: 'user-1', nombre: 'Grace', apellido: 'Hopper' },
      { onConflict: 'user_id' },
    )
  })

  it('redirige al acceso cuando no hay una sesion autenticada', async () => {
    auth.getUser.mockResolvedValue({ data: { user: null }, error: null })
    renderPage()
    expect(await screen.findByText('Acceso requerido')).toBeInTheDocument()
  })

  it('navega desde el perfil al flujo existente de cambio de contrasena', async () => {
    renderPage()

    fireEvent.click(await screen.findByRole('link', { name: 'Cambiar contraseña' }))

    expect(await screen.findByText('Cambio de contrasena')).toBeInTheDocument()
  })

  it('navega desde el perfil al flujo separado de cambio de correo', async () => {
    renderPage()

    fireEvent.click(await screen.findByRole('link', { name: 'Cambiar correo electrónico' }))

    expect(await screen.findByText('Cambio de correo')).toBeInTheDocument()
  })

  it('rechaza una foto invalida antes de enviarla a Storage', async () => {
    renderPage()
    const archivo = new File(['contenido'], 'perfil.gif', { type: 'image/gif' })
    fireEvent.change(await screen.findByLabelText('Cargar o reemplazar foto'), { target: { files: [archivo] } })

    expect(await screen.findByRole('alert')).toHaveTextContent('La foto debe ser JPG, PNG o WebP.')
    expect(upload).not.toHaveBeenCalled()
  })

  it('carga la foto en la ruta estable del titular y permite quitarla', async () => {
    renderPage()
    const archivo = new File(['imagen'], 'perfil.png', { type: 'image/png' })
    fireEvent.change(await screen.findByLabelText('Cargar o reemplazar foto'), { target: { files: [archivo] } })

    expect(await screen.findByRole('status')).toHaveTextContent('Tu foto de perfil fue actualizada.')
    expect(storageFrom).toHaveBeenCalledWith('fotos-perfil')
    expect(upload).toHaveBeenCalledWith('user-1/avatar', archivo, { upsert: true, contentType: 'image/png' })
    fireEvent.click(screen.getByRole('button', { name: 'Quitar foto' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Tu foto de perfil fue eliminada.')
    expect(remove).toHaveBeenCalledWith(['user-1/avatar'])
  })

  it('conserva la foto anterior si falla la persistencia del perfil tras cargar una nueva', async () => {
    maybeSingle.mockResolvedValue({ data: { nombre: 'Ada', apellido: 'Lovelace', foto_path: 'user-1/avatar' }, error: null })
    const respaldo = new Blob(['anterior'], { type: 'image/png' })
    download.mockResolvedValue({ data: respaldo, error: null })
    upsert.mockResolvedValueOnce({ error: { message: 'fallo temporal' } })
    renderPage()

    const archivo = new File(['imagen'], 'perfil.png', { type: 'image/png' })
    fireEvent.change(await screen.findByLabelText('Cargar o reemplazar foto'), { target: { files: [archivo] } })

    expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos actualizar tu perfil; conservamos tu foto anterior.')
    expect(upload).toHaveBeenNthCalledWith(1, 'user-1/avatar', archivo, { upsert: true, contentType: 'image/png' })
    expect(upload).toHaveBeenNthCalledWith(2, 'user-1/avatar', respaldo, { upsert: true, contentType: respaldo.type })
    expect(screen.getByRole('button', { name: 'Quitar foto' })).toBeInTheDocument()
  })

  it('conserva la foto anterior si falla la persistencia del perfil tras eliminarla', async () => {
    maybeSingle.mockResolvedValue({ data: { nombre: 'Ada', apellido: 'Lovelace', foto_path: 'user-1/avatar' }, error: null })
    const respaldo = new Blob(['anterior'], { type: 'image/png' })
    download.mockResolvedValue({ data: respaldo, error: null })
    upsert.mockResolvedValueOnce({ error: { message: 'fallo temporal' } })
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'Quitar foto' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos actualizar tu perfil; conservamos tu foto anterior.')
    expect(remove).toHaveBeenCalledWith(['user-1/avatar'])
    expect(upload).toHaveBeenCalledWith('user-1/avatar', respaldo, { upsert: true, contentType: respaldo.type })
    expect(screen.getByRole('button', { name: 'Quitar foto' })).toBeInTheDocument()
  })
})
