// Pila de declaraciones de cabecera (MSF-149): una pantalla puede montar más de una `CabeceraSeo` a la vez (p. ej. la
// página de catálogo, indexable, y su listado, que en un error monta una `noindex`). Para que no queden dos metas
// `robots` contradictorias ni se pisen el título y su restauración, todo pasa por acá:
//  * `robots`: una sola meta; `noindex` gana sobre cualquier otra declaración.
//  * título: gana la declaración de mayor prioridad (las `noindex` van primero) y, a igual prioridad, la última;
//    al quedar la pila vacía se restaura el título que había antes de la primera declaración.
// Limitación conocida: ese título «base» se captura una vez; si algo externo cambia `document.title` mientras hay
// cabeceras montadas, al vaciarse la pila se restaura el base original (no el cambio externo). Hoy nada más lo toca.

const MARCA = 'data-tienda-seo'

type Robots = 'noindex' | 'index, follow'
const robots = new Set<{ valor: Robots }>()
const titulos: Array<{ titulo: string; prioridad: number }> = []
let tituloBase: string | null = null

function sincronizarRobots() {
  let nodo = document.head.querySelector<HTMLMetaElement>(`meta[name="robots"][${MARCA}]`)
  if (robots.size === 0) {
    nodo?.remove()
    return
  }
  if (!nodo) {
    nodo = document.createElement('meta')
    nodo.setAttribute(MARCA, '')
    nodo.setAttribute('name', 'robots')
    document.head.appendChild(nodo)
  }
  nodo.setAttribute('content', [...robots].some((r) => r.valor === 'noindex') ? 'noindex' : 'index, follow')
}

export function declararRobots(valor: Robots): () => void {
  const entrada = { valor }
  robots.add(entrada)
  sincronizarRobots()
  return () => {
    robots.delete(entrada)
    sincronizarRobots()
  }
}

function sincronizarTitulo() {
  if (titulos.length === 0) {
    if (tituloBase !== null) document.title = tituloBase
    tituloBase = null
    return
  }
  const mayor = Math.max(...titulos.map((t) => t.prioridad))
  const ganador = [...titulos].reverse().find((t) => t.prioridad === mayor)
  if (ganador) document.title = ganador.titulo
}

export function declararTitulo(titulo: string, prioridad: number): () => void {
  if (titulos.length === 0) tituloBase = document.title
  const entrada = { titulo, prioridad }
  titulos.push(entrada)
  sincronizarTitulo()
  return () => {
    const i = titulos.indexOf(entrada)
    if (i >= 0) titulos.splice(i, 1)
    sincronizarTitulo()
  }
}

// Solo para pruebas: deja la pila vacía sin tocar el DOM.
export function reiniciarPilaCabecera() {
  robots.clear()
  titulos.length = 0
  tituloBase = null
}
