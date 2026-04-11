import { Link } from 'react-router-dom';
import { Button } from '../components/ui/Button.jsx';

export default function NotFound() {
  return (
    <div className="max-w-md mx-auto px-4 py-24 md:py-32 text-center route-fade">
      <div className="caption text-accent">Cut in Round 1</div>
      <div className="font-mono font-bold text-6xl md:text-7xl text-accent mt-2 leading-none">
        404
      </div>
      <h1 className="font-display font-bold uppercase tracking-[0.14em] text-text-primary text-[18px] mt-5">
        Page not found
      </h1>
      <p className="text-text-secondary text-[13.5px] mt-2 leading-relaxed max-w-xs mx-auto">
        That page got cut before Round 1. Head back to the lobby or jump straight into
        a mock.
      </p>
      <div className="mt-6 flex items-center justify-center gap-2 flex-wrap">
        <Link to="/">
          <Button>Back to Home</Button>
        </Link>
        <Link to="/draft">
          <Button variant="secondary">Start a Mock</Button>
        </Link>
      </div>
    </div>
  );
}
