import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Plus, Search } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { validarRuc } from '@kontiva/shared';
import { Aviso, Cajon, Campo, Cargando, Encabezado, ErrorApi, Vacio } from '../componentes/ui';
import { fechaHora } from '../lib/formato';
import { dinero, ESTADO_SUSCRIPCION, fecha, hoy, master, RUBROS, sumarDias, type EmpresaMaster, type PagoMaster, type PlanMaster } from './cliente';

export function Empresas() {
  const [q, setQ] = useState('');
  const [abierta, setAbierta] = useState<string | 'nueva' | null>(null);
  const lista = useQuery({ queryKey: ['m-empresas'], queryFn: () => master.api<EmpresaMaster[]>('/empresas') });
  const filtro = q.trim().toLowerCase();
  const filas = (lista.data ?? []).filter(
    (e) => !filtro || [e.nombre, e.razonSocial, e.ruc, e.propietario?.email].some((v) => v?.toLowerCase().includes(filtro)),
  );
  const suspendidas = (lista.data ?? []).filter((e) => e.estado === 'suspendida').length;
  const vencidas = (lista.data ?? []).filter((e) => e.suscripcion && e.suscripcion.estado !== 'al_dia').length;

  return (
    <>
      <Encabezado titulo="Empresas">
        <button className="btn pri" onClick={() => setAbierta('nueva')}>
          <Plus size={16} /> Nueva empresa
        </button>
      </Encabezado>
      <div className="contenido">
        {lista.data && (
          <section className="panel">
            <div className="cifras">
              <div className="cifra">
                <span>Empresas</span>
                <b className="num">{lista.data.length}</b>
              </div>
              <div className="cifra">
                <span>Activas</span>
                <b className="num">{lista.data.length - suspendidas}</b>
              </div>
              <div className="cifra">
                <span>Con pago pendiente</span>
                <b className="num" style={{ color: vencidas ? 'var(--warn)' : undefined }}>
                  {vencidas}
                </b>
              </div>
              <div className="cifra">
                <span>Suspendidas</span>
                <b className="num" style={{ color: suspendidas ? 'var(--bad)' : undefined }}>
                  {suspendidas}
                </b>
              </div>
            </div>
          </section>
        )}
        <section className="panel">
          <div className="filtros" style={{ paddingTop: 16 }}>
            <div style={{ position: 'relative', flex: '1 1 280px', maxWidth: 420 }}>
              <Search size={16} style={{ position: 'absolute', left: 12, top: 10, color: 'var(--t3)' }} />
              <input className="entrada" style={{ paddingLeft: 36, width: '100%' }} placeholder="Buscar por nombre, RUC o correo" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
          </div>
          {lista.isLoading ? (
            <Cargando />
          ) : lista.error ? (
            <div className="panel-cuerpo">
              <ErrorApi error={lista.error} />
            </div>
          ) : filas.length === 0 ? (
            <Vacio titulo={filtro ? 'Sin resultados' : 'Todavía no hay empresas'} accion={!filtro && <button className="btn pri" onClick={() => setAbierta('nueva')}>Dar de alta la primera</button>} />
          ) : (
            <div className="desplazar">
              <table>
                <thead>
                  <tr>
                    <th>Empresa</th>
                    <th>Plan</th>
                    <th>Estado</th>
                    <th>Suscripción</th>
                    <th className="der">Usuarios</th>
                    <th>Último acceso</th>
                  </tr>
                </thead>
                <tbody>
                  {filas.map((e) => (
                    <tr key={e.id} className="clic" onClick={() => setAbierta(e.id)}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{e.nombre}</div>
                        <div className="tenue peq">
                          {RUBROS[e.rubro] ?? e.rubro}
                          {e.ruc ? ` · RUC ${e.ruc}` : ''}
                        </div>
                      </td>
                      <td>
                        <span className="insignia i-p">{e.plan}</span>
                      </td>
                      <td>{e.estado === 'activa' ? <span className="insignia i-ok">Activa</span> : <span className="insignia i-bad">Suspendida</span>}</td>
                      <td>
                        <span className={`insignia ${ESTADO_SUSCRIPCION[e.suscripcion?.estado ?? 'sin_control'].clase}`}>{ESTADO_SUSCRIPCION[e.suscripcion?.estado ?? 'sin_control'].texto}</span>
                        {e.suscripcion && <div className="tenue peq">vence {fecha(e.suscripcion.venceEn)}</div>}
                      </td>
                      <td className="der num">{e.usuariosActivos}</td>
                      <td className="tenue peq">{e.ultimoAcceso ? fechaHora(e.ultimoAcceso) : e.propietario?.pendiente ? 'Invitación pendiente' : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
      {abierta === 'nueva' && <NuevaEmpresa alCerrar={() => setAbierta(null)} alCrear={(id) => setAbierta(id)} />}
      {abierta && abierta !== 'nueva' && <FichaEmpresa id={abierta} alCerrar={() => setAbierta(null)} />}
    </>
  );
}

function Enlace({ url }: { url: string }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <input className="entrada mono" readOnly value={url} onFocus={(e) => e.target.select()} />
      <button
        type="button"
        className="btn chico"
        onClick={() => {
          void navigator.clipboard?.writeText(url);
          setCopiado(true);
        }}
      >
        <Copy size={14} /> {copiado ? 'Copiado' : 'Copiar'}
      </button>
    </div>
  );
}

function NuevaEmpresa({ alCerrar, alCrear }: { alCerrar: () => void; alCrear: (id: string) => void }) {
  const qc = useQueryClient();
  const planes = useQuery({ queryKey: ['m-planes'], queryFn: () => master.api<PlanMaster[]>('/planes') });
  const [d, setD] = useState({
    razonSocial: '',
    nombreFantasia: '',
    ruc: '',
    rubro: 'general',
    planCodigo: 'START',
    email: '',
    nombre: '',
    conSuscripcion: true,
    ciclo: 'mensual' as 'mensual' | 'anual',
    precio: '',
    moneda: 'PYG' as 'PYG' | 'USD' | 'BRL',
    venceEn: sumarDias(hoy(), 30),
    diasGracia: '7',
  });
  const [resultado, setResultado] = useState<{ empresaId: string; enlaceInvitacion: string | null } | null>(null);
  const plan = planes.data?.find((p) => p.codigo === d.planCodigo);
  const rucMal = d.ruc.trim() !== '' && !validarRuc(d.ruc.trim());
  const set = (k: keyof typeof d) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setD({ ...d, [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value });

  const crear = useMutation({
    mutationFn: () =>
      master.api<{ empresaId: string; enlaceInvitacion: string | null }>('/empresas', {
        metodo: 'POST',
        cuerpo: {
          razonSocial: d.razonSocial,
          nombreFantasia: d.nombreFantasia || null,
          ruc: d.ruc.trim() || null,
          rubro: d.rubro,
          planCodigo: d.planCodigo,
          propietario: { email: d.email, nombre: d.nombre },
          suscripcion: d.conSuscripcion
            ? { ciclo: d.ciclo, precio: d.precio || plan?.[d.ciclo === 'anual' ? 'precioAnual' : 'precioMensual'] || 0, moneda: d.moneda, venceEn: d.venceEn, diasGracia: d.diasGracia }
            : null,
        },
      }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['m-empresas'] });
      setResultado(r);
    },
  });

  if (resultado) {
    return (
      <Cajon titulo="Empresa creada" alCerrar={alCerrar} pie={<button className="btn pri" onClick={() => alCrear(resultado.empresaId)}>Ver la empresa</button>}>
        <Aviso tipo="ok">La empresa está lista y vacía. Se envió el correo de bienvenida al Propietario.</Aviso>
        {resultado.enlaceInvitacion ? (
          <Campo etiqueta="Enlace para que el Propietario cree su contraseña (válido 7 días)" ayuda="Si el correo no llega, envíeselo por WhatsApp.">
            <Enlace url={resultado.enlaceInvitacion} />
          </Campo>
        ) : (
          <p className="tenue">El Propietario ya usa KONTIVA: entra con su contraseña de siempre.</p>
        )}
      </Cajon>
    );
  }

  const valido = d.razonSocial.trim().length >= 2 && /\S+@\S+\.\S+/.test(d.email) && d.nombre.trim().length >= 2 && !rucMal;
  return (
    <Cajon
      titulo="Nueva empresa"
      alCerrar={alCerrar}
      pie={
        <>
          <button className="btn" onClick={alCerrar}>
            Cancelar
          </button>
          <button className="btn pri" disabled={!valido || crear.isPending} onClick={() => crear.mutate()}>
            Crear y enviar invitación
          </button>
        </>
      }
    >
      <ErrorApi error={crear.error} />
      <div className="seccion-form">
        <h3>Empresa</h3>
        <div className="form">
          <Campo etiqueta="Razón social" id="rs">
            <input id="rs" className="entrada" value={d.razonSocial} onChange={set('razonSocial')} />
          </Campo>
          <div className="fila-campos">
            <Campo etiqueta="Nombre de fantasía" id="nf">
              <input id="nf" className="entrada" value={d.nombreFantasia} onChange={set('nombreFantasia')} />
            </Campo>
            <Campo etiqueta="RUC (opcional)" id="ruc" error={rucMal ? 'Dígito verificador incorrecto' : undefined} ayuda="80012345-6">
              <input id="ruc" className="entrada num" value={d.ruc} onChange={set('ruc')} aria-invalid={rucMal} />
            </Campo>
          </div>
          <div className="fila-campos">
            <Campo etiqueta="Rubro" id="rub">
              <select id="rub" className="entrada" value={d.rubro} onChange={set('rubro')}>
                {Object.entries(RUBROS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo etiqueta="Plan" id="pl">
              <select id="pl" className="entrada" value={d.planCodigo} onChange={set('planCodigo')}>
                {planes.data?.filter((p) => p.activo).map((p) => (
                  <option key={p.id} value={p.codigo}>
                    {p.nombre} · {p.maxUsuarios ?? '∞'} usuarios · {p.maxSucursales ?? '∞'} sucursales
                  </option>
                ))}
              </select>
            </Campo>
          </div>
        </div>
      </div>
      <div className="seccion-form">
        <h3>Propietario</h3>
        <div className="fila-campos">
          <Campo etiqueta="Nombre" id="pn">
            <input id="pn" className="entrada" value={d.nombre} onChange={set('nombre')} />
          </Campo>
          <Campo etiqueta="Correo" id="pe">
            <input id="pe" className="entrada" type="email" value={d.email} onChange={set('email')} />
          </Campo>
        </div>
        {plan?.exige2faPropietario && <p className="tenue peq">Este plan exige verificación en dos pasos al Propietario: la configurará en su primer ingreso.</p>}
      </div>
      <div className="seccion-form">
        <h3>Suscripción</h3>
        <label className="casilla" style={{ marginBottom: 12 }}>
          <input type="checkbox" checked={d.conSuscripcion} onChange={set('conSuscripcion')} /> Controlar vencimiento y suspender por falta de pago
        </label>
        {d.conSuscripcion && <CamposSuscripcion d={d} set={set} plan={plan} />}
      </div>
    </Cajon>
  );
}

interface DatosSus {
  ciclo: 'mensual' | 'anual';
  precio: string;
  moneda: 'PYG' | 'USD' | 'BRL';
  venceEn: string;
  diasGracia: string;
}

function CamposSuscripcion<T extends DatosSus>({ d, set, plan }: { d: T; set: (k: keyof T & string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => void; plan?: PlanMaster }) {
  const sugerido = plan?.[d.ciclo === 'anual' ? 'precioAnual' : 'precioMensual'];
  return (
    <div className="form">
      <div className="fila-campos">
        <Campo etiqueta="Ciclo" id="ci">
          <select id="ci" className="entrada" value={d.ciclo} onChange={set('ciclo')}>
            <option value="mensual">Mensual</option>
            <option value="anual">Anual</option>
          </select>
        </Campo>
        <Campo etiqueta="Precio" id="pr" ayuda={sugerido ? `Precio del plan: ${dinero(sugerido)}` : 'El plan no tiene precio cargado'}>
          <input id="pr" className="entrada num" inputMode="decimal" placeholder={sugerido ?? '0'} value={d.precio} onChange={set('precio')} />
        </Campo>
        <Campo etiqueta="Moneda" id="mo">
          <select id="mo" className="entrada" value={d.moneda} onChange={set('moneda')}>
            <option value="PYG">Guaraníes</option>
            <option value="USD">Dólares</option>
            <option value="BRL">Reales</option>
          </select>
        </Campo>
      </div>
      <div className="fila-campos">
        <Campo etiqueta="Vence el" id="ve">
          <input id="ve" className="entrada" type="date" value={d.venceEn} onChange={set('venceEn')} />
        </Campo>
        <Campo etiqueta="Días de gracia" id="dg" ayuda="Después de estos días, se suspende sola.">
          <input id="dg" className="entrada num" inputMode="numeric" value={d.diasGracia} onChange={set('diasGracia')} />
        </Campo>
      </div>
    </div>
  );
}

type Detalle = EmpresaMaster & { pagos: PagoMaster[] };

function Fila({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 12, padding: '6px 0', borderBottom: '1px solid var(--linea2)' }}>
      <span className="tenue" style={{ width: 150, flex: 'none' }}>
        {etiqueta}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>{children}</span>
    </div>
  );
}

function FichaEmpresa({ id, alCerrar }: { id: string; alCerrar: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['m-empresa', id], queryFn: () => master.api<Detalle>(`/empresas/${id}`) });
  const planes = useQuery({ queryKey: ['m-planes'], queryFn: () => master.api<PlanMaster[]>('/planes') });
  const [panel, setPanel] = useState<'nada' | 'suscripcion' | 'pago'>('nada');
  const [enlace, setEnlace] = useState<string | null>(null);
  const actualizar = (r: Detalle) => {
    qc.setQueryData(['m-empresa', id], r);
    void qc.invalidateQueries({ queryKey: ['m-empresas'] });
  };
  const accion = useMutation({
    mutationFn: ({ ruta, metodo = 'POST', cuerpo }: { ruta: string; metodo?: string; cuerpo?: unknown }) => master.api<Detalle>(`/empresas/${id}${ruta}`, { metodo, cuerpo }),
    onSuccess: (r) => {
      actualizar(r);
      setPanel('nada');
    },
  });
  const invitar = useMutation({
    mutationFn: () => master.api<{ enlaceInvitacion: string }>(`/empresas/${id}/invitacion`, { metodo: 'POST' }),
    onSuccess: (r) => setEnlace(r.enlaceInvitacion),
  });

  const e = q.data;
  if (!e) return <Cajon titulo="Empresa" alCerrar={alCerrar}>{q.error ? <ErrorApi error={q.error} /> : <Cargando />}</Cajon>;
  const s = e.suscripcion;

  return (
    <Cajon titulo={e.nombre} alCerrar={alCerrar}>
      <ErrorApi error={accion.error ?? invitar.error} />
      <div>
        <Fila etiqueta="Razón social">{e.razonSocial}</Fila>
        <Fila etiqueta="RUC">{e.ruc ?? '—'}</Fila>
        <Fila etiqueta="Rubro">{RUBROS[e.rubro] ?? e.rubro}</Fila>
        <Fila etiqueta="Alta">{fechaHora(e.creadoEn)}</Fila>
        <Fila etiqueta="Uso">
          {e.usuariosActivos} usuario{e.usuariosActivos === 1 ? '' : 's'} · {e.sucursalesActivas} sucursal{e.sucursalesActivas === 1 ? '' : 'es'}
        </Fila>
        <Fila etiqueta="Último acceso">{e.ultimoAcceso ? fechaHora(e.ultimoAcceso) : '—'}</Fila>
        <Fila etiqueta="Propietario">
          {e.propietario ? (
            <>
              {e.propietario.nombre} · {e.propietario.email}
              {e.propietario.pendiente && (
                <div style={{ marginTop: 6 }}>
                  <span className="insignia i-warn">No creó su contraseña</span>{' '}
                  <button className="enlace" onClick={() => invitar.mutate()}>
                    Reenviar invitación
                  </button>
                </div>
              )}
            </>
          ) : (
            '—'
          )}
        </Fila>
      </div>
      {enlace && (
        <Campo etiqueta="Enlace de invitación (válido 7 días)">
          <Enlace url={enlace} />
        </Campo>
      )}

      <div className="seccion-form">
        <h3>Plan y estado</h3>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <select className="entrada" style={{ width: 'auto' }} value={e.plan} onChange={(ev) => accion.mutate({ ruta: '/plan', metodo: 'PATCH', cuerpo: { planCodigo: ev.target.value } })}>
            {planes.data?.map((p) => (
              <option key={p.id} value={p.codigo} disabled={!p.activo}>
                {p.nombre}
              </option>
            ))}
          </select>
          {e.estado === 'activa' ? (
            <button className="btn peligro" onClick={() => confirm(`¿Suspender ${e.nombre}? Sus usuarios no podrán operar hasta que la reactive.`) && accion.mutate({ ruta: '/suspender' })}>
              Suspender
            </button>
          ) : (
            <>
              <span className="insignia i-bad">Suspendida{s?.motivoSuspension === 'falta_pago' ? ' por falta de pago' : ''}</span>
              <button className="btn" onClick={() => accion.mutate({ ruta: '/reactivar' })}>
                Reactivar
              </button>
            </>
          )}
        </div>
      </div>

      <div className="seccion-form">
        <h3>Suscripción</h3>
        {s ? (
          <div>
            <Fila etiqueta="Estado">
              <span className={`insignia ${ESTADO_SUSCRIPCION[s.estado].clase}`}>{ESTADO_SUSCRIPCION[s.estado].texto}</span>
            </Fila>
            <Fila etiqueta="Precio">
              {dinero(s.precio, s.moneda)} {s.ciclo === 'anual' ? 'por año' : 'por mes'}
            </Fila>
            <Fila etiqueta="Vence">
              {fecha(s.venceEn)} · {s.diasGracia} días de gracia
            </Fila>
            <Fila etiqueta="Suspensión automática">{s.suspensionAutomatica ? 'Sí' : 'No'}</Fila>
          </div>
        ) : (
          <p className="tenue peq" style={{ margin: 0 }}>
            Sin control de vencimiento.
          </p>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          {s && (
            <button className="btn pri chico" onClick={() => setPanel('pago')}>
              Registrar pago
            </button>
          )}
          <button className="btn chico" onClick={() => setPanel('suscripcion')}>
            {s ? 'Editar suscripción' : 'Configurar suscripción'}
          </button>
        </div>
        {panel === 'suscripcion' && <FormSuscripcion actual={s} plan={planes.data?.find((p) => p.codigo === e.plan)} alGuardar={(cuerpo) => accion.mutate({ ruta: '/suscripcion', metodo: 'PUT', cuerpo })} alCancelar={() => setPanel('nada')} />}
        {panel === 'pago' && s && <FormPago moneda={s.moneda} precio={s.precio} alGuardar={(cuerpo) => accion.mutate({ ruta: '/pagos', cuerpo })} alCancelar={() => setPanel('nada')} />}
      </div>

      <div className="seccion-form">
        <h3>Pagos</h3>
        {e.pagos.length === 0 ? (
          <p className="tenue peq" style={{ margin: 0 }}>
            Sin pagos registrados.
          </p>
        ) : (
          <table>
            <tbody>
              {e.pagos.map((p) => (
                <tr key={p.id} style={p.anulado ? { opacity: 0.55 } : undefined}>
                  <td className="peq num">{fecha(p.fecha)}</td>
                  <td className="num" style={{ fontWeight: 600, textDecoration: p.anulado ? 'line-through' : undefined }}>
                    {dinero(p.monto, p.moneda)}
                  </td>
                  <td className="tenue peq">
                    {p.metodo}
                    {p.referencia ? ` · ${p.referencia}` : ''}
                    <br />
                    cubre hasta {fecha(p.periodoHasta)} · {p.registradoPor}
                    {p.anulado && <div style={{ color: 'var(--bad)' }}>Anulado: {p.motivoAnulacion}</div>}
                  </td>
                  <td className="der">
                    {!p.anulado && (
                      <button
                        className="enlace"
                        onClick={() => {
                          const motivo = prompt('Motivo de la anulación');
                          if (motivo && motivo.trim().length >= 3) accion.mutate({ ruta: `/pagos/${p.id}/anular`, cuerpo: { motivo } });
                        }}
                      >
                        Anular
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Cajon>
  );
}

function FormSuscripcion({ actual, plan, alGuardar, alCancelar }: { actual: EmpresaMaster['suscripcion']; plan?: PlanMaster; alGuardar: (c: unknown) => void; alCancelar: () => void }) {
  const [d, setD] = useState({
    ciclo: actual?.ciclo ?? ('mensual' as const),
    precio: actual ? String(Number(actual.precio)) : '',
    moneda: actual?.moneda ?? ('PYG' as const),
    venceEn: actual?.venceEn ?? sumarDias(hoy(), 30),
    diasGracia: String(actual?.diasGracia ?? 7),
    suspensionAutomatica: actual?.suspensionAutomatica ?? true,
  });
  const set = (k: keyof typeof d) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setD({ ...d, [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value });
  return (
    <div className="panel" style={{ padding: 16, marginTop: 12 }}>
      <CamposSuscripcion d={d} set={set} plan={plan} />
      <label className="casilla" style={{ margin: '12px 0' }}>
        <input type="checkbox" checked={d.suspensionAutomatica} onChange={set('suspensionAutomatica')} /> Suspender automáticamente al vencer la gracia
      </label>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn pri chico" onClick={() => alGuardar({ ...d, precio: d.precio || plan?.[d.ciclo === 'anual' ? 'precioAnual' : 'precioMensual'] || 0 })}>
          Guardar
        </button>
        <button className="btn chico" onClick={alCancelar}>
          Cancelar
        </button>
      </div>
    </div>
  );
}

function FormPago({ moneda, precio, alGuardar, alCancelar }: { moneda: string; precio: string; alGuardar: (c: unknown) => void; alCancelar: () => void }) {
  const [d, setD] = useState({ monto: String(Number(precio)), moneda, fecha: hoy(), metodo: 'transferencia', referencia: '' });
  const set = (k: keyof typeof d) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setD({ ...d, [k]: e.target.value });
  return (
    <div className="panel" style={{ padding: 16, marginTop: 12 }}>
      <div className="form">
        <div className="fila-campos">
          <Campo etiqueta="Monto" id="pm">
            <input id="pm" className="entrada num" inputMode="decimal" value={d.monto} onChange={set('monto')} />
          </Campo>
          <Campo etiqueta="Fecha del pago" id="pf">
            <input id="pf" type="date" className="entrada" value={d.fecha} onChange={set('fecha')} />
          </Campo>
        </div>
        <div className="fila-campos">
          <Campo etiqueta="Método" id="pmet">
            <select id="pmet" className="entrada" value={d.metodo} onChange={set('metodo')}>
              <option value="transferencia">Transferencia</option>
              <option value="efectivo">Efectivo</option>
              <option value="tarjeta">Tarjeta</option>
              <option value="otro">Otro</option>
            </select>
          </Campo>
          <Campo etiqueta="Referencia" id="pref">
            <input id="pref" className="entrada" placeholder="N.º de comprobante" value={d.referencia} onChange={set('referencia')} />
          </Campo>
        </div>
        <p className="tenue peq" style={{ margin: 0 }}>
          El vencimiento se extiende un ciclo. Si estaba suspendida por falta de pago, se reactiva.
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn pri chico" disabled={!(Number(d.monto) > 0)} onClick={() => alGuardar({ ...d, referencia: d.referencia || null })}>
            Registrar pago
          </button>
          <button className="btn chico" onClick={alCancelar}>
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
