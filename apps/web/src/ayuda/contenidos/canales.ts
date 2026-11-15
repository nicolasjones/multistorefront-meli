import type { AyudaPorDestino } from '../tipos'

export const ayudaCanales: AyudaPorDestino = {
  consultas: {
    titulo: 'Consultas',
    resumen:
      'Bandeja con los mensajes que llegan desde el formulario de contacto de las tiendas y el interés por WhatsApp desde las fichas de producto. Cada consulta tiene un estado, el contacto, el producto y de qué tienda viene. El número junto al menú indica cuántas son nuevas.',
    pasos: [
      'Buscá o filtrá por estado y por fechas para encontrar una consulta.',
      'Tocá el nombre del contacto para abrir el detalle.',
      'Si podés editar, cambiá el estado, elegí un responsable y dejá una nota interna.',
      'Usá «Respuestas rápidas» para consultar los textos preparados.',
    ],
  },
  contactos: {
    titulo: 'Contactos',
    resumen:
      'Libreta de personas que consultan o compran, organizada por tienda. Cada contacto tiene su ficha con nombre, correo, teléfono, consentimiento e historial de consultas y compras. Podés crear contactos nuevos y, si hace falta, anonimizarlos.',
    pasos: [
      'Elegí una tienda con el filtro de empresas para acotar la lista.',
      'Buscá por nombre, correo o teléfono.',
      'Tocá un contacto para abrir su ficha e historial.',
      'Elegí una tienda y usá «Nuevo contacto» para crear uno.',
    ],
  },
  empresas: {
    titulo: 'Empresas',
    resumen:
      'Pantalla solo para administradores. Muestra las empresas o tiendas de la organización y si están activas o pausadas. Desde cada una podés editar sus datos y su regla de precios (la moneda es pesos argentinos y no se cambia), o entrar a la configuración de su tienda. También podés crear una empresa nueva.',
    pasos: [
      'Revisá el estado de cada empresa en la lista.',
      'Tocá «Editar» para cambiar los datos generales y, en «Precios y moneda», la regla de precios.',
      'Tocá «Tienda» para entrar a la configuración de su tienda online.',
      'Tocá «Nueva empresa» para crear otra.',
    ],
  },
}
