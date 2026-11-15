import { mount } from 'svelte';
import '../src/app.css';
import Options from '../src/Options.svelte';

// Follow the OS theme (the web app's toggle lives on another origin).
document.documentElement.classList.toggle('dark', matchMedia('(prefers-color-scheme: dark)').matches);
mount(Options, { target: document.getElementById('app')! });
