import { useParams } from 'react-router'
import { Box } from '@mui/material'
import { EstadoCargaPagina, EstadoError } from '../../components/estados/EstadosPagina'
import { usePuedeEscribir } from '../../hooks/usePuedeEscribir'
import { obtenerEntidad } from './entidades/registro'
import { AsistenteImportacion } from './AsistenteImportacion'

// FR-010: ruta canónica `/migracion/importar/:entidad`, una pantalla por
// entidad que reutiliza el asistente genérico. Solo Administrador (FR-009):
// la base vuelve a imponerlo en cada RPC.
export function MigracionImportar() {
  const { entidad } = useParams<{ entidad: string }>()
  const definicion = obtenerEntidad(entidad)
  const { puedeEscribir, isLoading } = usePuedeEscribir()

  if (isLoading) return <EstadoCargaPagina />
  if (!puedeEscribir) {
    return (
      <Box sx={{ m: 2 }}>
        <EstadoError
          titulo="Sin permiso"
          descripcion="Solo un administrador de la organización puede importar datos desde el panel actual."
        />
      </Box>
    )
  }
  if (!definicion) {
    return (
      <Box sx={{ m: 2 }}>
        <EstadoError
          titulo="Entidad desconocida"
          descripcion="La entidad de migración no existe. Volvé a intentarlo desde Clientes."
        />
      </Box>
    )
  }
  // `key`: al pasar de una entidad a la siguiente (p. ej. proveedores → vínculos) el asistente arranca limpio.
  return <AsistenteImportacion key={definicion.id} definicion={definicion} />
}
