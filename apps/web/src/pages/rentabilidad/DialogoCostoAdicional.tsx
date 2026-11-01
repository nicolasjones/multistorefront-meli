import { type FormEvent, useRef, useState } from 'react'
import {
  Alert, Button, Dialog, DialogActions, DialogContent, InputAdornment, Stack, TextField, ToggleButton,
  ToggleButtonGroup,
} from '@mui/material'
import { SelectorEmpresas } from '../../components/base/SelectorEmpresas'
import { TituloDialogo } from '../../components/base/TituloDialogo'
import { supabaseClient } from '../../lib/supabase'
import {
  type CostoAdicional,
  TIPOS_COSTO,
  type TipoCostoAdicional,
  guardarCostoAdicional,
  mensajeDeErrorCosto,
  parsearValorCosto,
  soloCaracteresDeValor,
  validarCostoAdicional,
  valorATexto,
} from '../../lib/costosAdicionales'

type EmpresaOpcion = { id: string; nombre: string }

type Props = {
  // null = alta; con costo = edición (la empresa no cambia).
  costo: CostoAdicional | null
  empresas: ReadonlyArray<EmpresaOpcion>
  // Empresa preseleccionada en el alta (la activa de la barra superior, si hay una).
  empresaInicialId: string | null
  onCerrar: () => void
  // Se llama tras guardar (total o parcialmente) para que el dueño recargue la lista.
  onGuardado: (resultado: { alta: boolean; nombre: string; cantidad: number }) => void
}

// Diálogo «Nuevo / Editar costo adicional» (F-REN-08, FR-004). No está en el prototipo: usa el patrón
// de sus diálogos (campos, `Cancelar`, `Guardar`) y `SelectorEmpresas` en «Aplica a». La autoridad es la
// base (permiso `edicion`, nombre único por empresa, rangos); acá se valida antes de viajar. El dueño
// lo MONTA al abrir y lo desmonta al cerrar (o al cambiar la empresa activa): nunca guarda datos
// cargados bajo otra empresa (Principio VIII).
export function DialogoCostoAdicional({ costo, empresas, empresaInicialId, onCerrar, onGuardado }: Props) {
  const [nombre, setNombre] = useState(costo?.nombre ?? '')
  const [tipo, setTipo] = useState<TipoCostoAdicional>(costo?.tipo ?? 'porcentaje')
  const [valorTexto, setValorTexto] = useState(costo ? valorATexto(costo.valor) : '')
  const [empresaIds, setEmpresaIds] = useState<string[]>(
    costo ? [costo.empresaId] : empresaInicialId && empresas.some((e) => e.id === empresaInicialId) ? [empresaInicialId] : [],
  )
  const [intento, setIntento] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  // Guarda síncrona contra el doble clic: el estado tarda un render en deshabilitar el botón.
  const enCurso = useRef(false)

  const errores = validarCostoAdicional({ nombre, tipo, valorTexto, empresaIds })
  const hayErrores = Object.keys(errores).length > 0
  const enEdicion = costo !== null

  const enviar = async (evento: FormEvent) => {
    evento.preventDefault()
    setIntento(true)
    const valor = parsearValorCosto(valorTexto)
    if (hayErrores || valor === null || enCurso.current) return
    enCurso.current = true
    setGuardando(true)
    setError(null)
    // Una llamada por empresa (la RPC guarda un costo por empresa). Si alguna falla, las ya guardadas
    // quedan y el diálogo sigue abierto con las que faltan.
    const fallidas: { id: string; mensaje: string }[] = []
    let guardadas = 0
    for (const empresaId of empresaIds) {
      try {
        await guardarCostoAdicional(supabaseClient, { id: costo?.id ?? null, empresaId, nombre, tipo, valor })
        guardadas += 1
      } catch (fallo) {
        const empresaNombre = empresas.find((e) => e.id === empresaId)?.nombre ?? costo?.empresaNombre
        fallidas.push({ id: empresaId, mensaje: `${empresaNombre ? `${empresaNombre}: ` : ''}${mensajeDeErrorCosto(fallo as { code?: string }, empresaNombre)}` })
      }
    }
    enCurso.current = false
    setGuardando(false)
    if (fallidas.length === 0) {
      onGuardado({ alta: !enEdicion, nombre: nombre.trim(), cantidad: guardadas })
      return
    }
    setError(fallidas.map((f) => f.mensaje).join(' '))
    setEmpresaIds(fallidas.map((f) => f.id))
    if (guardadas > 0) onGuardado({ alta: !enEdicion, nombre: nombre.trim(), cantidad: guardadas })
  }

  const sufijo = tipo === 'porcentaje' ? '%' : '$'

  return (
    <Dialog open onClose={guardando ? undefined : onCerrar} fullWidth maxWidth="sm" aria-labelledby="titulo-costo-adicional">
      <form onSubmit={(evento) => void enviar(evento)} noValidate>
        <TituloDialogo id="titulo-costo-adicional" onCerrar={guardando ? undefined : onCerrar}>
          {enEdicion ? 'Editar costo adicional' : 'Nuevo costo adicional'}
        </TituloDialogo>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {error ? <Alert severity="error">{error}</Alert> : null}
            <TextField
              label="Nombre"
              value={nombre}
              onChange={(evento) => setNombre(evento.target.value)}
              error={intento && Boolean(errores.nombre)}
              helperText={intento && errores.nombre ? errores.nombre : 'Por ejemplo: Envío o Impuestos.'}
              required
              autoFocus
              slotProps={{ htmlInput: { maxLength: 80, autoComplete: 'off' } }}
            />
            <ToggleButtonGroup
              exclusive
              size="small"
              aria-label="Tipo de costo"
              value={tipo}
              onChange={(_, siguiente: TipoCostoAdicional | null) => { if (siguiente) setTipo(siguiente) }}
            >
              {TIPOS_COSTO.map(({ valor, etiqueta }) => <ToggleButton key={valor} value={valor}>{etiqueta}</ToggleButton>)}
            </ToggleButtonGroup>
            <TextField
              label={tipo === 'porcentaje' ? 'Porcentaje sobre el neto' : 'Monto por unidad'}
              value={valorTexto}
              onChange={(evento) => setValorTexto(soloCaracteresDeValor(evento.target.value))}
              error={(intento || valorTexto !== '') && Boolean(errores.valor)}
              helperText={(intento || valorTexto !== '') && errores.valor ? errores.valor : tipo === 'porcentaje' ? 'Se descuenta del precio neto sin IVA.' : 'Pesos que se descuentan por cada unidad.'}
              required
              slotProps={{
                htmlInput: { inputMode: 'decimal', autoComplete: 'off' },
                input: tipo === 'porcentaje'
                  ? { endAdornment: <InputAdornment position="end">{sufijo}</InputAdornment> }
                  : { startAdornment: <InputAdornment position="start">{sufijo}</InputAdornment> },
              }}
            />
            <SelectorEmpresas
              etiqueta="Aplica a"
              empresas={empresas}
              seleccion={empresaIds}
              onCambiar={setEmpresaIds}
              deshabilitado={enEdicion || guardando}
              ayuda={enEdicion ? 'Un costo no cambia de empresa: dalo de baja y creá otro.' : 'Se crea un costo en cada empresa marcada.'}
              error={intento ? errores.empresas : undefined}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onCerrar} disabled={guardando}>Cancelar</Button>
          <Button type="submit" variant="contained" disabled={guardando}>
            {guardando ? 'Guardando…' : 'Guardar'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}
