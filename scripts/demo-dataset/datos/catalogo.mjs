import { cuitValido } from '../lib/cuit.mjs'

// Proveedores ficticios (nombres inventados; CUIT con dígito verificador válido).
export const PROVEEDORES = [
  { clave: 'norte', razon_social: 'Distribuidora Gamer Norte S.R.L.', cuit: cuitValido('30', 68120045), contacto: 'Martín Ledesma', correo: 'pedidos@gamernorte.demo', telefono: '+54 11 4555-1200', direccion: 'Av. Warnes 1180, CABA', empresas: ['sanjavucho', 'mundojc'] },
  { clave: 'nippon', razon_social: 'Importadora Nippon Games S.A.', cuit: cuitValido('30', 70451122), contacto: 'Sofía Takahashi', correo: 'ventas@nipponyames.demo', telefono: '+54 11 4777-3300', direccion: 'Bartolomé Mitre 2650, CABA', empresas: ['sanjavucho', 'mundojc'] },
  { clave: 'parts', razon_social: 'TecnoParts Argentina S.R.L.', cuit: cuitValido('30', 71330987), contacto: 'Gustavo Ferreyra', correo: 'repuestos@tecnoparts.demo', telefono: '+54 11 4300-8800', direccion: 'Lavalle 1520, CABA', empresas: ['sanjavucho'] },
  { clave: 'plata', razon_social: 'Accesorios del Plata S.A.', cuit: cuitValido('30', 69874510), contacto: 'Carolina Benítez', correo: 'comercial@accplata.demo', telefono: '+54 341 555-4100', direccion: 'Córdoba 1890, Rosario', empresas: ['sanjavucho', 'mundojc'] },
  { clave: 'herr', razon_social: 'Herramientas Electrónicas del Sur', cuit: cuitValido('30', 67553201), contacto: 'Raúl Domínguez', correo: 'info@herrsur.demo', telefono: '+54 11 4612-7000', direccion: 'Perú 840, CABA', empresas: ['sanjavucho'] },
  { clave: 'cel', razon_social: 'Mayorista Celulares Once S.R.L.', cuit: cuitValido('30', 71009876), contacto: 'Diego Aranda', correo: 'ventas@celularesonce.demo', telefono: '+54 11 4953-2100', direccion: 'Pasteur 420, CABA', empresas: ['sanjavucho', 'mundojc'] },
  { clave: 'beauty', razon_social: 'Beauty Import S.R.L.', cuit: cuitValido('30', 70228843), contacto: 'Lucía Montenegro', correo: 'pedidos@beautyimport.demo', telefono: '+54 351 555-7788', direccion: 'Av. Colón 1020, Córdoba', empresas: ['mundojc'] },
  { clave: 'asia', razon_social: 'Asia Direct Trading Ltd. (importación directa)', cuit: cuitValido('30', 71455560), contacto: 'Equipo de compras', correo: 'compras@asiadirect.demo', telefono: '+54 11 5263-9900', direccion: 'Puerto Madero, CABA', empresas: ['sanjavucho', 'mundojc'] },
]

// Árbol de categorías (las raíces salen de los menús de sanjavucho.com.ar / mundojc.com.ar).
// `empresas`: en cuáles se vende. `iva`: alícuota de la categoría. `escalas`: descuentos x5/x10/x50 sobre la lista.
export const CATEGORIAS = [
  { nombre: 'Consolas de juegos', empresas: ['sanjavucho', 'mundojc'], iva: '21 %', escalas: null, hijas: ['PlayStation', 'Nintendo', 'Xbox', 'Retro y portátiles'] },
  { nombre: 'Accesorios videojuegos', empresas: ['sanjavucho', 'mundojc'], iva: '21 %', escalas: [0.95, 0.91, 0.86], hijas: ['Joysticks', 'Cables y fuentes', 'Almacenamiento', 'Fundas y protección', 'Auriculares y audio'] },
  { nombre: 'Repuestos videojuegos', empresas: ['sanjavucho'], iva: '21 %', escalas: [0.94, 0.89, 0.83], hijas: ['Repuestos PlayStation', 'Repuestos Nintendo', 'Repuestos Xbox'] },
  { nombre: 'Herramientas', empresas: ['sanjavucho'], iva: '21 %', escalas: [0.95, 0.9, 0.85], hijas: ['Soldadura y electrónica', 'Destornilladores y apertura', 'Limpieza'] },
  { nombre: 'Accesorios celulares', empresas: ['sanjavucho', 'mundojc'], iva: '21 %', escalas: [0.93, 0.88, 0.8], hijas: ['Protección', 'Carga y energía', 'Audio'] },
  { nombre: 'Belleza', empresas: ['mundojc'], iva: '21 %', escalas: [0.95, 0.9, 0.84], hijas: ['Cuidado del cabello', 'Cuidado personal'] },
  { nombre: 'Outlet', empresas: ['sanjavucho', 'mundojc'], iva: '10,5 %', escalas: null, hijas: [] },
  { nombre: 'Novedades en USD', empresas: ['sanjavucho', 'mundojc'], iva: '21 %', escalas: null, hijas: [] },
]

// [sku, nombre, descripcion, compatible_con, lista USD, costo USD, categoría, proveedor, extras]
// extras: { ped: 'a_pedido'|'stock_entrante', soloSj, soloMjc }
const P = (sku, nombre, descripcion, compat, lista, costo, categoria, prov, extras = {}) => ({ sku, nombre, descripcion, compat, lista, costo, categoria, prov, ...extras })

export const PRODUCTOS = [
  // — Consolas —
  P('CON-PS5-DIG', 'PlayStation 5 Slim Digital 1TB', 'Consola PS5 Slim sin lectora, 1 DualSense incluido.', ['PS5'], 470, 415, 'PlayStation', 'norte'),
  P('CON-PS5-LEC', 'PlayStation 5 Slim con lectora 1TB', 'Consola PS5 Slim con lectora de discos, 1 DualSense incluido.', ['PS5'], 540, 478, 'PlayStation', 'norte'),
  P('CON-PS5-PRO', 'PlayStation 5 Pro 2TB', 'Consola PS5 Pro, ingreso a pedido.', ['PS5'], 780, 700, 'PlayStation', 'norte', { ped: 'a_pedido' }),
  P('CON-PS4-SLIM', 'PlayStation 4 Slim 1TB reacondicionada', 'Revisada en nuestro taller, 3 meses de garantía.', ['PS4'], 235, 190, 'PlayStation', 'nippon'),
  P('CON-PS3-SLIM', 'PlayStation 3 Slim 500GB retro', 'Consola retro con joystick y cables.', ['PS3'], 115, 85, 'PlayStation', 'nippon'),
  P('CON-NSW-OLED', 'Nintendo Switch OLED', 'Pantalla OLED 7", base y 2 Joy-Con.', ['Switch'], 345, 298, 'Nintendo', 'norte'),
  P('CON-NSW-LITE', 'Nintendo Switch Lite', 'Consola portátil, varios colores.', ['Switch'], 210, 178, 'Nintendo', 'norte'),
  P('CON-WII-REAC', 'Nintendo Wii reacondicionada con 2 joysticks', 'Incluye Wii Remote Plus y Nunchuk.', ['Wii'], 98, 70, 'Nintendo', 'nippon'),
  P('CON-XBS-S', 'Xbox Series S 512GB', 'Consola digital, 1 joystick inalámbrico.', ['Xbox Series'], 295, 252, 'Xbox', 'norte'),
  P('CON-XBS-X', 'Xbox Series X 1TB', 'Consola 4K con lectora.', ['Xbox Series'], 520, 462, 'Xbox', 'norte', { ped: 'stock_entrante' }),
  P('CON-GBA-SP', 'Game Boy Advance SP reacondicionada', 'Con pantalla retroiluminada y cargador.', ['GBA'], 88, 60, 'Retro y portátiles', 'nippon'),
  P('CON-RETRO-R36', 'Consola retro portátil R36S 64GB', 'Más de 10.000 juegos clásicos precargados.', ['Retro'], 52, 33, 'Retro y portátiles', 'asia'),
  P('CON-RETRO-RGB', 'Consola retro RGB30 pantalla 4"', 'Pantalla IPS cuadrada, 64GB.', ['Retro'], 74, 51, 'Retro y portátiles', 'asia'),
  // — Joysticks —
  P('JOY-DSENSE-BL', 'Joystick DualSense PS5 blanco', 'Original Sony, háptico y gatillos adaptativos.', ['PS5'], 70, 53, 'Joysticks', 'norte'),
  P('JOY-DSENSE-NG', 'Joystick DualSense PS5 negro', 'Original Sony.', ['PS5'], 72, 54, 'Joysticks', 'norte'),
  P('JOY-DS4-NG', 'Joystick DualShock 4 negro', 'Original, V2 con barra de luz.', ['PS4'], 39, 28, 'Joysticks', 'norte'),
  P('JOY-DS4-ROJO', 'Joystick DualShock 4 rojo', 'Original, V2 con barra de luz.', ['PS4'], 39, 28, 'Joysticks', 'norte'),
  P('JOY-DS4-GEN', 'Joystick PS4 genérico inalámbrico', 'Compatible PS4/PC, varios colores.', ['PS4', 'PC'], 19, 11, 'Joysticks', 'asia'),
  P('JOY-JOYCON-NEON', 'Joy-Con par rojo/azul neón', 'Par original Nintendo.', ['Switch'], 74, 59, 'Joysticks', 'norte'),
  P('JOY-PROCON-NSW', 'Pro Controller Nintendo Switch', 'Original, con vibración HD.', ['Switch'], 63, 48, 'Joysticks', 'norte'),
  P('JOY-XBOX-BL', 'Joystick Xbox inalámbrico blanco', 'Original, Bluetooth, Xbox/PC.', ['Xbox Series', 'PC'], 56, 42, 'Joysticks', 'norte'),
  P('JOY-WII-NUN', 'Wii Remote Plus + Nunchuk', 'Compatible Wii/Wii U.', ['Wii'], 26, 16, 'Joysticks', 'nippon'),
  // — Cables y fuentes —
  P('CAB-HDMI21-2M', 'Cable HDMI 2.1 8K 2 metros', 'Compatible PS5 y Xbox Series.', ['PS5', 'Xbox Series'], 9, 5, 'Cables y fuentes', 'plata'),
  P('CAB-HDMI14-15', 'Cable HDMI 1.4 1,5 metros', 'Uso general.', ['PS4', 'Switch'], 4, 2, 'Cables y fuentes', 'plata'),
  P('CAB-PODER-220', 'Cable de poder 220V trébol 1,5 m', 'Para fuentes de consolas.', ['PS4', 'PS5', 'Xbox'], 3.5, 1.6, 'Cables y fuentes', 'plata'),
  P('CAB-FUENTE-PS4', 'Fuente de alimentación PS4 original', 'Reemplazo original.', ['PS4'], 23, 15, 'Cables y fuentes', 'parts'),
  P('CAB-USBC-3M', 'Cable USB-C trenzado de carga 3 m', 'Para joysticks PS5 / Switch.', ['PS5', 'Switch'], 6.5, 3, 'Cables y fuentes', 'plata'),
  P('CAB-BASE-DSENSE', 'Base de carga doble DualSense', 'Carga dos joysticks a la vez.', ['PS5'], 17, 10, 'Cables y fuentes', 'plata'),
  P('CAB-BASE-DS4', 'Cargador doble joystick PS4', 'Base con luces LED.', ['PS4'], 12, 7, 'Cables y fuentes', 'plata'),
  // — Almacenamiento —
  P('ALM-SD-128', 'Memoria microSD 128GB para Switch', 'Clase 10 U3.', ['Switch'], 18, 12, 'Almacenamiento', 'plata'),
  P('ALM-SD-256', 'Memoria microSD 256GB para Switch', 'Clase 10 U3.', ['Switch'], 31, 21, 'Almacenamiento', 'plata'),
  P('ALM-SSD-1TB-PS5', 'SSD M.2 NVMe 1TB con disipador para PS5', 'Lectura 7.000 MB/s.', ['PS5'], 98, 76, 'Almacenamiento', 'norte'),
  P('ALM-HDD-2TB-EXT', 'Disco externo 2TB USB 3.0', 'Para PS4/PS5 juegos de PS4.', ['PS4', 'PS5'], 70, 53, 'Almacenamiento', 'norte'),
  P('ALM-HDD-1TB-PS4', 'Disco rígido 1TB SATA 2,5" para PS4', 'Reemplazo de disco interno.', ['PS4'], 46, 33, 'Almacenamiento', 'parts'),
  // — Fundas y protección —
  P('FUN-NSW-SIL', 'Funda de silicona Switch', 'Varios colores.', ['Switch'], 9, 4.5, 'Fundas y protección', 'plata'),
  P('FUN-NSW-VID', 'Vidrio templado Switch / Switch OLED', 'Pack de 2 con kit de instalación.', ['Switch'], 5.5, 2.4, 'Fundas y protección', 'plata'),
  P('FUN-DSENSE-GRIP', 'Grips de silicona DualSense (par)', 'Antideslizante.', ['PS5'], 6.5, 3, 'Fundas y protección', 'plata'),
  P('FUN-NSW-ESTUCHE', 'Estuche de viaje Switch rígido', 'Con espacio para 8 juegos.', ['Switch'], 14, 8, 'Fundas y protección', 'plata'),
  P('FUN-PS5-FILTRO', 'Filtros antipolvo PS5 Slim (kit x2)', 'Mantienen limpio el ventilador.', ['PS5'], 11, 6, 'Fundas y protección', 'plata'),
  // — Auriculares —
  P('AUD-GAMER-71', 'Auricular gamer USB 7.1 con micrófono', 'PC / PS4 / PS5.', ['PC', 'PS4', 'PS5'], 29, 17, 'Auriculares y audio', 'asia'),
  P('AUD-GAMER-35', 'Auricular gamer jack 3,5 mm', 'Compatible joysticks y celulares.', ['PS4', 'Xbox', 'Switch'], 17, 9.5, 'Auriculares y audio', 'asia'),
  P('AUD-HEADSET-BT', 'Auricular inalámbrico para PS5 Pulse', 'Audio 3D, batería de 12 hs.', ['PS5'], 105, 82, 'Auriculares y audio', 'norte'),
  // — Repuestos PlayStation —
  P('REP-PS4-LECTOR', 'Lector óptico PS4 KEM-490 completo', 'Reemplazo para PS4 Slim/Fat.', ['PS4'], 25, 16, 'Repuestos PlayStation', 'parts'),
  P('REP-PS5-LECTOR', 'Lector de discos PS5 (módulo)', 'Compatible PS5 con lectora.', ['PS5'], 62, 46, 'Repuestos PlayStation', 'parts'),
  P('REP-PS4-VENT', 'Ventilador interno PS4 Slim', 'Reemplazo genérico.', ['PS4'], 14, 8, 'Repuestos PlayStation', 'parts'),
  P('REP-PS5-VENT', 'Ventilador interno PS5', 'Reemplazo genérico.', ['PS5'], 22, 14, 'Repuestos PlayStation', 'parts'),
  P('REP-PS4-HDMI', 'Puerto HDMI PS4 (repuesto)', 'Para reparación con soldadura.', ['PS4'], 7, 4, 'Repuestos PlayStation', 'parts'),
  P('REP-DS4-STICK', 'Palancas analógicas DualShock 4 (par)', 'Reemplazo para drift.', ['PS4'], 4.5, 2, 'Repuestos PlayStation', 'parts'),
  P('REP-DSENSE-STICK', 'Módulo analógico DualSense', 'Reemplazo para drift.', ['PS5'], 6.5, 3.4, 'Repuestos PlayStation', 'parts'),
  P('REP-DS4-CARC', 'Carcasa completa DualShock 4', 'Con botones, varios colores.', ['PS4'], 10, 5.8, 'Repuestos PlayStation', 'parts'),
  P('REP-DS4-BOT', 'Kit de botones DualShock 4', 'Gatillos, cruceta y accionadores.', ['PS4'], 5, 2.4, 'Repuestos PlayStation', 'parts'),
  P('REP-DS4-BAT', 'Batería DualShock 4 1000 mAh', 'Reemplazo.', ['PS4'], 9, 5.4, 'Repuestos PlayStation', 'parts'),
  P('REP-DSENSE-BAT', 'Batería DualSense 1560 mAh', 'Reemplazo.', ['PS5'], 12, 7, 'Repuestos PlayStation', 'parts'),
  P('REP-PS3-FUENTE', 'Fuente interna PS3 Slim', 'Reemplazo genérico.', ['PS3'], 28, 18, 'Repuestos PlayStation', 'parts'),
  // — Repuestos Nintendo —
  P('REP-JOYCON-STICK', 'Palanca analógica Joy-Con', 'Reemplazo para drift.', ['Switch'], 5, 2.3, 'Repuestos Nintendo', 'parts'),
  P('REP-NSW-LCD', 'Pantalla LCD Switch Lite', 'Con touch, reemplazo.', ['Switch'], 39, 27, 'Repuestos Nintendo', 'parts'),
  P('REP-NSW-SLOT', 'Ranura de cartuchos Switch', 'Lector de game card.', ['Switch'], 8, 4.4, 'Repuestos Nintendo', 'parts'),
  P('REP-WII-LENTE', 'Lente láser Wii', 'Reemplazo.', ['Wii'], 12, 7, 'Repuestos Nintendo', 'parts'),
  P('REP-JOYCON-BAT', 'Batería Joy-Con 525 mAh', 'Reemplazo.', ['Switch'], 8, 4.6, 'Repuestos Nintendo', 'parts'),
  // — Repuestos Xbox —
  P('REP-XBO-VENT', 'Ventilador Xbox One', 'Reemplazo.', ['Xbox One'], 16, 9, 'Repuestos Xbox', 'parts'),
  P('REP-XBO-FUENTE', 'Fuente Xbox One (ladrillo)', 'Reemplazo genérica.', ['Xbox One'], 34, 22, 'Repuestos Xbox', 'parts'),
  P('REP-XBS-STICK', 'Palanca analógica joystick Xbox', 'Reemplazo para drift.', ['Xbox Series'], 5, 2.4, 'Repuestos Xbox', 'parts'),
  // — Herramientas —
  P('HER-SOLD-60W', 'Soldador digital 60W regulable', 'Temperatura ajustable 200–450 °C.', [], 24, 15, 'Soldadura y electrónica', 'herr'),
  P('HER-ESTA-858D', 'Estación de aire caliente 858D', 'Para soldadura SMD.', [], 68, 49, 'Soldadura y electrónica', 'herr'),
  P('HER-ESTANO-100', 'Estaño 60/40 rollo 100 g', '0,8 mm con flux.', [], 6.5, 3.6, 'Soldadura y electrónica', 'herr'),
  P('HER-FLUX-PASTA', 'Flux en pasta jeringa 10 cc', 'Para soldadura.', [], 4.5, 2.1, 'Soldadura y electrónica', 'herr'),
  P('HER-MULTI-DIG', 'Multímetro digital', 'Con puntas y estuche.', [], 17, 10, 'Soldadura y electrónica', 'herr'),
  P('HER-MALLA-DES', 'Malla desoldadora 2 mm', 'Rollo de 1,5 m.', [], 2.5, 1.1, 'Soldadura y electrónica', 'herr'),
  P('HER-KIT-24', 'Kit destornilladores de precisión 24 en 1', 'Incluye bits Y, tri-wing y pentalobe.', [], 13, 6.5, 'Destornilladores y apertura', 'herr'),
  P('HER-APERT-KIT', 'Kit de apertura con púas y ventosa', 'Para consolas y celulares.', [], 7, 3.4, 'Destornilladores y apertura', 'herr'),
  P('HER-PINZA-FINA', 'Pinza punta fina antiestática', 'Acero inoxidable.', [], 7.5, 4, 'Destornilladores y apertura', 'herr'),
  P('HER-MAT-ESD', 'Mat antiestático de trabajo', '40 x 60 cm con pulsera.', [], 15, 8.5, 'Limpieza', 'herr'),
  P('HER-LUPA-LED', 'Lupa de mesa con luz LED', 'Aumento 5x.', [], 19, 11, 'Limpieza', 'herr'),
  P('HER-ISOP-250', 'Alcohol isopropílico 250 ml', 'Limpieza de placas.', [], 5.5, 2.9, 'Limpieza', 'herr'),
  P('HER-PASTA-TERM', 'Pasta térmica 4 g', 'Alta conductividad.', [], 6.5, 3.2, 'Limpieza', 'herr'),
  // — Accesorios celulares —
  P('CEL-VIDRIO-9H', 'Vidrio templado 9H (varios modelos)', 'Consultar modelo disponible.', [], 2.2, 0.8, 'Protección', 'cel'),
  P('CEL-FUNDA-SIL', 'Funda de silicona para celular', 'Varios modelos y colores.', [], 4.5, 1.9, 'Protección', 'cel'),
  P('CEL-CARG-20W', 'Cargador USB-C 20W con cable', 'Carga rápida.', [], 9.5, 5.2, 'Carga y energía', 'cel'),
  P('CEL-CABLE-LIGHT', 'Cable USB-C a Lightning 1 m', 'Certificación MFi.', [], 6.5, 3.1, 'Carga y energía', 'cel'),
  P('CEL-POWER-10K', 'Power bank 10.000 mAh', 'Doble USB + USB-C.', [], 19, 11.5, 'Carga y energía', 'cel'),
  P('CEL-TWS-BT', 'Auriculares inalámbricos TWS', 'Bluetooth 5.3 con estuche de carga.', [], 17, 9.4, 'Audio', 'cel'),
  P('CEL-SOPORTE-AUTO', 'Soporte de celular para auto', 'Ventosa con brazo flexible.', [], 7.5, 3.6, 'Protección', 'cel'),
  P('CEL-POPSOCKET', 'Agarre plegable para celular', 'Varios diseños.', [], 2.8, 1, 'Protección', 'cel'),
  // — Belleza (solo Mundo JC) —
  P('BEL-PLANCHA', 'Plancha de pelo cerámica 230 °C', 'Placas flotantes.', [], 29, 18.5, 'Cuidado del cabello', 'beauty'),
  P('BEL-SECADOR', 'Secador de pelo 2200 W', 'Con difusor y concentrador.', [], 26, 16, 'Cuidado del cabello', 'beauty'),
  P('BEL-RIZADOR', 'Rizador automático', 'Cerámico, apagado automático.', [], 24, 15, 'Cuidado del cabello', 'beauty'),
  P('BEL-CORTADORA', 'Cortadora de barba recargable', 'Con 4 peines.', [], 23, 14, 'Cuidado personal', 'beauty'),
  P('BEL-ESPEJO-LED', 'Espejo de maquillaje con luz LED', 'Táctil, con aumento.', [], 15, 9, 'Cuidado personal', 'beauty'),
  P('BEL-KIT-MANI', 'Kit de manicuría 12 piezas', 'Estuche de viaje.', [], 12, 7, 'Cuidado personal', 'beauty'),
  P('BEL-MASAJ-FAC', 'Masajeador facial eléctrico', 'Vibración y calor.', [], 21, 12.5, 'Cuidado personal', 'beauty'),
  // — Outlet —
  P('OUT-DS4-ABIERTO', 'Joystick DualShock 4 caja abierta', 'Original, probado, sin uso.', ['PS4'], 29, 22, 'Outlet', 'norte'),
  P('OUT-NSW-LITE-REAC', 'Switch Lite reacondicionada', 'Con 6 meses de garantía.', ['Switch'], 165, 130, 'Outlet', 'nippon'),
  P('OUT-PS4-FAT', 'PlayStation 4 Fat 500GB usada', 'Funciona perfecto, sin joystick.', ['PS4'], 110, 80, 'Outlet', 'nippon'),
  P('OUT-AUR-GAMER', 'Auricular gamer (liquidación)', 'Últimas unidades, caja dañada.', ['PC', 'PS4'], 14, 8, 'Outlet', 'asia'),
  P('OUT-CABLE-HDMI', 'Cable HDMI 2 m (liquidación)', 'Sin caja.', [], 2.5, 1.3, 'Outlet', 'plata'),
  // — Novedades en USD —
  P('NOV-PS5-PORTAL', 'PlayStation Portal Remote Player', 'Streaming de PS5 en pantalla de 8".', ['PS5'], 245, 208, 'Novedades en USD', 'norte', { ped: 'stock_entrante' }),
  P('NOV-NSW-DOCK', 'Dock portátil para Switch', 'Salida HDMI y carga USB-C.', ['Switch'], 34, 21, 'Novedades en USD', 'asia'),
  P('NOV-JOY-HALL', 'Joystick efecto Hall anti-drift universal', 'PC / Switch / Android.', ['PC', 'Switch'], 32, 19, 'Novedades en USD', 'asia'),
  P('NOV-SSD-2TB-PS5', 'SSD M.2 NVMe 2TB para PS5', 'Lectura 7.300 MB/s con disipador.', ['PS5'], 175, 140, 'Novedades en USD', 'norte'),
]
