import type { AyudaPorDestino } from '../tipos'
import { ayudaAdministracion } from './administracion'
import { ayudaAnalisis } from './analisis'
import { ayudaCanales } from './canales'
import { ayudaCatalogo } from './catalogo'
import { ayudaContactos } from './contactos'
import { ayudaInicio } from './inicio'
import { ayudaPlataforma } from './plataforma'
import { ayudaReportes } from './reportes'
import { ayudaService } from './service'
import { ayudaStock } from './stock'
import { ayudaVentas } from './ventas'

// Un módulo por sección del menú; la clave de cada entrada es el `id` del destino en `SECCIONES_PANEL`.
export const AYUDA_POR_DESTINO: AyudaPorDestino = {
  ...ayudaInicio,
  ...ayudaCatalogo,
  ...ayudaStock,
  ...ayudaVentas,
  ...ayudaService,
  ...ayudaContactos,
  ...ayudaCanales,
  ...ayudaAnalisis,
  ...ayudaReportes,
  ...ayudaAdministracion,
  ...ayudaPlataforma,
}
