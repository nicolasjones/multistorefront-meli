// Detector de `ADD COLUMN` sin `IF NOT EXISTS` para el guard de migraciones
// (`verificar-migraciones.mjs`). Analiza la SENTENCIA completa (hasta `;`) y no línea por
// línea, así que cubre `alter table t` + `add column x` en líneas distintas (MSF-682).

// Reemplaza comentarios (`--`, `/* */`) y literales '...' por espacios, conservando los saltos
// de línea para que los offsets sigan dando el mismo número de línea.
export const enmascarar = (sql) => {
  let out = '';
  let i = 0;
  const blanquear = (s) => s.replace(/[^\n]/g, ' ');
  while (i < sql.length) {
    const resto = sql.slice(i);
    let m;
    if ((m = /^--[^\n]*/.exec(resto)) || (m = /^\/\*[\s\S]*?(\*\/|$)/.exec(resto)) || (m = /^'(?:[^']|'')*('|$)/.exec(resto))) {
      out += blanquear(m[0]);
      i += m[0].length;
    } else {
      out += sql[i];
      i += 1;
    }
  }
  return out;
};

// Devuelve [{ linea }] por cada `add column` sin `if not exists` dentro de un `alter table`
// que empieza al inicio de una línea (igual que el resto de las reglas del guard).
export const detectarAddColumnSinGuard = (sql) => {
  const limpio = enmascarar(sql);
  const hallazgos = [];
  const alter = /^[ \t]*alter\s+table\b[^;]*/gim;
  for (const s of limpio.matchAll(alter)) {
    for (const a of s[0].matchAll(/\badd\s+column\b(?!\s+if\s+not\s+exists\b)/gi)) {
      const offset = s.index + a.index;
      hallazgos.push({ linea: limpio.slice(0, offset).split('\n').length });
    }
  }
  return hallazgos;
};
