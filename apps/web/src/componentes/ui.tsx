import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { FalloApi } from '../lib/api';

export function Marca({ claro = false }: { claro?: boolean }) {
  return (
    <div className="marca">
      <div className="marca-k">K</div>
      <div>
        <b style={claro ? undefined : { color: 'var(--p9)' }}>KONTIVA</b>
        <small>ERP</small>
      </div>
    </div>
  );
}

export function Campo(props: { etiqueta: string; error?: string; ayuda?: string; children: ReactNode; id?: string }) {
  return (
    <div className="campo">
      <label htmlFor={props.id}>{props.etiqueta}</label>
      {props.children}
      {props.error ? <span className="error">{props.error}</span> : props.ayuda ? <span className="ayuda">{props.ayuda}</span> : null}
    </div>
  );
}

export function Aviso({ tipo, children }: { tipo: 'error' | 'ok' | 'info'; children: ReactNode }) {
  const Icono = tipo === 'error' ? AlertCircle : tipo === 'ok' ? CheckCircle2 : Info;
  return (
    <div className={`aviso ${tipo}`} role={tipo === 'error' ? 'alert' : 'status'}>
      <Icono size={16} />
      <div>{children}</div>
    </div>
  );
}

/** Muestra el mensaje de un error de la API (o uno genérico). */
export function ErrorApi({ error }: { error: unknown }) {
  if (!error) return null;
  const mensaje = error instanceof FalloApi ? error.mensaje : 'No se pudo completar la operación. Revise su conexión.';
  const detalle =
    error instanceof FalloApi && Array.isArray(error.detalle) && error.detalle.every((d) => typeof d === 'object' && d && 'mensaje' in d)
      ? (error.detalle as { campo: string; mensaje: string }[])
      : null;
  return (
    <Aviso tipo="error">
      {mensaje}
      {detalle && (
        <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
          {detalle.map((d) => (
            <li key={d.campo + d.mensaje}>{d.mensaje}</li>
          ))}
        </ul>
      )}
    </Aviso>
  );
}

export function Vacio({ titulo, children, accion }: { titulo: string; children?: ReactNode; accion?: ReactNode }) {
  return (
    <div className="vacio">
      <b>{titulo}</b>
      {children && <span>{children}</span>}
      {accion}
    </div>
  );
}

export function Cargando() {
  return <div className="vacio">Cargando…</div>;
}

export function Cajon(props: { titulo: string; alCerrar: () => void; children: ReactNode; pie?: ReactNode }) {
  useEffect(() => {
    const f = (e: KeyboardEvent) => e.key === 'Escape' && props.alCerrar();
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }, [props]);
  return (
    <div className="fondo" onMouseDown={(e) => e.target === e.currentTarget && props.alCerrar()}>
      <div className="cajon" role="dialog" aria-modal="true" aria-label={props.titulo}>
        <div className="cajon-cab">
          <h2>{props.titulo}</h2>
          <button onClick={props.alCerrar} aria-label="Cerrar">
            <X size={20} />
          </button>
        </div>
        <div className="cajon-cuerpo">{props.children}</div>
        {props.pie && <div className="cajon-pie">{props.pie}</div>}
      </div>
    </div>
  );
}

export function Encabezado({ titulo, children }: { titulo: string; children?: ReactNode }) {
  return (
    <div className="superior">
      <h1>{titulo}</h1>
      <div className="derecha">{children}</div>
    </div>
  );
}
