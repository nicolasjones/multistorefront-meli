import type { AyudaPorDestino } from '../tipos'

export const ayudaPlataforma: AyudaPorDestino = {
  organizaciones: {
    titulo: 'Organizaciones',
    resumen:
      'Solo para superadministradores. Lista las organizaciones registradas en la plataforma, permite crear una nueva invitando por correo a quien la va a administrar, y entrar a una organización para trabajar dentro de ella.',
    pasos: [
      'Pulsá «Crear», ingresá el nombre de la organización y el email del fundador, y pulsá «Crear e invitar».',
      'Pulsá «Ingresar» en la fila de la organización a la que querés entrar.',
      'Indicá el motivo del ingreso: sin motivo no se puede entrar.',
    ],
  },
  servidores: {
    titulo: 'Servidores',
    resumen:
      'Solo para superadministradores. Lista los servidores ya preparados para las organizaciones, con su dirección, la organización a la que pertenecen y los datos de conexión. Desde acá también se puede dar de alta un servidor nuevo.',
    pasos: [
      'Revisá la organización y los datos de conexión de cada servidor.',
      'Pulsá «Crear» para dar de alta un servidor nuevo.',
    ],
  },
  funcionalidades: {
    titulo: 'Funcionalidades',
    resumen:
      'Solo para superadministradores. Permite habilitar o deshabilitar, organización por organización, las funcionalidades del catálogo. No se crean funcionalidades desde acá: el catálogo ya viene cargado.',
    pasos: [
      'Ubicá en la grilla la funcionalidad y la organización que querés configurar.',
      'Habilitala o deshabilitala desde la grilla; el cambio se aplica a esa organización.',
    ],
  },
  ia: {
    titulo: 'IA gobernada',
    resumen:
      'Solo para superadministradores. Es el punto de entrada para administrar la inteligencia artificial de la plataforma: proveedores, modelos y perfiles, contratos, políticas, interacciones y capacidades. Muestra los proveedores y si están habilitados o pendientes de verificación.',
    pasos: [
      'Revisá la lista de proveedores y su estado.',
      'Usá los botones de arriba para entrar a Modelos y perfiles, Contratos, Políticas o Interacciones.',
    ],
  },
  'integraciones-oauth': {
    titulo: 'Integraciones OAuth',
    resumen:
      'Solo para superadministradores. Es el catálogo de proveedores de conexión disponibles para todas las organizaciones. Acá se registra una integración y se la habilita o deshabilita. La integración se crea antes en el servicio externo; acá solo se registra su clave.',
    pasos: [
      'Ingresá la clave (la misma que ya existe en el servicio externo) y el nombre.',
      'Pulsá «Registrar integración».',
      'Usá «Habilitar» o «Deshabilitar» en la fila para activar o apagar una integración.',
    ],
  },
}
