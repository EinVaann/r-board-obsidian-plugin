"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { Label as LabelPrimitive } from "radix-ui"

// shadcn label, sized to the --rb-font-label token.
function Label({
  className,
  ...props
}: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(
        "rb:flex rb:items-center rb:gap-1.5 rb:text-label rb:leading-none rb:font-medium rb:text-foreground rb:select-none rb:group-data-[disabled=true]:pointer-events-none rb:group-data-[disabled=true]:opacity-50 rb:peer-disabled:cursor-not-allowed rb:peer-disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

export { Label }
