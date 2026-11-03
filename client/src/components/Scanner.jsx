// Feature 5: barcode / QR scanning.
//  • USB barcode scanners act like a keyboard: scan into the box and they press Enter (works everywhere).
//  • "Camera" uses the browser's BarcodeDetector (Chrome/Edge on desktop & Android); other browsers see a message.
import { useEffect, useRef, useState } from 'react';
import { Modal } from './ui.jsx';

function CameraScan({ onCode, onClose }) {
  const video = useRef(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    let stop = false; let stream; let timer;
    (async () => {
      if (!('BarcodeDetector' in window)) { setErr('Camera scanning is not supported in this browser – use a USB scanner or type the code.'); return; }
      try {
        const det = new window.BarcodeDetector();
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        if (stop) { stream.getTracks().forEach((t) => t.stop()); return; }
        video.current.srcObject = stream; await video.current.play();
        const tick = async () => {
          if (stop) return;
          try { const found = await det.detect(video.current); if (found[0]?.rawValue) { onCode(found[0].rawValue); return; } } catch { /* keep trying */ }
          timer = setTimeout(tick, 250);
        };
        tick();
      } catch { setErr('Could not open the camera.'); }
    })();
    return () => { stop = true; clearTimeout(timer); stream?.getTracks().forEach((t) => t.stop()); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Modal title="📷 Scan barcode / QR" onClose={onClose}>
      {err ? <div className="alert err">{err}</div> : <div className="webcam"><video ref={video} muted playsInline /></div>}
    </Modal>
  );
}

// Text box for scanners + optional camera button. onCode(code) is called with the scanned text.
export default function ScanBox({ onCode, placeholder = 'Scan or type barcode, press Enter', busy }) {
  const [v, setV] = useState('');
  const [cam, setCam] = useState(false);
  const submit = () => { const c = v.trim(); if (c) { onCode(c); setV(''); } };
  return (
    <div className="scanbox">
      <input value={v} placeholder={placeholder} disabled={busy} onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }} />
      <button type="button" className="btn sm" onClick={() => setCam(true)} title="Scan with camera">📷</button>
      {cam && <CameraScan onClose={() => setCam(false)} onCode={(c) => { setCam(false); onCode(c); }} />}
    </div>
  );
}