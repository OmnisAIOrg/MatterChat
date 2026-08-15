// MATTERCHAT: side-effect import — registers the `/firm-console` and
// `/firm-domain/verify/:token` routes at boot
// (main.ts -> Promise.all([... import('./views/firms')])).
import './routes';
