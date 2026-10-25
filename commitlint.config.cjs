// commitlint — mensajes de commit en formato conventional (habilita changelog/release automáticos y
// evita mensajes basura). Sin `extends` para no agregar dependencias: sólo @commitlint/cli (vía pnpm dlx).
module.exports = {
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
