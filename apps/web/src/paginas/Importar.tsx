import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Download, FileSpreadsheet, Upload } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { COLUMNAS_CLIENTES, COLUMNAS_PRODUCTOS, MAX_FILAS_IMPORTACION, mapearFilas } from '@kontiva/shared';
import { Aviso, Campo, Encabezado, ErrorApi } from '../componentes/ui';
import { api, FalloApi } from '../lib/api';
import type { Deposito } from '../lib/operacion';
import { descargarModelo, leerPlanilla } from '../lib/planilla';
import { useSesion } from '../lib/sesion';

interface Resultado {
  simulado: boolean;
  globales: string[];
  resumen: { crear: number; actualizar: number; errores: number; stock: number };
  filas: { fila: number; accion: 'crear' | 'actualizar' | 'error'; descripcion: string; errores: string[]; stock?: { antes: string; despues: string } | null }[];
}

const ACCION = { crear: { texto: 'Nuevo', clase: 'i-ok' }, actualizar: { texto: 'Actualiza', clase: 'i-p' }, error: { texto: 'Error', clase: 'i-bad' } } as const;

export function Importar() {
  const { tipo = 'productos' } = useParams<{ tipo: 'productos' | 'clientes' }>();
  // Una instancia por tipo: al pasar de productos a clientes la pantalla empieza de cero.
  return <ImportarTipo key={tipo} tipo={tipo === 'clientes' ? 'clientes' : 'productos'} />;
}

function ImportarTipo({ tipo }: { tipo: 'productos' | 'clientes' }) {
  const { puede } = useSesion();
  const qc = useQueryClient();
  const columnas = tipo === 'clientes' ? COLUMNAS_CLIENTES : COLUMNAS_PRODUCTOS;
  const depositos = useQuery({ queryKey: ['depositos'], queryFn: () => api<Deposito[]>('/depositos'), enabled: tipo === 'productos' && puede('stock.ver') });
  const [archivo, setArchivo] = useState<string | null>(null);
  const [crudas, setCrudas] = useState<unknown[][] | null>(null);
  const [errorLectura, setErrorLectura] = useState<string | null>(null);
  const [depositoId, setDepositoId] = useState('');
  const [tipoStock, setTipoStock] = useState<'inicial' | 'ajuste'>('inicial');
  const [soloErrores, setSoloErrores] = useState(false);
  const [vista, setVista] = useState<Resultado | null>(null);
  const [hecho, setHecho] = useState<Resultado | null>(null);

  const mapa = useMemo(() => (crudas ? mapearFilas(crudas, columnas) : null), [crudas, columnas]);
  const dep = depositoId || depositos.data?.[0]?.id || null;
  const cuerpo = (simular: boolean) => ({ simular, filas: mapa!.filas, ...(tipo === 'productos' ? { depositoId: mapa!.reconocidas.includes('stock') ? dep : null, tipoStock } : {}) });

  const simular = useMutation({ mutationFn: () => api<Resultado>(`/importaciones/${tipo}`, { metodo: 'POST', cuerpo: cuerpo(true) }), onSuccess: setVista });
  const importar = useMutation({
    mutationFn: () => api<Resultado>(`/importaciones/${tipo}`, { metodo: 'POST', cuerpo: cuerpo(false) }),
    onSuccess: (r) => {
      setHecho(r);
      void qc.invalidateQueries();
    },
    onError: (e) => {
      if (e instanceof FalloApi && e.codigo === 'IMPORTACION_CON_ERRORES') setVista(e.detalle as Resultado);
    },
  });

  const elegir = async (f: File | undefined) => {
    setVista(null);
    setHecho(null);
    setErrorLectura(null);
    setCrudas(null);
    if (!f) return;
    setArchivo(f.name);
    try {
      const filas = await leerPlanilla(f);
      if (filas.length - 1 > MAX_FILAS_IMPORTACION) throw new Error(`La planilla tiene ${filas.length - 1} filas: el máximo por importación es ${MAX_FILAS_IMPORTACION}. Divídala en partes.`);
      setCrudas(filas);
    } catch (e) {
      setErrorLectura(e instanceof Error ? e.message : 'No se pudo leer el archivo');
    }
  };

  const visibles = (vista?.filas ?? []).filter((f) => !soloErrores || f.accion === 'error');
  const titulo = tipo === 'clientes' ? 'Importar clientes' : 'Importar productos y stock';
  const volver = tipo === 'clientes' ? '/clientes' : '/productos';

  if (hecho) {
    return (
      <>
        <Encabezado titulo={titulo} />
        <div className="contenido">
          <section className="panel">
            <div className="vacio">
              <CheckCircle2 size={36} color="var(--ok)" />
              <b>Importación terminada</b>
              <span>
                {hecho.resumen.crear} nuevos · {hecho.resumen.actualizar} actualizados
                {tipo === 'productos' && hecho.resumen.stock ? ` · stock cargado en ${hecho.resumen.stock}` : ''}
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                <Link className="btn pri" to={volver}>Ver {tipo}</Link>
                <button className="btn" onClick={() => void elegir(undefined)}>Importar otra planilla</button>
              </div>
            </div>
          </section>
        </div>
      </>
    );
  }

  return (
    <>
      <Encabezado titulo={titulo}>
        <button className="btn" onClick={() => void descargarModelo(columnas, `kontiva-modelo-${tipo}.xlsx`)}>
          <Download size={16} /> Descargar planilla modelo
        </button>
      </Encabezado>
      <div className="contenido">
        <section className="panel">
          <div className="panel-cab">
            <h2>1. Elija el archivo</h2>
            <span className="sub">Excel (.xlsx) o CSV. La primera fila debe tener los nombres de las columnas.</span>
          </div>
          <div className="panel-cuerpo form">
            <label className="btn" style={{ alignSelf: 'flex-start' }}>
              <Upload size={16} /> {archivo ?? 'Elegir archivo'}
              <input type="file" accept=".xlsx,.csv,.txt" hidden onChange={(e) => void elegir(e.target.files?.[0])} />
            </label>
            {errorLectura && <Aviso tipo="error">{errorLectura}</Aviso>}
            <p className="tenue peq" style={{ margin: 0 }}>
              Columnas que se reconocen: {columnas.map((c) => `${c.titulo}${c.obligatoria ? ' (obligatoria)' : ''}`).join(', ')}. También se aceptan nombres parecidos (por ejemplo "Descripción" o "Precio de venta").
            </p>
          </div>
        </section>

        {mapa && (
          <section className="panel">
            <div className="panel-cab">
              <h2>2. Revise lo que se va a importar</h2>
              <span className="sub">{mapa.filas.length} filas con datos</span>
            </div>
            <div className="panel-cuerpo form">
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <FileSpreadsheet size={16} color="var(--t3)" />
                {columnas.map((c) => (
                  <span key={c.clave} className={`insignia ${mapa.reconocidas.includes(c.clave) ? 'i-ok' : c.obligatoria ? 'i-bad' : 'i-n'}`}>
                    {c.titulo}
                  </span>
                ))}
              </div>
              {mapa.ignoradas.length > 0 && <span className="tenue peq">Columnas que no se usan: {mapa.ignoradas.join(', ')}</span>}
              {mapa.faltantes.length > 0 ? (
                <Aviso tipo="error">Falta la columna obligatoria: {mapa.faltantes.join(', ')}. Revise los encabezados o use la planilla modelo.</Aviso>
              ) : (
                <>
                  {tipo === 'productos' && mapa.reconocidas.includes('stock') && (
                    <div className="fila-campos">
                      <Campo etiqueta="Cargar el stock en" id="idep">
                        <select id="idep" className="entrada" value={dep ?? ''} onChange={(e) => { setDepositoId(e.target.value); setVista(null); }}>
                          {depositos.data?.map((d) => (
                            <option key={d.id} value={d.id}>{d.sucursal.nombre} · {d.nombre}</option>
                          ))}
                        </select>
                      </Campo>
                      <Campo etiqueta="El stock de la planilla es" id="itip">
                        <select id="itip" className="entrada" value={tipoStock} onChange={(e) => setTipoStock(e.target.value as 'inicial' | 'ajuste')}>
                          <option value="inicial">Stock inicial (empresa nueva)</option>
                          <option value="ajuste">Un conteo (ajusta el saldo actual)</option>
                        </select>
                      </Campo>
                    </div>
                  )}
                  {!vista && (
                    <div>
                      <button className="btn pri" disabled={simular.isPending || !mapa.filas.length} onClick={() => simular.mutate()}>
                        {simular.isPending ? 'Revisando…' : 'Revisar planilla'}
                      </button>
                    </div>
                  )}
                </>
              )}
              <ErrorApi error={simular.error ?? (importar.error instanceof FalloApi && importar.error.codigo === 'IMPORTACION_CON_ERRORES' ? null : importar.error)} />
            </div>
          </section>
        )}

        {vista && (
          <section className="panel">
            <div className="cifras">
              <div className="cifra"><span>Nuevos</span><b className="num">{vista.resumen.crear}</b></div>
              <div className="cifra"><span>Se actualizan</span><b className="num">{vista.resumen.actualizar}</b></div>
              {tipo === 'productos' && <div className="cifra"><span>Con stock</span><b className="num">{vista.resumen.stock}</b></div>}
              <div className="cifra"><span>Con errores</span><b className="num" style={{ color: vista.resumen.errores ? 'var(--bad)' : undefined }}>{vista.resumen.errores}</b></div>
            </div>
            <div className="panel-cuerpo form" style={{ borderTop: '1px solid var(--linea2)', paddingTop: 16 }}>
              {vista.globales.map((g) => (
                <Aviso key={g} tipo="error">{g}</Aviso>
              ))}
              {vista.resumen.errores > 0 ? (
                <Aviso tipo="error">Corrija las filas con error en la planilla y vuelva a elegir el archivo. No se importa nada hasta que todas estén bien.</Aviso>
              ) : vista.globales.length === 0 ? (
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <button className="btn pri" disabled={importar.isPending} onClick={() => importar.mutate()}>
                    {importar.isPending ? 'Importando…' : `3. Importar ${vista.resumen.crear + vista.resumen.actualizar} filas`}
                  </button>
                  <span className="tenue peq">Todo o nada: si algo falla, no se guarda ninguna fila.</span>
                </div>
              ) : null}
              <label className="casilla">
                <input type="checkbox" checked={soloErrores} onChange={(e) => setSoloErrores(e.target.checked)} /> Ver solo las filas con error
              </label>
            </div>
            <div className="desplazar" style={{ maxHeight: 520, overflowY: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th>Fila</th>
                    <th>{tipo === 'clientes' ? 'Cliente' : 'Producto'}</th>
                    <th>Acción</th>
                    <th>Detalle</th>
                  </tr>
                </thead>
                <tbody>
                  {visibles.slice(0, 1000).map((f) => (
                    <tr key={f.fila}>
                      <td className="num tenue">{f.fila}</td>
                      <td style={{ fontWeight: 600 }}>{f.descripcion || '—'}</td>
                      <td><span className={`insignia ${ACCION[f.accion].clase}`}>{ACCION[f.accion].texto}</span></td>
                      <td className="peq" style={{ color: f.errores.length ? 'var(--bad)' : 'var(--t3)' }}>{f.errores.join(' · ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {visibles.length > 1000 && <p className="tenue peq" style={{ padding: '8px 16px' }}>Se muestran las primeras 1.000 filas.</p>}
            </div>
          </section>
        )}
      </div>
    </>
  );
}
