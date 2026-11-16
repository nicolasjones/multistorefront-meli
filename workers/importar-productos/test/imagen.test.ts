import { describe, expect, it } from 'vitest';
import { detectarFormato, formatoDeNombre, rutaFinal, validarImagen } from '../src/imagen.js';

const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);

describe('blindaje de imágenes', () => {
  it('detecta el formato por los bytes, no por la extensión', () => {
    expect(detectarFormato(new Uint8Array([0xff, 0xd8, 0xff]))).toBe('jpg');
    expect(detectarFormato(WEBP)).toBe('webp');
    expect(detectarFormato(new TextEncoder().encode('GIF89a'))).toBeNull();
  });

  it('lee la extensión declarada', () => {
    expect(formatoDeNombre('a.JPEG')).toBe('jpg');
    expect(formatoDeNombre('a.svg')).toBeNull();
  });

  it('rechaza extensión no admitida, vacío, contenido ajeno y extensión que no coincide', () => {
    expect(validarImagen('a.svg', WEBP)).toMatch(/extensión/);
    expect(validarImagen('a.jpg', new Uint8Array())).toMatch(/vacío/);
    expect(validarImagen('a.jpg', new TextEncoder().encode('hola mundo'))).toMatch(/contenido/);
    expect(validarImagen('a.jpg', WEBP)).toMatch(/no coincide/);
    expect(validarImagen('a.webp', WEBP)).toBeNull();
  });

  it('la ruta final es determinista por nombre', () => {
    expect(rutaFinal('org', 'prod', 'Foto.JPG', 'jpg')).toBe(rutaFinal('org', 'prod', 'foto.jpg', 'jpg'));
    expect(rutaFinal('org', 'prod', 'a.jpg', 'jpg')).toMatch(/^org\/prod\/imp-[0-9a-f]{12}\.jpg$/);
  });
});
