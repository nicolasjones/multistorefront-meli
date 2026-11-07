import { useEffect, useState } from 'react'
import { useLocation } from 'react-router'
import { useConsentimientoCookies } from '../../../lib/consentimientoCookies'
import {
  cargarMedicion,
  debeMedir,
  leerAnaliticaPublica,
  registrarVisita,
  type IdsMedicion,
} from '../../../lib/analiticaTienda'

// Medición de la tienda pública (F-TDA-24, FR-014, FR-015). No pinta nada. Consulta los IDs UNA vez por visita y
// solo carga los scripts de Google/Meta si hay al menos un ID Y la persona aceptó las cookies (F-TDA-22). Si acepta
// con la página abierta se cargan en ese momento; sin decisión o rechazadas no se descarga nada. Cada cambio de
// ruta de la SPA registra una visita. Se monta solo en el front público: la vista previa del panel no lo usa, y una
// tienda desactivada nunca llega al layout.
export default function MedicionTienda({ host }: { host: string }) {
  const consentimiento = useConsentimientoCookies()
  const { pathname } = useLocation()
  const [ids, setIds] = useState<IdsMedicion | null>(null)

  useEffect(() => {
    let cancelada = false
    void leerAnaliticaPublica(host).then((datos) => {
      if (!cancelada) setIds(datos)
    })
    return () => {
      cancelada = true
    }
  }, [host])

  const medir = debeMedir(ids, consentimiento)

  // Primero se carga (idempotente) y, en el mismo commit, se registra la visita de la ruta actual.
  useEffect(() => {
    if (medir && ids) cargarMedicion(ids)
  }, [medir, ids])

  useEffect(() => {
    if (medir) registrarVisita(pathname)
  }, [medir, pathname])

  return null
}
