"use client"

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Tabs as TabsPrimitive } from "radix-ui"

// shadcn tabs. `line` (settings dialogs): plain text on a hairline, the theme's indicator under the active tab.
function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      orientation={orientation}
      className={cn(
        "rb:group/tabs rb:flex rb:gap-2 rb:data-[orientation=horizontal]:flex-col",
        className
      )}
      {...props}
    />
  )
}

const tabsListVariants = cva(
  "rb:group/tabs-list rb:inline-flex rb:items-center rb:text-muted-foreground rb:group-data-[orientation=vertical]/tabs:h-fit rb:group-data-[orientation=vertical]/tabs:flex-col",
  {
    variants: {
      variant: {
        default: "rb:w-fit rb:justify-center rb:rounded-control rb:bg-track rb:p-[3px]",
        line: "rb:w-full rb:justify-start rb:gap-[var(--rb-tabs-gap)] rb:overflow-x-auto rb:overflow-y-hidden rb:bg-transparent rb:shadow-[inset_0_-1px_0_var(--rb-divider)] rb:[scrollbar-width:none]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function TabsList({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> &
  VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    />
  )
}

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "rb:inline-flex rb:items-center rb:gap-1.5 rb:m-0 rb:border-0 rb:bg-transparent rb:shadow-none rb:text-control rb:font-medium rb:whitespace-nowrap rb:text-faint-foreground rb:cursor-pointer rb:transition-colors rb:outline-none",
        "rb:hover:text-foreground rb:focus-visible:ring-2 rb:focus-visible:ring-ring rb:disabled:pointer-events-none rb:disabled:opacity-50",
        "rb:[&_svg]:pointer-events-none rb:[&_svg]:shrink-0 rb:[&_svg:not([class*=size-])]:size-[15px] rb:[&_.rb-icon]:inline-flex",
        // default: a pill on a track
        "rb:group-data-[variant=default]/tabs-list:h-[calc(var(--rb-control-h)-8px)] rb:group-data-[variant=default]/tabs-list:px-control-px rb:group-data-[variant=default]/tabs-list:rounded-control-sm",
        "rb:group-data-[variant=default]/tabs-list:data-[state=active]:bg-segment-on rb:group-data-[variant=default]/tabs-list:data-[state=active]:text-segment-on-foreground rb:group-data-[variant=default]/tabs-list:data-[state=active]:shadow-segment-on",
        // line: text over an underline
        "rb:group-data-[variant=line]/tabs-list:h-auto rb:group-data-[variant=line]/tabs-list:py-2.5 rb:group-data-[variant=line]/tabs-list:px-[var(--rb-tabs-px)] rb:group-data-[variant=line]/tabs-list:rounded-none",
        "rb:group-data-[variant=line]/tabs-list:border-b-2 rb:group-data-[variant=line]/tabs-list:border-solid rb:group-data-[variant=line]/tabs-list:border-transparent",
        "rb:group-data-[variant=line]/tabs-list:data-[state=active]:border-[var(--rb-tabs-indicator)] rb:data-[state=active]:text-foreground",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("rb:flex-1 rb:outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
