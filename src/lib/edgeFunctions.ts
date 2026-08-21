// Ayuda para mostrar el motivo REAL cuando falla una Edge Function.
//
// supabase-js, cuando la función devuelve un status distinto de 2xx, arma un FunctionsHttpError
// cuyo `.message` es SIEMPRE el mismo texto genérico ("Edge Function returned a non-2xx status
// code") sin importar qué mensaje específico haya devuelto la función — el cuerpo real de la
// respuesta (nuestro `{ error: "..." }`) queda sin leer en `error.context` (el Response crudo).
// Sin esto, cualquier error de una Edge Function (usuario desactivado, sin permisos, dato
// inválido, lo que sea) se ve igual en pantalla ("Edge Function returned a non-2xx status code")
// y no dice nada útil para diagnosticar qué pasó realmente.
export async function mensajeErrorFuncion(error: unknown): Promise<string> {
  if (error && typeof error === 'object' && 'context' in error) {
    const contexto = (error as { context?: unknown }).context;
    if (contexto instanceof Response) {
      try {
        const cuerpo = await contexto.clone().json();
        if (cuerpo?.error) return String(cuerpo.error);
      } catch {
        // el cuerpo no era JSON — se sigue abajo con el mensaje genérico
      }
    }
  }
  return error instanceof Error ? error.message : String(error);
}
