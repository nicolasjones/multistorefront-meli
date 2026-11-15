import { Alert, FormHelperText, Skeleton, Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import { notaDisponible, type DepositoRepuesto } from '../../lib/reparacionItems'

type Props = {
  depositos: DepositoRepuesto[]
  // Depósito elegido; nulo mientras no hay depósitos o no se cargaron.
  valor: string | null
  // Cantidad que se carga (nula si todavía no es válida): decide el aviso de falta de stock.
  cantidad: number | null
  cargando: boolean
  error: string | null
  deshabilitado: boolean
  onElegir: (depositoId: string) => void
}

const ID_ETIQUETA = 'etiqueta-deposito-repuesto'

// Selector «Depósito de mercadería de donde se descuenta» del diálogo «Agregar repuesto» (F-SVC-10, FR-006): botones
// segmentados de los depósitos activos y la nota «Disponible en <depósito>: N u.» del prototipo.
export function SelectorDepositoRepuesto({ depositos, valor, cantidad, cargando, error, deshabilitado, onElegir }: Props) {
  const elegido = depositos.find((deposito) => deposito.deposito_id === valor) ?? null

  return (
    <Stack spacing={0.75}>
      <Typography id={ID_ETIQUETA} variant="body2" sx={{ fontWeight: 600 }}>
        Depósito de mercadería de donde se descuenta
      </Typography>
      {cargando ? <Skeleton variant="rounded" height={36} aria-label="Cargando depósitos" /> : null}
      {error ? <Alert severity="error">{error}</Alert> : null}
      {!cargando && !error && depositos.length > 0 ? (
        <ToggleButtonGroup
          exclusive
          fullWidth
          size="small"
          color="primary"
          value={valor}
          disabled={deshabilitado}
          aria-labelledby={ID_ETIQUETA}
          onChange={(_evento, nuevo: string | null) => nuevo && onElegir(nuevo)}
        >
          {depositos.map((deposito) => (
            <ToggleButton key={deposito.deposito_id} value={deposito.deposito_id} sx={{ textTransform: 'none' }}>
              {deposito.nombre}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      ) : null}
      {!cargando && !error && depositos.length === 0 ? (
        <FormHelperText error>No hay depósitos activos: pedile a un administrador que active uno.</FormHelperText>
      ) : null}
      {elegido ? (
        <FormHelperText aria-live="polite" error={cantidad !== null && elegido.disponible < cantidad}>
          {notaDisponible(elegido, cantidad)}
        </FormHelperText>
      ) : null}
    </Stack>
  )
}
