import '@fontsource-variable/inter/wght.css';
import '@fontsource-variable/jetbrains-mono/wght.css';
import { mount } from 'svelte';
import { registerPmtilesProtocol } from '$shared/map';
import './app.css';
import App from './app/App.svelte';

// Register the pmtiles:// protocol once at startup, before any map references a pmtiles URL, rather
// than from a component body. The registration is idempotent, so this is the single canonical call.
registerPmtilesProtocol();

const target = document.getElementById('app');
if (!target) throw new Error('Missing #app mount element');

mount(App, { target });
