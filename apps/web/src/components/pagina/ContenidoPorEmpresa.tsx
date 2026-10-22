import { Fragment, type ReactNode } from 'react'
import { useVersionEmpresaActiva } from '../../hooks/useVersionEmpresaActiva'

// Al cambiar la empresa activa, remonta la pantalla ruteada: los hooks vuelven
// a pedir datos, se resetean paginación/selección y se cierran los diálogos
// abiertos. El encabezado (con el selector) queda montado.
export function ContenidoPorEmpresa({ children }: { children: ReactNode }) {
  const version = useVersionEmpresaActiva()
  return <Fragment key={version}>{children}</Fragment>
}
