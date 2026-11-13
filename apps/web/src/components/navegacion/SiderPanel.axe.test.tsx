import { render, screen, waitFor } from '@testing-library/react'
import { Refine } from '@refinedev/core'
import { RefineSnackbarProvider } from '@refinedev/mui'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { panelFixtures } from '../../test/fixtures/panel'
import { violacionesAxe } from '../../test/axe'

// Integración SIN mockear `ThemedSider`: es el `@refinedev/mui` real, con su `<ul>` y su botón «contraer» sin nombre.
// Verifica con axe que el sider completo no tiene `list` ni `button-name`. Si se actualiza `@refinedev/mui` y el botón ya
// trae nombre, se puede quitar el parche (`EtiquetaBotonContraer` en SiderPanel.tsx) y este test debe seguir en verde.
const mocks = vi.hoisted(() => ({ useContextoPanel: vi.fn(), usePermisosPanel: vi.fn(), useFeatureHabilitada: vi.fn() }))
vi.mock('../../hooks/useFeatureHabilitada', () => ({ useFeatureHabilitada: mocks.useFeatureHabilitada }))
vi.mock('../../hooks/useContextoPanel', () => ({ useContextoPanel: mocks.useContextoPanel }))
vi.mock('../consultas/InsigniaConsultasNuevas', () => ({ InsigniaConsultasNuevas: () => null }))
vi.mock('../../context/PermisosPanel', () => ({ usePermisosPanel: mocks.usePermisosPanel }))

import { SiderPanel } from './SiderPanel'

const dataProvider = { getList: vi.fn(), getOne: vi.fn(), create: vi.fn(), update: vi.fn(), deleteOne: vi.fn(), getApiUrl: () => '' }

function renderSiderReal() {
  return render(
    <MemoryRouter initialEntries={['/clientes']}>
      <Refine dataProvider={dataProvider as never} resources={[]} options={{ disableTelemetry: true }}>
        <RefineSnackbarProvider>
          <SiderPanel />
        </RefineSnackbarProvider>
      </Refine>
    </MemoryRouter>,
  )
}

describe('SiderPanel con ThemedSider real (a11y)', () => {
  beforeEach(() => {
    mocks.useContextoPanel.mockReturnValue({ contexto: panelFixtures.administrador, isLoading: false })
    mocks.usePermisosPanel.mockReturnValue({ permisos: null, isLoading: false, recargar: vi.fn() })
    mocks.useFeatureHabilitada.mockReturnValue({ habilitada: false, isLoading: false })
  })

  it('el botón de contraer tiene nombre accesible y axe no reporta violaciones', async () => {
    const { container } = renderSiderReal()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Contraer el menú lateral' })).toBeInTheDocument())
    expect(await violacionesAxe(container)).toEqual([])
  })
})
