// dependency-cruiser — reglas de ARQUITECTURA (fitness functions), mínimo y estable.
// Sólo reglas objetivas para no generar ruido: sin ciclos, sin huérfanos, sin deps de desarrollo en runtime.
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment: "Sin ciclos de imports (dificultan testeo y bundling).",
      from: {},
      to: { circular: true },
    },
    {
      name: "no-orphans",
      severity: "warn",
      comment: "Archivo sin referencias (candidato a código muerto).",
      from: {
        orphan: true,
        pathNot: [
          "\\.d\\.ts$",
          "(^|/)index\\.[jt]sx?$",
          "(^|/)main\\.tsx$",
          "(^|/)App\\.tsx$",
          "(^|/)vite-env\\.d\\.ts$",
          "(^|/)setup\\.ts$",
          "\\.test\\.",
          "\\.e2e\\.",
          "(^|/)test/",
        ],
      },
      to: {},
    },
    {
      name: "not-to-dev-dep",
      severity: "error",
      comment: "El código de apps/web/src no debe depender de devDependencies en runtime.",
      from: { path: "^apps/web/src" },
      to: {
        dependencyTypes: ["npm-dev"],
        pathNot: ["node_modules/(@types|vitest|@testing-library|msw|jsdom|@vitejs)/"],
      },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    // Los tests NO se excluyen del cruce: si se excluyen, sus archivos de apoyo (los que sólo
    // importan los tests) quedan sin ninguna arista y `no-orphans` los marca como código muerto
    // aunque los usen (MSF-895). La regla `no-orphans` sigue excluidos a los tests por `pathNot`.
    exclude: { path: "(node_modules|dist|graphify-out)" },
    tsPreCompilationDeps: true,
  },
};
