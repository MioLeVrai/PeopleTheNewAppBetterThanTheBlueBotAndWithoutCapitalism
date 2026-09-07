"use strict";

const {
  contextBridge,
  ipcRenderer
} = require("electron");

contextBridge.exposeInMainWorld(
  "peopleUpdate",
  {
    getState() {
      return ipcRenderer.invoke(
        "people-update:get-state"
      );
    },

    close() {
      ipcRenderer.send(
        "people-update:close"
      );
    },

    install() {
      return ipcRenderer.invoke(
        "people-update:install"
      );
    },

    onProgress(callback) {
      const listener =
        (_event, payload) => {
          callback(payload);
        };

      ipcRenderer.on(
        "people-update:progress",
        listener
      );

      return () => {
        ipcRenderer.removeListener(
          "people-update:progress",
          listener
        );
      };
    }
  }
);
