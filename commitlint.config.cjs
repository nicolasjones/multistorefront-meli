// commitlint — mensajes de commit en formato conventional (habilita changelog/release automáticos y
// evita mensajes basura). Sin `extends` para no agregar dependencias: sólo @commitlint/cli (vía pnpm dlx).
module.exports = {
  // Los MERGE COMMITS (sync/release) no son mensajes de cambio: no se lintean.
  // Tampoco los commits de cierre que escribe el runner de historias (`MSF-123: F-XXX-01 · título`): no son del dev.
  // Excepción puntual (MSF-155, AGE-1893): 3 commits de especificación previos a esta regla, sin prefijo `type:`.
  // No se reescribe la historia de una rama de 314 commits para corregirlos; se listan por hash para no abrir la
  // excepción a mensajes futuros.
  ignores: [
    (message) => /^(Merge (pull request|branch|remote-tracking|tag)|MSF-\d+: F-[A-Z]+-\d+ · )/.test(message || ""),
    (message) =>
      /^(Especificación del correo masivo a clientes|Verificación nombrada por requisito en la spec del correo masivo|Verificación nombrada en cada requisito y tarea dueña del correo masivo) \(MSF-155\)$/.test(
        message || "",
      ),
  ],
  rules: {
    "type-enum": [
      2,
      "always",
      // `spec` lo escribe el Especificador al cerrar la spec; no es un cambio de producto.
      ["feat", "fix", "docs", "chore", "refactor", "test", "build", "ci", "perf", "style", "revert", "spec"],
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
