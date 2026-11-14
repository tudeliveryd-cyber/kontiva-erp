import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../lib/api';
import { Cajon, Campo, ErrorApi } from './ui';

/**
 * Un supervisor autoriza con su PIN sin cerrar la sesión del cajero.
 * Devuelve el token de autorización (2 minutos, un solo permiso) para el encabezado X-Autorizacion.
 */
export function DialogoAutorizacion({ permiso, titulo, alAutorizar, alCerrar }: { permiso: string; titulo: string; alAutorizar: (token: string, nombre: string) => void; alCerrar: () => void }) {
  const lista = useQuery({ queryKey: ['autorizadores', permiso], queryFn: () => api<{ id: string; nombre: string }[]>(`/autorizadores?permiso=${permiso}`) });
  const [usuarioId, setUsuarioId] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<unknown>(null);
  const elegido = usuarioId || lista.data?.[0]?.id || '';

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const r = await api<{ autorizacion: string; autorizadoPor: { nombre: string } }>('/autorizaciones', { metodo: 'POST', cuerpo: { usuarioId: elegido, pin, permiso } });
      alAutorizar(r.autorizacion, r.autorizadoPor.nombre);
    } catch (err) {
      setError(err);
      setPin('');
    }
  };

  return (
    <Cajon titulo={titulo} alCerrar={alCerrar}>
      <form className="form" onSubmit={enviar}>
        <p className="tenue" style={{ margin: 0 }}>
          Un supervisor ingresa su PIN en este equipo. La sesión del cajero no se cierra y queda registrado quién autorizó.
        </p>
        <ErrorApi error={error} />
        {lista.data?.length === 0 ? (
          <p>Nadie con este permiso tiene PIN definido. El supervisor debe definirlo en "Mi cuenta".</p>
        ) : (
          <>
            <Campo etiqueta="Supervisor" id="sup">
              <select id="sup" className="entrada" value={elegido} onChange={(e) => setUsuarioId(e.target.value)}>
                {lista.data?.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.nombre}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo etiqueta="PIN" id="pinsup">
              <input id="pinsup" className="entrada num" type="password" inputMode="numeric" maxLength={6} autoFocus autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value.replace(/[^0-9]/g, ''))} />
            </Campo>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn pri" disabled={pin.length < 4 || !elegido}>
                Autorizar
              </button>
              <button type="button" className="btn" onClick={alCerrar}>
                Cancelar
              </button>
            </div>
          </>
        )}
      </form>
    </Cajon>
  );
}
