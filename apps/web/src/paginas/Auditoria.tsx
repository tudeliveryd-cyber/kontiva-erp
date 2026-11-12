import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Fragment, useState } from 'react';
import { Cargando, Encabezado, ErrorApi, Vacio } from '../componentes/ui';
import { api, type EventoAuditoria, type UsuarioFila } from '../lib/api';
import { dispositivo, fechaHora, nombreAccion, nombreEntidad } from '../lib/formato';
import { useSesion } from '../lib/sesion';

export function Auditoria() {
  const { puede } = useSesion();
  const [filtro, setFiltro] = useState({ entidad: '', usuarioId: '', desde: '', hasta: '' });
  const [abierto, setAbierto] = useState<number | null>(null);
  const usuarios = useQuery({ queryKey: ['usuarios'], queryFn: () => api<UsuarioFila[]>('/usuarios'), enabled: puede('usuario.ver') });

  const q = useInfiniteQuery({
    queryKey: ['auditoria', filtro],
    initialPageParam: null as number | null,
    queryFn: ({ pageParam }) => {
      const p = new URLSearchParams({ limite: '50' });
      if (filtro.entidad) p.set('entidad', filtro.entidad);
      if (filtro.usuarioId) p.set('usuarioId', filtro.usuarioId);
      if (filtro.desde) p.set('desde', new Date(`${filtro.desde}T00:00:00-03:00`).toISOString());
      if (filtro.hasta) p.set('hasta', new Date(`${filtro.hasta}T23:59:59-03:00`).toISOString());
      if (pageParam) p.set('cursor', String(pageParam));
      return api<{ items: EventoAuditoria[]; siguiente: number | null }>(`/auditoria?${p}`);
    },
    getNextPageParam: (u) => u.siguiente,
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <>
      <Encabezado titulo="Auditoría" />
      <div className="contenido">
        <section className="panel">
          <div className="panel-cab">
            <h2>Registro de cambios</h2>
            <span className="sub">Inmutable: nadie puede editar ni borrar estos registros.</span>
          </div>
          <div className="filtros">
            <select className="entrada" value={filtro.entidad} onChange={(e) => setFiltro({ ...filtro, entidad: e.target.value })} aria-label="Entidad">
              <option value="">Todas las entidades</option>
              {['usuario', 'perfil', 'sucursal', 'empresa', 'sesion', 'permiso', 'cuenta'].map((x) => (
                <option key={x} value={x}>
                  {nombreEntidad(x)}
                </option>
              ))}
            </select>
            {usuarios.data && (
              <select className="entrada" value={filtro.usuarioId} onChange={(e) => setFiltro({ ...filtro, usuarioId: e.target.value })} aria-label="Usuario">
                <option value="">Todos los usuarios</option>
                {usuarios.data.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.nombre}
                  </option>
                ))}
              </select>
            )}
            <input type="date" className="entrada" value={filtro.desde} onChange={(e) => setFiltro({ ...filtro, desde: e.target.value })} aria-label="Desde" />
            <input type="date" className="entrada" value={filtro.hasta} onChange={(e) => setFiltro({ ...filtro, hasta: e.target.value })} aria-label="Hasta" />
          </div>
          {q.isLoading ? (
            <Cargando />
          ) : q.error ? (
            <div className="panel-cuerpo">
              <ErrorApi error={q.error} />
            </div>
          ) : items.length === 0 ? (
            <Vacio titulo="Sin registros para este filtro" />
          ) : (
            <div className="desplazar">
              <table>
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Usuario</th>
                    <th>Acción</th>
                    <th>Entidad</th>
                    <th>Origen</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((a) => (
                    <Fragment key={a.id}>
                      <tr className="clic" onClick={() => setAbierto(abierto === a.id ? null : a.id)}>
                        <td className="num peq">{fechaHora(a.fecha)}</td>
                        <td>{a.usuario?.nombre ?? <span className="tenue">Sistema</span>}</td>
                        <td>
                          {nombreAccion(a.accion)}
                          {a.autorizadoPor && <span className="tenue peq"> · autorizó {a.autorizadoPor.nombre}</span>}
                        </td>
                        <td className="tenue">{nombreEntidad(a.entidad)}</td>
                        <td className="tenue peq">
                          {a.ip ?? ''} {a.agente ? `· ${dispositivo(a.agente)}` : ''}
                        </td>
                      </tr>
                      {abierto === a.id && (a.antes != null || a.despues != null) && (
                        <tr>
                          <td colSpan={5}>
                            <div className="diff">
                              <div>
                                <div className="tenue peq" style={{ marginBottom: 4 }}>Antes</div>
                                <pre>{a.antes ? JSON.stringify(a.antes, null, 2) : '—'}</pre>
                              </div>
                              <div>
                                <div className="tenue peq" style={{ marginBottom: 4 }}>Después</div>
                                <pre>{a.despues ? JSON.stringify(a.despues, null, 2) : '—'}</pre>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {q.hasNextPage && (
            <div style={{ padding: 16, textAlign: 'center' }}>
              <button className="btn" onClick={() => void q.fetchNextPage()} disabled={q.isFetchingNextPage}>
                Cargar más
              </button>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
