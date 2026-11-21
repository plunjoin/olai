<template>
  <div class="adm-split">
    <section class="adm-card">
      <form class="adm-toolbar" @submit.prevent="searchUsers">
        <input v-model="input" class="adm-input" :placeholder="t('搜索邮箱或账号 ID')" :aria-label="t('搜索账号')" />
        <button type="submit" class="adm-btn">{{ t('搜索') }}</button>
        <button v-if="input || query" type="button" class="adm-btn" @click="clearSearch">{{ t('清除') }}</button>
        <span class="adm-card-sub">{{ t('共 {n} 个账号', { n: data?.total ?? '—' }) }}</span>
      </form>
      <div v-if="error" class="adm-feedback" data-tone="error" role="alert">{{ error }} <button type="button" class="adm-btn adm-btn-sm" @click="load">{{ t('重试') }}</button></div>
      <p v-if="loading && !data" class="adm-note"><span class="adm-spinner" /> {{ t('加载中…') }}</p>
      <div v-if="data && !data.users.length" class="adm-empty">{{ t('没有匹配的账号。') }}</div>
      <div v-if="data?.users.length" class="adm-table-wrap">
        <table class="adm-table">
          <thead><tr><th>{{ t('邮箱') }}</th><th>{{ t('注册时间') }}</th><th class="num">{{ t('积分') }}</th><th>{{ t('状态') }}</th></tr></thead>
          <tbody>
            <tr v-for="row in data.users" :key="row.id" class="adm-clickable" :class="{ 'adm-row-active': selected === row.id }" @click="selected = row.id">
              <td>{{ row.email }}<div class="adm-mono muted">{{ row.id }}</div></td>
              <td class="muted">{{ adminWhen(row.createdAt) }}</td>
              <td class="num">{{ row.balance }}</td>
              <td><span class="adm-badge" :data-tone="row.bannedAt ? 'danger' : 'ok'">{{ row.bannedAt ? t('已停用') : t('正常') }}</span></td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="adm-pagination">
        <button type="button" class="adm-btn adm-btn-sm" :disabled="page <= 1" @click="page = Math.max(1, page - 1)">{{ t('上一页') }}</button>
        <span>{{ t('第 {page} 页', { page }) }}</span>
        <button type="button" class="adm-btn adm-btn-sm" :disabled="!data?.nextPage" @click="page = data?.nextPage ?? page">{{ t('下一页') }}</button>
      </div>
    </section>

    <UserDetail v-if="selected" :key="selected" :id="selected" @changed="load" @close="selected = null" />
    <section v-else class="adm-card"><div class="adm-empty">{{ t('选择左侧账号查看积分流水、邀请关系与封禁操作。') }}</div></section>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import UserDetail from './UserDetail.vue';
import { adminApi, adminWhen, errorMessage } from '../../lib/admin';
import { t } from '../../lib/i18n';

interface UserRow { id: string; email: string; createdAt: number; balance: number; bannedAt: number | null; banReason: string | null }
interface UsersData { users: UserRow[]; total: number; nextPage: number | null }
const data = ref<UsersData | null>(null);
const error = ref('');
const loading = ref(true);
const input = ref('');
const query = ref('');
const page = ref(1);
const selected = ref<string | null>(null);
async function load() {
  loading.value = true;
  try { data.value = await adminApi<UsersData>(`/api/admin/users?page=${page.value}&q=${encodeURIComponent(query.value)}`); error.value = ''; }
  catch (failure) { error.value = errorMessage(failure, '加载失败。'); }
  finally { loading.value = false; }
}
function searchUsers() { selected.value = null; page.value = 1; query.value = input.value.trim(); void load(); }
function clearSearch() { input.value = ''; query.value = ''; page.value = 1; void load(); }
watch(page, load);
onMounted(load);
</script>
