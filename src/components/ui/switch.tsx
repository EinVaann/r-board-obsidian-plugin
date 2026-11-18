import * as React from "react"
import { cn } from "@/lib/utils"
import { Switch as SwitchPrimitive } from "radix-ui"

// shadcn switch; size, corners and colours come from the --rb-switch-* tokens (Industrial: low, wide, squared, yellow on).
function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "rb:peer rb:relative rb:inline-flex rb:shrink-0 rb:items-center rb:m-0 rb:p-0 rb:border-0 rb:shadow-none rb:cursor-pointer rb:transition-colors rb:outline-none",
        "rb:h-switch-h rb:w-switch-w rb:rounded-switch rb:bg-switch-off rb:data-[state=checked]:bg-switch-on",
        "rb:focus-visible:ring-2 rb:focus-visible:ring-ring rb:disabled:cursor-not-allowed rb:disabled:opacity-50",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "rb:pointer-events-none rb:block rb:w-switch-thumb rb:h-[calc(var(--rb-switch-h)-2*var(--rb-switch-pad))] rb:rounded-switch-thumb rb:shadow-sm rb:transition-transform",
          "rb:bg-switch-thumb rb:data-[state=checked]:bg-switch-thumb-on",
          "rb:translate-x-switch-pad rb:data-[state=checked]:translate-x-[calc(var(--rb-switch-w)-var(--rb-switch-thumb-w)-var(--rb-switch-pad))]"
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
