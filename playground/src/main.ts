import { createSSRApp } from "vue";
import App from "./App.vue";
import "./plugins/router";
export function createApp() {
  const app = createSSRApp(App);
  return {
    app,
  };
}
