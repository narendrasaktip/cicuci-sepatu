<script setup lang="ts">
import { inject, onBeforeUnmount, onMounted, ref } from 'vue';
export type Field = { key: string; label: string; type?: string; value?: string | number | boolean; required?: boolean; min?: number; max?: number; maxLength?: number; options?: { value: string; label: string }[]; help?: string };
const props = defineProps<{ title: string; description?: string; fields: Field[]; submit: (values: Record<string, string | number | boolean>) => Promise<void> }>();
const newPresentation = inject('newPresentation', ref(false));
const emit = defineEmits<{ close: [] }>();
const dialog = ref<HTMLDialogElement>();
const values = ref<Record<string, string | number | boolean>>(Object.fromEntries(props.fields.map(f => [f.key, f.value ?? (f.type === 'checkbox' ? false : '')])));
const busy = ref(false); const error = ref('');
onMounted(() => dialog.value?.showModal());
onBeforeUnmount(() => { if (newPresentation.value) dialog.value?.close(); });
async function save() { busy.value = true; error.value = ''; try { await props.submit(values.value); emit('close'); } catch (e) { error.value = e instanceof Error ? e.message : 'Tindakan gagal.'; } finally { busy.value = false; } }
</script>
<template>
  <dialog
    ref="dialog"
    aria-labelledby="dialog-title"
    @cancel="busy ? $event.preventDefault() : emit('close')"
  >
    <form
      :aria-busy="busy"
      @submit.prevent="save"
    >
      <h2 id="dialog-title">
        {{ title }}
      </h2><p
        v-if="description"
        class="muted"
      >
        {{ description }}
      </p>
      <p
        v-if="error"
        role="alert"
        class="error"
      >
        {{ error }}
      </p>
      <div
        v-for="field in fields"
        :key="field.key"
        class="field"
      >
        <label :for="`action-${field.key}`">{{ field.label }}{{ field.required ? ' *' : '' }}</label>
        <select
          v-if="field.options"
          :id="`action-${field.key}`"
          v-model="values[field.key]"
          :required="field.required"
        >
          <option value="">
            Pilih…
          </option><option
            v-for="option in field.options"
            :key="option.value"
            :value="option.value"
          >
            {{ option.label }}
          </option>
        </select>
        <textarea
          v-else-if="field.type === 'textarea'"
          :id="`action-${field.key}`"
          v-model="values[field.key] as string"
          :required="field.required"
          :maxlength="field.maxLength ?? 4000"
          rows="3"
        />
        <input
          v-else-if="field.type === 'checkbox'"
          :id="`action-${field.key}`"
          v-model="values[field.key]"
          type="checkbox"
        >
        <input
          v-else
          :id="`action-${field.key}`"
          v-model="values[field.key]"
          :type="field.type ?? 'text'"
          :required="field.required"
          :min="field.min"
          :max="field.max"
          :minlength="field.type === 'password' && field.required ? 12 : undefined"
          :maxlength="field.maxLength ?? (field.type === 'password' ? 128 : 100)"
          :autocomplete="field.type === 'password' ? 'new-password' : 'off'"
          :step="field.type === 'number' ? 1 : undefined"
        >
        <small v-if="field.help">{{ field.help }}</small>
      </div>
      <div class="actions">
        <button
          type="button"
          class="secondary"
          :disabled="busy"
          @click="emit('close')"
        >
          Batal
        </button><button
          :disabled="busy"
          :class="{ danger: newPresentation && title.startsWith('Hapus ') }"
        >
          {{ busy ? 'Menyimpan…' : newPresentation && title.startsWith('Hapus ') ? 'Hapus permanen' : 'Konfirmasi' }}
        </button>
      </div>
    </form>
  </dialog>
</template>
