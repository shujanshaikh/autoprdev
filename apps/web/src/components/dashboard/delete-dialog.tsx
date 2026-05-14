import { Button } from "@autopr/ui/components/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@autopr/ui/components/dialog";
import { Loader2, Trash2 } from "lucide-react";

interface DeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectName: string;
  isDeleting: boolean;
  onDelete: () => void;
}

export function DeleteDialog({
  open,
  onOpenChange,
  projectName,
  isDeleting,
  onDelete,
}: DeleteDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-6 border-border bg-background p-0">
        <div className="border-b border-border bg-destructive/[0.04] px-6 py-5">
          <DialogHeader className="gap-3">
            <DialogTitle className="text-base font-semibold tracking-tight">
              Delete project?
            </DialogTitle>
            <DialogDescription className="text-sm leading-relaxed text-muted-foreground">
              This will permanently remove{" "}
              <span className="font-mono text-foreground">{projectName}</span> and all of its
              threads and messages. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
        </div>
        <DialogFooter className="px-6 pb-6 gap-3">
          <DialogClose render={<Button variant="outline" disabled={isDeleting} className="h-10 px-5">Cancel</Button>} />
          <Button
            type="button"
            variant="destructive"
            disabled={isDeleting}
            onClick={onDelete}
            className="h-10 gap-2 px-5"
          >
            {isDeleting ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Trash2 className="size-4" aria-hidden="true" />
            )}
            Delete project
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
