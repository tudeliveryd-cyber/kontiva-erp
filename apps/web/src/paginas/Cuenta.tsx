import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Monitor, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { contrasena } from '@kontiva/shared';
import { CodigosRespaldo, QrSecreto } from '../componentes/SegundoFactor';
import { Aviso, Campo, Encabezado, ErrorApi } from '../componentes/ui';
import { api, type SesionFila } from '../lib/api';
import { dispositivo, fechaHora } from '../lib/formato';
import { useSesion } from '../lib/sesion';
import { fijarIdioma, type Idioma } from '../i18n/traductor';

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
          <IdiomaCuenta actual={yo.usuario.idioma} />
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

        <SegundoFactorCuenta />

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

interface Estado2fa {
  activo: boolean;
  obligatorio: boolean;
  codigosRestantes: number;
}

function SegundoFactorCuenta() {
  const qc = useQueryClient();
  const estado = useQuery({ queryKey: ['2fa'], queryFn: () => api<Estado2fa>('/auth/2fa') });
  const [modo, setModo] = useState<'nada' | 'activar' | 'desactivar' | 'codigos'>('nada');
  const [contrasenaActual, setContrasenaActual] = useState('');
  const [codigo, setCodigo] = useState('');
  const [qr, setQr] = useState<{ qr: string; secreto: string } | null>(null);
  const [codigos, setCodigos] = useState<string[] | null>(null);
  const [error, setError] = useState<unknown>(null);

  const reiniciar = () => {
    setModo('nada');
    setContrasenaActual('');
    setCodigo('');
    setQr(null);
    setError(null);
  };
  const correr = async (fn: () => Promise<void>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e);
    }
  };
  const e = estado.data;

  return (
    <section className="panel">
      <div className="panel-cab">
        <ShieldCheck size={18} color="var(--p7)" />
        <h2>Verificación en dos pasos</h2>
        {e && <span className={`insignia ${e.activo ? 'i-ok' : 'i-n'}`}>{e.activo ? 'Activa' : 'Desactivada'}</span>}
        {e?.obligatorio && <span className="insignia i-p">Exigida por su plan</span>}
      </div>
      <div className="panel-cuerpo form" style={{ maxWidth: 560 }}>
        <p className="tenue peq" style={{ margin: 0 }}>
          Además de la contraseña, al entrar se pide un código de la aplicación de autenticación de su teléfono. Si alguien obtiene su contraseña, igual no puede entrar.
        </p>
        <ErrorApi error={error} />
        {codigos && (
          <>
            <Aviso tipo="ok">Guarde estos códigos de respaldo. No se volverán a mostrar.</Aviso>
            <CodigosRespaldo codigos={codigos} />
            <div>
              <button className="btn" onClick={() => setCodigos(null)}>
                Listo
              </button>
            </div>
          </>
        )}
        {!codigos && e && !e.activo && modo === 'nada' && (
          <div>
            <button className="btn pri" onClick={() => setModo('activar')}>
              Activar
            </button>
          </div>
        )}
        {!codigos && e?.activo && modo === 'nada' && (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <span className="tenue peq">{e.codigosRestantes} códigos de respaldo disponibles.</span>
            <button className="btn chico" onClick={() => setModo('codigos')}>
              Generar códigos nuevos
            </button>
            {!e.obligatorio && (
              <button className="btn chico peligro" onClick={() => setModo('desactivar')}>
                Desactivar
              </button>
            )}
          </div>
        )}

        {modo === 'activar' && !qr && (
          <form className="form" onSubmit={(ev) => { ev.preventDefault(); void correr(async () => setQr(await api('/auth/2fa/iniciar', { metodo: 'POST', cuerpo: { contrasena: contrasenaActual } }))); }}>
            <Campo etiqueta="Confirme con su contraseña" id="c2fa">
              <input id="c2fa" type="password" className="entrada" autoComplete="current-password" value={contrasenaActual} onChange={(ev) => setContrasenaActual(ev.target.value)} />
            </Campo>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn pri" disabled={!contrasenaActual}>Continuar</button>
              <button type="button" className="btn" onClick={reiniciar}>Cancelar</button>
            </div>
          </form>
        )}
        {modo === 'activar' && qr && (
          <form
            className="form"
            onSubmit={(ev) => {
              ev.preventDefault();
              void correr(async () => {
                const r = await api<{ codigosRespaldo: string[] }>('/auth/2fa/activar', { metodo: 'POST', cuerpo: { codigo } });
                reiniciar();
                setCodigos(r.codigosRespaldo);
                await qc.invalidateQueries({ queryKey: ['2fa'] });
              });
            }}
          >
            <QrSecreto qr={qr.qr} secreto={qr.secreto} />
            <Campo etiqueta="Código de 6 dígitos" id="cod2fa">
              <input id="cod2fa" className="entrada num" inputMode="numeric" maxLength={6} value={codigo} onChange={(ev) => setCodigo(ev.target.value.replace(/[^0-9]/g, ''))} />
            </Campo>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn pri" disabled={codigo.length !== 6}>Activar</button>
              <button type="button" className="btn" onClick={reiniciar}>Cancelar</button>
            </div>
          </form>
        )}
        {(modo === 'desactivar' || modo === 'codigos') && (
          <form
            className="form"
            onSubmit={(ev) => {
              ev.preventDefault();
              void correr(async () => {
                if (modo === 'desactivar') {
                  await api('/auth/2fa/desactivar', { metodo: 'POST', cuerpo: { contrasena: contrasenaActual, codigo } });
                  reiniciar();
                } else {
                  const r = await api<{ codigosRespaldo: string[] }>('/auth/2fa/codigos', { metodo: 'POST', cuerpo: { contrasena: contrasenaActual } });
                  reiniciar();
                  setCodigos(r.codigosRespaldo);
                }
                await qc.invalidateQueries({ queryKey: ['2fa'] });
              });
            }}
          >
            <Campo etiqueta="Contraseña" id="c2fa-b">
              <input id="c2fa-b" type="password" className="entrada" autoComplete="current-password" value={contrasenaActual} onChange={(ev) => setContrasenaActual(ev.target.value)} />
            </Campo>
            {modo === 'desactivar' && (
              <Campo etiqueta="Código actual o de respaldo" id="cod2fa-b">
                <input id="cod2fa-b" className="entrada num" maxLength={11} value={codigo} onChange={(ev) => setCodigo(ev.target.value.toUpperCase())} />
              </Campo>
            )}
            {modo === 'codigos' && <Aviso tipo="info">Los códigos anteriores dejarán de servir.</Aviso>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button className={`btn ${modo === 'desactivar' ? 'peligro' : 'pri'}`} disabled={!contrasenaActual || (modo === 'desactivar' && codigo.length < 6)}>
                {modo === 'desactivar' ? 'Desactivar' : 'Generar'}
              </button>
              <button type="button" className="btn" onClick={reiniciar}>Cancelar</button>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}

/** Idioma de la interfaz: lo guarda en la cuenta (sigue a la persona en cualquier equipo) y recarga la pantalla. */
function IdiomaCuenta({ actual }: { actual: Idioma }) {
  const guardar = useMutation({
    mutationFn: (idioma: Idioma) => api('/idioma', { metodo: 'PUT', cuerpo: { idioma } }).then(() => idioma),
    onSuccess: (idioma) => fijarIdioma(idioma),
  });
  return (
    <div className="panel-cuerpo">
      <ErrorApi error={guardar.error} />
      <div className="campo" style={{ maxWidth: 360 }}>
        <label htmlFor="idioma">Idioma de la interfaz</label>
        <select id="idioma" className="entrada" translate="no" value={actual} disabled={guardar.isPending} onChange={(e) => guardar.mutate(e.target.value as Idioma)}>
          <option value="es">Español</option>
          <option value="pt">Português</option>
        </select>
        <span className="tenue peq">Las facturas, el KuDE y los tickets se emiten siempre en español.</span>
      </div>
    </div>
  );
}
