import { writable } from 'svelte/store';
import { getAuthUser } from '$lib/api/auth';

export const currentUser = writable<any>(null);

export async function loadAuthUser() {
  const user = await getAuthUser();
  if (user) {
    currentUser.set(user);
  }
  return user;
}
