import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  selectRes: { data: [], error: null } as { data: { id: string; numero: number }[] | null; error: { message: string } | null },
  updateCalls: [] as unknown[],
  insertCalls: [] as unknown[],
  insertError: null as null | { message: string },
}))

vi.mock('../../lib/supabase', () => ({
  supabaseClient: {
    from: (_tabla: string) => ({
      select: () => ({
        in: () => Promise.resolve(mocks.selectRes),
      }),
      update: (valores: unknown) => ({
        eq: (_col: string, _id: unknown) => {
          mocks.updateCalls.push(valores)
          return Promise.resolve({ error: null })
        },
      }),
      insert: (valores: unknown) => {
        mocks.insertCalls.push(valores)
        return Promise.resolve({ error: mocks.insertError })
      },
    }),
  },
}))

import { ImportarClientes } from './ImportarClientes'

const CSV = 'numero;nombre;documento;tipo\n1043;Nuevo;30-1;mayorista\n;Sin numero;30-2;\n'

const elegir = async (contenido = CSV) => {
  render(<ImportarClientes />)
  fireEvent.click(screen.getByRole('button', { name: 'Importar' }))
  const input = document.querySelector('input[type="file"]') as HTMLInputElement
  const archivo = new File([contenido], 'clientes.csv', { type: 'text/csv' })
  fireEvent.change(input, { target: { files: [archivo] } })
  await waitFor(() => expect(screen.getByRole('button', { name: /Importar 2 clientes/ })).toBeInTheDocument())
}

describe('ImportarClientes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.selectRes = { data: [], error: null }
    mocks.updateCalls = []
    mocks.insertCalls = []
    mocks.insertError = null
  })

  it('previsualiza filas válidas y actualiza existentes por número', async () => {
    mocks.selectRes = { data: [{ id: 'c-1043', numero: 1043 }], error: null }
    await elegir()
    fireEvent.click(screen.getByRole('button', { name: /Importar 2 clientes/ }))
    await waitFor(() => expect(screen.getByText(/Importación lista/)).toBeInTheDocument())
    expect(mocks.updateCalls).toHaveLength(1)
    expect(mocks.insertCalls).toHaveLength(1)
    expect(screen.getByText(/1 nuevos, 1 actualizados/)).toBeInTheDocument()
  })

  it('muestra los errores por fila y no importa', async () => {
    render(<ImportarClientes />)
    fireEvent.click(screen.getByRole('button', { name: 'Importar' }))
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const archivo = new File(['nombre;documento\nSin doc;\n'], 'mal.csv', { type: 'text/csv' })
    fireEvent.change(input, { target: { files: [archivo] } })
    await waitFor(() => expect(screen.getByText(/Fila 2: Falta el DNI\/CUIT/)).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /Importar \d+ clientes/ })).not.toBeInTheDocument()
  })

  it('si el servidor falla, informa y no dice listo', async () => {
    mocks.insertError = { message: 'boom' }
    await elegir()
    fireEvent.click(screen.getByRole('button', { name: /Importar 2 clientes/ }))
    await waitFor(() => expect(screen.getByText('No pudimos importar los clientes.')).toBeInTheDocument())
    expect(screen.queryByText(/Importación lista/)).not.toBeInTheDocument()
  })
})
