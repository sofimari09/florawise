import { useState } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SpeciesPicker } from "./species-picker";
import { speciesKeyAction, speciesSearchKey } from "./species-search-state";
import type { PlantSpecies } from "@workspace/api-client-react";

const mock = vi.hoisted(() => ({ loading: false, error: false, empty: false, refetch: vi.fn(), search: "" }));
const raspberry = { id: 31, name: "Малина", category: "BERRY_SHRUB", imageUrl: "", scientificName: null } as PlantSpecies;
const strawberry = { id: 45, name: "Полуниця", category: "BERRY_SHRUB", imageUrl: "https://example.com/broken.jpg" } as PlantSpecies;
const cachedResults = new Map<string, PlantSpecies[]>();

vi.mock("@workspace/api-client-react", () => ({
  getListSpeciesQueryKey: (params: unknown) => ["species", params],
  useListSpecies: ({ search }: { search: string }) => {
    mock.search = search;
    const cacheKey = `${mock.empty}:${search}`;
    if (!cachedResults.has(cacheKey)) cachedResults.set(cacheKey, mock.empty ? [] : [raspberry, strawberry].filter(s => s.name.toLowerCase().includes(search)));
    return {
      data: cachedResults.get(cacheKey),
      isFetching: mock.loading, isLoading: mock.loading, isError: mock.error, refetch: mock.refetch,
    };
  },
}));

function Harness() {
  const [value, setValue] = useState<PlantSpecies | null>(null);
  return <form onSubmit={e => { e.preventDefault(); mock.refetch("submit"); }}>
    <SpeciesPicker value={value} onChange={setValue} />
    <output data-testid="selected-id">{value?.id ?? ""}</output>
    <button type="submit">Зберегти</button>
  </form>;
}

beforeEach(() => {
  mock.loading = false; mock.error = false; mock.empty = false; mock.refetch.mockClear();
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

test("keyboard selection stores the actual ID, previews missing metadata, and Enter never submits", async () => {
  render(<Harness />);
  const input = screen.getByRole("combobox");
  fireEvent.focus(input);
  await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(2));
  fireEvent.keyDown(input, { key: "ArrowDown" });
  expect(input.getAttribute("aria-activedescendant")).toBeTruthy();
  fireEvent.keyDown(input, { key: "Enter" });
  expect(screen.getByTestId("selected-id").textContent).toBe("31");
  expect(screen.getByTestId("preview-selected-species").textContent).toContain("Малина");
  expect(screen.getByText("Категорія: Ягідний кущ")).toBeTruthy();
  expect(mock.refetch).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: "Enter" });
  expect(mock.refetch).not.toHaveBeenCalled();
});

test("editing a selection immediately clears its hidden ID, and clear resets the choice", async () => {
  render(<Harness />);
  const input = screen.getByRole("combobox");
  fireEvent.focus(input);
  fireEvent.click(await screen.findByTestId("option-species-31"));
  fireEvent.change(input, { target: { value: "Пол" } });
  expect(screen.getByTestId("selected-id").textContent).toBe("");
  expect(screen.queryByTestId("preview-selected-species")).toBeNull();
  await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(1));
  fireEvent.click(screen.getByTestId("option-species-45"));
  expect(screen.getByTestId("selected-id").textContent).toBe("45");
  fireEvent.click(screen.getByLabelText("Очистити вибір рослини"));
  expect(screen.getByTestId("selected-id").textContent).toBe("");
  expect((input as HTMLInputElement).value).toBe("");
});

test("normalized responsive search matches only real raspberry, never strawberry", async () => {
  render(<Harness />);
  const input = screen.getByRole("combobox");
  fireEvent.change(input, { target: { value: "  МАЛИНА   " } });
  expect(screen.getByText("Шукаємо рослини…")).toBeTruthy();
  await waitFor(() => expect(mock.search).toBe("малина"));
  expect(screen.getByTestId("option-species-31")).toBeTruthy();
  expect(screen.queryByTestId("option-species-45")).toBeNull();
  fireEvent.change(input, { target: { value: "немає такого виду" } });
  await waitFor(() => expect(screen.getByText(/Нічого не знайдено/)).toBeTruthy());
  expect(screen.getByTestId("selected-id").textContent).toBe("");
});

test("loading and retry errors are Ukrainian and never expose stale suggestions", () => {
  mock.loading = true;
  const { rerender } = render(<Harness />);
  fireEvent.focus(screen.getByRole("combobox"));
  expect(screen.getByText("Шукаємо рослини…")).toBeTruthy();
  expect(screen.queryAllByRole("option")).toHaveLength(0);
  mock.loading = false; mock.error = true;
  rerender(<Harness />);
  fireEvent.click(screen.getByText("Повторити пошук"));
  expect(mock.refetch).toHaveBeenCalledOnce();
  expect(screen.getByText("Не вдалося завантажити рослини.")).toBeTruthy();
});

test("mouse/touch click selection and broken image fallback", async () => {
  render(<Harness />);
  fireEvent.focus(screen.getByRole("combobox"));
  const option = await screen.findByTestId("option-species-45");
  fireEvent.pointerDown(option, { pointerType: "touch" });
  fireEvent.click(option);
  expect(screen.getByTestId("selected-id").textContent).toBe("45");
  expect(screen.getByText("Категорія: Ягідний кущ")).toBeTruthy();
  fireEvent.error(screen.getByRole("img"));
  expect(screen.getByLabelText("Фото виду відсутнє")).toBeTruthy();
});

test("Escape and Tab close; arrows wrap; Enter with no result does nothing", () => {
  expect(speciesSearchKey("  МАЛИНА   біля  ")).toBe("малина біля");
  expect(speciesKeyAction("ArrowDown", 1, 2, true).active).toBe(0);
  expect(speciesKeyAction("ArrowUp", -1, 2, false).active).toBe(1);
  expect(speciesKeyAction("Enter", -1, 0, true).select).toBeUndefined();
  render(<Harness />);
  const input = screen.getByRole("combobox");
  fireEvent.focus(input);
  fireEvent.keyDown(input, { key: "Escape" });
  expect(input.getAttribute("aria-expanded")).toBe("false");
  fireEvent.focus(input);
  fireEvent.keyDown(input, { key: "Tab" });
  expect(input.getAttribute("aria-expanded")).toBe("false");
});

test("custom fallback remains keyboard-accessible after Tab closes an empty result list", () => {
  mock.empty = true;
  const custom = vi.fn();
  const changed = vi.fn();
  render(<SpeciesPicker value={null} onChange={changed} onCustom={custom} />);
  const input = screen.getByRole("combobox");
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: "Невідома рослина" } });
  fireEvent.keyDown(input, { key: "Tab" });
  const fallback = screen.getByRole("button", { name: "Додати іншу рослину" });
  fallback.focus();
  expect(document.activeElement).toBe(fallback);
  expect(custom).not.toHaveBeenCalled();
  fireEvent.click(fallback);
  expect(custom).toHaveBeenCalledWith("Невідома рослина");
  expect(changed).toHaveBeenCalledWith(null);
});
