import type { AyudaPorDestino } from '../tipos'

export const ayudaAdministracion: AyudaPorDestino = {
  organizacion: {
    titulo: 'Mi organización',
    resumen:
      'Acá editás el nombre, el logo y la zona horaria de tu organización, y ves la lista de sus empresas con un acceso para editar cada una. Solo los administradores pueden entrar y guardar cambios.',
    pasos: [
      'Cambiá el nombre de la organización y elegí la zona horaria.',
      'Subí un logo con el botón de carga, o quitalo si ya no lo querés.',
      'Guardá los cambios.',
      'En «Empresas de la organización» tocá «Editar» para modificar una empresa.',
    ],
  },
  cotizacion: {
    titulo: 'Cotización del dólar',
    resumen:
      'Es el valor del dólar que se carga cada día para calcular los precios de los productos en USD. Ves la cotización vigente, su configuración y el historial. Cargarla requiere permiso de edición en esta sección; con permiso de lectura solo podés consultarla.',
    pasos: [
      'Tocá «Cargar cotización» e ingresá el dólar del día.',
      'Si tu organización trabaja por empresa, elegí primero la empresa.',
      'Revisá la cotización vigente y el historial para ver los valores anteriores.',
    ],
  },
  'listas-configurables': {
    titulo: 'Listas configurables',
    resumen:
      'Permite adaptar a tu negocio dos listas: los motivos de stock y los estados de consulta. Podés crear nuevos, editar el nombre y activar o desactivar los existentes. Es una pantalla solo para administradores.',
    pasos: [
      'En «Motivos de stock» creá uno nuevo o editá los que ya existen.',
      'En «Estados de consulta» usá «Nuevo estado» para sumar uno.',
      'Renombrá o desactivá un estado que ya no uses.',
    ],
  },
  actividad: {
    titulo: 'Actividad',
    resumen:
      'Historial básico de lo que pasó en tu organización: cambios de productos, movimientos de stock, importaciones y configuración de tiendas. Podés buscar y filtrar por período, usuario y tipo, ver el detalle de cada evento y, si tenés permiso de edición y de exportar, exportar la lista.',
    pasos: [
      'Escribí en «Buscar en la actividad» para encontrar un evento.',
      'Filtrá por período, usuario o tipo.',
      'Tocá «Ver detalle» en una fila para ver qué cambió.',
      'Si no ves resultados, probá con otro período o quitá algún filtro.',
    ],
  },
  importaciones: {
    titulo: 'Importaciones',
    resumen:
      'Muestra las cargas y descargas masivas de la organización con su fecha, origen, estado, avance, resultado y duración. Desde acá abrís el detalle de cada una para ver sus errores y pedís la exportación de todos los datos en un archivo ZIP. Es solo para administradores.',
    pasos: [
      'Mirá la tabla para seguir el avance de cada proceso.',
      'Tocá «Ver detalle» para revisar los errores de un proceso.',
      'Tocá «Cancelar» en un proceso abierto si querés frenarlo.',
      'Usá «Exportar todos los datos» para descargar toda la información.',
    ],
  },
  usuarios: {
    titulo: 'Usuarios',
    resumen:
      'Lista a las personas que entran al panel con su rol, sus empresas, el último acceso y su estado. Podés invitar usuarios nuevos, editar su rol, suspenderlos, reactivarlos, removerlos y restablecer su contraseña. Es solo para administradores.',
    pasos: [
      'Tocá «Invitar usuario» para sumar a una persona.',
      'Usá «Editar» para cambiar su rol en cada empresa.',
      'Usá «Suspender» o «Reactivar» para cortar o devolver el acceso.',
      'Lo que puede hacer cada rol se define en Roles y permisos.',
    ],
  },
  roles: {
    titulo: 'Roles y permisos',
    resumen:
      'Define qué puede ver y editar cada rol en tu organización, sección por sección y también por acción. Podés guardar los cambios o volver a los valores iniciales. Es solo para administradores.',
    pasos: [
      'Elegí en la matriz el nivel de acceso de cada rol en cada sección.',
      'Revisá los permisos por acción en la segunda matriz.',
      'Tocá «Guardar cambios» para aplicarlos.',
      'Usá «Restablecer valores iniciales» para descartar tus cambios y volver a la matriz inicial de cada rol (pide confirmar).',
    ],
  },
  'migracion-datos': {
    titulo: 'Migración de datos',
    resumen:
      'Asistente para traer datos desde el panel anterior a partir de un archivo CSV. Vuelve a cargar sin duplicar lo que ya se importó. Es una herramienta de uso puntual, solo para administradores.',
    pasos: [
      'Descargá la plantilla CSV y completala, o elegí tu archivo CSV.',
      'Asociá cada columna del archivo con su campo.',
      'Revisá la vista previa: las filas con error no se importan. Si hace falta, corregí el archivo y volvé a subirlo.',
      'Pulsá «Importar…» para aplicar; el resultado se ve en pantalla y desde «Ver informe de conciliación» abrís el informe.',
    ],
  },
  api: {
    titulo: 'API',
    resumen:
      'Permite que otros sistemas lean datos de tu organización de forma segura, con claves que vos controlás. Desde acá creás y revocás claves, configurás avisos automáticos hacia otros sistemas y revisás las llamadas recientes. Es solo para administradores.',
    pasos: [
      'Pulsá «Crear clave», dale un nombre y elegí qué datos puede leer. La clave completa se muestra una sola vez: copiala.',
      'Usá «Rotar» para cambiar una clave o «Revocar» para dejarla sin acceso al instante (pide confirmar).',
      'En Suscripciones indicá a qué dirección avisar cuando pasa algo, y revisá en Entregas si el aviso llegó.',
      'En Llamadas recientes ves quién consultó, cuándo y si salió bien.',
    ],
  },
}
