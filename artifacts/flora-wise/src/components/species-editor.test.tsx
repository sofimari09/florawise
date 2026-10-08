import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SpeciesEditor } from "./species-editor";
import { CarePlanDialog } from "./care-plan-dialog";
import { CARE_LABELS, CATEGORY_DEFAULTS } from "@workspace/plant-care";

const mock = vi.hoisted(() => ({
  create: vi.fn(), update: vi.fn(), confirm: vi.fn(), refetch: vi.fn(),
  preview: [{ type: "WATERING", scheduledDate: "2026-10-15", reason: "Інтервал виду", eligibilityVersion: "snapshot" }],
}));
vi.mock("@workspace/api-client-react", () => ({
  getGetSpeciesKnowledgeQueryKey: (id: number) => ["knowledge", id],
  getListSpeciesQueryKey: () => ["species"],
  useCreateSpecies: () => ({ mutate: mock.create }),
  useUpdateSpecies: () => ({ mutate: mock.update }),
  useUpdateSpeciesKnowledge: () => ({}),
  useGetSpeciesKnowledge: () => ({ data: { careRules: [], sources: [] } }),
  useConfirmCarePlan: () => ({ mutate: mock.confirm }),
  usePreviewCarePlan: () => ({ data: mock.preview, isFetching: false, isError: false, refetch: mock.refetch }),
  getPreviewCarePlanQueryKey: (id: number) => ["plan", id],
  getListTasksQueryKey: () => ["tasks"], getListRemindersQueryKey: () => ["reminders"],
  getGetStatisticsQueryKey: () => ["stats"], getGetDashboardQueryKey: () => ["dashboard"],
  getGetPlantQueryKey: () => ["plant"], getListPlantsQueryKey: () => ["plants"],
}));
const wrap = (content: React.ReactNode) => render(<QueryClientProvider client={new QueryClient()}>{content}</QueryClientProvider>);
const ready = () => {
  fireEvent.change(screen.getByTestId("input-species-name"), { target: { value: "Тестовий вид" } });
  fireEvent.change(screen.getByTestId("select-species-category"), { target: { value: "HERB" } });
};
const submit = () => fireEvent.submit(screen.getByTestId("button-save-species").closest("form")!);
beforeEach(() => { mock.create.mockClear(); mock.update.mockClear(); mock.confirm.mockClear(); mock.refetch.mockReset();
  mock.preview = [{ type: "WATERING", scheduledDate: "2026-10-15", reason: "Інтервал виду", eligibilityVersion: "snapshot" }];
});
afterEach(cleanup);
test("admin requires a controlled category and inherits defaults independently of weather rules", () => {
  wrap(<SpeciesEditor onClose={() => {}} />);
  fireEvent.change(screen.getByTestId("input-species-name"), { target: { value: "Тест" } });
  submit();
  expect(mock.create).not.toHaveBeenCalled();
  expect(screen.getByRole("alert").textContent).toContain("Оберіть категорію");
  ready(); submit();
  expect(mock.create.mock.calls[0][0].data).toMatchObject({ category: "HERB", applicableCareTypes: null, knowledge: { careRules: [], sources: [] } });
  expect(screen.queryByTestId("checkbox-applicability-TREATMENT")).toBeNull();
});
test("admin explicit-empty applicability remains empty rather than inheriting category activities", () => {
  wrap(<SpeciesEditor onClose={() => {}} />);
  ready();
  fireEvent.click(screen.getByLabelText("Явно уточнити дії виду"));
  for (const type of CATEGORY_DEFAULTS.HERB) fireEvent.click(screen.getByTestId(`checkbox-applicability-${type}`));
  submit();
  expect(mock.create.mock.calls[0][0].data.applicableCareTypes).toEqual([]);
  expect((screen.getByTestId("button-add-rule") as HTMLButtonElement).disabled).toBe(true);
});
test("species refinement and weather knowledge are submitted atomically", () => {
  wrap(<SpeciesEditor onClose={() => {}} />); ready();
  fireEvent.click(screen.getByLabelText("Явно уточнити дії виду"));
  fireEvent.click(screen.getByTestId("checkbox-applicability-SOWING"));
  fireEvent.click(screen.getByTestId("button-add-rule"));
  submit();
  const payload = mock.create.mock.calls[0][0].data;
  expect(payload.applicableCareTypes).not.toContain("SOWING");
  expect(payload.knowledge.careRules).toHaveLength(1);
  expect(payload.applicableCareTypes).toContain(payload.knowledge.careRules[0].careType);
});
test("care plan preview is non-mutating; selected confirmation carries snapshot and preserves user date", () => {
  wrap(<CarePlanDialog plantId={1} plantName="Монстера" onClose={() => {}} />);
  expect(mock.confirm).not.toHaveBeenCalled();
  expect(screen.getByText(CARE_LABELS.WATERING)).toBeTruthy();
  fireEvent.change(screen.getByTestId("input-care-plan-date-0"), { target: { value: "2026-10-16" } });
  fireEvent.click(screen.getByTestId("button-confirm-care-plan"));
  expect(mock.confirm.mock.calls[0][0].data.items[0]).toMatchObject({ type: "WATERING", eligibilityVersion: "snapshot", scheduledDate: "2026-10-16" });
});
test("empty care plan and stale rejection never offer fabricated schedules", () => {
  mock.preview = [];
  wrap(<CarePlanDialog plantId={1} plantName="Монстера" onClose={() => {}} />);
  expect((screen.getByTestId("button-confirm-care-plan") as HTMLButtonElement).disabled).toBe(true);
  expect(mock.confirm).not.toHaveBeenCalled();
});
test("stale plan error requests a new preview and removes obsolete rows", () => {
  mock.confirm.mockImplementation((_input, callbacks) => callbacks.onError({ data: { error: "Застосовність змінилася" } }));
  mock.refetch.mockImplementation(() => { mock.preview = []; });
  wrap(<CarePlanDialog plantId={1} plantName="Монстера" onClose={() => {}} />);
  fireEvent.click(screen.getByTestId("button-confirm-care-plan"));
  expect(screen.getByRole("alert").textContent).toContain("Застосовність змінилася");
  expect(mock.refetch).toHaveBeenCalledOnce();
  expect(screen.queryByTestId("row-care-plan-0")).toBeNull();
  expect((screen.getByTestId("button-confirm-care-plan") as HTMLButtonElement).disabled).toBe(true);
});
