// @ts-nocheck
// Service worker escrito a mano (en vez de generado automático) para poder agregar el listener
// de Background Sync — necesario para que las visitas guardadas sin señal se sincronicen solas
// en Android sin que el operador tenga que abrir la app. El resto (cachear el "cascarón" de la
// app para que abra sin señal) se arma igual que antes con Workbox, solo que ahora a mano.
/// <reference lib="webworker" />

import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from 'workbox-precaching';
import { registerRoute, NavigationRoute } from 'workbox-routing';
import { leerSesionEspejo, guardarSesionEspejo } from './lib/offlineDB';
import { ejecutarSincronizacion, type AdaptadorSync } from './lib/syncMotor';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './lib/supabaseConfig';

const TAG_SINCRONIZACION = 'sync-visitas';

self.skipWaiting();
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html')));

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('sync', (event) => {
  if (event.tag === TAG_SINCRONIZACION) {
    event.waitUntil(sincronizarEnSegundoPlano());
  }
});

async function avisarClientes(mensaje: Record<string, unknown>) {
  const clientes = await self.clients.matchAll();
  for (const cliente of clientes) cliente.postMessage(mensaje);
}

async function sincronizarEnSegundoPlano() {
  const { ok, fallidas } = await ejecutarSincronizacion(adaptadorFetch);
  await avisarClientes({ tipo: 'sync-completado', ok, fallidas });
  // Si quedó algo sin poder sincronizar (probablemente porque la señal se cortó de nuevo a mitad
  // de camino), se rechaza la promesa a propósito: es la señal que espera Background Sync para
  // programar un nuevo intento más adelante en vez de darlo por perdido.
  if (fallidas > 0) throw new Error(`${fallidas} visita(s) no se pudieron sincronizar en segundo plano`);
}

// ----------------------------------------------------------------------------
// Adaptador de sincronización basado en fetch crudo (en vez del cliente supabase-js que usa el
// hilo principal): el service worker no tiene acceso a localStorage, donde vive la sesión normal,
// así que usa la copia espejada en IndexedDB (ver AuthContext.tsx) y refresca el token él mismo
// si ya venció.
// ----------------------------------------------------------------------------

async function obtenerTokenValido(): Promise<string> {
  const sesion = await leerSesionEspejo();
  if (!sesion) throw new Error('No hay una sesión guardada para sincronizar en segundo plano.');

  const ahoraSegundos = Math.floor(Date.now() / 1000);
  if (sesion.expires_at && sesion.expires_at > ahoraSegundos + 30) {
    return sesion.access_token;
  }
  return refrescarToken(sesion.refresh_token);
}

async function refrescarToken(refreshToken: string): Promise<string> {
  const resp = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  const datos = await resp.json();
  if (!resp.ok || !datos.access_token) {
    throw new Error('No se pudo renovar la sesión para sincronizar en segundo plano.');
  }

  await guardarSesionEspejo({
    access_token: datos.access_token,
    refresh_token: datos.refresh_token,
    expires_at: Math.floor(Date.now() / 1000) + (datos.expires_in ?? 3600),
  });
  // El hilo principal (si la app está abierta) también debe enterarse del token nuevo, para que
  // supabase-js no siga usando uno vencido ni intente refrescarlo por su cuenta al mismo tiempo.
  await avisarClientes({ tipo: 'sesion-renovada', access_token: datos.access_token, refresh_token: datos.refresh_token });

  return datos.access_token;
}

async function llamarREST(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await obtenerTokenValido();
  const resp = await fetch(`${SUPABASE_URL}${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });
  if (!resp.ok) {
    const texto = await resp.text().catch(() => '');
    throw new Error(`Error ${resp.status} en ${path}: ${texto}`);
  }
  return resp;
}

const adaptadorFetch: AdaptadorSync = {
  async upsertVisitaNueva(visita, clienteUuid) {
    const resp = await llamarREST(`/rest/v1/visitas?on_conflict=cliente_uuid`, {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify({ ...visita, cliente_uuid: clienteUuid }),
    });
    const filas = await resp.json();
    return filas[0].id;
  },

  async actualizarVisita(visitaId, visita) {
    await llamarREST(`/rest/v1/visitas?id=eq.${visitaId}`, {
      method: 'PATCH',
      body: JSON.stringify(visita),
    });
  },

  async upsertRegistrosBombas(registros) {
    await llamarREST(`/rest/v1/registros_bombas?on_conflict=visita_id,bomba_id`, {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify(registros),
    });
  },

  async borrarRegistrosBombasNoSeleccionados(visitaId, idsSeleccionados) {
    const filtroExcluir = idsSeleccionados.length ? `&bomba_id=not.in.(${idsSeleccionados.join(',')})` : '';
    await llamarREST(`/rest/v1/registros_bombas?visita_id=eq.${visitaId}${filtroExcluir}`, { method: 'DELETE' });
  },

  async subirFotoADrive(visitaId, { base64, contentType, descripcion }) {
    await llamarREST(`/functions/v1/upload-to-drive`, {
      method: 'POST',
      body: JSON.stringify({ visita_id: visitaId, file_base64: base64, content_type: contentType, descripcion }),
    });
  },
};
