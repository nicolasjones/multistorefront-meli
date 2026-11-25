import { type ChangeEvent, type Dispatch, type SetStateAction, useEffect, useRef, useState } from 'react'
import { Alert, Box, Button, Chip, FormHelperText, IconButton, Stack, Typography } from '@mui/material'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import {
  AYUDA_IMAGENES,
  type CambiosImagenes,
  type ImagenExistente,
  MAX_IMAGENES,
  TIPOS_ACEPTADOS,
  ordenFinal,
  prepararImagen,
} from '../../lib/productoImagenes'

type Props = {
  existentes: readonly ImagenExistente[]
  cambios: CambiosImagenes
  // Acepta la forma funcional: tras optimizar se aplica sobre el estado ACTUAL, no sobre uno capturado antes de esperar.
  onCambiar: Dispatch<SetStateAction<CambiosImagenes>>
  // Avisa al formulario si hay optimizaciones en curso (para no guardar sin esas fotos).
  onOptimizando?: (optimizando: boolean) => void
  // Solo lectura (FR-011): se ven las imágenes, sin agregar ni quitar.
  soloLectura?: boolean
  deshabilitado?: boolean
}

// Vista previa local de un archivo recién elegido; se libera al quitarlo o desmontar.
function useVistasPrevias(archivos: readonly File[]): Map<File, string> {
  const [vistas, setVistas] = useState<Map<File, string>>(() => new Map())
  useEffect(() => {
    const mapa = new Map<File, string>()
    if (typeof URL.createObjectURL === 'function') {
      for (const archivo of archivos) mapa.set(archivo, URL.createObjectURL(archivo))
    }
    setVistas(mapa)
    return () => {
      if (typeof URL.revokeObjectURL !== 'function') return
      for (const url of mapa.values()) URL.revokeObjectURL(url)
    }
  }, [archivos])
  return vistas
}

// Imágenes del producto (F-CAT-05, FR-012): hasta 4, JPG/PNG/WebP de hasta 15 MB que se
// optimizan solas (WebP, 1600 px; el tope de 2 MB se valida sobre el resultado). La primera
// es la principal. Los archivos se suben al guardar el producto (lo hace la página);
// acá solo se elige, se optimiza y se valida. La base y el bucket validan igual.
export function ImagenesProducto({ existentes, cambios, onCambiar, onOptimizando, soloLectura = false, deshabilitado = false }: Props) {
  const [errores, setErrores] = useState<string[]>([])
  const [optimizando, setOptimizando] = useState(0)
  const entrada = useRef<HTMLInputElement | null>(null)
  const vistas = useVistasPrevias(cambios.nuevas)
  const orden = ordenFinal(existentes, cambios)
  // Último estado visto, para leer valores actuales tras esperar la optimización.
  const ultimo = useRef({ existentes, cambios })
  useEffect(() => {
    ultimo.current = { existentes, cambios }
  })
  const ocupado = optimizando > 0
  const bloqueado = soloLectura || deshabilitado

  useEffect(() => {
    onOptimizando?.(ocupado)
  }, [ocupado, onOptimizando])

  const agregar = async (event: ChangeEvent<HTMLInputElement>) => {
    const elegidos = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (elegidos.length === 0) return
    const rechazos: string[] = []
    const aceptados: File[] = []
    setOptimizando((cuenta) => cuenta + 1)
    try {
      for (const archivo of elegidos) {
        const actual = ultimo.current
        const cantidad = ordenFinal(actual.existentes, actual.cambios).length + aceptados.length
        const resultado = await prepararImagen(archivo, cantidad)
        if ('error' in resultado) {
          rechazos.push(resultado.error)
        } else {
          aceptados.push(resultado.archivo)
        }
      }
    } finally {
      setOptimizando((cuenta) => cuenta - 1)
    }
    setErrores(rechazos)
    if (aceptados.length > 0) {
      // Forma funcional: el tope de 4 se vuelve a calcular con las nuevas ya presentes en este momento.
      onCambiar((previos) => {
        const libres = MAX_IMAGENES - ordenFinal(ultimo.current.existentes, previos).length
        return { ...previos, nuevas: [...previos.nuevas, ...aceptados.slice(0, Math.max(0, libres))] }
      })
    }
  }

  const quitar = (elemento: (typeof orden)[number]) => {
    setErrores([])
    if (elemento.tipo === 'nueva') {
      onCambiar((previos) => ({ ...previos, nuevas: previos.nuevas.filter((archivo) => archivo !== elemento.archivo) }))
    } else {
      onCambiar((previos) => ({ ...previos, eliminadas: [...previos.eliminadas, elemento.imagen.id] }))
    }
  }

  return (
    <Box component="section" aria-labelledby="imagenes-titulo">
      <Typography id="imagenes-titulo" variant="subtitle1" component="h2" sx={{ fontWeight: 600 }}>
        Imágenes
      </Typography>
      <FormHelperText id="imagenes-ayuda">{AYUDA_IMAGENES}</FormHelperText>
      <Typography variant="body2" color="text.secondary" role="status" aria-live="polite" sx={{ mt: ocupado ? 1 : 0 }}>
        {ocupado ? 'Optimizando imágenes…' : ''}
      </Typography>
      {errores.length > 0 ? (
        <Alert severity="warning" sx={{ mt: 1 }}>
          <Stack component="ul" sx={{ m: 0, pl: 2 }}>
            {errores.map((error) => <li key={error}>{error}</li>)}
          </Stack>
        </Alert>
      ) : null}
      {orden.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {soloLectura ? 'Este producto no tiene imágenes.' : 'Todavía no hay imágenes.'}
        </Typography>
      ) : (
        <Stack component="ul" direction="row" spacing={1.5} useFlexGap sx={{ flexWrap: 'wrap', listStyle: 'none', m: 0, mt: 1, p: 0 }}>
          {orden.map((elemento, indice) => {
            const url = elemento.tipo === 'nueva' ? vistas.get(elemento.archivo) ?? null : elemento.imagen.url
            const descripcion = `Imagen ${indice + 1}${indice === 0 ? ' (principal)' : ''}${elemento.tipo === 'nueva' ? ', se sube al guardar' : ''}`
            return (
              <Box component="li" key={elemento.tipo === 'nueva' ? `nueva:${elemento.archivo.name}:${elemento.archivo.lastModified}:${indice}` : elemento.imagen.id} sx={{ position: 'relative', width: 112 }}>
                {url ? (
                  <Box component="img" src={url} alt={descripcion} sx={{ width: 112, height: 112, objectFit: 'cover', borderRadius: 1, border: 1, borderColor: 'divider', display: 'block' }} />
                ) : (
                  <Box role="img" aria-label={descripcion} sx={{ width: 112, height: 112, borderRadius: 1, border: 1, borderColor: 'divider', display: 'grid', placeItems: 'center', bgcolor: 'action.hover' }}>
                    <Typography variant="caption" color="text.secondary">Sin vista previa</Typography>
                  </Box>
                )}
                {indice === 0 ? <Chip label="Principal" size="small" color="primary" sx={{ position: 'absolute', top: 4, left: 4 }} /> : null}
                {bloqueado ? null : (
                  <IconButton
                    size="small"
                    disabled={ocupado}
                    aria-label={`Quitar imagen ${indice + 1}`}
                    onClick={() => quitar(elemento)}
                    sx={{ position: 'absolute', top: 2, right: 2, bgcolor: 'background.paper', '&:hover': { bgcolor: 'background.paper' } }}
                  >
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                )}
              </Box>
            )
          })}
        </Stack>
      )}
      {bloqueado ? null : (
        <Box sx={{ mt: 1.5 }}>
          <input
            ref={entrada}
            type="file"
            accept={TIPOS_ACEPTADOS}
            multiple
            hidden
            onChange={agregar}
            aria-label="Elegir imágenes"
            data-testid="entrada-imagenes"
          />
          <Button variant="outlined" onClick={() => entrada.current?.click()} disabled={orden.length >= MAX_IMAGENES || ocupado} aria-describedby="imagenes-ayuda">
            Agregar imágenes
          </Button>
        </Box>
      )}
    </Box>
  )
}
