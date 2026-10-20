// Mapa de recursos de Refine cuya visibilidad depende de una
// funcionalidad del panel (spec 009, US2) — a diferencia de
// RECURSOS_DEPENDIENTES_DE_ORGANIZACION (spec 004), acá la condición no es
// "tiene organización activa" sino "su organización efectiva tiene esta
// feature habilitada" (private.tiene_feature vía checkFeatureHabilitada).
//
// Sumar una pantalla a este mecanismo es agregar su `resource -> featureId`
// acá — no hace falta tocar accessControlProvider.
// Service técnico (F-SVC-01, FR-009): sus pantallas dependen de la funcionalidad `service-tecnico`.
export const RECURSOS_CONDICIONADOS_A_FEATURE: Readonly<Record<string, string>> = {
  'service-tecnico-modelos': 'service-tecnico',
  'service-tecnico-estados': 'service-tecnico',
}
