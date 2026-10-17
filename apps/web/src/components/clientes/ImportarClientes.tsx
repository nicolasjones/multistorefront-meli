import { useRef, useState } from 'react'
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, LinearProgress } from '@mui/material'
import { supabaseClient } from '../../lib/supabase'
import { mensajeDeError } from '../../lib/clientes'
import { parsearCsv, plantillaCsv, type ErrorImportacion, type FilaImportacion } from '../../lib/importarClientes'

type Estado = 'cerrado' | 'revisando' | 'importando' | 'listo' | 'error'

const LOTE = 100

// Botón «Importar» con plantilla CSV, vista previa con errores por fila y alta masiva
// (prototipo Clientes · Listado, diálogo Importar). Los números existentes se actualizan;
// los nuevos se crean (el número lo asigna la base). Sin DNI/CUIT no se importa la fila.
export function ImportarClientes({ alTerminar }: { alTerminar?: () => void }) {
  const [estado, setEstado] = useState<Estado>('cerrado')
  const [filas, setFilas] = useState<FilaImportacion[]>([])
  const [errores, setErrores] = useState<ErrorImportacion[]>([])
  const [avance, setAvance] = useState({ hechos: 0, total: 0 })
  const [resultado, setResultado] = useState('')
  const [mensajeError, setMensajeError] = useState('')
  const cancelar = useRef(false)

  const elegirArchivo = async (archivo: File | undefined) => {
    if (!archivo) return
    const { filas: ok, errores: mal } = parsearCsv(await archivo.text())
    setFilas(ok)
    setErrores(mal)
    setEstado('revisando')
  }

  const descargarPlantilla = () => {
    const blob = new Blob([plantillaCsv()], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'clientes.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const importar = async () => {
    cancelar.current = false
    setEstado('importando')
    setAvance({ hechos: 0, total: filas.length })
    try {
      const numeros = filas.map((f) => f.numero).filter((n): n is number => n !== null)
      let existentes = new Map<number, string>()
      if (numeros.length > 0) {
        const { data, error } = await supabaseClient.from('clientes').select('id,numero').in('numero', numeros)
        if (error) throw new Error(error.message)
        existentes = new Map((data ?? []).map((c: { id: string; numero: number }) => [c.numero, c.id]))
      }
      let nuevos = 0, actualizados = 0
      for (let i = 0; i < filas.length; i += LOTE) {
        if (cancelar.current) { setEstado('cerrado'); return }
        const lote = filas.slice(i, i + LOTE)
        const paraActualizar = lote.filter((f) => f.numero !== null && existentes.has(f.numero as number))
        const paraCrear = lote.filter((f) => !(f.numero !== null && existentes.has(f.numero as number)))
        for (const f of paraActualizar) {
          const { fila: _f, numero: _n, ...valores } = f
          const { error } = await supabaseClient.from('clientes').update(valores).eq('id', existentes.get(f.numero as number))
          if (error) throw new Error(error.message)
          actualizados++
        }
        if (paraCrear.length > 0) {
          const { error } = await supabaseClient.from('clientes').insert(
            paraCrear.map(({ fila: _f, numero: _n, ...valores }) => valores),
          )
          if (error) throw new Error(error.message)
          nuevos += paraCrear.length
        }
        setAvance({ hechos: Math.min(i + LOTE, filas.length), total: filas.length })
      }
      const partes = [`${nuevos} nuevos`, `${actualizados} actualizados`]
      if (errores.length > 0) partes.push(`${errores.length} con error (no se importaron)`)
      setResultado(`Importación lista: ${partes.join(', ')}.`)
      setEstado('listo')
      alTerminar?.()
    } catch (error) {
      setMensajeError(mensajeDeError(error, 'No pudimos importar los clientes.'))
      setEstado('error')
    }
  }

  const cerrar = () => setEstado('cerrado')
  const porcentaje = avance.total > 0 ? Math.min(100, Math.round((avance.hechos / avance.total) * 100)) : 0

  return (
    <>
      <Button variant="outlined" onClick={() => setEstado('revisando')}>Importar</Button>
      <Dialog open={estado !== 'cerrado'} onClose={estado === 'importando' ? undefined : cerrar} aria-labelledby="importar-clientes-titulo" fullWidth maxWidth="sm">
        <DialogTitle id="importar-clientes-titulo">Importar clientes</DialogTitle>
        <DialogContent>
          {estado === 'revisando' && filas.length === 0 && errores.length === 0 ? (
            <>
              <DialogContentText sx={{ mb: 2 }}>
                Subí un CSV con una fila por cliente. Los números existentes se actualizan; los nuevos se crean.
              </DialogContentText>
              <Button variant="outlined" component="label">
                Elegir archivo CSV
                <input type="file" accept=".csv,text/csv" hidden onChange={(e) => void elegirArchivo(e.target.files?.[0])} />
              </Button>
            </>
          ) : null}
          {estado === 'revisando' && (filas.length > 0 || errores.length > 0) ? (
            <>
              <DialogContentText sx={{ mb: 1 }}>
                {filas.length} {filas.length === 1 ? 'fila lista' : 'filas listas'}
                {errores.length > 0 ? ` · ${errores.length} con error (no se importan)` : ''}.
              </DialogContentText>
              {errores.length > 0 ? (
                <Alert severity="warning" sx={{ mb: 1 }}>
                  {errores.slice(0, 5).map((e) => `Fila ${e.fila}: ${e.motivo}`).join(' ')}
                  {errores.length > 5 ? ` (+${errores.length - 5} más)` : ''}
                </Alert>
              ) : null}
            </>
          ) : null}
          {estado === 'importando' ? (
            <>
              <DialogContentText role="status" aria-live="polite" sx={{ mb: 2 }}>
                Importando {avance.hechos} de {avance.total} clientes…
              </DialogContentText>
              <LinearProgress variant="determinate" value={porcentaje} aria-label="Progreso de la importación" />
            </>
          ) : null}
          {estado === 'listo' ? <Alert severity="success">{resultado}</Alert> : null}
          {estado === 'error' ? <Alert severity="error">{mensajeError}</Alert> : null}
        </DialogContent>
        <DialogActions>
          {estado === 'revisando' && filas.length === 0 ? (
            <>
              <Button onClick={descargarPlantilla}>Descargar plantilla CSV</Button>
              <Button onClick={cerrar}>Cancelar</Button>
            </>
          ) : null}
          {estado === 'revisando' && filas.length > 0 ? (
            <>
              <Button onClick={cerrar}>Cancelar</Button>
              <Button variant="contained" onClick={() => void importar()}>Importar {filas.length} clientes</Button>
            </>
          ) : null}
          {estado === 'importando' ? <Button onClick={() => { cancelar.current = true }}>Cancelar importación</Button> : null}
          {estado === 'listo' || estado === 'error' ? <Button onClick={cerrar}>Cerrar</Button> : null}
        </DialogActions>
      </Dialog>
    </>
  )
}
