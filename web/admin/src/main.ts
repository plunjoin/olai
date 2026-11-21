import { createApp } from 'vue';
import AdminApp from './AdminApp.vue';
import './styles/index.css';

document.body.classList.add('adm-body');
createApp(AdminApp).mount('#root');
