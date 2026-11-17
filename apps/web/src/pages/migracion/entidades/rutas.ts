// Identificadores y rutas de las entidades de migración: una sola fuente para el registro, el enlace «Seguir con…»
// y las pestañas, así la pestaña activa siempre coincide con la ruta a la que se llega.
export const ID_ENTIDAD_VINCULOS = 'vinculos_proveedor_producto'

export const rutaImportacion = (idEntidad: string) => `/migracion/importar/${idEntidad}`
