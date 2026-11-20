// Barrido de ítems duplicados del board (tracker MSF).
//
// Regla central (MSF-908): la etiqueta inicial del título —`[MSF-470]`, `[Cierre MSF-212]`,
// `[Seg. MSF-470]`— es parte de la identidad del ítem. Si al normalizar se la borra, se funden
// ítems legítimos de épicas distintas: el barrido del 2026-11-13 reportó «12 grupos con el mismo
// título» cuando, con la normalización correcta, hay 1 (el resto eran cierres de épica).
//
// Qué reporta:
//   A. Títulos idénticos: mismo padre = duplicado real; padres distintos = falsos positivos.
//   B. Familias por referencia (`[Seg. MSF-470]`) + mismo padre: mismo hallazgo con otra redacción.
//      Es informativo: compartir referencia NO es ser duplicado (bajo `[Seguimiento MSF-205]` hay
//      8 seguimientos distintos) y por eso no se propone cerrar nada por el solo hecho de compartirla.
//   C. Cerrados sin `cierre-administrativo` cuyo gemelo conserva la evidencia: falta unificar.
//   D. Ya unificado con la relación `duplicates` pero sin `cierre-administrativo`: falta el mecanismo.
//
// Uso: `pnpm tracker:duplicados` (sin ITSAPLAN_API_KEY avisa y sale con 0: no rompe el CI).
const LIMITE_POR_TIPO = 500; // tope de la API en la lectura de issues
const CAMPOS_EVIDENCIA = ['QA Report', 'Code Report', 'Security Report', 'Implementation Report'];
const LABEL_CIERRE_ADMINISTRATIVO = 'cierre-administrativo';
const API_POR_DEFECTO = 'https://api.plan.agenmatica.com';
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

/** Un ítem tiene evidencia si tiene alguno de los campos de informe del tracker con contenido. */
export function tieneEvidencia(item) {
  return (item?.fields ?? []).some(
    (campo) => CAMPOS_EVIDENCIA.includes(campo.name) && campo.value && String(campo.value).trim(),
  );
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
    titulos.push({
      clave,
      titulo: miembros[0].title,
      miembros,
      mismosPadres: [...porPadre.values()].filter((grupo) => grupo.length > 1),
      punteros,
    });
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
  const sinCierre = [];
  for (const grupo of titulos) {
    for (const par of grupo.mismosPadres) {
      for (const item of par) {
        if (!estaCerrado(item, columnasCerradas)) continue;
        if (!sinCierreAdministrativo(item, idLabelCierre)) continue;
        const gemelos = par.filter(
          (otro) =>
            otro.id !== item.id &&
            evidencia(otro) &&
            sinCierreAdministrativo(otro, idLabelCierre),
        );
        if (gemelos.length > 0) sinCierre.push({ item, gemelos });
      }
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

  lineas.push(`Barrido de duplicados · proyecto ${contexto.proyecto ?? PROYECTO_POR_DEFECTO} · ${contexto.leidos ?? 0} ítems leídos`);
  lineas.push('');
  lineas.push('A) Títulos idénticos (la etiqueta inicial se conserva)');
  if (informe.titulos.length === 0) lineas.push('   (ninguno)');
  for (const grupo of informe.titulos) {
    const detail = grupo.miembros
      .map((item) => `${item.identifier} (${columna(item.columnId)}, padre ${nombre(item.parentId)})`)
      .join(' · ');
    lineas.push(`   · ${grupo.titulo}`);
    lineas.push(`     ${detail}`);
    if (grupo.mismosPadres.length > 0) {
      for (const mismo of grupo.mismosPadres) {
        const ids = mismo.map((item) => item.identifier);
        const unificado = grupo.punteros.filter((p) => ids.includes(p.desde) && ids.includes(p.hacia));
        const detalle = unificado.map((p) => `${p.desde} → ${p.hacia}`).join(', ');
        lineas.push(
          `     DUPLICADO REAL (mismo padre): ${ids.join(', ')}` +
            (detalle ? ` — ya unificado (${detalle})` : ''),
        );
      }
    } else {
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
  lineas.push('C) Cerrados sin `cierre-administrativo` con un gemelo que sí tiene evidencia');
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
  lineas.push(
    `Resumen: ${informe.titulos.length} grupo(s) con título idéntico · ` +
      `${reales} duplicado(s) real(es) (${sinUnificar} sin unificar) · ` +
      `${informe.familias.length} familia(s) por referencia · ${informe.sinCierre.length} por unificar · ` +
      `${informe.sinMecanismo.length} sin cierre administrativo.`,
  );
  return lineas.join('\n');
}

/** Lee el board: proyecto (columnas y labels) + ítems de los tipos que puede crear el flujo. */
async function leerBoard({ api, key, proyecto = PROYECTO_POR_DEFECTO }) {
  const pedir = async (ruta) => {
    const r = await fetch(`${api}${ruta}`, { headers: { 'x-api-key': key } });
    if (!r.ok) throw new Error(`ItsAPlan ${ruta}: ${r.status}`);
    return r.json();
  };

  const setup = await pedir(`/projects/${proyecto}`);
  const columnas = setup.columns ?? [];
  const labels = setup.labels ?? [];
  const tipos = setup.issueTypes ?? [];
  if (tipos.length === 0) throw new Error('El proyecto no devolvió issueTypes: no se puede barrer el board.');

  const porId = new Map();
  for (const tipo of tipos) {
    const respuesta = await pedir(
      `/projects/${proyecto}/issues?typeId=${tipo.id}&limit=${LIMITE_POR_TIPO}&includeArchived=true`,
    );
    const lista = Array.isArray(respuesta) ? respuesta : (respuesta.data ?? []);
    // La API corta en `limit`: si el tipo llega al tope, el barrido no ve todo el board y hay que avisarlo.
    if (lista.length >= LIMITE_POR_TIPO) {
      console.warn(`aviso: el tipo ${tipo.id} (${tipo.name}) devolvió ${LIMITE_POR_TIPO} ítems (tope de la API): el barrido puede no ver todo el board.`);
    }
    for (const item of lista) porId.set(item.id, item);
  }
  return { setup, items: [...porId.values()], pedir };
}

/** Detalle de un ítem (los campos de evidencia y los links sólo vienen en el detalle). */
async function leerDetalle(pedir, id) {
  return pedir(`/issues/${id}`);
}

async function main() {
  const key = process.env.ITSAPLAN_API_KEY;
  if (!key) {
    console.log('Sin ITSAPLAN_API_KEY: no se puede leer el board; el barrido queda sin correr (no es un error).');
    return 0;
  }
  const api = (process.env.ITSAPLAN_API_URL || API_POR_DEFECTO).replace(/\/+$/, '');
  const proyecto = process.env.ITSAPLAN_PROYECTO || PROYECTO_POR_DEFECTO;

  const { setup, items, pedir } = await leerBoard({ api, key, proyecto });

  const columnasCerradas = new Set(
    (setup.columns ?? []).filter((columna) => columna.stateType === 'completed').map((columna) => columna.id),
  );
  const idLabelCierre = (setup.labels ?? []).find((label) => label.name === LABEL_CIERRE_ADMINISTRATIVO)?.id ?? null;

  const informePreliminar = barrido(items, { columnasCerradas, idLabelCierre });
  const aDetalle = new Set();
  for (const grupo of informePreliminar.titulos) for (const item of grupo.miembros) aDetalle.add(item.id);
  for (const familia of informePreliminar.familias) for (const item of familia.miembros) aDetalle.add(item.id);

  const detalles = new Map();
  for (const id of aDetalle) detalles.set(id, await leerDetalle(pedir, id));
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
