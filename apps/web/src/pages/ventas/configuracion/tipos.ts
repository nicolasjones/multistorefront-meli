import { type ComponentType } from 'react'
import type { EmpresaOpcion } from '../../../components/ventas/FormaPagoDialog'

// Tipos compartidos por la pantalla de configuración de ventas y sus pestañas. Viven aparte para que
// las pestañas no importen de `index.tsx`: si lo hicieran, `index` → pestaña → `index` sería un ciclo
// de imports (dependency-cruiser, regla `no-circular`).

export type { EmpresaOpcion }

// Lo que recibe cada pestaña de catálogo: la empresa elegida arriba, las demás empresas entre
// las que puede repartirse un alta y si la persona puede escribir (Administrador con edición).
export type PropsPestanaCatalogo = {
  empresa: EmpresaOpcion
  empresas: EmpresaOpcion[]
  puedeEditar: boolean
}

export type PestanaCatalogo = { id: string; etiqueta: string; Componente: ComponentType<PropsPestanaCatalogo> }
