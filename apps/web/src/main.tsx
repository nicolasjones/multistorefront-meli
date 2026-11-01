import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/sora'
import '@fontsource-variable/instrument-sans'
import './index.css'
import App from './App.tsx'
import { instalarDestinoActividad } from './lib/destinoActividad'
import { instalarVencimientoDeSesion } from './lib/arranque'
import { authProvider } from './providers/authProvider'
import { esHostDeTienda, hostsDelPanel } from './lib/tienda'
import { TiendaPublicaApp } from './pages/tienda-publica'

// Los eventos empresa.* de la edición de empresas llegan al historial (F-AUD-01).
instalarDestinoActividad()

// Front público (FR-007): si el `Host` no es uno del panel, la petición es de una
// tienda online y se resuelve por dominio, sin sesión. Los hosts del panel salen de
// VITE_PANEL_HOSTS (por defecto, desarrollo local); ver docs/tiendas-online.md.
const host = window.location.host
const panel = hostsDelPanel()
const esTiendaPublica = esHostDeTienda(host, panel)

// Vencimiento por inactividad: solo en el panel (MSF-673); la tienda no tiene `/login`.
let cerrando = false
instalarVencimientoDeSesion(
  host,
  () => {
    if (cerrando) return
    cerrando = true
    void authProvider.logout?.({}).finally(() => window.location.assign('/login'))
  },
  panel,
)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {esTiendaPublica ? <TiendaPublicaApp host={host} /> : <App />}
  </StrictMode>,
)
