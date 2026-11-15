import { mount } from 'svelte';
import '../src/app.css';
import Popup from '../src/Popup.svelte';

// Follow the OS theme (the web app's toggle lives on another origin).
document.documentElement.classList.toggle('dark', matchMedia('(prefers-color-scheme: dark)').matches);
mount(Popup, { target: document.getElementById('app')! });
