import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ volver: vi.fn() }))
vi.mock('@refinedev/core', () => ({ useBack: () => mocks.volver }))

import { BotonVolver } from './BotonVolver'

describe('BotonVolver', () => {
  it('tiene nombre accesible y vuelve a la pantalla anterior', () => {
    render(<BotonVolver />)
    fireEvent.click(screen.getByRole('button', { name: 'Volver' }))
    expect(mocks.volver).toHaveBeenCalledTimes(1)
  })
})
