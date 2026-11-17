import { type FormEvent, useRef, useState } from 'react'
import {
  Alert, Button, Dialog, DialogActions, DialogContent, FormControlLabel, MenuItem, Stack, Switch, TextField, ToggleButton,
  ToggleButtonGroup,
} from '@mui/material'
import { SelectorEmpresas } from '../../components/base/SelectorEmpresas'
import { TituloDialogo } from '../../components/base/TituloDialogo'
import {
  CATEGORIAS_GASTO,
  DETALLE_MAX,
  type CategoriaGasto,
  type Gasto,
  type MonedaGasto,
  type TipoCostoGasto,
  TIPO_POR_OMISION,
  guardarGasto,
  mensajeDeErrorGasto,
  parsearImporteGasto,
  soloCaracteresDeImporte,
  validarGasto,
} from '../../lib/gastos'
import { hoyEnOrganizacion } from '../../lib/periodosRanking'

type EmpresaOpcion = { id: string; nombre: string }

type Props = {
  // null = alta; con gasto = edición.
  gasto: Gasto | null
  empresas: ReadonlyArray<EmpresaOpcion>
  // Tienda preseleccionada en el alta (la activa de la barra superior; con «Todas» hay que elegir una).
  empresaInicialId: string | null
  onCerrar: () => void
  onGuardado: (alta: boolean) => void
}

const importeATexto = (valor: number) => String(valor).replace('.', ',')

// Diálogo «Nuevo gasto» / «Editar gasto» (prototipo VentasGastos + adiciones declaradas: moneda, tipo de costo, recurrente y tienda).
// La autoridad es la base (permiso `edicion`, cotización congelada, bloqueo optimista). El dueño lo MONTA al abrir y lo desmonta al
// cerrar o al cambiar la empresa activa: nunca guarda datos cargados bajo otra empresa (Principio VIII).
export function DialogoGasto({ gasto, empresas, empresaInicialId, onCerrar, onGuardado }: Props) {
  const [categoria, setCategoria] = useState<CategoriaGasto | ''>(gasto?.categoria ?? '')
  const [tipoCosto, setTipoCosto] = useState<TipoCostoGasto>(gasto?.tipoCosto ?? 'fijo')
  const [detalle, setDetalle] = useState(gasto?.detalle ?? '')
  const [moneda, setMoneda] = useState<MonedaGasto>(gasto?.moneda ?? 'ARS')
  const [importeTexto, setImporteTexto] = useState(gasto ? importeATexto(gasto.importe) : '')
  const [fecha, setFecha] = useState(gasto?.fecha ?? hoyEnOrganizacion())
  const [recurrente, setRecurrente] = useState(gasto?.recurrente ?? false)
  const [empresaIds, setEmpresaIds] = useState<string[]>(
    gasto ? [gasto.empresaId] : empresaInicialId && empresas.some((e) => e.id === empresaInicialId) ? [empresaInicialId] : [],
  )
  const [intento, setIntento] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const enCurso = useRef(false)

  const errores = validarGasto({ fecha, categoria, importeTexto, detalle, empresaIds })
  const hayErrores = Object.keys(errores).length > 0

  const elegirCategoria = (siguiente: CategoriaGasto) => {
    setCategoria(siguiente)
    setTipoCosto(TIPO_POR_OMISION[siguiente])
  }

  const enviar = async (evento: FormEvent) => {
    evento.preventDefault()
    setIntento(true)
    const importe = parsearImporteGasto(importeTexto)
    if (hayErrores || importe === null || categoria === '' || enCurso.current) return
    enCurso.current = true
    setGuardando(true)
    setError(null)
    try {
      await guardarGasto({
        id: gasto?.id ?? null, empresaId: empresaIds[0], fecha, categoria, tipoCosto, detalle, importe, moneda, recurrente,
        actualizadoEn: gasto?.actualizadoEn ?? null,
      })
      onGuardado(gasto === null)
    } catch (fallo) {
      setError(mensajeDeErrorGasto(fallo as { code?: string; message?: string }))
    } finally {
      enCurso.current = false
      setGuardando(false)
    }
  }

  return (
    <Dialog open onClose={guardando ? undefined : onCerrar} fullWidth maxWidth="sm" aria-labelledby="titulo-gasto">
      <form onSubmit={(evento) => void enviar(evento)} noValidate>
        <TituloDialogo id="titulo-gasto" onCerrar={guardando ? undefined : onCerrar}>
          {gasto ? 'Editar gasto' : 'Nuevo gasto'}
        </TituloDialogo>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {error ? <Alert severity="error">{error}</Alert> : null}
            <TextField
              select
              label="Concepto"
              value={categoria}
              onChange={(evento) => elegirCategoria(evento.target.value as CategoriaGasto)}
              error={intento && Boolean(errores.categoria)}
              helperText={intento && errores.categoria ? errores.categoria : undefined}
              required
              autoFocus
            >
              {CATEGORIAS_GASTO.map((c) => <MenuItem key={c} value={c}>{c}</MenuItem>)}
            </TextField>
            <ToggleButtonGroup
              exclusive
              size="small"
              aria-label="Tipo de costo"
              value={tipoCosto}
              onChange={(_, siguiente: TipoCostoGasto | null) => { if (siguiente) setTipoCosto(siguiente) }}
            >
              <ToggleButton value="fijo">Costo fijo</ToggleButton>
              <ToggleButton value="variable">Costo variable</ToggleButton>
            </ToggleButtonGroup>
            <TextField
              label="Detalle"
              value={detalle}
              onChange={(evento) => setDetalle(evento.target.value)}
              error={Boolean(errores.detalle)}
              helperText={errores.detalle ?? 'Opcional. Por ejemplo: Internet y telefonía.'}
              slotProps={{ htmlInput: { maxLength: DETALLE_MAX, autoComplete: 'off' } }}
            />
            <ToggleButtonGroup
              exclusive
              size="small"
              aria-label="Moneda"
              value={moneda}
              onChange={(_, siguiente: MonedaGasto | null) => { if (siguiente) setMoneda(siguiente) }}
            >
              <ToggleButton value="ARS">Pesos (ARS)</ToggleButton>
              <ToggleButton value="USD">Dólares (USD)</ToggleButton>
            </ToggleButtonGroup>
            <TextField
              label="Importe"
              value={importeTexto}
              onChange={(evento) => setImporteTexto(soloCaracteresDeImporte(evento.target.value))}
              error={(intento || importeTexto !== '') && Boolean(errores.importe)}
              helperText={(intento || importeTexto !== '') && errores.importe
                ? errores.importe
                : moneda === 'USD' ? 'Se convierte a pesos con el dólar de la tienda más cercano a la fecha.' : 'En pesos, con hasta 2 decimales.'}
              required
              slotProps={{ htmlInput: { inputMode: 'decimal', autoComplete: 'off' } }}
            />
            <TextField
              label="Fecha"
              type="date"
              value={fecha}
              onChange={(evento) => setFecha(evento.target.value)}
              error={Boolean(errores.fecha)}
              helperText={errores.fecha ?? 'El mes de la fecha es el mes al que se imputa el gasto.'}
              required
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <FormControlLabel
              control={<Switch checked={recurrente} onChange={(evento) => setRecurrente(evento.target.checked)} />}
              label="Recurrente (se repite todos los meses)"
            />
            <SelectorEmpresas
              etiqueta="Tienda"
              unica
              empresas={empresas}
              seleccion={empresaIds}
              onCambiar={setEmpresaIds}
              deshabilitado={guardando}
              ayuda="Un gasto es de una sola tienda."
              error={intento ? errores.empresa : undefined}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onCerrar} disabled={guardando}>Cancelar</Button>
          <Button type="submit" variant="contained" disabled={guardando}>
            {guardando ? 'Guardando…' : 'Guardar gasto'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}
