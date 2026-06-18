import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// Mock the generated API hooks so the new-vehicle form renders without a real
// server / react-query network layer. The ARES warning we test below does NOT
// go through these hooks — it uses fetchAres (global fetch) directly.
vi.mock("@workspace/api-client-react", () => ({
  useCreateVehicle: () => ({ mutate: vi.fn(), isPending: false }),
  useImportVehicleFromTp: () => ({ mutate: vi.fn(), isPending: false }),
  useListVehicleMakes: () => ({ data: [] }),
  useListVehicleModels: () => ({ data: [] }),
  getListVehiclesQueryKey: () => ["vehicles"],
}));

// Control the scanned-owner prefill the form picks up on mount.
const takeVehiclePrefill = vi.fn();
vi.mock("@/lib/scan-prefill", () => ({
  takeVehiclePrefill: () => takeVehiclePrefill(),
}));

import NewVehicle from "../new";

const NOTFOUND_TEXT = "IČO nenalezeno v ARES – zkontrolujte údaje";
const ERROR_TEXT = "IČO se nepodařilo ověřit v ARES";

function renderForm() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  return render(<NewVehicle />, { wrapper: Wrapper });
}

// A scanned TP that prefilled a company owner with an IČ. The form auto-runs
// an ARES lookup for this IČ on mount.
function companyScanPrefill() {
  return {
    licensePlate: "1AB2345",
    ownerType: "company" as const,
    ownerName: "Naskenovaná Firma s.r.o.",
    ownerAddress: "Naskenovaná 1, Praha",
    ownerIco: "12345678",
  };
}

function mockFetchNotFound() {
  return vi.fn().mockResolvedValue({ ok: false, status: 404 } as Response);
}
function mockFetchError() {
  return vi.fn().mockResolvedValue({ ok: false, status: 500 } as Response);
}
function mockFetchOk() {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      name: "Ověřená Firma s.r.o.",
      address: "Ověřená 9, Brno",
      dic: "CZ12345678",
    }),
  } as Response);
}

describe("New vehicle ARES verification warning after a scan", () => {
  beforeEach(() => {
    takeVehiclePrefill.mockReset();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows the amber 'not found' warning when ARES cannot resolve the scanned IČ", async () => {
    takeVehiclePrefill.mockReturnValue(companyScanPrefill());
    vi.stubGlobal("fetch", mockFetchNotFound());

    renderForm();

    expect(await screen.findByText(NOTFOUND_TEXT)).toBeInTheDocument();
  });

  it("shows the amber 'could not verify' warning when the ARES registry is unreachable", async () => {
    takeVehiclePrefill.mockReturnValue(companyScanPrefill());
    vi.stubGlobal("fetch", mockFetchError());

    renderForm();

    expect(await screen.findByText(ERROR_TEXT)).toBeInTheDocument();
  });

  it("rejected fetch (network failure) also yields the 'could not verify' warning", async () => {
    takeVehiclePrefill.mockReturnValue(companyScanPrefill());
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    renderForm();

    expect(await screen.findByText(ERROR_TEXT)).toBeInTheDocument();
  });

  it("shows no warning (and the 'Ověřeno z ARES' badge) when ARES resolves the IČ", async () => {
    takeVehiclePrefill.mockReturnValue(companyScanPrefill());
    vi.stubGlobal("fetch", mockFetchOk());

    renderForm();

    expect(await screen.findByText("Ověřeno z ARES")).toBeInTheDocument();
    expect(screen.queryByText(NOTFOUND_TEXT)).not.toBeInTheDocument();
    expect(screen.queryByText(ERROR_TEXT)).not.toBeInTheDocument();
  });

  it("does not show a warning when the scan prefilled a private owner (no ARES lookup)", async () => {
    takeVehiclePrefill.mockReturnValue({
      licensePlate: "1AB2345",
      ownerType: "private" as const,
      ownerName: "Jan Novák",
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    renderForm();

    // Let any pending effects settle.
    await screen.findByText("Načteno ze skenu");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByText(NOTFOUND_TEXT)).not.toBeInTheDocument();
    expect(screen.queryByText(ERROR_TEXT)).not.toBeInTheDocument();
  });

  it("clears the warning after the user edits an owner field", async () => {
    const user = userEvent.setup();
    takeVehiclePrefill.mockReturnValue(companyScanPrefill());
    vi.stubGlobal("fetch", mockFetchNotFound());

    renderForm();
    expect(await screen.findByText(NOTFOUND_TEXT)).toBeInTheDocument();

    const nameInput = screen.getByDisplayValue("Naskenovaná Firma s.r.o.");
    await user.type(nameInput, "X");

    await waitFor(() => {
      expect(screen.queryByText(NOTFOUND_TEXT)).not.toBeInTheDocument();
    });
  });

  it("clears the warning after the user switches owner type to private", async () => {
    const user = userEvent.setup();
    takeVehiclePrefill.mockReturnValue(companyScanPrefill());
    vi.stubGlobal("fetch", mockFetchNotFound());

    renderForm();
    expect(await screen.findByText(NOTFOUND_TEXT)).toBeInTheDocument();

    await user.click(screen.getByLabelText("Soukromá osoba"));

    await waitFor(() => {
      expect(screen.queryByText(NOTFOUND_TEXT)).not.toBeInTheDocument();
    });
  });

  it("clears the warning after re-running ARES successfully via the 'Načíst z ARES' button", async () => {
    const user = userEvent.setup();
    takeVehiclePrefill.mockReturnValue(companyScanPrefill());
    // First call (auto-run on mount) fails; second call (button) succeeds.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 404 } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ name: "Ověřená Firma s.r.o.", address: "Ověřená 9, Brno", dic: "CZ12345678" }),
      } as Response);
    vi.stubGlobal("fetch", fetchMock);

    renderForm();
    expect(await screen.findByText(NOTFOUND_TEXT)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Načíst z ARES/i }));

    expect(await screen.findByText("Ověřeno z ARES")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText(NOTFOUND_TEXT)).not.toBeInTheDocument();
    });
  });

  it("scopes the warning to the owner section header", async () => {
    takeVehiclePrefill.mockReturnValue(companyScanPrefill());
    vi.stubGlobal("fetch", mockFetchNotFound());

    renderForm();

    const warning = await screen.findByText(NOTFOUND_TEXT);
    // The warning sits in the same row as the "Vlastník" section heading.
    const header = screen.getByText("Vlastník").parentElement as HTMLElement;
    expect(within(header).getByText(NOTFOUND_TEXT)).toBe(warning);
  });
});
