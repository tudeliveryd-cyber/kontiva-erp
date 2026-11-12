import { zodResolver } from '@hookform/resolvers/zod';
import { Building2, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import { email, loginEntrada } from '@kontiva/shared';
import { CodigosRespaldo, QrSecreto } from '../componentes/SegundoFactor';
import { Aviso, Campo, ErrorApi, Marca } from '../componentes/ui';
import { api } from '../lib/api';
import { useSesion } from '../lib/sesion';

type Respuesta =
  | { tipo: 'sesion'; accessToken: string }
  | { tipo: 'elegir_empresa'; ticket: string; empresas: { id: string; nombre: string }[] }
  | { tipo: 'segundo_factor' | 'configurar_segundo_factor'; ticket: string };

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
  const [paso2fa, setPaso2fa] = useState<Extract<Respuesta, { tipo: 'segundo_factor' | 'configurar_segundo_factor' }> | null>(null);
  const f = useForm<z.infer<typeof loginEntrada>>({ resolver: zodResolver(loginEntrada) });

  const seguir = async (r: Respuesta) => {
    setPaso2fa(null);
    if (r.tipo === 'sesion') await entrar(r.accessToken);
    else if (r.tipo === 'elegir_empresa') setEleccion(r);
    else setPaso2fa(r);
  };

  const enviar = f.handleSubmit(async (d) => {
    setError(null);
    try {
      await seguir(await api<Respuesta>('/auth/login', { metodo: 'POST', cuerpo: { email: d.email, contrasena: d.contrasena } }));
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
        ) : paso2fa?.tipo === 'segundo_factor' ? (
          <CodigoSegundoFactor ticket={paso2fa.ticket} alSeguir={seguir} alVolver={() => setPaso2fa(null)} />
        ) : paso2fa?.tipo === 'configurar_segundo_factor' ? (
          <ConfigurarSegundoFactor ticket={paso2fa.ticket} alSeguir={seguir} alVolver={() => setPaso2fa(null)} />
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

function CodigoSegundoFactor(props: { ticket: string; alSeguir: (r: Respuesta) => Promise<void>; alVolver: () => void }) {
  const [codigo, setCodigo] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [enviando, setEnviando] = useState(false);
  const [respaldo, setRespaldo] = useState(false);
  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setEnviando(true);
    try {
      await props.alSeguir(await api<Respuesta>('/auth/2fa/verificar', { metodo: 'POST', cuerpo: { ticket: props.ticket, codigo } }));
    } catch (err) {
      setError(err);
      setCodigo('');
    } finally {
      setEnviando(false);
    }
  };
  return (
    <form className="acceso-caja" onSubmit={enviar} noValidate>
      <div>
        <h1>Verificación en dos pasos</h1>
        <p className="sub">{respaldo ? 'Ingrese uno de sus códigos de respaldo (XXXXX-XXXXX).' : 'Ingrese el código de 6 dígitos de su aplicación de autenticación.'}</p>
      </div>
      <ErrorApi error={error} />
      <Campo etiqueta={respaldo ? 'Código de respaldo' : 'Código'} id="codigo2fa">
        <input
          id="codigo2fa"
          className="entrada num"
          style={{ fontSize: 20, letterSpacing: respaldo ? '.08em' : '.3em', textAlign: 'center' }}
          inputMode={respaldo ? 'text' : 'numeric'}
          autoComplete="one-time-code"
          maxLength={respaldo ? 11 : 6}
          autoFocus
          value={codigo}
          onChange={(e) => setCodigo(respaldo ? e.target.value.toUpperCase() : e.target.value.replace(/[^0-9]/g, ''))}
        />
      </Campo>
      <button className="btn pri bloque" disabled={enviando || codigo.length < 6}>
        Verificar
      </button>
      <button type="button" className="enlace" onClick={() => { setRespaldo(!respaldo); setCodigo(''); }}>
        {respaldo ? 'Usar la aplicación de autenticación' : 'No tengo el teléfono: usar un código de respaldo'}
      </button>
      <button type="button" className="enlace" onClick={props.alVolver}>
        Volver
      </button>
    </form>
  );
}

function ConfigurarSegundoFactor(props: { ticket: string; alSeguir: (r: Respuesta) => Promise<void>; alVolver: () => void }) {
  const [datos, setDatos] = useState<{ qr: string; secreto: string } | null>(null);
  const [codigo, setCodigo] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [final, setFinal] = useState<{ codigosRespaldo: string[]; siguiente: Respuesta } | null>(null);

  const generar = async () => {
    setError(null);
    try {
      setDatos(await api('/auth/2fa/enrolar', { metodo: 'POST', cuerpo: { ticket: props.ticket } }));
    } catch (e) {
      setError(e);
    }
  };
  const confirmar = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      setFinal(await api('/auth/2fa/enrolar/confirmar', { metodo: 'POST', cuerpo: { ticket: props.ticket, codigo } }));
    } catch (err) {
      setError(err);
    }
  };

  if (final) {
    return (
      <div className="acceso-caja">
        <div>
          <h1>Guarde sus códigos de respaldo</h1>
          <p className="sub">Sirven para entrar si pierde el teléfono. Cada uno se usa una sola vez. No se volverán a mostrar.</p>
        </div>
        <CodigosRespaldo codigos={final.codigosRespaldo} />
        <button className="btn pri bloque" onClick={() => void props.alSeguir(final.siguiente)}>
          Ya los guardé, continuar
        </button>
      </div>
    );
  }

  return (
    <form className="acceso-caja" onSubmit={confirmar} noValidate>
      <div>
        <h1>Active la verificación en dos pasos</h1>
        <p className="sub">Su plan la exige para el Propietario. Necesita una aplicación de autenticación en el teléfono (Google Authenticator, Microsoft Authenticator u otra).</p>
      </div>
      <ErrorApi error={error} />
      {!datos ? (
        <button type="button" className="btn pri bloque" onClick={() => void generar()}>
          Generar código QR
        </button>
      ) : (
        <>
          <QrSecreto qr={datos.qr} secreto={datos.secreto} />
          <Campo etiqueta="Código de 6 dígitos que muestra la aplicación" id="cod-enrolar">
            <input id="cod-enrolar" className="entrada num" inputMode="numeric" maxLength={6} autoComplete="one-time-code" value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/[^0-9]/g, ''))} />
          </Campo>
          <button className="btn pri bloque" disabled={codigo.length !== 6}>
            Activar
          </button>
        </>
      )}
      <button type="button" className="enlace" onClick={props.alVolver}>
        Volver
      </button>
    </form>
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
