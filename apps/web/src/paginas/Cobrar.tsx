import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, HandCoins, MessageCircle, Search } from 'lucide-react';
import { useState } from 'react';
import { Aviso, Cajon, Campo, Cargando, Encabezado, ErrorApi, Vacio } from '../componentes/ui';
import { api } from '../lib/api';
import { dinero, type CajaFila } from '../lib/operacion';
import { useSesion } from '../lib/sesion';
import { SelectorBanco } from './Bancos';

interface CuentaCobrar {
  id: string;
  descripcion: string;
  fecha: string;
  vencimiento: string;
  vencida: boolean;
  diasAtraso: number;
  monto: string;
  saldo: string;
  estado: 'pendiente' | 'parcial' | 'cobrada' | 'anulada';
  venta: { id: string; numero: number } | null;
  cliente: { id: string; nombre: string; documento: string | null; telefono: string | null };
}

interface EstadoCuenta {
  cliente: { id: string; nombre: string; documento: string | null; telefono: string | null };
  limiteCredito: string;
  plazoCreditoDias: number;
  deuda: string;
  disponible: string;
  vencido: string;
  cuentas: { id: string; descripcion: string; fecha: string; vencimiento: string; vencida: boolean; monto: string; saldo: string; estado: string }[];
  movimientos: { fecha: string; tipo: string; detalle: string; debe: string; haber: string; saldo: string }[];
}

const hoy = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Asuncion' }).format(new Date());
const fechaCorta = (f: string) => f.split('-').reverse().join('/');
const soloNumero = (v: string) => v.replace(/[^0-9]/g, '');
const miles = (v: string) => (v === '' ? '' : Math.round(Number(v)).toLocaleString('es-PY'));
const MEDIOS: Record<string, string> = { efectivo: 'Efectivo', transferencia: 'Transferencia', tarjeta: 'Tarjeta', cheque: 'Cheque', otro: 'Otro' };
const ESTADO: Record<string, { texto: string; clase: string }> = {
  pendiente: { texto: 'Pendiente', clase: 'i-warn' },
  parcial: { texto: 'Pago parcial', clase: 'i-p' },
  cobrada: { texto: 'Cobrada', clase: 'i-ok' },
  anulada: { texto: 'Anulada', clase: 'i-n' },
};

export function CuentasCobrar() {
  const { puede } = useSesion();
  const [pestana, setPestana] = useState<'cuentas' | 'cobros'>('cuentas');
  const [estado, setEstado] = useState('abiertas');
  const [q, setQ] = useState('');
  const [cliente, setCliente] = useState<string | null>(null);
  const resumen = useQuery({ queryKey: ['cuentas-cobrar', 'resumen'], queryFn: () => api<{ abierto: string; vencido: string; proximos7Dias: string; clientes: number }>('/cuentas-cobrar/resumen') });
  const lista = useQuery({ queryKey: ['cuentas-cobrar', estado, q], queryFn: () => api<CuentaCobrar[]>(`/cuentas-cobrar?estado=${estado}&q=${encodeURIComponent(q)}`), placeholderData: (p) => p });
  return (
    <>
      <Encabezado titulo="Cuentas a cobrar" />
      <div className="contenido">
        {resumen.data && (
          <section className="panel cifras" style={{ marginBottom: 16 }}>
            <div className="cifra"><span>A cobrar</span><b className="num">{dinero(resumen.data.abierto)}</b></div>
            <div className="cifra"><span>Vencido</span><b className="num" style={Number(resumen.data.vencido) > 0 ? { color: 'var(--bad)' } : undefined}>{dinero(resumen.data.vencido)}</b></div>
            <div className="cifra"><span>Vence en 7 días</span><b className="num">{dinero(resumen.data.proximos7Dias)}</b></div>
            <div className="cifra"><span>Clientes con deuda</span><b className="num">{resumen.data.clientes}</b></div>
          </section>
        )}
        <div className="pestanas">
          <button className={pestana === 'cuentas' ? 'activa' : ''} onClick={() => setPestana('cuentas')}>Cuentas</button>
          <button className={pestana === 'cobros' ? 'activa' : ''} onClick={() => setPestana('cobros')}>Cobros realizados</button>
        </div>
        {pestana === 'cobros' ? (
          <Cobros />
        ) : (
          <section className="panel">
            <div className="filtros" style={{ paddingTop: 16 }}>
              <div style={{ position: 'relative', flex: '1 1 260px', maxWidth: 400 }}>
                <Search size={16} style={{ position: 'absolute', left: 12, top: 10, color: 'var(--t3)' }} />
                <input className="entrada" style={{ paddingLeft: 36, width: '100%' }} placeholder="Cliente o documento" value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
              <select className="entrada" value={estado} onChange={(e) => setEstado(e.target.value)}>
                <option value="abiertas">A cobrar</option>
                <option value="vencidas">Vencidas (en atraso)</option>
                <option value="cobradas">Cobradas</option>
                <option value="todas">Todas</option>
              </select>
            </div>
            {lista.isLoading ? (
              <Cargando />
            ) : !lista.data?.length ? (
              <Vacio titulo={estado === 'abiertas' ? 'No hay cuentas a cobrar' : 'Sin resultados'}>Las ventas a crédito del PDV aparecen aquí.</Vacio>
            ) : (
              <table>
                <thead>
                  <tr><th>Cliente</th><th>Concepto</th><th>Vencimiento</th><th className="der">Monto</th><th className="der">Saldo</th><th>Estado</th></tr>
                </thead>
                <tbody>
                  {lista.data.map((c) => (
                    <tr key={c.id} className="clic" onClick={() => setCliente(c.cliente.id)}>
                      <td style={{ fontWeight: 600 }}>{c.cliente.nombre}{c.cliente.documento && <span className="tenue peq" style={{ fontWeight: 400 }}> · {c.cliente.documento}</span>}</td>
                      <td>{c.descripcion}</td>
                      <td style={c.vencida ? { color: 'var(--bad)', fontWeight: 600 } : undefined}>{fechaCorta(c.vencimiento)}{c.vencida && ` · ${c.diasAtraso} ${c.diasAtraso === 1 ? 'día' : 'días'} de atraso`}</td>
                      <td className="der num tenue">{dinero(c.monto)}</td>
                      <td className="der num" style={{ fontWeight: 600 }}>{c.estado === 'pendiente' || c.estado === 'parcial' ? dinero(c.saldo) : '—'}</td>
                      <td><span className={`insignia ${ESTADO[c.estado]?.clase}`}>{ESTADO[c.estado]?.texto}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {puede('cuenta_cobrar.crear') && lista.data?.length ? <p className="tenue peq" style={{ padding: '10px 20px', margin: 0 }}>Toque un cliente para ver su estado de cuenta y registrar un cobro.</p> : null}
          </section>
        )}
      </div>
      {cliente && <EstadoCuentaCliente clienteId={cliente} alCerrar={() => setCliente(null)} />}
    </>
  );
}

/** Estado de cuenta del cliente, con cobro. También se abre desde la ficha del cliente. */
export function EstadoCuentaCliente({ clienteId, alCerrar }: { clienteId: string; alCerrar: () => void }) {
  const { puede, yo } = useSesion();
  const qc = useQueryClient();
  const ec = useQuery({ queryKey: ['estado-cuenta', clienteId], queryFn: () => api<EstadoCuenta>(`/cuentas-cobrar/cliente/${clienteId}`) });
  const cajas = useQuery({ queryKey: ['cajas'], queryFn: () => api<CajaFila[]>('/cajas'), enabled: puede('caja.ver') });
  const propias = cajas.data?.filter((c) => c.sesion?.propia) ?? [];
  const [cobrando, setCobrando] = useState(false);
  const [montos, setMontos] = useState<Record<string, string>>({});
  const [medio, setMedio] = useState('efectivo');
  const [referencia, setReferencia] = useState('');
  const [banco, setBanco] = useState('');
  const [hecho, setHecho] = useState<{ numero: number; total: string } | null>(null);
  const cobrar = useMutation({
    mutationFn: () =>
      api<{ numero: number; total: string }>('/cobros', {
        metodo: 'POST',
        cuerpo: {
          clienteId,
          fecha: hoy(),
          medio,
          cajaId: medio !== 'efectivo' && banco ? null : propias[0]?.id ?? null,
          cuentaBancariaId: medio !== 'efectivo' && banco ? banco : null,
          referencia: referencia || null,
          aplicaciones: Object.entries(montos).filter(([, v]) => Number(v) > 0).map(([cuentaId, v]) => ({ cuentaId, monto: Number(v) })),
        },
      }),
    onSuccess: (r) => {
      setHecho(r);
      setCobrando(false);
      setMontos({});
      void qc.invalidateQueries({ queryKey: ['estado-cuenta', clienteId] });
      void qc.invalidateQueries({ queryKey: ['cuentas-cobrar'] });
      void qc.invalidateQueries({ queryKey: ['cobros'] });
      void qc.invalidateQueries({ queryKey: ['clientes'] });
    },
  });
  if (!ec.data) return <Cajon titulo="Estado de cuenta" alCerrar={alCerrar}>{ec.error ? <ErrorApi error={ec.error} /> : <Cargando />}</Cajon>;
  const d = ec.data;
  const total = Object.values(montos).reduce((a, v) => a + (Number(v) || 0), 0);
  const excede = d.cuentas.some((c) => Number(montos[c.id]) > Number(c.saldo));
  const iniciarCobro = () => {
    // Por defecto cobra todo, empezando por lo más viejo.
    setMontos(Object.fromEntries(d.cuentas.map((c) => [c.id, String(Math.round(Number(c.saldo)))])));
    setCobrando(true);
    setHecho(null);
  };
  const telefono = d.cliente.telefono?.replace(/[^0-9]/g, '');
  const recordatorio =
    telefono && Number(d.deuda) > 0
      ? `https://wa.me/${telefono.startsWith('0') ? '595' + telefono.slice(1) : telefono}?text=${encodeURIComponent(`Hola ${d.cliente.nombre}, le recordamos que tiene un saldo de ${dinero(d.deuda)} con ${yo?.empresa.nombre ?? 'nosotros'}${Number(d.vencido) > 0 ? `, de los cuales ${dinero(d.vencido)} están vencidos` : ''}. Muchas gracias.`)}`
      : null;
  return (
    <Cajon titulo={`Estado de cuenta · ${d.cliente.nombre}`} alCerrar={alCerrar} ancho={760}>
      <div className="cifras panel">
        <div className="cifra"><span>Deuda</span><b className="num">{dinero(d.deuda)}</b></div>
        <div className="cifra"><span>Vencido</span><b className="num" style={Number(d.vencido) > 0 ? { color: 'var(--bad)' } : undefined}>{dinero(d.vencido)}</b></div>
        <div className="cifra"><span>Disponible</span><b className="num">{Number(d.limiteCredito) > 0 ? dinero(d.disponible) : '—'}</b></div>
      </div>
      <p className="tenue peq" style={{ margin: 0 }}>
        {Number(d.limiteCredito) > 0 ? `Límite de crédito ${dinero(d.limiteCredito)} · plazo ${d.plazoCreditoDias} días` : 'Sin límite de crédito asignado (las ventas a crédito requieren autorización).'}
      </p>
      {hecho && <Aviso tipo="ok">Cobro N.º {hecho.numero} registrado por {dinero(hecho.total)}.</Aviso>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {puede('cuenta_cobrar.crear') && d.cuentas.length > 0 && !cobrando && (
          <button className="btn pri" onClick={iniciarCobro}><HandCoins size={16} /> Registrar cobro</button>
        )}
        {recordatorio && <a className="btn" href={recordatorio} target="_blank" rel="noreferrer"><MessageCircle size={16} /> Recordar por WhatsApp</a>}
      </div>
      {cobrando && (
        <div className="form" style={{ borderTop: '1px solid var(--linea)', paddingTop: 14 }}>
          <ErrorApi error={cobrar.error} />
          <table>
            <thead><tr><th>Cuenta</th><th>Vence</th><th className="der">Saldo</th><th className="der" style={{ width: 150 }}>Cobra</th></tr></thead>
            <tbody>
              {d.cuentas.map((c) => (
                <tr key={c.id}>
                  <td>{c.descripcion}</td>
                  <td style={c.vencida ? { color: 'var(--bad)' } : undefined}>{fechaCorta(c.vencimiento)}</td>
                  <td className="der num">{dinero(c.saldo)}</td>
                  <td className="der"><input className="entrada num" style={{ height: 32, textAlign: 'right' }} value={miles(montos[c.id] ?? '')} onChange={(e) => setMontos({ ...montos, [c.id]: soloNumero(e.target.value) })} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {excede && <Aviso tipo="error">Un monto supera el saldo de su cuenta.</Aviso>}
          <div className="fila-campos">
            <Campo etiqueta="Medio" id="cb-m">
              <select id="cb-m" className="entrada" value={medio} onChange={(e) => setMedio(e.target.value)}>
                {Object.entries(MEDIOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Campo>
            <Campo etiqueta="Referencia (opcional)" id="cb-r"><input id="cb-r" className="entrada" value={referencia} onChange={(e) => setReferencia(e.target.value)} /></Campo>
          </div>
          {medio !== 'efectivo' && <SelectorBanco id="cb-b" valor={banco} alCambiar={setBanco} />}
          {medio !== 'efectivo' && banco ? (
            <p className="tenue peq" style={{ margin: 0 }}>El cobro entra a la cuenta bancaria elegida, no a la caja.</p>
          ) : propias[0] ? (
            <p className="tenue peq" style={{ margin: 0 }}>El cobro entra a {propias[0].nombre} y aparece en su arqueo.</p>
          ) : (
            medio === 'efectivo' && <Aviso tipo="info">El cobro en efectivo entra a una caja: abra su caja en "Cajas y PDV".</Aviso>
          )}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="btn pri" disabled={total <= 0 || excede || (medio === 'efectivo' && !propias.length) || cobrar.isPending} onClick={() => cobrar.mutate()}><CheckCircle2 size={16} /> Cobrar {dinero(total)}</button>
            <button className="btn" onClick={() => setCobrando(false)}>Volver</button>
          </div>
        </div>
      )}
      <h3 className="subtitulo">Movimientos</h3>
      {d.movimientos.length === 0 ? (
        <Vacio titulo="Sin movimientos" />
      ) : (
        <table>
          <thead><tr><th>Fecha</th><th>Detalle</th><th className="der">Debe</th><th className="der">Haber</th><th className="der">Saldo</th></tr></thead>
          <tbody>
            {d.movimientos.map((m, i) => (
              <tr key={i}>
                <td className="tenue">{fechaCorta(m.fecha)}</td>
                <td>{m.detalle}</td>
                <td className="der num">{Number(m.debe) ? dinero(m.debe) : ''}</td>
                <td className="der num">{Number(m.haber) ? dinero(m.haber) : ''}</td>
                <td className="der num" style={{ fontWeight: 600 }}>{dinero(m.saldo)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Cajon>
  );
}

function Cobros() {
  const { puede } = useSesion();
  const qc = useQueryClient();
  const lista = useQuery({ queryKey: ['cobros'], queryFn: () => api<{ id: string; numero: number; fecha: string; medio: string; monto: string; referencia: string | null; estado: string; enCaja: boolean; cliente: string; usuario: string }[]>('/cobros') });
  const [anulando, setAnulando] = useState<string | null>(null);
  const [motivo, setMotivo] = useState('');
  const anular = useMutation({
    mutationFn: () => api(`/cobros/${anulando}/anular`, { metodo: 'POST', cuerpo: { motivo } }),
    onSuccess: () => {
      setAnulando(null);
      void qc.invalidateQueries({ queryKey: ['cobros'] });
      void qc.invalidateQueries({ queryKey: ['cuentas-cobrar'] });
    },
  });
  return (
    <section className="panel">
      <ErrorApi error={anular.error} />
      {lista.isLoading ? (
        <Cargando />
      ) : !lista.data?.length ? (
        <Vacio titulo="Todavía no hay cobros" />
      ) : (
        <table>
          <thead><tr><th>N.º</th><th>Fecha</th><th>Cliente</th><th>Medio</th><th className="der">Monto</th><th>Registró</th><th /></tr></thead>
          <tbody>
            {lista.data.map((k) => (
              <tr key={k.id} style={k.estado === 'anulado' ? { opacity: 0.55 } : undefined}>
                <td className="num">{k.numero}</td>
                <td className="tenue">{fechaCorta(k.fecha)}</td>
                <td>{k.cliente}</td>
                <td>{MEDIOS[k.medio]}{k.enCaja ? ' · caja' : ''}{k.referencia ? <span className="tenue peq"> · {k.referencia}</span> : ''}</td>
                <td className="der num">{dinero(k.monto)}</td>
                <td className="tenue">{k.usuario}</td>
                <td className="der">
                  {k.estado === 'anulado' ? (
                    <span className="insignia i-n">Anulado</span>
                  ) : (
                    puede('cuenta_cobrar.cancelar') &&
                    (anulando === k.id ? (
                      <span style={{ display: 'inline-flex', gap: 6 }}>
                        <input className="entrada" style={{ height: 30, width: 180 }} autoFocus placeholder="Motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
                        <button className="btn peligro" style={{ height: 30 }} disabled={motivo.trim().length < 3 || anular.isPending} onClick={() => anular.mutate()}>Anular</button>
                      </span>
                    ) : (
                      <button className="btn" style={{ height: 30 }} onClick={() => { setAnulando(k.id); setMotivo(''); }}>Anular</button>
                    ))
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
