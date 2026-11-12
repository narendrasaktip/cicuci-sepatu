<script setup lang="ts">
import { defineAsyncComponent, onMounted, onUnmounted, ref } from 'vue';
import { ApiError, currentUser, login, logout, type User } from './services/auth';
import logo from './assets/logo.webp';
const AdminWorkspace = defineAsyncComponent(() => import('./components/AdminWorkspace.vue'));
const PublicTracking = defineAsyncComponent(() => import('./components/PublicTracking.vue'));
import PublicLanding from './components/PublicLanding.vue';
const trackPath = window.location.pathname.match(/^\/track\/([^/]+)\/?$/);
const adminPath = /^\/admin\/?$/.test(window.location.pathname);
const token = trackPath?.[1] ?? '';
const user = ref<User | null>(null); const email = ref(''); const password = ref(''); const error = ref(''); const busy = ref(true);
function expired() { user.value = null; error.value = 'Sesi berakhir. Silakan masuk kembali.'; }
onMounted(async () => { if (!adminPath) { busy.value = false; return; } window.addEventListener('session-expired', expired); try { user.value = await currentUser(); } catch (cause) { if (!(cause instanceof ApiError && cause.status === 401)) error.value = cause instanceof Error ? cause.message : 'Pemeriksaan sesi gagal.'; else error.value = ''; } finally { busy.value = false; } });
onUnmounted(() => window.removeEventListener('session-expired', expired));
async function submit() { busy.value = true; error.value = ''; try { user.value = await login(email.value, password.value); password.value = ''; } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Login gagal.'; } finally { busy.value = false; } }
async function signOut() { busy.value = true; try { await logout(); user.value = null; } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Logout gagal.'; } finally { busy.value = false; } }
</script>
<template>
  <a
    href="#main-content"
    class="skip-link"
  >Lewati ke konten</a>
  <PublicTracking
    v-if="trackPath"
    :token="token"
  />
  <PublicLanding v-else-if="!adminPath" />
  <template v-else-if="user">
    <p
      v-if="error"
      role="alert"
      class="error"
    >
      {{ error }}
    </p><AdminWorkspace
      :user="user"
      @logout="signOut"
    />
  </template>
  <main
    v-else
    id="main-content"
    class="login-page theme-new"
  >
    <section class="login-card">
      <a
        class="brand login-brand"
        href="/"
      ><img
        :src="logo"
        alt="Cicuci Sepatu"
        width="540"
        height="360"
      ></a><p class="eyebrow">
        Management System
      </p><h1>Masuk Cicuci Admin</h1><p class="muted">
        Kelola setiap sepatu, dari diterima sampai kembali ke pelanggan.
      </p><p
        v-if="error"
        role="alert"
        class="error"
      >
        {{ error }}
      </p><form
        :aria-busy="busy"
        @submit.prevent="submit"
      >
        <label for="email">Email<input
          id="email"
          v-model="email"
          type="email"
          required
          maxlength="191"
          autocomplete="username"
        ></label><label for="password">Password<input
          id="password"
          v-model="password"
          type="password"
          required
          maxlength="128"
          autocomplete="current-password"
        ></label><button :disabled="busy">
          {{ busy ? 'Memuat…' : 'Masuk' }}
        </button>
      </form>
    </section>
  </main>
</template>
