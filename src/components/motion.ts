/**
 * Tiny animation shim. A dependency-free subset of framer-motion's API for
 * the simple fade/slide transitions this app uses — keeps the bundle light.
 */
import {
  createElement,
  forwardRef,
  useEffect,
  useState,
  type CSSProperties,
  type ReactNode
} from 'react'

type DivProps = React.HTMLAttributes<HTMLDivElement>

interface MotionProps extends Omit<DivProps, 'children'> {
  children?: ReactNode
  initial?: Record<string, number>
  animate?: Record<string, number>
  exit?: Record<string, number>
  transition?: { duration?: number }
}

function toStyle(v: Record<string, number> | undefined): CSSProperties {
  if (!v) return {}
  const style: CSSProperties = {}
  if (v.opacity !== undefined) style.opacity = v.opacity
  const x = v.x ?? 0
  const y = v.y ?? 0
  const scale = v.scale ?? 1
  if (x || y || scale !== 1) style.transform = `translate(${x}px, ${y}px) scale(${scale})`
  return style
}

const MotionDiv = forwardRef<HTMLDivElement, MotionProps>(function MotionDiv(
  { initial, animate, exit: _exit, transition, style, ...rest },
  ref
) {
  const [entered, setEntered] = useState(false)
  useEffect(() => {
    const raf = requestAnimationFrame(() => setEntered(true))
    return () => cancelAnimationFrame(raf)
  }, [])
  const duration = transition?.duration ?? 0.25
  return createElement('div', {
    ...rest,
    ref,
    style: {
      ...style,
      transition: `opacity ${duration}s ease, transform ${duration}s ease`,
      ...(entered ? toStyle(animate) : toStyle(initial))
    }
  })
})

export const motion = { div: MotionDiv }

export function AnimatePresence({ children }: { children?: ReactNode }) {
  // Exit animations are short enough that passthrough unmount is fine here.
  return createElement('div', { style: { display: 'contents' } }, children)
}
