// commitlint — mensajes de commit en formato conventional (habilita changelog/release automáticos y
// evita mensajes basura). Sin `extends` para no agregar dependencias: sólo @commitlint/cli (vía pnpm dlx).
module.exports = {

  // Los MERGE COMMITS (sync/release) no son mensajes de cambio: no se lintean.
  // Tampoco los commits de cierre que escribe el runner de historias (`MSF-123: F-XXX-01 · título`): no son del dev.
  ignores: [(message) => /^(Merge (pull request|branch|remote-tracking|tag)|MSF-\d+: F-[A-Z]+-\d+ · )/.test(message || "")],
  rules: {
    "type-enum": [
      2,
      "always",
      ["feat", "fix", "docs", "chore", "refactor", "test", "build", "ci", "perf", "style", "revert"],
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
