import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PermisoSeccion } from '../lib/permisos'

// MSF-855: el repedido de permisos de la MISMA clave `usuario:organización` falla con un formulario abierto. Se usa el
// PermisosPanelProvider y useNivelSeccion REALES (solo se simula el pedido y la identidad) para probar el contrato
// completo: formulario montado e inerte, aviso, borrador conservado, y descarte si la clave cambia.
const mocks = vi.hoisted(() => ({
  useGetIdentity: vi.fn(),
  useContextoPanel: vi.fn(),
  obtenerPermisosActuales: vi.fn(),
  useIsSuperadmin: vi.fn(),
  useOrganizacionDeTrabajo: vi.fn(),
  resolverRolId: vi.fn(),
}))

vi.mock('@refinedev/core', () => ({ useGetIdentity: mocks.useGetIdentity }))
vi.mock('../context/ContextoPanel', () => ({ useContextoPanel: mocks.useContextoPanel }))
vi.mock('../lib/permisos', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/permisos')>()),
  obtenerPermisosActuales: mocks.obtenerPermisosActuales,
}))
vi.mock('../hooks/useIsSuperadmin', () => ({ useIsSuperadmin: mocks.useIsSuperadmin }))
vi.mock('../hooks/useOrganizacionDeTrabajo', () => ({ useOrganizacionDeTrabajo: mocks.useOrganizacionDeTrabajo }))
vi.mock('../lib/rolActual', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/rolActual')>()),
  resolverRolId: mocks.resolverRolId,
}))

import { PermisosPanelProvider, usePermisosPanel } from '../context/PermisosPanel'
import { useNivelSeccion } from '../hooks/useNivelSeccion'
import { RequiereAccesoSeccion } from './RequiereAccesoSeccion'

const fila = (nivel: 'edicion' | 'lectura' | 'ninguno', seccion = 'ventas'): PermisoSeccion => ({
  seccion,
  nivel,
  eliminar: false,
  exportar: false,
  ver_costos: false,
})

const guardar = vi.fn()
let montajes = 0

// Formulario largo con su borrador en estado local, como las pantallas reales. Lee el nivel con el hook real.
function Formulario({ conPortal = false }: { conPortal?: boolean }) {
  const { nivel, sinConfirmar } = useNivelSeccion('ventas')
  const [nombre, setNombre] = useState('')
  useState(() => { montajes += 1 })
  const puedeEditar = nivel === 'edicion'
  return (
    <form
      onSubmit={(evento) => {
        evento.preventDefault()
        if (puedeEditar) guardar(nombre)
      }}
    >
      <label>
        Nombre
        <input value={nombre} onChange={(evento) => setNombre(evento.target.value)} />
      </label>
      <p data-testid="nivel">{`nivel=${nivel}${sinConfirmar ? ' sinConfirmar' : ''}`}</p>
      <button type="submit">Guardar</button>
      {conPortal ? createPortal(<button type="button" onClick={() => guardar('desde-portal')}>Guardar desde diálogo</button>, document.body) : null}
    </form>
  )
}

function Recargador() {
  const valor = usePermisosPanel()
  return <button onClick={() => valor?.recargar()}>recargar-externo</button>
}

function Arbol({ hijos }: { hijos?: ReactNode }) {
  return (
    <MemoryRouter>
      <PermisosPanelProvider>
        <Recargador />
        <RequiereAccesoSeccion seccion="ventas">{hijos ?? <Formulario />}</RequiereAccesoSeccion>
      </PermisosPanelProvider>
    </MemoryRouter>
  )
}

function organizacion(id: string) {
  mocks.useContextoPanel.mockReturnValue({ contexto: { organizacion_id: id } })
  mocks.useOrganizacionDeTrabajo.mockReturnValue({ organizacionId: id, isLoading: false })
}

// Abre el formulario con edición, tipea un borrador y deja fallar el siguiente repedido de la MISMA clave.
async function abrirYFallar(hijos?: ReactNode) {
  mocks.obtenerPermisosActuales.mockResolvedValueOnce([fila('edicion')])
  const vista = render(<Arbol hijos={hijos} />)
  const campo = await screen.findByLabelText('Nombre')
  fireEvent.change(campo, { target: { value: 'Joystick inalámbrico' } })
  expect(campo).toHaveValue('Joystick inalámbrico')
  mocks.obtenerPermisosActuales.mockRejectedValueOnce(new Error('red caída'))
  fireEvent.click(screen.getByRole('button', { name: 'recargar-externo' }))
  await screen.findByText('No pudimos verificar tus permisos.')
  return { vista, campo }
}

describe('RequiereAccesoSeccion: reintentar sin perder el borrador (MSF-855)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    montajes = 0
    guardar.mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.useGetIdentity.mockReturnValue({ data: { id: 'u1' } })
    mocks.useIsSuperadmin.mockReturnValue({ isSuperadmin: false, isLoading: false })
    mocks.resolverRolId.mockResolvedValue('operador')
    organizacion('o1')
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('misma clave + falla: el formulario sigue montado (mismo nodo), inerte, con aviso y borrador', async () => {
    const { campo } = await abrirYFallar()

    expect(screen.getByLabelText('Nombre')).toBe(campo)
    expect(campo).toHaveValue('Joystick inalámbrico')
    expect(montajes).toBe(1)
    const zona = campo.closest('fieldset')
    expect(zona).toBeDisabled()
    expect(zona).toHaveAttribute('inert')
    expect(campo).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled()
    expect(screen.getByRole('note')).toHaveTextContent('No pudimos verificar tus permisos.')
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeEnabled()
    // El último nivel confirmado se le da al formulario (para no desmontarlo) pero marcado sin confirmar.
    expect(screen.getByTestId('nivel')).toHaveTextContent('nivel=edicion sinConfirmar')
  })

  it('el aviso va en una región viva que ya existía antes del texto y no roba el foco', async () => {
    mocks.obtenerPermisosActuales.mockResolvedValueOnce([fila('edicion')])
    const { container } = render(<Arbol />)
    const campo = await screen.findByLabelText('Nombre')
    const region = container.querySelector('[aria-live="polite"]')
    expect(region).not.toBeNull()
    expect(region).toBeEmptyDOMElement()
    campo.focus()
    mocks.obtenerPermisosActuales.mockRejectedValueOnce(new Error('red caída'))
    fireEvent.click(screen.getByRole('button', { name: 'recargar-externo' }))
    await screen.findByText('No pudimos verificar tus permisos.')
    expect(container.querySelector('[aria-live="polite"]')).toBe(region)
    expect(region).toHaveTextContent('No pudimos verificar tus permisos.')
    // Se enfocó el campo antes del fallo: el aviso no mueve el foco hacia sí.
    expect(region?.contains(document.activeElement)).toBe(false)
  })

  it('mientras no se confirma el nivel NADA se guarda ni se edita (clic, Enter, envío, teclado, portal)', async () => {
    const { campo } = await abrirYFallar(<Formulario conPortal />)

    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    fireEvent.submit(campo.closest('form')!)
    fireEvent.keyDown(campo, { key: 'Enter' })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar desde diálogo' }))
    fireEvent.change(campo, { target: { value: 'otro texto' } })
    expect(guardar).not.toHaveBeenCalled()
    expect(campo).toHaveValue('Joystick inalámbrico')
  })

  it('«Reintentar» con éxito habilita con el nivel real y conserva lo tipeado (mismo nodo)', async () => {
    const { campo } = await abrirYFallar()
    let resolver: (permisos: PermisoSeccion[]) => void = () => {}
    mocks.obtenerPermisosActuales.mockReturnValueOnce(new Promise<PermisoSeccion[]>((aceptar) => { resolver = aceptar }))

    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    // Verificando: sigue montado e inerte; no se dispara un segundo pedido con otro clic.
    expect(await screen.findByText('Verificando tu acceso…')).toBeInTheDocument()
    expect(screen.getByLabelText('Nombre')).toBe(campo)
    expect(campo).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(mocks.obtenerPermisosActuales).toHaveBeenCalledTimes(3)
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(guardar).not.toHaveBeenCalled()

    await act(async () => { resolver([fila('edicion')]) })
    await waitFor(() => expect(screen.queryByText('No pudimos verificar tus permisos.')).not.toBeInTheDocument())
    expect(screen.getByLabelText('Nombre')).toBe(campo)
    expect(campo).toBeEnabled()
    expect(campo).toHaveValue('Joystick inalámbrico')
    expect(montajes).toBe(1)
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(guardar).toHaveBeenCalledWith('Joystick inalámbrico')
  })

  it('el reintento que confirma «lectura» no deja guardar (el formulario ve lectura)', async () => {
    const { campo } = await abrirYFallar()
    mocks.obtenerPermisosActuales.mockResolvedValueOnce([fila('lectura')])
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))

    await waitFor(() => expect(screen.getByTestId('nivel')).toHaveTextContent('nivel=lectura'))
    expect(screen.queryByText('No pudimos verificar tus permisos.')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Nombre')).toBe(campo)
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    fireEvent.submit(campo.closest('form')!)
    expect(guardar).not.toHaveBeenCalled()
  })

  it('el reintento que confirma «ninguno» bloquea la sección: no hay formulario ni envío', async () => {
    await abrirYFallar()
    mocks.obtenerPermisosActuales.mockResolvedValueOnce([fila('ninguno')])
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Sección no disponible para tu rol')
    expect(screen.queryByLabelText('Nombre')).not.toBeInTheDocument()
    expect(guardar).not.toHaveBeenCalled()
  })

  it('un error persistente no reintenta solo: solo pide de nuevo con «Reintentar»', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    mocks.obtenerPermisosActuales.mockRejectedValue(new Error('sigue caída'))
    await abrirYFallar()
    const pedidosAntes = mocks.obtenerPermisosActuales.mock.calls.length
    await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60_000) })
    expect(mocks.obtenerPermisosActuales.mock.calls.length).toBe(pedidosAntes)

    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60_000) })
    expect(mocks.obtenerPermisosActuales.mock.calls.length).toBe(pedidosAntes + 1)
    // Sigue inerte, con el borrador y el aviso.
    expect(screen.getByLabelText('Nombre')).toHaveValue('Joystick inalámbrico')
    expect(screen.getByLabelText('Nombre')).toBeDisabled()
    expect(screen.getByRole('note')).toBeInTheDocument()
  })

  describe('si la clave usuario:organización CAMBIÓ no se conserva ni se ve el borrador', () => {
    it('otra organización (con carga demorada): se desmonta y no aparece el borrador anterior', async () => {
      mocks.obtenerPermisosActuales.mockResolvedValueOnce([fila('edicion')])
      const vista = render(<Arbol />)
      fireEvent.change(await screen.findByLabelText('Nombre'), { target: { value: 'Borrador de la org 1' } })

      let resolver: (permisos: PermisoSeccion[]) => void = () => {}
      mocks.obtenerPermisosActuales.mockReturnValueOnce(new Promise<PermisoSeccion[]>((aceptar) => { resolver = aceptar }))
      organizacion('o2')
      vista.rerender(<Arbol />)
      await waitFor(() => expect(screen.queryByLabelText('Nombre')).not.toBeInTheDocument())
      expect(screen.queryByDisplayValue('Borrador de la org 1')).not.toBeInTheDocument()

      await act(async () => { resolver([fila('edicion')]) })
      // El formulario de la nueva organización es nuevo y vacío.
      expect(await screen.findByLabelText('Nombre')).toHaveValue('')
      expect(screen.queryByDisplayValue('Borrador de la org 1')).not.toBeInTheDocument()
      expect(montajes).toBe(2)
    })

    it('otra organización y el repedido falla: sin formulario ni borrador (falla cerrada, aviso que desmonta)', async () => {
      mocks.obtenerPermisosActuales.mockResolvedValueOnce([fila('edicion')])
      const vista = render(<Arbol />)
      fireEvent.change(await screen.findByLabelText('Nombre'), { target: { value: 'Borrador de la org 1' } })

      mocks.obtenerPermisosActuales.mockRejectedValueOnce(new Error('red caída'))
      organizacion('o2')
      vista.rerender(<Arbol />)

      expect(await screen.findByText('No pudimos verificar tus permisos.')).toBeInTheDocument()
      expect(screen.queryByLabelText('Nombre')).not.toBeInTheDocument()
      expect(screen.queryByDisplayValue('Borrador de la org 1')).not.toBeInTheDocument()
      expect(screen.queryByRole('note')).not.toBeInTheDocument()
    })

    it('volver a la organización original tras un fallo ajeno no resucita el borrador', async () => {
      mocks.obtenerPermisosActuales.mockResolvedValueOnce([fila('edicion')])
      const vista = render(<Arbol />)
      fireEvent.change(await screen.findByLabelText('Nombre'), { target: { value: 'Borrador de la org 1' } })

      mocks.obtenerPermisosActuales.mockRejectedValueOnce(new Error('red caída'))
      organizacion('o2')
      vista.rerender(<Arbol />)
      await screen.findByText('No pudimos verificar tus permisos.')

      mocks.obtenerPermisosActuales.mockRejectedValueOnce(new Error('red caída'))
      organizacion('o1')
      vista.rerender(<Arbol />)
      await screen.findByText('No pudimos verificar tus permisos.')
      expect(screen.queryByLabelText('Nombre')).not.toBeInTheDocument()
      expect(screen.queryByDisplayValue('Borrador de la org 1')).not.toBeInTheDocument()
    })

    it('otro usuario en la misma organización: tampoco se conserva', async () => {
      mocks.obtenerPermisosActuales.mockResolvedValueOnce([fila('edicion')])
      const vista = render(<Arbol />)
      fireEvent.change(await screen.findByLabelText('Nombre'), { target: { value: 'Borrador de u1' } })

      mocks.obtenerPermisosActuales.mockRejectedValueOnce(new Error('red caída'))
      mocks.useGetIdentity.mockReturnValue({ data: { id: 'u2' } })
      vista.rerender(<Arbol />)

      expect(await screen.findByText('No pudimos verificar tus permisos.')).toBeInTheDocument()
      expect(screen.queryByDisplayValue('Borrador de u1')).not.toBeInTheDocument()
      expect(screen.queryByLabelText('Nombre')).not.toBeInTheDocument()
    })
  })

  it('un fallo con la sección que nunca se abrió sigue siendo el aviso que desmonta (nada que conservar)', async () => {
    mocks.obtenerPermisosActuales.mockRejectedValueOnce(new Error('red caída'))
    render(<Arbol />)
    expect(await screen.findByText('No pudimos verificar tus permisos.')).toBeInTheDocument()
    expect(screen.queryByLabelText('Nombre')).not.toBeInTheDocument()
    expect(screen.queryByRole('note')).not.toBeInTheDocument()
  })

  it('fuera de la sección que conserva el borrador, el hook sigue devolviendo nivel null ante el fallo', async () => {
    function FueraDeLaSeccion() {
      const { nivel } = useNivelSeccion('ventas')
      return <p data-testid="fuera">{`fuera nivel=${nivel}`}</p>
    }
    mocks.obtenerPermisosActuales.mockResolvedValueOnce([fila('edicion')])
    render(
      <MemoryRouter>
        <PermisosPanelProvider>
          <Recargador />
          <FueraDeLaSeccion />
          <RequiereAccesoSeccion seccion="ventas"><Formulario /></RequiereAccesoSeccion>
        </PermisosPanelProvider>
      </MemoryRouter>,
    )
    await screen.findByLabelText('Nombre')
    mocks.obtenerPermisosActuales.mockRejectedValueOnce(new Error('red caída'))
    fireEvent.click(screen.getByRole('button', { name: 'recargar-externo' }))
    await screen.findByRole('note')
    expect(screen.getByTestId('fuera')).toHaveTextContent('fuera nivel=null')
  })
})
