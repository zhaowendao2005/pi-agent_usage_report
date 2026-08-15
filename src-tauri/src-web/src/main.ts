import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import './assets/main.css'
import { useUsageStore } from './stores/usage'

const app = createApp(App)
const pinia = createPinia()
app.use(pinia)

const store = useUsageStore(pinia)
void store.init()

app.mount('#app')
