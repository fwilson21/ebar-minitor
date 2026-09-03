import { useEffect, useRef, useState } from 'react';

interface Props {
  /** Cuántas fotos más se pueden tomar en esta sesión — el disparador se apaga solo al llegar acá. */
  maxFotos: number;
  onCapturar: (blob: Blob) => void;
  onCerrar: () => void;
  /** Nombre del subtema al que pertenecen las fotos (ej. "Variadores de frecuencia", "Bomba 2"). Se muestra en el aviso de confirmación. */
  etiquetaSeccion?: string;
  /** Fotos que ese subtema YA tenía al abrir la cámara — para numerar el aviso ("Foto 2 de 3"). */
  fotosPrevias?: number;
  /** Tope total de fotos del subtema (ej. 3). Si se pasa, el aviso dice "de N". */
  totalMax?: number;
}

/**
 * Cámara en vivo DENTRO de la propia app (getUserMedia + canvas), en vez de abrir la app de
 * Cámara nativa del celular con `<input capture>`.
 *
 * Por qué getUserMedia y no `<input capture>`:
 *  1. En un Xiaomi de 4GB de RAM con HyperOS, la app se cerraba de golpe con la cámara NATIVA
 *     todavía abierta (Android mataba la pestaña de fondo por presión de memoria de la propia
 *     app de Cámara). `getUserMedia` usa la canalización de VIDEO (la de una videollamada),
 *     pensada de entrada para pesar poco.
 *  2. **`<input capture>` deja elegir de la GALERÍA en varios celulares (iPhone siempre).** La
 *     cámara en vivo no: solo captura lo que ve el sensor en ese momento — no hay forma de
 *     adjuntar una foto vieja. Las fotos de las visitas tienen que ser del momento y del lugar.
 *
 * Si la cámara no abre (permiso denegado, hardware ocupado, navegador sin soporte), se muestra
 * un aviso para reintentar — **ya no hay respaldo a `<input file>`**, justo para no reabrir la
 * puerta a la galería.
 */
export function CamaraFoto({
  maxFotos,
  onCapturar,
  onCerrar,
  etiquetaSeccion,
  fotosPrevias = 0,
  totalMax,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [listo, setListo] = useState(false);
  const [error, setError] = useState(false);
  // Sube con cada "Reintentar" para volver a correr el efecto que pide la cámara.
  const [intento, setIntento] = useState(0);
  const [tomadas, setTomadas] = useState(0);
  // Espejo de `tomadas` para leer el conteo exacto dentro del callback async de toBlob (dos
  // disparos muy seguidos leerían el mismo valor viejo del estado y numerarían las dos "Foto 1").
  const tomadasRef = useRef(0);
  // Fotos que el subtema ya tenía cuando se abrió la cámara — congelado (el padre vuelve a
  // renderizar con un valor más alto cada vez que se agrega una foto, y acá se necesita el de
  // partida para numerar bien el aviso).
  const [fotosAlAbrir] = useState(fotosPrevias);
  // Aviso "✓ Foto N de M tomada" que aparece pegado a cada disparo — antes de esto solo cambiaba
  // el número entre paréntesis en "Listo", que pasaba desapercibido; el operador no tenía ninguna
  // señal clara de que la foto sí se había tomado. El texto se mantiene montado (no se borra al
  // ocultarlo) para que la transición de opacidad haga su fundido de salida.
  const [avisoTexto, setAvisoTexto] = useState('');
  const [avisoVisible, setAvisoVisible] = useState(false);
  const timeoutAvisoRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelado = false;
    setError(false);
    setListo(false);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError(true);
      return;
    }
    navigator.mediaDevices
      .getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1600 }, height: { ideal: 1600 } },
        audio: false,
      })
      .then((stream) => {
        if (cancelado) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        setListo(true);
      })
      .catch(() => {
        if (!cancelado) setError(true);
      });
    return () => {
      cancelado = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      if (timeoutAvisoRef.current) window.clearTimeout(timeoutAvisoRef.current);
    };
  }, [intento]);

  function disparar() {
    const video = videoRef.current;
    // videoWidth/videoHeight siguen en 0 hasta que el video carga sus metadatos, un instante
    // después de que el stream ya está listo — sin este chequeo, un toque muy rápido en el
    // disparador podía generar un canvas de 0x0.
    if (!video || tomadasRef.current >= maxFotos || !video.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (blob) {
          onCapturar(blob);
          tomadasRef.current += 1;
          setTomadas(tomadasRef.current);
          const numeroFoto = fotosAlAbrir + tomadasRef.current;
          const deTotal = totalMax ? ` de ${totalMax}` : '';
          setAvisoTexto(`✓ Foto ${numeroFoto}${deTotal} tomada`);
          setAvisoVisible(true);
          if (timeoutAvisoRef.current) window.clearTimeout(timeoutAvisoRef.current);
          timeoutAvisoRef.current = window.setTimeout(() => setAvisoVisible(false), 2200);
        }
      },
      'image/jpeg',
      0.9,
    );
  }

  function cerrar() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    onCerrar();
  }

  const limiteAlcanzado = tomadas >= maxFotos;

  if (error) {
    return (
      <div className="fixed inset-0 z-50 bg-black/95 flex flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-4xl">📷</p>
        <p className="text-white text-sm max-w-xs">
          No se pudo abrir la cámara. Toca <strong>Reintentar</strong> y permite el acceso a la
          cámara cuando el navegador lo pida. Si ya lo permitiste, revisa que ninguna otra app la
          esté usando.
        </p>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => setIntento((n) => n + 1)}
            className="bg-white text-slate-900 font-semibold rounded-lg px-4 py-2 text-sm"
          >
            Reintentar
          </button>
          <button type="button" onClick={onCerrar} className="text-white text-sm px-4 py-2">
            Cerrar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      <video ref={videoRef} autoPlay playsInline muted className="flex-1 w-full h-full object-cover" />
      {!listo && <p className="absolute inset-0 flex items-center justify-center text-white text-sm">Abriendo cámara…</p>}

      {/* Aviso de éxito pegado al disparo — ver comentario en el estado `aviso` de arriba. */}
      <div
        aria-live="polite"
        className={`absolute inset-x-0 top-8 flex justify-center px-4 pointer-events-none transition-opacity duration-300 ${
          avisoVisible ? 'opacity-100' : 'opacity-0'
        }`}
      >
        {avisoTexto && (
          <div className="flex flex-col items-center gap-0.5 bg-gauge-ok/95 text-white px-6 py-3 rounded-2xl shadow-xl text-center">
            <span className="text-lg font-bold leading-tight">{avisoTexto}</span>
            {etiquetaSeccion && (
              <span className="text-sm font-medium opacity-90 leading-tight">{etiquetaSeccion}</span>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between px-6 py-5 bg-black/85">
        <button type="button" onClick={cerrar} className="text-white text-sm px-3 py-2">
          ✕ Cancelar
        </button>
        <button
          type="button"
          onClick={disparar}
          disabled={!listo || limiteAlcanzado}
          aria-label="Tomar foto"
          className="w-16 h-16 rounded-full bg-white border-4 border-slate-300 disabled:opacity-40 active:scale-95 transition"
        />
        <button type="button" onClick={cerrar} className="text-white text-sm px-3 py-2 min-w-[72px] text-right">
          Listo
          {totalMax ? ` (${fotosAlAbrir + tomadas}/${totalMax})` : tomadas > 0 ? ` (${tomadas})` : ''}
        </button>
      </div>
    </div>
  );
}
