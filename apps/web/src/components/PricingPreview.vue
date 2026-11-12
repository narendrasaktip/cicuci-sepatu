<script setup lang="ts">
import { ref, watch } from 'vue';
import { api } from '../services/auth';
import { money, type PricingPreview, type RateRule } from '../services/domain';
const props = defineProps<{ rules: RateRule[]; pairs: number }>();
const emit = defineEmits<{ ready: [ready: boolean] }>();
const result = ref<PricingPreview>(); const error = ref(''); const loading = ref(false); const retry = ref(0);
watch(() => [props.rules, props.pairs, retry.value], async (_, __, cleanup) => {
  let stale = false; cleanup(() => { stale = true; });
  emit('ready', false); result.value = undefined; error.value = ''; loading.value = true;
  try {
    const preview = await api<PricingPreview>('/pricing/preview', 'POST', { rules: props.rules, pairs: props.pairs });
    if (!stale) { result.value = preview; emit('ready', true); }
  } catch (e) { if (!stale) error.value = e instanceof Error ? e.message : 'Pratinjau gagal.'; }
  finally { if (!stale) loading.value = false; }
}, { immediate: true, deep: true, flush: 'sync' });
</script>
<template>
  <div
    aria-live="polite"
    :aria-busy="loading"
  >
    <p
      v-if="loading"
      role="status"
    >
      Menghitung estimasi server…
    </p>
    <p
      v-if="error"
      role="alert"
      class="error"
    >
      {{ error }} <button
        type="button"
        class="secondary"
        @click="retry++"
      >
        Ulangi pratinjau
      </button>
    </p>
    <template v-if="result">
      <p role="status">
        Estimasi server: <strong>{{ money(result.totalIdr) }}</strong> · {{ pairs }} pasang
      </p>
      <ul aria-label="Rincian estimasi">
        <li
          v-for="(part, index) in result.breakdown"
          :key="index"
        >
          {{ part.kind === 'PACKAGE' ? 'Paket' : 'Per pasang' }} · {{ part.quantity }} × {{ money(part.priceIdr) }} · {{ part.pairs }} pasang = {{ money(part.totalIdr) }}
        </li>
      </ul>
    </template>
  </div>
</template>
