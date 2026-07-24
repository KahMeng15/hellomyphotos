import { writable } from 'svelte/store';

// We can read from localStorage if running in browser
const defaultValue = typeof window !== 'undefined' ? localStorage.getItem('lowBandwidth') === 'true' : false;

export const lowBandwidthMode = writable(defaultValue);

if (typeof window !== 'undefined') {
  lowBandwidthMode.subscribe((value) => {
    localStorage.setItem('lowBandwidth', String(value));
  });
}
