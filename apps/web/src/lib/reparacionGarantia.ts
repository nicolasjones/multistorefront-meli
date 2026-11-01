import { supabaseClient } from './supabase'
import { aReparacion, errorDeCampoDe, type Reparacion } from './reparaciones'

// Reingreso por garantía (F-SVC-21). La base es la autoridad (RPC `reingresar_por_garantia` y
// `obtener_vinculos_garantia`); acá se valida solo para avisar antes de enviar.

export const LARGO_MAXIMO_FALLA_GARANTIA = 1000

export type CampoGarantia = 'falla' | 'tecnico' | 'entrega_prevista'
export type FormularioGarantia = { falla: string; tecnico: string; entrega_prevista: string }
export type ErroresGarantia = Partial<Record<CampoGarantia, string>>

export type VinculoGarantia = { id: string; codigo: string }
export type ReingresoGarantia = VinculoGarantia & { estado: string; ingreso: string }
export type VinculosGarantia = { origen: VinculoGarantia | null; reingresos: ReingresoGarantia[] }

type ErrorDeBase = { code?: string; message?: string; hint?: string } | null | undefined

const CAMPOS_GARANTIA: ReadonlyArray<CampoGarantia> = ['falla', 'tecnico', 'entrega_prevista']

export function formularioGarantiaVacio(): FormularioGarantia {
  return { falla: '', tecnico: '', entrega_prevista: '' }
}

export function validarGarantia(formulario: FormularioGarantia, ingresoHoy: string): ErroresGarantia {
  const errores: ErroresGarantia = {}
  const falla = formulario.falla.trim()
  if (falla === '') errores.falla = 'Describí la falla del reingreso'
  else if (falla.length > LARGO_MAXIMO_FALLA_GARANTIA) errores.falla = `Máximo ${LARGO_MAXIMO_FALLA_GARANTIA} caracteres`
  if (formulario.entrega_prevista !== '' && formulario.entrega_prevista < ingresoHoy) {
    errores.entrega_prevista = 'La entrega prevista no puede ser anterior al ingreso'
  }
  return errores
}

// Una reparación se reingresa solo si está entregada y no anulada (FR-024); la base lo repite.
export function admiteReingresoGarantia(reparacion: Pick<Reparacion, 'entrega_real' | 'anulada_en'>): boolean {
  return reparacion.entrega_real !== null && reparacion.anulada_en === null
}

export function errorDeCampoGarantia(error: unknown): { campo: CampoGarantia; mensaje: string } | null {
  return errorDeCampoDe(error, CAMPOS_GARANTIA)
}

export function mensajeDeErrorGarantia(error: unknown, porDefecto: string): string {
  console.error(porDefecto, error)
  const e = error as ErrorDeBase
  if (e?.code === '42501') return 'No tenés permiso para reingresar por garantía. Puede que tu rol haya cambiado: recargá la página.'
  if (e?.code === '55000') return 'Solo se puede reingresar por garantía una reparación entregada y no anulada.'
  if (e?.code === 'P0002') return 'Esa reparación ya no existe o no tenés acceso a su tienda. Volvé al listado.'
  if (e?.code === '22023' && e.message) return e.message
  return porDefecto
}

export async function reingresarPorGarantia(origenId: string, formulario: FormularioGarantia): Promise<Reparacion> {
  const { data, error } = await supabaseClient.rpc('reingresar_por_garantia', {
    p_reparacion_origen: origenId,
    p_falla: formulario.falla.trim(),
    p_tecnico: formulario.tecnico === '' ? null : formulario.tecnico,
    p_entrega_prevista: formulario.entrega_prevista === '' ? null : formulario.entrega_prevista,
  })
  if (error) throw error
  return aReparacion(data)
}

export async function obtenerVinculosGarantia(reparacionId: string): Promise<VinculosGarantia> {
  const { data, error } = await supabaseClient.rpc('obtener_vinculos_garantia', { p_reparacion: reparacionId })
  if (error) throw error
  const bruto = (data ?? {}) as Partial<VinculosGarantia>
  return { origen: bruto.origen ?? null, reingresos: bruto.reingresos ?? [] }
}
