import { cn } from "@autopr/ui/lib/utils";
import * as React from "react";

function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    // react-doctor-disable-next-line react-doctor/label-has-associated-control -- Label is a primitive; consumers provide htmlFor or wrap controls.
    <label
      data-slot="label"
      className={cn(
        "flex items-center gap-2 text-xs leading-none select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Label };
