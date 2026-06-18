import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// Mock the generated API hooks so the new-vehicle form renders without a real
// server / react-query network layer. The color-mismatch warning we test below
// is driven entirely by the scan prefill, not by these hooks or fetch.
vi.mock("@workspace/api-client-react", () => ({
  useCreateVehicle: () => ({ mutate: vi.fn(), isPending: false }),
  useImportVehicleFromTp: () => ({ mutate: vi.fn(), isPending: false }),
  useListVehicleMakes: () => ({ data: [] }),
  useListVehicleModels: () => ({ data: [] }),
  getListVehiclesQueryKey: () => ["vehicles"],
}));

// Control the scan prefill the form picks up on mount.
const takeVehiclePrefill = vi.fn();
vi.mock("@/lib/scan-prefill", () => ({
  takeVehiclePrefill: () => takeVehiclePrefill(),
}));

import NewVehicle from "../new";

// The warning renders as a single <span> split with Czech quote glyphs; match a
// stable middle fragment so we don't depend on the exact quote characters.
const COLOR_WARNING = /na fotografii vypadá/;

function renderForm() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  return render(<NewVehicle />, { wrapper: Wrapper });
}

// A scan that read one color from the TP but observed a different one on the
// vehicle photo — the form should warn the mechanic to double-check.
function mismatchScanPrefill() {
  return {
    licensePlate: "1AB2345",
    color: "Bílá",
    colorObserved: "Stříbrná",
    colorMismatch: true,
  };
}

describe("New vehicle color-mismatch warning after a scan", () => {
  beforeEach(() => {
    takeVehiclePrefill.mockReset();
    vi.restoreAllMocks();
    // The form never calls fetch for the color path, but stub it so a stray
    // call (e.g. an ARES auto-verify) can never hit the real network.
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows the amber color warning when the scan saw a different color than the TP", async () => {
    takeVehiclePrefill.mockReturnValue(mismatchScanPrefill());

    renderForm();

    const warning = await screen.findByText(COLOR_WARNING);
    expect(warning).toBeInTheDocument();
    // The warning names both the TP color and the photographed color.
    expect(warning).toHaveTextContent("Bílá");
    expect(warning).toHaveTextContent("Stříbrná");
    // The Barva field is prefilled with the TP color.
    expect(screen.getByDisplayValue("Bílá")).toBeInTheDocument();
  });

  it("clears the warning once the user edits the Barva field", async () => {
    const user = userEvent.setup();
    takeVehiclePrefill.mockReturnValue(mismatchScanPrefill());

    renderForm();
    expect(await screen.findByText(COLOR_WARNING)).toBeInTheDocument();

    const colorInput = screen.getByDisplayValue("Bílá");
    await user.type(colorInput, "X");

    await waitFor(() => {
      expect(screen.queryByText(COLOR_WARNING)).not.toBeInTheDocument();
    });
  });

  it("shows no warning when the scan reports no color mismatch", async () => {
    takeVehiclePrefill.mockReturnValue({
      licensePlate: "1AB2345",
      color: "Bílá",
      colorObserved: "Bílá",
      colorMismatch: false,
    });

    renderForm();

    // Wait for the prefill to settle (Barva populated from the scan).
    await screen.findByDisplayValue("Bílá");
    expect(screen.queryByText(COLOR_WARNING)).not.toBeInTheDocument();
  });
});
