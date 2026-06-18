import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// The km-prefill safeguard spans two pages connected by the real scan-prefill
// sessionStorage hand-off:
//   1. tp-scan's goToNewWorkOrder is the GUARD — it only stashes a km when the
//      scanned odometer is strictly greater than the stored currentKm (protects
//      against a misread mileage going backwards).
//   2. work-orders/new is the CONSUMER — it prefills the "Aktuální km" field
//      from whatever the guard stored.
// These tests drive both pages through the *real* scan-prefill module so the
// guard + the field prefill are exercised end to end.

const mocks = vi.hoisted(() => ({
  scanData: null as TpExtractedDataLike | null,
  foundVehicle: null as VehicleLike | null,
  navigate: vi.fn(),
}));

type TpExtractedDataLike = {
  licensePlate: string | null;
  vin: string | null;
  registrationYear: number | null;
  engineDisplacement: number | null;
  make: string | null;
  model: string | null;
  odometerKm: number | null;
  ownerName: string | null;
  ownerIco: string | null;
  ownerAddress: string | null;
  ownerType: string | null;
  color: string | null;
  colorObserved: string | null;
  colorMismatch: boolean;
};

type VehicleLike = {
  id: string;
  make: string;
  model: string;
  ownerName: string | null;
  ownerPhone: string | null;
  currentKm: number | null;
};

vi.mock("wouter", () => ({
  useLocation: () => ["/", mocks.navigate],
  useSearch: () => "",
  Link: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

// Both pages read vehicles through these generated hooks; stub them so the
// pages render without a real server. The scan-prefill hand-off we test does
// NOT go through these hooks — it uses the real @/lib/scan-prefill module.
vi.mock("@workspace/api-client-react", () => ({
  useGetVehicleByPlate: () => ({
    data: mocks.foundVehicle ?? undefined,
    isFetching: false,
  }),
  useListVehicles: () => ({ data: [] }),
  useCreateWorkOrder: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateLoaner: () => ({ mutate: vi.fn(), isPending: false }),
  getListWorkOrdersQueryKey: () => ["work-orders"],
}));

// The real scan dialog opens the camera; replace it with a button that feeds a
// controlled scan result into tp-scan's onExtracted handler.
vi.mock("@/components/tp-scan-dialog", () => ({
  TpScanDialog: ({ onExtracted }: { onExtracted: (d: TpExtractedDataLike) => void }) => (
    <button
      data-testid="trigger-extract"
      onClick={() => mocks.scanData && onExtracted(mocks.scanData)}
    >
      extract
    </button>
  ),
}));

// The live phone->PC broadcast is irrelevant here; resolve as "no PC connected".
vi.mock("@/lib/scan-channel", () => ({
  sendScanHandoff: vi.fn().mockResolvedValue({ delivered: 0, kind: "work-order" }),
}));

import TpScanPage from "../../tp-scan";
import NewWorkOrder from "../new";

// These integration tests render two full pages, so the first test bears the
// (one-time) cost of transforming/importing both module trees. Give them more
// headroom than the 5s default so a cold start under CI load doesn't flake.
vi.setConfig({ testTimeout: 20000 });

function renderWithClient(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(ui, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
}

function buildScan(odometerKm: number | null): TpExtractedDataLike {
  return {
    licensePlate: "1AB2345",
    vin: null,
    registrationYear: null,
    engineDisplacement: null,
    make: null,
    model: null,
    odometerKm,
    ownerName: null,
    ownerIco: null,
    ownerAddress: null,
    ownerType: null,
    color: null,
    colorObserved: null,
    colorMismatch: false,
  };
}

function buildVehicle(currentKm: number | null): VehicleLike {
  return {
    id: "v1",
    make: "Škoda",
    model: "Octavia",
    ownerName: "Jan Novák",
    ownerPhone: null,
    currentKm,
  };
}

// Render tp-scan, feed it a scan result for a known vehicle, and click
// "Nová zakázka pro toto vozidlo" so the guard runs and (maybe) stashes a km.
async function scanThenStartWorkOrder() {
  const user = userEvent.setup();
  const view = renderWithClient(<TpScanPage />);
  await user.click(screen.getByTestId("trigger-extract"));
  const woButton = await screen.findByRole("button", {
    name: /Nová zakázka pro toto vozidlo/i,
  });
  await user.click(woButton);
  view.unmount();
}

function renderWorkOrderKmField(): HTMLInputElement {
  renderWithClient(<NewWorkOrder />);
  return screen.getByPlaceholderText("najeté km") as HTMLInputElement;
}

describe("Work order km-prefill safeguard after a vehicle scan", () => {
  beforeEach(() => {
    sessionStorage.clear();
    mocks.navigate.mockReset();
    mocks.scanData = null;
    mocks.foundVehicle = null;
    // jsdom lacks matchMedia, which tp-scan's touch detection probes on mount.
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as unknown as typeof window.matchMedia;
  });

  it("prefills the km field when the scanned odometer is higher than the stored currentKm", async () => {
    mocks.foundVehicle = buildVehicle(150000);
    mocks.scanData = buildScan(200000);

    await scanThenStartWorkOrder();

    const kmInput = renderWorkOrderKmField();
    await waitFor(() => expect(kmInput.value).toBe("200000"));
  });

  it("does NOT prefill the km field when the scanned odometer is lower than the stored currentKm", async () => {
    mocks.foundVehicle = buildVehicle(150000);
    mocks.scanData = buildScan(100000);

    await scanThenStartWorkOrder();

    const kmInput = renderWorkOrderKmField();
    // Give any prefill effect a chance to run before asserting it stayed empty.
    await new Promise((r) => setTimeout(r, 0));
    expect(kmInput.value).toBe("");
  });

  it("does NOT prefill the km field when the scanned odometer equals the stored currentKm", async () => {
    mocks.foundVehicle = buildVehicle(150000);
    mocks.scanData = buildScan(150000);

    await scanThenStartWorkOrder();

    const kmInput = renderWorkOrderKmField();
    await new Promise((r) => setTimeout(r, 0));
    expect(kmInput.value).toBe("");
  });

  it("prefills the km field when the known vehicle has no stored currentKm yet", async () => {
    mocks.foundVehicle = buildVehicle(null);
    mocks.scanData = buildScan(80000);

    await scanThenStartWorkOrder();

    const kmInput = renderWorkOrderKmField();
    await waitFor(() => expect(kmInput.value).toBe("80000"));
  });

  it("does NOT prefill the km field when the scan carried no odometer reading", async () => {
    mocks.foundVehicle = buildVehicle(150000);
    mocks.scanData = buildScan(null);

    await scanThenStartWorkOrder();

    const kmInput = renderWorkOrderKmField();
    await new Promise((r) => setTimeout(r, 0));
    expect(kmInput.value).toBe("");
  });

  it("guard stores only the gated km value in the hand-off payload", async () => {
    mocks.foundVehicle = buildVehicle(150000);
    mocks.scanData = buildScan(200000);

    await scanThenStartWorkOrder();

    expect(sessionStorage.getItem("workOrderScanPrefill")).toBe(
      JSON.stringify({ km: 200000 }),
    );
  });

  it("guard stores a null km when the scan would move mileage backwards", async () => {
    mocks.foundVehicle = buildVehicle(150000);
    mocks.scanData = buildScan(100000);

    await scanThenStartWorkOrder();

    expect(sessionStorage.getItem("workOrderScanPrefill")).toBe(
      JSON.stringify({ km: null }),
    );
  });
});
