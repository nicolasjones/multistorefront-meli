import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import App from './App'

describe('App', () => {
  it('redirects an unauthenticated visitor to the login screen', async () => {
    render(<App />)

    // La pantalla de ingreso propia (pages/login.tsx, F-ACC-01) titula «Ingresar».
    // El primer render importa Refine + MUI en frío (~1 s en el runner de CI, por
    // encima del default de 1 s de findBy); 5 s deja margen sin tapar un cuelgue.
    expect(
      await screen.findByRole('heading', { name: 'Ingresar' }, { timeout: 5000 }),
    ).toBeInTheDocument()
  }, 8000)
})
