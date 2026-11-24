import { useEffect } from 'react'

// El panel es privado: se pide a los buscadores que no lo indexen. Cubre solo a quien ejecuta JavaScript: ese `index.html`
// es el mismo del panel y de la tienda y sale sin `noindex`. La solución completa es un `map` por host del panel en
// `nginx.conf` con `X-Robots-Tag` (MSF-1003). `main.tsx` solo monta `App` (y este componente) en los hosts del panel; la
// tienda lleva su propia `<meta robots>` (`CabeceraSeo`). Se agrega al montar y se quita al desmontar.
export function NoIndexarPanel() {
  useEffect(() => {
    const meta = document.createElement('meta')
    meta.name = 'robots'
    meta.content = 'noindex,nofollow'
    document.head.appendChild(meta)
    return () => meta.remove()
  }, [])
  return null
}
