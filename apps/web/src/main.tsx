import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/sora'
import '@fontsource-variable/instrument-sans'
import './index.css'
import App from './App.tsx'
import { seguirActividad } from './lib/vencimientoSesion'
import { authProvider } from './providers/authProvider'

seguirActividad(() => {
  void authProvider.logout?.({}).finally(() => window.location.assign('/login'))
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
