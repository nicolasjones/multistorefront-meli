// Datos del módulo 03 (stock y compras): depósitos, rangos de stock inicial por rubro y casos borde elegidos a mano.
// Todo lo que sea azar sale de `ctx.azar` en el módulo; acá solo quedan las decisiones fijas.

// Depósitos extra (el «Depósito principal» lo crea la organización al nacer y queda por defecto).
// `ventas`: empresas que venden desde ahí. `inactivo`: se crea vacío y se desactiva (el por defecto y los que tienen
// unidades no se pueden desactivar, así que el depósito cerrado tiene que nacer sin stock).
export const DEPOSITOS = [
  { clave: 'local', nombre: 'Local Corrientes', direccion: 'Av. Corrientes 4521, CABA', ventas: ['sanjavucho'] },
  { clave: 'cordoba', nombre: 'Depósito Córdoba', direccion: 'Obispo Trejo 745, Córdoba', ventas: ['mundojc'] },
  { clave: 'barracas', nombre: 'Depósito Barracas (cerrado)', direccion: 'Av. Montes de Oca 1230, CABA', ventas: [], inactivo: true },
]
export const PRINCIPAL = { direccion: 'Lavalle 1520, 3.º piso, CABA', ventas: ['sanjavucho', 'mundojc'] }

// Rango de unidades del stock inicial por categoría raíz [mín, máx].
export const RANGOS = {
  'Consolas de juegos': [5, 12],
  'Repuestos videojuegos': [20, 150],
  'Herramientas': [5, 40],
  'Outlet': [4, 15],
  default: [10, 60], // accesorios, celulares, belleza, novedades
}
// Unidades por línea de un ingreso de mercadería, por categoría raíz.
export const RANGOS_COMPRA = {
  'Consolas de juegos': [2, 6],
  'Repuestos videojuegos': [20, 60],
  'Herramientas': [5, 15],
  'Outlet': [2, 6],
  default: [10, 40],
}

// Productos que NO reciben carga inicial: a pedido, stock entrante en breve y algunos sin movimiento todavía.
// Sirven para tener «sin stock» reales en el listado (el PS5 Pro recibe unidades por ingreso: ver PEDIDO).
export const SIN_CARGA = [
  'CON-PS5-PRO', 'CON-XBS-X', 'NOV-PS5-PORTAL', // a pedido / stock entrante
  'OUT-PS4-FAT', 'REP-WII-LENTE', 'BEL-MASAJ-FAC', 'NOV-JOY-HALL', 'HER-LUPA-LED', 'ALM-HDD-2TB-EXT',
]
// Se cargan y después un conteo los deja en cero (se agotaron): productos «en cero» con historial.
export const A_CERO = ['REP-PS3-FUENTE', 'CON-WII-REAC', 'HER-MALLA-DES']
// Se les fija un mínimo por encima de lo que hay: quedan «stock bajo».
export const BAJO_MINIMO = ['JOY-DSENSE-BL', 'CAB-HDMI21-2M', 'REP-DS4-STICK', 'CEL-VIDRIO-9H', 'AUD-GAMER-71', 'CON-NSW-LITE', 'HER-KIT-24', 'ALM-SD-128']
// Mínimo bajo y mucho stock: «con exceso».
export const CON_EXCESO = ['REP-NSW-SLOT', 'CAB-HDMI14-15', 'CEL-FUNDA-SIL', 'HER-ESTANO-100', 'BEL-KIT-MANI']

// Producto «A pedido» (el único del catálogo): las reservas solo aplican a él.
export const PEDIDO = { sku: 'CON-PS5-PRO', unidades: 8 }

// Los proveedores y su peso en las compras. `beauty` vende solo a Mundo JC.
export const PESO_PROVEEDORES = [['norte', 6], ['parts', 5], ['plata', 3], ['asia', 3], ['nippon', 3], ['cel', 2], ['herr', 2], ['beauty', 1]]

export const MOTIVOS_ANULACION = [
  'Mercadería cargada dos veces: el remito ya estaba registrado',
  'Error de carga: las cantidades del remito eran otras',
  'El proveedor retiró el pedido por faltante de documentación',
]

export const NOTAS_ROTURA = [
  'Unidad dañada al desembalar', 'Se cayó de la estantería', 'Falla de fábrica, no se acepta reclamo', 'Empaque abierto y producto incompleto',
  'Humedad en el depósito', 'Roto en mostrador al probar', 'Faltante detectado, se da de baja',
]
export const NOTAS_DEVOLUCION = [
  'Devolución de cliente: no era compatible', 'Devolución de cliente: cambio por otro modelo', 'Cliente devuelve sin uso, empaque original',
  'Devolución de cliente dentro de los 10 días',
]
export const NOTAS_DEVOLUCION_PROVEEDOR = ['Devolución al proveedor: lote con fallas', 'Devolución al proveedor: se pidió otro modelo']

// Historial del panel anterior (archivo de solo consulta): operadores ficticios.
export const OPERADORES_ANTERIORES = ['Ramiro (panel anterior)', 'Julieta (panel anterior)', 'Matías (panel anterior)', 'Depósito Central (panel anterior)']

// Mensajes a los que se les da el visto bueno como «rechazo esperado» en las verificaciones de casos borde.
export const comprobante = (punto, numero) => `A-${String(punto).padStart(4, '0')}-${String(numero).padStart(8, '0')}`
