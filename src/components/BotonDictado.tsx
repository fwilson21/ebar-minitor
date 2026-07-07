import { useRef, useState } from 'react';

interface Props {
  valorActual: string;
  onTexto: (nuevoValor: string) => void;
}

const SpeechRecognitionCtor: any =
  typeof window !== 'undefined' ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition : undefined;

function capitalizar(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/**
 * Botón de dictado por voz (Web Speech API). Solo funciona en navegadores que la
 * soportan (Chrome) y requiere conexión a internet (el audio se procesa en los
 * servidores de Google) — no se muestra si el navegador no la soporta.
 */
export function BotonDictado({ valorActual, onTexto }: Props) {
  const [escuchando, setEscuchando] = useState(false);
  const recognitionRef = useRef<any>(null);

  if (!SpeechRecognitionCtor) return null;

  function alternar() {
    if (escuchando) {
      recognitionRef.current?.stop();
      return;
    }
    const recognition = new SpeechRecognitionCtor();
    recognition.lang = 'es-EC';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (e: any) => {
      const texto = Array.from(e.results as any)
        .map((r: any) => r[0].transcript)
        .join(' ')
        .trim();
      if (texto) {
        onTexto(valorActual.trim() ? `${valorActual.trim()} ${texto}` : capitalizar(texto));
      }
    };
    recognition.onerror = () => setEscuchando(false);
    recognition.onend = () => setEscuchando(false);
    recognitionRef.current = recognition;
    recognition.start();
    setEscuchando(true);
  }

  return (
    <button
      type="button"
      onClick={alternar}
      title="Llenar por voz"
      className={`absolute top-1.5 right-1.5 w-7 h-7 rounded-md border flex items-center justify-center transition ${
        escuchando
          ? 'bg-gauge-danger/15 border-gauge-danger text-gauge-danger animate-pulse'
          : 'bg-panel-900/80 border-panel-600 text-slate-300'
      }`}
    >
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
        <line x1="12" y1="19" x2="12" y2="23" />
        <line x1="8" y1="23" x2="16" y2="23" />
      </svg>
    </button>
  );
}
