// Feature 14: follow-up tracker – /follow-ups
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, mod } from '../api.js';
import { Badge, Empty, Modal, Spinner, useToast } from '../components/ui.jsx';
import { fmtDate } from '../lib.js';
import { useLiveTick } from '../realtime.js';

function BookModal({ row, onClose, onDone }) {
  const toast = useToast();
  const [date, setDate] = useState(fmtDate(row.followUpDate) >= fmtDate(new Date()) ? fmtDate(row.followUpDate) : fmtDate(new Date()));
  const [slots, setSlots] = useState(null);
  const [time, setTime] = useState('');
  useEffect(() => { setTime(''); api.get('/api/x/slots', { doctor: row.doctorId, date }).then(setSlots).catch((e) => setSlots({ slots: [], message: e.message })); }, [date, row.doctorId]);
  const save = async () => {
    try { await mod.create('appointments', { patient: row.patient._id, doctor: row.doctorId, date, time, type: 'Follow-up', status: 'Scheduled', reason: `Follow-up: ${row.diagnosis || ''}` }); toast('Follow-up booked'); onDone(); } catch (e) { toast(e.message, 'err'); }
  };
  return (
    <Modal title={`Book follow-up – ${row.patient.name}`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!time} onClick={save}>Book</button></>}>
      <div className="field"><label>Date</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
      {!slots ? <Spinner /> : !slots.slots.length ? <p className="error-text">{slots.message || 'No slots'}</p> : <div className="slots">{slots.slots.map((s) => <button key={s.time} type="button" disabled={!s.available} className={`slot ${time === s.time ? 'on' : ''} ${s.available ? '' : 'taken'}`} onClick={() => setTime(s.time)}>{s.time}</button>)}</div>}
    </Modal>
  );
}

export default function FollowUps() {
  const toast = useToast();
  const [status, setStatus] = useState('Overdue');
  const [d, setD] = useState(null);
  const [book, setBook] = useState(null);
  const tick = useLiveTick(['consultations', 'appointments']);
  const load = useCallback(() => api.get('/api/x/followups').then(setD).catch((e) => toast(e.message, 'err')), [toast]);
  useEffect(() => { load(); }, [load, tick]);
  const remind = async (r) => { try { const x = await api.post(`/api/x/followups/${r._id}/remind`); toast(x.message); load(); } catch (e) { toast(e.message, 'err'); } };
  const rows = (d?.rows || []).filter((r) => !status || r.status === status);
  const ST = ['Overdue', 'Today', 'Upcoming', 'Done'];
  return (
    <div className="page">
      <div className="page-head"><div><h1>🔁 Follow-up tracker</h1><p className="muted">Patients whose doctor asked them to come back</p></div></div>
      <div className="tabs">{ST.map((s) => <button key={s} className={`tab ${status === s ? 'on' : ''}`} onClick={() => setStatus(s)}>{s} <span className="count">{d?.counts?.[s] || 0}</span></button>)}</div>
      {!d ? <Spinner /> : !rows.length ? <Empty>Nothing in “{status}”</Empty> : (
        <div className="card table-wrap"><table><thead><tr><th>Patient</th><th>Phone</th><th>Doctor</th><th>Last visit</th><th>Follow-up on</th><th>Diagnosis</th><th>Status</th><th /></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r._id}><td><Link to={`/patient/${r.patient._id}`}>{r.patient.name}</Link></td><td>{r.patient.phone}</td><td>{r.doctor?.name}</td><td>{fmtDate(r.consultDate)}</td><td><b>{fmtDate(r.followUpDate)}</b></td><td>{r.diagnosis}</td><td><Badge value={r.status === 'Overdue' ? 'Late' : r.status} /></td>
              <td className="row-actions">{r.status !== 'Done' && <><button className="btn sm" onClick={() => remind(r)}>{r.reminded ? '📩 Remind again' : '📩 Remind'}</button><button className="btn sm primary" onClick={() => setBook(r)}>📅 Book</button></>}</td></tr>))}</tbody></table></div>
      )}
      {book && <BookModal row={book} onClose={() => setBook(null)} onDone={() => { setBook(null); load(); }} />}
    </div>
  );
}