import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ChevronLeft, ChevronRight, Clock, Plus, Trash2, Upload, XCircle } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Aviso, Cajon, Campo, Cargando, Encabezado, ErrorApi, Vacio } from '../componentes/ui';
import { api } from '../lib/api';
import { useSesion } from '../lib/sesion';

type TipoNovedad = 'ausencia' | 'ausencia_justificada' | 'reposo' | 'permiso' | 'llegada_tardia' | 'horas_extra';
interface Novedad { id: string; funcionarioId: string; fecha: string; tipo: TipoNovedad; horas: string; recargo: 50 | 100 | null; observacion: string | null }
interface Marcacion { id: string; funcionarioId: string; fecha: string; hora: string; origen: 'reloj' | 'manual' }
interface Planilla {
  marcaciones: Marcacion[];
  funcionarios: { id: string; nombre: string; cargo: string; sucursal: string; fechaIngreso: string; fechaEgreso: string | null; remuneracion: 'mensual' | 'jornal' }[];
  novedades: Novedad[];
  vacaciones: { id: string; funcionarioId: string; desde: string; hasta: string; dias: string }[];
}
interface SaldoFila { funcionarioId: string; nombre: string; cargo: string; fechaIngreso: string; causados: number; gozados: number; ajustes: number; pendientes: number; proporcional: { meses: number; dias: number } }
interface SaldoDetalle {
  periodos: { anio: number; desde: string; dias: number }[];
  causados: number;
  gozados: number;
  ajustes: number;
  pendientes: number;
  proporcional: { meses: number; dias: number };
  registros: { id: string; tipo: 'goce' | 'ajuste'; desde: string | null; hasta: string | null; dias: string; observacion: string | null; estado: 'vigente' | 'anulada'; motivoAnulacion: string | null; creadoEn: string }[];
}

export const TIPOS_NOVEDAD: Record<TipoNovedad, { nombre: string; cod: string; ayuda: string }> = {
  ausencia: { nombre: 'Ausencia', cod: 'A', ayuda: 'Se descuenta del salario mensual.' },
  ausencia_justificada: { nombre: 'Ausencia justificada', cod: 'J', ayuda: 'Con permiso o constancia: no se descuenta.' },
  reposo: { nombre: 'Reposo médico', cod: 'R', ayuda: 'Se descuenta del salario: los días de reposo los cubre el IPS.' },
  permiso: { nombre: 'Permiso por horas', cod: 'P', ayuda: 'Queda registrado; no se descuenta.' },
  llegada_tardia: { nombre: 'Llegada tardía', cod: 'T', ayuda: 'Queda registrada; no se descuenta automáticamente.' },
  horas_extra: { nombre: 'Horas extra', cod: 'H', ayuda: 'Pasan a la planilla del mes: al 50 % las diurnas, al 100 % las nocturnas, domingos y feriados.' },
};

const hoy = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Asuncion' }).format(new Date());
const fechaCorta = (f: string | null) => (f ? f.split('-').reverse().join('/') : '—');
const diasMes = (mes: string) => new Date(Date.UTC(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0)).getUTCDate();
const moverMes = (mes: string, n: number) => {
  const d = new Date(`${mes}-01T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 7);
};
const nombreMes = (mes: string) => new Intl.DateTimeFormat('es-PY', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${mes}-01T12:00:00Z`)).replace(/^./, (c) => c.toUpperCase());
const LETRA_DIA = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];
const dias = (n: number) => `${n.toLocaleString('es-PY')} ${n === 1 ? 'día' : 'días'}`;
const horas = (h: string | number) => `${Number(h).toLocaleString('es-PY')} h`;
/** Duración legible: los retrasos y permisos cortos se leen mejor en minutos. */
const duracion = (h: string | number) => (Number(h) < 1 ? `${Math.round(Number(h) * 60)} min` : horas(h));

/** Días hábiles (lunes a sábado) entre dos fechas: valor sugerido para el goce de vacaciones. */
const habiles = (desde: string, hasta: string) => {
  let n = 0;
  for (let t = Date.parse(`${desde}T12:00:00Z`); t <= Date.parse(`${hasta}T12:00:00Z`); t += 86400000) if (new Date(t).getUTCDay() !== 0) n++;
  return n;
};

export function Asistencia() {
  const { puede } = useSesion();
  const [pestana, setPestana] = useState<'planilla' | 'vacaciones' | 'reloj'>('planilla');
  return (
    <>
      <Encabezado titulo="Asistencia y vacaciones" />
      <div className="contenido">
        <div className="pestanas">
          <button className={pestana === 'planilla' ? 'activa' : ''} onClick={() => setPestana('planilla')}>Planilla del mes</button>
          <button className={pestana === 'vacaciones' ? 'activa' : ''} onClick={() => setPestana('vacaciones')}>Vacaciones</button>
          {puede('asistencia.editar') && <button className={pestana === 'reloj' ? 'activa' : ''} onClick={() => setPestana('reloj')}>Reloj de asistencia</button>}
        </div>
        {pestana === 'planilla' ? <PlanillaAsistencia /> : pestana === 'vacaciones' ? <Vacaciones /> : <Reloj />}
      </div>
    </>
  );
}

function PlanillaAsistencia() {
  const { puede } = useSesion();
  const [mes, setMes] = useState(hoy().slice(0, 7));
  const [celda, setCelda] = useState<{ funcionarioId: string; fecha: string } | null>(null);
  const n = diasMes(mes);
  const q = useQuery({ queryKey: ['asistencia', mes], queryFn: () => api<Planilla>(`/rrhh/novedades?desde=${mes}-01&hasta=${mes}-${String(n).padStart(2, '0')}`), placeholderData: (p) => p });
  const editar = puede('asistencia.editar');
  const fechas = Array.from({ length: n }, (_, i) => `${mes}-${String(i + 1).padStart(2, '0')}`);
  const porCelda = useMemo(() => {
    const m = new Map<string, Novedad[]>();
    for (const x of q.data?.novedades ?? []) m.set(`${x.funcionarioId}|${x.fecha}`, [...(m.get(`${x.funcionarioId}|${x.fecha}`) ?? []), x]);
    return m;
  }, [q.data]);
  const marcasDe = (fid: string, fecha: string) => q.data?.marcaciones.filter((m) => m.funcionarioId === fid && m.fecha === fecha) ?? [];
  const enVacaciones = (fid: string, fecha: string) => q.data?.vacaciones.some((v) => v.funcionarioId === fid && v.desde <= fecha && v.hasta >= fecha);
  const totales = (fid: string) => {
    const ns = q.data?.novedades.filter((x) => x.funcionarioId === fid) ?? [];
    return {
      faltas: ns.filter((x) => x.tipo === 'ausencia' || x.tipo === 'reposo').length,
      h50: ns.filter((x) => x.tipo === 'horas_extra' && x.recargo === 50).reduce((s, x) => s + Number(x.horas), 0),
      h100: ns.filter((x) => x.tipo === 'horas_extra' && x.recargo === 100).reduce((s, x) => s + Number(x.horas), 0),
    };
  };
  const funcionario = celda && q.data?.funcionarios.find((f) => f.id === celda.funcionarioId);
  return (
    <section className="panel">
      <div className="filtros" style={{ paddingTop: 16, alignItems: 'center' }}>
        <button className="btn" aria-label="Mes anterior" onClick={() => setMes(moverMes(mes, -1))}><ChevronLeft size={16} /></button>
        <b style={{ minWidth: 150, textAlign: 'center' }}>{nombreMes(mes)}</b>
        <button className="btn" aria-label="Mes siguiente" disabled={mes >= hoy().slice(0, 7)} onClick={() => setMes(moverMes(mes, 1))}><ChevronRight size={16} /></button>
        <span className="tenue peq" style={{ marginLeft: 12 }}>
          {editar ? 'Toque un día para cargar o quitar novedades.' : 'Vista de consulta.'} Las ausencias, el reposo y las horas extra pasan a la planilla de sueldos del mes.
        </span>
      </div>
      <ErrorApi error={q.error} />
      {!q.data ? (
        <Cargando />
      ) : !q.data.funcionarios.length ? (
        <Vacio titulo="No hay funcionarios en este mes">Cargue los legajos en "Funcionarios".</Vacio>
      ) : (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table className="asistencia">
              <thead>
                <tr>
                  <th className="nombre">Funcionario</th>
                  {fechas.map((f) => {
                    const d = new Date(`${f}T12:00:00Z`).getUTCDay();
                    return <th key={f} className={`dia${d === 0 ? ' domingo' : ''}`}>{Number(f.slice(8))}<small>{LETRA_DIA[d]}</small></th>;
                  })}
                  <th className="der" style={{ padding: '0 10px' }}>Faltas</th>
                  <th className="der" style={{ padding: '0 10px' }}>HE 50 %</th>
                  <th className="der" style={{ padding: '0 10px' }}>HE 100 %</th>
                </tr>
              </thead>
              <tbody>
                {q.data.funcionarios.map((fu) => {
                  const t = totales(fu.id);
                  return (
                    <tr key={fu.id}>
                      <td className="nombre"><b>{fu.nombre}</b><small>{fu.cargo} · {fu.sucursal}</small></td>
                      {fechas.map((f) => {
                        const fuera = f < fu.fechaIngreso || (!!fu.fechaEgreso && f > fu.fechaEgreso);
                        const ns = porCelda.get(`${fu.id}|${f}`) ?? [];
                        const vac = enVacaciones(fu.id, f);
                        const marcas = marcasDe(fu.id, f);
                        const domingo = new Date(`${f}T12:00:00Z`).getUTCDay() === 0;
                        const edita = editar && !fuera;
                        return (
                          <td
                            key={f}
                            className={`celda${fuera ? ' fuera' : domingo ? ' domingo' : ''}${edita ? ' edita' : ''}`}
                            title={[vac ? 'Vacaciones' : '', marcas.length ? `Marcaciones: ${marcas.map((m) => m.hora).join(' · ')}` : '', ...ns.map((x) => TIPOS_NOVEDAD[x.tipo].nombre + (x.tipo === 'horas_extra' ? ` ${horas(x.horas)} al ${x.recargo} %` : ''))].filter(Boolean).join(' · ')}
                            onClick={edita ? () => setCelda({ funcionarioId: fu.id, fecha: f }) : undefined}
                          >
                            {vac && <span className="cod cod-V">V</span>}
                            {ns.map((x) => (
                              <span key={x.id} className={`cod cod-${TIPOS_NOVEDAD[x.tipo].cod}`}>{x.tipo === 'horas_extra' ? Number(x.horas) : TIPOS_NOVEDAD[x.tipo].cod}</span>
                            ))}
                            {!vac && !ns.length && marcas.length > 0 && <span className="marcado" aria-label="Con marcaciones" />}
                          </td>
                        );
                      })}
                      <td className="tot der">{t.faltas || '—'}</td>
                      <td className="tot der">{t.h50 ? t.h50.toLocaleString('es-PY') : '—'}</td>
                      <td className="tot der">{t.h100 ? t.h100.toLocaleString('es-PY') : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="leyenda">
            {Object.entries(TIPOS_NOVEDAD).map(([k, v]) => (
              <span key={k}><span className={`cod cod-${v.cod}`}>{k === 'horas_extra' ? '2' : v.cod}</span>{k === 'horas_extra' ? 'Horas extra (cantidad)' : v.nombre}</span>
            ))}
            <span><span className="cod cod-V">V</span>Vacaciones</span>
            <span><span className="marcado" />Marcó en el reloj</span>
          </div>
        </>
      )}
      {celda && funcionario && (
        <NovedadesDelDia
          funcionario={funcionario}
          fecha={celda.fecha}
          novedades={porCelda.get(`${celda.funcionarioId}|${celda.fecha}`) ?? []}
          marcaciones={marcasDe(celda.funcionarioId, celda.fecha)}
          alCerrar={() => setCelda(null)}
        />
      )}
    </section>
  );
}

function NovedadesDelDia({ funcionario, fecha, novedades, marcaciones, alCerrar }: { funcionario: Planilla['funcionarios'][number]; fecha: string; novedades: Novedad[]; marcaciones: Marcacion[]; alCerrar: () => void }) {
  const [horaManual, setHoraManual] = useState('');
  const marcar = useMutation({
    mutationFn: () => api('/rrhh/marcaciones', { metodo: 'POST', cuerpo: { funcionarioId: funcionario.id, fecha, hora: horaManual } }),
    onSuccess: () => {
      setHoraManual('');
      void qcMarcas.invalidateQueries({ queryKey: ['asistencia'] });
    },
  });
  const quitarMarca = useMutation({ mutationFn: (id: string) => api(`/rrhh/marcaciones/${id}`, { metodo: 'DELETE' }), onSuccess: () => void qcMarcas.invalidateQueries({ queryKey: ['asistencia'] }) });
  const qc = useQueryClient();
  const [tipo, setTipo] = useState<TipoNovedad>('ausencia');
  const [hasta, setHasta] = useState(fecha);
  const [cantHoras, setCantHoras] = useState('');
  const [recargo, setRecargo] = useState<50 | 100>(50);
  const [obs, setObs] = useState('');
  const refrescar = () => void qc.invalidateQueries({ queryKey: ['asistencia'] });
  const rango = tipo === 'ausencia' || tipo === 'ausencia_justificada' || tipo === 'reposo';
  const conHoras = tipo === 'horas_extra' || tipo === 'permiso' || tipo === 'llegada_tardia';
  const crear = useMutation({
    mutationFn: () =>
      api('/rrhh/novedades', {
        metodo: 'POST',
        cuerpo: {
          funcionarioId: funcionario.id,
          fecha,
          ...(rango && hasta > fecha && { hasta }),
          tipo,
          ...(conHoras && { horas: Number(cantHoras.replace(',', '.')) }),
          ...(tipo === 'horas_extra' && { recargo }),
          observacion: obs || null,
        },
      }),
    onSuccess: () => {
      refrescar();
      alCerrar();
    },
  });
  const quitar = useMutation({ mutationFn: (id: string) => api(`/rrhh/novedades/${id}`, { metodo: 'DELETE' }), onSuccess: refrescar });
  const qcMarcas = qc;
  const domingo = new Date(`${fecha}T12:00:00Z`).getUTCDay() === 0;
  return (
    <Cajon
      titulo={`${funcionario.nombre} · ${fechaCorta(fecha)}`}
      alCerrar={alCerrar}
      pie={<><button className="btn" onClick={alCerrar}>Cerrar</button><button className="btn pri" disabled={crear.isPending || (conHoras && !Number(cantHoras.replace(',', '.')))} onClick={() => crear.mutate()}><Plus size={16} /> Registrar</button></>}
    >
      <div className="form">
        <ErrorApi error={crear.error ?? quitar.error ?? marcar.error ?? quitarMarca.error} />
        <h3 className="subtitulo" style={{ margin: 0 }}>Marcaciones</h3>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {!marcaciones.length && <span className="tenue peq">Sin marcaciones.</span>}
          {marcaciones.map((m) => (
            <span key={m.id} className="insignia i-n" title={m.origen === 'manual' ? 'Cargada a mano' : 'Del reloj'}>
              <Clock size={12} /> {m.hora}{m.origen === 'manual' && ' (manual)'}
              <button aria-label={`Quitar ${m.hora}`} style={{ border: 0, background: 'none', padding: 0, display: 'flex', color: 'var(--t3)', cursor: 'pointer' }} onClick={() => quitarMarca.mutate(m.id)}><XCircle size={13} /></button>
            </span>
          ))}
          <input type="time" aria-label="Hora de la marcación" className="entrada" style={{ height: 30, width: 110 }} value={horaManual} onChange={(e) => setHoraManual(e.target.value)} />
          <button className="btn" style={{ height: 30 }} disabled={!horaManual || marcar.isPending} onClick={() => marcar.mutate()}><Plus size={14} /> Marcar</button>
        </div>
        {novedades.length > 0 && (
          <>
            <h3 className="subtitulo" style={{ margin: 0 }}>Registrado este día</h3>
            <table>
              <tbody>
                {novedades.map((x) => (
                  <tr key={x.id}>
                    <td><span className={`cod cod-${TIPOS_NOVEDAD[x.tipo].cod}`}>{TIPOS_NOVEDAD[x.tipo].cod}</span> {TIPOS_NOVEDAD[x.tipo].nombre}{Number(x.horas) ? ` · ${duracion(x.horas)}` : ''}{x.recargo ? ` al ${x.recargo} %` : ''}{x.observacion && <div className="tenue peq">{x.observacion}</div>}</td>
                    <td className="der"><button className="btn" aria-label="Quitar" style={{ height: 30, padding: '0 8px' }} disabled={quitar.isPending} onClick={() => quitar.mutate(x.id)}><Trash2 size={14} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        <h3 className="subtitulo" style={{ margin: 0 }}>Nueva novedad</h3>
        <Campo etiqueta="Tipo" id="nv-t" ayuda={TIPOS_NOVEDAD[tipo].ayuda}>
          <select id="nv-t" className="entrada" value={tipo} onChange={(e) => setTipo(e.target.value as TipoNovedad)}>
            {Object.entries(TIPOS_NOVEDAD).map(([k, v]) => <option key={k} value={k}>{v.nombre}</option>)}
          </select>
        </Campo>
        {rango && (
          <Campo etiqueta="Hasta (inclusive)" id="nv-h" ayuda="Para un reposo o una ausencia de varios días se registra un día por cada fecha.">
            <input id="nv-h" type="date" className="entrada" min={fecha} max={funcionario.fechaEgreso ?? undefined} value={hasta} onChange={(e) => setHasta(e.target.value)} />
          </Campo>
        )}
        {conHoras && (
          <div className="fila-campos">
            <Campo etiqueta="Horas" id="nv-c"><input id="nv-c" className="entrada num" inputMode="decimal" value={cantHoras} onChange={(e) => setCantHoras(e.target.value.replace(/[^0-9,.]/g, ''))} /></Campo>
            {tipo === 'horas_extra' && (
              <Campo etiqueta="Recargo" id="nv-r">
                <select id="nv-r" className="entrada" value={recargo} onChange={(e) => setRecargo(Number(e.target.value) as 50 | 100)}>
                  <option value={50}>50 % (diurnas)</option>
                  <option value={100}>100 % (nocturnas, domingos y feriados)</option>
                </select>
              </Campo>
            )}
          </div>
        )}
        {tipo === 'horas_extra' && domingo && recargo === 50 && <Aviso tipo="info">Es domingo: las horas extra de domingos y feriados llevan recargo del 100 %.</Aviso>}
        <Campo etiqueta="Observación" id="nv-o"><input id="nv-o" className="entrada" placeholder="Constancia, motivo, número de reposo" value={obs} onChange={(e) => setObs(e.target.value)} /></Campo>
      </div>
    </Cajon>
  );
}

function Vacaciones() {
  const [abierto, setAbierto] = useState<SaldoFila | null>(null);
  const q = useQuery({ queryKey: ['vacaciones', 'resumen'], queryFn: () => api<SaldoFila[]>('/rrhh/vacaciones/resumen') });
  return (
    <section className="panel">
      <div className="filtros" style={{ paddingTop: 16 }}>
        <span className="tenue peq">
          Días hábiles por año de servicio cumplido (art. 218 del Código del Trabajo): 12 días hasta 5 años, 18 de 5 a 10 años y 30 con más de 10. Al empezar a usar el sistema, cargue como ajuste lo que cada funcionario ya gozó.
        </span>
      </div>
      <ErrorApi error={q.error} />
      {!q.data ? (
        <Cargando />
      ) : !q.data.length ? (
        <Vacio titulo="No hay funcionarios activos" />
      ) : (
        <table>
          <thead><tr><th>Funcionario</th><th>Ingreso</th><th className="der">Causados</th><th className="der">Gozados</th><th className="der">Ajustes</th><th className="der">Pendientes</th><th className="der">Año en curso</th></tr></thead>
          <tbody>
            {q.data.map((f) => (
              <tr key={f.funcionarioId} className="clic" onClick={() => setAbierto(f)}>
                <td><b>{f.nombre}</b><div className="tenue peq">{f.cargo}</div></td>
                <td className="tenue">{fechaCorta(f.fechaIngreso)}</td>
                <td className="der num">{f.causados}</td>
                <td className="der num">{f.gozados || '—'}</td>
                <td className="der num">{f.ajustes ? f.ajustes.toLocaleString('es-PY') : '—'}</td>
                <td className="der num" style={{ fontWeight: 700 }}>{f.pendientes > 0 ? dias(f.pendientes) : '—'}</td>
                <td className="der num tenue">{f.proporcional.meses} {f.proporcional.meses === 1 ? 'mes' : 'meses'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {abierto && <VacacionesFuncionario fila={abierto} alCerrar={() => setAbierto(null)} />}
    </section>
  );
}

export function VacacionesFuncionario({ fila, alCerrar }: { fila: { funcionarioId: string; nombre: string }; alCerrar: () => void }) {
  const { puede } = useSesion();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['vacaciones', fila.funcionarioId], queryFn: () => api<SaldoDetalle>(`/rrhh/vacaciones?funcionarioId=${fila.funcionarioId}`) });
  const [modo, setModo] = useState<'goce' | 'ajuste' | null>(null);
  const [desde, setDesde] = useState(hoy());
  const [hasta, setHasta] = useState(hoy());
  const [diasG, setDiasG] = useState('');
  const [obs, setObs] = useState('');
  const [anulando, setAnulando] = useState<string | null>(null);
  const [motivo, setMotivo] = useState('');
  const refrescar = () => {
    void qc.invalidateQueries({ queryKey: ['vacaciones'] });
    void qc.invalidateQueries({ queryKey: ['asistencia'] });
  };
  const sugeridos = desde && hasta && hasta >= desde ? habiles(desde, hasta) : 0;
  const registrar = useMutation({
    mutationFn: () =>
      modo === 'goce'
        ? api('/rrhh/vacaciones/goce', { metodo: 'POST', cuerpo: { funcionarioId: fila.funcionarioId, desde, hasta, dias: Number(diasG || sugeridos), observacion: obs || null } })
        : api('/rrhh/vacaciones/ajuste', { metodo: 'POST', cuerpo: { funcionarioId: fila.funcionarioId, dias: Number(diasG.replace(',', '.')), observacion: obs } }),
    onSuccess: () => {
      refrescar();
      setModo(null);
      setDiasG('');
      setObs('');
    },
  });
  const anular = useMutation({
    mutationFn: (id: string) => api(`/rrhh/vacaciones/${id}/anular`, { metodo: 'POST', cuerpo: { motivo } }),
    onSuccess: () => {
      refrescar();
      setAnulando(null);
      setMotivo('');
    },
  });
  const s = q.data;
  const editar = puede('asistencia.editar');
  return (
    <Cajon
      titulo={`Vacaciones · ${fila.nombre}`}
      ancho={720}
      alCerrar={alCerrar}
      pie={
        editar ? (
          <>
            <button className="btn" onClick={() => setModo('ajuste')}>Ajustar saldo</button>
            <button className="btn pri" onClick={() => setModo('goce')}><Plus size={16} /> Registrar vacaciones</button>
          </>
        ) : undefined
      }
    >
      {!s ? (
        <Cargando />
      ) : (
        <>
          <ErrorApi error={registrar.error ?? anular.error} />
          <section className="panel cifras">
            <div className="cifra"><span>Pendientes</span><b className="num">{dias(s.pendientes)}</b></div>
            <div className="cifra"><span>Causados</span><b className="num">{dias(s.causados)}</b><small className="tenue">{s.periodos.length} {s.periodos.length === 1 ? 'año cumplido' : 'años cumplidos'}</small></div>
            <div className="cifra"><span>Gozados</span><b className="num">{dias(s.gozados)}</b>{s.ajustes !== 0 && <small className="tenue">Ajustes {s.ajustes.toLocaleString('es-PY')}</small>}</div>
            <div className="cifra"><span>Año en curso</span><b className="num">{s.proporcional.meses} {s.proporcional.meses === 1 ? 'mes' : 'meses'}</b><small className="tenue">Proporcional {s.proporcional.dias.toLocaleString('es-PY')} días</small></div>
          </section>
          {modo && (
            <div className="form" style={{ borderBottom: '1px solid var(--linea)', paddingBottom: 14 }}>
              {modo === 'goce' ? (
                <>
                  <div className="fila-campos">
                    <Campo etiqueta="Desde" id="vg-d"><input id="vg-d" type="date" className="entrada" value={desde} onChange={(e) => { setDesde(e.target.value); if (hasta < e.target.value) setHasta(e.target.value); }} /></Campo>
                    <Campo etiqueta="Hasta (inclusive)" id="vg-h"><input id="vg-h" type="date" className="entrada" min={desde} value={hasta} onChange={(e) => setHasta(e.target.value)} /></Campo>
                    <Campo etiqueta="Días hábiles" id="vg-n" ayuda="Lunes a sábado; descuente los feriados.">
                      <input id="vg-n" className="entrada num" placeholder={String(sugeridos)} value={diasG} onChange={(e) => setDiasG(e.target.value.replace(/\D/g, '').slice(0, 2))} />
                    </Campo>
                  </div>
                  <Campo etiqueta="Observación" id="vg-o"><input id="vg-o" className="entrada" placeholder="Período al que corresponden" value={obs} onChange={(e) => setObs(e.target.value)} /></Campo>
                </>
              ) : (
                <>
                  <div className="fila-campos">
                    <Campo etiqueta="Días (+ suma, − resta)" id="va-n"><input id="va-n" className="entrada num" placeholder="-12" value={diasG} onChange={(e) => setDiasG(e.target.value.replace(/[^0-9,.-]/g, ''))} /></Campo>
                    <Campo etiqueta="Motivo" id="va-o"><input id="va-o" className="entrada" placeholder="Gozadas antes de usar el sistema" value={obs} onChange={(e) => setObs(e.target.value)} /></Campo>
                  </div>
                </>
              )}
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn" onClick={() => setModo(null)}>Cancelar</button>
                <button
                  className="btn pri"
                  disabled={registrar.isPending || (modo === 'goce' ? !(Number(diasG) || sugeridos) : !Number(diasG.replace(',', '.')) || obs.trim().length < 5)}
                  onClick={() => registrar.mutate()}
                >
                  Guardar
                </button>
              </div>
            </div>
          )}
          <h3 className="subtitulo" style={{ margin: 0 }}>Movimientos</h3>
          {!s.registros.length ? (
            <p className="tenue peq" style={{ margin: 0 }}>Sin vacaciones registradas.</p>
          ) : (
            <table>
              <thead><tr><th>Tipo</th><th>Período</th><th className="der">Días</th><th>Observación</th><th /></tr></thead>
              <tbody>
                {s.registros.map((r) => (
                  <tr key={r.id} style={r.estado === 'anulada' ? { opacity: 0.55 } : undefined}>
                    <td>{r.tipo === 'goce' ? 'Goce' : 'Ajuste'}{r.estado === 'anulada' && <span className="insignia i-n" style={{ marginLeft: 6 }}>Anulado</span>}</td>
                    <td className="tenue">{r.desde ? `${fechaCorta(r.desde)} al ${fechaCorta(r.hasta)}` : fechaCorta(r.creadoEn.slice(0, 10))}</td>
                    <td className="der num">{r.tipo === 'goce' ? `−${Number(r.dias)}` : Number(r.dias) > 0 ? `+${Number(r.dias)}` : Number(r.dias)}</td>
                    <td className="tenue peq">{r.estado === 'anulada' ? r.motivoAnulacion : r.observacion}</td>
                    <td className="der">
                      {editar && r.estado === 'vigente' && (anulando === r.id ? (
                        <span style={{ display: 'inline-flex', gap: 6 }}>
                          <input className="entrada" style={{ height: 30, width: 160 }} placeholder="Motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
                          <button className="btn peligro" style={{ height: 30 }} disabled={motivo.trim().length < 5 || anular.isPending} onClick={() => anular.mutate(r.id)}>Anular</button>
                        </span>
                      ) : (
                        <button className="btn" aria-label="Anular" style={{ height: 30, padding: '0 8px' }} onClick={() => setAnulando(r.id)}><XCircle size={14} /></button>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {s.periodos.length > 0 && (
            <>
              <h3 className="subtitulo" style={{ margin: 0 }}>Años de servicio</h3>
              <table>
                <thead><tr><th>Año</th><th>Cumplido el</th><th className="der">Días</th></tr></thead>
                <tbody>{s.periodos.map((p) => <tr key={p.anio}><td>{p.anio}.º</td><td className="tenue">{fechaCorta(p.desde)}</td><td className="der num">{p.dias}</td></tr>)}</tbody>
              </table>
            </>
          )}
        </>
      )}
    </Cajon>
  );
}

interface ResultadoImportacion { lineas: number; importadas: number; repetidas: number; ignoradas: number; fueraDePeriodo: number; sinFuncionario: string[]; desde: string | null; hasta: string | null }
interface Propuesta { funcionarioId: string; nombre: string; fecha: string; tipo: 'ausencia' | 'llegada_tardia' | 'horas_extra'; horas?: number; recargo?: 50 | 100; detalle: string }
interface Propuestas { desde: string; hasta: string; propuestas: Propuesta[]; incompletas: { funcionarioId: string; nombre: string; fecha: string; hora: string }[]; sinHorario: string[] }

/** Importación del archivo del reloj y revisión de las novedades que surgen de comparar con el horario. */
function Reloj() {
  const qc = useQueryClient();
  const [resultado, setResultado] = useState<ResultadoImportacion | null>(null);
  const [desde, setDesde] = useState(`${hoy().slice(0, 7)}-01`);
  const [hasta, setHasta] = useState(hoy());
  const [propuestas, setPropuestas] = useState<Propuestas | null>(null);
  const [elegidas, setElegidas] = useState<Set<number>>(new Set());
  const [registro, setRegistro] = useState<{ registradas: number; rechazadas: { indice: number; motivo: string }[] } | null>(null);
  const importar = useMutation({
    mutationFn: async (archivo: File) => api<ResultadoImportacion>('/rrhh/marcaciones/importar', { metodo: 'POST', cuerpo: { contenido: await archivo.text(), nombreArchivo: archivo.name } }),
    onSuccess: (r) => {
      setResultado(r);
      if (r.desde && r.hasta) {
        setDesde(r.desde);
        setHasta(r.hasta);
      }
      setPropuestas(null);
      void qc.invalidateQueries({ queryKey: ['asistencia'] });
    },
  });
  const analizar = useMutation({
    mutationFn: () => api<Propuestas>(`/rrhh/marcaciones/propuestas?desde=${desde}&hasta=${hasta}`),
    onSuccess: (p) => {
      setPropuestas(p);
      setElegidas(new Set(p.propuestas.map((_, i) => i)));
      setRegistro(null);
    },
  });
  const registrar = useMutation({
    mutationFn: () =>
      api<{ registradas: number; rechazadas: { indice: number; motivo: string }[] }>('/rrhh/novedades/lote', {
        metodo: 'POST',
        cuerpo: {
          novedades: propuestas!.propuestas
            .filter((_, i) => elegidas.has(i))
            .map((p) => ({ funcionarioId: p.funcionarioId, fecha: p.fecha, tipo: p.tipo, horas: p.horas, recargo: p.recargo, observacion: `Reloj: ${p.detalle}` })),
        },
      }),
    onSuccess: (r) => {
      setRegistro(r);
      void qc.invalidateQueries({ queryKey: ['asistencia'] });
      analizar.mutate();
    },
  });
  const describir = (p: Propuesta) => (p.tipo === 'ausencia' ? 'Ausencia' : p.tipo === 'llegada_tardia' ? `Llegada tardía (${duracion(p.horas!)})` : `Horas extra ${horas(p.horas!)} al ${p.recargo} %`);
  return (
    <>
      <section className="panel" style={{ marginBottom: 16 }}>
        <div className="form" style={{ padding: 20 }}>
          <ErrorApi error={importar.error} />
          <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
            <label className="btn pri" style={{ cursor: 'pointer' }}>
              <Upload size={16} /> Importar archivo del reloj
              <input type="file" accept=".dat,.txt,.csv" hidden disabled={importar.isPending} onChange={(e) => { const a = e.target.files?.[0]; if (a) importar.mutate(a); e.target.value = ''; }} />
            </label>
            <span className="tenue peq" style={{ flex: 1, minWidth: 260 }}>
              Archivo attlog.dat de los relojes ZKTeco o la exportación en CSV o texto del programa del reloj. Cada marcación se asigna por el código del funcionario en el reloj o por su cédula. Se puede importar el mismo archivo de nuevo: lo repetido se ignora.
            </span>
          </div>
          {importar.isPending && <Cargando />}
          {resultado && (
            <Aviso tipo={resultado.importadas ? 'ok' : 'info'}>
              {resultado.importadas.toLocaleString('es-PY')} marcaciones nuevas de {resultado.lineas.toLocaleString('es-PY')} leídas
              {resultado.desde && ` (del ${fechaCorta(resultado.desde)} al ${fechaCorta(resultado.hasta)})`}
              {resultado.repetidas > 0 && ` · ${resultado.repetidas} ya estaban`}
              {resultado.fueraDePeriodo > 0 && ` · ${resultado.fueraDePeriodo} fuera del período de trabajo`}
              {resultado.ignoradas > 0 && ` · ${resultado.ignoradas} líneas sin datos`}
              {resultado.sinFuncionario.length > 0 && `. Códigos sin funcionario: ${resultado.sinFuncionario.join(', ')} (cárguelos en el legajo, campo "Código en el reloj")`}
            </Aviso>
          )}
        </div>
      </section>
      <section className="panel">
        <div className="filtros" style={{ paddingTop: 16, alignItems: 'flex-end' }}>
          <Campo etiqueta="Desde" id="rl-d"><input id="rl-d" type="date" className="entrada" value={desde} onChange={(e) => setDesde(e.target.value)} /></Campo>
          <Campo etiqueta="Hasta" id="rl-h"><input id="rl-h" type="date" className="entrada" max={hoy()} value={hasta} onChange={(e) => setHasta(e.target.value)} /></Campo>
          <button className="btn" style={{ marginBottom: 2 }} disabled={analizar.isPending} onClick={() => analizar.mutate()}><Clock size={16} /> Comparar con el horario</button>
          <span className="tenue peq" style={{ alignSelf: 'center', flex: 1, minWidth: 240 }}>
            Propone ausencias, llegadas tardías (más de 10 minutos) y horas extra (por media hora cumplida). Revise feriados y permisos antes de registrar.
          </span>
        </div>
        <ErrorApi error={analizar.error ?? registrar.error} />
        {registro && (
          <Aviso tipo={registro.rechazadas.length ? 'info' : 'ok'}>
            {registro.registradas} novedades registradas{registro.rechazadas.length > 0 && ` · ${registro.rechazadas.length} no se registraron: ${registro.rechazadas.slice(0, 3).map((r) => r.motivo).join('; ')}`}
          </Aviso>
        )}
        {propuestas && (
          <>
            {propuestas.sinHorario.length > 0 && <Aviso tipo="info">Sin horario cargado (no se comparan): {propuestas.sinHorario.join(', ')}.</Aviso>}
            {!propuestas.propuestas.length ? (
              <Vacio titulo="Nada para proponer">Las marcaciones del período coinciden con los horarios.</Vacio>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 36 }}>
                      <input type="checkbox" aria-label="Todas" checked={elegidas.size === propuestas.propuestas.length} onChange={(e) => setElegidas(e.target.checked ? new Set(propuestas.propuestas.map((_, i) => i)) : new Set())} />
                    </th>
                    <th>Funcionario</th><th>Fecha</th><th>Novedad</th><th>Detalle</th>
                  </tr>
                </thead>
                <tbody>
                  {propuestas.propuestas.map((p, i) => (
                    <tr key={i}>
                      <td><input type="checkbox" aria-label="Registrar" checked={elegidas.has(i)} onChange={(e) => { const n = new Set(elegidas); if (e.target.checked) n.add(i); else n.delete(i); setElegidas(n); }} /></td>
                      <td>{p.nombre}</td>
                      <td className="tenue">{LETRA_DIA[new Date(`${p.fecha}T12:00:00Z`).getUTCDay()]} {fechaCorta(p.fecha)}</td>
                      <td><span className={`cod cod-${p.tipo === 'ausencia' ? 'A' : p.tipo === 'llegada_tardia' ? 'T' : 'H'}`}>{p.tipo === 'ausencia' ? 'A' : p.tipo === 'llegada_tardia' ? 'T' : p.horas}</span> {describir(p)}</td>
                      <td className="tenue peq">{p.detalle}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {propuestas.incompletas.length > 0 && (
              <p className="tenue peq" style={{ margin: 0, padding: '10px 16px' }}>
                Días con una sola marcación (complételos en la planilla del mes): {propuestas.incompletas.map((x) => `${x.nombre} ${fechaCorta(x.fecha)} ${x.hora}`).join(' · ')}.
              </p>
            )}
            {propuestas.propuestas.length > 0 && (
              <div style={{ padding: '12px 16px', borderTop: '1px solid var(--linea2)', display: 'flex', justifyContent: 'flex-end' }}>
                <button className="btn pri" disabled={!elegidas.size || registrar.isPending} onClick={() => registrar.mutate()}><CheckCircle2 size={16} /> Registrar {elegidas.size} {elegidas.size === 1 ? 'novedad' : 'novedades'}</button>
              </div>
            )}
          </>
        )}
      </section>
    </>
  );
}
