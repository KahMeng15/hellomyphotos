type StackEntry = {
  id: string;
  activate: () => void;
  deactivate: () => void;
};

let stack: StackEntry[] = [];

export function pushModal(id: string, activate: () => void, deactivate: () => void) {
  if (stack.length > 0) {
    stack[stack.length - 1].deactivate();
  }
  stack.push({ id, activate, deactivate });
  activate();
}

export function popModal(id: string) {
  const idx = stack.findIndex(e => e.id === id);
  if (idx === -1) return;
  const removed = stack.splice(idx);
  if (stack.length > 0) {
    stack[stack.length - 1].activate();
  }
}
