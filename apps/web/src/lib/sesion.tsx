import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { fijarIdioma } from '../i18n/traductor';
import { alPerderSesion, api, fijarToken, renovarSesion, type Yo } from './api';

interface EstadoSesion {
  listo: boolean;
  yo: Yo | undefined;
  entrar: (accessToken: string) => Promise<void>;
  salir: () => Promise<void>;
  puede: (permiso: string) => boolean;
}

const Contexto = createContext<EstadoSesion | null>(null);

export function ProveedorSesion({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [autenticado, setAutenticado] = useState(false);
  const [listo, setListo] = useState(false);

  // Al abrir la app, intenta recuperar la sesión con la cookie de renovación.
  useEffect(() => {
    renovarSesion().then((ok) => {
      setAutenticado(ok);
      setListo(true);
    });
    alPerderSesion(() => {
      fijarToken(null);
      qc.clear();
      setAutenticado(false);
    });
  }, [qc]);

  const yo = useQuery({ queryKey: ['me'], queryFn: () => api<Yo>('/me'), enabled: autenticado, staleTime: 60_000 });

  const entrar = useCallback(
    async (token: string) => {
      fijarToken(token);
      qc.clear();
      setAutenticado(true);
      await qc.fetchQuery({ queryKey: ['me'], queryFn: () => api<Yo>('/me') });
    },
    [qc],
  );

  const salir = useCallback(async () => {
    await api('/auth/cerrar', { metodo: 'POST' }).catch(() => undefined);
    fijarToken(null);
    qc.clear();
    setAutenticado(false);
  }, [qc]);

  // El idioma elegido en la cuenta sigue a la persona en cualquier equipo.
  const idioma = yo.data?.usuario.idioma;
  useEffect(() => {
    if (idioma) fijarIdioma(idioma);
  }, [idioma]);

  const puede = useCallback((permiso: string) => Boolean(yo.data?.permisos[permiso]), [yo.data]);

  return (
    <Contexto.Provider value={{ listo: listo && (!autenticado || !yo.isLoading), yo: autenticado ? yo.data : undefined, entrar, salir, puede }}>
      {children}
    </Contexto.Provider>
  );
}

export function useSesion() {
  const c = useContext(Contexto);
  if (!c) throw new Error('useSesion fuera de ProveedorSesion');
  return c;
}
