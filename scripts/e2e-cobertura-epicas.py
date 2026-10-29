#!/usr/bin/env python3
"""COBERTURA DE EVIDENCIA E2E por épica: qué falta escribir y qué es prioritario.

Para cada épica (por defecto, las que están en Review In DEV / Approved In Dev / Review In STG del tracker)
mira el `tasks.md` de su spec y cuenta:
  - cuántas tareas YA tienen un test E2E rotulado `[MSF-xxx:T0yy]`,
  - cuántas NO lo tienen (hay que escribirlas),
  - y de esas, cuántas son de PANTALLA (video) vs de BASE DE DATOS (pgTAP: no llevan video).

Uso:
  ITSAPLAN_API_KEY=… node scripts/e2e-cobertura-epicas.mjs?   # (node)
  ITSAPLAN_API_KEY=… python3 scripts/e2e-cobertura-epicas.py            # (python)
  python3 scripts/e2e-cobertura-epicas.py --epicas MSF-119,MSF-121     # sólo esas
  python3 scripts/e2e-cobertura-epicas.py --md                         # salida en markdown
"""
import json
import os
import re
import sys
import urllib.request
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
API = os.environ.get("ITSAPLAN_API_URL", "https://api.plan.agenmatica.com").rstrip("/")
KEY = os.environ.get("ITSAPLAN_API_KEY", "")
PROY = os.environ.get("ITSAPLAN_PROYECTO", "MSF")
ESTADOS = ("Review In DEV", "Approved In Dev", "Review In STG", "Approved In STG")

# Una tarea es de PANTALLA si el texto habla de UI (ruta, pantalla, componente, modal, botón…).
PANTALLA = re.compile(
    r"(pantalla|ruta|formulario|modal|bot[oó]n|men[uú]|panel|p[aá]gina|componente|UI|frontend|vista|"
    r"url|navega|click|toast|di[aá]logo|carjeta|tabla|listado|filtro|buscador)",
    re.I,
)
# …si habla de base de datos, es de pgTAP (test de base, NO lleva video).
BASE_DATOS = re.compile(
    r"(migraci[oó]n|tabla|columna|RLS|pol[ií]tica|pgTAP|sql|trigger|funci[oó]n|procedimiento|"
    r"v[Pp]w|grant|indice|restricci[oó]n|schema|dominio\.|publico\.)",
    re.I,
)


def get(path):
    req = urllib.request.Request(f"{API}{path}", headers={"x-api-key": KEY})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def epicas_del_tracker():
    if not KEY:
        return []
    try:
        issues = get(f"/projects/{PROY}/issues?limit=800")
        cols = {c["id"]: c["name"] for c in get(f"/projects/{PROY}")["columns"]}
        tipos = {t["id"]: t["name"] for t in get(f"/projects/{PROY}")["issueTypes"]}
    except Exception as e:
        print(f"(no pude leer el tracker: {str(e)[:90]})", file=sys.stderr)
        return []
    out = []
    for i in issues:
        if tipos.get(i.get("typeId")) != "Epic":
            continue
        if cols.get(i.get("columnId")) in ESTADOS:
            out.append(i["identifier"])
    return out


def _menciona(epica, texto):
    return re.search(r"Jira Epic\*?\*?:?\s*" + re.escape(epica), texto) is not None


def _rama_de_epica(epica):
    """Rama de la épica (`epic/MSF-xxx-...`) si existe en el remoto."""
    import subprocess
    try:
        out = subprocess.run(["git", "ls-remote", "--heads", "origin", f"epic/{epica}-*"],
                             capture_output=True, text=True, timeout=30).stdout
    except Exception:
        return None
    for ln in out.splitlines():
        ref = ln.split("refs/heads/")[-1].strip()
        if ref:
            return ref
    return None


def tareas_de_epica(epica):
    """(spec_dir, tareas) de la épica: primero en el working tree, si no en su RAMA (los specs nuevos
    de las épicas viven en la rama de la épica hasta que se integran)."""
    for spec in (RAIZ / "specs").glob("*/spec.md"):
        try:
            if _menciona(epica, spec.read_text(errors="ignore")):
                return spec.parent, tareas_de(spec.parent)
        except OSError:
            continue
    rama = _rama_de_epica(epica)
    if not rama:
        return None, []
    import subprocess
    try:
        files = subprocess.run(["git", "ls-tree", "-r", "--name-only", f"origin/{rama}"],
                               capture_output=True, text=True, timeout=40).stdout.splitlines()
    except Exception:
        return None, []
    for spec_path in [f for f in files if re.match(r"specs/[^/]+/spec\.md$", f)]:
        try:
            txt = subprocess.run(["git", "show", f"origin/{rama}:{spec_path}"],
                                 capture_output=True, text=True, timeout=40).stdout
        except Exception:
            continue
        if not _menciona(epica, txt):
            continue
        tasks_path = spec_path.replace("spec.md", "tasks.md")
        try:
            tt = subprocess.run(["git", "show", f"origin/{rama}:{tasks_path}"],
                                capture_output=True, text=True, timeout=40).stdout
        except Exception:
            tt = ""
        d = Path(spec_path).parent
        out = []
        for ln in tt.splitlines():
            m = re.match(r"^\s*-\s*\[([ xX])\]\s*(T\d+)\b(.*)$", ln)
            if m:
                txt = m.group(3)[:300]
                cod = re.search(r"\[(F-[A-Z0-9]+-\d+)\]", txt)
                out.append({"id": m.group(2), "hecha": m.group(1).lower() == "x", "texto": txt,
                            "historia": cod.group(1) if cod else ""})
        return d, out
    return None, []


def e2e_rotulados():
    """Set de rótulos [MSF-xxx:T0yy] que ya tienen test."""
    out = set()
    for f in (RAIZ / "apps/web/e2e").glob("*.e2e.ts"):
        try:
            txt = f.read_text(errors="ignore")
        except OSError:
            continue
        for m in re.finditer(r"\[([A-Z]{3}-\d+):(T\d+)\]", txt):
            out.add((m.group(1), m.group(2)))
    return out


def tareas_de(spec_dir):
    tasks = spec_dir / "tasks.md"
    if not tasks.exists():
        return []
    out = []
    for ln in tasks.read_text(errors="ignore").splitlines():
        m = re.match(r"^\s*-\s*\[([ xX])\]\s*(T\d+)\b(.*)$", ln)
        if m:
            out.append({"id": m.group(2), "hecha": m.group(1).lower() == "x", "texto": m.group(3)[:300]})
    return out


def main():
    args = sys.argv[1:]
    md = "--md" in args
    pedido = [a for a in args if a.startswith("MSF-")]
    if pedido:
        epicas = pedido
    else:
        epicas = epicas_del_tracker()
    if not epicas:
        print("sin épicas para mirar (pasá MSF-xxx explícitos o exportá ITSAPLAN_API_KEY)")
        return
    rotulados = e2e_rotulados()
    filas = []
    for e in epicas:
        d, ts = tareas_de_epica(e)
        if not d:
            filas.append({"epica": e, "sin_spec": True})
            continue
        # Una historia está cubierta si ALGUNA de sus tareas tiene test rotulado (un E2E por historia
        # alcanza: el video es por funcionalidad, no por tarea).
        historias = {}
        for t in ts:
            if t.get("historia"):
                historias.setdefault(t["historia"], []).append(t)
        faltan_hist = []
        for cod, ts_h in historias.items():
            if all(t["hecha"] for t in ts_h):
                continue
            if any((e, t["id"]) in rotulados for t in ts_h):
                continue
            txt = " ".join(t["texto"] for t in ts_h)
            if PANTALLA.search(txt) and not BASE_DATOS.search(txt):
                faltan_hist.append(cod)
        base_hist = [c for c, ts_h in historias.items()
                     if not all(t["hecha"] for t in ts_h)
                     and c not in faltan_hist
                     and not any((e, t["id"]) in rotulados for t in ts_h)]
        filas.append({"epica": e, "spec": d.name, "historias": len(historias),
                      "sin_e2e": len(faltan_hist), "solo_base": len(base_hist),
                      "codigos": faltan_hist[:8], "hechas": sum(1 for t in ts if t["hecha"])})
        pass
    filas.sort(key=lambda f: -(f.get("sin_e2e", 0)))
    if md:
        print("| Épica | Spec | Historias | Tareas hechas | **Historias SIN E2E (con video)** | Solo base de datos |")
        print("|---|---|---|---|---|---|")
        for f in filas:
            if f.get("sin_spec"):
                print(f"| {f['epica']} | — (sin spec en el repo) | — | — | — | — |")
            else:
                print(f"| {f['epica']} | {f['spec']} | {f['historias']} | {f['hechas']} | **{f['sin_e2e']}** | {f['solo_base']} |")
        tot_p = sum(f.get("sin_e2e", 0) for f in filas)
        tot_b = sum(f.get("solo_base", 0) for f in filas)
        print(f"\n**Total: {tot_p} historias necesitan un E2E (con video) y {tot_b} son sólo base de datos (pgTAP, sin video).**")
    else:
        for f in filas:
            if f.get("sin_spec"):
                print(f"{f['epica']}  — sin spec en el repo")
                continue
            print(f"{f['epica']:9s} {f['spec'][:32]:32s} historias={f['historias']:3d} hechas={f['hechas']:3d} "
                  f"SIN E2E={f['sin_e2e']:3d} (base {f['solo_base']:3d})  {','.join(f['codigos'][:5])}")
        tot_p = sum(f.get("sin_e2e", 0) for f in filas)
        tot_b = sum(f.get("solo_base", 0) for f in filas)
        print(f"\nTOTAL: {tot_p} historias necesitan E2E (con video) + {tot_b} sólo base de datos (pgTAP, sin video)")


if __name__ == "__main__":
    main()
