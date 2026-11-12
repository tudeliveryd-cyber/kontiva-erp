import { Copy, Download } from 'lucide-react';
import { useState } from 'react';

export function QrSecreto({ qr, secreto }: { qr: string; secreto: string }) {
  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
      <img src={qr} alt="Código QR para la aplicación de autenticación" width={168} height={168} style={{ border: '1px solid var(--linea)', borderRadius: 8 }} />
      <div style={{ flex: '1 1 160px', fontSize: 13, color: 'var(--t2)' }}>
        <p style={{ marginTop: 0 }}>1. Abra la aplicación y escanee el código.</p>
        <p>
          ¿No puede escanear? Ingrese esta clave:
          <br />
          <span className="mono" style={{ wordBreak: 'break-all', color: 'var(--t)' }}>
            {secreto.match(/.{1,4}/g)?.join(' ')}
          </span>
        </p>
        <p style={{ marginBottom: 0 }}>2. Escriba el código de 6 dígitos que aparece.</p>
      </div>
    </div>
  );
}

export function CodigosRespaldo({ codigos }: { codigos: string[] }) {
  const [copiado, setCopiado] = useState(false);
  const texto = `KONTIVA ERP · códigos de respaldo\n${codigos.join('\n')}\n`;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="mono" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 16px', padding: 14, background: '#fafafb', border: '1px solid var(--linea)', borderRadius: 8, fontSize: 14 }}>
        {codigos.map((c) => (
          <span key={c}>{c}</span>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          className="btn chico"
          onClick={() => {
            void navigator.clipboard?.writeText(texto);
            setCopiado(true);
          }}
        >
          <Copy size={14} /> {copiado ? 'Copiados' : 'Copiar'}
        </button>
        <a className="btn chico" download="kontiva-codigos-respaldo.txt" href={`data:text/plain;charset=utf-8,${encodeURIComponent(texto)}`}>
          <Download size={14} /> Descargar
        </a>
      </div>
    </div>
  );
}
