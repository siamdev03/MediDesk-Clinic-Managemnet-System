// Feature 6: where the payment gateway sends the payer back to – /pay-result?status=Success&tran=...
import { useSearchParams, Link } from 'react-router-dom';
import PublicShell from '../components/PublicShell.jsx';

export default function PayResult() {
  const [sp] = useSearchParams();
  const status = sp.get('status') || 'Failed';
  const ok = status === 'Success';
  return (
    <PublicShell>
      <div className="card public-card center">
        <div className="big-ok">{ok ? '✅' : status === 'Cancelled' ? '↩️' : '❌'}</div>
        <h2>{ok ? 'Payment received' : status === 'Cancelled' ? 'Payment cancelled' : 'Payment failed'}</h2>
        <p className="muted">{ok ? 'Thank you – your invoice has been updated.' : 'No money was recorded. You can try again from the portal or ask the front desk.'}</p>
        <p className="mono small">Ref: {sp.get('tran') || '—'}</p>
        <Link className="btn primary" to="/portal">Back to patient portal</Link>
      </div>
    </PublicShell>
  );
}