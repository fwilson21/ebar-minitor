import { supabase } from './supabase';

type EventoRealtime = 'INSERT' | 'UPDATE' | 'DELETE' | '*';

interface SuscripcionOptions {
  channelName: string;
  table: string;
  callback: () => void;
  filter?: string;
  events?: EventoRealtime[];
}

export function suscribirseCambios({
  channelName,
  table,
  callback,
  filter,
  events = ['INSERT', 'UPDATE', 'DELETE'],
}: SuscripcionOptions) {
  const channel = supabase.channel(channelName);

  for (const event of events) {
    channel.on(
      'postgres_changes',
      { event, schema: 'public', table, filter },
      () => callback()
    );
  }

  channel.subscribe((status) => {
    if (status !== 'SUBSCRIBED') {
      console.warn(`No se pudo suscribir a ${channelName}: ${status}`);
    }
  });

  return () => {
    supabase.removeChannel(channel);
  };
}
