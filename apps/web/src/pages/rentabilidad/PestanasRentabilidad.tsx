import { PestanasPagina } from '../../components/pagina/PestanasPagina'
import { useBanderaMargenCostosFijos } from '../../hooks/useBanderaMargenCostosFijos'
import { PESTANAS_RENTABILIDAD, PESTANA_DESPUES_DE_COSTOS_FIJOS } from '../../lib/rentabilidad'

// Pestañas de Rentabilidad: las de siempre y, solo con la bandera `margen_costos_fijos` encendida, «Después de costos fijos»
// (RF-GAS-14, CA-GAS-15). Con la bandera apagada o sin poder leerla, la pantalla es idéntica a la de antes.
export function PestanasRentabilidad() {
  const { activa } = useBanderaMargenCostosFijos()
  const pestanas = activa ? [...PESTANAS_RENTABILIDAD, PESTANA_DESPUES_DE_COSTOS_FIJOS] : PESTANAS_RENTABILIDAD
  return <PestanasPagina pestanas={pestanas} etiqueta="Secciones de Rentabilidad" />
}
