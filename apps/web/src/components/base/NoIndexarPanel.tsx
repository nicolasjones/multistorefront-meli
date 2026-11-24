import { useEffect } from 'react'

// El panel es privado: ningún buscador debe indexarlo. Ese `index.html` también lo sirve el host de la tienda, pero
// `main.tsx` solo monta `App` (y por tanto este componente) en los hosts del panel; la tienda lleva su propia
// `<meta robots>` (`CabeceraSeo`). Se agrega al montar y se quita al desmontar.
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
