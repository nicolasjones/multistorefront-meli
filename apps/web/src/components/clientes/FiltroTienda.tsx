import { Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'

type FiltroTiendaProps = {
  empresas: ReadonlyArray<{ id: string; nombre: string }>
  valor: string | null
  onCambiar: (empresaId: string | null) => void
  cargando?: boolean
  hayError?: boolean
}

// Filtro por tienda (F-CLI-11, `{{tFilt}}` del prototipo): fila de chips con
// «Todas las tiendas» y una por empresa a la que la persona tiene acceso. Es sólo
// presentación: el valor lo maneja la pantalla y lo aplican el listado, el ranking
// y la exportación (el prototipo filtra toda la pantalla). Si el catálogo falla,
// la pantalla sigue sin filtro en vez de romperse.
export function FiltroTienda({ empresas, valor, onCambiar, cargando = false, hayError = false }: FiltroTiendaProps) {
  if (cargando) return null
  if (hayError) {
    return <Typography variant="xs" color="text.secondary">No pudimos cargar las tiendas para filtrar.</Typography>
  }
  if (empresas.length === 0) return null

  return (
    <Stack spacing={0.5}>
      <Stack direction="row" spacing={1.25} alignItems="center" useFlexGap flexWrap="wrap">
        <Typography component="span" variant="s" sx={{ fontWeight: 600 }}>Tienda</Typography>
        <ToggleButtonGroup
          exclusive
          size="small"
          aria-label="Filtrar por tienda"
          value={valor ?? 'todas'}
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
      </Stack>
      <Typography variant="xs">Un cliente es de la organización y se habilita en una o más tiendas.</Typography>
    </Stack>
  )
}
