import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { violacionesAxe } from '../test/axe'

vi.mock('../hooks/usePuedeEscribir', () => ({ usePuedeEscribir: () => ({ puedeEscribir: false, isLoading: false }) }))

import { RequiereAdministrador } from './RequiereAdministrador'

describe('Accesibilidad de RequiereAdministrador', () => {
  it('el aviso para quien no es administrador no tiene violaciones de axe', async () => {
    const { container } = render(<MemoryRouter><RequiereAdministrador seccion="Importar historial"><p>Contenido</p></RequiereAdministrador></MemoryRouter>)
    expect(await violacionesAxe(container)).toEqual([])
  })
})
