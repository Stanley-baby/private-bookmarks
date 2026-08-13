import { defineConfig } from "wxt";

export default defineConfig({
  srcDir: "src",
  entrypointsDir: "entrypoints",
  publicDir: "wxt/public",
  manifestVersion: 3,
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "私有书签",
    version: "0.1.0",
    description: "__MSG_appDesc__",
    default_locale: "en",
    permissions: ["activeTab", "alarms", "contextMenus", "scripting", "sidePanel", "storage"],
    optional_permissions: ["tabs"],
    optional_host_permissions: ["https://*/*"],
    omnibox: { keyword: "pb" },
    commands: {
      save_page: {
        suggested_key: { default: "Ctrl+Shift+S" },
        description: "__MSG_savePageOrHighlight__",
      },
      open_side_panel: {
        suggested_key: { default: "Ctrl+Period" },
        description: "__MSG_openSidePanel__",
      },
    },
  },
});
