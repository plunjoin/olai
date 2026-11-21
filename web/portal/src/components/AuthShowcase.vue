<template>
  <aside class="auth-showcase">
    <a class="auth-brand" href="/" :aria-label="t('小o 首页')">
      <BrandLogo :size="34" />
      <span>Olai<small>Online AI Companion</small></span>
    </a>
    <div class="auth-showcase-body">
      <p class="auth-kicker">Olai · Online AI Companion</p>
      <p class="auth-showcase-title">{{ t('让灵感，') }}<br /><em>{{ t('在这里长大。') }}</em></p>
      <p class="auth-showcase-copy">{{ t('对话、图像、视频与音乐，都在同一个温暖的创作空间里。登录后会同步你的游客记录，换一台设备也能继续。') }}</p>
      <div class="auth-points">
        <div v-for="point in points" :key="point.text" class="auth-point">
          <span class="auth-point-icon"><component :is="point.icon" :size="16" :stroke-width="1.8" /></span>
          <span>{{ point.text }}</span>
        </div>
      </div>
    </div>
    <div class="auth-mascot"><Companion :size="248" animated /></div>
    <p class="auth-footline"><span>{{ t('对话') }}</span><span>{{ t('图像') }}</span><span>{{ t('视频') }}</span><span>{{ t('音乐') }}</span></p>
  </aside>
</template>

<script setup lang="ts">
import { CloudUpload, Images, Sparkles } from 'lucide-vue-next';
import BrandLogo from './BrandLogo.vue';
import Companion from './Companion.vue';
import { t } from '../lib/i18n';

const points = [
  { icon: CloudUpload, text: t('游客记录自动同步到账号') },
  { icon: Images, text: t('作品广场与个人库跨设备可见') },
  { icon: Sparkles, text: t('每日额度与积分清晰可查') },
];
</script>
