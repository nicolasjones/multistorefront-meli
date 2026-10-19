import { useCallback, useState } from 'react'
import { useEmpresasAccesibles } from './useEmpresasAccesibles'

// Filtro de pantalla por tienda/empresa que **sigue a la empresa activa** de la
// barra superior (F-ROL-06, F-CLI-11): como `gc_co` inicializa el filtro del
// prototipo, elegir otra tienda arriba acciona el filtro de la pantalla. La
// pantalla puede sobreescribirlo (chips o select) sin cambiar la empresa activa
// persistida: la sobreescritura vale hasta que la activa vuelva a cambiar.
//
// Sin efecto: la sobreescritura guarda con qué empresa activa se eligió (`base`)
// y se ignora en cuanto la activa deja de ser esa. Así el cambio de la barra
// superior siempre gana, sin setState dentro de un efecto.
export function useFiltroPorEmpresaActiva() {
  const { empresas, empresaActivaId, isLoading, isError } = useEmpresasAccesibles()
  const [sobreescritura, setSobreescritura] = useState<{ base: string | null; valor: string | null } | null>(null)
  const valor = sobreescritura && sobreescritura.base === empresaActivaId ? sobreescritura.valor : empresaActivaId
  const cambiar = useCallback(
    (empresaId: string | null) => setSobreescritura({ base: empresaActivaId, valor: empresaId }),
    [empresaActivaId],
  )
  // `cargando`/`hayError` solo mientras no hay opciones: una recarga (cambio de
  // empresa activa) no debe vaciar la fila de filtros de la pantalla.
  const sinOpciones = empresas.length === 0
  return {
    empresas,
    valor,
    cambiar,
    empresaActivaId,
    cargando: isLoading && sinOpciones,
    hayError: isError && sinOpciones,
  }
}
