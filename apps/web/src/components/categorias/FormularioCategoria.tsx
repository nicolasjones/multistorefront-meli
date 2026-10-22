import { type FormEvent, useRef, useState } from 'react'
import {
  Alert, Button, Checkbox, Dialog, DialogActions, DialogContent, FormControlLabel, FormGroup, FormHelperText, FormLabel, MenuItem, Stack, TextField, Typography,
} from '@mui/material'
import { TituloDialogo } from '../base/TituloDialogo'
import {
  type Categoria,
  LARGO_MAXIMO_NOMBRE_CATEGORIA,
  MENSAJE_NOMBRE_REPETIDO,
  mensajeErrorCategoria,
  nombreRepetidoEnNivel,
  opcionesPadre,
  validarNombreCategoria,
} from '../../lib/categorias'

type Empresa = { id: string; nombre: string; activa?: boolean }

export type DatosCategoria = { id: string | null; nombre: string; padreId: string | null; empresaIds: string[] }

type Props = {
  // Categoría que se edita (null = nueva).
  categoria: Categoria | null
  // Alta de una subcategoría desde la fila de su raíz: el padre llega elegido.
  padreInicial?: string | null
  categorias: readonly Categoria[]
  empresas: readonly Empresa[]
  onCancelar: () => void
  // Rechaza con el error del servidor; el diálogo conserva lo escrito.
  onGuardar: (datos: DatosCategoria) => Promise<void>
}

const SIN_PADRE = ''

// Diálogo Nueva / Editar categoría (F-CAT-08, FR-020): Nombre (obligatorio), Categoría padre (opcional,
// solo raíces: 2 niveles), «Visible en» con una casilla por empresa (todas marcadas al crear) y la ruta
// resultante. El IVA del prototipo queda fuera de alcance (lo agrega F-PRE-12). Ante un error del
// servidor (p. ej. nombre repetido) el diálogo queda abierto con lo escrito.
export function FormularioCategoria({ categoria, padreInicial = null, categorias, empresas, onCancelar, onGuardar }: Props) {
  const editando = categoria !== null
  const [nombre, setNombre] = useState(categoria?.nombre ?? '')
  const [padreId, setPadreId] = useState<string>(categoria?.padre_id ?? padreInicial ?? SIN_PADRE)
  const [empresaIds, setEmpresaIds] = useState<string[]>(() => (categoria ? [...categoria.empresa_ids] : empresas.map((empresa) => empresa.id)))
  const [errorNombre, setErrorNombre] = useState<string | null>(null)
  const [errorServidor, setErrorServidor] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  // El estado asíncrono llega tarde a un segundo clic inmediato: el ref lo frena.
  const enVuelo = useRef(false)

  const padres = opcionesPadre(categorias, categoria?.id ?? null)
  const padre = padres.find((candidata) => candidata.id === padreId)
  const limpio = nombre.trim()
  const ruta = `${padre ? `${padre.nombre} > ` : ''}${limpio === '' ? 'Nueva categoría' : limpio}`
  const elegidas = new Set(empresaIds)

  const alternarEmpresa = (id: string, marcada: boolean) => {
    setEmpresaIds((actual) => (marcada ? [...actual, id] : actual.filter((otra) => otra !== id)))
  }

  const enviar = async (evento: FormEvent) => {
    evento.preventDefault()
    if (enVuelo.current) return
    setErrorServidor(null)
    const invalido = validarNombreCategoria(nombre)
    if (invalido) {
      setErrorNombre(invalido)
      return
    }
    const destino = padreId === SIN_PADRE ? null : padreId
    if (nombreRepetidoEnNivel(categorias, nombre, destino, categoria?.id ?? null)) {
      setErrorNombre(MENSAJE_NOMBRE_REPETIDO)
      return
    }
    setErrorNombre(null)
    enVuelo.current = true
    setGuardando(true)
    try {
      await onGuardar({ id: categoria?.id ?? null, nombre: limpio, padreId: destino, empresaIds })
    } catch (error) {
      const mensaje = mensajeErrorCategoria(error, 'No pudimos guardar la categoría. Probá de nuevo.')
      if (mensaje === MENSAJE_NOMBRE_REPETIDO) setErrorNombre(mensaje)
      else setErrorServidor(mensaje)
    } finally {
      enVuelo.current = false
      setGuardando(false)
    }
  }

  return (
    <Dialog open onClose={guardando ? undefined : onCancelar} fullWidth maxWidth="sm" aria-labelledby="categoria-titulo">
      <TituloDialogo id="categoria-titulo" onCerrar={guardando ? undefined : onCancelar}>
        {editando ? 'Editar categoría' : 'Nueva categoría'}
      </TituloDialogo>
      <form onSubmit={enviar} noValidate>
        <DialogContent>
          <Stack spacing={2}>
            {errorServidor ? <Alert severity="error">{errorServidor}</Alert> : null}
            <TextField
              label="Nombre"
              placeholder="Ej.: Fundas rígidas"
              value={nombre}
              onChange={(evento) => {
                setNombre(evento.target.value)
                if (errorNombre) setErrorNombre(null)
              }}
              error={Boolean(errorNombre)}
              helperText={errorNombre ?? undefined}
              required
              autoFocus
              autoComplete="off"
              fullWidth
              slotProps={{ htmlInput: { maxLength: LARGO_MAXIMO_NOMBRE_CATEGORIA + 20 } }}
            />
            <TextField
              select
              label="Categoría padre (opcional)"
              value={padres.some((candidata) => candidata.id === padreId) ? padreId : SIN_PADRE}
              onChange={(evento) => {
                setPadreId(evento.target.value)
                setErrorNombre(null)
              }}
              helperText={
                editando && categorias.some((c) => c.padre_id === categoria?.id)
                  ? 'Tiene subcategorías: solo puede ser una categoría raíz (máximo 2 niveles).'
                  : 'Solo se ofrecen categorías raíz (máximo 2 niveles).'
              }
              fullWidth
            >
              <MenuItem value={SIN_PADRE}>Ninguna (categoría raíz)</MenuItem>
              {padres.map((candidata) => <MenuItem key={candidata.id} value={candidata.id}>{candidata.nombre}</MenuItem>)}
            </TextField>
            <Stack component="fieldset" spacing={0.5} sx={{ border: 0, m: 0, p: 0, minWidth: 0 }}>
              <FormLabel component="legend">Visible en</FormLabel>
              {empresas.length === 0 ? (
                <Typography variant="s">Todavía no hay empresas cargadas.</Typography>
              ) : (
                <FormGroup>
                  {empresas.map((empresa) => (
                    <FormControlLabel
                      key={empresa.id}
                      label={empresa.activa === false ? `${empresa.nombre} (inactiva)` : empresa.nombre}
                      control={<Checkbox checked={elegidas.has(empresa.id)} onChange={(evento) => alternarEmpresa(empresa.id, evento.target.checked)} />}
                    />
                  ))}
                </FormGroup>
              )}
              <FormHelperText>
                {empresaIds.length === 0 ? 'Sin ninguna tienda marcada, la categoría no se ve en ninguna.' : 'La categoría aparece en el menú de las tiendas marcadas.'}
              </FormHelperText>
            </Stack>
            <Typography variant="s" role="status">Ruta: «{ruta}»</Typography>
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
