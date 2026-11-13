import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FileText, Mail, Send } from 'lucide-react';
import { useState } from 'react';
import { api, archivo } from '../lib/api';
import { useSesion } from '../lib/sesion';
import { ErrorApi } from './ui';

/** Abre el KuDE en A4 (PDF) en otra pestaña. La pestaña se abre antes de la descarga para que el navegador no la bloquee. */
export async function abrirKude(id: string) {
  const ventana = window.open('', '_blank');
  try {
    const pdf = await archivo(`/facturacion/documentos/${id}/kude`);
    const url = URL.createObjectURL(pdf);
    if (ventana) ventana.location.href = url;
    else window.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) {
    ventana?.close();
    throw e;
  }
}

/** KuDE en A4 y envío por correo de un documento electrónico. */
export function AccionesDocumento({ id, estado, correo, correoSugerido }: { id: string; estado: string; correo?: { para?: string | null; en?: string; error?: string } | null; correoSugerido?: string | null }) {
  const { puede } = useSesion();
  const qc = useQueryClient();
  const [abierto, setAbierto] = useState(false);
  const [email, setEmail] = useState(correoSugerido ?? '');
  const [errorPdf, setErrorPdf] = useState<unknown>(null);
  const enviar = useMutation({
    mutationFn: () => api<{ para: string }>(`/facturacion/documentos/${id}/correo`, { metodo: 'POST', cuerpo: email.trim() ? { email: email.trim() } : {} }),
    onSuccess: () => {
      setAbierto(false);
      void qc.invalidateQueries({ queryKey: ['fe-documento', id] });
      void qc.invalidateQueries({ queryKey: ['venta'] });
    },
  });
  const aprobado = estado === 'aprobado' || estado === 'aprobado_obs';
  return (
    <div className="form" style={{ gap: 8 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn" onClick={() => abrirKude(id).catch(setErrorPdf)}><FileText size={16} /> KuDE A4 (PDF)</button>
        {aprobado && puede('documento_fiscal.crear') && (
          <button className="btn" onClick={() => setAbierto(!abierto)}><Mail size={16} /> Enviar por correo</button>
        )}
      </div>
      {correo?.en && <p className="tenue peq" style={{ margin: 0 }}>Enviado por correo a {correo.para} el {new Date(correo.en).toLocaleString('es-PY', { dateStyle: 'short', timeStyle: 'short' })}.</p>}
      {correo?.error && <p className="peq" style={{ margin: 0, color: 'var(--bad)' }}>No se pudo enviar el correo automático: {correo.error}</p>}
      <ErrorApi error={errorPdf ?? enviar.error} />
      {abierto && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input aria-label="Correo del cliente" type="email" className="entrada" placeholder="correo@cliente.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          <button className="btn pri" disabled={enviar.isPending || !email.includes('@')} onClick={() => enviar.mutate()}><Send size={16} /> Enviar</button>
        </div>
      )}
      {enviar.data && <p className="peq" style={{ margin: 0, color: 'var(--ok)' }}>Enviado a {enviar.data.para}: KuDE en PDF y XML.</p>}
    </div>
  );
}
