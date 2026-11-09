import type { AyudaPorDestino } from '../tipos'

export const ayudaContactos: AyudaPorDestino = {
  clientes: {
    titulo: 'Clientes',
    resumen:
      'Listado de tus clientes con su tipo (minorista o mayorista), tiendas, datos de contacto y localidad. El tipo define el precio que se aplica. Tiene vistas de Listado, Ranking por facturación y Clientes inactivos. Según tu rol podés crear, editar, importar, exportar o imprimir etiquetas.',
    pasos: [
      'Buscá por nombre, DNI/CUIT, correo, teléfono, localidad o número.',
      'Filtrá por tipo (minorista o mayorista) o por Activos y Archivados.',
      'Tocá «Ver ficha» para ver todos los datos de un cliente.',
      'Si podés editar, tildá clientes y usá «Imprimir etiquetas» o «Enviar correo a seleccionados».',
      'Si podés editar, usá «Nuevo cliente» para cargar uno.',
    ],
  },
  'correo-masivo': {
    titulo: 'Correo masivo',
    resumen:
      'Permite escribirle el mismo correo a un grupo de clientes. Solo lo reciben quienes tienen un correo cargado y aceptan el correo masivo. Quien se da de baja no recibe más. En la pestaña Historial ves lo que se envió, a cuántos clientes y con qué resultado. Para armar una campaña hace falta permiso de edición en Clientes.',
    pasos: [
      'Filtrá los destinatarios (búsqueda, tipo, «Con cuenta web»), o tildalos antes en Clientes y usá «Enviar correo a seleccionados».',
      'Escribí el asunto y el mensaje, y revisá la vista previa.',
      'Tocá «Enviar correo» y confirmá: una vez creado no se puede cancelar.',
      'Entrá a Historial para ver el resultado de cada envío.',
    ],
  },
  proveedores: {
    titulo: 'Proveedores',
    resumen:
      'Listado de las empresas a las que les comprás, con razón social, CUIT, tiendas para las que compran, correo y teléfono. Podés abrir la ficha de cada proveedor. Según tu rol también podés crear proveedores, importarlos o enviarles un correo.',
    pasos: [
      'Buscá por razón social o CUIT.',
      'Filtrá por Activos, Inactivos o Todos.',
      'Tocá «Ver ficha» para abrir los datos de un proveedor.',
      'Si podés editar, usá «Nuevo proveedor» para cargar uno.',
    ],
  },
}
