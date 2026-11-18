import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Slot } from "radix-ui"

// shadcn badge. `tint`: tinted by the --rb-pill-c colour set inline (option values, tags); the default is neutral.
const badgeVariants = cva(
  "rb:inline-flex rb:w-fit rb:shrink-0 rb:items-center rb:justify-center rb:gap-0.5 rb:overflow-hidden rb:h-pill-h rb:px-2 rb:rounded-pill rb:border-0 rb:text-[length:var(--rb-pill-font)] rb:font-medium rb:whitespace-nowrap rb:[&>svg]:pointer-events-none rb:[&>svg]:size-3",
  {
    variants: {
      variant: {
        default: "rb:bg-accent rb:text-muted-foreground",
        tint: "rb:bg-[color-mix(in_srgb,var(--rb-pill-c,var(--rb-pill-default))_22%,transparent)] rb:text-[color-mix(in_srgb,var(--rb-pill-c,var(--rb-pill-default))_65%,var(--text-normal))]",
        secondary: "rb:bg-secondary rb:text-secondary-foreground",
        destructive: "rb:bg-danger-surface rb:text-destructive",
        outline: "rb:border rb:border-solid rb:border-border rb:bg-transparent rb:text-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
