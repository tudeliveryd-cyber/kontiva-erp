import { useInfiniteQuery, useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { Aviso, Campo, Cargando, Encabezado, ErrorApi } from '../componentes/ui';
import { fechaHora } from '../lib/formato';
import { master } from './cliente';

const ACCIONES: Record<string, string> = {
  inicio_sesion: 'Inició sesión',
  login_fallido: 'Contraseña incorrecta',
  activar_2fa: 'Activó la verificación en dos pasos',
  alta_empresa: 'Alta de empresa',
  cambio_plan: 'Cambio de plan',
  suspender: 'Suspensión',
  reactivar: 'Reactivación',
  crear_suscripcion: 'Configuró suscripción',
  editar_suscripcion: 'Editó suscripción',
  registrar_pago: 'Registró pago',
  anular_pago: 'Anuló pago',
  editar_plan: 'Editó plan',
  reenviar_invitacion: 'Reenvió invitación',
  cambio_contrasena: 'Cambió su contraseña',
  crear_usuario_master: 'Creó usuario master',
  reiniciar_2fa: 'Reinició verificación en dos pasos',
};

export function AuditoriaMaster() {
  const q = useInfiniteQuery({
    queryKey: ['m-auditoria'],
    initialPageParam: null as number | null,
    queryFn: ({ pageParam }) =>
      master.api<{ items: { id: number; fecha: string; accion: string; entidad: string; entidadId: string | null; despues: unknown; ip: string | null; usuario: string }[]; siguiente: number | null }>(
        `/auditoria${pageParam ? `?cursor=${pageParam}` : ''}`,
      ),
    getNextPageParam: (u) => u.siguiente,
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <>
      <Encabezado titulo="Auditoría del Panel Master" />
      <div className="contenido">
        <section className="panel">
          {q.isLoading ? (
            <Cargando />
          ) : (
            <div className="desplazar">
              <table>
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Usuario</th>
                    <th>Acción</th>
                    <th>Detalle</th>
                    <th>IP</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((a) => (
                    <tr key={a.id}>
                      <td className="num peq">{fechaHora(a.fecha)}</td>
                      <td>{a.usuario}</td>
                      <td>{ACCIONES[a.accion] ?? a.accion}</td>
                      <td className="tenue peq mono" style={{ maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={a.despues ? JSON.stringify(a.despues) : ''}>
                        {a.despues ? JSON.stringify(a.despues) : ''}
                      </td>
                      <td className="tenue peq">{a.ip}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {q.hasNextPage && (
            <div style={{ padding: 16, textAlign: 'center' }}>
              <button className="btn" onClick={() => void q.fetchNextPage()}>
                Cargar más
              </button>
            </div>
          )}
        </section>
      </div>
    </>
  );
}

export function CuentaMaster() {
  const [d, setD] = useState({ actual: '', nueva: '', repetir: '' });
  const m = useMutation({
    mutationFn: () => master.api('/auth/contrasena', { metodo: 'POST', cuerpo: { actual: d.actual, nueva: d.nueva } }),
    onSuccess: () => setD({ actual: '', nueva: '', repetir: '' }),
  });
  const distintas = d.repetir !== '' && d.nueva !== d.repetir;
  return (
    <>
      <Encabezado titulo="Mi cuenta" />
      <div className="contenido">
        <section className="panel" style={{ maxWidth: 520 }}>
          <div className="panel-cab">
            <h2>Cambiar contraseña</h2>
          </div>
          <form
            className="panel-cuerpo form"
            onSubmit={(e) => {
              e.preventDefault();
              m.mutate();
            }}
          >
            <ErrorApi error={m.error} />
            {m.isSuccess && <Aviso tipo="ok">Contraseña cambiada. Se cerraron sus otras sesiones.</Aviso>}
            <Campo etiqueta="Contraseña actual" id="ma">
              <input id="ma" type="password" className="entrada" autoComplete="current-password" value={d.actual} onChange={(e) => setD({ ...d, actual: e.target.value })} />
            </Campo>
            <Campo etiqueta="Nueva contraseña" id="mn" ayuda="Al menos 12 caracteres.">
              <input id="mn" type="password" className="entrada" autoComplete="new-password" value={d.nueva} onChange={(e) => setD({ ...d, nueva: e.target.value })} />
            </Campo>
            <Campo etiqueta="Repetir" id="mr" error={distintas ? 'No coinciden' : undefined}>
              <input id="mr" type="password" className="entrada" autoComplete="new-password" value={d.repetir} onChange={(e) => setD({ ...d, repetir: e.target.value })} />
            </Campo>
            <div>
              <button className="btn pri" disabled={!d.actual || d.nueva.length < 12 || d.nueva !== d.repetir || m.isPending}>
                Cambiar contraseña
              </button>
            </div>
          </form>
        </section>
      </div>
    </>
  );
}
