// Datos del módulo 07 · Tiendas online y consultas. Todo ficticio: nombres, teléfonos (prefijo 5555) y correos
// (dominio `.demo`) están inventados. Los textos van en castellano rioplatense y de videojuegos y repuestos.
// Dos tiendas que se vean distintas: San Javucho (violeta eléctrico, tipografía condensada, tienda completa) y
// Mundo JC (naranja cálido, tipografía redondeada, configurada a medias a propósito: caso borde de datos incompletos).

// Tipografías válidas hoy en guardar_tienda_identidad: system-ui, Barlow, Barlow Condensed, Playfair Display, Lato, Sora, Instrument Sans.
export const TIENDAS = {
  sanjavucho: {
    dominio: 'demo-sanjavucho',
    identidad: { primario: '#5B21B6', oscuro: '#3B0F7A', acento: '#22D3EE', fondo: '#F5F3FF', titulos: 'Barlow Condensed', texto: 'Barlow' },
    contenido: {
      titulo: 'Todo para tu consola, en un solo lugar',
      subtitulo: 'Joysticks, repuestos originales, cables y herramientas para service. Enviamos a todo el país.',
      texto_boton: 'Ver el catálogo completo',
      boton_destino: 'catalogo',
      bienvenida: 'Envíos a todo el país en 24/48 hs · Compras por mayor con precios especiales',
      pie: 'San Javucho · Av. Corrientes 4521, CABA. Service técnico de PlayStation, Nintendo y Xbox con garantía escrita.',
      aviso_ficha: 'Los precios de los repuestos pueden variar según la cotización del dólar. Consultanos antes de comprar por mayor.',
      texto_boton_contacto: 'Consultar por WhatsApp',
    },
    envios: [
      { nombre: 'Retiro por el local (Av. Corrientes)', tipo: 'retiro_local', guia: false, costo: 0, inicial: 'sin_armar', orden: 1 },
      { nombre: 'Moto a CABA y GBA', tipo: 'moto', guia: false, costo: 4500, inicial: 'sin_armar', orden: 2 },
      { nombre: 'Correo a domicilio', tipo: 'correo', guia: true, costo: null, inicial: 'sin_armar', orden: 3 },
      { nombre: 'Expreso al interior', tipo: 'expreso', guia: true, costo: 9800, inicial: 'armando', orden: 4 },
    ],
    // Categorías que esta tienda no muestra (se oculta el árbol completo) y productos puntuales ocultos o destacados.
    categoriasOcultas: ['Belleza', 'Novedades en USD'],
    productosOcultos: ['CON-PS3-SLIM', 'OUT-PS4-FAT', 'HER-MALLA-DES', 'REP-WII-LENTE'],
    destacados: ['CON-PS5-LEC', 'JOY-DSENSE-BL', 'ALM-SSD-1TB-PS5', 'REP-PS5-LECTOR', 'CON-NSW-OLED', 'JOY-DS4-NG', 'HER-KIT-24', 'AUD-HEADSET-BT'],
    correoAvisos: 'consultas@sanjavucho.demo',
  },
  mundojc: {
    dominio: 'demo-mundojc',
    identidad: { primario: '#C2410C', oscuro: '#7C2D12', acento: '#FACC15', fondo: '#FFFBEB', titulos: 'Sora', texto: 'Lato' },
    // A medias: sin subtítulo, sin pie, sin aviso en la ficha ni texto del botón de contacto. La tienda lo tolera (vacío oculta).
    contenido: {
      titulo: 'Mundo JC · Consolas, accesorios y más',
      subtitulo: '',
      texto_boton: 'Ver productos',
      boton_destino: 'catalogo',
      bienvenida: 'Retiro en Córdoba o envío a todo el país',
      pie: '',
      aviso_ficha: '',
      texto_boton_contacto: '',
    },
    envios: [
      { nombre: 'Retiro en el local (Obispo Trejo)', tipo: 'retiro_local', guia: false, costo: 0, inicial: 'sin_armar', orden: 1 },
      { nombre: 'Envío a terminal de ómnibus', tipo: 'terminal', guia: true, costo: 6200, inicial: 'sin_armar', orden: 2 },
      { nombre: 'Correo a domicilio', tipo: 'correo', guia: true, costo: null, inicial: 'sin_armar', orden: 3 },
    ],
    categoriasOcultas: ['Herramientas', 'Repuestos videojuegos', 'Outlet'],
    productosOcultos: ['CON-WII-REAC', 'CEL-POPSOCKET', 'JOY-DS4-GEN'],
    destacados: ['CON-PS5-DIG', 'CON-XBS-S', 'CON-NSW-LITE', 'JOY-DSENSE-NG', 'BEL-PLANCHA', 'CEL-POWER-10K'],
    correoAvisos: null, // sin correo propio: los avisos caen en el correo de contacto de la empresa
  },
}

// Estados de la lista configurable. `activo: false` queda como estado desactivado (se ve en Configuración).
export const ESTADOS_CONSULTA = [
  { nombre: 'Nueva', activo: true },
  { nombre: 'En curso', activo: true },
  { nombre: 'Resuelta', activo: true },
  { nombre: 'Descartada', activo: true },
  { nombre: 'Derivada a service técnico', activo: false },
]

// Consultas que entran por el camino público REAL (formulario y botón de WhatsApp de la tienda). Son pocas a propósito:
// la RPC limita a 5 envíos por hora por visitante y empresa y fija created_at = now(). El resto de la bandeja (~35
// consultas repartidas en 60 días, con estados, responsables, notas y avisos) lo inserta sql/90-consultas.sql.
export const CONSULTAS_PUBLICAS = {
  sanjavucho: {
    formulario: [
      ['Paula Sandoval', '+54 9 11 5555-3107', 'Quiero saber si la consola PS4 reacondicionada trae garantía escrita y qué cubre.'],
      ['Joaquín Medina', 'joaquin.medina@mail.demo', '¿Hacen retiro por el local los sábados? ¿Hasta qué hora?'],
      ['Karina Domínguez', '+54 9 11 5555-3108', 'Se me mojó un Joy-Con. ¿Lo pueden revisar? ¿Hay que dejarlo para presupuesto?'],
    ],
    whatsapp: ['REP-PS5-LECTOR'],
  },
  mundojc: {
    formulario: [
      ['Mariana Ruiz', '+54 351 555-4406', '¿Aceptan tarjeta en el local? ¿Y se puede retirar el pedido en el día?'],
      ['Tomás Allende', 'tomas.allende@mail.demo', 'Necesito una funda de silicona y vidrio templado para Switch OLED. ¿Los tienen? ¿Envían a Carlos Paz?'],
      ['Sabrina Luna', 'sabrina.luna@mail.demo', '¿Tienen stock del Nintendo Switch Lite en color turquesa?'],
    ],
    whatsapp: ['CON-NSW-LITE'],
  },
}

// Toques en «Consultar por WhatsApp» que van por la RPC pública (sin límite propio); el volumen lo carga el paso SQL.
export const INTERES_PUBLICO = {
  sanjavucho: ['CON-PS5-LEC', 'JOY-DSENSE-BL'],
  mundojc: ['CON-PS5-DIG', 'CON-XBS-S'],
}
