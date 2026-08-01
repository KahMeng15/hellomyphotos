import { writable } from 'svelte/store';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface ToastMessage {
  id: number;
  type: ToastType;
  message: string;
}

const { subscribe, update } = writable<ToastMessage[]>([]);

let idCounter = 0;

export const toast = {
  subscribe,
  add: (type: ToastType, message: string, duration = 4000) => {
    const id = ++idCounter;
    update(toasts => [...toasts, { id, type, message }]);
    if (duration > 0) {
      setTimeout(() => {
        toast.remove(id);
      }, duration);
    }
  },
  remove: (id: number) => {
    update(toasts => toasts.filter(t => t.id !== id));
  },
  clear: () => {
    update(() => []);
  },
  success: (msg: string, duration?: number) => toast.add('success', msg, duration),
  error: (msg: string, duration = 6000) => toast.add('error', msg, duration),
  info: (msg: string, duration?: number) => toast.add('info', msg, duration),
  warning: (msg: string, duration?: number) => toast.add('warning', msg, duration)
};
