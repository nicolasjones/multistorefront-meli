import type { ReactNode } from 'react'
import { Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'

export type EmpresaFiltro = { id: string; nombre: string }

type Props = {
  empresas: ReadonlyArray<EmpresaFiltro>
  valor: string | null
  onCambiar: (empresaId: string | null) => void
  etiqueta?: string
  textoAyuda?: ReactNode
  cargando?: boolean
  hayError?: boolean
  ariaLabel?: string
}

const TODAS = 'todas'

// Filtro de empresa/tienda de una pantalla (F-CLI-11, F-CAT-07 y siguientes). Es una única pieza para
// que todas las pantallas usen las mismas píldoras que Cuentas de cobro: «Todas las tiendas» o una
// empresa, con el valor controlado por la pantalla. No cambia la empresa activa de la barra superior.
export function FiltroEmpresa({
  empresas,
  valor,
  onCambiar,
  etiqueta = 'Tienda',
  textoAyuda,
  cargando = false,
  hayError = false,
  ariaLabel = 'Filtrar por tienda',
}: Props) {
  if (cargando) return null
  if (hayError) {
    return <Typography variant="xs" color="text.secondary">No pudimos cargar las tiendas para filtrar.</Typography>
  }
  if (empresas.length === 0) return null

  return (
    <Stack spacing={0.5}>
      <Stack direction="row" spacing={1.25} alignItems="center" useFlexGap flexWrap="wrap">
        <Typography component="span" variant="s" sx={{ fontWeight: 600 }}>{etiqueta}</Typography>
        <ToggleButtonGroup
          exclusive
          size="small"
          aria-label={ariaLabel}
          value={valor ?? TODAS}
          onChange={(_, nuevo: string | null) => {
            if (nuevo === null) {
              // Volver a tocar «Todas las tiendas» no cambia nada, pero deja el filtro limpio.
              if (valor === null) onCambiar(null)
              return
            }
            onCambiar(nuevo === TODAS ? null : nuevo)
          }}
          sx={{ flexWrap: 'wrap' }}
        >
          <ToggleButton value={TODAS}>Todas las tiendas</ToggleButton>
          {empresas.map((empresa) => (
            <ToggleButton key={empresa.id} value={empresa.id}>{empresa.nombre}</ToggleButton>
          ))}
        </ToggleButtonGroup>
      </Stack>
      {textoAyuda ? <Typography variant="xs">{textoAyuda}</Typography> : null}
    </Stack>
  )
}
