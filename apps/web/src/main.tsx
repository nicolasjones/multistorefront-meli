import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/sora'
import '@fontsource-variable/instrument-sans'
import './index.css'
import App from './App.tsx'
import { instalarDestinoActividad } from './lib/destinoActividad'
import { iniciarErrores } from './lib/erroresWeb'
import { seguirActividad } from './lib/vencimientoSesion'
import { authProvider } from './providers/authProvider'
import { esHostDeTienda } from './lib/tienda'
import { salirCliente } from './lib/tiendaCuenta'
import { TiendaPublicaApp } from './pages/tienda-publica'

// Registro central de errores (F-OPS-03): sin VITE_ERRORES_DSN no envía nada.
iniciarErrores({
  dsn: import.meta.env.VITE_ERRORES_DSN,
  ambiente: import.meta.env.VITE_ERRORES_AMBIENTE,
  version: import.meta.env.VITE_APP_VERSION,
})

// Los eventos empresa.* de la edición de empresas llegan al historial (F-AUD-01).
instalarDestinoActividad()

// Front público (FR-007): si el `Host` no es uno del panel, la petición es de una
// tienda online y se resuelve por dominio, sin sesión. Los hosts del panel salen de
// VITE_PANEL_HOSTS (por defecto, desarrollo local); ver docs/tiendas-online.md.
const host = window.location.host
const esTiendaPublica = esHostDeTienda(host)

// Vencimiento por inactividad (MSF-700): en la tienda se cierra solo esta sesión
// (scope local, como `salirCliente`); `authProvider.logout` revoca en todos los dispositivos.
let cerrando = false
seguirActividad(() => {
  if (cerrando) return
  cerrando = true
  if (esTiendaPublica) {
    void salirCliente().finally(() => window.location.assign('/'))
    return
  }
  void authProvider.logout?.({}).finally(() => window.location.assign('/login'))
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {esTiendaPublica ? <TiendaPublicaApp host={host} /> : <App />}
  </StrictMode>,
)
