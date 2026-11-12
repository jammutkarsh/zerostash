import { mount } from 'svelte';
import App from './App.svelte';
import './app.css';

const target = document.getElementById('app')!;
target.replaceChildren(); // drop the static crawler fallback from index.html
mount(App, { target });

// Installable app (PWA): the service worker caches the app shell so it opens instantly and
// offline. Dev builds skip it so Vite's hot reload isn't served stale files.
if (import.meta.env.PROD && 'serviceWorker' in navigator) addEventListener('load', () => void navigator.serviceWorker.register('/sw.js'));
