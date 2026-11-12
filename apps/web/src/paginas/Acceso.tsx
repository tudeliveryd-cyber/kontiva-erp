import { zodResolver } from '@hookform/resolvers/zod';
import { Building2, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import { email, loginEntrada } from '@kontiva/shared';
import { Aviso, Campo, ErrorApi, Marca } from '../componentes/ui';
import { api } from '../lib/api';
import { useSesion } from '../lib/sesion';

type Respuesta = { tipo: 'sesion'; accessToken: string } | { tipo: 'elegir_empresa'; ticket: string; empresas: { id: string; nombre: string }[] };

function PanelMarca() {
  return (
    <div className="acceso-marca">
      <Marca claro />
      <div>
        <h2>Gestión inteligente para tu empresa.</h2>
        <p>Ventas, stock, caja y finanzas en un solo sistema, con facturación electrónica para Paraguay.</p>
      </div>
      <small style={{ color: '#9d86b5' }}>Desarrollado por Araújo Tech Sistemas</small>
    </div>
  );
}

export function Acceso() {
  const { entrar } = useSesion();
  const [error, setError] = useState<unknown>(null);
  const [eleccion, setEleccion] = useState<Extract<Respuesta, { tipo: 'elegir_empresa' }> | null>(null);
  const [recuperar, setRecuperar] = useState(false);
  const f = useForm<z.infer<typeof loginEntrada>>({ resolver: zodResolver(loginEntrada) });

  const enviar = f.handleSubmit(async (d) => {
    setError(null);
    try {
      const r = await api<Respuesta>('/auth/login', { metodo: 'POST', cuerpo: { email: d.email, contrasena: d.contrasena } });
      if (r.tipo === 'sesion') await entrar(r.accessToken);
      else setEleccion(r);
    } catch (e) {
      setError(e);
    }
  });

  const elegir = async (empresaId: string) => {
    setError(null);
    try {
      const r = await api<{ accessToken: string }>('/auth/empresa', { metodo: 'POST', cuerpo: { ticket: eleccion!.ticket, empresaId } });
      await entrar(r.accessToken);
    } catch (e) {
      setError(e);
      setEleccion(null);
    }
  };

  return (
    <div className="acceso">
      <PanelMarca />
      <div className="acceso-form">
        {recuperar ? (
          <Recuperar alVolver={() => setRecuperar(false)} />
        ) : eleccion ? (
          <div className="acceso-caja">
            <div>
              <h1>Elija la empresa</h1>
              <p className="sub">Su usuario tiene acceso a varias empresas.</p>
            </div>
            <div className="lista-empresas">
              {eleccion.empresas.map((e) => (
                <button key={e.id} onClick={() => void elegir(e.id)}>
                  <Building2 size={18} color="var(--p7)" />
                  <span style={{ flex: 1 }}>{e.nombre}</span>
                  <ChevronRight size={16} color="var(--t3)" />
                </button>
              ))}
            </div>
            <button className="enlace" onClick={() => setEleccion(null)}>
              Volver
            </button>
          </div>
        ) : (
          <form className="acceso-caja" onSubmit={enviar} noValidate>
            <div>
              <h1>Iniciar sesión</h1>
              <p className="sub">Ingrese con su correo y contraseña.</p>
            </div>
            <ErrorApi error={error} />
            <Campo etiqueta="Correo electrónico" id="email" error={f.formState.errors.email?.message}>
              <input id="email" className="entrada" type="email" autoComplete="username" autoFocus {...f.register('email')} aria-invalid={!!f.formState.errors.email} />
            </Campo>
            <Campo etiqueta="Contraseña" id="contrasena" error={f.formState.errors.contrasena?.message}>
              <input id="contrasena" className="entrada" type="password" autoComplete="current-password" {...f.register('contrasena')} aria-invalid={!!f.formState.errors.contrasena} />
            </Campo>
            <button className="btn pri bloque" disabled={f.formState.isSubmitting}>
              {f.formState.isSubmitting ? 'Ingresando…' : 'Ingresar'}
            </button>
            <button type="button" className="enlace" onClick={() => setRecuperar(true)}>
              Olvidé mi contraseña
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function Recuperar({ alVolver }: { alVolver: () => void }) {
  const [enviado, setEnviado] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const f = useForm<{ email: string }>({ resolver: zodResolver(z.object({ email })) });
  const enviar = f.handleSubmit(async (d) => {
    setError(null);
    try {
      await api('/auth/recuperar', { metodo: 'POST', cuerpo: d });
      setEnviado(true);
    } catch (e) {
      setError(e);
    }
  });
  return (
    <form className="acceso-caja" onSubmit={enviar} noValidate>
      <div>
        <h1>Recuperar contraseña</h1>
        <p className="sub">Le enviaremos un enlace para crear una contraseña nueva.</p>
      </div>
      {enviado ? (
        <Aviso tipo="ok">Si el correo está registrado, recibirá el enlace en unos minutos. El enlace vence en 30 minutos.</Aviso>
      ) : (
        <>
          <ErrorApi error={error} />
          <Campo etiqueta="Correo electrónico" id="email-r" error={f.formState.errors.email?.message}>
            <input id="email-r" className="entrada" type="email" autoFocus {...f.register('email')} />
          </Campo>
          <button className="btn pri bloque" disabled={f.formState.isSubmitting}>
            Enviar enlace
          </button>
        </>
      )}
      <button type="button" className="enlace" onClick={alVolver}>
        Volver a iniciar sesión
      </button>
    </form>
  );
}

export function Restablecer() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token') ?? '';
  const invitacion = params.get('invitacion') === '1';
  const [listo, setListo] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const esquema = z
    .object({ contrasena: z.string().min(10, 'Mínimo 10 caracteres').max(200), repetir: z.string() })
    .refine((d) => d.contrasena === d.repetir, { message: 'Las contraseñas no coinciden', path: ['repetir'] });
  const f = useForm<z.infer<typeof esquema>>({ resolver: zodResolver(esquema) });

  const enviar = f.handleSubmit(async (d) => {
    setError(null);
    try {
      await api('/auth/restablecer', { metodo: 'POST', cuerpo: { token, contrasena: d.contrasena } });
      setListo(true);
    } catch (e) {
      setError(e);
    }
  });

  return (
    <div className="acceso">
      <PanelMarca />
      <div className="acceso-form">
        <form className="acceso-caja" onSubmit={enviar} noValidate>
          <div>
            <h1>{invitacion ? 'Bienvenido a KONTIVA' : 'Nueva contraseña'}</h1>
            <p className="sub">{invitacion ? 'Cree su contraseña para empezar.' : 'Elija una contraseña nueva para su cuenta.'}</p>
          </div>
          {listo ? (
            <>
              <Aviso tipo="ok">Contraseña guardada. Ya puede iniciar sesión.</Aviso>
              <Link className="btn pri bloque" to="/">
                Iniciar sesión
              </Link>
            </>
          ) : (
            <>
              {!token && <Aviso tipo="error">El enlace está incompleto. Ábralo de nuevo desde el correo.</Aviso>}
              <ErrorApi error={error} />
              <Campo etiqueta="Contraseña" id="c1" error={f.formState.errors.contrasena?.message} ayuda="Al menos 10 caracteres.">
                <input id="c1" className="entrada" type="password" autoComplete="new-password" autoFocus {...f.register('contrasena')} />
              </Campo>
              <Campo etiqueta="Repetir contraseña" id="c2" error={f.formState.errors.repetir?.message}>
                <input id="c2" className="entrada" type="password" autoComplete="new-password" {...f.register('repetir')} />
              </Campo>
              <button className="btn pri bloque" disabled={!token || f.formState.isSubmitting}>
                Guardar contraseña
              </button>
            </>
          )}
        </form>
      </div>
    </div>
  );
}
