import { type FormEvent, useRef, useState } from 'react'
import {
  Alert, Button, Dialog, DialogActions, DialogContent, MenuItem, Stack, TextField, Typography,
} from '@mui/material'
import { TituloDialogo } from '../base/TituloDialogo'
import { SelectorEmpresas } from '../base/SelectorEmpresas'
import { type Alicuota, NOTA_OPCIONES_IVA, formatearAlicuota } from '../../lib/iva'
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

// `alicuotaId` null = no hay alícuotas para elegir (no se toca el IVA de la categoría).
export type DatosCategoria = { id: string | null; nombre: string; padreId: string | null; empresaIds: string[]; alicuotaId: string | null; alicuotaOriginalId: string | null }

type Props = {
  // Categoría que se edita (null = nueva).
  categoria: Categoria | null
  // Alta de una subcategoría desde la fila de su raíz: el padre llega elegido.
  padreInicial?: string | null
  categorias: readonly Categoria[]
  empresas: readonly Empresa[]
  // Alícuotas activas para «IVA de la categoría» (F-PRE-12, FR-020); vacío = el campo no se ofrece.
  alicuotas?: readonly Alicuota[]
  onCancelar: () => void
  // Rechaza con el error del servidor; el diálogo conserva lo escrito.
  onGuardar: (datos: DatosCategoria) => Promise<void>
}

const SIN_PADRE = ''

// Diálogo Nueva / Editar categoría (F-CAT-08, FR-020): Nombre (obligatorio), Categoría padre (opcional,
// solo raíces: 2 niveles), «Visible en» con una casilla por empresa (todas marcadas al crear) y la ruta
// resultante. «IVA de la categoría» (F-PRE-12) se guarda aparte con `guardar_alicuota_categoria`. Ante un error del
// servidor (p. ej. nombre repetido) el diálogo queda abierto con lo escrito.
export function FormularioCategoria({ categoria, padreInicial = null, categorias, empresas, alicuotas = [], onCancelar, onGuardar }: Props) {
  const editando = categoria !== null
  const [nombre, setNombre] = useState(categoria?.nombre ?? '')
  const [padreId, setPadreId] = useState<string>(categoria?.padre_id ?? padreInicial ?? SIN_PADRE)
  const [empresaIds, setEmpresaIds] = useState<string[]>(() => (categoria ? [...categoria.empresa_ids] : empresas.map((empresa) => empresa.id)))
  // null = sin tocar: edición → la actual de la categoría; alta → 21 % (como nacen en la base) o la
  // primera disponible. Se resuelve al renderizar porque las alícuotas pueden llegar después de abrir el diálogo.
  const [alicuotaElegida, setAlicuotaElegida] = useState<string | null>(null)
  const alicuotaId =
    alicuotaElegida ?? categoria?.alicuota_iva_id ?? alicuotas.find((a) => !a.exento && a.porcentaje === 21)?.id ?? alicuotas[0]?.id ?? ''
  const [errorNombre, setErrorNombre] = useState<string | null>(null)
  const [errorServidor, setErrorServidor] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  // El estado asíncrono llega tarde a un segundo clic inmediato: el ref lo frena.
  const enVuelo = useRef(false)

  const padres = opcionesPadre(categorias, categoria?.id ?? null)
  const padre = padres.find((candidata) => candidata.id === padreId)
  const limpio = nombre.trim()
  const ruta = `${padre ? `${padre.nombre} > ` : ''}${limpio === '' ? 'Nueva categoría' : limpio}`

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
      await onGuardar({ id: categoria?.id ?? null, nombre: limpio, padreId: destino, empresaIds, alicuotaId: alicuotas.some((a) => a.id === alicuotaId) ? alicuotaId : null, alicuotaOriginalId: categoria?.alicuota_iva_id ?? null })
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
            {alicuotas.length > 0 ? (
              <TextField
                select
                label="IVA de la categoría"
                value={alicuotas.some((a) => a.id === alicuotaId) ? alicuotaId : ''}
                onChange={(evento) => setAlicuotaElegida(evento.target.value)}
                helperText={NOTA_OPCIONES_IVA}
                fullWidth
              >
                {alicuotas.map((a) => <MenuItem key={a.id} value={a.id}>{formatearAlicuota(a)}</MenuItem>)}
              </TextField>
            ) : null}
            <SelectorEmpresas
              empresas={empresas}
              seleccion={empresaIds}
              onCambiar={setEmpresaIds}
              etiqueta="Visible en"
              mensajeVacio="Todavía no hay empresas cargadas."
              ayuda={empresaIds.length === 0 ? 'Sin ninguna tienda marcada, la categoría no se ve en ninguna.' : 'La categoría aparece en el menú de las tiendas marcadas.'}
            />
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
