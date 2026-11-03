// Feature 21: take a patient photo with the webcam (needs https or localhost + camera permission).
import { useEffect, useRef, useState } from 'react';
import { Modal } from './ui.jsx';

export default function Webcam({ onCapture, onClose }) {
  const video = useRef(null);
  const stream = useRef(null);
  const [err, setErr] = useState('');
  const [shot, setShot] = useState(null); // { url, blob }

  useEffect(() => {
    let dead = false;
    if (!navigator.mediaDevices?.getUserMedia) { setErr('This browser cannot open the camera here (use localhost or https).'); return undefined; }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 640 } }, audio: false })
      .then((s) => {
        if (dead) { s.getTracks().forEach((t) => t.stop()); return; }
        stream.current = s;
        if (video.current) { video.current.srcObject = s; video.current.play().catch(() => {}); }
      })
      .catch((e) => setErr(e.name === 'NotAllowedError' ? 'Camera permission was denied.' : 'No camera found.'));
    return () => { dead = true; stream.current?.getTracks().forEach((t) => t.stop()); };
  }, []);

  const snap = () => {
    const v = video.current;
    if (!v?.videoWidth) return;
    const size = Math.min(v.videoWidth, v.videoHeight);
    const c = document.createElement('canvas');
    c.width = 480; c.height = 480; // square, small enough to upload quickly
    c.getContext('2d').drawImage(v, (v.videoWidth - size) / 2, (v.videoHeight - size) / 2, size, size, 0, 0, 480, 480);
    c.toBlob((blob) => { if (blob) setShot({ blob, url: URL.createObjectURL(blob) }); }, 'image/jpeg', 0.85);
  };
  const use = () => onCapture(new File([shot.blob], `patient-${Date.now()}.jpg`, { type: 'image/jpeg' }));

  return (
    <Modal title="📷 Take photo" onClose={onClose}
      footer={shot
        ? <><button className="btn" type="button" onClick={() => setShot(null)}>Retake</button><button className="btn primary" type="button" onClick={use}>Use this photo</button></>
        : <><button className="btn" type="button" onClick={onClose}>Cancel</button><button className="btn primary" type="button" onClick={snap} disabled={!!err}>Capture</button></>}>
      {err && <div className="alert err">{err}</div>}
      <div className="webcam">
        {shot ? <img src={shot.url} alt="Captured" /> : <video ref={video} muted playsInline />}
      </div>
    </Modal>
  );
}