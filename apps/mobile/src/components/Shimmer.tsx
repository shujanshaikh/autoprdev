import { useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";

const DIM_OPACITY = 0.42;
/** Width of the travelling highlight, as a fraction of the label. */
const SPREAD = 0.4;
const DEFAULT_DURATION = 1_600;

function useReduceMotion() {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (active) setReduceMotion(enabled);
    }).catch(() => {
      // A missing accessibility bridge should not disable the animation.
    });
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  return reduceMotion;
}

function useLoopedProgress(enabled: boolean, duration: number) {
  const progressRef = useRef<Animated.Value | null>(null);
  progressRef.current ??= new Animated.Value(0);
  const progress = progressRef.current;

  useEffect(() => {
    if (!enabled) {
      progress.setValue(0);
      return;
    }
    const animation = Animated.loop(Animated.timing(progress, {
      toValue: 1,
      duration,
      easing: Easing.linear,
      useNativeDriver: true,
    }));
    animation.start();
    return () => {
      animation.stop();
      progress.setValue(0);
    };
  }, [duration, enabled, progress]);

  return progress;
}

function truncate(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

/**
 * A highlight that travels across a short label while work is still streaming,
 * mirroring the gradient sweep the web thread uses. React Native has no
 * `background-clip: text`, so the sweep is reproduced by animating per-glyph
 * opacity off one shared driver value — which keeps it on the native driver.
 */
export function Shimmer({
  children,
  style,
  duration = DEFAULT_DURATION,
  maxLength = 72,
}: {
  children: string;
  style?: StyleProp<TextStyle>;
  duration?: number;
  maxLength?: number;
}) {
  const reduceMotion = useReduceMotion();
  const label = truncate(children, maxLength);
  const progress = useLoopedProgress(!reduceMotion, duration);
  const glyphs = useMemo(() => [...label], [label]);

  if (reduceMotion || glyphs.length === 0) {
    return (
      <Text numberOfLines={1} style={style}>
        {label}
      </Text>
    );
  }

  const half = SPREAD / (1 + 2 * SPREAD);
  return (
    <View accessibilityLabel={label} accessible style={styles.row}>
      {glyphs.map((glyph, index) => {
        const position = glyphs.length === 1 ? 0 : index / (glyphs.length - 1);
        const crest = (position + SPREAD) / (1 + 2 * SPREAD);
        return (
          <Animated.Text
            // Glyph order is the identity here: the same character repeats.
            key={`${index}:${glyph}`}
            style={[
              style,
              {
                opacity: progress.interpolate({
                  inputRange: [crest - half, crest, crest + half],
                  outputRange: [DIM_OPACITY, 1, DIM_OPACITY],
                  extrapolate: "clamp",
                }),
              },
            ]}
          >
            {glyph}
          </Animated.Text>
        );
      })}
    </View>
  );
}

/**
 * The three-dot "the agent is thinking" cue from the web thread.
 */
export function PulsingDots({
  color,
  size = 6,
  style,
}: {
  color: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const reduceMotion = useReduceMotion();
  const progress = useLoopedProgress(!reduceMotion, 1_100);

  return (
    <View style={[styles.dots, style]}>
      {[0, 1, 2].map((index) => {
        const crest = 0.2 + index * 0.2;
        return (
          <Animated.View
            key={index}
            style={{
              width: size,
              height: size,
              borderRadius: size / 2,
              backgroundColor: color,
              opacity: reduceMotion ? 0.55 : progress.interpolate({
                inputRange: [crest - 0.22, crest, crest + 0.22],
                outputRange: [0.28, 1, 0.28],
                extrapolate: "clamp",
              }),
            }}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexShrink: 1, flexDirection: "row", alignItems: "baseline", overflow: "hidden" },
  dots: { flexDirection: "row", alignItems: "center", gap: 4 },
});
