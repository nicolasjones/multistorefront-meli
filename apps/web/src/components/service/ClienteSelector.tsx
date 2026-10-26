import { useEffect, useMemo, useState } from 'react'
import { Autocomplete, Button, CircularProgress, Stack, TextField } from '@mui/material'
import { useBuscarClientes, type ClienteListado } from '../../hooks/useBuscarClientes'
import type { ClienteElegido } from '../../lib/reparaciones'

type Props = {
  valor: ClienteElegido | null
  onCambio: (cliente: ClienteElegido | null) => void
  error?: string
  disabled?: boolean
  /** Ofrece «Nuevo cliente» (alta rápida, FR-015): solo para quien puede crear clientes. */
  onAltaRapida?: () => void
}

const ESPERA_BUSQUEDA_MS = 300

// «Contacto» de la reparación se completa con el del cliente (FR-014): celular, si no teléfono, si no correo.
export function contactoDeCliente(cliente: Pick<ClienteListado, 'celular' | 'telefono' | 'correo'>): string {
  return cliente.celular || cliente.telefono || cliente.correo || ''
}

// Búsqueda de cliente (FR-014): `public.buscar_clientes` en el servidor, que ya acota a la organización por RLS;
// el navegador nunca baja la lista completa. Con 300 ms de espera para no consultar en cada tecla.
export function ClienteSelector({ valor, onCambio, error, disabled = false, onAltaRapida }: Props) {
  const [entrada, setEntrada] = useState(valor?.nombre ?? '')
  const [texto, setTexto] = useState('')
  useEffect(() => {
    const temporizador = setTimeout(() => setTexto(entrada), ESPERA_BUSQUEDA_MS)
    return () => clearTimeout(temporizador)
  }, [entrada])
  useEffect(() => setEntrada(valor?.nombre ?? ''), [valor])

  const { clientes, isLoading, isFetching, isError } = useBuscarClientes({
    texto,
    tipo: null,
    archivados: false,
    empresaId: null,
    conCuentaWeb: false,
    pagina: 1,
    tamano: 10,
  })

  const opciones = useMemo<ClienteElegido[]>(
    () => clientes.map((cliente) => ({ id: cliente.id, nombre: cliente.nombre, contacto: contactoDeCliente(cliente) })),
    [clientes],
  )

  const ayuda = error ?? (isError ? 'No pudimos buscar clientes. Escribí de nuevo para reintentar.' : undefined)

  return (
    <Stack spacing={1} alignItems="flex-start" sx={{ width: '100%' }}>
      <Autocomplete<ClienteElegido>
        fullWidth
        disabled={disabled}
        options={opciones}
        value={valor}
        inputValue={entrada}
        onInputChange={(_evento, nuevo, motivo) => {
          if (motivo === 'input') setEntrada(nuevo)
          if (motivo === 'clear') setEntrada('')
        }}
        onChange={(_evento, nuevo) => onCambio(nuevo)}
        filterOptions={(todas) => todas}
        getOptionLabel={(cliente) => cliente.nombre}
        isOptionEqualToValue={(opcion, elegido) => opcion.id === elegido.id}
        loading={isLoading || isFetching}
        loadingText="Buscando clientes…"
        noOptionsText={isError ? 'No pudimos buscar clientes.' : 'No encontramos clientes con ese nombre.'}
        renderInput={(parametros) => (
          <TextField
            {...parametros}
            label="Cliente"
            required
            error={Boolean(ayuda)}
            helperText={ayuda}
            slotProps={{
              input: {
                ...parametros.InputProps,
                endAdornment: (
                  <>
                    {isFetching ? <CircularProgress size={16} aria-label="Buscando clientes" /> : null}
                    {parametros.InputProps.endAdornment}
                  </>
                ),
              },
            }}
          />
        )}
      />
      {onAltaRapida && !disabled ? (
        <Button size="small" onClick={onAltaRapida}>
          Nuevo cliente
        </Button>
      ) : null}
    </Stack>
  )
}
