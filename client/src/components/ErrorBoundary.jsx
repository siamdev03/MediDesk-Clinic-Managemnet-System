import { Component } from 'react';
import { reportClientError } from '../errorReporter.js';

// Catches rendering crashes so the user sees a message instead of a blank screen, and logs them.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    reportClientError(error, { where: 'React render' });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 16, fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ maxWidth: 480, textAlign: 'center' }}>
          <div style={{ fontSize: 44 }}>🛠️</div>
          <h2>Something went wrong</h2>
          <p style={{ color: '#6b7c88' }}>The error has been recorded in the Error Log. Please reload the page. If it keeps happening, tell your administrator.</p>
          <p style={{ color: '#c62f3a', fontSize: 13 }}>{String(this.state.error?.message || this.state.error)}</p>
          <button onClick={() => window.location.reload()} style={{ padding: '8px 16px', marginRight: 8 }}>Reload</button>
          <button onClick={() => { window.location.href = '/'; }} style={{ padding: '8px 16px' }}>Go to dashboard</button>
        </div>
      </div>
    );
  }
}