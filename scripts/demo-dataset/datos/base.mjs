import { cuitValido } from '../lib/cuit.mjs'
// Organización demo basada en el cliente real (sanjavucho.com.ar y mundojc.com.ar). Todo lo demás es ficticio.
// DEMO_ORGANIZACION y DEMO_SUFIJO permiten tener organizaciones demo paralelas (p. ej. para desarrollar un módulo
// sin pisar la principal): el sufijo se agrega a los correos de los usuarios, que son únicos en toda la instancia.
export const ORGANIZACION = process.env.DEMO_ORGANIZACION || 'San Javucho y Mundo JC (demo)'
export const PASSWORD = 'Demo-Msf-2026!'

export const EMPRESAS = [
  { clave: 'sanjavucho', nombre: 'San Javucho', razon_social: 'San Javucho S.R.L.', cuit: cuitValido('30', 71234567), whatsapp: '+54 9 11 5555-0101', correo: 'ventas@sanjavucho.demo', instagram: '@sanjavucho.demo', direccion: 'Av. Corrientes 4521, CABA', horarios: 'Lun a Vie 10 a 18 hs · Sáb 10 a 14 hs' },
  { clave: 'mundojc', nombre: 'Mundo JC', razon_social: 'Mundo JC S.A.', cuit: cuitValido('30', 70987654), whatsapp: '+54 9 351 555-0202', correo: 'ventas@mundojc.demo', instagram: '@mundojc.demo', direccion: 'Obispo Trejo 745, Córdoba', horarios: 'Lun a Vie 9 a 17 hs' },
]

// Un usuario por rol; `empresas` indica en cuáles trabaja. Administrador y técnico son roles de organización: no se asignan por empresa.
export const USUARIOS = [
  { clave: 'admin', rol: 'administrador', nombre: 'Administración General', persona: ['Valeria', 'Quiroga'], empresas: [] },
  { clave: 'operador', rol: 'operador', nombre: 'Operador de Ventas', persona: ['Matías', 'Herrera'], empresas: ['sanjavucho', 'mundojc'] },
  { clave: 'mostrador', rol: 'mostrador', nombre: 'Mostrador San Javucho', persona: ['Lucía', 'Benítez'], empresas: ['sanjavucho'] },
  { clave: 'deposito', rol: 'deposito', nombre: 'Depósito Central', persona: ['Ramiro', 'Acosta'], empresas: ['sanjavucho', 'mundojc'] },
  { clave: 'administracion', rol: 'administracion', nombre: 'Cobranzas', persona: ['Carolina', 'Ferrari'], empresas: ['sanjavucho', 'mundojc'] },
  { clave: 'tecnico', rol: 'tecnico', nombre: 'Servicio Técnico', persona: ['Joaquín', 'Medina'], empresas: [] },
  { clave: 'consulta', rol: 'consulta', nombre: 'Solo Consulta', persona: ['Sofía', 'Navarro'], empresas: ['sanjavucho', 'mundojc'] },
]
export const correoDe = (clave) => `${clave}${process.env.DEMO_SUFIJO ?? ''}@demo.msf.test`
