// Módulo 01 · Organización, usuarios por rol y las dos empresas.
import { EMPRESAS, ORGANIZACION, PASSWORD, USUARIOS, correoDe } from '../datos/base.mjs'

export const nombre = 'Organización, usuarios y empresas'

export async function sembrar(ctx) {
  const { admin, log } = ctx
  const existentes = await admin.leer(`organizaciones?nombre=eq.${encodeURIComponent(ORGANIZACION)}&select=id`)
  if (existentes.length) throw new Error(`La organización demo ya existe (${existentes[0].id}). Corré con --reset para recrearla.`)
  const [org] = await admin.insertar('organizaciones', { nombre: ORGANIZACION })
  ctx.orgId = org.id
  log(`organización ${org.id}`)

  ctx.usuarios = {}
  for (const u of USUARIOS) {
    const correo = correoDe(u.clave)
    const previo = await admin.buscarUsuario(correo)
    if (previo) await admin.borrarUsuario(previo.id)
    const creado = await admin.crearUsuario(correo, PASSWORD, { nombre: u.nombre })
    await admin.insertar('usuarios_organizacion', [{ user_id: creado.id, organizacion_id: org.id, rol_id: u.rol }])
    ctx.usuarios[u.clave] = { id: creado.id, correo, rol: u.rol, nombre: u.nombre }
  }
  log(`${USUARIOS.length} usuarios (uno por rol), clave ${PASSWORD}`)

  // Nombre y apellido de cada persona (perfil propio, por RLS): sin esto las pantallas muestran «Usuario sin nombre»
  // como operador y el correo como autor en Actividad, porque el nombre se toma del perfil al momento de cada evento.
  for (const u of USUARIOS) {
    const ses = await ctx.sesion(u.clave)
    await ses.insertar('perfiles_usuario', { user_id: ctx.usuarios[u.clave].id, nombre: u.persona[0], apellido: u.persona[1] })
  }
  log('perfiles de usuario (nombre y apellido)')

  // Service técnico es una funcionalidad que se habilita por organización: sin esta fila la pantalla responde «No tenés
  // acceso a esta sección» incluso al Administrador. `features` es global y `organizaciones_features` es de `public`,
  // así que alcanza con la service-role (sin pasar por la RPC, que exige un superadmin de plataforma).
  const feature = 'service-tecnico'
  if (!(await admin.leer(`features?id=eq.${feature}&select=id`)).length) {
    await admin.insertar('features', { id: feature, nombre: 'Service técnico', descripcion: 'Reparaciones, ítems, modelos y estados de service', creado_por: ctx.usuarios.admin.id })
  }
  await admin.insertar('organizaciones_features', { feature_id: feature, organizacion_id: org.id, habilitado_por: ctx.usuarios.admin.id })
  log(`funcionalidad habilitada: ${feature}`)

  const adm = await ctx.sesion('admin')
  ctx.empresas = {}
  for (const e of EMPRESAS) {
    const fila = await adm.rpc('crear_empresa', { p_nombre: e.nombre })
    await adm.actualizar(`empresas?id=eq.${fila.id}`, {
      razon_social: e.razon_social, cuit: e.cuit, whatsapp: e.whatsapp, correo: e.correo,
      instagram: e.instagram, direccion: e.direccion, horarios: e.horarios,
    }, 'dominio')
    ctx.empresas[e.clave] = { id: fila.id, nombre: e.nombre }
  }
  log(`empresas: ${EMPRESAS.map((e) => e.nombre).join(', ')}`)

  for (const u of USUARIOS.filter((x) => x.empresas.length)) {
    await adm.rpc('asignar_empresas_usuario', {
      p_target_user_id: ctx.usuarios[u.clave].id,
      p_asignaciones: u.empresas.map((c) => ({ empresa_id: ctx.empresas[c].id, rol_id: u.rol })),
    })
  }
  log('asignaciones de empresa por usuario')
}
