// Lista de pedido de la tienda (MSF-176, historia B1, FR-020 y FR-022, D-15). Vive EN EL NAVEGADOR, por tienda (host), sin servidor ni
// sincronía entre dispositivos. Solo guarda `producto_id` y `cantidad`: NUNCA precios (el servidor calcula todo cada vez que se abre la
// lista y antes de enviar). Si el navegador bloquea el almacenamiento local (modo privado, política del sitio, cuota) la lista dura
// mientras la página está abierta (respaldo en memoria) y `almacenamientoBloqueado()` lo dice para avisarlo. Dos pestañas con la misma
// lista: gana la última escritura del almacenamiento (el evento `storage` y el regreso del foco la releen).

export const MAX_LINEAS_LISTA = 50
export const MAX_UNIDADES_LINEA = 9999

export type LineaPedido = { productoId: string; cantidad: number }

export type ResultadoAgregar =
  | { estado: 'ok'; cantidad: number }
  // La línea ya tiene el máximo de unidades: queda en 9.999.
  | { estado: 'tope_unidades'; cantidad: number }
  // La lista ya tiene 50 productos distintos y este es uno nuevo: no se agrega.
  | { estado: 'tope_lineas' }
  // El id no tiene forma de producto: no se guarda nada.
  | { estado: 'invalido' }

const PREFIJO = 'msf.lista-pedido.v1:'
const FORMA_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Respaldo en memoria por host y listas ya leídas (la referencia es estable mientras no cambie el contenido, para `useSyncExternalStore`).
const enMemoria = new Map<string, readonly LineaPedido[]>()
const instantaneas = new Map<string, { texto: string; lineas: readonly LineaPedido[] }>()
const oyentes = new Map<string, Set<() => void>>()
let bloqueado = false
let escuchandoVentana = false

const clave = (host: string) => `${PREFIJO}${host}`
const SIN_LINEAS: readonly LineaPedido[] = Object.freeze([])

// Normaliza lo leído: solo ids con forma de uuid y cantidades enteras de 1 a 9.999; repetidos sumados; tope de 50 líneas. Cualquier otra clave
// (p. ej. un precio que alguien escribió a mano en el almacenamiento) se descarta: la lista nunca conserva precios.
export function normalizarLineas(crudo: unknown): LineaPedido[] {
  if (!Array.isArray(crudo)) return []
  const porProducto = new Map<string, number>()
  for (const elemento of crudo) {
    if (elemento === null || typeof elemento !== 'object') continue
    const { p, c } = elemento as { p?: unknown; c?: unknown }
    if (typeof p !== 'string' || !FORMA_UUID.test(p)) continue
    const cantidad = typeof c === 'number' ? c : NaN
    if (!Number.isInteger(cantidad) || cantidad < 1) continue
    const id = p.toLowerCase()
    if (!porProducto.has(id) && porProducto.size >= MAX_LINEAS_LISTA) continue
    porProducto.set(id, Math.min((porProducto.get(id) ?? 0) + cantidad, MAX_UNIDADES_LINEA))
  }
  return [...porProducto].map(([productoId, cantidad]) => ({ productoId, cantidad }))
}

const serializar = (lineas: readonly LineaPedido[]) => JSON.stringify(lineas.map((linea) => ({ p: linea.productoId, c: linea.cantidad })))

function leerAlmacenamiento(host: string): string | null | undefined {
  try {
    const texto = window.localStorage.getItem(clave(host))
    bloqueado = false
    return texto
  } catch {
    bloqueado = true
    return undefined
  }
}

function escribirAlmacenamiento(host: string, lineas: readonly LineaPedido[]): void {
  try {
    if (lineas.length === 0) window.localStorage.removeItem(clave(host))
    else window.localStorage.setItem(clave(host), serializar(lineas))
    bloqueado = false
  } catch {
    // Cuota llena o almacenamiento bloqueado: queda el respaldo en memoria.
    bloqueado = true
  }
}

// La lista del host. La referencia devuelta es la misma mientras el contenido no cambie.
export function leerLista(host: string): readonly LineaPedido[] {
  if (host === '') return SIN_LINEAS
  const texto = leerAlmacenamiento(host)
  let lineas: readonly LineaPedido[]
  if (texto === undefined) {
    // Bloqueado: la memoria es la verdad.
    lineas = enMemoria.get(host) ?? SIN_LINEAS
  } else if (texto === null) {
    lineas = SIN_LINEAS
    enMemoria.delete(host)
  } else {
    let crudo: unknown = null
    try { crudo = JSON.parse(texto) } catch { crudo = null }
    lineas = normalizarLineas(crudo)
    enMemoria.set(host, lineas)
  }
  const previa = instantaneas.get(host)
  const nueva = serializar(lineas)
  if (previa && previa.texto === nueva) return previa.lineas
  const vigente = lineas.length === 0 ? SIN_LINEAS : lineas
  instantaneas.set(host, { texto: nueva, lineas: vigente })
  return vigente
}

function avisar(host: string): void {
  oyentes.get(host)?.forEach((oyente) => oyente())
}

function guardar(host: string, lineas: readonly LineaPedido[]): void {
  enMemoria.set(host, lineas)
  escribirAlmacenamiento(host, lineas)
  avisar(host)
}

// Un host vacío es la vista previa del panel: no hay lista.
export function agregarALista(host: string, productoId: string, cantidad = 1): ResultadoAgregar {
  const id = productoId.toLowerCase()
  if (host === '' || !FORMA_UUID.test(id)) return { estado: 'invalido' }
  const lineas = leerLista(host)
  const actual = lineas.find((linea) => linea.productoId === id)
  if (!actual && lineas.length >= MAX_LINEAS_LISTA) return { estado: 'tope_lineas' }
  const suma = (actual?.cantidad ?? 0) + Math.max(1, Math.trunc(cantidad))
  const nueva = Math.min(suma, MAX_UNIDADES_LINEA)
  const resultado = actual ? lineas.map((linea) => (linea.productoId === id ? { ...linea, cantidad: nueva } : linea)) : [...lineas, { productoId: id, cantidad: nueva }]
  guardar(host, resultado)
  return suma > MAX_UNIDADES_LINEA ? { estado: 'tope_unidades', cantidad: nueva } : { estado: 'ok', cantidad: nueva }
}

// Cantidad exacta de una línea (la que escribe la persona): entera, de 1 a 9.999.
export function fijarCantidad(host: string, productoId: string, cantidad: number): void {
  const id = productoId.toLowerCase()
  const valida = Math.min(Math.max(Math.trunc(Number.isFinite(cantidad) ? cantidad : 1), 1), MAX_UNIDADES_LINEA)
  const lineas = leerLista(host)
  if (!lineas.some((linea) => linea.productoId === id)) return
  guardar(host, lineas.map((linea) => (linea.productoId === id ? { ...linea, cantidad: valida } : linea)))
}

export function quitarDeLista(host: string, productoId: string): void {
  const id = productoId.toLowerCase()
  const lineas = leerLista(host)
  if (!lineas.some((linea) => linea.productoId === id)) return
  guardar(host, lineas.filter((linea) => linea.productoId !== id))
}

export function vaciarLista(host: string): void {
  if (leerLista(host).length === 0) return
  guardar(host, [])
}

// Quita varias líneas (los «No disponibles» al enviar).
export function quitarVariosDeLista(host: string, productoIds: readonly string[]): void {
  const ids = new Set(productoIds.map((id) => id.toLowerCase()))
  const lineas = leerLista(host)
  const restantes = lineas.filter((linea) => !ids.has(linea.productoId))
  if (restantes.length !== lineas.length) guardar(host, restantes)
}

// ¿El navegador no deja guardar la lista? (la lista sigue funcionando en memoria mientras la página esté abierta).
export function almacenamientoBloqueado(): boolean {
  return bloqueado
}

function alCambiarVentana(evento: Event): void {
  if (evento instanceof StorageEvent && evento.key !== null && !evento.key.startsWith(PREFIJO)) return
  for (const host of oyentes.keys()) avisar(host)
}

// Suscripción de un host (misma pestaña por `avisar`; otras pestañas por el evento `storage` y al volver el foco).
export function suscribirLista(host: string, oyente: () => void): () => void {
  const conjunto = oyentes.get(host) ?? new Set<() => void>()
  conjunto.add(oyente)
  oyentes.set(host, conjunto)
  if (!escuchandoVentana && typeof window !== 'undefined') {
    escuchandoVentana = true
    window.addEventListener('storage', alCambiarVentana)
    window.addEventListener('focus', alCambiarVentana)
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') alCambiarVentana(new Event('visibilitychange')) })
  }
  return () => {
    conjunto.delete(oyente)
    if (conjunto.size === 0) oyentes.delete(host)
  }
}

// Nombre accesible del indicador del encabezado: «Mi lista, 3 productos» (singular «1 producto»; con 0, «Mi lista, vacía»).
export function nombreAccesibleLista(productos: number): string {
  if (productos < 1) return 'Mi lista, vacía'
  return `Mi lista, ${productos} ${productos === 1 ? 'producto' : 'productos'}`
}

// Solo para los tests: olvida lo guardado en memoria y las instantáneas.
export function reiniciarListaPedido(): void {
  enMemoria.clear()
  instantaneas.clear()
  bloqueado = false
}
