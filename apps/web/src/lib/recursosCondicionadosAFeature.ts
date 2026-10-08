// Mapa de recursos de Refine cuya visibilidad depende de una
// funcionalidad del panel (spec 009, US2) — a diferencia de
// RECURSOS_DEPENDIENTES_DE_ORGANIZACION (spec 004), acá la condición no es
// "tiene organización activa" sino "su organización efectiva tiene esta
// feature habilitada" (private.tiene_feature vía checkFeatureHabilitada).
//
// Vacío a propósito (Assumptions de spec.md): esta spec entrega el
// mecanismo, no ninguna funcionalidad de negocio que se conecte todavía.
// Sumar una pantalla futura a este mecanismo es agregar su
// `resource -> featureId` acá — no hace falta tocar accessControlProvider.
export const RECURSOS_CONDICIONADOS_A_FEATURE: Readonly<Record<string, string>> = {}
