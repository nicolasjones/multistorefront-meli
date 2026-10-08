import { useState } from 'react'
import { IconButton, Stack, Tooltip, Typography, type TypographyProps } from '@mui/material'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import CheckIcon from '@mui/icons-material/Check'

// contracts/identidades-presentacion.md: ninguna superficie muestra un UUID
// como contenido principal, fallback ni aria-label de una persona u
// organización. `estado` fija el texto cuando no hay nada que resolver
// (eliminada/sistema/no_disponible); en `resuelta` (default) el texto sale
// de nombre/apellido con el mismo criterio en toda la app.
export type EstadoIdentidad = 'resuelta' | 'incompleta' | 'eliminada' | 'sistema' | 'no_disponible'
export type TipoOrigenIdentidad = 'persona' | 'organizacion' | 'reporte' | 'sistema'

const TEXTO_POR_ESTADO_FIJO: Partial<Record<EstadoIdentidad, string>> = {
  eliminada: 'Usuario eliminado',
  sistema: 'Sistema',
  no_disponible: 'Organización no disponible',
}

export function resolverNombreVisible(
  persona: { nombre?: string | null; apellido?: string | null },
  estado: EstadoIdentidad = 'resuelta',
  tipoOrigen: TipoOrigenIdentidad = 'persona',
): { nombreVisible: string; estadoIdentidad: EstadoIdentidad } {
  const textoFijo = TEXTO_POR_ESTADO_FIJO[estado]
  if (textoFijo) return { nombreVisible: textoFijo, estadoIdentidad: estado }

  const nombre = persona.nombre?.trim() || ''
  const apellido = persona.apellido?.trim() || ''

  // Organización/reporte no tienen "apellido": un único nombre ya está
  // resuelto, no es una persona con datos parciales (T028).
  if (tipoOrigen !== 'persona') {
    if (nombre) return { nombreVisible: nombre, estadoIdentidad: 'resuelta' }
    return { nombreVisible: TEXTO_POR_ESTADO_FIJO.no_disponible as string, estadoIdentidad: 'no_disponible' }
  }

  if (nombre && apellido) return { nombreVisible: `${nombre} ${apellido}`, estadoIdentidad: 'resuelta' }
  if (nombre || apellido) return { nombreVisible: nombre || apellido, estadoIdentidad: 'incompleta' }
  return { nombreVisible: 'Perfil sin completar', estadoIdentidad: 'incompleta' }
}

type CopiarIdentificadorTecnicoProps = {
  /** Identificador técnico real. El botón no se renderiza sin esto. */
  idTecnico?: string | null
  /** Espejo de `contexto.puede_copiar_identificador_tecnico` (RPC contexto_panel_actual) -- verdadero solo para superadmin. El botón no se renderiza ni se invoca para quien no lo sea. */
  puedeCopiar: boolean
  /** Nombre visible del recurso, solo para el aria-label del botón -- nunca se muestra como texto acá. */
  etiqueta: string
}

// Acción secundaria y explícita, nunca el contenido permanente de la
// pantalla (contracts/identidades-presentacion.md). Reutilizable donde el
// nombre visible ya se muestra por su cuenta (p.ej. administrar reportes) y
// donde <IdentidadVisible> la compone junto al nombre.
export function CopiarIdentificadorTecnico({ idTecnico, puedeCopiar, etiqueta }: CopiarIdentificadorTecnicoProps) {
  const [copiado, setCopiado] = useState(false)
  if (!puedeCopiar || !idTecnico) return null

  const copiar = async () => {
    await navigator.clipboard.writeText(idTecnico)
    setCopiado(true)
    window.setTimeout(() => setCopiado(false), 1500)
  }

  return (
    <Tooltip title={copiado ? 'Copiado' : 'Copiar identificador técnico'}>
      <IconButton size="small" aria-label={`Copiar identificador técnico de ${etiqueta}`} onClick={copiar}>
        {copiado ? <CheckIcon fontSize="inherit" /> : <ContentCopyIcon fontSize="inherit" />}
      </IconButton>
    </Tooltip>
  )
}

type IdentidadVisibleProps = TypographyProps & {
  nombre?: string | null
  apellido?: string | null
  estado?: EstadoIdentidad
  tipoOrigen?: TipoOrigenIdentidad
  /** Identificador técnico real. Solo se ofrece copiarlo si `puedeCopiarIdTecnico` también es verdadero. */
  idTecnico?: string | null
  /** Espejo de `contexto.puede_copiar_identificador_tecnico` (RPC contexto_panel_actual) -- verdadero solo para superadmin. */
  puedeCopiarIdTecnico?: boolean
}

// El identificador técnico nunca es el texto visible: la acción de copiarlo
// es secundaria, explícita y exclusiva de superadmin (contracts/identidades-presentacion.md).
export function IdentidadVisible({
  nombre,
  apellido,
  estado = 'resuelta',
  tipoOrigen = 'persona',
  idTecnico,
  puedeCopiarIdTecnico = false,
  ...typographyProps
}: IdentidadVisibleProps) {
  const { nombreVisible, estadoIdentidad } = resolverNombreVisible({ nombre, apellido }, estado, tipoOrigen)
  const esFallback = estadoIdentidad !== 'resuelta'

  return (
    <Stack direction="row" spacing={0.5} alignItems="center" data-tipo-origen={tipoOrigen}>
      <Typography
        component="span"
        color={esFallback ? 'text.secondary' : undefined}
        fontStyle={esFallback ? 'italic' : undefined}
        {...typographyProps}
      >
        {nombreVisible}
      </Typography>
      <CopiarIdentificadorTecnico idTecnico={idTecnico} puedeCopiar={puedeCopiarIdTecnico} etiqueta={nombreVisible} />
    </Stack>
  )
}
