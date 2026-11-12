import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, ShoppingCart } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DialogoAutorizacion } from '../componentes/Autorizacion';
import { Aviso, Cajon, Campo, Cargando, Encabezado, ErrorApi, Vacio } from '../componentes/ui';
import { api } from '../lib/api';
import { fechaHora } from '../lib/formato';
import { dinero, NOMBRE_MEDIO, type CajaFila, type Cotizacion, type Deposito, type Moneda, type SesionCaja } from '../lib/operacion';
import { useSesion } from '../lib/sesion';

export function Cajas() {
  const { puede, yo } = useSesion();
  const navigate = useNavigate();
  const cajas = useQuery({ queryKey: ['cajas'], queryFn: () => api<CajaFila[]>('/cajas') });
  const [abierta, setAbierta] = useState<{ tipo: 'abrir' | 'sesion' | 'nueva'; caja?: CajaFila } | null>(null);
  const sucursales = yo?.sucursales ?? [];

  return (
    <>
      <Encabezado titulo="Cajas">
        {puede('caja.editar') && (
          <button className="btn pri" onClick={() => setAbierta({ tipo: 'nueva' })}>
            <Plus size={16} /> Nueva caja
          </button>
        )}
      </Encabezado>
      <div className="contenido">
        <section className="panel">
          {cajas.isLoading ? (
            <Cargando />
          ) : !cajas.data?.length ? (
            <Vacio titulo="Todavía no hay cajas" accion={puede('caja.editar') && <button className="btn pri" onClick={() => setAbierta({ tipo: 'nueva' })}>Crear la primera caja</button>}>
              Cada caja vende desde un depósito de su sucursal.
            </Vacio>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Caja</th>
                  <th>Sucursal</th>
                  <th>Estado</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {cajas.data.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{c.nombre}</div>
                      <div className="tenue peq">Stock de {c.deposito.nombre}</div>
                    </td>
                    <td>{c.sucursal.nombre}</td>
                    <td>
                      {!c.activa ? (
                        <span className="insignia i-n">Desactivada</span>
                      ) : c.sesion ? (
                        <>
                          <span className="insignia i-ok">Abierta</span>
                          <div className="tenue peq">
                            {c.sesion.usuario.nombre} · desde {fechaHora(c.sesion.abiertaEn)}
                          </div>
                        </>
                      ) : (
                        <span className="insignia i-n">Cerrada</span>
                      )}
                    </td>
                    <td className="der">
                      <div style={{ display: 'inline-flex', gap: 8 }}>
                        {c.sesion?.propia && puede('venta.crear') && (
                          <button className="btn pri chico" onClick={() => navigate(`/pdv/${c.id}`)}>
                            <ShoppingCart size={14} /> Vender
                          </button>
                        )}
                        {c.sesion && (
                          <button className="btn chico" onClick={() => setAbierta({ tipo: 'sesion', caja: c })}>
                            Ver caja
                          </button>
                        )}
                        {!c.sesion && c.activa && puede('caja.crear') && (
                          <button className="btn chico" onClick={() => setAbierta({ tipo: 'abrir', caja: c })}>
                            Abrir caja
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        {sucursales.map((s) => (
          <Cotizaciones key={s.id} sucursal={s} />
        ))}
      </div>
      {abierta?.tipo === 'nueva' && <NuevaCaja alCerrar={() => setAbierta(null)} />}
      {abierta?.tipo === 'abrir' && abierta.caja && (
        <AbrirCaja
          caja={abierta.caja}
          alCerrar={() => setAbierta(null)}
          alAbrir={() => {
            setAbierta(null);
            navigate(`/pdv/${abierta.caja!.id}`);
          }}
        />
      )}
      {abierta?.tipo === 'sesion' && abierta.caja && <FichaSesion caja={abierta.caja} alCerrar={() => setAbierta(null)} />}
    </>
  );
}

function NuevaCaja({ alCerrar }: { alCerrar: () => void }) {
  const qc = useQueryClient();
  const depositos = useQuery({ queryKey: ['depositos'], queryFn: () => api<Deposito[]>('/depositos') });
  const [nombre, setNombre] = useState('Caja 1');
  const [depositoId, setDepositoId] = useState('');
  const dep = depositos.data?.find((d) => d.id === (depositoId || depositos.data?.[0]?.id));
  const crear = useMutation({
    mutationFn: () => api('/cajas', { metodo: 'POST', cuerpo: { nombre, sucursalId: dep!.sucursal.id, depositoId: dep!.id } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['cajas'] });
      alCerrar();
    },
  });
  return (
    <Cajon titulo="Nueva caja" alCerrar={alCerrar} pie={<button className="btn pri" disabled={!dep || !nombre.trim() || crear.isPending} onClick={() => crear.mutate()}>Crear caja</button>}>
      <ErrorApi error={crear.error} />
      <Campo etiqueta="Nombre" id="cn" ayuda="Aparece en los comprobantes (ej. Caja 1, Caja rápida).">
        <input id="cn" className="entrada" value={nombre} onChange={(e) => setNombre(e.target.value)} />
      </Campo>
      <Campo etiqueta="Vende el stock de" id="cd">
        <select id="cd" className="entrada" value={dep?.id ?? ''} onChange={(e) => setDepositoId(e.target.value)}>
          {depositos.data?.map((d) => (
            <option key={d.id} value={d.id}>
              {d.sucursal.codigo} · {d.sucursal.nombre} · {d.nombre}
            </option>
          ))}
        </select>
      </Campo>
    </Cajon>
  );
}

function AbrirCaja({ caja, alCerrar, alAbrir }: { caja: CajaFila; alCerrar: () => void; alAbrir: () => void }) {
  const qc = useQueryClient();
  const [fondos, setFondos] = useState<Record<Moneda, string>>({ PYG: '', USD: '', BRL: '' });
  const abrir = useMutation({
    mutationFn: () => api(`/cajas/${caja.id}/abrir`, { metodo: 'POST', cuerpo: { fondos: (Object.keys(fondos) as Moneda[]).filter((m) => Number(fondos[m]) > 0).map((m) => ({ moneda: m, monto: Number(fondos[m]) })) } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['cajas'] });
      alAbrir();
    },
  });
  return (
    <Cajon titulo={`Abrir ${caja.nombre}`} alCerrar={alCerrar} pie={<button className="btn pri" disabled={abrir.isPending} onClick={() => abrir.mutate()}>Abrir y empezar a vender</button>}>
      <ErrorApi error={abrir.error} />
      <p className="tenue" style={{ margin: 0 }}>Cuente el efectivo con el que empieza (fondo para dar vuelto).</p>
      {(['PYG', 'USD', 'BRL'] as Moneda[]).map((m) => (
        <Campo key={m} etiqueta={`Fondo en ${m === 'PYG' ? 'guaraníes' : m === 'USD' ? 'dólares' : 'reales'}`} id={`f${m}`}>
          <input id={`f${m}`} className="entrada num" inputMode="decimal" value={fondos[m]} onChange={(e) => setFondos({ ...fondos, [m]: e.target.value.replace(/[^0-9.]/g, '') })} />
        </Campo>
      ))}
    </Cajon>
  );
}

function FichaSesion({ caja, alCerrar }: { caja: CajaFila; alCerrar: () => void }) {
  const { puede, yo } = useSesion();
  const qc = useQueryClient();
  const sesion = useQuery({ queryKey: ['sesion-caja', caja.id], queryFn: () => api<SesionCaja | null>(`/cajas/${caja.id}/sesion`) });
  const [modo, setModo] = useState<'ver' | 'movimiento' | 'cerrar' | 'autorizar'>('ver');
  const [mov, setMov] = useState({ tipo: 'retiro' as 'retiro' | 'ingreso', moneda: 'PYG' as Moneda, monto: '', motivo: '' });
  const [autorizacion, setAutorizacion] = useState<string | null>(null);
  const [contado, setContado] = useState<Record<string, string>>({});
  const [cerrada, setCerrada] = useState<SesionCaja | null>(null);
  const s = sesion.data;

  const movimiento = useMutation({
    mutationFn: () => api<SesionCaja>(`/cajas/${caja.id}/movimientos`, { metodo: 'POST', cuerpo: { ...mov, monto: Number(mov.monto) }, encabezados: autorizacion ? { 'X-Autorizacion': autorizacion } : undefined }),
    onSuccess: (r) => {
      qc.setQueryData(['sesion-caja', caja.id], r);
      setModo('ver');
      setMov({ ...mov, monto: '', motivo: '' });
      setAutorizacion(null);
    },
  });
  const cerrar = useMutation({
    mutationFn: () =>
      api<SesionCaja>(`/cajas/${caja.id}/cerrar`, {
        metodo: 'POST',
        cuerpo: { contado: Object.entries(contado).filter(([, v]) => v !== '').map(([k, v]) => ({ moneda: k.split('|')[0], medio: k.split('|')[1], monto: Number(v) })) },
      }),
    onSuccess: (r) => {
      setCerrada(r);
      void qc.invalidateQueries({ queryKey: ['cajas'] });
    },
  });

  if (cerrada) {
    const conDif = cerrada.arqueo.filter((a) => Number(a.diferencia) !== 0);
    return (
      <Cajon titulo={`${caja.nombre} cerrada`} alCerrar={alCerrar} pie={<button className="btn pri" onClick={alCerrar}>Listo</button>}>
        {conDif.length === 0 ? <Aviso tipo="ok">El arqueo cuadra: sin diferencias.</Aviso> : <Aviso tipo="error">Hay diferencias en el arqueo. Quedaron registradas.</Aviso>}
        <TablaArqueo filas={cerrada.arqueo} />
        <p className="tenue peq">
          {cerrada.ventas.cantidad} ventas por {dinero(cerrada.ventas.total)} · {cerrada.ventas.anuladas} anuladas
        </p>
      </Cajon>
    );
  }

  const puedeCerrar = s && (s.usuario.id === yo?.usuario.id || puede('caja.aprobar')) && puede('arqueo.crear');
  return (
    <Cajon titulo={caja.nombre} alCerrar={alCerrar}>
      {!s ? (
        <Cargando />
      ) : (
        <>
          <ErrorApi error={movimiento.error ?? cerrar.error} />
          <p className="tenue" style={{ margin: 0 }}>
            Abierta por {s.usuario.nombre} el {fechaHora(s.abiertaEn)} · {s.ventas.cantidad} ventas por {dinero(s.ventas.total)}
            {s.ventas.anuladas ? ` · ${s.ventas.anuladas} anuladas` : ''}
          </p>
          {modo === 'ver' && (
            <>
              <div className="seccion-form">
                <h3>En caja según el sistema</h3>
                <table>
                  <tbody>
                    {s.esperado.length === 0 && (
                      <tr>
                        <td className="tenue">Sin movimientos</td>
                      </tr>
                    )}
                    {s.esperado.map((e) => (
                      <tr key={`${e.moneda}${e.medio}`}>
                        <td>{NOMBRE_MEDIO[e.medio]}</td>
                        <td className="der num" style={{ fontWeight: 600 }}>{dinero(e.monto, e.moneda)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {s.movimientos.length > 0 && (
                <div className="seccion-form">
                  <h3>Fondo, retiros e ingresos</h3>
                  <table>
                    <tbody>
                      {s.movimientos.map((m, i) => (
                        <tr key={i}>
                          <td className="peq">{fechaHora(m.creado_en)}</td>
                          <td>{m.tipo === 'apertura' ? 'Fondo inicial' : m.tipo === 'retiro' ? 'Retiro' : 'Ingreso'}</td>
                          <td className="tenue peq">{m.motivo}</td>
                          <td className="der num">{dinero(m.monto, m.moneda)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {puede('caja.crear') && (
                  <button className="btn" onClick={() => setModo(puede('caja.aprobar') ? 'movimiento' : 'autorizar')}>
                    Retiro o ingreso
                  </button>
                )}
                {puedeCerrar && (
                  <button className="btn pri" onClick={() => setModo('cerrar')}>
                    Cerrar caja
                  </button>
                )}
              </div>
            </>
          )}
          {modo === 'autorizar' && (
            <DialogoAutorizacion
              permiso="caja.aprobar"
              titulo="Autorizar retiro o ingreso"
              alAutorizar={(t) => {
                setAutorizacion(t);
                setModo('movimiento');
              }}
              alCerrar={() => setModo('ver')}
            />
          )}
          {modo === 'movimiento' && (
            <form className="form" onSubmit={(e) => { e.preventDefault(); movimiento.mutate(); }}>
              <div className="fila-campos">
                <Campo etiqueta="Tipo" id="mt">
                  <select id="mt" className="entrada" value={mov.tipo} onChange={(e) => setMov({ ...mov, tipo: e.target.value as 'retiro' | 'ingreso' })}>
                    <option value="retiro">Retiro (sale efectivo)</option>
                    <option value="ingreso">Ingreso (entra efectivo)</option>
                  </select>
                </Campo>
                <Campo etiqueta="Moneda" id="mm">
                  <select id="mm" className="entrada" value={mov.moneda} onChange={(e) => setMov({ ...mov, moneda: e.target.value as Moneda })}>
                    <option value="PYG">Guaraníes</option>
                    <option value="USD">Dólares</option>
                    <option value="BRL">Reales</option>
                  </select>
                </Campo>
              </div>
              <Campo etiqueta="Monto" id="mmo">
                <input id="mmo" className="entrada num" inputMode="decimal" value={mov.monto} onChange={(e) => setMov({ ...mov, monto: e.target.value.replace(/[^0-9.]/g, '') })} />
              </Campo>
              <Campo etiqueta="Motivo" id="mmot">
                <input id="mmot" className="entrada" placeholder="Depósito al banco, pago a proveedor…" value={mov.motivo} onChange={(e) => setMov({ ...mov, motivo: e.target.value })} />
              </Campo>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn pri" disabled={!(Number(mov.monto) > 0) || mov.motivo.trim().length < 3 || movimiento.isPending}>Registrar</button>
                <button type="button" className="btn" onClick={() => setModo('ver')}>Cancelar</button>
              </div>
            </form>
          )}
          {modo === 'cerrar' && (
            <form className="form" onSubmit={(e) => { e.preventDefault(); cerrar.mutate(); }}>
              <Aviso tipo="info">Cuente el dinero y escriba lo que hay. La diferencia con el sistema queda registrada.</Aviso>
              {s.esperado.map((e) => {
                const k = `${e.moneda}|${e.medio}`;
                return (
                  <Campo key={k} etiqueta={`${NOMBRE_MEDIO[e.medio]} · ${e.moneda}`} id={k} ayuda={`Según el sistema: ${dinero(e.monto, e.moneda)}`}>
                    <input id={k} className="entrada num" inputMode="decimal" value={contado[k] ?? ''} onChange={(ev) => setContado({ ...contado, [k]: ev.target.value.replace(/[^0-9.]/g, '') })} />
                  </Campo>
                );
              })}
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn pri" disabled={cerrar.isPending || s.esperado.some((e) => (contado[`${e.moneda}|${e.medio}`] ?? '') === '')}>Cerrar caja</button>
                <button type="button" className="btn" onClick={() => setModo('ver')}>Volver</button>
              </div>
            </form>
          )}
        </>
      )}
    </Cajon>
  );
}

export function TablaArqueo({ filas }: { filas: SesionCaja['arqueo'] }) {
  return (
    <table>
      <thead>
        <tr>
          <th>Medio</th>
          <th className="der">Sistema</th>
          <th className="der">Contado</th>
          <th className="der">Diferencia</th>
        </tr>
      </thead>
      <tbody>
        {filas.map((a) => (
          <tr key={`${a.moneda}${a.medio}`}>
            <td>
              {NOMBRE_MEDIO[a.medio]} · {a.moneda}
            </td>
            <td className="der num">{dinero(a.esperado, a.moneda)}</td>
            <td className="der num">{dinero(a.contado, a.moneda)}</td>
            <td className="der num" style={{ fontWeight: 700, color: Number(a.diferencia) < 0 ? 'var(--bad)' : Number(a.diferencia) > 0 ? 'var(--warn)' : 'var(--ok)' }}>
              {dinero(a.diferencia, a.moneda)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Cotizaciones({ sucursal }: { sucursal: { id: string; nombre: string } }) {
  const { puede } = useSesion();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['cotizaciones', sucursal.id], queryFn: () => api<{ vigentes: Cotizacion[] }>(`/cotizaciones?sucursalId=${sucursal.id}`), enabled: puede('caja.ver') });
  const [d, setD] = useState({ moneda: 'USD' as 'USD' | 'BRL', compra: '', venta: '' });
  const cargar = useMutation({
    mutationFn: () => api('/cotizaciones', { metodo: 'POST', cuerpo: { sucursalId: sucursal.id, moneda: d.moneda, compra: Number(d.compra), venta: Number(d.venta) } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['cotizaciones', sucursal.id] });
      setD({ ...d, compra: '', venta: '' });
    },
  });
  return (
    <section className="panel">
      <div className="panel-cab">
        <h2>Cotización del día · {sucursal.nombre}</h2>
        <span className="sub">Guaraníes por unidad. Compra: cuando el cliente paga en esa moneda. Venta: vuelto en esa moneda.</span>
      </div>
      <div className="panel-cuerpo form">
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          {q.data?.vigentes.length === 0 && <span className="tenue">Sin cotizaciones: el PDV solo acepta guaraníes.</span>}
          {q.data?.vigentes.map((c) => (
            <div key={c.moneda}>
              <b>{c.moneda}</b>{' '}
              <span className="num">
                compra {Number(c.compra).toLocaleString('es-PY')} · venta {Number(c.venta).toLocaleString('es-PY')}
              </span>
              <div className="tenue peq">desde {fechaHora(c.creado_en)}</div>
            </div>
          ))}
        </div>
        {puede('caja.editar') && (
          <>
            <ErrorApi error={cargar.error} />
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <Campo etiqueta="Moneda" id={`cm${sucursal.id}`}>
                <select id={`cm${sucursal.id}`} className="entrada" value={d.moneda} onChange={(e) => setD({ ...d, moneda: e.target.value as 'USD' | 'BRL' })}>
                  <option value="USD">Dólar</option>
                  <option value="BRL">Real</option>
                </select>
              </Campo>
              <Campo etiqueta="Compra" id={`cc${sucursal.id}`}>
                <input id={`cc${sucursal.id}`} className="entrada num" inputMode="decimal" value={d.compra} onChange={(e) => setD({ ...d, compra: e.target.value.replace(/[^0-9.]/g, '') })} />
              </Campo>
              <Campo etiqueta="Venta" id={`cv${sucursal.id}`}>
                <input id={`cv${sucursal.id}`} className="entrada num" inputMode="decimal" value={d.venta} onChange={(e) => setD({ ...d, venta: e.target.value.replace(/[^0-9.]/g, '') })} />
              </Campo>
              <button className="btn" style={{ marginBottom: 1 }} disabled={!(Number(d.compra) > 0) || !(Number(d.venta) > 0) || cargar.isPending} onClick={() => cargar.mutate()}>
                Actualizar
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
