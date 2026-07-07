import { useLayoutEffect, useRef } from 'react';

/**
 * Ajusta automáticamente la altura de un <textarea> al contenido (crece con el texto,
 * sin scroll interno ni tirador de resize manual). Se re-ejecuta cada vez que cambia `valor`.
 */
export function useAutoResizeTextarea(valor: string) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [valor]);

  return ref;
}
