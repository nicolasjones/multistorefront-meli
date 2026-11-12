import type { AyudaPorDestino } from '../tipos'

export const ayudaCatalogo: AyudaPorDestino = {
  productos: {
    titulo: 'Productos',
    resumen:
      'Es el listado de los productos de tu organización. Podés buscar, filtrar y ordenar, ver el precio, el estado y en qué empresas se vende cada uno. Con permiso de edición también podés crear, editar, duplicar, activar o desactivar productos; con edición también podés actualizar precios en bloque, y los administradores importan un CSV y exportan el listado. Los productos no se borran: se desactivan.',
    pasos: [
      'Buscá por nombre, SKU o código de barras y ajustá los filtros (estado, tienda, categoría, disponibilidad).',
      'Pulsá «Nuevo producto» para cargar uno, o «Editar» en la fila para modificarlo.',
      'Usá «Duplicar» para partir de un producto parecido y no cargar todo de nuevo.',
      'Desactivá un producto que ya no vendés; queda en el listado como «Inactivo».',
      'Pulsá «Actualizar precios» para subir o bajar costos y precios en bloque, por porcentaje o planilla, con vista previa.',
    ],
  },
  promociones: {
    titulo: 'Promociones',
    resumen:
      'Acá programás precios promocionales por empresa con fecha de inicio y fin. Mientras dura la promoción, la tienda muestra el precio promocional con el precio anterior tachado; al vencer vuelve sola al precio normal. Con permiso de edición en la tienda podés crear, editar y anular sus promociones; sin acceso a una tienda no ves las suyas.',
    pasos: [
      'Elegí una empresa en la barra superior: con «Todas mis empresas» ves todas, pero para crear una tenés que elegir una.',
      'Pulsá «Nueva promoción», elegí el producto, el precio promocional y las fechas de inicio y fin.',
      'Revisá el estado de cada promoción: programada, vigente, vencida o anulada.',
      'Pulsá «Anular» si una promoción ya no corresponde; no hace falta esperar a que venza.',
    ],
  },
  categorias: {
    titulo: 'Categorías',
    resumen:
      'Acá ordenás tus productos en un árbol de categorías de dos niveles. Cada categoría tiene su IVA. Con permiso de edición podés crear categorías y cambiar su orden arrastrándolas o con el teclado; con permiso de lectura solo ves el árbol.',
    pasos: [
      'Pulsá «Nueva categoría» para crear una y elegí su IVA.',
      'Usá «Expandir todo» o «Contraer todo» para recorrer el árbol más rápido.',
      'Arrastrá una categoría a su nueva posición para reordenarla.',
      'Si no ves categorías, probá «Limpiar filtros»; si el IVA no carga, pulsá «Reintentar IVA».',
    ],
  },
}
