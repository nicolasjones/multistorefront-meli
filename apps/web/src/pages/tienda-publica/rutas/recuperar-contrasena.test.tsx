import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Outlet, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { violacionesAxe } from '../../../test/axe'

const solicitarRecuperacionCliente = vi.hoisted(() => vi.fn())

vi.mock('../../../lib/tiendaCuenta', async (original) => ({
  ...(await original<typeof import('../../../lib/tiendaCuenta')>()),
  solicitarRecuperacionCliente,
}))

import { AVISO_RECUPERACION } from '../../../lib/tiendaCuenta'
import RutaRecuperarContrasena from './recuperar-contrasena'

const contexto = { tienda: { tiendaId: 't-1', empresaNombre: 'Mundo JC', estado: 'publicada' }, host: 'mundojc.localhost', categorias: { fase: 'lista', categorias: [], reintentar: () => undefined } }

function montar() {
  return render(
    <MemoryRouter initialEntries={['/recuperar-contrasena']}>
      <Routes>
        <Route element={<Outlet context={contexto} />}>
          <Route path="/recuperar-contrasena" element={<RutaRecuperarContrasena />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

async function pedir(correo: string) {
  fireEvent.change(screen.getByLabelText(/^Correo/), { target: { value: correo } })
  fireEvent.click(screen.getByRole('button', { name: 'Enviar enlace' }))
  await screen.findByRole('alert')
}

describe('RutaRecuperarContrasena (FR-023)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('pide la recuperación para el host de la tienda y muestra el aviso uniforme', async () => {
    solicitarRecuperacionCliente.mockResolvedValue(true)
    montar()
    await pedir('cli@example.com')
    expect(solicitarRecuperacionCliente).toHaveBeenCalledWith('mundojc.localhost', 'cli@example.com')
    expect(screen.getByText(AVISO_RECUPERACION)).toBeInTheDocument()
  })

  it('el aviso es idéntico para un correo sin cuenta', async () => {
    solicitarRecuperacionCliente.mockResolvedValue(true)
    montar()
    await pedir('nadie@example.com')
    expect(screen.getByRole('alert')).toHaveTextContent(AVISO_RECUPERACION)
  })

  it('si el pedido falla muestra un error y no el aviso', async () => {
    solicitarRecuperacionCliente.mockResolvedValue(false)
    montar()
    await pedir('cli@example.com')
    expect(screen.getByRole('alert')).toHaveTextContent('No pudimos enviar el enlace ahora.')
    expect(screen.queryByText(AVISO_RECUPERACION)).not.toBeInTheDocument()
  })

  it('no tiene violaciones de accesibilidad', async () => {
    const { container } = montar()
    expect(await violacionesAxe(container)).toEqual([])
  })
})
