// Recursos de Refine cuya visibilidad, para un superadmin, depende de que
// tenga una organización activa (spec 004, FR-001/FR-002). Un
// administrador o miembro de organización los ve siempre — esto solo
// aplica a superadmin (accessControlProvider.ts).
//
// Sumar una pantalla nueva a esta categoría (por ejemplo, una futura
// gestión de miembros) es agregar el nombre del recurso acá — no hace
// falta tocar la lógica del accessControlProvider ni del guard de ruteo.
export const RECURSOS_DEPENDIENTES_DE_ORGANIZACION = ['clientes', 'miembros', 'analitica', 'conexiones'] as const
