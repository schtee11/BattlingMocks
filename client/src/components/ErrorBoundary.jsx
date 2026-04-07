import { Component } from 'react';
import { Button } from './ui/Button.jsx';

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error('[ErrorBoundary]', error, info); }

  render() {
    if (this.state.error) {
      return (
        <div className="max-w-md mx-auto px-4 py-24 text-center">
          <h1 className="text-2xl font-bold text-text-primary mb-2">Something went wrong</h1>
          <p className="text-text-secondary mb-4 text-sm">{String(this.state.error.message || this.state.error)}</p>
          <Button onClick={() => location.reload()}>Reload</Button>
        </div>
      );
    }
    return this.props.children;
  }
}
