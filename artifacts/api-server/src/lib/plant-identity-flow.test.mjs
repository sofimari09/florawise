import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";

// Run only against the development preview, never a configurable production URL.
if (!process.env.REPLIT_DEV_DOMAIN) throw new Error("Development preview must be running");
const base = `https://${process.env.REPLIT_DEV_DOMAIN}/api`;
async function request(path, method = "GET", data, expected = 200) {
  const response = await fetch(`${base}${path}`, {
    method, headers: { "Content-Type": "application/json" },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  assert.equal(response.status, expected, `${method} ${path}`);
  return expected === 204 ? undefined : response.json();
}

test("real API: identity, default/alias PATCH semantics, preserved integrations and confirmed care only", async () => {
  const species = await request("/species");
  assert.ok(species.length >= 2);
  const [first, second] = species;
  const marker = `identity-flow-${randomUUID()}`;
  const photoUrl = "https://example.com/legacy-photo.jpg";
  let plant, legacy, weather;
  let placeId;
  try {
    // Save a non-default fixture directly, without external geocoding/profile changes.
    weather = await request("/locations", "POST", {
      displayName: marker, latitude: 31 + Math.random(), longitude: 91 + Math.random(), isDefault: false,
    }, 201);
    plant = await request("/plants", "POST", { speciesId: first.id, location: marker, photoUrl, weatherLocationId: weather.id }, 201);
    placeId = plant.placeId;
    assert.equal(plant.name, first.name);
    assert.equal(plant.personalName, null);
    assert.equal(plant.weatherLocationId, weather.id);
    const snapshot = { userId: plant.userId, placeId: plant.placeId, location: plant.location, photoUrl: plant.photoUrl,
      weatherLocationId: plant.weatherLocationId, weatherLocationName: plant.weatherLocationName,
      weatherLatitude: plant.weatherLatitude, weatherLongitude: plant.weatherLongitude };
    const preserved = updated => {
      for (const [field, value] of Object.entries(snapshot)) assert.equal(updated[field], value, field);
    };
    assert.deepEqual((await request(`/plants/${plant.id}`)).upcomingTasks, []);
    const preview = await request(`/plants/${plant.id}/care-plan`);
    assert.ok(preview[0].reason.includes(`${first.wateringFrequencyDays}`));
    assert.deepEqual((await request(`/plants/${plant.id}`)).upcomingTasks, []);

    plant = await request(`/plants/${plant.id}`, "PATCH", { personalName: `Малина біля паркану ${marker}`, category: "Вигадана категорія" });
    assert.equal(plant.speciesId, first.id);
    preserved(plant);
    const detail = await request(`/plants/${plant.id}`);
    assert.equal(detail.species.category, first.category);
    assert.deepEqual(await request(`/plants/${plant.id}/care-plan`), preview);
    assert.ok((await request(`/plants?search=${encodeURIComponent(marker)}`)).some(p => p.id === plant.id && p.name === plant.name));
    const alias = plant.personalName;
    plant = await request(`/plants/${plant.id}`, "PATCH", { speciesId: second.id });
    assert.equal(plant.personalName, alias);
    assert.equal(plant.name, alias);
    assert.equal(plant.speciesName, second.name);
    preserved(plant);
    const changedPreview = await request(`/plants/${plant.id}/care-plan`);
    assert.ok(changedPreview[0].reason.includes(second.wateringRecommendations));
    assert.deepEqual((await request(`/plants/${plant.id}`)).upcomingTasks, []);

    for (const personalName of ["  ", null, ""]) {
      plant = await request(`/plants/${plant.id}`, "PATCH", { personalName });
      assert.equal(plant.personalName, null);
      assert.equal(plant.name, second.name);
      preserved(plant);
    }
    plant = await request(`/plants/${plant.id}`, "PATCH", { speciesId: first.id });
    assert.equal(plant.name, first.name);
    plant = await request(`/plants/${plant.id}`, "PATCH", { name: `legacy-${marker}` });
    assert.equal(plant.personalName, `legacy-${marker}`);
    plant = await request(`/plants/${plant.id}`, "PATCH", { name: "ignored legacy", personalName: null });
    assert.equal(plant.name, first.name);
    assert.equal(plant.personalName, null);
    await request(`/plants/${plant.id}`, "PATCH", { speciesId: 2147483647 }, 400);
    assert.equal((await request(`/plants/${plant.id}`)).speciesId, first.id);
    await request("/plants", "POST", { speciesId: 2147483647, personalName: "Малина", location: marker, photoUrl }, 400);
    await request("/plants", "POST", { personalName: "Малина", location: marker, photoUrl }, 400);
    legacy = await request("/plants", "POST", { speciesId: first.id, name: `legacy-create-${marker}`, location: marker, photoUrl }, 201);
    assert.equal(legacy.name, legacy.personalName);
    assert.equal(legacy.speciesId, first.id);

    // Switching the linked species, even back to the original, invalidates the old confirmation snapshot.
    await request(`/plants/${plant.id}/care-plan`, "POST", { items: preview.slice(0, 1) }, 400);
    const currentPreview = await request(`/plants/${plant.id}/care-plan`);
    const tasks = await request(`/plants/${plant.id}/care-plan`, "POST", { items: currentPreview.slice(0, 1) }, 201);
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].plantName, first.name);
    const dates = (await request(`/plants/${plant.id}`)).upcomingTasks.map(t => [t.id, t.scheduledDate]);
    plant = await request(`/plants/${plant.id}`, "PATCH", { personalName: `confirmed-${marker}` });
    const after = await request(`/plants/${plant.id}`);
    assert.deepEqual(after.upcomingTasks.map(t => [t.id, t.scheduledDate]), dates);
    assert.equal(after.upcomingTasks[0].plantName, plant.name);
    assert.ok((await request("/reminders")).some(r => r.plantName === plant.name));
    assert.equal((await request(`/plants/${plant.id}/care-plan`, "POST", { items: currentPreview.slice(0, 1) }, 201)).length, 0);

    const normalized = await request(`/species?search=${encodeURIComponent(`  ${first.name.toUpperCase()}  `)}`);
    assert.ok(normalized.some(s => s.id === first.id));
    assert.deepEqual(await request(`/species?search=${encodeURIComponent(marker)}`), []);
    const raspberries = await request(`/species?search=${encodeURIComponent(" мАЛИНА ")}`);
    assert.ok(raspberries.every(s => s.name.toLocaleLowerCase("uk-UA").includes("малина")));
  } finally {
    if (plant) await request(`/plants/${plant.id}`, "DELETE", undefined, 204);
    if (legacy) await request(`/plants/${legacy.id}`, "DELETE", undefined, 204);
    if (placeId) await request(`/places/${placeId}`, "DELETE", undefined, 204);
    if (weather) await request(`/locations/${weather.id}`, "DELETE", undefined, 204);
  }
});
