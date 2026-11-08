import { useEffect, useState } from 'react'
import { useLocation } from 'react-router'
import { useConsentimientoCookies } from '../../../lib/consentimientoCookies'
import {
  cargarMedicion,
  debeMedir,
  leerAnaliticaPublica,
  registrarVisita,
  retirarMedicion,
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
    // Otro host: se descartan los IDs del anterior y se apaga su medición hasta conocer los nuevos.
    setIds(null)
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
    // Con IDs nuevos (otro host o cambio de configuración) `cargarMedicion` reemplaza a los anteriores; si se revocó
    // el consentimiento o ya no hay IDs, se apaga la medición (los scripts ya descargados quedan inertes).
    if (medir && ids) cargarMedicion(ids)
    else retirarMedicion()
  }, [medir, ids])

  useEffect(() => {
    if (medir) registrarVisita(pathname)
  }, [medir, pathname])

  return null
}
