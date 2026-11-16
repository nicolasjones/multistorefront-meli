// ZIP en streaming con fflate: cada trozo comprimido se escribe a un archivo temporal apenas se produce, así
// un conjunto grande nunca vive entero en memoria. El archivo temporal se sube de una vez al bucket y se borra.
import { closeSync, openSync, rmSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Zip, ZipDeflate } from 'fflate';

export const TOPE_BYTES = 200 * 1024 * 1024;

export class TopeExcedido extends Error {
  constructor() {
    super('TOPE_EXCEDIDO');
    this.name = 'TopeExcedido';
  }
}

export interface EntradaZip {
  escribir(texto: string): void;
  terminar(): void;
}

export interface ArchivoZip {
  ruta: string;
  bytes: number;
}

/** Escritor de ZIP: entradas una tras otra; `cerrar` deja el archivo listo para subir, `descartar` lo borra. */
export interface EscritorZip {
  abrirEntrada(nombre: string): EntradaZip;
  cerrar(): ArchivoZip;
  descartar(): void;
}

export function crearEscritorZip(opciones: { directorio?: string; topeBytes?: number } = {}): EscritorZip {
  const ruta = join(opciones.directorio ?? tmpdir(), `exportacion-${randomUUID()}.zip`);
  const tope = opciones.topeBytes ?? TOPE_BYTES;
  const fd = openSync(ruta, 'w');
  let bytes = 0;
  let cerrado = false;
  let falla: Error | null = null;

  const zip = new Zip((error, trozo) => {
    if (error) {
      falla = error;
      return;
    }
    bytes += trozo.length;
    if (bytes > tope) falla = new TopeExcedido();
    else if (!falla) writeSync(fd, trozo);
  });

  const revisar = () => {
    if (falla) throw falla;
  };
  const liberar = () => {
    if (cerrado) return;
    cerrado = true;
    closeSync(fd);
  };

  return {
    abrirEntrada(nombre) {
      revisar();
      const archivo = new ZipDeflate(nombre, { level: 6 });
      zip.add(archivo);
      const codificador = new TextEncoder();
      return {
        escribir(texto) {
          archivo.push(codificador.encode(texto), false);
          revisar();
        },
        terminar() {
          archivo.push(new Uint8Array(0), true);
          revisar();
        },
      };
    },
    cerrar() {
      try {
        zip.end();
        revisar();
      } catch (error) {
        liberar();
        rmSync(ruta, { force: true });
        throw error;
      }
      liberar();
      return { ruta, bytes };
    },
    descartar() {
      liberar();
      rmSync(ruta, { force: true });
    },
  };
}
