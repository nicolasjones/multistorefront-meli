import { useEffect, useState } from 'react'
import { formatearCuit } from './cuit'
import { supabaseClient } from './supabase'

// F-TDA-22 (MSF-289): información legal pública de la tienda (razón social, CUIT, dirección y enlaces).
// La lista blanca de campos, el orden y el `null` para tienda desconocida o desactivada los resuelve la
// base (migración 20270212100001_tienda_legal.sql); acá se lee, se formatea y se descarta lo no `https`.

export type EnlaceLegal = { titulo: string; url: string }

export type LegalTienda = {
  razonSocial: string | null
  cuit: string | null
  direccion: string | null
  enlaces: EnlaceLegal[]
}

type FilaLegal = {
  razon_social: string | null
  cuit: string | null
  direccion: string | null
  enlaces: Array<{ titulo: string; url: string }> | null
}

// Solo `https://`: la base ya lo exige por check, pero el front nunca renderiza otra cosa (defensa en profundidad).
export function esUrlHttps(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:'
  } catch {
    return false
  }
}

const limpio = (valor: string | null | undefined) => (valor ?? '').trim() || null

// `XX-XXXXXXXX-X`; si no son 11 dígitos se devuelve tal cual (sin inventar) y vacío es null.
export function cuitParaMostrar(cuit: string | null | undefined): string | null {
  const texto = limpio(cuit)
  return texto ? formatearCuit(texto) : null
}

// Sin ningún dato (ni razón social, ni CUIT, ni dirección, ni enlaces) el bloque no se muestra (FR-032).
export function legalTieneDatos(legal: LegalTienda | null): legal is LegalTienda {
  return legal !== null && (legal.razonSocial !== null || legal.cuit !== null || legal.direccion !== null || legal.enlaces.length > 0)
}

// publico.legal_por_dominio es ejecutable por anon (sin sesión). null = host desconocido o desactivada.
export async function leerLegalTienda(host: string): Promise<LegalTienda | null> {
  const { data, error } = await supabaseClient.schema('publico').rpc('legal_por_dominio', { host })
  if (error) {
    throw new Error(error.message)
  }
  if (!data) {
    return null
  }
  const fila = data as FilaLegal
  return {
    razonSocial: limpio(fila.razon_social),
    cuit: limpio(fila.cuit),
    direccion: limpio(fila.direccion),
    enlaces: (fila.enlaces ?? []).filter((e) => limpio(e.titulo) !== null && esUrlHttps(e.url)).map((e) => ({ titulo: e.titulo.trim(), url: e.url })),
  }
}

type Resultado = { host: string; legal: LegalTienda | null }

// Datos legales del pie. Mientras carga o si falla devuelve null: el pie legal es complementario y su
// ausencia no rompe la página. Al cambiar de host no se muestran los del anterior.
export function useLegalTienda(host: string): LegalTienda | null {
  const [resultado, setResultado] = useState<Resultado | null>(null)

  useEffect(() => {
    let cancelada = false
    leerLegalTienda(host)
      .then((legal) => { if (!cancelada) setResultado({ host, legal }) })
      .catch((error) => {
        console.error('No se pudo cargar la información legal de la tienda', error instanceof Error ? error.message : error)
        if (!cancelada) setResultado({ host, legal: null })
      })
    return () => { cancelada = true }
  }, [host])

  return resultado && resultado.host === host ? resultado.legal : null
}
