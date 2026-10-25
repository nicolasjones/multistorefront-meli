import { supabaseClient } from './supabase'

// F-TDA-01 (MSF-241): resolución de la tienda online por dominio.

export type TiendaPublica = {
  tiendaId: string
  empresaNombre: string
  estado: string
}

const HOSTS_PANEL_DESARROLLO = 'localhost,127.0.0.1'

// Host crudo → host comparable: minúsculas, sin espacios, sin puerto y sin punto final.
// Espejo de private.normalizar_host (la base vuelve a normalizar: esto es solo para comparar acá).
export function normalizarHost(host: string): string {
  return host.trim().toLowerCase().replace(/\.+$/, '').replace(/:[0-9]*$/, '').replace(/\.+$/, '')
}

// Hosts donde se sirve el panel (el resto de los hosts pueden ser tiendas). Salen de
// VITE_PANEL_HOSTS (lista separada por comas). En desarrollo, sin la variable, el panel
// vive en localhost (los subdominios de `localhost`, p. ej. mundojc.localhost, son tiendas
// de prueba). En producción, sin la variable no se enruta ninguna tienda: **falla seguro**
// y todo host sigue sirviendo el panel (la tienda pública exige configurarla).
export function hostsDelPanel(
  configurados: string | undefined = import.meta.env.VITE_PANEL_HOSTS,
  esProduccion: boolean = import.meta.env.PROD,
): Set<string> {
  const crudo = configurados?.trim() ? configurados : esProduccion ? '' : HOSTS_PANEL_DESARROLLO
  const lista = crudo.split(',').map(normalizarHost).filter(Boolean)
  return new Set(lista)
}

// Un host es de tienda cuando hay hosts de panel configurados y este no es uno de ellos.
// Sin configuración devuelve false (el panel sigue funcionando; ver hostsDelPanel).
export function esHostDeTienda(host: string, panel: Set<string> = hostsDelPanel()): boolean {
  const normalizado = normalizarHost(host)
  return normalizado !== '' && panel.size > 0 && !panel.has(normalizado)
}

// URL para «Ver tienda»: el dominio de la tienda con el protocolo y el puerto con los que se
// sirve el panel (en producción no hay puerto; en local sí).
export function urlDeTienda(dominio: string, ubicacion: Pick<Location, 'protocol' | 'port'> = window.location): string {
  const puerto = ubicacion.port ? `:${ubicacion.port}` : ''
  return `${ubicacion.protocol}//${dominio}${puerto}/`
}

type FilaTienda = { tienda_id: string; empresa_nombre: string; estado: string }

// publico.tienda_por_dominio es ejecutable por anon: no hace falta sesión. Dominio desconocido,
// host inválido y empresa desactivada devuelven lo mismo (sin filas) → null (FR-003).
export async function resolverTienda(host: string): Promise<TiendaPublica | null> {
  const { data, error } = await supabaseClient.schema('publico').rpc('tienda_por_dominio', { host })
  if (error) {
    throw new Error(error.message)
  }
  const fila = ((data ?? []) as FilaTienda[])[0]
  return fila ? { tiendaId: fila.tienda_id, empresaNombre: fila.empresa_nombre, estado: fila.estado } : null
}

export type TiendaDeEmpresa = { id: string; dominio: string }

// Tienda (dominio) de una empresa para la gestión. RLS de dominio.tiendas: solo la organización
// de la sesión. null = la empresa todavía no tiene dominio configurado.
export async function leerTiendaDeEmpresa(empresaId: string): Promise<TiendaDeEmpresa | null> {
  const { data, error } = await supabaseClient
    .schema('dominio')
    .from('tiendas')
    .select('id, dominio')
    .eq('empresa_id', empresaId)
    .maybeSingle<TiendaDeEmpresa>()
  if (error) {
    throw new Error(error.message)
  }
  return data
}
