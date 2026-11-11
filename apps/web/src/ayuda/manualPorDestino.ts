// Qué página del manual de producto (`docs/producto/<pagina>.md`) corresponde a cada pantalla del menú (F-CFG-02, MSF-385).
// Clave = `id` del destino en `SECCIONES_PANEL`; valor = nombre de la página SIN extensión. Acá no hay direcciones: la dirección
// del manual está en `manual.ts`. Un destino que no figura abre el índice del manual (pantallas de plataforma sin página propia).
export const MANUAL_POR_DESTINO: Readonly<Record<string, string>> = {
  inicio: 'inicio-y-alertas',
  productos: 'catalogo-productos',
  categorias: 'catalogo-listado-y-categorias',
  promociones: 'precios-e-iva',
  stock: 'stock-movimientos',
  'stock-movimientos': 'stock-movimientos',
  'stock-ingresos': 'ingreso-de-mercaderia',
  'stock-depositos': 'stock-depositos-y-reservas',
  'ventas-mostrador': 'ventas-mostrador',
  'ventas-comprobantes': 'ventas-comprobantes',
  'ventas-presupuestos': 'ventas-comprobantes',
  'ventas-devoluciones': 'ventas-rma-devoluciones',
  transportes: 'ventas-catalogos',
  'ventas-pagos': 'ventas-cobros-y-conciliacion',
  'ventas-configuracion': 'ventas-catalogos',
  'cuentas-cobro': 'ventas-catalogos',
  'ventas-reportes': 'ventas-reportes',
  'ventas-despacho': 'ventas-despacho-y-faltantes',
  'ventas-faltantes': 'ventas-despacho-y-faltantes',
  historial: 'ventas-historial-consulta',
  'service-tecnico-reparaciones': 'service-listado-items-impresion',
  'service-tecnico-modelos': 'service-alta-estados-y-permisos',
  'service-tecnico-estados': 'service-alta-estados-y-permisos',
  'service-tecnico-reportes': 'service-seguimiento-y-reportes',
  clientes: 'clientes',
  'correo-masivo': 'correo-masivo-a-clientes',
  proveedores: 'proveedores',
  consultas: 'consultas',
  contactos: 'contactos',
  empresas: 'organizacion-y-empresas',
  rentabilidad: 'rentabilidad',
  'reportes-reposicion': 'stock-unico-y-alertas',
  organizacion: 'organizacion-y-empresas',
  cotizacion: 'precios-dolar',
  'listas-configurables': 'avisos-y-listas',
  actividad: 'actividad',
  importaciones: 'importaciones',
  usuarios: 'usuarios-y-roles',
  roles: 'usuarios-y-roles',
  'migracion-datos': 'migracion-inicial-de-datos',
}

/**
 * Destinos que NO tienen página propia en el manual y abren su índice: pantallas de administración de la plataforma y el
 * reporte de inventario. Cada destino del menú tiene que estar acá o en `MANUAL_POR_DESTINO` (lo exige `manual.test.ts`), así
 * que una pantalla nueva obliga a decidir su página del manual, igual que con su ayuda.
 */
export const SIN_PAGINA_PROPIA: readonly string[] = [
  'reportes-inventario',
  'organizaciones',
  'servidores',
  'funcionalidades',
  'ia',
  'integraciones-oauth',
  'api',
]
