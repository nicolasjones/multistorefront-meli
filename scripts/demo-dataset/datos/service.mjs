// Datos del módulo 06 · Service técnico. Todo ficticio. Precios y costos en USD, como el resto del dataset.
//
// Las claves de modelo son cortas para que las reparaciones se lean de un vistazo; `equipo`+`modelo` es lo que ve la
// persona en pantalla. `base` es la mano de obra base que sugiere el sistema (el técnico la ajusta por reparación).

export const MODELOS = [
  // clave, equipo, modelo, mano de obra base (USD)
  ['ps5', 'PlayStation 5', 'Estándar', 28],
  ['ps5d', 'PlayStation 5', 'Digital', 28],
  ['ps5s', 'PlayStation 5', 'Slim', 30],
  ['ps4s', 'PlayStation 4', 'Slim', 20],
  ['ps4f', 'PlayStation 4', 'Fat', 20],
  ['ps4p', 'PlayStation 4', 'Pro', 24],
  ['ps3', 'PlayStation 3', 'Slim', 18],
  ['ps3ss', 'PlayStation 3', 'Super Slim', 18],
  ['vita', 'PlayStation Vita', 'PCH-2000', 14],
  ['nsw', 'Nintendo Switch', 'Estándar', 18],
  ['nswl', 'Nintendo Switch', 'Lite', 16],
  ['nswo', 'Nintendo Switch', 'OLED', 20],
  ['xbo', 'Xbox One', 'S', 20],
  ['xbox', 'Xbox One', 'X', 24],
  ['xss', 'Xbox Series', 'S', 24],
  ['xsx', 'Xbox Series', 'X', 28],
  ['x360', 'Xbox 360', 'Slim', 16],
  ['wii', 'Nintendo Wii', 'RVL-001', 12],
  ['gba', 'Game Boy Advance', 'SP', 10],
  ['ds4', 'Joystick', 'DualShock 4', 7],
  ['dsense', 'Joystick', 'DualSense', 9],
  ['procon', 'Joystick', 'Pro Controller', 10],
  ['joycon', 'Joystick', 'Joy-Con (par)', 8],
  ['xjoy', 'Joystick', 'Xbox Series', 8],
  ['deck', 'Steam Deck', 'LCD 256 GB', 30],
  ['a54', 'Celular', 'Samsung Galaxy A54', 12],
  ['ip11', 'Celular', 'iPhone 11', 15],
]
// Los siete modelos que la organización trae de fábrica (sembrado de la migración) están en ARS y el de PS4 Slim
// viene desactivado: el módulo los pasa a USD y reactiva PS4 Slim para que el dataset sea coherente.
export const MODELOS_DE_FABRICA = new Set(['ps5', 'ps4s', 'nsw', 'nswl', 'nswo', 'procon', 'joycon'])

// Estados propios (la organización nace con 7 de sistema). `subir`: posiciones que sube en el orden de la pantalla.
export const ESTADOS_PROPIOS = [
  { nombre: 'Presupuesto enviado', descripcion: 'Se le pasó el presupuesto al cliente y se espera su respuesta.', avisa: true, subir: 5 },
  { nombre: 'Garantía en revisión', descripcion: 'Re-ingreso por garantía: el técnico verifica si la falla es la misma de la reparación anterior.', avisa: false, subir: 3 },
  { nombre: 'Derivado a proveedor', descripcion: 'Equipo enviado al laboratorio del proveedor (se dejó de usar).', avisa: true, subir: 0, desactivar: true },
]

// Reparaciones. Campos:
//   emp       'sj' (San Javucho) | 'jc' (Mundo JC)
//   dias      días atrás en que ingresó el equipo
//   prom      días de plazo prometido desde el ingreso (null: sin fecha prometida)
//   ruta      estados por los que pasó, en orden, después de «Recibido»
//   fin       null (sigue abierta) | 'entregada' | 'sin_reparacion' | 'anulada'
//   entrega   días después del ingreso en que se entregó (entregada / sin_reparacion)
//   items     [sku|null, cantidad, precio|null] o ['libre', descripción, cantidad, precio]; precio null = precio de lista
//   mo        mano de obra cobrada: null = base del modelo, número = personalizada, 0 = no se cobra
//   serie     número de serie (null: el equipo no tiene o no se pudo leer)
//   quien     quién registra la recepción: 'operador' (default) o 'tecnico'
//   cliente   'cf' = consumidor final (cliente de mostrador sin ficha)
// Los textos de `falla` pueden llevar {r:clave} para citar el código (R-0001) de otra reparación.
const R = (clave, emp, modelo, falla, o) => ({ clave, emp, modelo, falla, serie: undefined, acc: '', items: [], mo: null, prom: 5, ruta: [], fin: null, quien: 'operador', ...o })

export const REPARACIONES = [
  // — Entregadas (9) —
  R('r01', 'sj', 'ps4s', 'No lee discos: la bandeja entra y sale sin reconocer el juego.', { serie: 'CUH-2215B-8830417', acc: 'Cable de poder y un DualShock 4', dias: 78, prom: 5, ruta: ['En diagnóstico', 'Presupuesto enviado', 'En reparación', 'Listo para entregar'], fin: 'entregada', entrega: 9, quien: 'tecnico', items: [['REP-PS4-LECTOR', 1, null]] }),
  R('r02', 'sj', 'ds4', 'Drift en el analógico izquierdo, el personaje camina solo.', { serie: null, acc: 'Solo el joystick', dias: 70, prom: 3, ruta: ['En diagnóstico', 'En reparación', 'Listo para entregar'], fin: 'entregada', entrega: 4, items: [['REP-DS4-STICK', 1, null]] }),
  R('r03', 'sj', 'nswl', 'Pantalla rota después de una caída; el equipo enciende pero no se ve nada.', { serie: 'XJW10045512377', acc: 'Funda blanda', dias: 66, prom: 7, ruta: ['En diagnóstico', 'Presupuesto enviado', 'Esperando repuesto', 'En reparación', 'Listo para entregar'], fin: 'entregada', entrega: 8, mo: 22, items: [['REP-NSW-LCD', 1, null]] }),
  R('r04', 'jc', 'xbo', 'No enciende: ni luz ni sonido, la fuente hace un zumbido.', { serie: '027412304517', acc: 'Fuente original y control', dias: 62, prom: 6, ruta: ['En diagnóstico', 'En reparación', 'Listo para entregar'], fin: 'entregada', entrega: 7, quien: 'tecnico', items: [['REP-XBO-FUENTE', 1, null]] }),
  R('r05', 'sj', 'ps5', 'Se recalienta y el ventilador suena como turbina a los diez minutos de jugar.', { serie: 'F0132A41700233', acc: 'Sin accesorios', dias: 55, prom: 4, ruta: ['En diagnóstico', 'En reparación', 'Listo para entregar'], fin: 'entregada', entrega: 5, items: [['REP-PS5-VENT', 1, null], ['HER-PASTA-TERM', 1, null]] }),
  R('r06', 'sj', 'ps4f', 'Sin imagen: el puerto HDMI está flojo y se rompió una pata.', { serie: 'CUH-1215A-5560981', acc: 'Cable HDMI', dias: 50, prom: 6, ruta: ['En diagnóstico', 'Presupuesto enviado', 'En reparación', 'Listo para entregar'], fin: 'entregada', entrega: 7, mo: 30, items: [['REP-PS4-HDMI', 1, null]] }),
  R('r07', 'sj', 'joycon', 'Los dos Joy-Con tienen drift, el izquierdo es el peor.', { serie: null, acc: 'Par de Joy-Con y correas', dias: 44, prom: 4, ruta: ['En diagnóstico', 'En reparación', 'Listo para entregar'], fin: 'entregada', entrega: 4, items: [['REP-JOYCON-STICK', 2, null]] }),
  R('r08', 'jc', 'nsw', 'No carga: el cable conecta pero la batería no sube.', { serie: 'XAW10078834120', acc: 'Dock y cargador', dias: 40, prom: 5, ruta: ['En diagnóstico', 'En reparación', 'Listo para entregar'], fin: 'entregada', entrega: 6, items: [['libre', 'Puerto de carga USB-C (genérico)', 1, 6]] }),
  R('r09', 'sj', 'dsense', 'La batería dura menos de una hora.', { serie: '0003AC2411880', acc: 'Cable USB-C', dias: 36, prom: 3, ruta: ['En diagnóstico', 'En reparación', 'Listo para entregar'], fin: 'entregada', entrega: 3, quien: 'tecnico', items: [['REP-DSENSE-BAT', 1, null]] }),

  // — Sin reparación (2): presupuesto rechazado y equipo irreparable —
  R('r10', 'sj', 'xsx', 'No da imagen. El cliente cuenta que se le cayó líquido encima.', { serie: '0730149114012', acc: 'Control y cable HDMI', dias: 58, prom: 7, ruta: ['En diagnóstico', 'Presupuesto enviado'], fin: 'sin_reparacion', entrega: 12, mo: 8, items: [] }),
  R('r11', 'jc', 'nswo', 'Pantalla con una línea vertical y táctil que no responde.', { serie: 'XTW10003320951', acc: 'Dock', dias: 33, prom: 6, ruta: ['En diagnóstico', 'Presupuesto enviado'], fin: 'sin_reparacion', entrega: 10, mo: 6, items: [] }),

  // — Anuladas (3) —
  R('r12', 'sj', 'ps3', 'No enciende, luz roja fija.', { serie: 'CECH-3001B-0912', acc: 'Cable de poder', dias: 47, prom: 7, ruta: ['En diagnóstico'], fin: 'anulada', motivo: 'El cliente pasó a buscar el equipo antes del diagnóstico y prefirió no repararlo.', items: [] }),
  R('r13', 'sj', 'x360', 'Luz roja en el anillo (falla general).', { serie: null, acc: 'Sin accesorios', dias: 29, prom: 5, ruta: [], fin: 'anulada', motivo: 'Cargada por error: el equipo ingresó en Mundo JC. Se dio de alta de nuevo allá.', items: [] }),
  R('r14', 'jc', 'ps4s', 'Se apaga solo a los pocos minutos.', { serie: 'CUH-2115B-7741002', acc: 'Cable de poder', dias: 21, prom: 5, ruta: ['En diagnóstico', 'Presupuesto enviado'], fin: 'anulada', motivo: 'Duplicada de otra orden del mismo equipo; se conserva la más antigua.', items: [] }),

  // — Listo para entregar (4): dos con retiro pendiente hace días —
  R('r15', 'jc', 'ps4p', 'No lee discos Blu-ray y hace ruido de rozamiento.', { serie: 'CUH-7215B-2209814', acc: 'Cable de poder', dias: 14, prom: 7, ruta: ['En diagnóstico', 'Presupuesto enviado', 'En reparación', 'Listo para entregar'], items: [['REP-PS4-LECTOR', 1, null]] }),
  R('r16', 'sj', 'xjoy', 'Drift en el analógico derecho.', { serie: null, acc: 'Control con pilas', dias: 9, prom: 3, ruta: ['En diagnóstico', 'En reparación', 'Listo para entregar'], items: [['REP-XBS-STICK', 1, null]] }),
  R('r17', 'sj', 'nswl', 'La ranura de cartuchos no reconoce los juegos.', { serie: 'XJW10061100482', acc: 'Funda y 1 cartucho', dias: 12, prom: 5, ruta: ['En diagnóstico', 'En reparación', 'Listo para entregar'], items: [['REP-NSW-SLOT', 1, null]] }),
  R('r18', 'sj', 'ds4', 'Botón L2 duro y carcasa rajada.', { serie: null, acc: 'Solo el joystick', dias: 8, prom: 3, ruta: ['En diagnóstico', 'En reparación', 'Listo para entregar'], items: [['REP-DS4-BOT', 1, null], ['REP-DS4-CARC', 1, null]] }),

  // — En reparación (4) —
  R('r19', 'sj', 'ps5s', 'Ruido fuerte del lector y reinicios al leer discos.', { serie: 'F0152B22100574', acc: 'Cable de poder y DualSense', dias: 10, prom: 8, ruta: ['En diagnóstico', 'Presupuesto enviado', 'En reparación'], items: [['REP-PS5-LECTOR', 1, null]] }),
  R('r20', 'sj', 'xbox', 'Ventilador ruidoso y sobrecalentamiento en juegos pesados.', { serie: '012233114506', acc: 'Fuente y control', dias: 7, prom: 6, ruta: ['En diagnóstico', 'En reparación'], items: [['REP-XBO-VENT', 1, null], ['HER-PASTA-TERM', 1, null]] }),
  R('r21', 'jc', 'procon', 'Gatillo ZR suelto y drift leve.', { serie: 'XKW10020917731', acc: 'Cable USB-C', dias: 6, prom: 5, ruta: ['En diagnóstico', 'En reparación'], items: [['REP-JOYCON-STICK', 1, null]] }),
  R('r22', 'sj', 'deck', 'El stick derecho se mueve solo y la pantalla parpadea.', { serie: 'SD-2410-00917', acc: 'Estuche rígido y cargador', dias: 11, prom: 10, mo: 40, ruta: ['En diagnóstico', 'Presupuesto enviado', 'En reparación'], items: [['libre', 'Módulo de stick (Steam Deck)', 1, 14]] }),

  // — Esperando repuesto (4). Las dos primeras están vencidas y usan repuestos que el catálogo tiene en 0 —
  R('r23', 'sj', 'ps3', 'La consola no enciende: la fuente interna está quemada.', { serie: 'CECH-4001C-7731', acc: 'Cable de poder', dias: 40, prom: 12, ruta: ['En diagnóstico', 'Presupuesto enviado', 'Esperando repuesto'], items: [['REP-PS3-FUENTE', 1, null]] }),
  R('r24', 'jc', 'wii', 'No lee discos: el lente láser está muerto.', { serie: 'LRV2132235', acc: 'Wiimote, nunchuk y sensor', dias: 32, prom: 14, ruta: ['En diagnóstico', 'Presupuesto enviado', 'Esperando repuesto'], items: [['REP-WII-LENTE', 1, null]] }),
  R('r25', 'sj', 'nswo', 'Se rompió la ranura de la tarjeta microSD y el slot de juego queda trabado.', { serie: 'XTW10040118820', acc: 'Funda', dias: 13, prom: 10, ruta: ['En diagnóstico', 'Presupuesto enviado', 'Esperando repuesto'], items: [['REP-NSW-SLOT', 1, null]] }),
  R('r26', 'sj', 'ps5d', 'Puerto HDMI dañado, sale imagen entrecortada.', { serie: 'F0142C31900761', acc: 'Cable HDMI 2.1', dias: 9, prom: 12, mo: 40, ruta: ['En diagnóstico', 'Presupuesto enviado', 'Esperando repuesto'], items: [['libre', 'Puerto HDMI PS5 (a pedido al proveedor)', 1, 12]] }),

  // — Presupuesto enviado (4) —
  R('r27', 'sj', 'xss', 'Falla de disco: da error 0x80070570 al iniciar.', { serie: '0912344112290', acc: 'Control y fuente', dias: 5, prom: 8, ruta: ['En diagnóstico', 'Presupuesto enviado'], mo: 26, items: [['libre', 'SSD NVMe 512 GB para Series S', 1, 52]] }),
  R('r28', 'jc', 'ps4s', 'Sobrecalentamiento, el ventilador no gira.', { serie: 'CUH-2216A-9902115', acc: 'Cable de poder', dias: 4, prom: 6, ruta: ['En diagnóstico', 'Presupuesto enviado'], items: [['REP-PS4-VENT', 1, null], ['HER-PASTA-TERM', 1, null]] }),
  R('r29', 'sj', 'a54', 'Pantalla estrellada y táctil fantasma.', { serie: 'R5CW31ABC12', acc: 'Funda', dias: 3, prom: 7, ruta: ['En diagnóstico', 'Presupuesto enviado'], mo: 18, items: [['libre', 'Módulo de pantalla Galaxy A54', 1, 62]] }),
  R('r30', 'sj', 'ip11', 'Batería al 68 % de salud y se apaga a 30 %.', { serie: 'F17XK02ABCDE', acc: 'Sin accesorios', dias: 3, prom: 5, ruta: ['En diagnóstico', 'Presupuesto enviado'], items: [['libre', 'Batería iPhone 11', 1, 18]] }),

  // — En diagnóstico (4); la última vencida —
  R('r31', 'sj', 'ps5', 'Se apaga solo y muestra el error CE-108255-1.', { serie: 'F0132B80100099', acc: 'Cable de poder', dias: 2, prom: 5, ruta: ['En diagnóstico'] }),
  R('r32', 'jc', 'gba', 'No enciende; el cliente sospecha el cable de carga.', { serie: null, acc: 'Cargador genérico', dias: 3, prom: 7, ruta: ['En diagnóstico'] }),
  R('r33', 'sj', 'vita', 'Táctil trasero muerto y botón PS que no responde.', { serie: 'PCH-2000-AB1234', acc: 'Memoria de 16 GB', dias: 4, prom: 6, ruta: ['En diagnóstico'], quien: 'tecnico' }),
  R('r34', 'sj', 'ps4f', 'Congela la imagen a los diez minutos y reinicia.', { serie: 'CUH-1115A-4410387', acc: 'Cable de poder y DualShock', dias: 25, prom: 10, ruta: ['En diagnóstico'] }),

  // — Recibido (5): recién ingresadas, una sin fecha prometida y una de mostrador sin ficha de cliente —
  R('r35', 'sj', 'nsw', 'Joy-Con derecho no se engancha al riel.', { serie: 'XAW10091200336', acc: 'Dock y Joy-Con', dias: 1, prom: 4, ruta: [] }),
  R('r36', 'sj', 'ps5', 'Lector no abre la bandeja.', { serie: 'F0172A00100771', acc: 'Cable de poder y DualSense', dias: 0, prom: null, ruta: [] }),
  R('r37', 'jc', 'ds4', 'No carga y la luz parpadea en naranja.', { serie: null, acc: 'Solo el joystick', dias: 1, prom: 3, ruta: [] }),
  R('r38', 'sj', 'x360', 'Anillo de luz roja y ruido de ventilador al máximo.', { serie: null, acc: 'Sin accesorios', dias: 0, prom: 6, ruta: [], cliente: 'cf' }),
  R('r39', 'jc', 'ps3ss', 'Pide actualizar el firmware y se cuelga en el logo.', { serie: 'CECH-4201C-0014', acc: 'Cable de poder', dias: 2, prom: 5, ruta: [] }),

  // — Re-ingreso por garantía (1): el mismo joystick de r02 vuelve con la falla otra vez —
  R('r40', 'sj', 'ds4', 'Re-ingreso por garantía de {r:r02}: vuelve a derivar el analógico izquierdo.', { serie: null, acc: 'Solo el joystick', dias: 6, prom: 3, ruta: ['Garantía en revisión'], mo: 0, items: [['REP-DS4-STICK', 1, null]], mismoCliente: 'r02' }),
]

// Quién retira el equipo al entregarlo (para `entregado_por`); a veces no es el titular.
export const RETIRA = ['El titular', 'El titular, con DNI', 'Un familiar autorizado', 'El titular', 'Su hermano, con la orden impresa', 'El titular']
