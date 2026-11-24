import { useMemo, useRef, useState, type FormEvent } from 'react'
import { Alert, Button, Dialog, DialogActions, DialogContent, Stack, TextField, Typography } from '@mui/material'
import { TituloDialogo } from '../base/TituloDialogo'
import { formatearImporte } from '../../lib/formatoImporte'
import {
  LARGO_DESCRIPCION,
  LARGO_NOMBRE,
  NOTA_LISTA_REEMPLAZA_AJUSTE,
  PRECIO_EJEMPLO,
  ejemploAjuste,
  mensajeErrorLista,
  parsearAjuste,
  validarLista,
  type DatosLista,
  type ErroresLista,
  type ListaPrecios,
} from '../../lib/listasPrecios'

type Props = {
  // null = alta.
  lista: ListaPrecios | null
  onCancelar: () => void
  // Rechaza con el error de la base; el diálogo queda abierto para reintentar.
  onGuardar: (datos: DatosLista) => Promise<void>
}


// Diálogo «Nueva lista» / «Editar lista» (F-PRE-14, RF-PRE-14-5). Las listas son de toda la organización: el diálogo no usa la
// empresa activa. El ejemplo es ilustrativo (no consulta la base). La base valida rol, bandera, nombre único y rango.
export function FormularioListaPrecios({ lista, onCancelar, onGuardar }: Props) {
  const editando = lista !== null
  const [nombre, setNombre] = useState(() => lista?.nombre ?? '')
  const [descripcion, setDescripcion] = useState(() => lista?.descripcion ?? '')
  const [ajuste, setAjuste] = useState(() => (lista ? String(lista.ajustePct).replace('.', ',') : ''))
  const [errores, setErrores] = useState<ErroresLista>({})
  const [errorServidor, setErrorServidor] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const enVuelo = useRef(false)

  const ajusteNumerico = useMemo(() => parsearAjuste(ajuste), [ajuste])

  const limpiar = (campo: keyof ErroresLista) => {
    if (errores[campo]) setErrores((previos) => ({ ...previos, [campo]: undefined }))
  }

  const enviar = async (evento: FormEvent) => {
    evento.preventDefault()
    if (enVuelo.current) return
    setErrorServidor(null)
    const datos: DatosLista = { id: lista?.id ?? null, nombre, descripcion, ajusteTexto: ajuste, actualizadoEn: lista?.actualizadoEn ?? null }
    const invalidos = validarLista(datos)
    setErrores(invalidos)
    if (Object.keys(invalidos).length > 0) return
    enVuelo.current = true
    setGuardando(true)
    try {
      await onGuardar(datos)
    } catch (error) {
      console.error('No pudimos guardar la lista de precios.', error)
      setErrorServidor(mensajeErrorLista(error, 'No pudimos guardar la lista. Probá de nuevo.'))
    } finally {
      enVuelo.current = false
      setGuardando(false)
    }
  }

  return (
    <Dialog open onClose={guardando ? undefined : onCancelar} fullWidth maxWidth="sm" aria-labelledby="lista-precios-titulo">
      <TituloDialogo id="lista-precios-titulo" onCerrar={guardando ? undefined : onCancelar}>
        {editando ? 'Editar lista' : 'Nueva lista'}
      </TituloDialogo>
      <form onSubmit={enviar} noValidate>
        <DialogContent>
          <Stack spacing={2}>
            {errorServidor ? <Alert severity="error">{errorServidor}</Alert> : null}
            <TextField
              label="Nombre"
              value={nombre}
              onChange={(evento) => { setNombre(evento.target.value); limpiar('nombre') }}
              error={Boolean(errores.nombre)}
              helperText={errores.nombre ?? 'Por ejemplo «Revendedores». No puede repetirse en la organización.'}
              required
              autoFocus
              autoComplete="off"
              fullWidth
              slotProps={{ htmlInput: { maxLength: LARGO_NOMBRE + 20 } }}
            />
            <TextField
              label="Descripción"
              value={descripcion}
              onChange={(evento) => { setDescripcion(evento.target.value); limpiar('descripcion') }}
              error={Boolean(errores.descripcion)}
              helperText={errores.descripcion ?? 'Opcional.'}
              autoComplete="off"
              multiline
              minRows={2}
              fullWidth
              slotProps={{ htmlInput: { maxLength: LARGO_DESCRIPCION + 20 } }}
            />
            <TextField
              label="Ajuste sobre el precio central (%)"
              value={ajuste}
              onChange={(evento) => { setAjuste(evento.target.value); limpiar('ajuste') }}
              error={Boolean(errores.ajuste)}
              helperText={errores.ajuste ?? 'Negativo = descuento, positivo = recargo. De -90 a +100, con hasta 2 decimales.'}
              required
              autoComplete="off"
              fullWidth
              slotProps={{ htmlInput: { inputMode: 'decimal' } }}
            />
            <Typography variant="body2" color="text.secondary" aria-live="polite">
              {ajusteNumerico === null
                ? 'Escribí el porcentaje para ver un ejemplo.'
                : `Ejemplo ilustrativo: un producto de ${formatearImporte(PRECIO_EJEMPLO)} queda en ${ejemploAjuste(ajusteNumerico)}.`}
            </Typography>
            <Alert severity="info" role="note">{NOTA_LISTA_REEMPLAZA_AJUSTE}</Alert>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onCancelar} disabled={guardando}>Cancelar</Button>
          <Button type="submit" variant="contained" disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar'}</Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}
