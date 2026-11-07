import { useState } from 'react'
import { Alert, Button, Dialog, DialogActions, DialogContent, Stack, Typography } from '@mui/material'
import { useEjecutarEdicionMasiva } from '../../hooks/useEjecutarEdicionMasiva'
import { avisoResultado, definirEmpresasProductos, productosN } from '../../lib/edicionMasiva'
import { supabaseClient } from '../../lib/supabase'
import { SelectorEmpresas, type EmpresaSeleccion } from '../base/SelectorEmpresas'
import { TituloDialogo } from '../base/TituloDialogo'

type Props = {
  open: boolean
  ids: readonly string[]
  empresas: ReadonlyArray<EmpresaSeleccion>
  cargandoEmpresas?: boolean
  errorEmpresas?: boolean
  onCerrar: () => void
  onHecho: (aviso: string) => void
}

// «Cambiar empresas» (F-CAT-12, FR-005): «Agregar a» y «Quitar de» con `SelectorEmpresas` (casillas). A cada
// producto se le aplica (actuales ∪ agregar) − quitar; los demás vínculos no cambian. No está dibujado en el
// prototipo: mismo patrón de diálogo que «Mover de categoría».
export function CambiarEmpresasDialog({ open, ids, empresas, cargandoEmpresas = false, errorEmpresas = false, onCerrar, onHecho }: Props) {
  const [agregar, setAgregar] = useState<string[]>([])
  const [quitar, setQuitar] = useState<string[]>([])
  const { enCurso, error, ejecutar, limpiarError } = useEjecutarEdicionMasiva()
  const cerrar = () => { if (!enCurso) { limpiarError(); onCerrar() } }

  const repetidas = agregar.some((id) => quitar.includes(id))
  const sinEleccion = agregar.length === 0 && quitar.length === 0

  const confirmar = async () => {
    const cambiados = await ejecutar(() => definirEmpresasProductos(supabaseClient, ids, agregar, quitar))
    if (cambiados === null) return
    onHecho(avisoResultado(cambiados, { singular: 'actualizado', plural: 'actualizados' }))
  }

  return (
    <Dialog open={open} onClose={cerrar} fullWidth maxWidth="sm" aria-labelledby="titulo-cambiar-empresas">
      <TituloDialogo id="titulo-cambiar-empresas" onCerrar={cerrar}>Cambiar empresas</TituloDialogo>
      <DialogContent>
        <Stack spacing={2}>
          <Typography variant="body2">
            Elegí en qué empresas se publican o dejan de publicarse {productosN(ids.length)}. Las demás empresas de cada producto no cambian.
          </Typography>
          {error ? <Alert severity="error">{error}</Alert> : null}
          <SelectorEmpresas
            etiqueta="Agregar a"
            empresas={empresas}
            seleccion={agregar}
            onCambiar={setAgregar}
            cargando={cargandoEmpresas}
            hayError={errorEmpresas}
            deshabilitado={enCurso}
          />
          <SelectorEmpresas
            etiqueta="Quitar de"
            empresas={empresas}
            seleccion={quitar}
            onCambiar={setQuitar}
            cargando={cargandoEmpresas}
            hayError={errorEmpresas}
            deshabilitado={enCurso}
            error={repetidas ? 'Una empresa no puede estar a la vez en «Agregar a» y en «Quitar de».' : undefined}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={cerrar} disabled={enCurso}>Cancelar</Button>
        <Button variant="contained" onClick={() => void confirmar()} disabled={enCurso || sinEleccion || repetidas}>
          Aplicar a {productosN(ids.length)}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
