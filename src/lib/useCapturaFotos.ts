import { useRef, useState } from 'react';
import { crearFotoLocal } from './fotos';
import type { FotoLocal } from './types';

/**
 * Lógica compartida de "tomar fotos con la cámara en vivo, hasta un tope" — antes repetida (cada
 * una con su propia copia) en PhotoCapture.tsx, EquipoSection.tsx y PumpForm.tsx. El usuario
 * reportó (2026-09-08, con un iPhone) un informe con capítulos que tenían observaciones pero
 * NINGUNA foto pese a haberlas tomado, y otro capítulo ("Líneas de impulsión") con 4 fotos aunque
 * el tope es 3. Las 3 copias tenían el mismo par de bugs de carrera:
 *
 *   1. `crearFotoLocal` (estampa fecha/hora sobre la imagen) es async y no es instantáneo. Si el
 *      operador dispara 2 fotos seguidas antes de que la primera termine de procesarse, ambas
 *      leían `valorRef.current.fotos`/`fotosRef.current` con el MISMO valor viejo (React todavía
 *      no había vuelto a renderizar con el resultado de la primera) — el `onChange` de la segunda
 *      pisaba al de la primera y una foto se perdía en silencio.
 *   2. Si el operador reabría la cámara ("📷 Tomar foto" de nuevo) antes de que ese primer
 *      `onChange` llegara a reflejarse en el render, el cupo (`MAX_FOTOS - fotos.length`) se
 *      recalculaba con un conteo atrasado y dejaba tomar una foto de más.
 *
 * Este hook corrige ambos, sin depender de que React ya haya vuelto a renderizar:
 *   - Acumula en una `ref` local (`fotosSesionRef`), actualizada de forma síncrona apenas resuelve
 *     cada captura — no en el próximo render.
 *   - Cuenta las capturas todavía procesándose (`capturasPendientes`) y expone eso para que quien
 *     use el hook oculte/deshabilite "Tomar foto" mientras haya alguna en curso, así no se puede
 *     reabrir la cámara con un conteo que todavía no terminó de acomodarse.
 */
export function useCapturaFotos(max: number) {
  const [camaraAbierta, setCamaraAbierta] = useState(false);
  const [cupoCamara, setCupoCamara] = useState(0);
  const [capturasPendientes, setCapturasPendientes] = useState(0);
  // Punto de partida de la sesión de cámara actual — se fija al abrir (con las fotos que había en
  // ESE momento) y cada captura se suma acá apenas termina de procesarse.
  const fotosSesionRef = useRef<FotoLocal[]>([]);

  function abrirCamara(fotosActuales: FotoLocal[]) {
    fotosSesionRef.current = fotosActuales;
    setCupoCamara(max - fotosActuales.length);
    setCamaraAbierta(true);
  }

  /** Procesa una captura de `CamaraFoto` y devuelve el array de fotos ya actualizado — quien llama
   * solo tiene que pasárselo a su `onChange` (armando el resto del objeto si hace falta, con
   * `valorRef.current` propio para no perder otros campos que el operador haya tocado mientras
   * tanto). */
  async function agregarFoto(blob: Blob, dispositivoEnHorizontal: boolean): Promise<FotoLocal[]> {
    setCapturasPendientes((n) => n + 1);
    try {
      const nueva = await crearFotoLocal(blob, new Date().toISOString(), dispositivoEnHorizontal);
      fotosSesionRef.current = [...fotosSesionRef.current, nueva];
      return fotosSesionRef.current;
    } finally {
      setCapturasPendientes((n) => n - 1);
    }
  }

  return { camaraAbierta, setCamaraAbierta, cupoCamara, capturasPendientes, abrirCamara, agregarFoto };
}
