import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileSignature, Pencil, Plus, Search, UserMinus, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Cajon, Campo, Cargando, Encabezado, ErrorApi, Vacio } from '../componentes/ui';
import { api, type SucursalFila } from '../lib/api';
import { dinero } from '../lib/operacion';
import { useSesion } from '../lib/sesion';

export interface Funcionario {
  id: string;
  sucursalId: string;
  sucursal?: string;
  nombre: string;
  documento: string;
  fechaNacimiento: string | null;
  telefono: string | null;
  email: string | null;
  direccion: string | null;
  cargo: string;
  fechaIngreso: string;
  fechaEgreso: string | null;
  motivoEgreso: string | null;
  activo: boolean;
  remuneracion: 'mensual' | 'jornal';
  salario?: string;
  hijos: number;
  aseguradoIps: boolean;
  numeroIps: string | null;
  banco: string | null;
  cuentaBancaria: string | null;
  nota: string | null;
  codigoReloj: string | null;
  horarioEntrada: string | null;
  horarioSalida: string | null;
  trabajaSabado: boolean;
  sabadoSalida: string | null;
  diasVacaciones: number;
}
interface Legajo extends Funcionario {
  liquidaciones: { id: string; tipo: 'mensual' | 'aguinaldo' | 'final'; periodo: string; estado: string; pagada: boolean; bruto: string; ipsObrero: string; descuentos: string; neto: string }[];
}

const hoy = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Asuncion' }).format(new Date());
const fechaCorta = (f: string | null) => (f ? f.split('-').reverse().join('/') : '—');
const soloNumero = (v: string) => v.replace(/[^0-9]/g, '');
const miles = (v: string) => (v === '' ? '' : Math.round(Number(v)).toLocaleString('es-PY'));
export const nombrePeriodo = (tipo: 'mensual' | 'aguinaldo' | 'final', periodo: string) =>
  tipo === 'final' ? 'Liquidación final' : tipo === 'aguinaldo' ? `Aguinaldo ${periodo.slice(0, 4)}` : new Intl.DateTimeFormat('es-PY', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${periodo}T12:00:00Z`)).replace(/^./, (c) => c.toUpperCase());
const antiguedad = (desde: string) => {
  const [a, m] = desde.split('-').map(Number) as [number, number];
  const [ha, hm] = hoy().split('-').map(Number) as [number, number];
  const meses = (ha - a) * 12 + (hm - m);
  if (meses < 1) return 'menos de un mes';
  const anios = Math.floor(meses / 12);
  const resto = meses % 12;
  return [anios ? `${anios} año${anios > 1 ? 's' : ''}` : '', resto ? `${resto} mes${resto > 1 ? 'es' : ''}` : ''].filter(Boolean).join(' y ');
};

export function Funcionarios() {
  const { puede } = useSesion();
  const [estado, setEstado] = useState<'activos' | 'bajas' | 'todos'>('activos');
  const [buscar, setBuscar] = useState('');
  const [editando, setEditando] = useState<Funcionario | 'nuevo' | null>(null);
  const [abierto, setAbierto] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['funcionarios', estado, buscar], queryFn: () => api<Funcionario[]>(`/funcionarios?estado=${estado}${buscar ? `&buscar=${encodeURIComponent(buscar)}` : ''}`), placeholderData: (p) => p });
  const verSalario = puede('salario.ver');
  return (
    <>
      <Encabezado titulo="Funcionarios">
        {puede('funcionario.crear') && <button className="btn pri" onClick={() => setEditando('nuevo')}><Plus size={16} /> Nuevo funcionario</button>}
      </Encabezado>
      <div className="contenido">
        <section className="panel">
          <div className="filtros" style={{ paddingTop: 16 }}>
            <Campo etiqueta="Buscar" id="fu-b">
              <div style={{ position: 'relative' }}>
                <Search size={15} style={{ position: 'absolute', left: 10, top: 11, color: 'var(--t3)' }} />
                <input id="fu-b" className="entrada" style={{ paddingLeft: 32, minWidth: 260 }} placeholder="Nombre, cédula o cargo" value={buscar} onChange={(e) => setBuscar(e.target.value)} />
              </div>
            </Campo>
            <Campo etiqueta="Mostrar" id="fu-e">
              <select id="fu-e" className="entrada" value={estado} onChange={(e) => setEstado(e.target.value as typeof estado)}>
                <option value="activos">Activos</option>
                <option value="bajas">Dados de baja</option>
                <option value="todos">Todos</option>
              </select>
            </Campo>
          </div>
          <ErrorApi error={q.error} />
          {!q.data ? (
            <Cargando />
          ) : !q.data.length ? (
            <Vacio titulo={estado === 'activos' && !buscar ? 'Todavía no hay funcionarios' : 'Sin resultados'}>
              {estado === 'activos' && !buscar && 'Cargue el legajo de cada funcionario para liquidar sueldos, aguinaldo y aportes al IPS.'}
            </Vacio>
          ) : (
            <table>
              <thead>
                <tr><th>Funcionario</th><th>Cédula</th><th>Cargo</th><th>Sucursal</th><th>Ingreso</th>{verSalario && <th className="der">Salario</th>}<th>IPS</th></tr>
              </thead>
              <tbody>
                {q.data.map((f) => (
                  <tr key={f.id} className="clic" style={f.activo ? undefined : { opacity: 0.6 }} onClick={() => setAbierto(f.id)}>
                    <td style={{ fontWeight: 600 }}>{f.nombre}{!f.activo && <span className="insignia i-n" style={{ marginLeft: 8 }}>Baja {fechaCorta(f.fechaEgreso)}</span>}</td>
                    <td className="num">{f.documento}</td>
                    <td>{f.cargo}</td>
                    <td className="tenue">{f.sucursal}</td>
                    <td className="tenue">{fechaCorta(f.fechaIngreso)}</td>
                    {verSalario && <td className="der num">{f.salario ? `${dinero(f.salario)}${f.remuneracion === 'jornal' ? ' por día' : ''}` : '—'}</td>}
                    <td>{f.aseguradoIps ? <span className="insignia i-ok">Asegurado</span> : <span className="insignia i-n">No</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
      {editando && <FormFuncionario funcionario={editando === 'nuevo' ? null : editando} alCerrar={() => setEditando(null)} />}
      {abierto && !editando && <LegajoFuncionario id={abierto} alCerrar={() => setAbierto(null)} alEditar={(f) => setEditando(f)} />}
    </>
  );
}

function FormFuncionario({ funcionario, alCerrar }: { funcionario: Funcionario | null; alCerrar: () => void }) {
  const { puede } = useSesion();
  const qc = useQueryClient();
  const sucursales = useQuery({ queryKey: ['sucursales'], queryFn: () => api<SucursalFila[]>('/sucursales') });
  const editaSalario = puede('salario.editar');
  const [f, setF] = useState({
    sucursalId: funcionario?.sucursalId ?? '',
    nombre: funcionario?.nombre ?? '',
    documento: funcionario?.documento ?? '',
    fechaNacimiento: funcionario?.fechaNacimiento ?? '',
    telefono: funcionario?.telefono ?? '',
    email: funcionario?.email ?? '',
    direccion: funcionario?.direccion ?? '',
    cargo: funcionario?.cargo ?? '',
    fechaIngreso: funcionario?.fechaIngreso ?? hoy(),
    remuneracion: funcionario?.remuneracion ?? 'mensual',
    salario: funcionario?.salario ? String(Math.round(Number(funcionario.salario))) : '',
    hijos: String(funcionario?.hijos ?? 0),
    aseguradoIps: funcionario?.aseguradoIps ?? true,
    numeroIps: funcionario?.numeroIps ?? '',
    banco: funcionario?.banco ?? '',
    cuentaBancaria: funcionario?.cuentaBancaria ?? '',
    nota: funcionario?.nota ?? '',
    codigoReloj: funcionario?.codigoReloj ?? '',
    horarioEntrada: funcionario?.horarioEntrada ?? '',
    horarioSalida: funcionario?.horarioSalida ?? '',
    trabajaSabado: funcionario?.trabajaSabado ?? true,
    sabadoSalida: funcionario?.sabadoSalida ?? '',
  });
  const sucursalId = f.sucursalId || sucursales.data?.[0]?.id || '';
  const guardar = useMutation({
    mutationFn: () =>
      api(funcionario ? `/funcionarios/${funcionario.id}` : '/funcionarios', {
        metodo: funcionario ? 'PATCH' : 'POST',
        cuerpo: {
          ...f,
          sucursalId,
          fechaNacimiento: f.fechaNacimiento || null,
          hijos: Number(f.hijos || 0),
          salario: editaSalario && f.salario !== '' ? Number(f.salario) : undefined,
        },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['funcionarios'] });
      void qc.invalidateQueries({ queryKey: ['funcionario'] });
      alCerrar();
    },
  });
  const t = (k: keyof typeof f) => ({ value: f[k] as string, onChange: (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value }) });
  return (
    <Cajon
      titulo={funcionario ? funcionario.nombre : 'Nuevo funcionario'}
      ancho={720}
      alCerrar={alCerrar}
      pie={<><button className="btn" onClick={alCerrar}>Cancelar</button><button className="btn pri" disabled={guardar.isPending || !sucursalId} onClick={() => guardar.mutate()}>Guardar</button></>}
    >
      <div className="form">
        <ErrorApi error={guardar.error} />
        <h3 className="subtitulo" style={{ margin: 0 }}>Datos personales</h3>
        <div className="fila-campos">
          <Campo etiqueta="Nombre completo" id="ff-n"><input id="ff-n" className="entrada" {...t('nombre')} /></Campo>
          <Campo etiqueta="Cédula" id="ff-d"><input id="ff-d" className="entrada num" {...t('documento')} /></Campo>
        </div>
        <div className="fila-campos">
          <Campo etiqueta="Fecha de nacimiento" id="ff-fn"><input id="ff-fn" type="date" className="entrada" {...t('fechaNacimiento')} /></Campo>
          <Campo etiqueta="Teléfono" id="ff-t"><input id="ff-t" className="entrada" {...t('telefono')} /></Campo>
          <Campo etiqueta="Correo" id="ff-e"><input id="ff-e" type="email" className="entrada" {...t('email')} /></Campo>
        </div>
        <Campo etiqueta="Dirección" id="ff-di"><input id="ff-di" className="entrada" {...t('direccion')} /></Campo>
        <h3 className="subtitulo" style={{ margin: '6px 0 0' }}>Contrato</h3>
        <div className="fila-campos">
          <Campo etiqueta="Cargo" id="ff-c"><input id="ff-c" className="entrada" {...t('cargo')} /></Campo>
          <Campo etiqueta="Sucursal" id="ff-s">
            <select id="ff-s" className="entrada" value={sucursalId} onChange={(e) => setF({ ...f, sucursalId: e.target.value })}>
              {sucursales.data?.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          </Campo>
          <Campo etiqueta="Fecha de ingreso" id="ff-fi"><input id="ff-fi" type="date" className="entrada" {...t('fechaIngreso')} /></Campo>
        </div>
        <div className="fila-campos">
          <Campo etiqueta="Remuneración" id="ff-r">
            <select id="ff-r" className="entrada" disabled={!editaSalario} value={f.remuneracion} onChange={(e) => setF({ ...f, remuneracion: e.target.value as 'mensual' | 'jornal' })}>
              <option value="mensual">Mensual</option>
              <option value="jornal">Por jornal (día trabajado)</option>
            </select>
          </Campo>
          {editaSalario && (
            <Campo etiqueta={f.remuneracion === 'mensual' ? 'Salario mensual (Gs.)' : 'Jornal (Gs. por día)'} id="ff-sa">
              <input id="ff-sa" className="entrada num" value={miles(f.salario)} onChange={(e) => setF({ ...f, salario: soloNumero(e.target.value) })} />
            </Campo>
          )}
          <Campo etiqueta="Hijos menores de 17" id="ff-h" ayuda="Para la bonificación familiar.">
            <input id="ff-h" className="entrada num" value={f.hijos} onChange={(e) => setF({ ...f, hijos: soloNumero(e.target.value).slice(0, 2) })} />
          </Campo>
        </div>
        <div className="fila-campos" style={{ alignItems: 'flex-end' }}>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', paddingBottom: 10 }}>
            <input type="checkbox" checked={f.aseguradoIps} onChange={(e) => setF({ ...f, aseguradoIps: e.target.checked })} /> Asegurado en el IPS
          </label>
          <Campo etiqueta="N.º de asegurado" id="ff-ni"><input id="ff-ni" className="entrada" {...t('numeroIps')} /></Campo>
        </div>
        <div className="fila-campos">
          <Campo etiqueta="Banco para el sueldo (opcional)" id="ff-b"><input id="ff-b" className="entrada" {...t('banco')} /></Campo>
          <Campo etiqueta="N.º de cuenta" id="ff-cb"><input id="ff-cb" className="entrada" {...t('cuentaBancaria')} /></Campo>
        </div>
        <h3 className="subtitulo" style={{ margin: '6px 0 0' }}>Horario y reloj de asistencia</h3>
        <div className="fila-campos">
          <Campo etiqueta="Entrada" id="ff-he"><input id="ff-he" type="time" className="entrada" {...t('horarioEntrada')} /></Campo>
          <Campo etiqueta="Salida" id="ff-hs"><input id="ff-hs" type="time" className="entrada" {...t('horarioSalida')} /></Campo>
          <Campo etiqueta="Código en el reloj" id="ff-cr" ayuda="El número con que marca; si no tiene, se usa la cédula.">
            <input id="ff-cr" className="entrada num" {...t('codigoReloj')} />
          </Campo>
        </div>
        <div className="fila-campos" style={{ alignItems: 'flex-end' }}>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', paddingBottom: 10 }}>
            <input type="checkbox" checked={f.trabajaSabado} onChange={(e) => setF({ ...f, trabajaSabado: e.target.checked })} /> Trabaja los sábados
          </label>
          {f.trabajaSabado && <Campo etiqueta="Salida del sábado (si es distinta)" id="ff-ss"><input id="ff-ss" type="time" className="entrada" {...t('sabadoSalida')} /></Campo>}
        </div>
        <Campo etiqueta="Nota" id="ff-no"><textarea id="ff-no" className="entrada" rows={2} {...t('nota')} /></Campo>
      </div>
    </Cajon>
  );
}

function LegajoFuncionario({ id, alCerrar, alEditar }: { id: string; alCerrar: () => void; alEditar: (f: Funcionario) => void }) {
  const { puede } = useSesion();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['funcionario', id], queryFn: () => api<Legajo>(`/funcionarios/${id}`) });
  const navigate = useNavigate();
  const [baja, setBaja] = useState(false);
  const [finiquito, setFiniquito] = useState(false);
  const [egreso, setEgreso] = useState(hoy());
  const [motivo, setMotivo] = useState('');
  const [motivoFinal, setMotivoFinal] = useState('renuncia');
  const vacaciones = useQuery({ queryKey: ['vacaciones', id], queryFn: () => api<{ pendientes: number }>(`/rrhh/vacaciones?funcionarioId=${id}`), enabled: puede('asistencia.ver') });
  const liquidar = useMutation({
    mutationFn: () => api<{ id: string }>('/liquidaciones/final', { metodo: 'POST', cuerpo: { funcionarioId: id, fechaEgreso: egreso, motivo: motivoFinal, detalleMotivo: motivo || null } }),
    onSuccess: (l) => navigate(`/sueldos?liquidacion=${l.id}`),
  });
  const refrescar = () => {
    void qc.invalidateQueries({ queryKey: ['funcionarios'] });
    void qc.invalidateQueries({ queryKey: ['funcionario', id] });
  };
  const darBaja = useMutation({ mutationFn: () => api(`/funcionarios/${id}/baja`, { metodo: 'POST', cuerpo: { fechaEgreso: egreso, motivo } }), onSuccess: () => { setBaja(false); refrescar(); } });
  const reingreso = useMutation({ mutationFn: () => api(`/funcionarios/${id}/reingreso`, { metodo: 'POST', cuerpo: { fechaIngreso: hoy() } }), onSuccess: refrescar });
  const f = q.data;
  return (
    <Cajon
      titulo={f?.nombre ?? 'Funcionario'}
      ancho={760}
      alCerrar={alCerrar}
      pie={
        f && puede('funcionario.editar') ? (
          <>
            {f.fechaEgreso ? (
              <button className="btn" disabled={reingreso.isPending} onClick={() => reingreso.mutate()}><UserPlus size={16} /> Reingreso hoy</button>
            ) : puede('salario.editar') ? (
              <button className="btn peligro" onClick={() => { setFiniquito(!finiquito); setBaja(false); }}><FileSignature size={16} /> Liquidación final</button>
            ) : (
              <button className="btn peligro" onClick={() => setBaja(!baja)}><UserMinus size={16} /> Dar de baja</button>
            )}
            <button className="btn pri" onClick={() => alEditar(f)}><Pencil size={16} /> Editar</button>
          </>
        ) : undefined
      }
    >
      {!f ? (
        <Cargando />
      ) : (
        <>
          <ErrorApi error={darBaja.error ?? reingreso.error ?? liquidar.error} />
          {finiquito && (
            <div className="form" style={{ borderBottom: '1px solid var(--linea)', paddingBottom: 14 }}>
              <div className="fila-campos">
                <Campo etiqueta="Fecha de egreso" id="lg-fe"><input id="lg-fe" type="date" className="entrada" value={egreso} onChange={(e) => setEgreso(e.target.value)} /></Campo>
                <Campo etiqueta="Motivo" id="lg-fm">
                  <select id="lg-fm" className="entrada" value={motivoFinal} onChange={(e) => setMotivoFinal(e.target.value)}>
                    <option value="renuncia">Renuncia</option>
                    <option value="despido_injustificado">Despido sin justa causa</option>
                    <option value="despido_justificado">Despido con justa causa</option>
                    <option value="mutuo_acuerdo">Mutuo acuerdo</option>
                    <option value="fin_contrato">Fin de contrato</option>
                  </select>
                </Campo>
              </div>
              <div className="fila-campos" style={{ alignItems: 'flex-end' }}>
                <Campo etiqueta="Detalle (opcional)" id="lg-fd"><input id="lg-fd" className="entrada" value={motivo} onChange={(e) => setMotivo(e.target.value)} /></Campo>
                <button className="btn pri" style={{ marginBottom: 2 }} disabled={liquidar.isPending} onClick={() => liquidar.mutate()}>Calcular liquidación</button>
              </div>
              <p className="tenue peq" style={{ margin: 0 }}>Se genera en borrador en "Sueldos y aguinaldo" para revisar. Al confirmarla, el legajo queda con la fecha y el motivo de egreso.</p>
            </div>
          )}
          {baja && (
            <div className="form" style={{ borderBottom: '1px solid var(--linea)', paddingBottom: 14 }}>
              <div className="fila-campos" style={{ alignItems: 'flex-end' }}>
                <Campo etiqueta="Fecha de egreso" id="lg-e"><input id="lg-e" type="date" className="entrada" value={egreso} onChange={(e) => setEgreso(e.target.value)} /></Campo>
                <Campo etiqueta="Motivo" id="lg-m"><input id="lg-m" className="entrada" placeholder="Renuncia, despido, fin de contrato" value={motivo} onChange={(e) => setMotivo(e.target.value)} /></Campo>
                <button className="btn peligro" style={{ marginBottom: 2 }} disabled={motivo.trim().length < 3 || darBaja.isPending} onClick={() => darBaja.mutate()}>Confirmar baja</button>
              </div>
              <p className="tenue peq" style={{ margin: 0 }}>El legajo no se borra. La liquidación final (días trabajados, aguinaldo, vacaciones, preaviso e indemnización) la genera quien administra salarios.</p>
            </div>
          )}
          <section className="panel cifras">
            <div className="cifra"><span>Antigüedad</span><b>{antiguedad(f.fechaIngreso)}</b></div>
            <div className="cifra"><span>Vacaciones por año</span><b className="num">{f.diasVacaciones ? `${f.diasVacaciones} días` : 'Desde el primer año'}</b></div>
            {vacaciones.data && <div className="cifra"><span>Vacaciones pendientes</span><b className="num">{vacaciones.data.pendientes.toLocaleString('es-PY')} días</b></div>}
            {f.salario !== undefined && <div className="cifra"><span>{f.remuneracion === 'mensual' ? 'Salario mensual' : 'Jornal'}</span><b className="num">{dinero(f.salario)}</b></div>}
          </section>
          <dl className="datos">
            <dt>Cédula</dt><dd className="num">{f.documento}</dd>
            <dt>Cargo</dt><dd>{f.cargo} · {f.sucursal}</dd>
            <dt>Ingreso</dt><dd>{fechaCorta(f.fechaIngreso)}{f.fechaEgreso && ` · egreso ${fechaCorta(f.fechaEgreso)} (${f.motivoEgreso})`}</dd>
            <dt>Nacimiento</dt><dd>{fechaCorta(f.fechaNacimiento)}</dd>
            <dt>Contacto</dt><dd>{[f.telefono, f.email].filter(Boolean).join(' · ') || '—'}</dd>
            <dt>Dirección</dt><dd>{f.direccion || '—'}</dd>
            <dt>IPS</dt><dd>{f.aseguradoIps ? `Asegurado${f.numeroIps ? ` N.º ${f.numeroIps}` : ''}` : 'No asegurado'}</dd>
            <dt>Hijos menores</dt><dd>{f.hijos}</dd>
            <dt>Horario</dt><dd>{f.horarioEntrada ? `${f.horarioEntrada} a ${f.horarioSalida}${f.trabajaSabado ? (f.sabadoSalida ? ` · sábados hasta ${f.sabadoSalida}` : ' · también sábados') : ' · sin sábados'}` : '—'}{f.codigoReloj && ` · reloj N.º ${f.codigoReloj}`}</dd>
            <dt>Cuenta para el sueldo</dt><dd>{f.banco ? `${f.banco} · ${f.cuentaBancaria ?? ''}` : '—'}</dd>
            {f.nota && <><dt>Nota</dt><dd>{f.nota}</dd></>}
          </dl>
          {puede('salario.ver') && (
            <>
              <h3 className="subtitulo" style={{ margin: 0 }}>Liquidaciones</h3>
              {!f.liquidaciones.length ? (
                <p className="tenue peq" style={{ margin: 0 }}>Todavía no tiene liquidaciones.</p>
              ) : (
                <table>
                  <thead><tr><th>Período</th><th className="der">Bruto</th><th className="der">IPS</th><th className="der">Descuentos</th><th className="der">Neto</th><th>Estado</th></tr></thead>
                  <tbody>
                    {f.liquidaciones.map((l) => (
                      <tr key={l.id + l.tipo}>
                        <td>{nombrePeriodo(l.tipo, l.periodo)}</td>
                        <td className="der num">{dinero(l.bruto)}</td>
                        <td className="der num">{dinero(l.ipsObrero)}</td>
                        <td className="der num">{dinero(l.descuentos)}</td>
                        <td className="der num" style={{ fontWeight: 600 }}>{dinero(l.neto)}</td>
                        <td>{l.estado === 'borrador' ? <span className="insignia i-warn">Borrador</span> : l.pagada ? <span className="insignia i-ok">Pagada</span> : <span className="insignia i-n">Confirmada</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </>
      )}
    </Cajon>
  );
}
