import { createRoot } from 'react-dom/client';
import '@fontsource/silkscreen/400.css';
import '@fontsource/silkscreen/700.css';
import './trailer.css';
import { Trailer } from './Trailer';

createRoot(document.getElementById('root')!).render(<Trailer />);
