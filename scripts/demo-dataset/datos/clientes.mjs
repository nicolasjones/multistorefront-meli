import { cuitValido } from '../lib/cuit.mjs'
import { crearAzar } from '../lib/azar.mjs'

// Datos del módulo 04. TODO es ficticio: nombres y apellidos comunes pero inventados, DNI/CUIT con dígito
// verificador válido sobre números al azar, teléfonos con el bloque «555», correos en dominios `.demo`.
//
// Importante: el listado de clientes se genera con un PRNG propio (semilla fija) y no con `ctx.azar`, porque
// `lib/contexto.mjs` necesita reconstruir exactamente los mismos nombres al correr `--solo=NN` sobre una organización
// ya sembrada, y el estado de `ctx.azar` depende de cuántos módulos corrieron antes.

// ───────────────────────── Formas de pago ─────────────────────────
// `empresas`: en cuáles existe. `estado_inicial` es el estado con el que nace el cobro; `genera_deuda` marca
// los medios que dejan saldo a cobrar; `exige_cuenta` obliga a elegir una cuenta de cobro al registrar el pago.
export const FORMAS_PAGO = [
  { clave: 'efectivo', nombre: 'Efectivo', tipo: 'efectivo', exige_cuenta: false, deuda: false, estado: 'cobrado', empresas: ['sanjavucho', 'mundojc'] },
  { clave: 'efectivo_usd', nombre: 'Efectivo en dólares', tipo: 'efectivo', exige_cuenta: false, deuda: false, estado: 'cobrado', empresas: ['sanjavucho'] },
  { clave: 'transferencia', nombre: 'Transferencia bancaria', tipo: 'transferencia', exige_cuenta: true, deuda: false, estado: 'pendiente', empresas: ['sanjavucho', 'mundojc'] },
  { clave: 'billetera', nombre: 'Billetera virtual (QR)', tipo: 'transferencia', exige_cuenta: true, deuda: false, estado: 'pendiente', empresas: ['sanjavucho', 'mundojc'] },
  { clave: 'debito', nombre: 'Tarjeta de débito', tipo: 'tarjeta', exige_cuenta: false, deuda: false, estado: 'aceptado', empresas: ['sanjavucho', 'mundojc'] },
  { clave: 'credito', nombre: 'Tarjeta de crédito (un pago)', tipo: 'tarjeta', exige_cuenta: false, deuda: false, estado: 'aceptado', empresas: ['sanjavucho', 'mundojc'] },
  // Cuotas: la acreditación llega a los 30 días, así que hasta entonces queda como deuda a cobrar.
  { clave: 'cuotas', nombre: 'Tarjeta en cuotas (a acreditar)', tipo: 'tarjeta', exige_cuenta: false, deuda: true, estado: 'deuda', empresas: ['sanjavucho', 'mundojc'] },
  { clave: 'contrarreembolso', nombre: 'Contrarreembolso', tipo: 'contrarreembolso', exige_cuenta: false, deuda: true, estado: 'deuda', empresas: ['sanjavucho', 'mundojc'] },
  { clave: 'cuenta_corriente', nombre: 'Cuenta corriente (a cobrar)', tipo: 'otro', exige_cuenta: false, deuda: true, estado: 'deuda', empresas: ['sanjavucho', 'mundojc'] },
  { clave: 'cheque', nombre: 'Cheque a 30 días', tipo: 'otro', exige_cuenta: false, deuda: true, estado: 'deuda', empresas: ['mundojc'] },
]

// ───────────────────────── Formas de envío ─────────────────────────
// Costos por defecto en ARS. Solo correo y expreso exigen transporte y guía; el retiro no tiene costo.
export const FORMAS_ENVIO = [
  { clave: 'retiro', nombre: 'Retiro por el local', tipo: 'retiro_local', exige_transporte: false, costo: 0, despacho: 'sin_armar', empresas: ['sanjavucho', 'mundojc'] },
  { clave: 'correo', nombre: 'Correo a domicilio', tipo: 'correo', exige_transporte: true, costo: 6500, despacho: 'sin_armar', empresas: ['sanjavucho', 'mundojc'] },
  { clave: 'expreso', nombre: 'Expreso a todo el país', tipo: 'expreso', exige_transporte: true, costo: 9800, despacho: 'sin_armar', empresas: ['sanjavucho', 'mundojc'] },
  { clave: 'terminal', nombre: 'Envío a terminal de ómnibus', tipo: 'terminal', exige_transporte: true, costo: 4800, despacho: 'sin_armar', empresas: ['sanjavucho', 'mundojc'] },
  { clave: 'moto', nombre: 'Moto propia (CABA y GBA)', tipo: 'moto', exige_transporte: false, costo: 3500, despacho: 'sin_armar', empresas: ['sanjavucho'] },
  { clave: 'moto_cba', nombre: 'Moto propia (Gran Córdoba)', tipo: 'moto', exige_transporte: false, costo: 3000, despacho: 'sin_armar', empresas: ['mundojc'] },
  // Pedidos ya armados al cierre del día (ej. mayoristas que retiran): nacen listos para despachar.
  { clave: 'retiro_mayorista', nombre: 'Retiro mayorista (pedido armado)', tipo: 'retiro_local', exige_transporte: false, costo: 0, despacho: 'listo_para_despachar', empresas: ['mundojc'] },
]

// ───────────────────────── Transportes ─────────────────────────
// Empresas inventadas. `cr`: cobra contrarreembolso (comisión % sobre lo cobrado y días para rendirlo).
export const TRANSPORTES = [
  { clave: 'cuyano', nombre: 'Expreso Cuyano del Oeste S.R.L.', tipo: 'expreso', cuit: cuitValido('30', 64210877), terminal: 'Terminal de Ómnibus de Mendoza, módulo de encomiendas 14', localidad: 'Mendoza', telefono: '(261) 555-4410', correo: 'encomiendas@expresocuyano.demo', contacto: 'Hernán Videla', direccion: 'Acceso Este 2150, Guaymallén, Mendoza', cr: true, comision: 4.5, plazo: 7, empresas: ['sanjavucho', 'mundojc'] },
  { clave: 'patagonia', nombre: 'Transportes Patagonia Sur', tipo: 'expreso', cuit: cuitValido('30', 66540213), terminal: 'Terminal de Neuquén, local 7', localidad: 'Neuquén', telefono: '(299) 555-7120', correo: 'despacho@patagoniasur.demo', contacto: 'Silvana Aguirre', direccion: 'Ruta 22 km 1229, Neuquén', cr: true, comision: 5.5, plazo: 10, empresas: ['sanjavucho', 'mundojc'] },
  { clave: 'plata', nombre: 'Correo del Plata Express', tipo: 'correo', cuit: cuitValido('30', 70123456), terminal: null, localidad: 'Avellaneda', telefono: '(11) 555-3300', correo: 'empresas@correodelplata.demo', contacto: 'Mesa de empresas', direccion: 'Av. Mitre 1840, Avellaneda, Buenos Aires', cr: true, comision: 3, plazo: 15, empresas: ['sanjavucho', 'mundojc'] },
  { clave: 'litoral', nombre: 'Cargo Litoral Envíos S.A.', tipo: 'expreso', cuit: cuitValido('30', 68764120), terminal: 'Terminal de Rosario Mariano Moreno, andén de cargas', localidad: 'Rosario', telefono: '(341) 555-9087', correo: 'cargas@cargolitoral.demo', contacto: 'Ariel Cabrera', direccion: 'Av. Pellegrini 4120, Rosario, Santa Fe', cr: true, comision: 4, plazo: 5, empresas: ['sanjavucho'] },
  { clave: 'nortenio', nombre: 'Expreso Norteño del Valle', tipo: 'expreso', cuit: cuitValido('30', 65987031), terminal: 'Terminal de Tucumán, boxes 22 y 23', localidad: 'San Miguel de Tucumán', telefono: '(381) 555-2765', correo: 'info@expresonortenio.demo', contacto: 'Patricia Ledesma', direccion: 'Av. Gobernador del Campo 980, Tucumán', cr: false, comision: 0, plazo: 0, empresas: ['sanjavucho', 'mundojc'] },
  { clave: 'moto_jc', nombre: 'Moto Express JC', tipo: 'moto_propia', cuit: null, terminal: null, localidad: 'Córdoba', telefono: '(351) 555-0202', correo: 'motos@mundojc.demo', contacto: 'Base de motos', direccion: 'Obispo Trejo 745, Córdoba', cr: false, comision: 0, plazo: 0, empresas: ['mundojc'] },
  { clave: 'noreste', nombre: 'Transporte Unión del Noreste', tipo: 'expreso', cuit: cuitValido('30', 67330941), terminal: 'Terminal de Resistencia, dársena de encomiendas', localidad: 'Resistencia', telefono: '(362) 555-6631', correo: 'cargas@uniondelnoreste.demo', contacto: 'Walter Benítez', direccion: 'Av. Sarmiento 3300, Resistencia, Chaco', cr: true, comision: 6, plazo: 14, empresas: ['sanjavucho', 'mundojc'] },
]

// ───────────────────────── Cuentas de cobro ─────────────────────────
// CBU/CVU ficticios con los dos dígitos verificadores del BCRA (la base los valida).
const PESOS1 = [7, 1, 3, 9, 7, 1, 3]
const PESOS2 = [3, 9, 7, 1, 3, 9, 7, 1, 3, 9, 7, 1, 3]
const dv = (digitos, pesos) => String((10 - (digitos.split('').reduce((s, d, i) => s + Number(d) * pesos[i], 0) % 10)) % 10)
export function cbuFicticio(entidad7, cuenta13) {
  return `${entidad7}${dv(entidad7, PESOS1)}${cuenta13}${dv(cuenta13, PESOS2)}`
}

export const CUENTAS_COBRO = [
  { clave: 'banco_sj', nombre: 'Banco Río Alto · cuenta corriente SJ', titular: 'San Javucho S.R.L.', cuit: cuitValido('30', 71234567), banco: 'Banco Río Alto', alias: 'SANJAVUCHO.COBROS', cbu: cbuFicticio('0170099', '4000001234567'), tipo: 'cuenta_corriente', moneda: 'ARS', empresas: ['sanjavucho'], notas: 'Cuenta principal de cobranzas de San Javucho.' },
  { clave: 'banco_jc', nombre: 'Banco del Centro · caja de ahorro Mundo JC', titular: 'Mundo JC S.A.', cuit: cuitValido('30', 70987654), banco: 'Banco del Centro', alias: 'MUNDOJC.VENTAS', cbu: cbuFicticio('0140112', '6000007654321'), tipo: 'caja_ahorro', moneda: 'ARS', empresas: ['mundojc'], notas: null },
  { clave: 'billetera', nombre: 'Billetera Pago Fácil (CVU)', titular: 'San Javucho S.R.L.', cuit: cuitValido('30', 71234567), banco: 'Pago Fácil Fintech', alias: 'SANJAVUCHO.QR', cbu: cbuFicticio('0000076', '5000003344556'), tipo: 'billetera_virtual', moneda: 'ARS', empresas: ['sanjavucho', 'mundojc'], notas: 'Cobros por QR en mostrador y link de pago.' },
  { clave: 'usd', nombre: 'Banco Río Alto · caja de ahorro USD', titular: 'San Javucho S.R.L.', cuit: cuitValido('30', 71234567), banco: 'Banco Río Alto', alias: 'SANJAVUCHO.USD', cbu: cbuFicticio('0170099', '4000009988776'), tipo: 'caja_ahorro', moneda: 'USD', empresas: ['sanjavucho', 'mundojc'], notas: 'Para clientes mayoristas que pagan en dólares.' },
]

// ───────────────────────── Clientes ─────────────────────────
// [provincia, [[localidad, CP, característica telefónica], ...]]: las 24 jurisdicciones.
export const PROVINCIAS = [
  ['Ciudad Autónoma de Buenos Aires', [['CABA', 'C1414', '11'], ['CABA', 'C1425', '11']]],
  ['Buenos Aires', [['La Plata', 'B1900', '221'], ['Mar del Plata', 'B7600', '223'], ['Bahía Blanca', 'B8000', '291'], ['Lomas de Zamora', 'B1832', '11']]],
  ['Catamarca', [['San Fernando del Valle de Catamarca', 'K4700', '383']]],
  ['Chaco', [['Resistencia', 'H3500', '362']]],
  ['Chubut', [['Trelew', 'U9100', '280'], ['Comodoro Rivadavia', 'U9000', '297']]],
  ['Córdoba', [['Córdoba', 'X5000', '351'], ['Río Cuarto', 'X5800', '358'], ['Villa Carlos Paz', 'X5152', '3541']]],
  ['Corrientes', [['Corrientes', 'W3400', '379']]],
  ['Entre Ríos', [['Paraná', 'E3100', '343'], ['Concordia', 'E3200', '345']]],
  ['Formosa', [['Formosa', 'P3600', '370']]],
  ['Jujuy', [['San Salvador de Jujuy', 'Y4600', '388']]],
  ['La Pampa', [['Santa Rosa', 'L6300', '2954']]],
  ['La Rioja', [['La Rioja', 'F5300', '380']]],
  ['Mendoza', [['Mendoza', 'M5500', '261'], ['San Rafael', 'M5600', '260']]],
  ['Misiones', [['Posadas', 'N3300', '376'], ['Oberá', 'N3360', '3755']]],
  ['Neuquén', [['Neuquén', 'Q8300', '299']]],
  ['Río Negro', [['San Carlos de Bariloche', 'R8400', '294'], ['General Roca', 'R8332', '298']]],
  ['Salta', [['Salta', 'A4400', '387']]],
  ['San Juan', [['San Juan', 'J5400', '264']]],
  ['San Luis', [['San Luis', 'D5700', '266']]],
  ['Santa Cruz', [['Río Gallegos', 'Z9400', '2966']]],
  ['Santa Fe', [['Rosario', 'S2000', '341'], ['Santa Fe', 'S3000', '342'], ['Rafaela', 'S2300', '3492']]],
  ['Santiago del Estero', [['Santiago del Estero', 'G4200', '385']]],
  ['Tierra del Fuego', [['Ushuaia', 'V9410', '2901']]],
  ['Tucumán', [['San Miguel de Tucumán', 'T4000', '381']]],
]

const NOMBRES_F = ['María', 'Lucía', 'Camila', 'Valentina', 'Sofía', 'Agustina', 'Florencia', 'Julieta', 'Micaela', 'Rocío', 'Carolina', 'Natalia', 'Paula', 'Belén', 'Daniela']
const NOMBRES_M = ['Juan', 'Matías', 'Nicolás', 'Lucas', 'Santiago', 'Facundo', 'Joaquín', 'Franco', 'Emiliano', 'Tomás', 'Gonzalo', 'Ezequiel', 'Maximiliano', 'Ramiro', 'Bruno']
const APELLIDOS = ['Gómez', 'Rodríguez', 'Fernández', 'López', 'Martínez', 'Sosa', 'Álvarez', 'Romero', 'Torres', 'Ruiz', 'Acosta', 'Benítez', 'Medina', 'Herrera', 'Suárez', 'Aguirre', 'Peralta', 'Molina', 'Castro', 'Ortiz', 'Silva', 'Rojas', 'Ibáñez', 'Luna', 'Cabrera', 'Ríos', 'Figueroa', 'Muñoz', 'Giménez', 'Villalba', 'Quiroga', 'Maidana', 'Cardozo', 'Escobar', 'Paz']
const CALLES = ['San Martín', 'Belgrano', 'Mitre', 'Sarmiento', 'Rivadavia', '9 de Julio', 'Independencia', 'Alsina', 'Moreno', 'Lavalle', 'Av. Libertador', 'Pellegrini', 'Urquiza', 'Güemes', 'Italia']

// Mayoristas: revendedores, kioscos, casas de electrónica y services. [razón social, rubro, índice de provincia].
// Los índices cubren provincias distintas; las 3 restantes quedan para minoristas.
const MAYORISTAS = [
  ['Level Up Videojuegos S.R.L.', 'revendedor', 0],
  ['Retro Zone Games', 'revendedor', 1],
  ['Kiosco Gamer El Pibe', 'kiosco', 5],
  ['Electrónica Del Valle S.A.', 'electronica', 23],
  ['Servicio Técnico Consolas Norte', 'service', 16],
  ['Distribuidora Cuyo Gamer S.R.L.', 'revendedor', 12],
  ['Tecno Litoral Accesorios', 'electronica', 20],
  ['Patagonia Games Mayorista S.R.L.', 'revendedor', 14],
  ['Casa Ibáñez Electrónica', 'electronica', 2],
  ['Joystick Express Chaco', 'kiosco', 3],
  ['Gamer Planet Misiones S.R.L.', 'revendedor', 13],
  ['Service Master Entre Ríos', 'service', 7],
  ['Kiosco Central Formosa', 'kiosco', 8],
  ['Videojuegos del Sur S.A.', 'revendedor', 15],
  ['Nexus Tecnología San Juan', 'electronica', 17],
  ['Distribuidora Integral de Accesorios, Repuestos y Servicios Tecnológicos del Noroeste Argentino S.R.L.', 'revendedor', 9],
  ['Pampa Gamer Store', 'revendedor', 10],
  ['Reparaciones Fénix', 'service', 11],
  ['Mundo Consola Santiago', 'revendedor', 21],
  ['Punto Digital Chubut S.R.L.', 'electronica', 4],
  ['Fin del Mundo Games', 'revendedor', 22],
]

const sinAcentos = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '.').replace(/^\.+|\.+$/g, '').toLowerCase()

// `sufijo` (DEMO_SUFIJO) va en el dominio del correo: Auth exige correos únicos en toda la instancia y varias
// organizaciones demo conviven en la misma base.
export function generarClientes(sufijo = '') {
  const az = crearAzar(4040)
  const dominio = `mail${sufijo}.demo`
  const tel = (area) => `(${area}) 555-${String(az.entero(1000, 9999))}`
  const cel = (area) => `+54 9 ${area} 555-${String(az.entero(1000, 9999))}`
  const dnis = new Set()
  const dni = () => { let n; do { n = az.entero(18_000_000, 46_000_000) } while (dnis.has(n)); dnis.add(n); return n }
  const lugar = (iProv) => {
    const [provincia, locs] = PROVINCIAS[iProv]
    const [localidad, cp, area] = az.elegir(locs)
    return { provincia, localidad, codigo_postal: cp, area }
  }
  const clientes = []
  const usados = new Set()
  const agregar = (c) => {
    if (usados.has(c.nombre)) throw new Error(`Cliente duplicado en los datos: ${c.nombre}`)
    usados.add(c.nombre)
    clientes.push({ ...c, clave: `c${String(clientes.length + 1).padStart(2, '0')}` })
  }

  // — Mayoristas (21 ≈ 35 %) —
  let nCuit = 51_200_000
  MAYORISTAS.forEach(([nombre, rubro, iProv], i) => {
    const l = lugar(iProv)
    const cuit = cuitValido('30', (nCuit += az.entero(1000, 90000)))
    const condicion = i === 8 ? 'Monotributista' : i === 12 ? 'IVA exento' : 'Responsable inscripto'
    const doc = condicion === 'Monotributista' ? cuitValido('20', dni()) : cuit
    agregar({
      nombre, tipo: 'mayorista', rubro, condicion_iva: condicion, documento: doc,
      correo: i === 12 ? null : `compras.${sinAcentos(nombre).split('.').slice(0, 3).join('.')}@${dominio}`,
      telefono: tel(l.area), celular: i % 3 === 0 ? null : cel(l.area),
      direccion: `${az.elegir(CALLES)} ${az.entero(100, 4800)}`, localidad: l.localidad, provincia: l.provincia, codigo_postal: l.codigo_postal,
      expreso_preferido: [0, 3, 5, 7, 11, 14, 16, 19].includes(i) ? ['Expreso Cuyano del Oeste S.R.L.', 'Cargo Litoral Envíos S.A.', 'Transportes Patagonia Sur', 'Expreso Norteño del Valle', 'Transporte Unión del Noreste'][i % 5] : null,
      empresas: i % 5 === 4 ? ['sanjavucho', 'mundojc'] : i % 5 < 2 ? ['mundojc'] : ['sanjavucho', 'mundojc'],
      archivado: i === 13 || i === 17,
    })
  })

  // — Minoristas (39 ≈ 65 %): los primeros 24 cubren cada jurisdicción una vez; el resto se reparte hacia las grandes —
  const casos = {
    // Casos borde por posición.
    sinCorreo: [3, 17], sinTelefono: [5, 22], nombreLargo: 9, archivados: [14, 31],
  }
  for (let i = 0; i < 39; i++) {
    const iProv = i < 24 ? (i + 1) % 24 : az.ponderado([[0, 4], [1, 5], [5, 4], [20, 3], [12, 2], [23, 2], [16, 1]])
    const l = lugar(iProv)
    const mujer = az.probabilidad(0.45)
    const n1 = az.elegir(mujer ? NOMBRES_F : NOMBRES_M)
    const ap = az.elegir(APELLIDOS)
    let nombre = `${n1} ${ap}`
    if (i === casos.nombreLargo) nombre = 'María de los Ángeles Pereyra Villanueva de Echeverría'
    if (i === 1) nombre = "Nicolás D'Alessandro Peña"
    if (i === 6) nombre = 'Agustín Muñoz Ibáñez'
    if (usados.has(nombre)) nombre = `${n1} ${az.elegir(NOMBRES_M)} ${ap}`
    const monotributista = i % 2 === 1
    const d = dni()
    agregar({
      nombre, tipo: 'minorista', rubro: monotributista ? 'monotributista' : 'consumidor_final',
      condicion_iva: monotributista ? 'Monotributista' : 'Consumidor final',
      documento: monotributista ? cuitValido(mujer ? '27' : '20', d) : String(d),
      correo: casos.sinCorreo.includes(i) ? null : `${sinAcentos(nombre).split('.').slice(0, 2).join('.')}${az.entero(1, 99)}@${dominio}`,
      telefono: casos.sinTelefono.includes(i) ? null : (az.probabilidad(0.4) ? tel(l.area) : null),
      celular: casos.sinTelefono.includes(i) ? null : cel(l.area),
      direccion: `${az.elegir(CALLES)} ${az.entero(50, 3900)}${az.probabilidad(0.25) ? `, piso ${az.entero(1, 9)} dto. ${az.elegir(['A', 'B', 'C', 'D'])}` : ''}`,
      localidad: l.localidad, provincia: l.provincia, codigo_postal: l.codigo_postal,
      expreso_preferido: i % 13 === 7 ? 'Correo del Plata Express' : null,
      empresas: az.ponderado([[['sanjavucho'], 50], [['mundojc'], 25], [[ 'sanjavucho', 'mundojc'], 25]]),
      archivado: casos.archivados.includes(i),
    })
  }
  return clientes
}

// Migrados «del sistema anterior»: los primeros 10 que no estén archivados reciben un identificador externo.
export const SISTEMA_ANTERIOR = 'panel_actual'
export const CANTIDAD_MIGRADOS = 10
export const CANTIDAD_CUENTAS_WEB = 12
