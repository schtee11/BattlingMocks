import { Link } from 'react-router-dom';
import { Button } from '../components/ui/Button.jsx';

export default function NotFound() {
  return (
    <div className="max-w-md mx-auto px-4 py-24 text-center">
      <div className="text-6xl font-bold text-accent mb-2">404</div>
      <div className="text-slate-300 mb-6">That page got cut before Round 1.</div>
      <Link to="/"><Button>Back to Home</Button></Link>
    </div>
  );
}
