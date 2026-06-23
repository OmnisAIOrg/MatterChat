// Side-effect: importing this module registers the `/litbox` route group at boot
// (main.ts -> Promise.all([... import('./views/litbox')])).
export { registerLitboxRoute } from './routes';
