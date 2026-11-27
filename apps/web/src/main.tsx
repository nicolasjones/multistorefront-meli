import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/sora'
import '@fontsource-variable/instrument-sans'
import './index.css'
import { instalarVencimientoDeSesion } from './lib/arranqueSesion'
import { instalarDestinoActividad } from './lib/destinoActividad'
import { iniciarErrores } from './lib/erroresWeb'
import { esHostDeTienda } from './lib/tienda'
import { TiendaPublicaApp } from './pages/tienda-publica'
import { precargarRutaActual } from './pages/tienda-publica/EnrutadorTienda'

// El panel administrativo va en su propio chunk (FR-047 / SC-009): el visitante de la tienda no
// descarga Refine ni las pantallas del panel. Antes el import era estático y el chunk de entrada
// (el que descarga todo visitante) lo traía entero: en «4G lento» el LCP de la home rondaba los 17 s.
// El fallback no usa componentes de MUI: el tema (`ThemeProvider`) vive dentro de `App`, y un esqueleto fuera de él
// se vería un instante con el tema por defecto.
const App = lazy(() => import('./App.tsx'))

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

// Vencimiento por inactividad (MSF-740): es una regla del PANEL (12 h sin actividad → cierre y `/login`).
// La tienda pública no la hereda: su sesión termina por salida explícita («Salir») o por el tope de 30 días
// del servidor. El control no se instala en un host de tienda: el visitante no ve cierre ni redirección.
instalarVencimientoDeSesion(esTiendaPublica)

// Tienda pública (MSF-1002): se empieza a descargar el chunk de la pantalla pedida sin esperar a que se resuelva la tienda.
if (esTiendaPublica) precargarRutaActual(window.location.pathname)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {esTiendaPublica ? <TiendaPublicaApp host={host} /> : <Suspense fallback={<div role="status" aria-busy="true" aria-label="Cargando" />}><App /></Suspense>}
  </StrictMode>,
)
