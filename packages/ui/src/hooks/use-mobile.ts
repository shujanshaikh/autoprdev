import { hasUndefinedType } from "@autopr/config/runtime-type";

import * as React from "react"

const MOBILE_BREAKPOINT = 768

export function useIsMobile() {
  return React.useSyncExternalStore(
    (onStoreChange) => {
      if (hasUndefinedType(globalThis.window)) {
        return () => {}
      }

      const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
      mql.addEventListener("change", onStoreChange)
      return () => mql.removeEventListener("change", onStoreChange)
    },
    () => (hasUndefinedType(globalThis.window) ? false : window.innerWidth < MOBILE_BREAKPOINT),
    () => false,
  )
}
