import type { AyudaPorDestino } from '../tipos'

export const ayudaService: AyudaPorDestino = {
  'service-tecnico-reparaciones': {
    titulo: 'Reparaciones',
    resumen:
      'Lista de los equipos que ingresan al taller, con su cliente, técnico, estado, fecha de entrega y total. Podés filtrar por período de entrega, por número de serie y por técnico, y entrar al detalle de cada reparación. Se muestran las reparaciones de la empresa activa.',
    pasos: [
      'Elegí el período (Hoy, Semana o Mes) para ver las entregas previstas.',
      'Buscá por número de serie si querés ubicar un equipo puntual.',
      'Filtrá por técnico para ver solo sus reparaciones.',
      'Tocá el código de una reparación para abrir su detalle.',
      'Si podés editar, usá «Nueva reparación» para cargar un equipo que ingresa.',
    ],
  },
  'service-tecnico-modelos': {
    titulo: 'Modelos',
    resumen:
      'Catálogo de consolas y equipos que se reparan, con la mano de obra base de cada uno y la cantidad de reparaciones que lo usan. Desde acá se activa o desactiva cada modelo. Si tu rol solo permite ver, la lista se muestra sin botones para modificarla.',
    pasos: [
      'Revisá el equipo, el modelo y su mano de obra base.',
      'Si podés editar, tocá «Nuevo modelo» para sumar uno.',
      'Usá «Editar» en una fila para cambiar sus datos.',
      'Apagá el interruptor «Activo» para dejar de usar un modelo.',
    ],
  },
  'service-tecnico-estados': {
    titulo: 'Estados de reparación',
    resumen:
      'Las etapas por las que pasa un equipo en el taller. El orden de la lista define el flujo. Para cada estado ves qué significa, cuántas reparaciones lo usan, si avisa al cliente y si cierra la reparación. Si tu rol solo permite ver, no aparecen los controles de edición.',
    pasos: [
      'Mirá el orden y el significado de cada estado.',
      'Si podés editar, usá las flechas para subir o bajar un estado.',
      'Tocá «Nuevo estado» para sumar una etapa o «Editar» para cambiarla.',
      'Usá «Activo» para habilitar o deshabilitar un estado.',
    ],
  },
}
