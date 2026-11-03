// Features 7, 8, 9: Finance hub – daily cash closing, profit & loss / tax, doctor commission.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useApp } from '../App.jsx';
import { Spinner, useToast } from '../components/ui.jsx';
import { fmtMoney, todayStr } from '../lib.js';
import { useLiveTick } from '../realtime.js';

const first = () => `${todayStr().slice(0, 8)}01`;

function Row({ k, v, bold, cur }) { return <tr className={bold ? 'tot' : ''}><td>{k}</td><td className="num">{fmtMoney(v, cur)}</td></tr>; }

function Cash({ cur }) {
  const [date, setDate] = useState(todayStr());
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const tick = useLiveTick(['payments', 'pharmacySales', 'expenses']);
  useEffect(() => { setErr(''); api.get('/api/x/finance/cash-preview', { date }).then(setD).catch((e) => { setErr(e.message); setD(null); }); }, [date, tick]);
  return (
    <div className="card">
      <div className="toolbar"><label>Business date <input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <Link className="btn primary" to={`/m/cashClosings?new=1&date=${date}`}>🧮 Close this day</Link>
        <Link className="btn" to="/m/cashClosings">Past closings</Link></div>
      {err && <div className="alert err">{err}</div>}
      {!d ? !err && <Spinner /> : (
        <div className="grid2">
          <table className="plain"><thead><tr><th colSpan="2">Billing payments</th></tr></thead><tbody>
            <Row k="Cash" v={d.billing.cash} cur={cur} /><Row k="Card" v={d.billing.card} cur={cur} /><Row k="Mobile banking" v={d.billing.mobile} cur={cur} /><Row k="Other" v={d.billing.other} cur={cur} /></tbody></table>
          <table className="plain"><thead><tr><th colSpan="2">Pharmacy sales (amount paid)</th></tr></thead><tbody>
            <Row k="Cash" v={d.pharmacy.cash} cur={cur} /><Row k="Card" v={d.pharmacy.card} cur={cur} /><Row k="Mobile banking" v={d.pharmacy.mobile} cur={cur} /><Row k="Other" v={d.pharmacy.other} cur={cur} /></tbody></table>
          <table className="plain"><tbody>
            <Row k="Cash expenses paid" v={-d.expensesCash} cur={cur} /><Row k="Total collected (all methods)" v={d.totalCollected} cur={cur} /><Row k="Expected cash (before opening balance)" v={d.expectedCash} bold cur={cur} /></tbody></table>
          <p className="muted small">Counts as of now: {d.counts.payments} payments, {d.counts.sales} pharmacy sales, {d.counts.expenses} expenses. Dues collected later on a pharmacy sale are counted on the sale's date.</p>
        </div>
      )}
    </div>
  );
}

function Pnl({ cur }) {
  const toast = useToast();
  const [r, setR] = useState({ from: first(), to: todayStr() });
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { setErr(''); api.get('/api/x/finance/pnl', r).then(setD).catch((e) => { setErr(e.message); setD(null); }); }, [r]);
  return (
    <div className="card">
      <div className="toolbar">
        <label>From <input type="date" value={r.from} onChange={(e) => setR({ ...r, from: e.target.value })} /></label>
        <label>To <input type="date" value={r.to} onChange={(e) => setR({ ...r, to: e.target.value })} /></label>
        <button className="btn" onClick={() => api.download('/api/x/finance/pnl', { ...r, format: 'xlsx' }, `profit-loss-${r.from}-${r.to}.xlsx`).catch((e) => toast(e.message, 'err'))}>⬇ Excel</button>
      </div>
      {err && <div className="alert err">{err}</div>}
      {!d ? !err && <Spinner /> : (
        <div className="grid2">
          <table className="plain"><thead><tr><th colSpan="2">Income (money received)</th></tr></thead><tbody>
            <Row k="Billing (invoice payments)" v={d.income.billing} cur={cur} /><Row k="Pharmacy sales" v={d.income.pharmacy} cur={cur} /><Row k="Total income" v={d.income.total} bold cur={cur} /></tbody></table>
          <table className="plain"><thead><tr><th colSpan="2">Expenses</th></tr></thead><tbody>
            {Object.entries(d.expenses.byCategory).map(([k, v]) => <Row key={k} k={k} v={v} cur={cur} />)}<Row k="Total expenses" v={d.expenses.total} bold cur={cur} /></tbody></table>
          <table className="plain"><tbody>
            <Row k="NET PROFIT / (LOSS)" v={d.netProfit} bold cur={cur} /><Row k="Estimated pharmacy cost of goods (info)" v={d.pharmacyCogsEstimate} cur={cur} /><Row k="Outstanding receivables (all time)" v={d.receivablesOutstanding} cur={cur} /></tbody></table>
          <table className="plain"><thead><tr><th colSpan="2">Tax collected (for your VAT return)</th></tr></thead><tbody>
            <Row k="On invoices" v={d.tax.invoiceTax} cur={cur} /><Row k="On pharmacy sales" v={d.tax.pharmacyTax} cur={cur} /><Row k="Total" v={d.tax.total} bold cur={cur} /></tbody></table>
          <p className="muted small full">Cash-basis report: income counts when money is received. Check the tax figures with your accountant before filing.</p>
        </div>
      )}
    </div>
  );
}

function Commission({ cur }) {
  const toast = useToast();
  const [r, setR] = useState({ from: first(), to: todayStr(), paidOnly: '' });
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { setErr(''); api.get('/api/x/finance/commissions', r).then(setD).catch((e) => { setErr(e.message); setD(null); }); }, [r]);
  return (
    <div className="card">
      <div className="toolbar">
        <label>From <input type="date" value={r.from} onChange={(e) => setR({ ...r, from: e.target.value })} /></label>
        <label>To <input type="date" value={r.to} onChange={(e) => setR({ ...r, to: e.target.value })} /></label>
        <label className="check"><input type="checkbox" checked={!!r.paidOnly} onChange={(e) => setR({ ...r, paidOnly: e.target.checked ? '1' : '' })} /> <span>Only fully-paid invoices</span></label>
        <button className="btn" onClick={() => api.download('/api/x/finance/commissions', { ...r, format: 'xlsx' }, `commissions-${r.from}-${r.to}.xlsx`).catch((e) => toast(e.message, 'err'))}>⬇ Excel</button>
      </div>
      {err && <div className="alert err">{err}</div>}
      {!d ? !err && <Spinner /> : (
        <div className="table-wrap"><table className="plain"><thead><tr><th>Doctor</th><th>Specialization</th><th className="num">Visits</th><th className="num">Fees</th><th className="num">Rate</th><th className="num">Commission</th></tr></thead>
          <tbody>{d.rows.map((x) => <tr key={x.doctor}><td>{x.doctor}</td><td>{x.specialization}</td><td className="num">{x.visits}</td><td className="num">{fmtMoney(x.fees, cur)}</td><td className="num">{x.pct}%</td><td className="num"><b>{fmtMoney(x.commission, cur)}</b></td></tr>)}
            {!d.rows.length && <tr><td colSpan="6" className="muted">No completed appointments in this period.</td></tr>}
            <tr className="tot"><td colSpan="3">Total</td><td className="num">{fmtMoney(d.totalFees, cur)}</td><td /><td className="num">{fmtMoney(d.totalCommission, cur)}</td></tr></tbody></table>
          <p className="muted small">Commission = rate × fee of each <b>Completed</b> appointment. Set each doctor's rate in People & HR ▸ Doctors ▸ “Commission %”.</p></div>
      )}
    </div>
  );
}

export default function Finance() {
  const { settings } = useApp();
  const [tab, setTab] = useState('cash');
  const TABS = [['cash', '🧮 Daily cash'], ['pnl', '📊 Profit & loss / tax'], ['comm', '🩺 Doctor commission']];
  return (
    <div className="page">
      <div className="page-head"><div><h1>💼 Finance</h1><p className="muted">Cash closing, profit & loss, tax and doctor commission</p></div></div>
      <div className="tabs">{TABS.map(([k, l]) => <button key={k} className={`tab ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>{l}</button>)}</div>
      {tab === 'cash' && <Cash cur={settings.currency} />}
      {tab === 'pnl' && <Pnl cur={settings.currency} />}
      {tab === 'comm' && <Commission cur={settings.currency} />}
    </div>
  );
}