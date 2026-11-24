// Barrido de ítems duplicados del board (tracker MSF).
//
// Regla central (MSF-908): la etiqueta inicial del título —`[MSF-470]`, `[Cierre MSF-212]`,
// `[Seg. MSF-470]`— es parte de la identidad del ítem. Si al normalizar se la borra, se funden
// ítems legítimos de épicas distintas: el barrido del 2026-11-13 reportó «12 grupos con el mismo
// título» cuando, con la normalización correcta, hay 1 (el resto eran cierres de épica).
//
// Qué reporta:
//   A. Títulos idénticos: mismo padre = duplicado real; un ítem sin padre = re-reporte de otro
//      (candidato a duplicado); padres distintos y ambos con padre = ítems de cada épica.
//   B. Familias por referencia (`[Seg. MSF-470]`) + mismo padre: mismo hallazgo con otra redacción.
//      Es informativo: compartir referencia NO es ser duplicado (bajo `[Seguimiento MSF-205]` hay
//      8 seguimientos distintos) y por eso no se propone cerrar nada por el solo hecho de compartirla.
//   C. Cerrados sin `cierre-administrativo` cuyo gemelo conserva la evidencia: falta unificar.
//   D. Ya unificado con la relación `duplicates` pero sin `cierre-administrativo`: falta el mecanismo.
//
// Cobertura: el barrido lee el board COMPLETO (`/issues/board` + `/issues/archived`, sin filtro por
// tipo: los ítems sin tipo se cuelan en ese filtro) y pide el detalle de TODOS los ítems (las
// relaciones `duplicates` de la sección D pueden estar en cualquier ítem, no sólo en un grupo).
// Los dos endpoints se unen por IDENTIDAD (`identifier`): un ítem que aparece en los dos se cuenta
// una sola vez (si no, el barrido lo cita como duplicado de sí mismo). Si la lectura no trae ítems o
// trae una forma inesperada, el barrido FALLA: un board vacío es una lectura rota, no un board limpio.
//
// Uso: `pnpm tracker:duplicados` (sin ITSAPLAN_API_KEY avisa y sale con 0: no rompe el CI).
const CAMPOS_EVIDENCIA = ['QA Report', 'Code Report', 'Security Report', 'Implementation Report'];
// Estados que el flujo escribe en el título del Implementation Report cuando NO hubo entrega.
const ESTADOS_SIN_ENTREGA = ['terminó sin PR', 'falló el Desarrollador'];
const LABEL_CIERRE_ADMINISTRATIVO = 'cierre-administrativo';
// Cuántos detalles se piden a la vez: el board tiene ~840 ítems y en serie tarda minutos.
const CONCURRENCIA_DETALLE = 8;
const REINTENTOS_DETALLE = 3;
const ESPERA_REINTENTO_MS = 500;
const API_POR_DEFECTO = 'https://api.plan.agenmatica.com';
// Tope de una lectura del tracker: una lista que llega justo al tope puede estar truncada.
export const TOPE_LECTURA = 500;
const FLAG_OTRA_API = '--permitir-otra-api';

/**
 * URL del tracker: sólo el host por defecto. `ITSAPLAN_API_URL` con otro host manda la clave
 * personal a un tercero: se exige `--permitir-otra-api` y se avisa.
 */
export function resolverApi({ valor, args = [], aviso = () => {} }) {
  const api = String(valor || API_POR_DEFECTO).replace(/\/+$/, '');
  if (api === API_POR_DEFECTO) return api;
  if (!args.includes(FLAG_OTRA_API)) {
    throw new Error(
      `ITSAPLAN_API_URL apunta a otro host (${api}): la clave personal se enviaría ahí. ` +
        `Sólo se acepta ${API_POR_DEFECTO}; para otro host pasá ${FLAG_OTRA_API}.`,
    );
  }
  aviso(`Aviso: se usa un host distinto del tracker por defecto (${api}) por ${FLAG_OTRA_API}.`);
  return api;
}
const PROYECTO_POR_DEFECTO = 'MSF';

/**
 * Normaliza un título para comparar. Conserva la etiqueta inicial (su contenido entra en la
 * clave): quitarla es lo que produjo los 11 falsos positivos del barrido de 2026-11-13.
 */
export function normalizarTitulo(titulo) {
  return String(titulo ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Referencia de la etiqueta inicial (`[Seg. MSF-470]` → `seg. msf-470`), o `null` si la etiqueta
 * no apunta a un ítem (las de tipo —`[Bug]`, `[Auditoría]`— no son referencias: las comparten
 * decenas de ítems que no son duplicados).
 */
export function referenciaTitulo(titulo) {
  const etiqueta = /^\s*\[([^\]]+)\]/.exec(String(titulo ?? ''));
  if (!etiqueta) return null;
  const contenido = etiqueta[1].trim().toLowerCase();
  return /msf-\d+|f-[a-z]+-\d+|\bl\d+\b/.test(contenido) ? contenido : null;
}

/** Agrupa por título normalizado: Map<clave, ítems>. */
export function gruposPorTitulo(items) {
  const grupos = new Map();
  for (const item of items) {
    const clave = normalizarTitulo(item.title);
    if (!clave) continue;
    if (!grupos.has(clave)) grupos.set(clave, []);
    grupos.get(clave).push(item);
  }
  return grupos;
}

/** Familias por referencia + padre: Map<`referencia|parentId`, ítems>. */
export function familiasPorReferencia(items) {
  const familias = new Map();
  for (const item of items) {
    const referencia = referenciaTitulo(item.title);
    if (!referencia) continue;
    const clave = `${referencia}|${item.parentId ?? ''}`;
    if (!familias.has(clave)) familias.set(clave, []);
    familias.get(clave).push(item);
  }
  return familias;
}

/**
 * Un ítem tiene evidencia si tiene un informe de revisión con contenido. El Implementation Report
 * sólo cuenta si NO declara que no entregó: el flujo titula el informe con el estado
 * («— PR listo», «— correcciones aplicadas», «— terminó sin PR», «— falló el Desarrollador»).
 * Un informe que dice «terminó sin PR» no es una entrega: si el barrido lo tomara por evidencia,
 * señalaría como «el que conserva la evidencia» a un ítem que no entregó nada.
 */
export function tieneEvidencia(item) {
  return (item?.fields ?? []).some((campo) => {
    if (!CAMPOS_EVIDENCIA.includes(campo.name)) return false;
    const valor = String(campo.value ?? '').trim();
    if (!valor) return false;
    if (campo.name !== 'Implementation Report') return true;
    const titulo = valor.split('\n')[0];
    return !ESTADOS_SIN_ENTREGA.some((estado) => titulo.includes(estado));
  });
}

/**
 * Dos ítems con el mismo título son un par duplicado si comparten padre, o si al menos uno de los
 * dos no tiene padre (re-reporte). Dos ítems de épicas distintas (padres distintos, ambos con padre)
 * no son duplicados.
 */
export function esParDuplicado(a, b) {
  return a.parentId == null || b.parentId == null || a.parentId === b.parentId;
}

/** El ítem está en una columna cerrada (stateType `completed`). */
export function estaCerrado(item, columnasCerradas) {
  return columnasCerradas.has(item.columnId);
}

/** El ítem no lleva el label de cierre administrativo. */
export function sinCierreAdministrativo(item, idLabelCierre) {
  return !(item.labelIds ?? []).includes(idLabelCierre);
}

/**
 * Ítems a los que este ítem duplica (relación `duplicates` hacia afuera): el puntero explícito
 * al ítem que conserva la evidencia.
 */
export function duplicadosDe(item, relaciones = () => []) {
  return (relaciones(item) ?? [])
    .filter((link) => link.kind === 'duplicates' && link.direction === 'outward')
    .map((link) => link.issue?.identifier)
    .filter(Boolean);
}

/**
 * Barrido sobre los ítems leídos.
 *
 * @param items ítems del board (con `title`, `parentId`, `columnId` y `labelIds`).
 * @param opciones.columnasCerradas Set de ids de columna con stateType `completed`.
 * @param opciones.idLabelCierre id del label `cierre-administrativo` (`null` si el proyecto no lo tiene).
 * @param opciones.evidencia function que dice si un ítem tiene evidencia (los campos sólo vienen
 *   en el detalle de cada ítem, así que el barrido los consulta aparte).
 * @param opciones.relaciones function que devuelve los links del detalle de un ítem.
 */
export function barrido(items, { columnasCerradas, idLabelCierre, evidencia = () => false, relaciones = () => [] }) {
  const grupos = gruposPorTitulo(items);

  const titulos = [];
  for (const [clave, miembros] of grupos) {
    if (miembros.length < 2) continue;
    const porPadre = new Map();
    for (const item of miembros) {
      const padre = item.parentId ?? '';
      if (!porPadre.has(padre)) porPadre.set(padre, []);
      porPadre.get(padre).push(item);
    }
    const identificadores = new Set(miembros.map((item) => item.identifier));
    const punteros = [];
    for (const item of miembros) {
      for (const destino of duplicadosDe(item, relaciones)) {
        if (identificadores.has(destino)) punteros.push({ desde: item.identifier, hacia: destino });
      }
    }
    // Mismo padre (y con padre) = duplicado real. Sin padre = re-reporte de otro ítem: candidato.
    const mismosPadres = [...porPadre.entries()]
      .filter(([padre, grupo]) => padre !== '' && grupo.length > 1)
      .map(([, grupo]) => grupo);
    const sinPadre = porPadre.get('') ?? [];
    const enPar = new Set(mismosPadres.flat().map((item) => item.id));
    const otros = miembros.filter((item) => !enPar.has(item.id) && !sinPadre.includes(item));
    titulos.push({ clave, titulo: miembros[0].title, miembros, mismosPadres, sinPadre, otros, punteros });
  }

  const familias = [];
  for (const [clave, miembros] of familiasPorReferencia(items)) {
    if (miembros.length < 2) continue;
    if (new Set(miembros.map((item) => normalizarTitulo(item.title))).size < 2) continue; // ya es un grupo por título
    familias.push({
      clave,
      referencia: clave.split('|')[0],
      parentId: miembros[0].parentId,
      miembros,
    });
  }

  // C) Cerrados sin `cierre-administrativo` cuyo gemelo conserva la evidencia. Se excluye el gemelo
  // que ya se cerró administrativamente: ése es el duplicado, el otro es el que conserva la entrega.
  // Se miran todos los pares plausibles del grupo, no sólo los de mismo padre: un par con los dos
  // ítems sin padre también es un duplicado y antes quedaba afuera de C.
  const sinCierre = [];
  for (const grupo of titulos) {
    for (const item of grupo.miembros) {
      if (!estaCerrado(item, columnasCerradas)) continue;
      if (!sinCierreAdministrativo(item, idLabelCierre)) continue;
      const gemelos = grupo.miembros.filter(
        (otro) =>
          otro.id !== item.id &&
          esParDuplicado(item, otro) &&
          evidencia(otro) &&
          sinCierreAdministrativo(otro, idLabelCierre),
      );
      if (gemelos.length > 0) sinCierre.push({ item, gemelos });
    }
  }

  // D) La relación `duplicates` ya está puesta pero falta el label del cierre administrativo.
  const sinMecanismo = [];
  for (const item of items) {
    const duplica = duplicadosDe(item, relaciones);
    if (duplica.length === 0) continue;
    if (!sinCierreAdministrativo(item, idLabelCierre)) continue;
    sinMecanismo.push({ item, duplica });
  }

  return { titulos, familias, sinCierre, sinMecanismo };
}

/** Informe legible del barrido. */
export function formatearInforme(informe, contexto = {}) {
  const lineas = [];
  const nombre = (id) => contexto.nombresPorId?.get(id) ?? (id ? `id ${id}` : 'sin padre');
  const columna = (id) => contexto.nombresColumna?.get(id) ?? `id ${id}`;
  const etiqueta = (id) => contexto.nombresEtiqueta?.get(id) ?? `id ${id}`;

  const cobertura =
    contexto.activos != null ? ` (${contexto.activos} activos + ${contexto.archivados ?? 0} archivados)` : '';
  lineas.push(`Barrido de duplicados · proyecto ${contexto.proyecto ?? PROYECTO_POR_DEFECTO} · ${contexto.leidos ?? 0} ítems leídos${cobertura}`);
  lineas.push('');
  lineas.push('A) Títulos idénticos (la etiqueta inicial se conserva)');
  if (informe.titulos.length === 0) lineas.push('   (ninguno)');
  for (const grupo of informe.titulos) {
    const detail = grupo.miembros
      .map((item) => `${item.identifier} (${columna(item.columnId)}, padre ${nombre(item.parentId)})`)
      .join(' · ');
    lineas.push(`   · ${grupo.titulo}`);
    lineas.push(`     ${detail}`);
    for (const mismo of grupo.mismosPadres) {
      const ids = mismo.map((item) => item.identifier);
      const unificado = grupo.punteros.filter((p) => ids.includes(p.desde) && ids.includes(p.hacia));
      const detalle = unificado.map((p) => `${p.desde} → ${p.hacia}`).join(', ');
      lineas.push(
        `     DUPLICADO REAL (mismo padre): ${ids.join(', ')}` +
          (detalle ? ` — ya unificado (${detalle})` : ''),
      );
    }
    if (grupo.sinPadre.length > 0) {
      // Un ítem sin padre con el título de otro es un re-reporte: candidato a duplicado. Se nombran
      // el re-reporte y sus posibles originales por separado (los de mismo padre y los sueltos).
      const sinPadre = grupo.sinPadre.map((item) => item.identifier);
      const contrapartes = grupo.miembros
        .filter((item) => !grupo.sinPadre.includes(item))
        .map((item) => item.identifier);
      const unificado = grupo.punteros.filter(
        (p) => sinPadre.includes(p.desde) || sinPadre.includes(p.hacia),
      );
      const detalle = unificado.map((p) => `${p.desde} → ${p.hacia}`).join(', ');
      const destino = contrapartes.length
        ? ` — revisar si duplica a ${contrapartes.join(', ')}`
        : ' — revisar si son duplicados entre sí';
      lineas.push(
        `     CANDIDATO A DUPLICADO: ${sinPadre.join(', ')} (mismo título, sin padre)` +
          (detalle ? ` — ya unificado (${detalle})` : destino),
      );
    } else if (grupo.otros.length > 0) {
      lineas.push('     falsos positivos: padres distintos (un ítem por épica)');
    }
  }

  lineas.push('');
  lineas.push('B) Familias por referencia + mismo padre (informativo: compartir referencia no es ser duplicado)');
  if (informe.familias.length === 0) lineas.push('   (ninguna)');
  for (const familia of informe.familias) {
    const detalle = familia.miembros
      .map((item) => {
        const unificado = contexto.unificados?.get(item.identifier);
        return unificado ? `${item.identifier} (duplica a ${unificado})` : item.identifier;
      })
      .join(', ');
    lineas.push(`   · [${familia.referencia}] + ${nombre(familia.parentId)}: ${detalle}`);
  }

  lineas.push('');
  lineas.push(
    'C) Cerrados sin `cierre-administrativo` con un gemelo que sí tiene evidencia (par duplicado: mismo padre o re-reporte sin padre)',
  );
  if (informe.sinCierre.length === 0) lineas.push('   (ninguno)');
  for (const caso of informe.sinCierre) {
    lineas.push(
      `   · ${caso.item.identifier} (${columna(caso.item.columnId)}; labels: ${(caso.item.labelIds ?? []).map(etiqueta).join(', ') || 'ninguno'})` +
        ` → gemelo con evidencia: ${caso.gemelos.map((item) => item.identifier).join(', ')}`,
    );
  }

  lineas.push('');
  lineas.push('D) Marcado como duplico (`duplicates`) pero sin `cierre-administrativo`');
  if (informe.sinMecanismo.length === 0) lineas.push('   (ninguno)');
  for (const caso of informe.sinMecanismo) {
    lineas.push(`   · ${caso.item.identifier} → ${caso.duplica.join(', ')}`);
  }

  lineas.push('');
  const reales = informe.titulos.reduce((total, grupo) => total + grupo.mismosPadres.length, 0);
  const sinUnificar = informe.titulos.reduce((total, grupo) => {
    const pares = grupo.mismosPadres.filter((par) => {
      const ids = par.map((item) => item.identifier);
      return !grupo.punteros.some((p) => ids.includes(p.desde) && ids.includes(p.hacia));
    });
    return total + pares.length;
  }, 0);
  const candidatos = informe.titulos.filter((grupo) => grupo.sinPadre.length > 0).length;
  const candidatosPendientes = informe.titulos.filter(
    (grupo) =>
      grupo.sinPadre.length > 0 &&
      !grupo.punteros.some((p) => grupo.sinPadre.some((item) => item.identifier === p.desde || item.identifier === p.hacia)),
  ).length;
  lineas.push(
    `Resumen: ${informe.titulos.length} grupo(s) con título idéntico · ` +
      `${reales} duplicado(s) real(es) (${sinUnificar} sin unificar) · ` +
      `${candidatos} candidato(s) sin padre (${candidatosPendientes} sin unificar) · ` +
      `${informe.familias.length} familia(s) por referencia · ${informe.sinCierre.length} por unificar · ` +
      `${informe.sinMecanismo.length} sin cierre administrativo.`,
  );
  return lineas.join('\n');
}

/** Cliente HTTP del tracker (la clave nunca se imprime ni va en la URL). */
function crearPedir({ api, key }) {
  return async (ruta) => {
    const r = await fetch(`${api}${ruta}`, { headers: { 'x-api-key': key } });
    if (!r.ok) {
      const error = new Error(`ItsAPlan ${ruta}: ${r.status}`);
      error.status = r.status;
      throw error;
    }
    return r.json();
  };
}

/** Lista de ítems de una respuesta del tracker, aceptando las formas conocidas. */
function listaDe(respuesta, ruta) {
  if (Array.isArray(respuesta)) return respuesta;
  if (Array.isArray(respuesta?.issues)) return respuesta.issues;
  if (Array.isArray(respuesta?.data)) return respuesta.data;
  throw new Error(`No se pudo leer ${ruta}: respuesta inesperada`);
}

/** Identidad del ítem en el board: el `identifier` manda; el `id` es sólo el respaldo. */
function claveIdentidad(item) {
  return item.identifier ?? `id:${item.id}`;
}

/**
 * Lee el board completo: proyecto (columnas y labels) + ítems activos y archivados.
 * Se usa `/issues/board` y no el filtro por `typeId` porque ese filtro deja afuera los ítems
 * sin tipo, y la lectura por tipo además corta en el tope de la API.
 */
export async function leerBoard({ pedir, proyecto = PROYECTO_POR_DEFECTO }) {
  const setup = await pedir(`/projects/${proyecto}`);
  const board = await pedir(`/projects/${proyecto}/issues/board`);
  const archivados = await pedir(`/projects/${proyecto}/issues/archived`);
  const activos = listaDe(board, '/issues/board');
  const listaArchivados = listaDe(archivados, '/issues/archived');

  // Una lista que llega al tope puede estar truncada: el barrido diría «limpio» sobre un board parcial.
  for (const [ruta, lista] of [['/issues/board', activos], ['/issues/archived', listaArchivados]]) {
    if (lista.length >= TOPE_LECTURA) {
      throw new Error(`${ruta} devolvió ${lista.length} ítems (tope ${TOPE_LECTURA}): la lectura puede estar truncada`);
    }
  }

  // Se deduplica por identidad: un ítem puede venir en los dos endpoints (activo y archivado) y
  // entrar dos veces; sin esto el barrido lo reporta como duplicado de sí mismo.
  const porIdentidad = new Map();
  for (const item of activos) {
    const clave = claveIdentidad(item);
    if (!porIdentidad.has(clave)) porIdentidad.set(clave, item);
  }
  let archivadosNuevos = 0;
  for (const item of listaArchivados) {
    const clave = claveIdentidad(item);
    if (porIdentidad.has(clave)) continue;
    porIdentidad.set(clave, item);
    archivadosNuevos += 1;
  }

  const items = [...porIdentidad.values()];
  // Un board vacío no es un board limpio: es una lectura rota. Falla fuerte en vez de mentir.
  if (items.length === 0) throw new Error('No se puede barrer el board: 0 ítems leídos');
  return { setup, items, activos: items.length - archivadosNuevos, archivados: archivadosNuevos };
}

/** Detalle de un ítem (los campos de evidencia y los links sólo vienen en el detalle). */
async function leerDetalle(pedir, id) {
  return pedir(`/issues/${id}`);
}

/**
 * Reintenta una lectura transitoria (429/5xx o fallo de red) con espera exponencial. El barrido
 * pide ~840 detalles y un solo 429 no debe abortar la corrida.
 */
export async function conReintentos(fn, { intentos = REINTENTOS_DETALLE, espera = ESPERA_REINTENTO_MS } = {}) {
  for (let intento = 1; ; intento += 1) {
    try {
      return await fn();
    } catch (error) {
      const transitorio = !error.status || error.status === 429 || error.status >= 500;
      if (!transitorio || intento >= intentos) throw error;
      await new Promise((listo) => setTimeout(listo, espera * 2 ** (intento - 1)));
    }
  }
}

/**
 * Pide el detalle de todos los ítems: la relación `duplicates` puede estar en cualquier ítem,
 * no sólo en los que caen en un grupo por título o en una familia por referencia. Va por tandas
 * (en serie son ~840 pedidos y tarda minutos).
 */
export async function cargarDetalles(items, leer) {
  const detalles = new Map();
  for (let i = 0; i < items.length; i += CONCURRENCIA_DETALLE) {
    const lote = items.slice(i, i + CONCURRENCIA_DETALLE);
    const leidos = await Promise.all(lote.map((item) => conReintentos(() => leer(item.id))));
    lote.forEach((item, indice) => detalles.set(item.id, leidos[indice]));
  }
  return detalles;
}

async function main() {
  const key = process.env.ITSAPLAN_API_KEY;
  if (!key) {
    console.log('Sin ITSAPLAN_API_KEY: no se puede leer el board; el barrido queda sin correr (no es un error).');
    return 0;
  }
  const api = resolverApi({ valor: process.env.ITSAPLAN_API_URL, args: process.argv.slice(2), aviso: (m) => console.error(m) });
  const proyecto = process.env.ITSAPLAN_PROYECTO || PROYECTO_POR_DEFECTO;

  const pedir = crearPedir({ api, key });
  const { setup, items, activos, archivados } = await leerBoard({ pedir, proyecto });

  const columnasCerradas = new Set(
    (setup.columns ?? []).filter((columna) => columna.stateType === 'completed').map((columna) => columna.id),
  );
  const idLabelCierre = (setup.labels ?? []).find((label) => label.name === LABEL_CIERRE_ADMINISTRATIVO)?.id ?? null;

  const detalles = await cargarDetalles(items, (id) => leerDetalle(pedir, id));
  const evidencia = (item) => tieneEvidencia(detalles.get(item.id) ?? item);
  const relaciones = (item) => detalles.get(item.id)?.links ?? [];

  const informe = barrido(items, { columnasCerradas, idLabelCierre, evidencia, relaciones });

  const nombresPorId = new Map(items.map((item) => [item.id, item.identifier]));
  const unificados = new Map();
  for (const item of items) {
    const duplica = duplicadosDe(item, relaciones);
    if (duplica.length > 0) unificados.set(item.identifier, duplica.join(', '));
  }
  const contexto = {
    proyecto,
    leidos: items.length,
    activos,
    archivados,
    nombresPorId,
    nombresColumna: new Map((setup.columns ?? []).map((c) => [c.id, c.name])),
    nombresEtiqueta: new Map((setup.labels ?? []).map((l) => [l.id, l.name])),
    unificados,
  };
  console.log(formatearInforme(informe, contexto));
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith('auditar-duplicados-tracker.mjs')) {
  main()
    .then((codigo) => {
      process.exitCode = codigo;
    })
    .catch((error) => {
      console.error(`No se pudo correr el barrido: ${error.message}`);
      process.exitCode = 1;
    });
}
