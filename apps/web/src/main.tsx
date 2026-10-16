import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/sora'
import '@fontsource-variable/instrument-sans'
import './index.css'
import App from './App.tsx'
import { instalarDestinoActividad } from './lib/destinoActividad'
import { seguirActividad } from './lib/vencimientoSesion'
import { authProvider } from './providers/authProvider'

// Los eventos empresa.* de la edición de empresas llegan al historial (F-AUD-01).
instalarDestinoActividad()

let cerrando = false
seguirActividad(() => {
  if (cerrando) return
  cerrando = true
  void authProvider.logout?.({}).finally(() => window.location.assign('/login'))
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
