import { Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'

type FiltroTiendaConsultasProps = {
  empresas: ReadonlyArray<{ id: string; nombre: string }>
  valor: string | null
  /** Hay una empresa concreta en la barra superior: los chips la muestran y no se pueden cambiar. */
  bloqueado: boolean
  onCambiar: (empresaId: string | null) => void
  cargando?: boolean
  hayError?: boolean
}

// Fila «Tienda» de `Consultas.dc.html` (`{{tFilt}}`): «Todas las tiendas» y una chip por empresa
// accesible, con la nota del prototipo. La empresa activa de la barra superior es la única
// fuente de verdad (Principio VIII, FR-008): con una empresa concreta los chips quedan
// bloqueados en ella; con «Todas mis empresas» filtran entre las accesibles.
export function FiltroTiendaConsultas({ empresas, valor, bloqueado, onCambiar, cargando = false, hayError = false }: FiltroTiendaConsultasProps) {
  if (cargando) return null
  if (hayError) {
    return <Typography variant="xs" color="text.secondary">No pudimos cargar las tiendas para filtrar.</Typography>
  }
  if (empresas.length === 0) return null

  return (
    <Stack direction="row" spacing={1.25} alignItems="center" useFlexGap flexWrap="wrap">
      <Typography component="span" variant="s" sx={{ fontWeight: 600 }}>Tienda</Typography>
      <ToggleButtonGroup
        exclusive
        size="small"
        aria-label="Filtrar por tienda"
        value={valor ?? 'todas'}
        disabled={bloqueado}
        onChange={(_, nuevo: string | null) => {
          if (nuevo === null) return
          onCambiar(nuevo === 'todas' ? null : nuevo)
        }}
        sx={{ flexWrap: 'wrap' }}
      >
        <ToggleButton value="todas">Todas las tiendas</ToggleButton>
        {empresas.map((empresa) => (
          <ToggleButton key={empresa.id} value={empresa.id}>{empresa.nombre}</ToggleButton>
        ))}
      </ToggleButtonGroup>
      <Typography variant="xs">
        Cada consulta llega por el formulario o el WhatsApp de una tienda. Si elegís una empresa en la barra superior, se filtra por esa tienda.
      </Typography>
    </Stack>
  )
}
