import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Box, Button, Stack, Switch, Typography } from '@mui/material'
import { useFiltroPorEmpresaActiva } from '../../hooks/useFiltroPorEmpresaActiva'
import { useEmpresas } from '../../hooks/useEmpresas'
import { useOrganizacionActiva } from '../../hooks/useOrganizacionActiva'
import { usePuedeEscribir } from '../../hooks/usePuedeEscribir'
import {
  MENSAJE_DEPOSITO_CREADO, MENSAJE_DEPOSITO_GUARDADO, NOTA_DEPOSITO_CON_STOCK, avisoActivo, avisoPorDefecto, cambiarActivoDeposito,
  definirDepositoPorDefecto, listarDepositos, mensajeDeErrorDeposito, type Deposito,
} from '../../lib/depositos'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../../components/estados/EstadosPagina'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { ContenedorSeccion } from '../../components/pagina/ContenedorSeccion'
import { ContenidoAdaptable, type ColumnaAdaptable } from '../../components/pagina/ContenidoAdaptable'
import { ContextoOrganizacionActiva } from '../../components/pagina/ContextoOrganizacionActiva'
import { BarraHerramientas } from '../../components/pagina/BarraHerramientas'
import { EtiquetaEstado } from '../../components/base/EtiquetaEstado'
import { PestanasStock } from './PestanasStock'
import { tokens } from '../../tema/tokens'

// El diálogo no pesa en el recorrido principal: se descarga al abrirlo (Principio VI).
const DepositoDialog = lazy(() => import('./DepositoDialog'))

// Diálogo abierto y la empresa activa con la que se abrió: si la barra superior cambia de empresa, el
// diálogo se cierra con aviso (Principio VIII) y jamás guarda datos de la anterior bajo la nueva.
type DialogoAbierto = { deposito: Deposito | null; empresaId: string | null }

// Lo cargado y para qué empresa activa: una fila de la empresa anterior nunca se muestra bajo la nueva.
type Cargado = { empresaId: string | null; filas: Deposito[] }

type Aviso = { severidad: 'success' | 'error'; texto: string }

const formatoNumero = new Intl.NumberFormat('es-AR')

// Stock · Depósitos de mercadería (F-STK-14, FR-005, FR-006, FR-014; prototipo Depositos.dc.html).
// Tabla con Depósito, Dirección, Venden desde acá, Productos con stock, Unidades, Por defecto, Activo y
// acciones. Se filtra por la empresa activa de la barra superior según «Venden desde acá» (con «Todas mis
// empresas» se listan todos) y se recarga al cambiarla. Solo el Administrador crea y edita; con lectura la
// pantalla se ve sin botones. La autoridad es la base: RLS y las RPC de gestión.
export function DepositosStock() {
  const { puedeEscribir } = usePuedeEscribir()
  const puedeAdministrar = puedeEscribir === true
  const { empresaActivaId } = useFiltroPorEmpresaActiva()
  const { organizacionActiva } = useOrganizacionActiva()
  const organizacionId = organizacionActiva?.id ?? null
  const { empresas, isError: errorEmpresas } = useEmpresas({ habilitado: puedeAdministrar })
  const [cargado, setCargado] = useState<Cargado | null>(null)
  const [hayError, setHayError] = useState(false)
  const [dialogo, setDialogo] = useState<DialogoAbierto | null>(null)
  const [aviso, setAviso] = useState<Aviso | null>(null)
  const [hayDialogoDescartado, setHayDialogoDescartado] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const ultimaPeticion = useRef(0)

  // `organizacionId` va en las dependencias para rehacer la carga al cambiar de organización (superadmin).
  const cargar = useCallback(async () => {
    void organizacionId
    const peticion = ++ultimaPeticion.current
    setHayError(false)
    try {
      const filas = await listarDepositos(empresaActivaId)
      if (peticion !== ultimaPeticion.current) return
      setCargado({ empresaId: empresaActivaId, filas })
    } catch (error) {
      console.error('No pudimos cargar los depósitos.', error)
      if (peticion === ultimaPeticion.current) setHayError(true)
    }
  }, [empresaActivaId, organizacionId])

  useEffect(() => {
    void cargar()
  }, [cargar])

  // Cambio de empresa: se limpia el aviso y se descarta el diálogo para que no reaparezca al volver.
  const empresaPrevia = useRef(empresaActivaId)
  useEffect(() => {
    if (empresaPrevia.current === empresaActivaId) return
    empresaPrevia.current = empresaActivaId
    setAviso(null)
    if (dialogo !== null && dialogo.empresaId !== empresaActivaId) {
      setDialogo(null)
      setHayDialogoDescartado(true)
    }
  }, [empresaActivaId, dialogo])

  const vigente = cargado !== null && cargado.empresaId === empresaActivaId
  const filas = vigente ? cargado.filas : null
  const dialogoVigente = dialogo !== null && dialogo.empresaId === empresaActivaId

  const ejecutar = async (accion: () => Promise<{ id: string; nombre: string }>, texto: (nombre: string) => string, porDefecto: string) => {
    if (ocupado) return
    setOcupado(true)
    setAviso(null)
    try {
      const resultado = await accion()
      setAviso({ severidad: 'success', texto: texto(resultado.nombre) })
    } catch (error) {
      setAviso({ severidad: 'error', texto: mensajeDeErrorDeposito(error, porDefecto) })
    } finally {
      setOcupado(false)
    }
    await cargar()
  }

  const usarPorDefecto = (deposito: Deposito) =>
    ejecutar(() => definirDepositoPorDefecto(deposito.id), avisoPorDefecto, 'No pudimos cambiar el depósito por defecto.')

  const cambiarActivo = (deposito: Deposito, activo: boolean) =>
    ejecutar(() => cambiarActivoDeposito(deposito.id, activo), (nombre) => avisoActivo(nombre, activo), 'No pudimos cambiar el estado del depósito.')

  const columnas: ColumnaAdaptable<Deposito>[] = [
    {
      clave: 'deposito',
      encabezado: 'Depósito',
      render: (fila) => <Typography variant="b" sx={{ fontWeight: tokens.tipografia.pesoEnfasis }}>{fila.nombre}</Typography>,
    },
    { clave: 'direccion', encabezado: 'Dirección', render: (fila) => <Typography variant="b">{fila.direccion ?? '—'}</Typography> },
    {
      clave: 'empresas',
      encabezado: 'Venden desde acá',
      render: (fila) =>
        fila.empresas.length === 0 ? (
          <Typography variant="b">—</Typography>
        ) : (
          <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap">
            {fila.empresas.map((empresa) => <EtiquetaEstado key={empresa.id} texto={empresa.nombre} variante="primario" />)}
          </Stack>
        ),
    },
    {
      clave: 'productos',
      encabezado: 'Productos con stock',
      align: 'right',
      render: (fila) => <Typography variant="b">{formatoNumero.format(fila.productos_con_stock)}</Typography>,
    },
    { clave: 'unidades', encabezado: 'Unidades', align: 'right', render: (fila) => <Typography variant="b">{formatoNumero.format(fila.unidades)}</Typography> },
    {
      clave: 'por_defecto',
      encabezado: 'Por defecto',
      render: (fila) =>
        fila.por_defecto ? (
          <EtiquetaEstado texto="Por defecto" variante="exito" />
        ) : puedeAdministrar && fila.activo ? (
          <Button size="small" variant="outlined" disabled={ocupado} onClick={() => void usarPorDefecto(fila)} aria-label={`Usar ${fila.nombre} por defecto`}>
            Usar por defecto
          </Button>
        ) : (
          <Typography variant="b">—</Typography>
        ),
    },
    {
      clave: 'activo',
      encabezado: 'Activo',
      render: (fila) =>
        puedeAdministrar ? (
          <Switch
            checked={fila.activo}
            disabled={ocupado}
            onChange={(_, marcado) => void cambiarActivo(fila, marcado)}
            slotProps={{ input: { 'aria-label': `Activo: ${fila.nombre}` } }}
          />
        ) : (
          <EtiquetaEstado texto={fila.activo ? 'Activo' : 'Inactivo'} variante={fila.activo ? 'exito' : 'neutral'} />
        ),
    },
  ]

  return (
    <Box>
      <EncabezadoPagina
        titulo="Stock"
        accion={
          puedeAdministrar ? (
            <Button variant="contained" onClick={() => { setHayDialogoDescartado(false); setDialogo({ deposito: null, empresaId: empresaActivaId }) }}>
              Nuevo depósito de mercadería
            </Button>
          ) : undefined
        }
        contexto={<ContextoOrganizacionActiva />}
      />
      <ContenedorSeccion>
        <PestanasStock activa="depositos" />
        <Stack spacing={2}>
          {hayDialogoDescartado ? (
            <Alert severity="warning" onClose={() => setHayDialogoDescartado(false)}>
              Cambiaste de empresa: cerramos el formulario del depósito para no mezclar datos. Volvé a abrirlo si querés seguir.
            </Alert>
          ) : null}
          {aviso ? (
            <Alert severity={aviso.severidad} role={aviso.severidad === 'error' ? 'alert' : 'status'} onClose={() => setAviso(null)}>
              {aviso.texto}
            </Alert>
          ) : null}
          {hayError ? (
            <EstadoError descripcion="No pudimos cargar los depósitos." reintentar={() => void cargar()} />
          ) : filas === null ? (
            <EstadoCargaPagina />
          ) : filas.length === 0 ? (
            <EstadoVacio
              titulo={empresaActivaId ? 'Ningún depósito vende para esta empresa.' : 'Todavía no hay depósitos.'}
              descripcion={
                empresaActivaId
                  ? 'Elegí «Todas mis empresas» en la barra superior o marcá la empresa en «Pueden vender desde acá».'
                  : 'Creá el primero con «Nuevo depósito de mercadería».'
              }
            />
          ) : (
            <>
              <BarraHerramientas
                contador={`${filas.length} ${filas.length === 1 ? 'depósito' : 'depósitos'}`}
                ayuda={empresaActivaId ? 'Se listan los depósitos desde los que vende la empresa elegida en la barra superior.' : undefined}
              />
              <ContenidoAdaptable
                items={filas}
                columnas={columnas}
                obtenerClave={(fila) => fila.id}
                etiquetaTabla="Depósitos de mercadería"
                acciones={
                  puedeAdministrar
                    ? (fila) => (
                        <Button
                          size="small"
                          variant="outlined"
                          onClick={() => setDialogo({ deposito: fila, empresaId: empresaActivaId })}
                          aria-label={`Editar ${fila.nombre}`}
                        >
                          Editar
                        </Button>
                      )
                    : undefined
                }
              />
              <Typography variant="xs">{NOTA_DEPOSITO_CON_STOCK}</Typography>
            </>
          )}
        </Stack>
      </ContenedorSeccion>
      {puedeAdministrar && dialogoVigente && dialogo ? (
        <Suspense fallback={null}>
          <DepositoDialog
            deposito={dialogo.deposito}
            empresaPreseleccionada={empresaActivaId}
            empresas={empresas.filter((empresa) => empresa.activa)}
            errorEmpresas={errorEmpresas}
            onCerrar={() => setDialogo(null)}
            onGuardado={(_, esAlta) => {
              setDialogo(null)
              setAviso({ severidad: 'success', texto: esAlta ? MENSAJE_DEPOSITO_CREADO : MENSAJE_DEPOSITO_GUARDADO })
              void cargar()
            }}
          />
        </Suspense>
      ) : null}
    </Box>
  )
}
