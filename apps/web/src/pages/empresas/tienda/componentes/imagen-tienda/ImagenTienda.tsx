import { useEffect, useId, useRef, useState } from 'react'
import { Alert, Box, Button, Stack, Typography } from '@mui/material'
import { REGLAS_IMAGEN, tiposAceptados, urlPublica, validarImagen, type ClaveImagen } from '../../../../../lib/tiendaIdentidad'

// F-TDA-02 (FR-021, FR-025, FR-026): campo de logo o banner. Valida formato y tamaño ANTES de aceptar el
// archivo (el SVG con script o eventos se rechaza); un archivo inválido no reemplaza al actual. El
// archivo elegido queda pendiente en el formulario y se sube recién al «Guardar»: elegir no escribe.
export type EstadoImagen = { ruta: string | null; archivo: File | null }

const TITULO: Record<ClaveImagen, string> = { logo: 'Logo', banner: 'Banner principal', bannerMovil: 'Banner móvil' }

// Alto de la caja de imagen en unidades del espaciado del tema (13,75 -> 110 px; 12,5 -> 100 px).
const ALTO: Record<ClaveImagen, number> = { logo: 13.75, banner: 12.5, bannerMovil: 12.5 }

// El blob URL se crea y se libera dentro del efecto (con StrictMode el montaje doble no deja uno sin liberar).
export function useUrlLocal(archivo: File | null): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!archivo || typeof URL.createObjectURL !== 'function') {
      setUrl(null)
      return undefined
    }
    const creada = URL.createObjectURL(archivo)
    setUrl(creada)
    return () => {
      if (typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(creada)
    }
  }, [archivo])
  return url
}

export function ImagenTienda({
  clave,
  empresaNombre,
  estado,
  onElegir,
  onQuitar,
  urlLocal: urlLocalCompartida,
}: {
  clave: ClaveImagen
  empresaNombre: string
  estado: EstadoImagen
  onElegir: (archivo: File) => void
  onQuitar: () => void
  // Vista previa ya creada por el padre (evita un segundo blob URL del mismo archivo).
  urlLocal?: string | null
}) {
  const reglas = REGLAS_IMAGEN[clave]
  const entrada = useRef<HTMLInputElement>(null)
  const idAyuda = useId()
  const [error, setError] = useState<string | null>(null)
  const propia = useUrlLocal(urlLocalCompartida === undefined ? estado.archivo : null)
  const urlLocal = urlLocalCompartida === undefined ? propia : urlLocalCompartida
  const url = urlLocal ?? urlPublica(estado.ruta)
  const hayImagen = Boolean(estado.archivo || estado.ruta)
  const etiqueta = reglas.medidas ? `${TITULO[clave]} (${reglas.medidas})` : TITULO[clave]

  const elegir = async (archivo: File | undefined) => {
    if (!archivo) return
    const motivo = await validarImagen(clave, archivo)
    if (motivo) {
      setError(hayImagen ? `${motivo} Se conserva la imagen actual.` : motivo)
      return
    }
    setError(null)
    onElegir(archivo)
  }

  return (
    <Stack spacing={1} role="group" aria-label={etiqueta}>
      {clave === 'logo' ? null : <Typography component="h3" variant="subtitle2">{etiqueta}</Typography>}
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}>
        <Box
          sx={{
            width: clave === 'logo' ? 220 : clave === 'banner' ? 280 : 150,
            maxWidth: '100%',
            height: (tema) => tema.spacing(ALTO[clave]),
            border: '1.5px dashed',
            borderColor: 'divider',
            borderRadius: (tema) => tema.shape.borderRadius,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: 'background.paper',
            overflow: 'hidden',
          }}
        >
          {url ? (
            <Box
              component="img"
              src={url}
              alt={clave === 'logo' ? `Logo de ${empresaNombre}` : etiqueta}
              sx={{ maxWidth: '100%', maxHeight: '100%', objectFit: clave === 'logo' ? 'contain' : 'cover', width: clave === 'logo' ? 'auto' : '100%', height: clave === 'logo' ? 'auto' : '100%' }}
            />
          ) : (
            <Typography variant="caption" color="text.secondary">Sin imagen</Typography>
          )}
        </Box>
        <Stack spacing={1}>
          <Typography id={idAyuda} variant="body2" color="text.secondary">
            {clave === 'logo'
              ? 'PNG o SVG con fondo transparente. Se usa en el encabezado, el pie y las redes.'
              : `${reglas.formatos}. Medidas sugeridas: ${reglas.medidas} px.`}
            {` Hasta ${reglas.maxEtiqueta}.`}
          </Typography>
          <Stack direction="row" spacing={1}>
            <Button variant="outlined" size="small" onClick={() => entrada.current?.click()} aria-describedby={idAyuda} aria-label={`${hayImagen ? 'Reemplazar' : 'Subir'} ${etiqueta.toLowerCase()}`}>
              {hayImagen ? 'Reemplazar' : 'Subir'}
            </Button>
            {hayImagen ? (
              <Button size="small" color="inherit" onClick={() => { setError(null); onQuitar() }} aria-label={`Quitar ${etiqueta.toLowerCase()}`}>
                Quitar
              </Button>
            ) : null}
          </Stack>
          {clave === 'logo' && hayImagen ? (
            <Typography variant="caption" color="text.secondary">{`Logo actual de ${empresaNombre}.`}</Typography>
          ) : null}
        </Stack>
      </Stack>
      <input
        ref={entrada}
        type="file"
        hidden
        accept={tiposAceptados(clave)}
        aria-label={`Archivo de ${etiqueta.toLowerCase()}`}
        data-testid={`archivo-${clave}`}
        onChange={(evento) => {
          const archivo = evento.target.files?.[0]
          evento.target.value = ''
          void elegir(archivo)
        }}
      />
      {error ? <Alert severity="error" role="alert">{error}</Alert> : null}
    </Stack>
  )
}
