import AsyncStorage from "@react-native-async-storage/async-storage";

const submitKey = (threadId: string) => `autopr.mobile.initial-submit:${threadId}`;

/**
 * Claims the one-time initial prompt handoff and invokes the callback only
 * while its owning screen is still mounted.
 */
export function consumeInitialThreadSubmit(threadId: string, onConsume: () => void) {
  let active = true;
  void AsyncStorage.getItem(submitKey(threadId))
    .then(async (submitted) => {
      if (!active || submitted === "submitted") return false;
      await AsyncStorage.setItem(submitKey(threadId), "submitted");
      return true;
    })
    .catch(() => {
      // A storage failure should not strand a freshly-created thread without
      // submitting the prompt that created it.
      return true;
    })
    .then((shouldSubmit) => {
      if (active && shouldSubmit) onConsume();
    })
    .catch(() => undefined);
  return () => {
    active = false;
  };
}
