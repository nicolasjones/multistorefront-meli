import { useContextoPanel } from './useContextoPanel'

// Quien puede fijar el descuento de un cliente (F-VTA-32). Solo oculta el campo: la base rechaza el
// cambio de cualquier otro rol (disparador clientes_descuento_solo_admin).
export function useEsAdministrador() {
  const { contexto, isLoading } = useContextoPanel()
  return { esAdministrador: Boolean(contexto?.es_superadmin || contexto?.rol_efectivo === 'administrador'), isLoading }
}
