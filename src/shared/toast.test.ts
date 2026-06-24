import { beforeEach, describe, expect, it, vi } from "vitest";

import { toast } from "./toast";
import { toast as sonnerToast } from "sonner";

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
  },
}));

const sonnerSuccessMock = vi.mocked(sonnerToast.success);

describe("toast", () => {
  beforeEach(() => {
    sonnerSuccessMock.mockReset();
  });

  it("uses a three second duration for success toasts by default", () => {
    toast.success("Deleted successfully");

    expect(sonnerSuccessMock).toHaveBeenCalledWith("Deleted successfully", {
      duration: 3000,
    });
  });
});
