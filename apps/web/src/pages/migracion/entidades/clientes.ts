// F-MIG-01 (MSF-299, FR-003): definición de la entidad «clientes» del
// asistente genérico. Las etiquetas son las del diálogo «Importar clientes»
// del prototipo; la plantilla usa exactamente esas columnas para que el
// auto-mapeo funcione sin tocar nada.
//
// El identificador del panel actual es obligatorio: es la clave de
// conciliación (`clientes_identificadores_externos`, sistema `panel_actual`,
// D1) y lo que hace idempotente la carga. El «Número» del cliente no se
// mapea: lo asigna el sistema (D4).

import type { DefinicionEntidad } from '../../../lib/migracion'

export const ENTIDAD_CLIENTES: DefinicionEntidad = {
  id: 'clientes',
  etiqueta: 'Clientes',
  sustantivo: 'cliente',
  sustantivoPlural: 'clientes',
  descripcion: 'Traé la base de clientes del panel actual. Se actualizan por identificador externo, sin duplicar.',
  campos: [
    {
      clave: 'id_externo',
      etiqueta: 'Identificador del panel actual',
      obligatorio: true,
      alias: ['id', 'id externo', 'identificador', 'identificador externo', 'codigo', 'codigo de cliente'],
    },
    {
      clave: 'nombre',
      etiqueta: 'Nombre o razón social',
      obligatorio: true,
      alias: ['nombre', 'razon social', 'cliente', 'nombre cliente'],
    },
    { clave: 'documento', etiqueta: 'DNI / CUIT', alias: ['dni', 'cuit', 'documento', 'dni cuit'] },
    { clave: 'tipo', etiqueta: 'Tipo de cliente', alias: ['tipo', 'tipo cliente'] },
    { clave: 'correo', etiqueta: 'Correo', alias: ['email', 'e mail', 'correo electronico', 'mail'] },
    { clave: 'telefono', etiqueta: 'Teléfono', alias: ['telefono', 'tel'] },
    { clave: 'celular', etiqueta: 'Celular', alias: ['celular', 'movil'] },
    { clave: 'direccion', etiqueta: 'Dirección', alias: ['direccion', 'domicilio', 'direccion postal'] },
    { clave: 'codigo_postal', etiqueta: 'CP', alias: ['cp', 'codigo postal', 'cod postal'] },
    { clave: 'localidad', etiqueta: 'Localidad', alias: ['localidad', 'ciudad'] },
    { clave: 'provincia', etiqueta: 'Provincia', alias: ['provincia', 'estado'] },
    { clave: 'expreso_preferido', etiqueta: 'Expreso preferido', alias: ['expreso', 'transporte', 'expreso preferido'] },
  ],
  rpcPrevisualizar: 'previsualizar_lote_clientes',
  rpcAplicar: 'aplicar_lote_clientes',
  archivoPlantilla: 'clientes.csv',
}
