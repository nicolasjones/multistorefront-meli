// F-MIG-02 (MSF-313, FR-020): definición de la entidad «proveedores» del asistente
// genérico. Las etiquetas son las columnas de la plantilla (las de la ficha de
// Proveedores); el identificador del panel actual es obligatorio: es la clave de
// conciliación (`dominio.proveedores.id_externo`, FR-021) y lo que hace idempotente
// la carga. Las mismas validaciones que el alta (CUIT con dígito verificador y único
// por organización) las impone la base en la vista previa y al aplicar.

import type { DefinicionEntidad } from '../../../lib/migracion'

export const ENTIDAD_PROVEEDORES: DefinicionEntidad = {
  id: 'proveedores',
  etiqueta: 'Proveedores',
  sustantivo: 'proveedor',
  sustantivoPlural: 'proveedores',
  descripcion: 'Traé los proveedores del panel actual. Se actualizan por identificador externo, sin duplicar.',
  campos: [
    {
      clave: 'id_externo',
      etiqueta: 'Identificador del panel actual',
      obligatorio: true,
      alias: ['id', 'id externo', 'identificador', 'identificador externo', 'codigo', 'codigo de proveedor'],
    },
    {
      clave: 'razon_social',
      etiqueta: 'Razón social',
      obligatorio: true,
      alias: ['razon social', 'nombre', 'proveedor', 'nombre proveedor'],
    },
    { clave: 'cuit', etiqueta: 'CUIT', obligatorio: true, alias: ['cuit', 'cuil', 'documento'] },
    {
      clave: 'persona_contacto',
      etiqueta: 'Persona de contacto',
      alias: ['contacto', 'persona de contacto', 'persona contacto'],
    },
    { clave: 'correo', etiqueta: 'Correo', alias: ['email', 'e mail', 'correo electronico', 'mail'] },
    { clave: 'telefono', etiqueta: 'Teléfono', alias: ['telefono', 'tel', 'celular'] },
    { clave: 'direccion', etiqueta: 'Dirección', alias: ['direccion', 'domicilio'] },
    { clave: 'observaciones', etiqueta: 'Observaciones', alias: ['observaciones', 'notas', 'comentarios'] },
  ],
  rpcPrevisualizar: 'previsualizar_lote_proveedores',
  rpcAplicar: 'aplicar_lote_proveedores',
  archivoPlantilla: 'proveedores.csv',
  siguiente: {
    ruta: '/migracion/importar/vinculos-proveedor-producto',
    etiqueta: 'Seguir con los vínculos proveedor ↔ producto',
  },
}
