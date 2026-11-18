import * as React from "react"
import { cn } from "@/lib/utils"
import { Separator as SeparatorPrimitive } from "radix-ui"

function Separator({
  className,
  orientation = "horizontal",
  decorative = true,
  ...props
}: React.ComponentProps<typeof SeparatorPrimitive.Root>) {
  return (
    <SeparatorPrimitive.Root
      data-slot="separator"
      decorative={decorative}
      orientation={orientation}
      className={cn(
        "rb:shrink-0 rb:border-0 rb:m-0 rb:bg-divider rb:data-[orientation=horizontal]:h-px rb:data-[orientation=horizontal]:w-full rb:data-[orientation=vertical]:h-full rb:data-[orientation=vertical]:w-px",
        className
      )}
      {...props}
    />
  )
}

export { Separator }
