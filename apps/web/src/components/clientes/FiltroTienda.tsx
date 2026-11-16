import { FiltroEmpresa } from '../pagina/FiltroEmpresa'

type FiltroTiendaProps = {
  empresas: ReadonlyArray<{ id: string; nombre: string }>
  valor: string | null
  onCambiar: (empresaId: string | null) => void
  cargando?: boolean
  hayError?: boolean
}

// Filtro por tienda de Clientes (F-CLI-11, `{{tFilt}}` del prototipo). Delega en `FiltroEmpresa`
// para que todas las pantallas muestren las mismas píldoras. Es sólo presentación: el valor lo
// maneja la pantalla y lo aplican el listado, el ranking y la exportación.
export function FiltroTienda({ empresas, valor, onCambiar, cargando = false, hayError = false }: FiltroTiendaProps) {
  return (
    <FiltroEmpresa
      empresas={empresas}
      valor={valor}
      onCambiar={onCambiar}
      cargando={cargando}
      hayError={hayError}
      textoAyuda="Un cliente es de la organización y se habilita en una o más tiendas."
    />
  )
}
