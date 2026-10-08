import type { ReactElement } from 'react'
import { render, type RenderOptions } from '@testing-library/react'
import { MemoryRouter } from 'react-router'

type RenderPanelOptions = Omit<RenderOptions, 'wrapper'> & { route?: string }

export function renderPanel(ui: ReactElement, { route = '/', ...options }: RenderPanelOptions = {}) {
  return render(ui, {
    wrapper: ({ children }) => <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>,
    ...options,
  })
}
