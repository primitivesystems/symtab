import { toast } from "@symtab/shared-ui/components/sonner";
import { errorMessage } from "./helpers";

export interface AsyncFeedback {
  loading: string;
  success: string;
  error: string;
  id?: string;
}

export function runWithToast<T>(operation: Promise<T>, feedback: AsyncFeedback) {
  return toast
    .promise(operation, {
      id: feedback.id,
      loading: feedback.loading,
      success: feedback.success,
      error: (error) => ({ message: feedback.error, description: errorMessage(error) }),
    })
    .unwrap();
}
