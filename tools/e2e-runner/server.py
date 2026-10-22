#!/usr/bin/env python3
"""Runner local del visor E2E (no forma parte del producto).

Expone en el tailnet:
  POST /correr  {"epica": "MSF-121"}  -> dispara el workflow manual (visible + video)
  GET  /estado                         -> estado de la corrida en curso

Cuando la corrida termina bien, baja los artefactos, reescribe el manifiesto con
claves ASCII y publica videos + `latest/cobertura-e2e.json` en el bucket.
"""
import json
import os
import re
import subprocess
import threading
import time
import unicodedata
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

RAIZ = os.environ.get("E2E_RUNNER_WORK", "/tmp/e2e-runner")
REPO = "nicolasjones/multistorefront-meli"
WORKFLOW = "validate.yml"
EVIDENCIA = os.environ.get("EVIDENCIA_DIR", "/root/e2e-evidencia")
ORIGENES = {
    "http://100.77.94.122:9327",
    "http://100.77.94.122:9326",
    "http://localhost:9327",
    "http://127.0.0.1:9327",
}
config = json.load(open(os.environ.get("E2E_RUNNER_CONFIG", "/root/e2e-runner/config.json")))
estado = {"estado": "libre", "epica": None, "run_id": None, "mensaje": None}
candado = threading.Lock()


def gh(*args):
    r = subprocess.run(["gh", *args], capture_output=True, text=True, timeout=120)
    if r.returncode != 0:
        raise RuntimeError((r.stderr or r.stdout).strip()[:300])
    return r.stdout


def clave(ruta):
    partes = []
    for p in ruta.replace("\\", "/").split("/"):
        if p in ("", ".", ".."):
            continue
        p = "".join(c for c in unicodedata.normalize("NFD", p) if unicodedata.category(c) != "Mn")
        p = re.sub(r"[^A-Za-z0-9._-]+", "-", p)
        p = re.sub(r"-+", "-", p).strip("-")
        if not p:
            p = "x"
        if p.startswith("."):
            p = "x" + p
        partes.append(p)
    return "/".join(partes)


def publicar(run_id, epica):
    base = f"{RAIZ}/runs/{run_id}"
    os.makedirs(base, exist_ok=True)
    for nombre, destino in (("playwright-report-sesion", "sesion"), ("playwright-report", "publico")):
        try:
            import shutil
            shutil.rmtree(f"{base}/{destino}", ignore_errors=True)
            gh("run", "download", str(run_id), "--repo", REPO, "--name", nombre, "--dir", f"{base}/{destino}")
        except RuntimeError:
            pass
    candidatos = []
    for destino in ("sesion", "publico"):
        manifiesto = f"{base}/{destino}/playwright-report/cobertura-e2e.json"
        if os.path.exists(manifiesto):
            datos = json.load(open(manifiesto))
            if any(e.get("epica") == epica for e in datos.get("evidencias", [])):
                candidatos.append((destino, datos))
    if not candidatos:
        raise RuntimeError(f"la corrida {run_id} no dejó evidencia de {epica}")
    destino, datos = candidatos[0]
    videos_dir = f"{base}/{destino}/test-results"
    destino_videos = os.path.join(EVIDENCIA, str(run_id))
    os.makedirs(destino_videos, exist_ok=True)
    n = 0
    for raiz, _, archivos in os.walk(videos_dir):
        for archivo in archivos:
            if not archivo.endswith(".webm"):
                continue
            ruta = os.path.join(raiz, archivo)
            rel = clave(os.path.relpath(ruta, videos_dir).replace(os.sep, "/"))
            salida = os.path.join(destino_videos, rel)
            os.makedirs(os.path.dirname(salida), exist_ok=True)
            with open(salida, "wb") as f:
                f.write(open(ruta, "rb").read())
            n += 1
    for evidencia in datos.get("evidencias", []):
        if evidencia.get("video"):
            evidencia["video"] = f"{run_id}/{clave(evidencia['video'])}"
    os.makedirs(EVIDENCIA, exist_ok=True)
    with open(os.path.join(EVIDENCIA, "index.json"), "w") as f:
        json.dump(datos, f, ensure_ascii=False, indent=2)
    return n


def _bajar(run_id, nombre, destino):
    import shutil
    shutil.rmtree(destino, ignore_errors=True)
    try:
        gh("run", "download", str(run_id), "--repo", REPO, "--name", nombre, "--dir", destino)
        return True
    except RuntimeError:
        return False


def _importar_uno(run_id):
    base = f"{RAIZ}/runs/{run_id}"
    os.makedirs(base, exist_ok=True)
    evidencias, sin, huerfanos = {}, {}, {}
    fecha = None
    n_videos = 0
    for nombre, destino in (("playwright-report", "publico"), ("playwright-report-sesion", "sesion")):
        if not _bajar(run_id, nombre, f"{base}/{destino}"):
            continue
        manifiesto = f"{base}/{destino}/playwright-report/cobertura-e2e.json"
        if not os.path.exists(manifiesto):
            continue
        datos = json.load(open(manifiesto))
        fecha = fecha or datos.get("fecha")
        for e in datos.get("evidencias", []):
            if e.get("video"):
                rel = clave(e["video"])
                origen = os.path.join(f"{base}/{destino}/test-results", e["video"])
                salida = os.path.join(EVIDENCIA, str(run_id), destino, rel)
                os.makedirs(os.path.dirname(salida), exist_ok=True)
                if os.path.exists(origen):
                    with open(salida, "wb") as f:
                        f.write(open(origen, "rb").read())
                    n_videos += 1
                e["video"] = f"{run_id}/{destino}/{rel}"
            evidencias[(e.get("epica"), e.get("test"))] = e
        for p in datos.get("sin_cubrir", []):
            sin[(p.get("spec"), p.get("id"))] = p
        for h in datos.get("huerfanos", []):
            huerfanos[h.get("test")] = h
    if not evidencias:
        return None
    salida = {
        "run_id": str(run_id),
        "fecha": fecha,
        "modo": "on",
        "evidencias": list(evidencias.values()),
        "huerfanos": list(huerfanos.values()),
        "sin_cubrir": list(sin.values()),
    }
    os.makedirs(EVIDENCIA, exist_ok=True)
    with open(os.path.join(EVIDENCIA, "index.json"), "w") as f:
        json.dump(salida, f, ensure_ascii=False, indent=2)
    return {"run_id": str(run_id), "evidencias": len(evidencias), "videos": n_videos}


def importar(run_id=None):
    """La última corrida exitosa que haya dejado manifiesto (o la indicada)."""
    if run_id:
        r = _importar_uno(run_id)
        if not r:
            raise RuntimeError(f"la corrida {run_id} no dejó manifiesto")
        return r
    lista = json.loads(gh("run", "list", "--repo", REPO, "--workflow", WORKFLOW,
                          "--status", "success", "--limit", "10", "--json", "databaseId"))
    for item in lista:
        r = _importar_uno(item["databaseId"])
        if r:
            return r
    raise RuntimeError("ninguna corrida reciente dejó manifiesto")


def vigilar_nuevas():
    """Cada 5 min: si hay una corrida exitosa más nueva, la importa sola."""
    while True:
        time.sleep(300)
        try:
            with candado:
                if estado["estado"] == "corriendo":
                    continue
            indice = os.path.join(EVIDENCIA, "index.json")
            actual = json.load(open(indice)).get("run_id") if os.path.exists(indice) else None
            lista = json.loads(gh("run", "list", "--repo", REPO, "--workflow", WORKFLOW,
                                  "--status", "success", "--limit", "1", "--json", "databaseId"))
            if lista and str(lista[0]["databaseId"]) != str(actual):
                importar()
        except Exception:
            pass


def vigilar(run_id, epica):
    while True:
        time.sleep(12)
        try:
            datos = json.loads(gh("run", "view", str(run_id), "--repo", REPO, "--json", "status,conclusion"))
        except Exception as e:  # noqa: BLE001
            with candado:
                estado.update(estado="fallido", mensaje=str(e)[:200])
            return
        if datos.get("status") != "completed":
            continue
        if datos.get("conclusion") != "success":
            with candado:
                estado.update(estado="fallido", mensaje=f"la corrida terminó {datos.get('conclusion')}")
            return
        try:
            n = publicar(run_id, epica)
            with candado:
                estado.update(estado="listo", mensaje=f"{n} video(s) publicados")
        except Exception as e:  # noqa: BLE001
            with candado:
                estado.update(estado="fallido", mensaje=str(e)[:200])
        return


class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        origen = self.headers.get("Origin", "")
        if origen in ORIGENES:
            self.send_header("Access-Control-Allow-Origin", origen)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "content-type")

    def _json(self, codigo, datos):
        cuerpo = json.dumps(datos).encode()
        self.send_response(codigo)
        self._cors()
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(cuerpo)))
        self.end_headers()
        self.wfile.write(cuerpo)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        if self.path.split("?")[0] == "/manifiesto":
            try:
                self._json(200, json.load(open(os.path.join(EVIDENCIA, "index.json"))))
            except Exception:
                self._json(404, {"mensaje": "todavía no hay evidencia publicada"})
            return
        if self.path.split("?")[0] == "/estado":
            with candado:
                self._json(200, dict(estado))
            return
        self._json(404, {"mensaje": "no existe"})

    def do_POST(self):
        if self.path.split("?")[0] == "/importar":
            try:
                self._json(200, importar())
            except Exception as e:  # noqa: BLE001
                self._json(502, {"mensaje": str(e)[:200]})
            return
        if self.path.split("?")[0] != "/correr":
            self._json(404, {"mensaje": "no existe"})
            return
        largo = int(self.headers.get("content-length") or 0)
        try:
            cuerpo = json.loads(self.rfile.read(largo) or b"{}")
        except json.JSONDecodeError:
            self._json(400, {"mensaje": "cuerpo inválido"})
            return
        epica = str(cuerpo.get("epica", ""))
        if not re.fullmatch(r"MSF-\d+", epica):
            self._json(400, {"mensaje": "epica inválida"})
            return
        with candado:
            if estado["estado"] == "corriendo":
                self._json(409, {"mensaje": "ya hay una corrida en curso"})
                return
            estado.update(estado="corriendo", epica=epica, run_id=None, mensaje=None)
        try:
            gh("workflow", "run", WORKFLOW, "--repo", REPO, "--ref", "main", "-f", "e2e_sesion=true",
               "-f", "e2e_record=true", "-f", f"e2e_grep={epica}")
            time.sleep(8)
            lista = json.loads(gh("run", "list", "--repo", REPO, "--workflow", WORKFLOW, "--event", "workflow_dispatch",
                                  "--limit", "1", "--json", "databaseId"))
            run_id = lista[0]["databaseId"]
            with candado:
                estado.update(run_id=run_id)
            threading.Thread(target=vigilar, args=(run_id, epica), daemon=True).start()
            self._json(202, dict(estado))
        except Exception as e:  # noqa: BLE001
            with candado:
                estado.update(estado="fallido", mensaje=str(e)[:200])
            self._json(502, dict(estado))

    def log_message(self, formato, *args):
        print(time.strftime("%H:%M:%S"), formato % args, flush=True)


if __name__ == "__main__":
    print("runner e2e en 0.0.0.0:9328", flush=True)
    threading.Thread(target=vigilar_nuevas, daemon=True).start()
    ThreadingHTTPServer(("0.0.0.0", 9328), Handler).serve_forever()
