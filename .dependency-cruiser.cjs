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
          "node_modules",
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
      // Los tests y sus archivos de apoyo sí pueden usar devDependencies (vitest, axe-core, ...):
      // la regla mira el código que se ejecuta en el navegador, no las pruebas.
      from: { path: "^apps/web/src", pathNot: "\\.test\\.|^apps/web/src/test/" },
      to: { dependencyTypes: ["npm-dev"] },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    // Los tests NO se excluyen del cruce: si se excluyen, sus archivos de apoyo (los que sólo
    // importan los tests) quedan sin ninguna arista y `no-orphans` los marca como código muerto
    // aunque los usen (MSF-895). La regla `no-orphans` sigue excluidos a los tests por `pathNot`.
    //
    // `node_modules` NO va en `exclude`: excluirlo borra la arista hacia el paquete y con ella la
    // clasificación `npm`/`npm-dev`, así que la regla `not-to-dev-dep` nunca podía dispararse
    // (MSF-895). Con `doNotFollow` el paquete no se cruza, pero la arista queda y se puede clasificar.
    exclude: { path: "(dist|graphify-out)" },
    tsPreCompilationDeps: true,
  },
};
