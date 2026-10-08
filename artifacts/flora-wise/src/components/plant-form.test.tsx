import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PlantForm } from "./plant-form";
import type { Plant, PlantSpecies } from "@workspace/api-client-react";

const mock = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn() }));
const species = [{ id: 19, name: "Фікус", category: null, imageUrl: "" }] as PlantSpecies[];
const places = [{ id: 7, name: "Сад", environmentType: "OUTDOOR" }];
const saved = { id: 5, speciesId: 19, speciesName: "Фікус", name: "Фікус", personalName: null,
  placeId: 7, location: "Сад", environmentType: "OUTDOOR", photoUrl: "/api/storage/objects/photos/01234567-0123-0123-0123-0123456789ab",
  photoObjectPath: "/objects/photos/01234567-0123-0123-0123-0123456789ab",
  weatherLocationId: null, weatherLocationName: "Стара локація", weatherLatitude: 49, weatherLongitude: 24,
} as Plant;

vi.mock("@clerk/react", () => ({ useAuth: () => ({ isSignedIn: true, getToken: vi.fn() }) }));
vi.mock("./place-picker", () => ({
  PlacePicker: ({ onChange }: { onChange: (place: unknown) => void }) => <button type="button" onClick={() => onChange(places[0])}>Оберіть місце тесту</button>,
}));
vi.mock("./plant-photo", () => ({ PlantPhoto: ({ src }: { src: string }) => <img alt="Збережене фото" src={src} /> }));
vi.mock("@workspace/api-client-react", () => ({
  getListSpeciesQueryKey: () => ["species"],
  getListPlantsQueryKey: () => ["plants"],
  getGetPlantQueryKey: (id: number) => ["plant", id],
  useListSpecies: () => ({ data: species }),
  useListPlantPlaces: () => ({ data: places }),
  useListSavedLocations: () => ({ data: [] }),
  useCreatePlant: () => ({ mutateAsync: mock.create, isPending: false }),
  useUpdatePlant: () => ({ mutateAsync: mock.update, isPending: false }),
  requestPhotoUpload: vi.fn(), completePhotoUpload: vi.fn(),
}));
vi.mock("./location-search", () => ({ LocationSearch: () => null }));

const done = vi.fn();
function show(plant?: Plant) {
  return render(<QueryClientProvider client={new QueryClient()}>
    <PlantForm plant={plant} onDone={done} onCancel={vi.fn()} />
  </QueryClientProvider>);
}
beforeEach(() => {
  mock.create.mockReset().mockResolvedValue(saved);
  mock.update.mockReset().mockResolvedValue(saved);
  done.mockReset();
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

test("creation sends actual speciesId and explicit null alias, not query text or name", async () => {
  show();
  fireEvent.focus(screen.getByRole("combobox", { name: "Рослина" }));
  fireEvent.click(await screen.findByTestId("option-species-19"));
  fireEvent.click(screen.getByText("Оберіть місце тесту"));
  fireEvent.click(screen.getByTestId("button-save-plant"));
  await waitFor(() => expect(mock.create).toHaveBeenCalledOnce());
  expect(mock.create.mock.calls[0][0].data).toMatchObject({ speciesId: 19, personalName: null, location: "Сад", placeId: 7 });
  expect(mock.create.mock.calls[0][0].data).not.toHaveProperty("name");
  expect(done).toHaveBeenCalledWith(saved, true);
});

test("editing default name initializes an empty alias and preserves legacy weather and private photo", async () => {
  show(saved);
  await screen.findByTestId("preview-selected-species");
  expect((screen.getByTestId("input-plant-name") as HTMLInputElement).value).toBe("");
  fireEvent.change(screen.getByTestId("input-plant-name"), { target: { value: "Малина біля паркану" } });
  fireEvent.click(screen.getByTestId("button-save-plant"));
  await waitFor(() => expect(mock.update).toHaveBeenCalledOnce());
  const data = mock.update.mock.calls[0][0].data;
  expect(data).toMatchObject({ speciesId: 19, personalName: "Малина біля паркану", placeId: 7, photoObjectPath: saved.photoObjectPath, photoUrl: "" });
  for (const field of ["weatherLocationId", "weatherLocationName", "weatherLatitude", "weatherLongitude"]) expect(data).not.toHaveProperty(field);
  expect(done).toHaveBeenCalledWith(saved, false);
});

test("even an alias equal to the canonical name remains explicit; whitespace clears it", async () => {
  show({ ...saved, personalName: "Фікус" });
  await screen.findByTestId("preview-selected-species");
  const alias = screen.getByTestId("input-plant-name") as HTMLInputElement;
  expect(alias.value).toBe("Фікус");
  fireEvent.change(alias, { target: { value: "  \t " } });
  fireEvent.click(screen.getByTestId("button-save-plant"));
  await waitFor(() => expect(mock.update).toHaveBeenCalledOnce());
  expect(mock.update.mock.calls[0][0].data.personalName).toBeNull();
});

test("changing canonical search invalidates saving instead of retaining the old speciesId", async () => {
  show(saved);
  await screen.findByTestId("preview-selected-species");
  fireEvent.change(screen.getByRole("combobox", { name: "Рослина" }), { target: { value: "Неіснуюча рослина" } });
  fireEvent.click(screen.getByTestId("button-save-plant"));
  expect(mock.update).not.toHaveBeenCalled();
  expect(screen.getByText("Оберіть рослину з довідника.")).toBeTruthy();
});

test("photo removal sends explicit clears without changing species identity", async () => {
  show(saved);
  await screen.findByTestId("preview-selected-species");
  fireEvent.click(screen.getByTestId("button-remove-plant-photo"));
  fireEvent.click(screen.getByTestId("button-save-plant"));
  await waitFor(() => expect(mock.update).toHaveBeenCalledOnce());
  expect(mock.update.mock.calls[0][0].data).toMatchObject({ speciesId: 19, photoObjectPath: null, photoUrl: "" });
});
