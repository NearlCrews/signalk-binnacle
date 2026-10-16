import '@fontsource-variable/inter/wght.css';
import '@fontsource-variable/jetbrains-mono/wght.css';
import { mount } from 'svelte';
import { registerPmtilesProtocol } from '$shared/map';
import './app.css';
import App from './app/App.svelte';

// Register the pmtiles:// protocol once at startup, before any map references a pmtiles URL, rather
// than from a component body. The registration is idempotent, so this is the single canonical call.
registerPmtilesProtocol();

// iOS Safari applies :active only when a touch listener sits on an ancestor; with the tap highlight
// off, the pressed state is the only tap feedback.
document.addEventListener('touchstart', () => undefined, { passive: true });

const target = document.getElementById('app');
if (!target) throw new Error('Missing #app mount element');

mount(App, { target });
