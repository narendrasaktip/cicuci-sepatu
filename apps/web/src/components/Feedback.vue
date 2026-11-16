<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../services/auth';
import { date, type FeedbackEntry, type Page } from '../services/domain';
defineOptions({ name: 'CustomerFeedback' });
const entries = ref<FeedbackEntry[]>([]); const busy = ref(false); const error = ref('');
const cursors = ref<string[]>([]); const nextCursor = ref<string | null>(null);
const visibility = ref(''); const rating = ref('');
defineEmits<{ openOrder: [id: string] }>();
async function load(history = cursors.value) {
  if (busy.value) return;
  busy.value = true; error.value = '';
  try {
    const params = new URLSearchParams({ limit: '25' });
    if (visibility.value) params.set('visibility', visibility.value);
    if (rating.value) params.set('rating', rating.value);
    const cursor = history.at(-1); if (cursor) params.set('cursor', cursor);
    const result = await api<Page<FeedbackEntry>>(`/feedback?${params}`);
    entries.value = result.data; nextCursor.value = result.page.nextCursor; cursors.value = [...history];
  } catch (e) { error.value = e instanceof Error ? e.message : 'Ulasan gagal dimuat.'; }
  finally { busy.value = false; }
}
onMounted(() => load());
async function togglePublished(entry: FeedbackEntry) {
  if (busy.value || (!entry.isPublished && !entry.publicationConsent)) return;
  busy.value = true; error.value = '';
  try {
    const updated = await api<{ isPublished: boolean }>(`/feedback/${encodeURIComponent(entry.id)}`, 'PATCH', { isPublished: !entry.isPublished });
    entry.isPublished = updated.isPublished;
  } catch (e) { error.value = e instanceof Error ? e.message : 'Status publikasi gagal disimpan.'; }
  finally { busy.value = false; }
}
</script>
<template>
  <section
    class="panel feedback-workspace"
    aria-labelledby="feedback-list-title"
    :aria-busy="busy"
  >
    <div class="feedback-toolbar">
      <div>
        <h2 id="feedback-list-title">
          Ulasan Pelanggan
        </h2>
        <p class="feedback-description">
          Kelola masukan pelanggan dan pilih ulasan untuk beranda.
        </p>
      </div>
      <button
        class="secondary"
        :disabled="busy"
        @click="load()"
      >
        Perbarui Ulasan
      </button>
    </div>
    <form
      class="actions feedback-filters"
      @submit.prevent="load([])"
    >
      <label>Publikasi<select v-model="visibility"><option value="">Semua Ulasan</option><option value="pending">Menunggu Publikasi</option><option value="published">Tayang</option><option value="internal">Internal</option></select></label>
      <label>Rating<select v-model="rating"><option value="">Semua Rating</option><option
        v-for="value in 5"
        :key="value"
        :value="String(value)"
      >{{ value }} Bintang</option></select></label>
      <button
        class="secondary"
        :disabled="busy"
      >
        Terapkan Filter
      </button>
    </form>
    <p
      v-if="error"
      class="error"
      role="alert"
    >
      {{ error }}
    </p>
    <p
      v-if="busy"
      role="status"
    >
      Memuat ulasan…
    </p>
    <p
      v-if="!busy && !error && !entries.length"
      class="feedback-empty"
    >
      Belum ada ulasan.
    </p>
    <div class="feedback-grid">
      <article
        v-for="entry in entries"
        :key="entry.id"
        class="feedback-entry"
      >
        <div class="entry-header">
          <span
            class="customer-avatar"
            aria-hidden="true"
          >{{ Array.from(entry.order.customer.name.trim())[0]?.toUpperCase() || 'P' }}</span>
          <div class="entry-identity">
            <h3 :aria-label="`${entry.order.number} · ${entry.order.customer.name}`">
              {{ entry.order.customer.name }}
            </h3>
            <p class="entry-order">
              {{ entry.order.number }}
            </p>
          </div>
          <span
            class="visibility-badge"
            :class="entry.isPublished && entry.publicationConsent ? 'is-public' : ''"
          >{{ !entry.publicationConsent ? 'Internal' : entry.isPublished ? 'Tayang' : 'Tersembunyi' }}</span>
        </div>
        <div class="entry-meta">
          <p
            class="entry-stars"
            :aria-label="`${entry.rating} dari 5 bintang`"
          >
            <span aria-hidden="true">{{ '★'.repeat(entry.rating) }}<span class="empty-stars">{{ '☆'.repeat(5 - entry.rating) }}</span></span>
          </p>
          <time :datetime="entry.createdAt">{{ date(entry.createdAt) }}</time>
        </div>
        <p class="feedback-review">
          {{ entry.review }}
        </p>
        <div class="entry-footer">
          <button
            v-if="entry.order.id"
            class="secondary"
            @click="$emit('openOrder', entry.order.id)"
          >
            Buka Pesanan
          </button>
          <p class="publication-note">
            {{ !entry.publicationConsent ? 'Pelanggan belum mengizinkan publikasi.' : entry.isPublished ? 'Tampil di beranda dengan nama disamarkan.' : 'Izin publikasi tersedia. Belum tampil di beranda.' }}
          </p>
          <button
            class="secondary"
            :disabled="busy || (!entry.publicationConsent && !entry.isPublished)"
            @click="togglePublished(entry)"
          >
            {{ entry.isPublished ? 'Sembunyikan' : 'Tampilkan di Beranda' }}
          </button>
        </div>
      </article>
    </div>
    <nav
      class="actions feedback-pagination"
      aria-label="Halaman ulasan"
    >
      <button
        class="secondary"
        :disabled="busy || !cursors.length"
        @click="load(cursors.slice(0, -1))"
      >
        Sebelumnya
      </button>
      <span>Halaman {{ cursors.length + 1 }}</span>
      <button
        class="secondary"
        :disabled="busy || !nextCursor"
        @click="nextCursor && load([...cursors, nextCursor])"
      >
        Berikutnya
      </button>
    </nav>
  </section>
</template>
<style scoped>
.feedback-workspace{container-type:inline-size}
.feedback-workspace .feedback-filters{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) auto;align-items:end}
.feedback-workspace .feedback-filters label{min-width:0;width:100%;align-items:stretch}
.feedback-filters select{width:100%;min-width:0}
.feedback-filters button{min-height:44px}
.feedback-workspace .feedback-filters label{display:grid;gap:6px;align-content:start}
.feedback-workspace .feedback-filters select{height:44px;margin:0}
.feedback-workspace .feedback-filters button{height:44px;margin:0;align-self:end;white-space:nowrap}
@container(max-width:700px){.feedback-grid{grid-template-columns:1fr}.feedback-workspace .feedback-toolbar{align-items:flex-start;flex-wrap:wrap;gap:12px}.feedback-workspace .feedback-filters{grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.feedback-workspace .feedback-filters button{grid-column:1/-1;width:100%}.feedback-workspace .entry-footer{align-items:stretch}.entry-footer button{width:100%}}
@container(max-width:400px){.feedback-workspace .entry-header{display:grid;grid-template-columns:42px minmax(0,1fr)}.feedback-workspace .entry-identity{min-width:0}.visibility-badge{grid-column:2;justify-self:start}.feedback-workspace .feedback-filters{grid-template-columns:1fr}}
.feedback-workspace{color:#182c49}.feedback-toolbar{display:flex;justify-content:space-between;align-items:center;gap:20px;margin-bottom:24px}.feedback-toolbar h2{margin:0;font-size:20px;line-height:1.4}.feedback-description{margin:6px 0 0;color:#56677e;font-size:14px;line-height:1.6}.feedback-toolbar>button{flex-shrink:0}.feedback-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}.feedback-entry{min-width:0;display:flex;flex-direction:column;padding:22px;border:1px solid #dce5ef;border-radius:16px;background:#fff}.entry-header{display:flex;align-items:center;gap:12px}.customer-avatar{display:grid;place-items:center;width:42px;height:42px;flex-shrink:0;border-radius:13px;background:#eaf3ff;color:#245b94;font-size:18px;font-weight:700}.entry-identity{flex:1;min-width:0}.entry-identity h3{margin:0;font-size:16px;font-weight:650;line-height:1.4;overflow-wrap:anywhere}.entry-order{margin:3px 0 0;font-size:12px;line-height:1.5;color:#61758b;overflow-wrap:anywhere}.visibility-badge{flex-shrink:0;padding:5px 9px;border-radius:20px;background:#f0f3f7;color:#56677e;font-size:11px;font-weight:600}.visibility-badge.is-public{background:#e8f5ee;color:#246846}.entry-meta{display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px;margin:18px 0 12px}.entry-stars{margin:0;color:#b57400;font-size:21px;letter-spacing:2px;line-height:1.4}.empty-stars{color:#b2c2d3}.entry-meta time{margin:0;color:#61758b;font-size:12px}.feedback-review{flex:1;white-space:pre-wrap;overflow-wrap:anywhere;margin:0;padding:16px;background:#f7faff;border-radius:10px;font-size:14px;line-height:1.75}.entry-footer{display:flex;flex-direction:column;align-items:flex-start;gap:12px;margin-top:18px;padding-top:16px;border-top:1px solid #edf1f6}.publication-note{margin:0;color:#61758b;font-size:12px;line-height:1.6}.entry-footer button{min-height:44px;font-size:13px}.feedback-pagination{justify-content:center;margin-top:24px;padding-top:20px;border-top:1px solid #edf1f6;gap:14px}.feedback-pagination span{font-size:13px;color:#56677e}.feedback-empty{padding:40px 20px;text-align:center;color:#61758b;background:#f7faff;border:1px dashed #cbd9e8;border-radius:16px}
@media(max-width:1000px){.feedback-grid{grid-template-columns:1fr}}@media(max-width:480px){.feedback-toolbar{align-items:flex-start;flex-direction:column;gap:14px}.feedback-entry{padding:16px}.entry-header{flex-wrap:wrap}.entry-identity{min-width:120px}.entry-footer button{width:100%}.feedback-pagination{gap:8px}.feedback-pagination button{padding-inline:12px}}
</style>
