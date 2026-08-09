/** Shared window identity so every login entry point reuses the same popup. */
export const CHATGPT_LOGIN_POPUP_NAME = "login-with-chatgpt";

/** Window features that make `window.open` produce a popup instead of a tab. */
export const CHATGPT_LOGIN_POPUP_FEATURES =
  "popup=yes,width=520,height=680,menubar=no,toolbar=no,location=yes";
