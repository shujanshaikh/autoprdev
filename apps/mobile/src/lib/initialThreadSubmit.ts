import AsyncStorage from "@react-native-async-storage/async-storage";

const submitKey = (threadId: string) => `autopr.mobile.initial-submit:${threadId}`;

/**
 * Claims the one-time initial prompt handoff and invokes the callback only
 * while its owning screen is still mounted.
 */
export function consumeInitialThreadSubmit(threadId: string, onConsume: () => void) {
  let active = true;
  void AsyncStorage.getItem(submitKey(threadId)).then((submitted) => {
    if (!active || submitted === "submitted") return;
    return AsyncStorage.setItem(submitKey(threadId), "submitted").then(() => {
      if (active) onConsume();
    });
  }).catch(() => {
    // A storage failure should not strand a freshly-created thread without
    // submitting the prompt that created it.
    if (active) onConsume();
  });
  return () => {
    active = false;
  };
}
