import { useState } from 'react';
import { QrSecreto } from '../componentes/SegundoFactor';
import { Campo, ErrorApi } from '../componentes/ui';
import { master } from './cliente';

type Paso = { tipo: 'credenciales' } | { tipo: 'segundo_factor' | 'configurar_segundo_factor'; ticket: string; qr?: { qr: string; secreto: string } };

export function AccesoMaster({ alEntrar }: { alEntrar: (token: string) => void }) {
  const [paso, setPaso] = useState<Paso>({ tipo: 'credenciales' });
  const [email, setEmail] = useState('');
  const [clave, setClave] = useState('');
  const [codigo, setCodigo] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [ocupado, setOcupado] = useState(false);

  const correr = async (fn: () => Promise<void>) => {
    setError(null);
    setOcupado(true);
    try {
      await fn();
    } catch (e) {
      setError(e);
    } finally {
      setOcupado(false);
    }
  };

  const enviar = (e: React.FormEvent) => {
    e.preventDefault();
    void correr(async () => {
      if (paso.tipo === 'credenciales') {
        const r = await master.api<{ tipo: 'segundo_factor' | 'configurar_segundo_factor'; ticket: string }>('/auth/login', { metodo: 'POST', cuerpo: { email, contrasena: clave } });
        if (r.tipo === 'configurar_segundo_factor') {
          const qr = await master.api<{ qr: string; secreto: string }>('/auth/2fa/enrolar', { metodo: 'POST', cuerpo: { ticket: r.ticket } });
          setPaso({ ...r, qr });
        } else setPaso(r);
        setClave('');
      } else {
        const ruta = paso.tipo === 'segundo_factor' ? '/auth/2fa/verificar' : '/auth/2fa/enrolar/confirmar';
        try {
          const r = await master.api<{ accessToken: string }>(ruta, { metodo: 'POST', cuerpo: { ticket: paso.ticket, codigo } });
          alEntrar(r.accessToken);
        } finally {
          setCodigo('');
        }
      }
    });
  };

  return (
    <div className="acceso" style={{ gridTemplateColumns: '1fr' }}>
      <div className="acceso-form" style={{ background: 'var(--bg)' }}>
        <form className="acceso-caja panel" style={{ padding: 28 }} onSubmit={enviar} noValidate>
          <div className="marca" style={{ padding: 0 }}>
            <div className="marca-k">K</div>
            <div>
              <b style={{ color: 'var(--p9)' }}>KONTIVA</b>
              <small style={{ color: 'var(--p5)' }}>MASTER</small>
            </div>
          </div>
          <div>
            <h1>{paso.tipo === 'credenciales' ? 'Panel Master' : paso.tipo === 'segundo_factor' ? 'Verificación en dos pasos' : 'Configure la verificación en dos pasos'}</h1>
            <p className="sub">
              {paso.tipo === 'credenciales'
                ? 'Acceso exclusivo de Araújo Tech Sistemas.'
                : paso.tipo === 'segundo_factor'
                  ? 'Ingrese el código de su aplicación de autenticación.'
                  : 'Es obligatoria en el Panel Master.'}
            </p>
          </div>
          <ErrorApi error={error} />
          {paso.tipo === 'credenciales' ? (
            <>
              <Campo etiqueta="Correo" id="me">
                <input id="me" className="entrada" type="email" autoComplete="username" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
              </Campo>
              <Campo etiqueta="Contraseña" id="mc">
                <input id="mc" className="entrada" type="password" autoComplete="current-password" value={clave} onChange={(e) => setClave(e.target.value)} />
              </Campo>
            </>
          ) : (
            <>
              {paso.qr && <QrSecreto qr={paso.qr.qr} secreto={paso.qr.secreto} />}
              <Campo etiqueta="Código de 6 dígitos" id="mcod">
                <input
                  id="mcod"
                  className="entrada num"
                  style={{ fontSize: 20, letterSpacing: '.3em', textAlign: 'center' }}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  autoFocus
                  value={codigo}
                  onChange={(e) => setCodigo(e.target.value.replace(/[^0-9]/g, ''))}
                />
              </Campo>
            </>
          )}
          <button className="btn pri bloque" disabled={ocupado || (paso.tipo === 'credenciales' ? !email || !clave : codigo.length !== 6)}>
            {paso.tipo === 'credenciales' ? 'Continuar' : 'Verificar'}
          </button>
          {paso.tipo !== 'credenciales' && (
            <button type="button" className="enlace" onClick={() => setPaso({ tipo: 'credenciales' })}>
              Volver
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
