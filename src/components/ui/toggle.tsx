"use client"

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Toggle as TogglePrimitive } from "radix-ui"

// shadcn toggle. `segment`: one option of a segmented control (ToggleGroup on a track).
const toggleVariants = cva(
  "rb:inline-flex rb:items-center rb:justify-center rb:gap-1.5 rb:m-0 rb:border-0 rb:bg-transparent rb:shadow-none rb:font-medium rb:whitespace-nowrap rb:text-muted-foreground rb:cursor-pointer rb:transition-colors rb:outline-none rb:hover:text-foreground rb:focus-visible:ring-2 rb:focus-visible:ring-ring rb:disabled:pointer-events-none rb:disabled:opacity-50 rb:[&_svg]:pointer-events-none rb:[&_svg]:shrink-0 rb:[&_svg:not([class*=size-])]:size-icon-sm",
  {
    variants: {
      variant: {
        default: "rb:rounded-control-sm rb:hover:bg-accent rb:data-[state=on]:bg-accent rb:data-[state=on]:text-foreground",
        outline: "rb:rounded-control-sm rb:border rb:border-solid rb:border-input rb:hover:bg-accent rb:data-[state=on]:bg-accent rb:data-[state=on]:text-foreground",
        segment: "rb:rounded-[calc(var(--rb-control-radius)-3px)] rb:data-[state=on]:bg-segment-on rb:data-[state=on]:text-segment-on-foreground rb:data-[state=on]:shadow-segment-on",
      },
      size: {
        default: "rb:h-[calc(var(--rb-control-h)-8px)] rb:px-control-px rb:text-control-sm",
        sm: "rb:h-[calc(var(--rb-control-h-sm)-8px)] rb:px-control-px-sm rb:text-control-sm",
        lg: "rb:h-control rb:px-control-px rb:text-control",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Toggle({
  className,
  variant,
  size,
  ...props
}: React.ComponentProps<typeof TogglePrimitive.Root> &
  VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive.Root
      data-slot="toggle"
      className={cn(toggleVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Toggle, toggleVariants }
