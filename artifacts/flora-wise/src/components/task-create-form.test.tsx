import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TaskCreateForm } from "./task-create-form";
import { CategoryFilter } from "./fw-ui";
import { CARE_LABELS, PLANT_CATEGORIES, CATEGORY_LABELS } from "@workspace/plant-care";

const mock = vi.hoisted(() => ({ loading: false, error: false, empty: false, mutate: vi.fn(), refetch: vi.fn() }));
vi.mock("@workspace/api-client-react", () => ({
  getGetPlantQueryKey: (id: number) => ["plant", id],
  useListPlants: () => ({ data: [{ id: 1, name: "Монстера" }, { id: 2, name: "Базилік" }], isLoading: false, isError: false }),
  useCreateTask: () => ({ mutate: mock.mutate, isPending: false }),
  useGetPlant: (id: number) => ({
    isFetching: mock.loading, isError: mock.error, refetch: mock.refetch,
    data: { id, allowedCareTypes: mock.empty ? [] : id === 1 ? ["WATERING", "PRUNING", "TREATMENT"] : ["SOWING", "PLANTING", "WATERING", "HARVEST"] },
  }),
}));
const renderForm = () => render(<QueryClientProvider client={new QueryClient()}><TaskCreateForm onDone={() => {}} /></QueryClientProvider>);
beforeEach(() => { mock.loading = false; mock.error = false; mock.empty = false; mock.mutate.mockClear(); mock.refetch.mockClear(); });
afterEach(cleanup);
test("plant switching resets selection, restricts options, and sends Ukrainian-labeled eligible type", () => {
  renderForm();
  const plant = screen.getByTestId("select-task-plant");
  const type = screen.getByTestId("select-task-type");
  expect((type as HTMLSelectElement).disabled).toBe(true);
  fireEvent.change(plant, { target: { value: "1" } });
  expect(screen.queryByRole("option", { name: CARE_LABELS.HARVEST })).toBeNull();
  fireEvent.change(type, { target: { value: "PRUNING" } });
  fireEvent.change(plant, { target: { value: "2" } });
  expect((type as HTMLSelectElement).value).toBe("");
  expect(screen.queryByRole("option", { name: CARE_LABELS.PRUNING })).toBeNull();
  expect(screen.getByRole("option", { name: "Посів" })).toBeTruthy();
  expect(screen.getByRole("option", { name: "Висаджування" })).toBeTruthy();
  expect(screen.getByRole("option", { name: "Збір урожаю" })).toBeTruthy();
  fireEvent.change(type, { target: { value: "SOWING" } });
  fireEvent.click(screen.getByRole("button", { name: "Додати до календаря" }));
  expect(mock.mutate.mock.calls[0][0].data).toMatchObject({ plantId: 2, type: "SOWING" });
});
test.each(["loading", "error", "empty"] as const)("%s eligibility never offers cached or unsafe fallback options", state => {
  mock[state] = true;
  renderForm();
  fireEvent.change(screen.getByTestId("select-task-plant"), { target: { value: "1" } });
  expect((screen.getByTestId("select-task-type") as HTMLSelectElement).disabled).toBe(true);
  expect(screen.queryByRole("option", { name: "Полив" })).toBeNull();
  expect((screen.getByRole("button", { name: "Додати до календаря" }) as HTMLButtonElement).disabled).toBe(true);
  if (state === "error") { fireEvent.click(screen.getByRole("button", { name: "Повторити" })); expect(mock.refetch).toHaveBeenCalled(); }
});
test("category filter lists six Ukrainian labels and emits controlled codes", () => {
  const change = vi.fn();
  render(<CategoryFilter value="" onChange={change} />);
  for (const code of PLANT_CATEGORIES) expect(screen.getByRole("option", { name: CATEGORY_LABELS[code] })).toBeTruthy();
  fireEvent.change(screen.getByTestId("filter-category"), { target: { value: "FRUIT_TREE" } });
  expect(change).toHaveBeenCalledWith("FRUIT_TREE");
});
