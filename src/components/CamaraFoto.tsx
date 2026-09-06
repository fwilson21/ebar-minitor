import { useEffect, useRef, useState } from 'react';

interface Props {
  /** Cuántas fotos más se pueden tomar en esta sesión — el disparador se apaga solo al llegar acá. */
  maxFotos: number;
  /** `dispositivoEnHorizontal` es cómo estaba físicamente el celular AL MOMENTO de disparar (leído
   * en ese instante, no después) — lo necesita `crearFotoLocal`/`estamparFechaEnFoto` para saber si
   * un cuadro más ancho que alto es una foto horizontal a propósito o el bug de sensor de siempre. */
  onCapturar: (blob: Blob, dispositivoEnHorizontal: boolean) => void;
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
  // DIAGNÓSTICO temporal (2026-09-06): el arreglo de la 7ma vuelta del bug de fotos horizontales
  // no alcanzó (el usuario lo confirmó con una foto de prueba real en Android). En vez de adivinar
  // una 8va vez sin poder probar en el celular, se muestra el tamaño REAL que entrega la cámara
  // (`video.videoWidth x videoHeight`) al lado del indicador de orientación — mandando una captura
  // de esto (parado y de costado) se puede ver si el cuadro que entrega la cámara cambia de forma
  // al girar el celular o se queda siempre igual, que es la pregunta clave para el próximo arreglo.
  const [tamanoVideo, setTamanoVideo] = useState<{ w: number; h: number } | null>(null);

  // Orientación FÍSICA del celular al momento del disparo, leída del acelerómetro — NO de
  // matchMedia('(orientation: landscape)') ni screen.orientation, que devuelven "vertical" cuando el
  // operador tiene el giro de pantalla bloqueado (lo habitual) aunque tenga el celular de costado.
  // Ese era el motivo de que las fotos tomadas a propósito en horizontal salieran giradas de lado en
  // el informe. `null` mientras no haya lectura clara (sin sensor, permiso denegado en iPhone, o
  // celular casi plano) → en `disparar` se cae al chequeo viejo de matchMedia (o al interruptor
  // manual de abajo, si el sensor nunca respondió).
  const orientacionFisicaRef = useRef<'vertical' | 'horizontal' | null>(null);
  // Reportado de nuevo (2026-09-06, Android) después del arreglo del acelerómetro — así que ahora
  // se ve EN PANTALLA en vivo, para poder confirmar de un vistazo si el sensor está leyendo bien
  // en vez de esperar a revisar el informe ya generado.
  const [orientacionVisible, setOrientacionVisible] = useState<'vertical' | 'horizontal' | null>(null);
  // Últimas clasificaciones (ignorando lecturas ambiguas cerca de los 45°) — se exige que se
  // repita para confirmar, en vez de fiarse de una sola lectura suelta que puede ser ruido del
  // sensor (más robusto que la zona muerta de una sola muestra que usaba la vuelta anterior).
  const historialRef = useRef<Array<'vertical' | 'horizontal'>>([]);
  // Si a los 1.5s de haber arrancado el sensor todavía no llegó NINGUNA lectura (permiso denegado
  // sin avisar, navegador sin soporte, o el celular no lo expone) el acelerómetro no sirve en este
  // dispositivo — se muestra un interruptor manual de respaldo en vez de quedarse con el chequeo
  // viejo de matchMedia (que es el que originó el bug).
  const [sensorSinRespuesta, setSensorSinRespuesta] = useState(false);
  const [horizontalManual, setHorizontalManual] = useState(false);

  useEffect(() => {
    let activo = true;
    let huboLectura = false;
    function alMover(e: DeviceMotionEvent) {
      const g = e.accelerationIncludingGravity;
      if (!g || g.x == null || g.y == null) return;
      huboLectura = true;
      // Si la gravedad tira más sobre el eje X del dispositivo que sobre el Y, está acostado de
      // lado. Se ignoran lecturas ambiguas (diferencia chica, cerca de los 45°) en vez de forzar
      // una clasificación con poco margen.
      const diff = Math.abs(g.x) - Math.abs(g.y);
      if (Math.abs(diff) < 1.5) return;
      const clasificacion = diff > 0 ? 'horizontal' : 'vertical';
      const historial = historialRef.current;
      historial.push(clasificacion);
      if (historial.length > 5) historial.shift();
      // Recién se da por buena una orientación cuando la mayoría de las últimas lecturas coincide
      // — filtra el ruido de una lectura suelta rara (temblor de la mano, golpe al tocar la
      // pantalla) sin depender de acertarle a un único número de zona muerta.
      const horizontales = historial.filter((h) => h === 'horizontal').length;
      const nueva: 'vertical' | 'horizontal' = horizontales > historial.length / 2 ? 'horizontal' : 'vertical';
      if (orientacionFisicaRef.current !== nueva) {
        orientacionFisicaRef.current = nueva;
        setOrientacionVisible(nueva);
      }
    }
    async function iniciar() {
      if (!('DeviceMotionEvent' in window)) {
        setSensorSinRespuesta(true);
        return;
      }
      try {
        const DME = window.DeviceMotionEvent as unknown as { requestPermission?: () => Promise<string> };
        if (DME && typeof DME.requestPermission === 'function') {
          // iPhone: pide permiso una vez (el `setCamaraAbierta(true)` que montó este componente
          // fue un toque del operador, así que todavía estamos dentro de la ventana de gesto).
          const permiso = await DME.requestPermission();
          if (permiso !== 'granted' || !activo) {
            if (activo) setSensorSinRespuesta(true);
            return;
          }
        }
        window.addEventListener('devicemotion', alMover);
      } catch {
        if (activo) setSensorSinRespuesta(true);
      }
    }
    iniciar();
    const timeoutSinRespuesta = window.setTimeout(() => {
      if (activo && !huboLectura) setSensorSinRespuesta(true);
    }, 1500);
    return () => {
      activo = false;
      window.clearTimeout(timeoutSinRespuesta);
      window.removeEventListener('devicemotion', alMover);
    };
  }, []);

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

  // Diagnóstico temporal (ver tamanoVideo): además de leerlo una vez con onLoadedMetadata, se
  // vuelve a chequear cada rato mientras la cámara está abierta — por si el navegador cambia el
  // tamaño del cuadro dinámicamente al girar el celular (algo que `onLoadedMetadata` solo no
  // alcanzaría a mostrar, porque dispara una sola vez al arrancar el video).
  useEffect(() => {
    if (!listo) return;
    const intervalo = window.setInterval(() => {
      const v = videoRef.current;
      if (!v || !v.videoWidth) return;
      setTamanoVideo((prev) => (prev && prev.w === v.videoWidth && prev.h === v.videoHeight ? prev : { w: v.videoWidth, h: v.videoHeight }));
    }, 400);
    return () => window.clearInterval(intervalo);
  }, [listo]);

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
    // Se lee justo acá, en el instante del disparo — no en `onCapturar` ni más tarde, porque el
    // operador puede seguir moviendo el celular después de tocar el botón. Orden: acelerómetro (si
    // dio una lectura confiable) → interruptor manual (solo aparece si el sensor nunca respondió,
    // ver `sensorSinRespuesta`) → el fallback viejo de matchMedia como última red, por si el
    // interruptor manual todavía no se pintó en pantalla en este primer instante.
    const dispositivoEnHorizontal =
      orientacionFisicaRef.current !== null
        ? orientacionFisicaRef.current === 'horizontal'
        : sensorSinRespuesta
          ? horizontalManual
          : window.matchMedia('(orientation: landscape)').matches;
    canvas.toBlob(
      (blob) => {
        if (blob) {
          onCapturar(blob, dispositivoEnHorizontal);
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
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        onLoadedMetadata={(e) => {
          const v = e.currentTarget;
          setTamanoVideo({ w: v.videoWidth, h: v.videoHeight });
        }}
        className="flex-1 w-full h-full object-cover"
      />
      {!listo && <p className="absolute inset-0 flex items-center justify-center text-white text-sm">Abriendo cámara…</p>}

      {/* Orientación detectada por el sensor, EN VIVO — para poder confirmar de un vistazo (girando
          el celular) que la app se está dando cuenta bien, en vez de enterarse recién al ver el
          informe generado. Si el sensor nunca respondió (ver sensorSinRespuesta), en su lugar sale
          un interruptor para avisar a mano. El tamaño del cuadro (ancho x alto) es diagnóstico
          temporal (ver comentario en tamanoVideo) — se puede sacar una vez resuelto el bug. */}
      {listo && !sensorSinRespuesta && orientacionVisible && (
        // Con el celular de costado, el badge ENTERO gira 90° con él — así el texto se lee derecho
        // desde el punto de vista de la persona que tiene el celular horizontal (la pantalla no
        // gira sola porque el giro automático está bloqueado; sin esto, el texto quedaba de
        // costado justo cuando más hace falta leerlo).
        // Posición: el usuario mandó una captura mostrando que, ANCLADO abajo a la izquierda en
        // este mismo código (`bottom-8 left-3`), el badge terminaba apareciendo abajo a la
        // DERECHA en la pantalla ya girada — la pantalla entera se reacomoda como una unidad al
        // girar el celular (no solo el contenido), así que "abajo a la izquierda" en el código no
        // es "abajo a la izquierda" en la pantalla ya girada. Con ese dato: para terminar abajo a
        // la izquierda en pantalla, hay que anclarlo arriba a la izquierda en el código (mismo
        // `top-3` que ya usa en vertical) — no hace falta una posición aparte para cada caso.
        <div
          className={`absolute top-3 left-3 bg-black/60 text-white text-xs px-2.5 py-1.5 rounded-full flex items-center gap-1.5 transition-transform ${
            orientacionVisible === 'horizontal' ? 'rotate-90' : ''
          }`}
        >
          <span className="inline-block">📱</span>
          {orientacionVisible === 'horizontal' ? 'Horizontal' : 'Vertical'}
          {tamanoVideo && <span className="opacity-70">· {tamanoVideo.w}×{tamanoVideo.h}</span>}
        </div>
      )}
      {listo && sensorSinRespuesta && (
        <button
          type="button"
          onClick={() => setHorizontalManual((v) => !v)}
          className={`absolute top-3 left-3 text-xs px-3 py-1.5 rounded-full font-medium ${
            horizontalManual ? 'bg-gauge-warn text-white' : 'bg-black/60 text-white'
          }`}
        >
          {horizontalManual ? '📱 Foto de costado ✓' : 'Toco de costado esta foto'}
        </button>
      )}

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
