import { useState } from 'react'
import { Box, Button, Stack, Switch, TextField, Typography } from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import { ContenidoAdaptable, type ColumnaAdaptable } from '../pagina/ContenidoAdaptable'
import {
  AVISO_VARIANTE_AGREGADA,
  type ErrorVariante,
  type FilaVariante,
  TEXTO_SIN_VARIANTES,
  stockTotalActivas,
  varianteNueva,
} from '../../lib/productos-variantes'

type Props = {
  filas: readonly FilaVariante[]
  onCambiar: (filas: FilaVariante[]) => void
  // SKU que se está cargando en el formulario: base del código de «Agregar variante».
  skuProducto: string
  // El stock se ve con lectura o edición en Stock; se edita (stock inicial / stock contado) solo con edición.
  verStock: boolean
  editarStock: boolean
  // Errores de guardado por fila (el formulario conserva lo escrito).
  errores?: Readonly<Record<string, ErrorVariante>>
  cargando?: boolean
  hayError?: boolean
  onReintentar?: () => void
  // Sin edición en Productos (FR-003): se ven las variantes sin poder cambiarlas.
  soloLectura?: boolean
  deshabilitado?: boolean
}

const TITULO = 'Variantes'
const SUBTITULO = 'Para un mismo producto con distintos colores o modelos. Cada variante tiene su código, su código de barras y su stock; el precio es el del producto.'

const AVISO_STOCK_INVALIDO = 'Ingresá un número entero, 0 o más.'

// Mientras se escribe, el texto es propio: un valor vacío o inválido NO se convierte en 0 (generaría un ajuste a 0 al guardar).
// Solo los enteros ≥ 0 llegan a la fila; al salir del campo con un texto inválido vuelve al último valor válido.
function CampoStock({ valor, etiqueta, deshabilitado, error, onCambiar }: { valor: number; etiqueta: string; deshabilitado: boolean; error: string | null; onCambiar: (stock: number) => void }) {
  const [borrador, setBorrador] = useState<string | null>(null)
  const invalido = borrador !== null && !/^\d+$/.test(borrador)
  return (
    <TextField
      size="small"
      type="number"
      value={borrador ?? valor}
      onChange={(evento) => {
        const texto = evento.target.value
        setBorrador(texto)
        if (/^\d+$/.test(texto)) onCambiar(Number(texto))
      }}
      onBlur={() => setBorrador(null)}
      disabled={deshabilitado}
      error={error !== null || invalido}
      helperText={invalido ? AVISO_STOCK_INVALIDO : error}
      slotProps={{ htmlInput: { 'aria-label': etiqueta, min: 0, step: 1 } }}
      sx={{ width: 96 }}
    />
  )
}

// Bloque «Variantes» del alta y la edición (F-CAT-15, FR-003…FR-005): tabla Variante / Código / Código de barras /
// Stock / Activa con celdas editables, «Agregar variante» y el interruptor Activa. Las variantes no se borran: se
// desactivan. La empresa activa no cambia el bloque (producto, variantes y stock son de la organización).
export function BloqueVariantes({ filas, onCambiar, skuProducto, verStock, editarStock, errores = {}, cargando = false, hayError = false, onReintentar, soloLectura = false, deshabilitado = false }: Props) {
  const [aviso, setAviso] = useState<string | null>(null)
  const bloqueado = soloLectura || deshabilitado
  const total = verStock ? stockTotalActivas(filas) : null

  const cambiar = (clave: string, cambios: Partial<FilaVariante>) => {
    onCambiar(filas.map((fila) => (fila.clave === clave ? { ...fila, ...cambios } : fila)))
    setAviso(null)
  }

  const agregar = () => {
    onCambiar([...filas, varianteNueva(skuProducto, filas, verStock)])
    setAviso(AVISO_VARIANTE_AGREGADA)
  }

  const celdaTexto = (fila: FilaVariante, indice: number, campo: 'nombre' | 'codigo' | 'codigoBarras', etiqueta: string, claveError: 'nombre' | 'codigo' | 'codigo_barras', maximo: number) => {
    const error = errores[fila.clave]?.campo === claveError ? errores[fila.clave].mensaje : null
    if (soloLectura) return fila[campo] === '' ? '—' : fila[campo]
    return (
      <TextField
        size="small"
        value={fila[campo]}
        onChange={(evento) => cambiar(fila.clave, { [campo]: evento.target.value })}
        disabled={deshabilitado}
        placeholder={campo === 'codigoBarras' ? '—' : undefined}
        error={error !== null}
        helperText={error}
        slotProps={{ htmlInput: { 'aria-label': `${etiqueta} de la variante ${indice + 1}`, maxLength: maximo, inputMode: campo === 'codigoBarras' ? 'numeric' : undefined } }}
      />
    )
  }

  const columnas: ColumnaAdaptable<FilaVariante>[] = [
    { clave: 'nombre', encabezado: 'Variante', render: (fila) => celdaTexto(fila, filas.indexOf(fila), 'nombre', 'Nombre', 'nombre', 120) },
    { clave: 'codigo', encabezado: 'Código', render: (fila) => celdaTexto(fila, filas.indexOf(fila), 'codigo', 'Código', 'codigo', 80) },
    { clave: 'codigo_barras', encabezado: 'Código de barras', render: (fila) => celdaTexto(fila, filas.indexOf(fila), 'codigoBarras', 'Código de barras', 'codigo_barras', 13) },
    {
      clave: 'stock',
      encabezado: 'Stock',
      align: 'right',
      render: (fila) => {
        if (!verStock || fila.stock === null) return '—'
        if (!editarStock || soloLectura) return fila.stock
        const error = errores[fila.clave]?.campo === 'stock' ? errores[fila.clave].mensaje : null
        return (
          <CampoStock
            valor={fila.stock}
            etiqueta={`Stock de la variante ${filas.indexOf(fila) + 1}`}
            deshabilitado={deshabilitado}
            error={error}
            onCambiar={(stock) => cambiar(fila.clave, { stock })}
          />
        )
      },
    },
    {
      clave: 'activa',
      encabezado: 'Activa',
      align: 'center',
      render: (fila) => (
        <Switch
          checked={fila.activa}
          disabled={bloqueado}
          onChange={(_evento, activa) => cambiar(fila.clave, { activa })}
          slotProps={{ input: { role: 'switch', 'aria-label': `Activa: ${fila.nombre.trim() === '' ? `variante ${filas.indexOf(fila) + 1}` : fila.nombre}` } }}
        />
      ),
    },
  ]

  return (
    <Box component="section" aria-labelledby="variantes-titulo">
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={2}>
        <Box>
          <Typography id="variantes-titulo" variant="t3" component="h2">{TITULO}</Typography>
          <Typography variant="s" component="p" sx={{ mt: 0.5 }}>{SUBTITULO}</Typography>
        </Box>
        {soloLectura || cargando || hayError ? null : (
          <Button size="small" variant="outlined" startIcon={<AddIcon />} onClick={agregar} disabled={deshabilitado}>Agregar variante</Button>
        )}
      </Stack>

      {cargando ? (
        <Typography variant="s" role="status" sx={{ mt: 1 }}>Cargando variantes…</Typography>
      ) : hayError ? (
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1 }}>
          <Typography variant="s" role="alert">No pudimos cargar las variantes.</Typography>
          {onReintentar ? <Button size="small" onClick={onReintentar}>Reintentar variantes</Button> : null}
        </Stack>
      ) : (
        <>
          <Box sx={{ mt: 1.5 }}>
            <ContenidoAdaptable
              items={[...filas]}
              columnas={columnas}
              obtenerClave={(fila) => fila.clave}
              etiquetaTabla="Variantes del producto"
            />
          </Box>
          {total === null ? null : (
            <Typography variant="s" component="p" sx={{ mt: 1 }}>Stock del producto (suma de las variantes activas): <b>{total}</b></Typography>
          )}
          <Typography variant="xs" component="p" sx={{ mt: 1 }}>{TEXTO_SIN_VARIANTES}</Typography>
          <Typography variant="s" component="p" role="status" sx={{ mt: 1, minHeight: '1.5em' }}>{aviso}</Typography>
        </>
      )}
    </Box>
  )
}
