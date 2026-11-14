import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeftRight, CheckCircle2, Landmark, Pencil, Plus, Vault } from 'lucide-react';
import { useState } from 'react';
import { Aviso, Cajon, Campo, Cargando, Encabezado, ErrorApi, Vacio } from '../componentes/ui';
import { api } from '../lib/api';
import { dinero, type CajaFila } from '../lib/operacion';
import { useSesion } from '../lib/sesion';

export interface CuentaBancaria {
  id: string;
  banco: string;
  nombre: string;
  numero: string | null;
  activa: boolean;
  saldoInicial: string;
  fechaSaldoInicial: string;
  saldo: string;
  saldoConciliado: string;
  sinConciliar: number;
}

interface Extracto {
  saldoInicial: string;
  saldoFinal: string;
  items: { id: string; fecha: string; tipo: string; descripcion: string; monto: string; referencia: string | null; conciliado: boolean; usuario: string; saldo: string }[];
}

const hoy = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Asuncion' }).format(new Date());
const inicioMes = () => hoy().slice(0, 8) + '01';
const fechaCorta = (f: string) => f.split('-').reverse().join('/');
const soloNumero = (v: string) => v.replace(/[^0-9]/g, '');
const miles = (v: string) => (v === '' ? '' : Math.round(Number(v)).toLocaleString('es-PY'));

/** Selector de cuenta bancaria para pagos y cobros que no son en efectivo. */
export function SelectorBanco({ valor, alCambiar, id }: { valor: string; alCambiar: (v: string) => void; id: string }) {
  const { puede } = useSesion();
  const cuentas = useQuery({ queryKey: ['cuentas-bancarias'], queryFn: () => api<CuentaBancaria[]>('/cuentas-bancarias'), enabled: puede('banco.ver') });
  const activas = cuentas.data?.filter((c) => c.activa) ?? [];
  if (!activas.length) return null;
  return (
    <Campo etiqueta="Cuenta bancaria" id={id}>
      <select id={id} className="entrada" value={valor} onChange={(e) => alCambiar(e.target.value)}>
        <option value="">Sin registrar en banco</option>
        {activas.map((c) => <option key={c.id} value={c.id}>{c.banco} · {c.nombre}</option>)}
      </select>
    </Campo>
  );
}

export function Bancos() {
  const { puede } = useSesion();
  const lista = useQuery({ queryKey: ['cuentas-bancarias'], queryFn: () => api<CuentaBancaria[]>('/cuentas-bancarias') });
  const [editando, setEditando] = useState<CuentaBancaria | 'nueva' | null>(null);
  const [abierta, setAbierta] = useState<string | null>(null);
  const total = lista.data?.filter((c) => c.activa).reduce((a, c) => a + Number(c.saldo), 0) ?? 0;
  const seleccionada = lista.data?.find((c) => c.id === abierta);
  return (
    <>
      <Encabezado titulo="Bancos">
        {puede('banco.crear') && <button className="btn pri" onClick={() => setEditando('nueva')}><Plus size={16} /> Nueva cuenta</button>}
      </Encabezado>
      <div className="contenido">
        {lista.isLoading ? (
          <Cargando />
        ) : !lista.data?.length ? (
          <section className="panel"><Vacio titulo="Todavía no hay cuentas bancarias">Registre sus cuentas para controlar pagos, cobros, depósitos y conciliar con el extracto del banco.</Vacio></section>
        ) : (
          <>
            <section className="panel cifras" style={{ marginBottom: 16 }}>
              <div className="cifra"><span>Saldo en bancos</span><b className="num">{dinero(total)}</b></div>
              <div className="cifra"><span>Cuentas activas</span><b className="num">{lista.data.filter((c) => c.activa).length}</b></div>
              <div className="cifra"><span>Movimientos sin conciliar</span><b className="num">{lista.data.reduce((a, c) => a + c.sinConciliar, 0)}</b></div>
            </section>
            <section className="panel">
              <table>
                <thead><tr><th>Banco</th><th>Cuenta</th><th className="der">Saldo</th><th className="der">Conciliado</th><th className="der">Sin conciliar</th><th /></tr></thead>
                <tbody>
                  {lista.data.map((c) => (
                    <tr key={c.id} className="clic" style={c.activa ? undefined : { opacity: 0.55 }} onClick={() => setAbierta(c.id)}>
                      <td style={{ fontWeight: 600 }}><Landmark size={15} style={{ verticalAlign: -2, marginRight: 6, color: 'var(--t3)' }} />{c.banco}</td>
                      <td>{c.nombre}{c.numero && <span className="tenue peq"> · {c.numero}</span>}{!c.activa && <span className="insignia i-n" style={{ marginLeft: 8 }}>Inactiva</span>}</td>
                      <td className="der num" style={{ fontWeight: 600 }}>{dinero(c.saldo)}</td>
                      <td className="der num tenue">{dinero(c.saldoConciliado)}</td>
                      <td className="der num">{c.sinConciliar || '—'}</td>
                      <td className="der">
                        {puede('banco.editar') && <button className="btn" style={{ height: 30 }} onClick={(e) => { e.stopPropagation(); setEditando(c); }}><Pencil size={14} /> Editar</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="tenue peq" style={{ padding: '10px 20px', margin: 0 }}>Toque una cuenta para ver el extracto, registrar movimientos y conciliar.</p>
            </section>
          </>
        )}
      </div>
      {editando && <FormCuenta cuenta={editando === 'nueva' ? null : editando} alCerrar={() => setEditando(null)} />}
      {seleccionada && <ExtractoCuenta cuenta={seleccionada} otras={lista.data!.filter((c) => c.id !== seleccionada.id && c.activa)} alCerrar={() => setAbierta(null)} />}
    </>
  );
}

function FormCuenta({ cuenta, alCerrar }: { cuenta: CuentaBancaria | null; alCerrar: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({
    banco: cuenta?.banco ?? '',
    nombre: cuenta?.nombre ?? '',
    numero: cuenta?.numero ?? '',
    saldoInicial: cuenta ? String(Math.round(Number(cuenta.saldoInicial))) : '',
    fechaSaldoInicial: cuenta?.fechaSaldoInicial ?? hoy(),
    activa: cuenta?.activa ?? true,
  });
  const guardar = useMutation({
    mutationFn: () =>
      api(cuenta ? `/cuentas-bancarias/${cuenta.id}` : '/cuentas-bancarias', {
        metodo: cuenta ? 'PATCH' : 'POST',
        cuerpo: { banco: f.banco, nombre: f.nombre, numero: f.numero || null, saldoInicial: Number(f.saldoInicial || 0), fechaSaldoInicial: f.fechaSaldoInicial, activa: f.activa },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['cuentas-bancarias'] });
      alCerrar();
    },
  });
  return (
    <Cajon
      titulo={cuenta ? 'Editar cuenta bancaria' : 'Nueva cuenta bancaria'}
      alCerrar={alCerrar}
      pie={<><button className="btn" onClick={alCerrar}>Cancelar</button><button className="btn pri" disabled={guardar.isPending} onClick={() => guardar.mutate()}>Guardar</button></>}
    >
      <div className="form">
        <ErrorApi error={guardar.error} />
        <Campo etiqueta="Banco" id="cb-b"><input id="cb-b" className="entrada" value={f.banco} onChange={(e) => setF({ ...f, banco: e.target.value })} /></Campo>
        <div className="fila-campos">
          <Campo etiqueta="Nombre de la cuenta" id="cb-n"><input id="cb-n" className="entrada" placeholder="Cuenta corriente" value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} /></Campo>
          <Campo etiqueta="Número (opcional)" id="cb-nu"><input id="cb-nu" className="entrada" value={f.numero} onChange={(e) => setF({ ...f, numero: e.target.value })} /></Campo>
        </div>
        <div className="fila-campos">
          <Campo etiqueta="Saldo inicial (Gs.)" id="cb-s"><input id="cb-s" className="entrada num" value={miles(f.saldoInicial)} onChange={(e) => setF({ ...f, saldoInicial: soloNumero(e.target.value) })} /></Campo>
          <Campo etiqueta="Fecha del saldo inicial" id="cb-f"><input id="cb-f" type="date" className="entrada" value={f.fechaSaldoInicial} onChange={(e) => setF({ ...f, fechaSaldoInicial: e.target.value })} /></Campo>
        </div>
        {cuenta && (
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked={f.activa} onChange={(e) => setF({ ...f, activa: e.target.checked })} /> Cuenta activa
          </label>
        )}
      </div>
    </Cajon>
  );
}

const TIPOS: Record<string, string> = {
  deposito: 'Depósito',
  extraccion: 'Extracción',
  transferencia_entrada: 'Transferencia recibida',
  transferencia_salida: 'Transferencia enviada',
  pago_proveedor: 'Pago a proveedor',
  cobro: 'Cobro',
  deposito_caja: 'Depósito de caja',
  gasto: 'Gasto bancario',
  ingreso: 'Ingreso bancario',
  anulacion: 'Anulación',
};

function ExtractoCuenta({ cuenta, otras, alCerrar }: { cuenta: CuentaBancaria; otras: CuentaBancaria[]; alCerrar: () => void }) {
  const { puede } = useSesion();
  const qc = useQueryClient();
  const [desde, setDesde] = useState(inicioMes());
  const [hasta, setHasta] = useState(hoy());
  const [accion, setAccion] = useState<'movimiento' | 'transferencia' | 'caja' | null>(null);
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const ext = useQuery({ queryKey: ['extracto', cuenta.id, desde, hasta], queryFn: () => api<Extracto>(`/cuentas-bancarias/${cuenta.id}/movimientos?desde=${desde}&hasta=${hasta}`) });
  const refrescar = () => {
    void qc.invalidateQueries({ queryKey: ['extracto'] });
    void qc.invalidateQueries({ queryKey: ['cuentas-bancarias'] });
  };
  const conciliar = useMutation({
    mutationFn: (conciliado: boolean) => api('/movimientos-bancarios/conciliar', { metodo: 'POST', cuerpo: { ids: [...marcados], conciliado } }),
    onSuccess: () => {
      setMarcados(new Set());
      refrescar();
    },
  });
  const alternar = (id: string) => {
    const s = new Set(marcados);
    if (s.has(id)) s.delete(id);
    else s.add(id);
    setMarcados(s);
  };
  const marcadosConciliados = ext.data?.items.filter((m) => marcados.has(m.id) && m.conciliado).length ?? 0;
  return (
    <Cajon titulo={`${cuenta.banco} · ${cuenta.nombre}`} alCerrar={alCerrar} ancho={860}>
      <div className="cifras panel">
        <div className="cifra"><span>Saldo</span><b className="num">{dinero(cuenta.saldo)}</b></div>
        <div className="cifra"><span>Saldo conciliado</span><b className="num">{dinero(cuenta.saldoConciliado)}</b></div>
        <div className="cifra"><span>Sin conciliar</span><b className="num">{cuenta.sinConciliar}</b></div>
      </div>
      {puede('banco.crear') && cuenta.activa && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className={`btn${accion === 'movimiento' ? ' pri' : ''}`} onClick={() => setAccion(accion === 'movimiento' ? null : 'movimiento')}><Plus size={16} /> Movimiento</button>
          {otras.length > 0 && <button className={`btn${accion === 'transferencia' ? ' pri' : ''}`} onClick={() => setAccion(accion === 'transferencia' ? null : 'transferencia')}><ArrowLeftRight size={16} /> Transferir</button>}
          <button className={`btn${accion === 'caja' ? ' pri' : ''}`} onClick={() => setAccion(accion === 'caja' ? null : 'caja')}><Vault size={16} /> Depositar efectivo de caja</button>
        </div>
      )}
      {accion && <AccionBancaria tipo={accion} cuenta={cuenta} otras={otras} alTerminar={() => { setAccion(null); refrescar(); }} />}
      <div className="filtros" style={{ padding: 0 }}>
        <Campo etiqueta="Desde" id="ex-d"><input id="ex-d" type="date" className="entrada" value={desde} onChange={(e) => setDesde(e.target.value)} /></Campo>
        <Campo etiqueta="Hasta" id="ex-h"><input id="ex-h" type="date" className="entrada" value={hasta} onChange={(e) => setHasta(e.target.value)} /></Campo>
      </div>
      <ErrorApi error={ext.error ?? conciliar.error} />
      {!ext.data ? (
        <Cargando />
      ) : (
        <>
          <table>
            <thead>
              <tr>{puede('banco.editar') && <th style={{ width: 32 }} />}<th>Fecha</th><th>Detalle</th><th className="der">Entrada</th><th className="der">Salida</th><th className="der">Saldo</th><th>Estado</th></tr>
            </thead>
            <tbody>
              <tr>
                {puede('banco.editar') && <td />}
                <td className="tenue">{fechaCorta(desde)}</td><td className="tenue">Saldo anterior</td><td /><td />
                <td className="der num" style={{ fontWeight: 600 }}>{dinero(ext.data.saldoInicial)}</td><td />
              </tr>
              {ext.data.items.map((m) => (
                <tr key={m.id}>
                  {puede('banco.editar') && <td><input type="checkbox" aria-label="Seleccionar" checked={marcados.has(m.id)} onChange={() => alternar(m.id)} /></td>}
                  <td className="tenue">{fechaCorta(m.fecha)}</td>
                  <td>
                    <span className="peq tenue">{TIPOS[m.tipo] ?? m.tipo} · </span>{m.descripcion}
                    {m.referencia && <span className="tenue peq"> · {m.referencia}</span>}
                  </td>
                  <td className="der num">{Number(m.monto) > 0 ? dinero(m.monto) : ''}</td>
                  <td className="der num">{Number(m.monto) < 0 ? dinero(Math.abs(Number(m.monto))) : ''}</td>
                  <td className="der num" style={{ fontWeight: 600 }}>{dinero(m.saldo)}</td>
                  <td>{m.conciliado ? <span className="insignia i-ok">Conciliado</span> : <span className="insignia i-warn">Pendiente</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!ext.data.items.length && <Vacio titulo="Sin movimientos en el período" />}
          {marcados.size > 0 && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span className="tenue peq">{marcados.size} seleccionados</span>
              {marcadosConciliados < marcados.size && <button className="btn pri" disabled={conciliar.isPending} onClick={() => conciliar.mutate(true)}><CheckCircle2 size={16} /> Marcar como conciliados</button>}
              {marcadosConciliados > 0 && <button className="btn" disabled={conciliar.isPending} onClick={() => conciliar.mutate(false)}>Quitar conciliación</button>}
            </div>
          )}
          <p className="tenue peq" style={{ margin: 0 }}>Conciliar es marcar los movimientos que ya figuran en el extracto del banco: el saldo conciliado debe coincidir con el del banco.</p>
        </>
      )}
    </Cajon>
  );
}

function AccionBancaria({ tipo, cuenta, otras, alTerminar }: { tipo: 'movimiento' | 'transferencia' | 'caja'; cuenta: CuentaBancaria; otras: CuentaBancaria[]; alTerminar: () => void }) {
  const { puede } = useSesion();
  const qc = useQueryClient();
  const [f, setF] = useState({ tipoMov: 'deposito', fecha: hoy(), monto: '', descripcion: '', referencia: '', destinoId: otras[0]?.id ?? '' });
  const cajas = useQuery({ queryKey: ['cajas'], queryFn: () => api<CajaFila[]>('/cajas'), enabled: tipo === 'caja' && puede('caja.ver') });
  const propia = cajas.data?.find((c) => c.sesion?.propia);
  const enviar = useMutation({
    mutationFn: () => {
      const base = { fecha: f.fecha, monto: Number(f.monto), referencia: f.referencia || null };
      if (tipo === 'movimiento') return api(`/cuentas-bancarias/${cuenta.id}/movimientos`, { metodo: 'POST', cuerpo: { ...base, tipo: f.tipoMov, descripcion: f.descripcion } });
      if (tipo === 'transferencia') return api(`/cuentas-bancarias/${cuenta.id}/transferencia`, { metodo: 'POST', cuerpo: { ...base, destinoId: f.destinoId } });
      return api(`/cuentas-bancarias/${cuenta.id}/deposito-caja`, { metodo: 'POST', cuerpo: { ...base, cajaId: propia?.id } });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['cajas'] });
      alTerminar();
    },
  });
  const listo = Number(f.monto) > 0 && (tipo !== 'movimiento' || f.descripcion.trim().length >= 3) && (tipo !== 'caja' || propia) && (tipo !== 'transferencia' || f.destinoId);
  return (
    <div className="form" style={{ borderTop: '1px solid var(--linea)', borderBottom: '1px solid var(--linea)', padding: '14px 0' }}>
      <ErrorApi error={enviar.error} />
      {tipo === 'caja' && !propia && <Aviso tipo="info">Para depositar el efectivo, abra su caja en "Cajas y PDV".</Aviso>}
      <div className="fila-campos">
        {tipo === 'movimiento' && (
          <Campo etiqueta="Tipo" id="ab-t">
            <select id="ab-t" className="entrada" value={f.tipoMov} onChange={(e) => setF({ ...f, tipoMov: e.target.value })}>
              <option value="deposito">Depósito</option>
              <option value="extraccion">Extracción</option>
              <option value="gasto">Gasto bancario (comisión, impuesto)</option>
              <option value="ingreso">Ingreso bancario (intereses)</option>
            </select>
          </Campo>
        )}
        {tipo === 'transferencia' && (
          <Campo etiqueta="Cuenta de destino" id="ab-d">
            <select id="ab-d" className="entrada" value={f.destinoId} onChange={(e) => setF({ ...f, destinoId: e.target.value })}>
              {otras.map((c) => <option key={c.id} value={c.id}>{c.banco} · {c.nombre}</option>)}
            </select>
          </Campo>
        )}
        {tipo === 'caja' && propia && <Campo etiqueta="Caja" id="ab-c"><input id="ab-c" className="entrada" disabled value={propia.nombre} /></Campo>}
        <Campo etiqueta="Fecha" id="ab-f"><input id="ab-f" type="date" className="entrada" value={f.fecha} onChange={(e) => setF({ ...f, fecha: e.target.value })} /></Campo>
        <Campo etiqueta="Monto (Gs.)" id="ab-m"><input id="ab-m" className="entrada num" value={miles(f.monto)} onChange={(e) => setF({ ...f, monto: soloNumero(e.target.value) })} /></Campo>
      </div>
      <div className="fila-campos">
        {tipo === 'movimiento' && <Campo etiqueta="Descripción" id="ab-de"><input id="ab-de" className="entrada" value={f.descripcion} onChange={(e) => setF({ ...f, descripcion: e.target.value })} /></Campo>}
        <Campo etiqueta="Referencia (opcional)" id="ab-r"><input id="ab-r" className="entrada" placeholder="N.º de boleta u operación" value={f.referencia} onChange={(e) => setF({ ...f, referencia: e.target.value })} /></Campo>
      </div>
      <div><button className="btn pri" disabled={!listo || enviar.isPending} onClick={() => enviar.mutate()}><CheckCircle2 size={16} /> Registrar</button></div>
    </div>
  );
}
