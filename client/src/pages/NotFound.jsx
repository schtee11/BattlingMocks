import { Link } from 'react-router-dom';
import { Button } from '../components/ui/Button.jsx';

export default function NotFound() {
  return (
    <div className="max-w-md mx-auto px-4 py-32 text-center route-fade">
      <div className="caption text-accent">Cut in Round 1</div>
      <div className="font-mono font-bold text-7xl text-accent mt-2">404</div>
      <div className="text-text-secondary mt-4 mb-6">That page got cut before Round 1.</div>
      <Link to="/"><Button>Back to Home</Button></Link>
    </div>
  );
}
