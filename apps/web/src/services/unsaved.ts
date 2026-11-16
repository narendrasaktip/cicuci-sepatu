import { inject, onBeforeUnmount, onMounted, provide, type ComputedRef, type InjectionKey } from 'vue';

const guardsKey: InjectionKey<Set<() => boolean>> = Symbol('unsaved-guards');
export function provideUnsavedGuards() {
  const guards = new Set<() => boolean>();
  provide(guardsKey, guards);
  return () => ![...guards].some(check => check()) || window.confirm('Perubahan belum disimpan. Tinggalkan halaman?');
}
export function useUnsavedChanges(dirty: ComputedRef<boolean>) {
  const guards = inject(guardsKey, undefined);
  const check = () => dirty.value;
  guards?.add(check);
  const beforeUnload = (event: BeforeUnloadEvent) => { if (dirty.value) { event.preventDefault(); event.returnValue = ''; } };
  onMounted(() => window.addEventListener('beforeunload', beforeUnload));
  onBeforeUnmount(() => { guards?.delete(check); window.removeEventListener('beforeunload', beforeUnload); });
}
