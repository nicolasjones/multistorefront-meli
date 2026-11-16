import type { AyudaPorDestino } from '../tipos'

export const ayudaInicio: AyudaPorDestino = {
  inicio: {
    titulo: 'Inicio',
    resumen:
      'Es la primera pantalla al entrar. Te saluda y junta en un solo lugar lo que conviene mirar hoy: las alertas que hay que atender y tus empresas, más las tarjetas de stock, consultas y dólar, que se ven solo si tu rol tiene acceso a esa sección. Si podés editar, tenés además accesos directos para cargar cosas más rápido.',
    pasos: [
      'Revisá «Qué hacer hoy» para ver las alertas pendientes y entrá a cada una para resolverla.',
      'Mirá las tarjetas de stock y consultas, y usá «Ver stock» o «Abrir consultas» para ver el detalle.',
      'La tarjeta del dólar muestra la cotización vigente; si falta la de hoy y podés editar, pulsá «Cargar ahora».',
      'Si podés editar, usá los accesos «Nuevo comprobante», «Registrar movimiento» (te lleva a Stock) y «Nuevo producto».',
      'Si una tarjeta muestra un error, pulsá «Reintentar».',
    ],
  },
}
