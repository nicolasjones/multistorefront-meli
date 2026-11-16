import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FormularioPedido } from './FormularioPedido'

const mocks = vi.hoisted(() => ({ useLegal: vi.fn() }))
vi.mock('../../../lib/tiendaLegal', () => ({ useLegalTienda: mocks.useLegal }))

const legalCon = (url: string) => ({ razonSocial: null, cuit: null, direccion: null, enlaces: [{ titulo: 'Política de privacidad', url }] })
const montar = () => render(
  <FormularioPedido
    host="tienda.ejemplo.com" conCuenta={false} datos={{ nombre: '', contacto: '', nota: '' }} errores={{}} enviando={false} enviarDeshabilitado={false}
    alCambiar={() => {}} alSalir={() => {}} alEnviar={() => {}} refs={() => {}}
  />,
)

describe('FormularioPedido · enlace de privacidad', () => {
  beforeEach(() => { mocks.useLegal.mockReset() })

  it('enlaza la política de privacidad cuando es https', () => {
    mocks.useLegal.mockReturnValue(legalCon('https://tienda.ejemplo.com/privacidad'))
    montar()
    expect(screen.getByRole('link', { name: 'Política de privacidad' })).toHaveAttribute('href', 'https://tienda.ejemplo.com/privacidad')
  })

  it.each(['javascript:alert(1)', 'data:text/html,hola', 'vbscript:x', 'ftp://x.com/p'])('no enlaza un esquema que no es http(s): %s', (url) => {
    mocks.useLegal.mockReturnValue(legalCon(url))
    montar()
    expect(screen.queryByRole('link', { name: 'Política de privacidad' })).not.toBeInTheDocument()
    expect(screen.getByText(/Usaremos estos datos solo para responderte/)).toBeInTheDocument()
  })
})
