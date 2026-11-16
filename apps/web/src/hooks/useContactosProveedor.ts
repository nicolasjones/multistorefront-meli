import { useCallback, useEffect, useRef, useState } from 'react'
import { supabaseClient } from '../lib/supabase'

// Contacto de un proveedor: lo que devuelve `public.listar_contactos_proveedor` (F-PRV-08).
export type ContactoProveedor = {
  id: string
  nombre: string
  rol: string | null
  correo: string | null
  telefono: string | null
  principal: boolean
}

export type DatosContacto = {
  nombre: string
  rol: string
  correo: string
  telefono: string
  principal: boolean
}

// Contactos de un proveedor. La autorización la resuelven las funciones. «Última petición gana».
export function useContactosProveedor(proveedorId: string | undefined) {
  const [contactos, setContactos] = useState<ContactoProveedor[]>([])
  const [cargando, setCargando] = useState(true)
  const [hayError, setHayError] = useState(false)
  const ultimaPeticion = useRef(0)

  const cargar = useCallback(async () => {
    if (!proveedorId) return
    const peticion = ++ultimaPeticion.current
    setCargando(true)
    setHayError(false)
    try {
      const { data, error } = await supabaseClient.rpc('listar_contactos_proveedor', { p_proveedor_id: proveedorId })
      if (error) throw error
      if (peticion === ultimaPeticion.current) setContactos((data ?? []) as ContactoProveedor[])
    } catch (error) {
      console.error('No pudimos cargar los contactos del proveedor.', error)
      if (peticion === ultimaPeticion.current) {
        setContactos([])
        setHayError(true)
      }
    } finally {
      if (peticion === ultimaPeticion.current) setCargando(false)
    }
  }, [proveedorId])

  useEffect(() => {
    void cargar()
  }, [cargar])

  return { contactos, cargando, hayError, recargar: cargar }
}

export async function agregarContactoProveedor(proveedorId: string, datos: DatosContacto): Promise<void> {
  const { error } = await supabaseClient.rpc('agregar_contacto_proveedor', {
    p_proveedor_id: proveedorId,
    p_nombre: datos.nombre,
    p_rol: datos.rol,
    p_correo: datos.correo,
    p_telefono: datos.telefono,
    p_principal: datos.principal,
  })
  if (error) throw error
}

export async function marcarContactoPrincipal(contactoId: string): Promise<void> {
  const { error } = await supabaseClient.rpc('marcar_contacto_principal', { p_contacto_id: contactoId })
  if (error) throw error
}
