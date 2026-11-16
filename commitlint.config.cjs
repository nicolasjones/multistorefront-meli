// commitlint — mensajes de commit en formato conventional (habilita changelog/release automáticos y
// evita mensajes basura). Sin `extends` para no agregar dependencias: sólo @commitlint/cli (vía pnpm dlx).
module.exports = {
  // Los MERGE COMMITS (sync/release) no son mensajes de cambio: no se lintean.
  // Tampoco los commits de cierre que escribe el runner de historias (`MSF-123: F-XXX-01 · título`): no son del dev.
  // Excepción puntual (MSF-155, AGE-1893): 3 commits de especificación previos a esta regla, sin prefijo `type:`.
  // No se reescribe la historia de una rama de 314 commits para corregirlos; se listan por hash para no abrir la
  // excepción a mensajes futuros.
  // La misma excepción para los commits de especificación de MSF-140 y MSF-192 (las épicas de reportes): sin
  // ella, el job `quality` de la integración de la épica a DEV falla en `commitlint` y la épica no llega nunca
  // a DEV (2026-11-03: MSF-140 y MSF-192 rechazadas por sus propios commits de spec).
  // MSF-804: el merge "Merge base de la épica en <rama>" lo produce la herramienta que sincroniza una rama de
  // historia con su épica; no lleva `type(scope):` y dejaba `quality` en rojo en cada historia que sincroniza.
  ignores: [
    (message) => /^(Merge (pull request|branch|remote-tracking|tag)|MSF-\d+: F-[A-Z]+-\d+ · )/.test(message || ""),
    (message) => /^Merge base de la épica en /.test(message || ""),
    // MSF-145: un commit de la épica quedó con el título en 101 caracteres y ya está publicado; reescribirlo exigiría
    // forzar el push. Se exceptúa ESE título exacto.
    (message) =>
      /^fix\(MSF-145\): leer el contexto vigente del superadmin y registrar envios_moto en la exportación total(\r?\n|$)/.test(
        message || "",
      ),
    // MSF-224: el merge de `dokploy` en la rama de la épica ("Merge origin/dokploy en epic/MSF-224 y renumerar
    // migraciones") no lleva `type(scope):`. Reescribirlo exigiría reescribir la historia compartida de la épica; se
    // exceptúa ESE mensaje exacto (no el patrón general `Merge origin/…`) para no abrir la regla a mensajes futuros.
    (message) => /^Merge origin\/dokploy en epic\/MSF-224 y renumerar migraciones(\r?\n|$)/.test(message || ""),
    (message) =>
      /^(Especificación del correo masivo a clientes|Verificación nombrada por requisito en la spec del correo masivo|Verificación nombrada en cada requisito y tarea dueña del correo masivo) \(MSF-155\)$/.test(
        message || "",
      ),
    (message) =>
      /^(Spec de reportes de inventario y exportación|Verificación nombrada por requisito en las tareas de la spec de reportes de inventario) \(MSF-140\)$/.test(
        message || "",
      ),
    (message) => /^Spec de rentabilidad real y reportes de ventas \(MSF-192\)$/.test(message || ""),
    // MSF-202: el commit de especificación "verificación nombrada en línea para FR-113 y los SC…" (106 caracteres, límite 100)
    // se escribió antes de que la etapa de spec respetara el largo del título. Mismo criterio que MSF-155/140/192: no se
    // reescribe la historia de una rama de épica con 48 commits; se lista por texto exacto para no abrir la excepción.
    (message) =>
      /^spec: verificación nombrada en línea para FR-113 y los SC de catálogo compatibilidad y planillas \(MSF-202\)$/.test(
        message || "",
      ),
    // MSF-363: tres commits de especificación (Especificador) sin `type:`. Mismo criterio que MSF-155/140/192/202: no se
    // reescribe la historia de la rama de la épica; se listan por texto exacto para no abrir la excepción.
    (message) =>
      /^(Especificar la épica MSF-363: precios masivos y promociones \(F-PRE-10 y F-PRE-11\)|Completar la verificación nombrada de cada requisito de la spec MSF-363|Nombrar la verificación de cada tarea dueña de requisito en tasks.md de MSF-363)(\r?\n|$)/.test(
        message || "",
      ),
    // Integración main -> dokploy: 7 commits que solo existían en `main` y no cumplen la regla (4 sin `type:`, 1 con
    // `type: design`, 3 con título de más de 100 caracteres, uno de ellos también sin `type:`). Ya están publicados en
    // `main`; reescribirlos exigiría forzar el push. Se exceptúa cada título EXACTO (no un patrón) para no abrir la regla.
    (message) =>
      /^(Verificación nombrada por cada requisito de la spec de mejoras de clientes y proveedores \(MSF-445\)|Spec de mejoras de clientes y proveedores \(MSF-445\): etiqueta, fusión, costos y contactos|merge main en docs\/msf-117 \(manifest regenerado\))(\r?\n|$)/.test(
        message || "",
      ),
    (message) =>
      /^(design: AdminHeader con modo oscuro \(v25\)|fix\(calidad\): gitleaks robusto \(config relativa \+ guard\), quitar \$schema de jscpd, job no bloqueante a nivel step|chore\(calidad\): checks deterministas \(F1\) — secretos, SAST, dead code, duplicación, arquitectura, versiones|docs\(specs\): el prototipo es la referencia visual — 'lo más fiel posible' \(no 'no hace falta que quede idéntico'\))(\r?\n|$)/.test(
        message || "",
      ),
  ],
  rules: {
    "type-enum": [
      2,
      "always",
      // `spec` lo escribe el Especificador al cerrar la spec; no es un cambio de producto.
      // `merge` son los commits de integración de la base (p. ej. `merge: dokploy en <rama>`).
      ["feat", "fix", "docs", "chore", "refactor", "test", "build", "ci", "perf", "style", "revert", "spec", "merge"],
    ],
    "type-empty": [2, "never"],
    "subject-empty": [2, "never"],
    "header-max-length": [2, "always", 100],
    // El subject puede venir en castellano (con mayúsculas/acentos): no forzamos lower-case.
    "subject-case": [0],
    "body-max-line-length": [0],
    "footer-max-line-length": [0],
  },
};
