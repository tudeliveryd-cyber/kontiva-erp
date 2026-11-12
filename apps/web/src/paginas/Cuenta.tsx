import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Monitor } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { contrasena } from '@kontiva/shared';
import { Aviso, Campo, Encabezado, ErrorApi } from '../componentes/ui';
import { api, type SesionFila } from '../lib/api';
import { dispositivo, fechaHora } from '../lib/formato';
import { useSesion } from '../lib/sesion';

export function Cuenta() {
  const { yo, entrar } = useSesion();
  const qc = useQueryClient();
  const sesiones = useQuery({ queryKey: ['sesiones'], queryFn: () => api<SesionFila[]>('/auth/sesiones') });
  const cerrar = useMutation({
    mutationFn: (id: string) => api(`/auth/sesiones/${id}`, { metodo: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['sesiones'] }),
  });
  const cambiarEmpresa = useMutation({
    mutationFn: (empresaId: string) => api<{ accessToken: string }>('/auth/cambiar-empresa', { metodo: 'POST', cuerpo: { empresaId } }),
    onSuccess: (r) => entrar(r.accessToken),
  });
  if (!yo) return null;

  return (
    <>
      <Encabezado titulo="Mi cuenta" />
      <div className="contenido">
        <section className="panel">
          <div className="panel-cab">
            <h2>{yo.usuario.nombre}</h2>
            <span className="sub">
              {yo.usuario.email} · {yo.usuario.perfil.nombre} en {yo.empresa.nombre}
            </span>
          </div>
          {yo.empresas.length > 1 && (
            <div className="panel-cuerpo">
              <ErrorApi error={cambiarEmpresa.error} />
              <div className="campo" style={{ maxWidth: 360 }}>
                <label htmlFor="emp">Empresa activa</label>
                <select id="emp" className="entrada" value={yo.empresa.id} onChange={(e) => cambiarEmpresa.mutate(e.target.value)}>
                  {yo.empresas.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.nombre}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </section>

        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <CambiarContrasena />
          <DefinirPin tienePin={yo.usuario.tienePin} />
        </div>

        <section className="panel">
          <div className="panel-cab">
            <h2>Sesiones activas</h2>
            <span className="sub">Cierre las que no reconozca.</span>
          </div>
          <ErrorApi error={cerrar.error} />
          <table>
            <tbody>
              {sesiones.data?.map((s) => (
                <tr key={s.id}>
                  <td style={{ width: 36 }}>
                    <Monitor size={18} color="var(--t3)" />
                  </td>
                  <td>
                    <div style={{ fontWeight: 600 }}>
                      {dispositivo(s.agente)} {s.actual && <span className="insignia i-ok">Esta sesión</span>}
                    </div>
                    <div className="tenue peq">
                      {s.empresa} · IP {s.ip ?? '—'} · último uso {fechaHora(s.ultimoUsoEn)}
                    </div>
                  </td>
                  <td className="der">
                    {!s.actual && (
                      <button className="btn chico" onClick={() => cerrar.mutate(s.id)}>
                        Cerrar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </>
  );
}

function CambiarContrasena() {
  const [ok, setOk] = useState(false);
  const esquema = z
    .object({ actual: z.string().min(1, 'Ingrese su contraseña actual'), nueva: contrasena, repetir: z.string() })
    .refine((d) => d.nueva === d.repetir, { message: 'Las contraseñas no coinciden', path: ['repetir'] });
  const f = useForm<z.infer<typeof esquema>>({ resolver: zodResolver(esquema) });
  const m = useMutation({
    mutationFn: (d: z.infer<typeof esquema>) => api('/auth/contrasena', { metodo: 'POST', cuerpo: { actual: d.actual, nueva: d.nueva } }),
    onSuccess: () => {
      setOk(true);
      f.reset();
    },
  });
  const e = f.formState.errors;
  return (
    <section className="panel" style={{ flex: '1 1 340px' }}>
      <div className="panel-cab">
        <h2>Contraseña</h2>
      </div>
      <form className="panel-cuerpo form" onSubmit={f.handleSubmit((d) => m.mutate(d))} noValidate>
        <ErrorApi error={m.error} />
        {ok && <Aviso tipo="ok">Contraseña cambiada. Se cerraron sus otras sesiones.</Aviso>}
        <Campo etiqueta="Contraseña actual" id="ca" error={e.actual?.message}>
          <input id="ca" type="password" className="entrada" autoComplete="current-password" {...f.register('actual')} />
        </Campo>
        <Campo etiqueta="Nueva contraseña" id="cn" error={e.nueva?.message} ayuda="Al menos 10 caracteres.">
          <input id="cn" type="password" className="entrada" autoComplete="new-password" {...f.register('nueva')} />
        </Campo>
        <Campo etiqueta="Repetir nueva contraseña" id="cr" error={e.repetir?.message}>
          <input id="cr" type="password" className="entrada" autoComplete="new-password" {...f.register('repetir')} />
        </Campo>
        <div>
          <button className="btn pri" disabled={m.isPending}>
            Cambiar contraseña
          </button>
        </div>
      </form>
    </section>
  );
}

function DefinirPin({ tienePin }: { tienePin: boolean }) {
  const qc = useQueryClient();
  const [ok, setOk] = useState(false);
  const esquema = z.object({ pin: z.string().regex(/^[0-9]{4,6}$/, 'De 4 a 6 dígitos'), contrasena: z.string().min(1, 'Confirme con su contraseña') });
  const f = useForm<z.infer<typeof esquema>>({ resolver: zodResolver(esquema) });
  const m = useMutation({
    mutationFn: (d: z.infer<typeof esquema>) => api('/auth/pin', { metodo: 'PUT', cuerpo: d }),
    onSuccess: () => {
      setOk(true);
      f.reset();
      void qc.invalidateQueries({ queryKey: ['me'] });
    },
  });
  const e = f.formState.errors;
  return (
    <section className="panel" style={{ flex: '1 1 340px' }}>
      <div className="panel-cab">
        <h2>PIN de autorización</h2>
        <span className={`insignia ${tienePin ? 'i-ok' : 'i-n'}`}>{tienePin ? 'Definido' : 'Sin definir'}</span>
      </div>
      <form className="panel-cuerpo form" onSubmit={f.handleSubmit((d) => m.mutate(d))} noValidate>
        <p className="tenue peq" style={{ margin: 0 }}>
          Con este PIN autoriza en la caja cancelaciones o descuentos de otro usuario, sin cerrar su sesión. Queda registrado quién autorizó.
        </p>
        <ErrorApi error={m.error} />
        {ok && <Aviso tipo="ok">PIN guardado.</Aviso>}
        <Campo etiqueta="PIN" id="pin" error={e.pin?.message}>
          <input id="pin" type="password" inputMode="numeric" maxLength={6} className="entrada num" autoComplete="off" {...f.register('pin')} />
        </Campo>
        <Campo etiqueta="Su contraseña" id="pc" error={e.contrasena?.message}>
          <input id="pc" type="password" className="entrada" autoComplete="current-password" {...f.register('contrasena')} />
        </Campo>
        <div>
          <button className="btn pri" disabled={m.isPending}>
            {tienePin ? 'Cambiar PIN' : 'Definir PIN'}
          </button>
        </div>
      </form>
    </section>
  );
}
