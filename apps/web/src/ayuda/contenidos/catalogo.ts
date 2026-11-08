import type { AyudaPorDestino } from '../tipos'

export const ayudaCatalogo: AyudaPorDestino = {
  productos: {
    titulo: 'Productos',
    resumen:
      'Es el listado de los productos de tu organización. Podés buscar, filtrar y ordenar, ver el precio, el estado y en qué empresas se vende cada uno. Con permiso de edición también podés crear, editar, duplicar, activar o desactivar productos; los administradores además importan un CSV y exportan el listado. Los productos no se borran: se desactivan.',
    pasos: [
      'Buscá por nombre, SKU o código de barras y ajustá los filtros (estado, tienda, categoría, disponibilidad).',
      'Pulsá «Nuevo producto» para cargar uno, o «Editar» en la fila para modificarlo.',
      'Usá «Duplicar» para partir de un producto parecido y no cargar todo de nuevo.',
      'Desactivá un producto que ya no vendés; queda en el listado como «Inactivo».',
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
      'Si algo no carga, pulsá «Reintentar IVA» o «Limpiar filtros».',
    ],
  },
}
