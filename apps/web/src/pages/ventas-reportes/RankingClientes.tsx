import { EstadoVacio } from '../../components/estados/EstadosPagina'
import { ContenedorSeccion } from '../../components/pagina/ContenedorSeccion'

// «Ranking de clientes» (F-VTA-23, FR-006/007/008): la pestaña y el marco de la pantalla son de
// F-VTA-22, pero el tablero, el interruptor «Consumidor final» y la exportación los completa la
// historia de ranking y exportación. Hasta entonces la pestaña avisa que todavía no está disponible
// (en vez de mostrar un tablero vacío sin explicación).
export function RankingClientes() {
  return (
    <ContenedorSeccion>
      <EstadoVacio
        titulo="El ranking de clientes todavía no está disponible"
        descripcion="Se completa con el reporte de ranking de clientes y su exportación a Excel."
      />
    </ContenedorSeccion>
  )
}
