import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, CircleAlert, Download, FileKey2, RefreshCw, Send, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Aviso, Cajon, Campo, Cargando, Encabezado, ErrorApi, Vacio } from '../componentes/ui';
import { api } from '../lib/api';
import { fechaHora } from '../lib/formato';
import { dinero } from '../lib/operacion';
import { useSesion } from '../lib/sesion';

interface Establecimiento {
  id: string;
  codigo: string;
  nombre: string;
  direccion: string | null;
  numeroCasa: string | null;
  departamento: number | null;
  distrito: number | null;
  ciudad: number | null;
  telefono: string | null;
  email: string | null;
  completo: boolean;
}

interface ConfigFe {
  activa: boolean;
  ambiente: 'test' | 'produccion';
  tipoContribuyente: number;
  tipoRegimen: number | null;
  actividadCodigo: string;
  actividadDescripcion: string;
  timbradoNumero: string;
  timbradoFecha: string;
  cscId: string;
  cscCargado: boolean;
  certificado: { titular: string | null; ruc: string | null; vence: string | null } | null;
  empresa: { razonSocial: string; ruc: string | null };
  establecimientos: Establecimiento[];
  puntos: { id: string; nombre: string; sucursalId: string; sucursal: string; punto: string | null }[];
  pendientes: string[];
}

interface DocFila {
  id: string;
  tipoDocumento: number;
  cdc: string;
  numero: string;
  fecha: string;
  receptor: string;
  receptorDocumento: string | null;
  total: string;
  estado: string;
  mensaje: string | null;
  ambiente: 'test' | 'produccion';
  venta: { id: string; numero: number } | null;
}

const ESTADOS: Record<string, { texto: string; clase: string }> = {
  pendiente: { texto: 'Pendiente de envío', clase: 'i-warn' },
  enviado: { texto: 'En proceso', clase: 'i-p' },
  aprobado: { texto: 'Aprobado', clase: 'i-ok' },
  aprobado_obs: { texto: 'Aprobado con observación', clase: 'i-ok' },
  rechazado: { texto: 'Rechazado', clase: 'i-bad' },
  cancelado: { texto: 'Cancelado', clase: 'i-n' },
};
const TIPOS: Record<number, string> = { 1: 'Factura', 4: 'Autofactura', 5: 'Nota de crédito', 6: 'Nota de débito', 7: 'Nota de remisión' };

export function Facturacion() {
  const { puede } = useSesion();
  const [pestana, setPestana] = useState<'documentos' | 'configuracion'>(puede('documento_fiscal.ver') ? 'documentos' : 'configuracion');
  return (
    <>
      <Encabezado titulo="Facturación electrónica" />
      <div className="contenido">
        <div className="pestanas">
          {puede('documento_fiscal.ver') && (
            <button className={pestana === 'documentos' ? 'activa' : ''} onClick={() => setPestana('documentos')}>Documentos emitidos</button>
          )}
          {puede('config_fiscal.ver') && (
            <button className={pestana === 'configuracion' ? 'activa' : ''} onClick={() => setPestana('configuracion')}>Configuración</button>
          )}
        </div>
        {pestana === 'documentos' ? <Documentos /> : <Configuracion />}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Documentos
// ---------------------------------------------------------------------------

function Documentos() {
  const { puede } = useSesion();
  const qc = useQueryClient();
  const [estado, setEstado] = useState('');
  const [q, setQ] = useState('');
  const [abierto, setAbierto] = useState<string | null>(null);
  const lista = useQuery({
    queryKey: ['fe-documentos', estado, q],
    queryFn: () => api<DocFila[]>(`/facturacion/documentos?${new URLSearchParams({ ...(estado && { estado }), ...(q && { q }) })}`),
    refetchInterval: 15000,
    placeholderData: (p) => p,
  });
  const procesar = useMutation({
    mutationFn: () => api<{ enviados: number; consultados: number }>('/facturacion/procesar', { metodo: 'POST', cuerpo: {} }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['fe-documentos'] }),
  });
  return (
    <section className="panel">
      <div className="filtros" style={{ paddingTop: 16 }}>
        <input className="entrada" style={{ flex: '1 1 260px', maxWidth: 380 }} placeholder="Cliente, RUC o CDC" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="entrada" value={estado} onChange={(e) => setEstado(e.target.value)}>
          <option value="">Todos los estados</option>
          {Object.entries(ESTADOS).map(([k, v]) => (
            <option key={k} value={k}>{v.texto}</option>
          ))}
        </select>
        {puede('documento_fiscal.crear') && (
          <button className="btn" style={{ marginLeft: 'auto' }} disabled={procesar.isPending} onClick={() => procesar.mutate()}>
            <Send size={16} /> Enviar ahora
          </button>
        )}
      </div>
      {procesar.data && (
        <div style={{ padding: '0 20px 12px' }}>
          <Aviso tipo="info">Enviados: {procesar.data.enviados} · resultados recibidos: {procesar.data.consultados}. El envío también se hace solo cada pocos segundos.</Aviso>
        </div>
      )}
      <ErrorApi error={procesar.error} />
      {lista.isLoading ? (
        <Cargando />
      ) : !lista.data?.length ? (
        <Vacio titulo="Sin documentos electrónicos">Cuando la facturación electrónica esté activa, cada venta en una caja con punto de expedición emite su factura.</Vacio>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Documento</th>
              <th>Fecha</th>
              <th>Cliente</th>
              <th className="der">Total</th>
              <th>Estado en SIFEN</th>
            </tr>
          </thead>
          <tbody>
            {lista.data.map((d) => (
              <tr key={d.id} className="clic" onClick={() => setAbierto(d.id)}>
                <td>
                  <div style={{ fontWeight: 600 }}>{TIPOS[d.tipoDocumento]} {d.numero}</div>
                  {d.ambiente === 'test' && <span className="tenue peq">Prueba</span>}
                </td>
                <td className="tenue">{fechaHora(d.fecha)}</td>
                <td>
                  {d.receptor}
                  {d.receptorDocumento && <span className="tenue peq"> · {d.receptorDocumento}</span>}
                </td>
                <td className="der num">{dinero(d.total)}</td>
                <td>
                  <span className={`insignia ${ESTADOS[d.estado]?.clase ?? 'i-n'}`}>{ESTADOS[d.estado]?.texto ?? d.estado}</span>
                  {d.estado === 'rechazado' && d.mensaje && <div className="peq" style={{ color: 'var(--bad)', marginTop: 2 }}>{d.mensaje}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {abierto && <FichaDocumento id={abierto} alCerrar={() => setAbierto(null)} />}
    </section>
  );
}

interface DocDetalle {
  id: string;
  tipoDocumento: number;
  cdc: string;
  numero: string;
  timbrado: string;
  fecha: string;
  receptor: string;
  receptorDocumento: string | null;
  total: string;
  totalIva: string;
  estado: string;
  ambiente: 'test' | 'produccion';
  qr: string;
  lote: string | null;
  intentos: number;
  enviadoEn: string | null;
  procesadoEn: string | null;
  respuesta: { codigo: string | null; mensaje: string | null } | null;
  protocoloAutorizacion: string | null;
  cancelacion: { en: string; motivo: string | null } | null;
  xml: string;
}

function FichaDocumento({ id, alCerrar }: { id: string; alCerrar: () => void }) {
  const { puede } = useSesion();
  const qc = useQueryClient();
  const d = useQuery({ queryKey: ['fe-documento', id], queryFn: () => api<DocDetalle>(`/facturacion/documentos/${id}`) });
  const reenviar = useMutation({
    mutationFn: () => api(`/facturacion/documentos/${id}/reenviar`, { metodo: 'POST', cuerpo: {} }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['fe-documento', id] });
      void qc.invalidateQueries({ queryKey: ['fe-documentos'] });
    },
  });
  const descargar = () => {
    if (!d.data) return;
    const url = URL.createObjectURL(new Blob([d.data.xml], { type: 'application/xml' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${d.data.cdc}.xml`;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <Cajon titulo={d.data ? `${TIPOS[d.data.tipoDocumento]} ${d.data.numero}` : 'Documento electrónico'} alCerrar={alCerrar}>
      {!d.data ? (
        <Cargando />
      ) : (
        <>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span className={`insignia ${ESTADOS[d.data.estado]?.clase ?? 'i-n'}`}>{ESTADOS[d.data.estado]?.texto}</span>
            {d.data.ambiente === 'test' && <span className="insignia i-warn">Ambiente de prueba</span>}
          </div>
          {d.data.respuesta?.mensaje && (
            <Aviso tipo={d.data.estado === 'rechazado' ? 'error' : 'info'}>
              {d.data.respuesta.codigo && <b>{d.data.respuesta.codigo} · </b>}
              {d.data.respuesta.mensaje}
            </Aviso>
          )}
          <dl className="datos">
            <dt>CDC</dt>
            <dd className="num" style={{ wordBreak: 'break-all' }}>{d.data.cdc.match(/.{1,4}/g)!.join(' ')}</dd>
            <dt>Timbrado</dt>
            <dd>{d.data.timbrado}</dd>
            <dt>Fecha de emisión</dt>
            <dd>{fechaHora(d.data.fecha)}</dd>
            <dt>Cliente</dt>
            <dd>{d.data.receptor}{d.data.receptorDocumento ? ` · ${d.data.receptorDocumento}` : ''}</dd>
            <dt>Total</dt>
            <dd>{dinero(d.data.total)} <span className="tenue">(IVA {dinero(d.data.totalIva)})</span></dd>
            {d.data.enviadoEn && (<><dt>Enviado</dt><dd>{fechaHora(d.data.enviadoEn)}{d.data.lote ? ` · lote ${d.data.lote}` : ''}</dd></>)}
            {d.data.procesadoEn && (<><dt>Procesado</dt><dd>{fechaHora(d.data.procesadoEn)}{d.data.protocoloAutorizacion ? ` · autorización ${d.data.protocoloAutorizacion}` : ''}</dd></>)}
            {d.data.cancelacion && (<><dt>Cancelado</dt><dd>{fechaHora(d.data.cancelacion.en)} · {d.data.cancelacion.motivo}</dd></>)}
            {d.data.intentos > 0 && (<><dt>Reintentos</dt><dd>{d.data.intentos}</dd></>)}
          </dl>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <a className="btn" href={d.data.qr} target="_blank" rel="noreferrer"><ShieldCheck size={16} /> Consultar en e-Kuatia</a>
            <button className="btn" onClick={descargar}><Download size={16} /> Descargar XML</button>
            {(d.data.estado === 'rechazado' || d.data.estado === 'pendiente') && puede('documento_fiscal.crear') && (
              <button className="btn" disabled={reenviar.isPending} onClick={() => reenviar.mutate()}><RefreshCw size={16} /> Volver a enviar</button>
            )}
          </div>
          <ErrorApi error={reenviar.error} />
          {d.data.estado === 'rechazado' && (
            <p className="tenue peq" style={{ margin: 0 }}>
              Si el rechazo se debe a un dato (por ejemplo, el RUC del cliente), corríjalo y vuelva a enviar. Si el problema es de la configuración, revise la pestaña Configuración.
            </p>
          )}
        </>
      )}
    </Cajon>
  );
}

// ---------------------------------------------------------------------------
// Configuración
// ---------------------------------------------------------------------------

function Configuracion() {
  const { puede } = useSesion();
  const qc = useQueryClient();
  const editable = puede('config_fiscal.editar');
  const c = useQuery({ queryKey: ['fe-config'], queryFn: () => api<ConfigFe>('/facturacion/configuracion') });
  const [editando, setEditando] = useState<Establecimiento | null>(null);
  const activar = useMutation({
    mutationFn: (activa: boolean) => api<ConfigFe>('/facturacion/activar', { metodo: 'POST', cuerpo: { activa } }),
    onSuccess: (d) => qc.setQueryData(['fe-config'], d),
  });
  const punto = useMutation({
    mutationFn: ({ id, valor }: { id: string; valor: string | null }) => api<ConfigFe>(`/facturacion/puntos/${id}`, { metodo: 'PUT', cuerpo: { punto: valor } }),
    onSuccess: (d) => qc.setQueryData(['fe-config'], d),
  });
  if (c.isLoading || !c.data) return c.error ? <ErrorApi error={c.error} /> : <Cargando />;
  const d = c.data;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <section className="panel">
        <div className="panel-cab">
          {d.activa ? <CheckCircle2 size={20} color="var(--ok)" /> : <CircleAlert size={20} color="var(--t3)" />}
          <h2>{d.activa ? 'Facturación electrónica activa' : 'Facturación electrónica inactiva'}</h2>
          <span className="sub">{d.ambiente === 'test' ? 'Ambiente de prueba de la DNIT (sin valor fiscal)' : 'Producción: los documentos tienen valor fiscal'}</span>
          {editable && (
            <div className="acciones">
              {d.activa ? (
                <button className="btn peligro" disabled={activar.isPending} onClick={() => confirm('Las ventas volverán a emitir comprobante interno. ¿Desactivar?') && activar.mutate(false)}>Desactivar</button>
              ) : (
                <button className="btn pri" disabled={activar.isPending || d.pendientes.length > 0} onClick={() => activar.mutate(true)}>Activar</button>
              )}
            </div>
          )}
        </div>
        <div className="panel-cuerpo">
          <ErrorApi error={activar.error} />
          {d.pendientes.length > 0 ? (
            <Aviso tipo="info">
              Para activar falta: {d.pendientes.join(' · ')}.
            </Aviso>
          ) : (
            !d.activa && <Aviso tipo="ok">Todo listo. Al activar, cada venta en una caja con punto de expedición emite factura electrónica.</Aviso>
          )}
        </div>
      </section>

      <DatosFiscales d={d} editable={editable} />
      <CertificadoFe d={d} editable={editable} />

      <section className="panel">
        <div className="panel-cab">
          <h2>Establecimientos</h2>
          <span className="sub">Dirección fiscal de cada sucursal, según la codificación de la DNIT.</span>
        </div>
        <table>
          <thead>
            <tr><th>Código</th><th>Sucursal</th><th>Dirección</th><th>Estado</th><th /></tr>
          </thead>
          <tbody>
            {d.establecimientos.map((e) => (
              <tr key={e.id}>
                <td className="num">{e.codigo}</td>
                <td>{e.nombre}</td>
                <td className="tenue">{e.direccion ?? '—'}</td>
                <td>{e.completo ? <span className="insignia i-ok">Completo</span> : <span className="insignia i-warn">Incompleto</span>}</td>
                <td className="der">{editable && <button className="btn" style={{ height: 30 }} onClick={() => setEditando(e)}>Editar</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <div className="panel-cab">
          <h2>Puntos de expedición</h2>
          <span className="sub">Cada caja que factura tiene su punto (001, 002…) dentro de su sucursal. Sin punto, la caja emite comprobante interno.</span>
        </div>
        <ErrorApi error={punto.error} />
        {d.puntos.length === 0 ? (
          <Vacio titulo="Sin cajas">Cree las cajas en "Cajas y PDV".</Vacio>
        ) : (
          <table>
            <thead>
              <tr><th>Caja</th><th>Sucursal</th><th style={{ width: 160 }}>Punto</th></tr>
            </thead>
            <tbody>
              {d.puntos.map((p) => (
                <tr key={p.id}>
                  <td>{p.nombre}</td>
                  <td className="tenue">{p.sucursal}</td>
                  <td>
                    <PuntoEditable valor={p.punto} editable={editable} alGuardar={(valor) => punto.mutate({ id: p.id, valor })} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      {editando && <EditarEstablecimiento e={editando} alCerrar={() => setEditando(null)} />}
    </div>
  );
}

function PuntoEditable({ valor, editable, alGuardar }: { valor: string | null; editable: boolean; alGuardar: (v: string | null) => void }) {
  const [v, setV] = useState(valor ?? '');
  useEffect(() => setV(valor ?? ''), [valor]);
  if (!editable) return <span className="num">{valor ?? '—'}</span>;
  const cambiado = v !== (valor ?? '');
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      <input className="entrada num" style={{ width: 70, height: 32 }} maxLength={3} placeholder="—" value={v} onChange={(e) => setV(e.target.value.replace(/\D/g, ''))} />
      {cambiado && (
        <button className="btn" style={{ height: 32 }} disabled={v !== '' && v.length !== 3} onClick={() => alGuardar(v === '' ? null : v)}>Guardar</button>
      )}
    </div>
  );
}

function DatosFiscales({ d, editable }: { d: ConfigFe; editable: boolean }) {
  const qc = useQueryClient();
  const [f, setF] = useState({
    ambiente: d.ambiente,
    tipoContribuyente: String(d.tipoContribuyente),
    actividadCodigo: d.actividadCodigo,
    actividadDescripcion: d.actividadDescripcion,
    timbradoNumero: d.timbradoNumero,
    timbradoFecha: d.timbradoFecha,
    cscId: d.cscId || '0001',
    csc: '',
  });
  const guardar = useMutation({
    mutationFn: () => api<ConfigFe>('/facturacion/configuracion', { metodo: 'PUT', cuerpo: { ...f, tipoContribuyente: Number(f.tipoContribuyente) } }),
    onSuccess: (r) => {
      qc.setQueryData(['fe-config'], r);
      setF((x) => ({ ...x, csc: '' }));
    },
  });
  const campo = (k: keyof typeof f, etiqueta: string, extra?: { ayuda?: string; tipo?: string; placeholder?: string }) => (
    <Campo etiqueta={etiqueta} id={`fe-${k}`} ayuda={extra?.ayuda}>
      <input id={`fe-${k}`} className="entrada" type={extra?.tipo ?? 'text'} disabled={!editable} placeholder={extra?.placeholder} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} autoComplete="off" />
    </Campo>
  );
  return (
    <section className="panel">
      <div className="panel-cab">
        <h2>Datos fiscales</h2>
        <span className="sub">{d.empresa.razonSocial} · RUC {d.empresa.ruc ?? 'sin cargar (complételo en Empresa)'}</span>
      </div>
      <div className="panel-cuerpo">
        <div className="form">
          <ErrorApi error={guardar.error} />
          {guardar.isSuccess && <Aviso tipo="ok">Datos guardados.</Aviso>}
          <div className="fila-campos">
            <Campo etiqueta="Ambiente" id="fe-amb" ayuda="Empiece en prueba: la DNIT valida los documentos sin valor fiscal.">
              <select id="fe-amb" className="entrada" disabled={!editable || d.activa} value={f.ambiente} onChange={(e) => setF({ ...f, ambiente: e.target.value as 'test' | 'produccion' })}>
                <option value="test">Prueba (test)</option>
                <option value="produccion">Producción</option>
              </select>
            </Campo>
            <Campo etiqueta="Tipo de contribuyente" id="fe-tc">
              <select id="fe-tc" className="entrada" disabled={!editable} value={f.tipoContribuyente} onChange={(e) => setF({ ...f, tipoContribuyente: e.target.value })}>
                <option value="2">Persona jurídica</option>
                <option value="1">Persona física</option>
              </select>
            </Campo>
          </div>
          <div className="fila-campos">
            {campo('timbradoNumero', 'Timbrado', { placeholder: '8 dígitos' })}
            {campo('timbradoFecha', 'Inicio de vigencia del timbrado', { tipo: 'date' })}
          </div>
          <div className="fila-campos">
            {campo('actividadCodigo', 'Código de actividad económica', { ayuda: 'El de su constancia de RUC (ej. 47190).' })}
            {campo('actividadDescripcion', 'Descripción de la actividad')}
          </div>
          <div className="fila-campos">
            {campo('cscId', 'ID del CSC', { placeholder: '0001' })}
            {campo('csc', 'CSC (código de seguridad)', { tipo: 'password', placeholder: d.cscCargado ? 'Cargado · escriba solo para cambiarlo' : '32 caracteres', ayuda: 'Lo entrega la DNIT en Marangatu. Se guarda cifrado.' })}
          </div>
          {editable && (
            <div>
              <button className="btn pri" disabled={guardar.isPending} onClick={() => guardar.mutate()}>Guardar datos fiscales</button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function CertificadoFe({ d, editable }: { d: ConfigFe; editable: boolean }) {
  const qc = useQueryClient();
  const [archivo, setArchivo] = useState<{ nombre: string; base64: string } | null>(null);
  const [clave, setClave] = useState('');
  const subir = useMutation({
    mutationFn: () => api<ConfigFe>('/facturacion/certificado', { metodo: 'POST', cuerpo: { archivo: archivo!.base64, clave } }),
    onSuccess: (r) => {
      qc.setQueryData(['fe-config'], r);
      setArchivo(null);
      setClave('');
    },
  });
  const leer = (f: File) => {
    const r = new FileReader();
    r.onload = () => setArchivo({ nombre: f.name, base64: String(r.result).replace(/^data:[^,]*,/, '') });
    r.readAsDataURL(f);
  };
  const vence = d.certificado?.vence ? new Date(d.certificado.vence) : null;
  const diasRestantes = vence ? Math.floor((vence.getTime() - Date.now()) / 86400000) : null;
  return (
    <section className="panel">
      <div className="panel-cab">
        <FileKey2 size={18} color="var(--t3)" />
        <h2>Certificado digital</h2>
        <span className="sub">Archivo .p12 / .pfx emitido por un prestador habilitado. Se guarda cifrado; nadie puede descargarlo.</span>
      </div>
      <div className="panel-cuerpo">
        <div className="form">
          {d.certificado ? (
            <Aviso tipo={diasRestantes !== null && diasRestantes < 30 ? 'error' : 'ok'}>
              {d.certificado.titular}
              {d.certificado.ruc ? ` · RUC ${d.certificado.ruc}` : ''}
              {vence ? ` · vence el ${vence.toLocaleDateString('es-PY')}` : ''}
              {diasRestantes !== null && diasRestantes < 30 ? ` (faltan ${diasRestantes} días: renuévelo)` : ''}
            </Aviso>
          ) : (
            <p className="tenue" style={{ margin: 0 }}>Todavía no hay certificado cargado.</p>
          )}
          {editable && (
            <>
              <div className="fila-campos">
                <Campo etiqueta={d.certificado ? 'Reemplazar por otro archivo' : 'Archivo del certificado'} id="fe-p12">
                  <input id="fe-p12" type="file" accept=".p12,.pfx,application/x-pkcs12" className="entrada" style={{ paddingTop: 8 }} onChange={(e) => e.target.files?.[0] && leer(e.target.files[0])} />
                </Campo>
                <Campo etiqueta="Contraseña del certificado" id="fe-p12c">
                  <input id="fe-p12c" type="password" className="entrada" autoComplete="new-password" value={clave} onChange={(e) => setClave(e.target.value)} />
                </Campo>
              </div>
              <ErrorApi error={subir.error} />
              <div>
                <button className="btn pri" disabled={!archivo || !clave || subir.isPending} onClick={() => subir.mutate()}>Cargar certificado</button>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function EditarEstablecimiento({ e, alCerrar }: { e: Establecimiento; alCerrar: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({
    direccion: e.direccion ?? '',
    numeroCasa: e.numeroCasa ?? '',
    departamento: e.departamento ? String(e.departamento) : '',
    distrito: e.distrito ? String(e.distrito) : '',
    ciudad: e.ciudad ? String(e.ciudad) : '',
    telefono: e.telefono ?? '',
    email: e.email ?? '',
  });
  type Opcion = { codigo: number; nombre: string };
  const deps = useQuery({ queryKey: ['geo'], queryFn: () => api<Opcion[]>('/facturacion/geografia') });
  const dists = useQuery({ queryKey: ['geo', 'd', f.departamento], queryFn: () => api<Opcion[]>(`/facturacion/geografia?departamento=${f.departamento}`), enabled: !!f.departamento });
  const ciuds = useQuery({ queryKey: ['geo', 'c', f.distrito], queryFn: () => api<Opcion[]>(`/facturacion/geografia?distrito=${f.distrito}`), enabled: !!f.distrito });
  const guardar = useMutation({
    mutationFn: () => api<ConfigFe>(`/facturacion/establecimientos/${e.id}`, { metodo: 'PUT', cuerpo: f }),
    onSuccess: (r) => {
      qc.setQueryData(['fe-config'], r);
      alCerrar();
    },
  });
  const valido = f.direccion.trim().length >= 3 && f.departamento && f.distrito && f.ciudad && f.telefono.replace(/\D/g, '').length >= 6;
  return (
    <Cajon
      titulo={`Establecimiento ${e.codigo} · ${e.nombre}`}
      alCerrar={alCerrar}
      pie={
        <>
          <button className="btn" onClick={alCerrar}>Cancelar</button>
          <button className="btn pri" disabled={!valido || guardar.isPending} onClick={() => guardar.mutate()}>Guardar</button>
        </>
      }
    >
      <ErrorApi error={guardar.error} />
      <div className="form">
        <div className="fila-campos">
          <Campo etiqueta="Dirección" id="es-d">
            <input id="es-d" className="entrada" value={f.direccion} onChange={(x) => setF({ ...f, direccion: x.target.value })} />
          </Campo>
          <Campo etiqueta="Número de casa" id="es-n">
            <input id="es-n" className="entrada" placeholder="0 si no tiene" value={f.numeroCasa} onChange={(x) => setF({ ...f, numeroCasa: x.target.value })} />
          </Campo>
        </div>
        <Campo etiqueta="Departamento" id="es-dep">
          <select id="es-dep" className="entrada" value={f.departamento} onChange={(x) => setF({ ...f, departamento: x.target.value, distrito: '', ciudad: '' })}>
            <option value="">Elija…</option>
            {deps.data?.map((o) => <option key={o.codigo} value={o.codigo}>{o.nombre}</option>)}
          </select>
        </Campo>
        <Campo etiqueta="Distrito" id="es-dis">
          <select id="es-dis" className="entrada" disabled={!f.departamento} value={f.distrito} onChange={(x) => setF({ ...f, distrito: x.target.value, ciudad: '' })}>
            <option value="">Elija…</option>
            {dists.data?.map((o) => <option key={o.codigo} value={o.codigo}>{o.nombre}</option>)}
          </select>
        </Campo>
        <Campo etiqueta="Ciudad / localidad" id="es-ciu">
          <select id="es-ciu" className="entrada" disabled={!f.distrito} value={f.ciudad} onChange={(x) => setF({ ...f, ciudad: x.target.value })}>
            <option value="">Elija…</option>
            {ciuds.data?.map((o) => <option key={o.codigo} value={o.codigo}>{o.nombre}</option>)}
          </select>
        </Campo>
        <div className="fila-campos">
          <Campo etiqueta="Teléfono" id="es-t">
            <input id="es-t" className="entrada" value={f.telefono} onChange={(x) => setF({ ...f, telefono: x.target.value })} />
          </Campo>
          <Campo etiqueta="Correo (opcional)" id="es-e">
            <input id="es-e" className="entrada" type="email" value={f.email} onChange={(x) => setF({ ...f, email: x.target.value })} />
          </Campo>
        </div>
      </div>
    </Cajon>
  );
}
